/**
 * Nano Reader - Content Script
 * Extracts main content from web pages and handles audio playback
 * Uses streaming-first synthesis with fallback for resilient playback
 */

const SERVER_URL = 'http://localhost:5050';

// Audio playback state
let audioContext = null;
let currentAudioElement = null;
let currentAudioUrl = null;
let shouldStop = false;
let isPaused = false;
let playbackSpeed = 1.0;
let currentParagraphIndex = 0;
let totalParagraphs = 0;
let mainStreamAbortController = null;
let currentRealtimeSession = null;

// Selection reading state (separate from main page reading)
let selectionAudioElement = null;
let selectionAudioUrl = null;
let isReadingSelection = false;
let selectionStreamAbortController = null;

const DEFAULT_TTS_SETTINGS = {
  realtimeStreamingDecode: true,
  enableWeTextProcessing: true,
  enableNormalizeTtsText: true,
  initialPlaybackDelaySeconds: 0.08,
  executionDevice: 'cpu',
  cpuThreads: 0,
  attnImplementation: 'model_default',
  voiceCloneMaxTextTokens: 75,
  ttsMaxBatchSize: 0,
  codecMaxBatchSize: 0
};

function normalizeSynthesisSettings(rawSettings = {}) {
  const normalized = { ...DEFAULT_TTS_SETTINGS, ...(rawSettings || {}) };
  normalized.realtimeStreamingDecode = Boolean(normalized.realtimeStreamingDecode);
  const legacyTextNormalizationEnabled = normalized.textNormalizationEnabled;
  normalized.enableWeTextProcessing = normalized.enableWeTextProcessing !== undefined
    ? normalized.enableWeTextProcessing !== false
    : legacyTextNormalizationEnabled !== false;
  normalized.enableNormalizeTtsText = normalized.enableNormalizeTtsText !== undefined
    ? normalized.enableNormalizeTtsText !== false
    : legacyTextNormalizationEnabled !== false;
  normalized.initialPlaybackDelaySeconds = Math.max(0, Number(normalized.initialPlaybackDelaySeconds));
  if (!Number.isFinite(normalized.initialPlaybackDelaySeconds)) {
    normalized.initialPlaybackDelaySeconds = DEFAULT_TTS_SETTINGS.initialPlaybackDelaySeconds;
  }
  normalized.executionDevice = 'cpu';
  normalized.cpuThreads = Math.max(0, parseInt(normalized.cpuThreads || 0, 10) || 0);
  normalized.attnImplementation = ['model_default', 'sdpa', 'eager'].includes(
    normalized.attnImplementation
  )
    ? normalized.attnImplementation
    : DEFAULT_TTS_SETTINGS.attnImplementation;
  normalized.voiceCloneMaxTextTokens = Math.max(25, parseInt(normalized.voiceCloneMaxTextTokens || 75, 10) || 75);
  normalized.ttsMaxBatchSize = Math.max(0, parseInt(normalized.ttsMaxBatchSize || 0, 10) || 0);
  normalized.codecMaxBatchSize = Math.max(0, parseInt(normalized.codecMaxBatchSize || 0, 10) || 0);
  return normalized;
}

function buildSynthesisPayload(text, voice, settings) {
  const normalized = normalizeSynthesisSettings(settings);
  return {
    text,
    voice,
    mode: 'voice_clone',
    enable_text_normalization: normalized.enableWeTextProcessing,
    enable_normalize_tts_text: normalized.enableNormalizeTtsText,
    voice_clone_max_text_tokens: normalized.voiceCloneMaxTextTokens,
    tts_max_batch_size: normalized.ttsMaxBatchSize,
    codec_max_batch_size: normalized.codecMaxBatchSize,
    execution_device: 'cpu',
    cpu_threads: normalized.cpuThreads,
    attn_implementation: normalized.attnImplementation
  };
}

function resolveEffectivePlaybackSpeed(speed, settings = {}) {
  const normalized = normalizeSynthesisSettings(settings);
  if (normalized.realtimeStreamingDecode) {
    return 1.0;
  }

  const resolvedSpeed = Number(speed);
  if (!Number.isFinite(resolvedSpeed) || resolvedSpeed <= 0) {
    return 1.0;
  }
  return resolvedSpeed;
}

/**
 * Get or create the audio context
 */
function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

function hasRealtimePlayback() {
  return Boolean(currentRealtimeSession && currentRealtimeSession.active);
}

function resetRealtimeSession(session = currentRealtimeSession) {
  if (currentRealtimeSession === session) {
    currentRealtimeSession = null;
  }
}

