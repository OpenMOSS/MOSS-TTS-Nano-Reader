import { createBrowserOnnxTtsRuntime } from './browser_onnx_runtime.js';

const HOST_SOURCE = 'nano-reader-browser-onnx-host';
const CLIENT_SOURCE = 'nano-reader-browser-onnx-client';
const CANCELLED_ERROR_CODE = 'BROWSER_ONNX_CANCELLED';

let runtime = null;

const activeSynthesisRequests = new Map();

function log(message, extra = undefined) {
  if (extra === undefined) {
    console.debug('[browser_onnx host]', message);
    return;
  }
  console.debug('[browser_onnx host]', message, extra);
}

function postToParent(payload, transfer = undefined) {
  parent.postMessage(
    {
      source: HOST_SOURCE,
      ...payload,
    },
    '*',
    transfer || []
  );
}

function createCancelledError() {
  const error = new Error('Browser ONNX synthesis cancelled');
  error.code = CANCELLED_ERROR_CODE;
  return error;
}

function loadBrowserUploadedVoices() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['browserUploadedVoices'], (result) => {
      if (chrome.runtime.lastError) {
        resolve([]);
        return;
      }
      resolve(Array.isArray(result?.browserUploadedVoices) ? result.browserUploadedVoices : []);
    });
  });
}

async function getRuntime({ modelPath, threadCount }) {
  if (!runtime) {
    runtime = createBrowserOnnxTtsRuntime({
      logger: (message) => log(message),
    });
  }
  await runtime.configure({
    modelPath,
    threadCount,
  });
  return runtime;
}

async function ensurePrepared(config) {
  const preparedRuntime = await getRuntime(config);
  await preparedRuntime.warmup();
  return preparedRuntime;
}

function getActiveRequest(requestId) {
  return activeSynthesisRequests.get(requestId) || null;
}

function resolvePendingChunkAcks(requestState, accepted) {
  if (!requestState?.pendingChunkAcks) {
    return;
  }
  for (const resolve of requestState.pendingChunkAcks.values()) {
    try {
      resolve(Boolean(accepted));
    } catch (error) {
      // Ignore ack resolution failures during teardown.
    }
  }
  requestState.pendingChunkAcks.clear();
}

function cancelActiveRequest(requestId) {
  const requestState = getActiveRequest(requestId);
  if (!requestState) {
    return false;
  }
  requestState.cancelled = true;
  resolvePendingChunkAcks(requestState, false);
  return true;
}

async function postAudioChunkAndWaitAck(requestState, requestId, chunk) {
  if (requestState.cancelled) {
    throw createCancelledError();
  }

  const chunkId = `${requestId}:chunk:${requestState.chunkCounter += 1}`;
  const buffers = chunk.chunkData.map((channelData) => channelData.buffer);

  const acceptedPromise = new Promise((resolve) => {
    requestState.pendingChunkAcks.set(chunkId, resolve);
  });

  postToParent({
    type: 'audio-chunk',
    requestId,
    chunkId,
    sampleRate: chunk.sampleRate,
    channels: chunk.channels,
    isPause: Boolean(chunk.isPause),
    buffers,
  }, buffers);

  const accepted = await acceptedPromise;
  requestState.pendingChunkAcks.delete(chunkId);
  if (!accepted) {
    requestState.cancelled = true;
    throw createCancelledError();
  }
}

async function handleWarmup(requestId, payload) {
  await ensurePrepared(payload.config);
  postToParent({
    type: 'response',
    requestId,
    ok: true,
    data: { status: 'prepared' },
  });
}

async function handleSynthesize(requestId, payload) {
  const requestState = {
    cancelled: false,
    chunkCounter: 0,
    pendingChunkAcks: new Map(),
  };
  activeSynthesisRequests.set(requestId, requestState);

  try {
    const preparedRuntime = await getRuntime(payload.config);
    await preparedRuntime.ensureTokenizerLoaded();
    await preparedRuntime.ensureSynthesisLoaded();

    const extraVoices = await loadBrowserUploadedVoices();
    const result = await preparedRuntime.synthesizeVoiceClone({
      text: payload.text,
      voiceName: payload.voiceName,
      extraVoices,
      sampleMode: payload.settings?.sampleMode,
      doSample: payload.settings?.doSample,
      streaming: Boolean(payload.settings?.realtimeStreamingDecode),
      enableNormalizeTtsText: payload.settings?.enableNormalizeTtsText !== false,
      enableWeTextProcessing: payload.settings?.enableWeTextProcessing !== false,
      voiceCloneMaxTextTokens: payload.settings?.voiceCloneMaxTextTokens,
      onPreparedText: async (preparedText) => {
        postToParent({
          type: 'prepared-text',
          requestId,
          preparedText,
        });
      },
      isCancelled: () => requestState.cancelled,
      onAudioChunk: async (chunk) => {
        await postAudioChunkAndWaitAck(requestState, requestId, chunk);
      },
    });

    postToParent({
      type: 'response',
      requestId,
      ok: true,
      data: {
        status: requestState.cancelled ? 'cancelled' : 'completed',
        summary: {
          textChunkCount: Array.isArray(result?.textChunks) ? result.textChunks.length : 0,
          outputCount: Array.isArray(result?.outputs) ? result.outputs.length : 0,
          totalFrames: Array.isArray(result?.outputs)
            ? result.outputs.reduce((total, item) => total + Number(item?.frames || 0), 0)
            : 0,
        },
      },
    });
  } catch (error) {
    const cancelled = requestState.cancelled || error?.code === CANCELLED_ERROR_CODE;
    postToParent({
      type: 'response',
      requestId,
      ok: cancelled,
      data: cancelled
        ? { status: 'cancelled' }
        : undefined,
      error: cancelled ? undefined : (error?.message || String(error)),
    });
  } finally {
    resolvePendingChunkAcks(requestState, false);
    activeSynthesisRequests.delete(requestId);
  }
}

async function handleIncomingRequest(event, payload) {
  const { action, requestId } = payload;
  if (!requestId) {
    return;
  }

  if (action === 'chunk-ack') {
    const requestState = getActiveRequest(requestId);
    if (!requestState) {
      return;
    }
    const resolve = requestState.pendingChunkAcks.get(payload.chunkId);
    if (!resolve) {
      return;
    }
    requestState.pendingChunkAcks.delete(payload.chunkId);
    resolve(payload.accepted !== false);
    return;
  }

  if (action === 'cancel') {
    cancelActiveRequest(payload.targetRequestId);
    postToParent({
      type: 'response',
      requestId,
      ok: true,
      data: { status: 'cancelled' },
    });
    return;
  }

  try {
    if (action === 'warmup') {
      await handleWarmup(requestId, payload);
      return;
    }
    if (action === 'synthesize') {
      await handleSynthesize(requestId, payload);
      return;
    }
    postToParent({
      type: 'response',
      requestId,
      ok: false,
      error: `Unsupported host action: ${action}`,
    });
  } catch (error) {
    postToParent({
      type: 'response',
      requestId,
      ok: false,
      error: error?.message || String(error),
    });
  }
}

window.addEventListener('message', (event) => {
  const payload = event.data;
  if (!payload || payload.source !== CLIENT_SOURCE) {
    return;
  }
  void handleIncomingRequest(event, payload);
});

postToParent({ type: 'ready' });