function resetAudioContext() {
  if (!audioContext) {
    return;
  }
  const contextToClose = audioContext;
  audioContext = null;
  contextToClose.close().catch(() => {});
}

function scheduleRealtimePcmChunk(session, pcmChunk, sampleRate, channels, speed) {
  if (!session || !session.audioContext || pcmChunk.byteLength <= 0) {
    return false;
  }

  const bytesPerFrame = channels * 2;
  const totalFrames = Math.floor(pcmChunk.byteLength / bytesPerFrame);
  if (totalFrames <= 0) {
    return false;
  }

  const ctx = session.audioContext;
  const audioBuffer = ctx.createBuffer(channels, totalFrames, sampleRate);
  const view = new DataView(pcmChunk.buffer, pcmChunk.byteOffset, totalFrames * bytesPerFrame);
  for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
    const channelData = audioBuffer.getChannelData(channelIndex);
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
      const byteOffset = (frameIndex * channels + channelIndex) * 2;
      channelData[frameIndex] = view.getInt16(byteOffset, true) / 32768.0;
    }
  }

  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.playbackRate.value = Math.max(0.1, speed || 1.0);
  source.connect(ctx.destination);
  const now = ctx.currentTime;
  const startAt = Math.max(session.nextPlaybackTime || (now + session.initialPlaybackDelaySeconds), now + 0.02);
  source.start(startAt);
  session.nextPlaybackTime = startAt + audioBuffer.duration / source.playbackRate.value;
  return true;
}

async function waitForRealtimePlaybackDrain(session, isStillActive) {
  if (!session || !session.audioContext) {
    return;
  }
  while (isStillActive() && session.audioContext && session.nextPlaybackTime > session.audioContext.currentTime + 0.02) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function playRealtimeAudioStream(text, voice, speed, settings, abortController, isStillActive) {
  const normalizedSettings = normalizeSynthesisSettings(settings);
  const response = await fetch(`${SERVER_URL}/synthesize-realtime`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/octet-stream' },
    body: JSON.stringify(buildSynthesisPayload(text, voice, normalizedSettings)),
    signal: abortController.signal,
    cache: 'no-store'
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Realtime synthesis failed');
  }

  if (!response.body) {
    throw new Error('Realtime streaming response is not supported by this browser');
  }

  const ctx = getAudioContext();
  await ctx.resume();
  const session = {
    audioContext: ctx,
    nextPlaybackTime: 0,
    initialPlaybackDelaySeconds: normalizedSettings.initialPlaybackDelaySeconds,
    active: true
  };
  currentRealtimeSession = session;

  const sampleRate = Number(response.headers.get('X-Audio-Sample-Rate') || 48000);
  const channels = Number(response.headers.get('X-Audio-Channels') || 2);
  const bytesPerFrame = channels * 2;
  const reader = response.body.getReader();
  let remainder = new Uint8Array(0);
  let scheduledAnyAudio = false;

  try {
    try {
      while (isStillActive()) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (!value || value.length === 0) {
          continue;
        }

        const merged = new Uint8Array(remainder.length + value.length);
        merged.set(remainder, 0);
        merged.set(value, remainder.length);
        const alignedLength = Math.floor(merged.length / bytesPerFrame) * bytesPerFrame;
        if (alignedLength <= 0) {
          remainder = merged;
          continue;
        }

        const scheduled = scheduleRealtimePcmChunk(
          session,
          merged.subarray(0, alignedLength),
          sampleRate,
          channels,
          speed
        );
        scheduledAnyAudio = scheduledAnyAudio || scheduled;
        remainder = merged.subarray(alignedLength);
      }
    } catch (error) {
      error.playedAnyAudio = scheduledAnyAudio;
      throw error;
    }

    if (!scheduledAnyAudio) {
      throw new Error('Realtime stream finished before any audio was scheduled');
    }

    await waitForRealtimePlaybackDrain(session, isStillActive);
    return { stopped: !isStillActive() };
  } finally {
    session.active = false;
    resetRealtimeSession(session);
  }
}

/**
 * Get or create the selection audio context
 */

// DOM element tracking for highlighting
let readableElements = []; // Array of DOM elements that can be read
let currentHighlightedElement = null;

// CSS class for highlighting
const HIGHLIGHT_CLASS = 'pocket-reader-highlight';
const HIGHLIGHT_STYLE_ID = 'pocket-reader-styles';

/**
 * Inject highlight styles into the page
 */
function injectHighlightStyles() {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      background-color: rgba(99, 102, 241, 0.15) !important;
      outline: 2px solid rgba(99, 102, 241, 0.5) !important;
      outline-offset: 2px !important;
      border-radius: 4px !important;
      transition: background-color 0.2s ease, outline 0.2s ease !important;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Highlight a specific element
 */
function highlightElement(element) {
  // Remove previous highlight
  if (currentHighlightedElement) {
    currentHighlightedElement.classList.remove(HIGHLIGHT_CLASS);
  }

  if (element) {
    element.classList.add(HIGHLIGHT_CLASS);
    currentHighlightedElement = element;

    // Scroll element into view smoothly
    element.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest'
    });
  }
}

/**
 * Remove all highlights
 */
function removeHighlight() {
  if (currentHighlightedElement) {
    currentHighlightedElement.classList.remove(HIGHLIGHT_CLASS);
    currentHighlightedElement = null;
  }
}

/**
 * Find the main content container
 */
function findContentContainer() {
  const selectors = [
    '[data-testid="twitterArticleReadView"]',
    'article',
    '[role="main"]',
    'main',
    '.article-content',
    '.post-content',
    '.entry-content',
    '.content',
    '#content',
    '.story-body',
    '.article-body',
    '.post-body'
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && element.innerText.trim().length > 200) {
      return element;
    }
  }

  return document.body;
}

/**
 * Check if an element should be excluded from reading
 */
function isExcludedElement(element) {
  const excludedTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'NAV', 'HEADER', 'FOOTER', 'ASIDE'];
  if (excludedTags.includes(element.tagName)) return true;

  const excludedClasses = [
    'sidebar',
    'navigation',
    'menu',
    'comments',
    'comment',
    'advertisement',
    'ad',
    'ads',
    'social-share',
    'share-buttons',
    'related-posts',
    'recommended'
  ];

  const classList = Array.from(element.classList).map((c) => c.toLowerCase());
  if (excludedClasses.some((exc) => classList.includes(exc))) return true;

  const role = element.getAttribute('role');
  if (['navigation', 'banner', 'complementary'].includes(role)) return true;

  if (element.getAttribute('aria-hidden') === 'true') return true;

  return false;
}

/**
 * Check if an element is visible
 */
function isVisible(element) {
  const style = window.getComputedStyle(element);
  return (
    style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && element.offsetParent !== null
  );
}

/**
 * Extract readable elements from the DOM
 * Returns array of objects with { element, text } for each readable block
 */
const PRIMARY_READABLE_SELECTOR = [
  '[data-testid="twitter-article-title"]',
  '[data-testid="tweetText"]',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'blockquote',
  'figcaption',
  'td',
  'th',
  'dt',
  'dd',
  'pre'
].join(', ');

function normalizeExtractedText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function getReadableTextFromElement(element) {
  return normalizeExtractedText(element.innerText || element.textContent || '');
}

function hasReadableAncestor(element, container) {
  const ancestor = element.parentElement?.closest(PRIMARY_READABLE_SELECTOR);
  return Boolean(ancestor && ancestor !== element && container.contains(ancestor));
}

function extractReadableElements() {
  const container = findContentContainer();
  const elements = [];
  const candidates = container.querySelectorAll(PRIMARY_READABLE_SELECTOR);

  for (const element of candidates) {
    if (hasReadableAncestor(element, container)) continue;

    // Skip if inside an excluded parent
    let parent = element.parentElement;
    let excluded = false;
    while (parent && parent !== container) {
      if (isExcludedElement(parent)) {
        excluded = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (excluded) continue;

    // Skip if element itself is excluded
    if (isExcludedElement(element)) continue;

    // Skip if not visible
    if (!isVisible(element)) continue;

    const text = getReadableTextFromElement(element);

    // Skip empty or very short elements
    if (text.length < 10) continue;

    elements.push({
      element: element,
      text: text
    });
  }

  return elements;
}

/**
 * Extract the main readable content from the page (legacy, for text-only extraction)
 * Uses various heuristics to find the main article/content area
 */
function extractMainContent() {
  const elements = extractReadableElements();
  const texts = elements.map((e) => e.text);

  // Prepend title
  const title = getPageTitle();
  if (title) {
    texts.unshift(title);
  }

  return texts.join('\n\n');
}

/**
 * Get page title
 */
function getPageTitle() {
  return document.title || '';
}

/**
 * Get a normalized URL for position storage (remove hash and query params)
 */
function getNormalizedUrl() {
  const url = new URL(window.location.href);
  return url.origin + url.pathname;
}

/**
 * Save reading position to chrome storage
 */
function saveReadingPosition(paragraphIndex, total) {
  const url = getNormalizedUrl();
  chrome.storage.local.get('readingPositions', (result) => {
    const positions = result.readingPositions || {};
    positions[url] = {
      index: paragraphIndex,
      total: total,
      timestamp: Date.now()
    };
    chrome.storage.local.set({ readingPositions: positions });
  });
}

/**
 * Clear reading position for current URL
 */
function clearReadingPosition() {
  const url = getNormalizedUrl();
  chrome.storage.local.get('readingPositions', (result) => {
    const positions = result.readingPositions || {};
    delete positions[url];
    chrome.storage.local.set({ readingPositions: positions });
  });
}

/**
 * Send message to popup/background
 */
function notifyExtension(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Extension context might be invalid, ignore
  });
}

/**
 * Play audio from blob using Web Audio API to bypass CSP restrictions
 * Also accepts an optional onTimeUpdate callback for prefetch timing
 */
async function playAudioBlob(audioBlob, onReadyToPrefetch) {
  return new Promise((resolve, reject) => {
    (async () => {
      if (shouldStop) {
        resolve({ stopped: true });
        return;
      }

      try {
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio();
        audio.src = audioUrl;
        audio.preload = 'auto';
        audio.playbackRate = playbackSpeed;
        audio.preservesPitch = true;
        audio.mozPreservesPitch = true;
        audio.webkitPreservesPitch = true;

        currentAudioElement = audio;
        currentAudioUrl = audioUrl;

        let prefetchTimer = null;
        let settled = false;

        const cleanup = () => {
          if (prefetchTimer) {
            clearTimeout(prefetchTimer);
          }
          if (currentAudioUrl === audioUrl) {
            currentAudioUrl = null;
          }
          if (currentAudioElement === audio) {
            currentAudioElement = null;
          }
          URL.revokeObjectURL(audioUrl);
        };

        const settle = (result) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(result);
        };

        const fail = (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };

        const setupPrefetchTimer = () => {
          if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
          const prefetchTime = (audio.duration / playbackSpeed) * 0.7 * 1000;
          prefetchTimer = setTimeout(() => {
            if (onReadyToPrefetch) {
              onReadyToPrefetch();
            }
          }, prefetchTime);
        };

        audio.addEventListener('loadedmetadata', setupPrefetchTimer, {
          once: true
        });

        // Handle completion
        audio.onended = () => {
          if (!shouldStop) {
            settle({ stopped: false });
          }
        };

        audio.onpause = () => {
          if (shouldStop) {
            settle({ stopped: true });
          }
        };

        audio.onerror = () => {
          fail(new Error('Audio playback failed'));
        };

        // Start playback
        getAudioContext();
        await audio.play();
      } catch (error) {
        reject(error);
      }
    })();
  });
}

/**
 * Synthesize a single paragraph - returns a promise for the audio blob
 */
async function synthesizeParagraph(text, voice, settings = {}) {
  const response = await fetch(`${SERVER_URL}/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildSynthesisPayload(text, voice, settings))
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Server error');
  }

  return await response.blob();
}

/**
 * Stream-first playback for one paragraph, with fallback to /synthesize
 */
async function playParagraphStreamFirst(text, voice, settings = {}) {
  const normalizedSettings = normalizeSynthesisSettings(settings);
  if (normalizedSettings.realtimeStreamingDecode) {
    const abortController = new AbortController();
    mainStreamAbortController = abortController;
    try {
      return await playRealtimeAudioStream(
        text,
        voice,
        playbackSpeed,
        normalizedSettings,
        abortController,
        () => !shouldStop
      );
    } catch (streamError) {
      if (streamError.name !== 'AbortError' && !streamError.playedAnyAudio) {
        console.warn('Realtime paragraph streaming failed; falling back to /synthesize:', streamError);
        const fallbackBlob = await synthesizeParagraph(text, voice, normalizedSettings);
        if (shouldStop) {
          return { stopped: true };
        }
        return await playAudioBlob(fallbackBlob);
      }
      if (streamError.name !== 'AbortError') {
        throw streamError;
      }
      return { stopped: true };
    } finally {
      if (mainStreamAbortController === abortController) {
        mainStreamAbortController = null;
      }
    }
  }

  const chunkQueue = [];
  let streamComplete = false;
  let streamError = null;
  let queueResolver = null;
  let hasPlayedAnyStreamChunk = false;
  const abortController = new AbortController();
  mainStreamAbortController = abortController;

  const enqueueChunk = (chunkBlob) => {
    if (queueResolver) {
      const resolve = queueResolver;
      queueResolver = null;
      resolve(chunkBlob);
    } else {
      chunkQueue.push(chunkBlob);
    }
  };

  const finishQueue = () => {
    streamComplete = true;
    if (queueResolver) {
      const resolve = queueResolver;
      queueResolver = null;
      resolve(null);
    }
  };

  const getNextChunk = async () => {
    if (chunkQueue.length > 0) {
      return chunkQueue.shift();
    }
    if (streamComplete) {
      return null;
    }
    return new Promise((resolve) => {
      queueResolver = resolve;
    });
  };

  const streamTask = streamSelectionAudio(text, voice, normalizedSettings, enqueueChunk, abortController.signal)
    .catch((error) => {
      streamError = error;
    })
    .finally(() => {
      finishQueue();
    });

  try {
    while (!shouldStop) {
      const nextChunk = await getNextChunk();
      if (!nextChunk) break;

      try {
        const playResult = await playAudioBlob(nextChunk);
        if (playResult.stopped || shouldStop) {
          break;
        }
        hasPlayedAnyStreamChunk = true;
      } catch (playbackError) {
        if (!hasPlayedAnyStreamChunk) {
          streamError = playbackError;
          break;
        }
        throw playbackError;
      }
    }

    await streamTask;

    if (streamError && streamError.name !== 'AbortError') {
      if (!hasPlayedAnyStreamChunk) {
        console.warn('Paragraph streaming failed before playback; falling back to /synthesize:', streamError);
        const fallbackBlob = await synthesizeParagraph(text, voice, normalizedSettings);

        if (shouldStop) {
          return { stopped: true };
        }

        return await playAudioBlob(fallbackBlob);
      }
      throw streamError;
    }

    return { stopped: shouldStop };
  } finally {
    if (mainStreamAbortController === abortController) {
      mainStreamAbortController = null;
    }
  }
}

/**
 * Get paragraphs from server
 */
async function getParagraphs(text) {
  const response = await fetch(`${SERVER_URL}/paragraphs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    throw new Error('Failed to split text into paragraphs');
  }

  const data = await response.json();
  return data.paragraphs;
}

/**
 * Read paragraphs with streaming-first playback, starting from a specific index
 * @param {Array} paragraphs - Array of paragraph texts OR objects with {text, elementIndex}
 * @param {string} voice - Voice to use
 * @param {number} startIndex - Index to start reading from (0-based)
 * @param {number} speed - Playback speed multiplier
 * @param {boolean} useHighlighting - Whether to highlight elements during reading
 */
async function readParagraphsFromIndex(
  paragraphs,
  voice,
  startIndex = 0,
  speed = 1.0,
  useHighlighting = false,
  settings = {}
) {
  shouldStop = false;
  isPaused = false;
  const synthesisSettings = normalizeSynthesisSettings(settings);
  playbackSpeed = resolveEffectivePlaybackSpeed(speed, synthesisSettings);
  totalParagraphs = paragraphs.length;
  currentParagraphIndex = startIndex;

  // Inject highlight styles if we're using highlighting
  if (useHighlighting) {
    injectHighlightStyles();
  }

  const total = paragraphs.length;
  const remaining = total - startIndex;

  try {
    notifyExtension({
      action: 'progress',
      percent: 10,
      text: `Reading from paragraph ${startIndex + 1}/${total}...`
    });

    // Get text from paragraph (handles both string and object formats)
    const getText = (para) => (typeof para === 'string' ? para : para.text);

    // Get element for highlighting
    const getElement = (para) => {
      if (typeof para === 'object' && para.elementIndex !== undefined) {
        return readableElements[para.elementIndex]?.element;
      }
      return null;
    };

    for (let i = startIndex; i < paragraphs.length; i++) {
      if (shouldStop) break;

      currentParagraphIndex = i;

      const progressPercent = 10 + Math.floor(((i - startIndex) / remaining) * 80);

      notifyExtension({
        action: 'progress',
        percent: progressPercent,
        text: `Generating ${i + 1}/${total}...`
      });

      if (shouldStop) break;

      // Highlight the current element if available
      if (useHighlighting) {
        const element = getElement(paragraphs[i]);
        if (element) {
          highlightElement(element);
        }
      }

      // Notify that we're playing and save position
      notifyExtension({
        action: 'playing',
        current: i + 1,
        total: total
      });

      // Save current position for this URL
      saveReadingPosition(i, total);

      // Stream paragraph chunks as they arrive, with fallback to /synthesize.
      const result = await playParagraphStreamFirst(getText(paragraphs[i]), voice, synthesisSettings);

      if (result.stopped || shouldStop) break;
    }

    // Remove highlight when done
    removeHighlight();

    if (!shouldStop) {
      // Clear saved position when finished
      clearReadingPosition();
      notifyExtension({ action: 'complete' });
    }
  } catch (error) {
    removeHighlight();
    console.error('TTS error:', error);
    notifyExtension({ action: 'error', text: error.message });
  }
}

/**
 * Process and read text - extracts paragraphs first
 */
async function readText(text, voice, speed = 1.0, settings = {}) {
  shouldStop = false;
  isPaused = false;
  playbackSpeed = resolveEffectivePlaybackSpeed(speed, settings);

  try {
    notifyExtension({
      action: 'progress',
      percent: 5,
      text: 'Splitting into paragraphs...'
    });

    const paragraphs = await getParagraphs(text);

    if (shouldStop) return;

    await readParagraphsFromIndex(paragraphs, voice, 0, speed, false, settings);
  } catch (error) {
    console.error('TTS error:', error);
    notifyExtension({ action: 'error', text: error.message });
  }
}

/**
 * Stop audio playback
 */
function stopPlayback() {
  shouldStop = true;
  isPaused = false;

  if (mainStreamAbortController) {
    mainStreamAbortController.abort();
    mainStreamAbortController = null;
  }

  const audioElement = currentAudioElement;
  const audioUrl = currentAudioUrl;
  currentAudioElement = null;
  currentAudioUrl = null;

  if (audioElement) {
    try {
      audioElement.pause();
      audioElement.currentTime = 0;
    } catch (e) {
      // Ignore
    }
  }
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl);
  }

  if (hasRealtimePlayback()) {
    resetRealtimeSession();
  }
  resetAudioContext();

  // Remove highlight
  removeHighlight();

  notifyExtension({ action: 'stopped' });
}

/**
 * Pause audio playback
 */
function pausePlayback() {
  if (hasRealtimePlayback() && audioContext && !isPaused) {
    audioContext.suspend().catch(() => {});
    isPaused = true;
    notifyExtension({ action: 'paused' });
    return;
  }
  if (currentAudioElement && !isPaused) {
    try {
      currentAudioElement.pause();
    } catch (e) {
      // Ignore
    }
    isPaused = true;
    notifyExtension({ action: 'paused' });
  }
}

/**
 * Resume audio playback
 */
async function resumePlayback() {
  if (hasRealtimePlayback() && audioContext && isPaused) {
    try {
      await audioContext.resume();
      isPaused = false;
      notifyExtension({ action: 'resumed' });
    } catch (error) {
      console.error('Resume playback error:', error);
      notifyExtension({ action: 'error', text: 'Failed to resume playback' });
    }
    return;
  }
  if (isPaused && currentAudioElement) {
    try {
      currentAudioElement.playbackRate = playbackSpeed;
      await currentAudioElement.play();
      isPaused = false;
      notifyExtension({ action: 'resumed' });
    } catch (error) {
      console.error('Resume playback error:', error);
      notifyExtension({ action: 'error', text: 'Failed to resume playback' });
    }
  }
}

/**
 * Stop selection reading
 */
function stopSelectionReading() {
  isReadingSelection = false;

  if (selectionStreamAbortController) {
    selectionStreamAbortController.abort();
    selectionStreamAbortController = null;
  }

  if (selectionAudioElement) {
    try {
      selectionAudioElement.pause();
      selectionAudioElement.currentTime = 0;
    } catch (e) {
      // Source might already be stopped
    }
    selectionAudioElement = null;
  }

  if (selectionAudioUrl) {
    URL.revokeObjectURL(selectionAudioUrl);
    selectionAudioUrl = null;
  }

  if (hasRealtimePlayback()) {
    resetRealtimeSession();
  }
  resetAudioContext();
}

/**
 * Decode base64 audio into a Blob
 */
function base64ToAudioBlob(base64Audio) {
  const binaryString = atob(base64Audio);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

/**
 * Play one selection chunk and resolve when finished
 */
async function playSelectionChunk(audioBlob, speed) {
  return new Promise((resolve, reject) => {
    (async () => {
      if (!isReadingSelection) {
        resolve({ stopped: true });
        return;
      }

      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio();
      audio.src = audioUrl;
      audio.preload = 'auto';
      audio.playbackRate = speed;
      audio.preservesPitch = true;
      audio.mozPreservesPitch = true;
      audio.webkitPreservesPitch = true;

      selectionAudioElement = audio;
      selectionAudioUrl = audioUrl;

      let settled = false;
      const cleanup = () => {
        if (selectionAudioElement === audio) {
          selectionAudioElement = null;
        }
        if (selectionAudioUrl === audioUrl) {
          selectionAudioUrl = null;
        }
        URL.revokeObjectURL(audioUrl);
      };

      const settle = (result) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      audio.onended = () => settle({ stopped: false });
      audio.onpause = () => {
        if (!isReadingSelection) {
          settle({ stopped: true });
        }
      };
      audio.onerror = () => {
        const mediaError = audio.error;
        const code = mediaError ? mediaError.code : 'unknown';
        fail(new Error(`Selection audio playback failed (code: ${code})`));
      };

      try {
        await audio.play();
      } catch (error) {
        fail(error);
      }
    })().catch((error) => reject(error));
  });
}

/**
 * Stream synthesized selection audio chunks from server
 */
async function streamSelectionAudio(text, voice, settings, onChunk, abortSignal) {
  const response = await fetch(`${SERVER_URL}/synthesize-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildSynthesisPayload(text, voice, settings)),
    signal: abortSignal
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Streaming synthesis failed');
  }

  if (!response.body) {
    throw new Error('Streaming response is not supported by this browser');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleLine = (line) => {
    if (!line) return;

    const payload = JSON.parse(line);
    if (payload.type === 'chunk' && payload.audio) {
      onChunk(base64ToAudioBlob(payload.audio));
      return;
    }

    if (payload.type === 'error') {
      throw new Error(payload.error || 'Streaming synthesis failed');
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      handleLine(line);
      newlineIndex = buffer.indexOf('\n');
    }
  }

  buffer += decoder.decode();
  const trailingLine = buffer.trim();
  if (trailingLine) {
    handleLine(trailingLine);
  }
}

/**
 * Speak selected text using context menu
 */
async function speakSelection(voice, speed, settings = {}) {
  let selectedText = '';
  let hasPlayedAnyStreamChunk = false;
  const synthesisSettings = normalizeSynthesisSettings(settings);
  const effectivePlaybackSpeed = resolveEffectivePlaybackSpeed(speed, synthesisSettings);

  try {
    // Get selected text
    selectedText = window.getSelection().toString().trim();

    if (!selectedText) {
      alert('No text selected');
      return;
    }

    // Stop any previous selection audio
    stopSelectionReading();

    isReadingSelection = true;

    selectionStreamAbortController = new AbortController();

    if (synthesisSettings.realtimeStreamingDecode) {
      try {
        await playRealtimeAudioStream(
          selectedText,
          voice,
          effectivePlaybackSpeed,
          synthesisSettings,
          selectionStreamAbortController,
          () => isReadingSelection
        );
        return;
      } catch (error) {
        if (error.name !== 'AbortError' && !error.playedAnyAudio) {
          console.warn('Realtime selection streaming failed; falling back to chunked selection stream:', error);
        } else if (error.name === 'AbortError') {
          return;
        } else {
          throw error;
        }
      }
    }

    // Async queue of chunks as they stream in.
    const chunkQueue = [];
    let streamComplete = false;
    let streamError = null;
    let queueResolver = null;

    const enqueueChunk = (chunkBlob) => {
      if (queueResolver) {
        const resolve = queueResolver;
        queueResolver = null;
        resolve(chunkBlob);
      } else {
        chunkQueue.push(chunkBlob);
      }
    };

    const finishQueue = () => {
      streamComplete = true;
      if (queueResolver) {
        const resolve = queueResolver;
        queueResolver = null;
        resolve(null);
      }
    };

    const getNextChunk = async () => {
      if (chunkQueue.length > 0) {
        return chunkQueue.shift();
      }
      if (streamComplete) {
        return null;
      }
      return new Promise((resolve) => {
        queueResolver = resolve;
      });
    };

    const streamTask = streamSelectionAudio(
      selectedText,
      voice,
      synthesisSettings,
      enqueueChunk,
      selectionStreamAbortController.signal
    )
      .catch((error) => {
        streamError = error;
      })
      .finally(() => {
        finishQueue();
      });

    while (isReadingSelection) {
      const nextChunk = await getNextChunk();

      if (!nextChunk) {
        break;
      }

      try {
        const playResult = await playSelectionChunk(nextChunk, effectivePlaybackSpeed);
        if (playResult.stopped) {
          break;
        }
        hasPlayedAnyStreamChunk = true;
      } catch (playbackError) {
        if (!hasPlayedAnyStreamChunk) {
          // If we fail before any stream audio played, use full synth fallback.
          streamError = playbackError;
          break;
        }

        // Skip failed chunks once streaming playback has already started.
        console.warn('Selection chunk playback failed, skipping chunk:', playbackError);
      }
    }

    await streamTask;

    if (streamError && streamError.name !== 'AbortError') {
      if (!hasPlayedAnyStreamChunk) {
        console.warn('Selection streaming failed before playback; falling back to /synthesize:', streamError);
        const fallbackBlob = await synthesizeParagraph(selectedText, voice, synthesisSettings);

        if (!isReadingSelection) {
          return;
        }

        await playSelectionChunk(fallbackBlob, effectivePlaybackSpeed);
        return;
      }

      throw streamError;
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      return;
    }

    console.error('Error speaking selection:', error);

    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      alert('Could not connect to TTS server. Make sure the server is running at http://localhost:5050');
    } else {
      alert('Error: ' + error.message);
    }
  } finally {
    isReadingSelection = false;
    if (selectionStreamAbortController) {
      selectionStreamAbortController = null;
    }
  }
}

/**
 * Listen for messages from popup or background
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractContent') {
    try {
      const text = extractMainContent();
      const title = getPageTitle();

      // Prepend title if available
      const fullText = title ? `${title}. ${text}` : text;

      sendResponse({
        success: true,
        text: fullText,
        title: title,
        url: window.location.href,
        length: fullText.length
      });
    } catch (error) {
      console.error('Error extracting content:', error);
      sendResponse({
        success: false,
        error: error.message
      });
    }
  } else if (message.action === 'scanElements') {
    // Extract readable elements and store references for highlighting
    try {
      readableElements = extractReadableElements();

      // Return just the text for each element (we keep element refs locally)
      const paragraphs = readableElements.map((item, index) => ({
        text: item.text,
        elementIndex: index
      }));

      sendResponse({
        success: true,
        paragraphs: paragraphs,
        count: paragraphs.length
      });
    } catch (error) {
      console.error('Error scanning elements:', error);
      sendResponse({
        success: false,
        error: error.message
      });
    }
  } else if (message.action === 'readText') {
    // Read text from the beginning (extracts paragraphs internally)
    readText(message.text, message.voice, message.speed || 1.0, message.settings || {});
    sendResponse({ status: 'started' });
  } else if (message.action === 'readParagraphs') {
    // Read pre-scanned paragraphs from a specific index
    // Check if paragraphs have elementIndex (for highlighting)
    const useHighlighting =
      message.paragraphs.length > 0 &&
      typeof message.paragraphs[0] === 'object' &&
      message.paragraphs[0].elementIndex !== undefined;
    readParagraphsFromIndex(
      message.paragraphs,
      message.voice,
      message.startIndex || 0,
      message.speed || 1.0,
      useHighlighting,
      message.settings || {}
    );
    sendResponse({ status: 'started' });
  } else if (message.action === 'stop') {
    stopPlayback();
    sendResponse({ status: 'stopped' });
  } else if (message.action === 'pause') {
    pausePlayback();
    sendResponse({ status: 'paused' });
  } else if (message.action === 'resume') {
    resumePlayback();
    sendResponse({ status: 'resumed' });
  } else if (message.action === 'setSpeed') {
    playbackSpeed = message.speed;
    if (currentAudioElement) {
      currentAudioElement.playbackRate = playbackSpeed;
    }
    sendResponse({ status: 'speed_set', speed: playbackSpeed });
  } else if (message.action === 'getPlaybackState') {
    sendResponse({
      isPlaying: (currentAudioElement !== null || hasRealtimePlayback()) && !isPaused,
      isPaused: isPaused,
      isStopped: currentAudioElement === null && !hasRealtimePlayback()
    });
  } else if (message.action === 'getSavedPosition') {
    const url = getNormalizedUrl();
    chrome.storage.local.get('readingPositions', (result) => {
      const positions = result.readingPositions || {};
      sendResponse(positions[url] || null);
    });
    return true; // Async response
  } else if (message.action === 'clearSavedPosition') {
    clearReadingPosition();
    sendResponse({ status: 'cleared' });
  } else if (message.action === 'speakSelection') {
    speakSelection(message.voice, message.speed, message.settings || {});
    sendResponse({ status: 'started' });
  }

  // Return true to indicate async response
  return true;
});

// Log that content script is loaded
console.log('Nano Reader content script loaded');
