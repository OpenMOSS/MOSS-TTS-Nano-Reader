/**
 * Nano Reader - Popup Script
 * Handles UI interactions and communication with content script
 */

const DEFAULT_SERVER_CONFIG = {
  host: 'localhost',
  port: 5050
};
const DEFAULT_BROWSER_MODEL_VARIANT = 'fp32';
const CONTENT_SCRIPT_BUILD_ID = '2026-04-16-browser-onnx-normalize-1';
const SAMPLE_MODE_GREEDY = 'greedy';
const SAMPLE_MODE_FIXED = 'fixed';
const SAMPLE_MODE_FULL = 'full';
const DEFAULT_BROWSER_MODEL_RELATIVE_PATHS = {
  fp32: 'models'
};
const DEFAULT_BACKEND_CONFIG = {
  backend: 'browser_onnx',
  browserModelVariant: DEFAULT_BROWSER_MODEL_VARIANT,
  browserModelPath: DEFAULT_BROWSER_MODEL_RELATIVE_PATHS[DEFAULT_BROWSER_MODEL_VARIANT]
};
const EXTERNAL_BROWSER_MODEL_KEY = 'browser-onnx-external';

// DOM Elements
const serverStatus = document.getElementById('server-status');
const backendSelect = document.getElementById('backend-select');
const browserModelProfileSelect = document.getElementById('browser-model-profile');
const browserModelPathInput = document.getElementById('browser-model-path');
const btnApplyBackendConfig = document.getElementById('btn-apply-backend-config');
const btnPrepareBrowserBackend = document.getElementById('btn-prepare-browser-backend');
const serverHostSelect = document.getElementById('server-host');
const serverPortInput = document.getElementById('server-port');
const btnApplyServerConfig = document.getElementById('btn-apply-server-config');
const btnResetServerConfig = document.getElementById('btn-reset-server-config');
const btnOpenBrowserPoc = document.getElementById('btn-open-browser-poc');
const voiceSelect = document.getElementById('voice-select');
const btnReloadVoices = document.getElementById('btn-reload-voices');
const btnToggleAddVoice = document.getElementById('btn-toggle-add-voice');
const addVoicePanel = document.getElementById('add-voice-panel');
const newVoiceNameInput = document.getElementById('new-voice-name');
const newVoiceGroupSelect = document.getElementById('new-voice-group-select');
const newVoiceGroupCustomInput = document.getElementById('new-voice-group-custom');
const newVoiceFileInput = document.getElementById('new-voice-file');
const btnSaveVoice = document.getElementById('btn-save-voice');
const btnCancelAddVoice = document.getElementById('btn-cancel-add-voice');
const playbackSpeedGroup = document.getElementById('playback-speed-group');
const speedControl = document.getElementById('speed-control');
const speedValue = document.getElementById('speed-value');
const startPosition = document.getElementById('start-position');
const nowReadingValue = document.getElementById('now-reading-value');
const preparedTextMeta = document.getElementById('prepared-text-meta');
const preparedTextValue = document.getElementById('prepared-text-value');
const readingTimeEl = document.getElementById('reading-time');
const readingTimeValue = document.getElementById('reading-time-value');
const btnScan = document.getElementById('btn-scan');
const btnRead = document.getElementById('btn-read');
const btnPause = document.getElementById('btn-pause');
const btnStop = document.getElementById('btn-stop');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const messageEl = document.getElementById('message');
const sampleModeSelect = document.getElementById('sample-mode');
const realtimeStreamingDecodeToggle = document.getElementById('realtime-streaming-decode');
const enableWeTextProcessingToggle = document.getElementById('wetext-processing-enabled');
const enableNormalizeTtsTextToggle = document.getElementById('normalize-tts-text-enabled');
const initialPlaybackDelayInput = document.getElementById('initial-playback-delay');
const cpuThreadsInput = document.getElementById('cpu-threads');
const attnImplementationSelect = document.getElementById('attn-implementation');
const voiceCloneMaxTextTokensInput = document.getElementById('voice-clone-max-text-tokens');
const ttsMaxBatchSizeInput = document.getElementById('tts-max-batch-size');
const codecMaxBatchSizeInput = document.getElementById('codec-max-batch-size');
const CUSTOM_GROUP_OPTION = '__custom__';

const DEFAULT_TTS_SETTINGS = {
  sampleMode: SAMPLE_MODE_FIXED,
  doSample: true,
  realtimeStreamingDecode: true,
  enableWeTextProcessing: true,
  enableNormalizeTtsText: true,
  initialPlaybackDelaySeconds: 0.08,
  executionDevice: 'cpu',
  cpuThreads: 4,
  attnImplementation: 'model_default',
  voiceCloneMaxTextTokens: 75,
  ttsMaxBatchSize: 1,
  codecMaxBatchSize: 0
};

// State
let isPlaying = false;
let isPaused = false;
let serverConnected = false;
let currentTabId = null;
let scannedParagraphs = [];
let availableVoiceGroups = [];
let popupBrowserRuntimeModulePromise = null;
let popupBrowserRuntime = null;

function normalizeSampleMode(rawSampleMode, rawDoSample = true) {
  const normalized = String(rawSampleMode || '').trim();
  if ([SAMPLE_MODE_FIXED, SAMPLE_MODE_FULL].includes(normalized)) {
    return normalized;
  }
  if (normalized === 'greedy' || normalized === 'mixed3') {
    return SAMPLE_MODE_FIXED;
  }
  return SAMPLE_MODE_FIXED;
}

const FALLBACK_VOICE_GROUPS = [
  {
    label: 'Chinese Male',
    voices: ['Junhao', 'Zhiming', 'Weiguo']
  },
  {
    label: 'Chinese Female',
    voices: ['Xiaoyu', 'Yuewen', 'Lingyu']
  },
  {
    label: 'English',
    voices: ['Trump', 'Ava', 'Bella', 'Adam', 'Nathan']
  },
  {
    label: 'Japanese Female',
    voices: ['Sakura', 'Yui', 'Aoi', 'Hina', 'Mei']
  }
];

function normalizeServerConfig(rawConfig = {}) {
  const normalizedHost = String(rawConfig?.host || '').trim() === '127.0.0.1'
    ? '127.0.0.1'
    : DEFAULT_SERVER_CONFIG.host;
  const parsedPort = parseInt(rawConfig?.port, 10);
  const normalizedPort = Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535
    ? parsedPort
    : DEFAULT_SERVER_CONFIG.port;
  return {
    host: normalizedHost,
    port: normalizedPort
  };
}

function getDefaultBrowserModelRelativePath(modelVariant = DEFAULT_BROWSER_MODEL_VARIANT) {
  return DEFAULT_BROWSER_MODEL_RELATIVE_PATHS[modelVariant] || DEFAULT_BROWSER_MODEL_RELATIVE_PATHS[DEFAULT_BROWSER_MODEL_VARIANT];
}

function normalizeBrowserModelVariant(rawVariant, rawPath = '') {
  const trimmedVariant = String(rawVariant || '').trim();
  if (trimmedVariant === 'fp32') {
    return trimmedVariant;
  }
  return DEFAULT_BROWSER_MODEL_VARIANT;
}

function isAbsoluteFileSystemPath(pathValue) {
  const normalized = String(pathValue || '').trim();
  return /^[A-Za-z]:[\\/]/.test(normalized) || normalized.startsWith('\\\\') || normalized.startsWith('/');
}

function isResourceUrl(pathValue) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(String(pathValue || '').trim());
}

function normalizePackagedModelPath(pathValue) {
  const parts = String(pathValue || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean);
  const resolvedParts = [];
  for (const part of parts) {
    if (part === '.') {
      continue;
    }
    if (part === '..') {
      if (resolvedParts.length > 0) {
        resolvedParts.pop();
      }
      continue;
    }
    resolvedParts.push(part);
  }
  return resolvedParts.join('/');
}

function normalizeStoredBrowserModelPath(rawPath = '') {
  const normalizedPath = String(rawPath || '').trim();
  const lowered = normalizedPath.replace(/\\/g, '/').toLowerCase();
  if (
    lowered === 'models/browser_onnx_poc_dynamic_int8'
    || lowered.endsWith('/models/browser_onnx_poc_dynamic_int8')
  ) {
    return DEFAULT_BROWSER_MODEL_RELATIVE_PATHS.fp32;
  }
  if (lowered === 'models/browser_onnx_poc' || lowered.endsWith('/models/browser_onnx_poc')) {
    return DEFAULT_BROWSER_MODEL_RELATIVE_PATHS.fp32;
  }
  if (
    lowered === 'models/moss-tts-nano-100m-onnx'
    || lowered === 'models/moss-audio-tokenizer-nano-onnx'
  ) {
    return DEFAULT_BROWSER_MODEL_RELATIVE_PATHS.fp32;
  }
  return normalizedPath;
}

function resolveBrowserModelPath(browserModelPath) {
  const normalizedPath = String(browserModelPath || '').trim();
  if (!normalizedPath) {
    return '';
  }
  if (isResourceUrl(normalizedPath)) {
    return normalizedPath.replace(/\/+$/, '');
  }
  if (isAbsoluteFileSystemPath(normalizedPath)) {
    return normalizedPath.replace(/[\\/]+$/, '');
  }
  const packagedPath = normalizePackagedModelPath(normalizedPath);
  return chrome.runtime.getURL(packagedPath).replace(/\/+$/, '');
}

function normalizeBackendConfig(rawConfig = {}) {
  const normalizedBackend = String(rawConfig?.backend || DEFAULT_BACKEND_CONFIG.backend).trim() === 'server'
    ? 'server'
    : 'browser_onnx';
  const normalizedBrowserModelVariant = normalizeBrowserModelVariant(
    rawConfig?.browserModelVariant,
    normalizeStoredBrowserModelPath(rawConfig?.browserModelPath)
  );
  const normalizedBrowserModelPath = String(
    normalizeStoredBrowserModelPath(rawConfig?.browserModelPath)
      || getDefaultBrowserModelRelativePath(normalizedBrowserModelVariant) || ''
  ).trim();
  return {
    backend: normalizedBackend,
    browserModelVariant: normalizedBrowserModelVariant,
    browserModelPath: normalizedBrowserModelPath
  };
}

function getBrowserModelStore() {
  const store = globalThis.NanoReaderBrowserModelStore || null;
  if (!store) {
    throw new Error('Browser model store helper is not available in this extension build.');
  }
  return store;
}

function isDefaultPackagedBrowserModelPath(pathValue = '') {
  const normalized = normalizeStoredBrowserModelPath(pathValue);
  return normalized === DEFAULT_BROWSER_MODEL_RELATIVE_PATHS[DEFAULT_BROWSER_MODEL_VARIANT];
}

async function packagedBrowserModelExists(pathValue = '') {
  if (!isDefaultPackagedBrowserModelPath(pathValue)) {
    return true;
  }
  const manifestUrl = chrome.runtime.getURL(
    'models/MOSS-TTS-Nano-100M-ONNX/browser_poc_manifest.json'
  );
  try {
    const response = await fetch(manifestUrl, { cache: 'no-store' });
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function maybeProvisionExternalBrowserModel(backendConfig) {
  const normalized = normalizeBackendConfig(backendConfig);
  if (normalized.backend !== 'browser_onnx') {
    return normalized;
  }
  if (!isDefaultPackagedBrowserModelPath(normalized.browserModelPath)) {
    return normalized;
  }
  if (await packagedBrowserModelExists(normalized.browserModelPath)) {
    return normalized;
  }

  const store = getBrowserModelStore();
  const progressHandler = (progress) => {
    const message = String(progress?.message || 'Downloading browser_onnx models...').trim();
    setServerStatus('checking', message);
    if (progress?.phase === 'download' && Number.isFinite(progress?.fileIndex) && Number.isFinite(progress?.fileCount)) {
      btnPrepareBrowserBackend.textContent = `Downloading ${progress.fileIndex}/${progress.fileCount}`;
    }
  };

  let accessToken = normalizeMetadataText((await chrome.storage.local.get('huggingFaceToken')).huggingFaceToken);
  let result;
  try {
    result = await store.ensureExternalBrowserOnnxModels({
      key: EXTERNAL_BROWSER_MODEL_KEY,
      accessToken,
      onProgress: progressHandler
    });
  } catch (error) {
    const message = error?.message || String(error);
    if (!/status=401|invalid username or password/i.test(message)) {
      throw error;
    }
    const promptedToken = normalizeMetadataText(
      globalThis.prompt(
        'The configured Hugging Face ONNX repos currently require access authentication. Paste a Hugging Face token to continue downloading:',
        accessToken || ''
      ) || ''
    );
    if (!promptedToken) {
      throw new Error('A Hugging Face access token is required to download the browser_onnx model repositories.');
    }
    accessToken = promptedToken;
    await chrome.storage.local.set({ huggingFaceToken: accessToken });
    result = await store.ensureExternalBrowserOnnxModels({
      key: EXTERNAL_BROWSER_MODEL_KEY,
      accessToken,
      onProgress: progressHandler,
      forceDownload: true
    });
  }

  const nextBackendConfig = await persistBackendConfig({
    ...normalized,
    browserModelPath: result.managedPath
  });
  applyBackendConfigToUi(nextBackendConfig);
  showMessage(
    'success',
    result.downloaded
      ? `Downloaded browser_onnx models into browser-managed storage "${result.label}" and switched to it.`
      : `Using existing browser-managed browser_onnx models "${result.label}".`
  );
  return nextBackendConfig;
}

function setBrowserBackendActionAvailability(enabled) {
  btnRead.disabled = !enabled;
  btnScan.disabled = !enabled;
  btnReloadVoices.disabled = !enabled;
  btnToggleAddVoice.disabled = !enabled;
}

async function ensureBrowserOnnxReadyForUserAction({ prepareInActiveTab = false } = {}) {
  let backendConfig = await persistBackendConfig(getBackendConfigFromUi());
  if (backendConfig.backend !== 'browser_onnx') {
    throw new Error('Switch backend to browser_onnx first');
  }

  const ttsSettings = getTtsSettingsFromUi();
  backendConfig = await maybeProvisionExternalBrowserModel(backendConfig);
  applyBackendConfigToUi(backendConfig);

  const statusOk = await checkBrowserBackendStatus(backendConfig, ttsSettings);
  if (!statusOk) {
    throw new Error('Browser ONNX assets are not ready');
  }

  let tab = null;
  if (prepareInActiveTab) {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error('No active tab found');
    }
    currentTabId = tab.id;
    await ensureContentScriptReady(tab);

    const response = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, {
        action: 'prepareBrowserOnnx',
        settings: ttsSettings
      }, (payload) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Failed to prepare browser_onnx in active tab'));
          return;
        }
        resolve(payload || {});
      });
    });

    if (response.status !== 'prepared') {
      throw new Error(response.error || 'Failed to prepare browser_onnx in active tab');
    }
  }

  setServerStatus('connected', prepareInActiveTab ? 'browser_onnx prepared in current tab' : 'browser_onnx ready');
  serverConnected = true;
  setBrowserBackendActionAvailability(true);
  return { backendConfig, ttsSettings, tab };
}

function isRestrictedTabUrl(url) {
  const normalizedUrl = String(url || '').trim().toLowerCase();
  return normalizedUrl.startsWith('chrome://')
    || normalizedUrl.startsWith('edge://')
    || normalizedUrl.startsWith('about:')
    || normalizedUrl.startsWith('devtools://')
    || normalizedUrl.startsWith('view-source:')
    || normalizedUrl.startsWith('chrome-extension://');
}

function getRestrictedTabMessage(url) {
  const normalizedUrl = String(url || '').trim();
  return `Cannot access this page: ${normalizedUrl || 'unknown page'}. Switch to a normal web page or local file tab first.`;
}

async function pingContentScript(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      if (response?.status !== 'ready') {
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}

async function clearStaleContentScriptGuard(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      try {
        delete globalThis.__NANO_READER_CONTENT_SCRIPT_LOADED__;
      } catch (error) {
        globalThis.__NANO_READER_CONTENT_SCRIPT_LOADED__ = false;
      }
    }
  });
}

async function ensureContentScriptReady(tab) {
  if (!tab?.id) {
    throw new Error('No active tab found');
  }
  if (isRestrictedTabUrl(tab.url)) {
    throw new Error(getRestrictedTabMessage(tab.url));
  }
  const pingResponse = await pingContentScript(tab.id);
  if (pingResponse?.status === 'ready' && pingResponse.buildId === CONTENT_SCRIPT_BUILD_ID) {
    return;
  }
  if (pingResponse?.status === 'ready' && pingResponse.buildId && pingResponse.buildId !== CONTENT_SCRIPT_BUILD_ID) {
    throw new Error('Page still has an older Nano Reader content script. Refresh the page once, then try again.');
  }
  if (pingResponse?.status === 'ready' && !pingResponse.buildId) {
    throw new Error('Page is using a legacy Nano Reader content script. Refresh the page once, then try again.');
  }

  try {
    await clearStaleContentScriptGuard(tab.id);
  } catch (error) {
    console.debug('Clear stale content-script guard skipped:', error);
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js']
  });

  if (!(await pingContentScript(tab.id))) {
    throw new Error('Could not connect to page reader script. Reload the page and try again.');
  }
}

async function resolvePlaybackTargetTab() {
  if (currentTabId) {
    try {
      const existingTab = await chrome.tabs.get(currentTabId);
      if (existingTab?.id) {
        await ensureContentScriptReady(existingTab);
        return existingTab;
      }
    } catch (error) {
      currentTabId = null;
    }
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    throw new Error('No active tab found');
  }
  await ensureContentScriptReady(activeTab);
  currentTabId = activeTab.id;
  return activeTab;
}

async function sendPlaybackAction(action) {
  const tab = await resolvePlaybackTargetTab();
  await chrome.tabs.sendMessage(tab.id, { action });
  currentTabId = tab.id;
}

function getServerBaseUrl(serverConfig = DEFAULT_SERVER_CONFIG) {
  const normalized = normalizeServerConfig(serverConfig);
  return `http://${normalized.host}:${normalized.port}`;
}

function buildServerRequestUrl(path, serverConfig = DEFAULT_SERVER_CONFIG) {
  return `${getServerBaseUrl(serverConfig)}${path}`;
}

async function loadServerConfig() {
  const { serverConfig } = await chrome.storage.local.get('serverConfig');
  return normalizeServerConfig(serverConfig);
}

async function loadBackendConfig() {
  const { backendConfig } = await chrome.storage.local.get('backendConfig');
  return normalizeBackendConfig(backendConfig);
}

async function persistServerConfig(serverConfig) {
  const normalized = normalizeServerConfig(serverConfig);
  await chrome.storage.local.set({ serverConfig: normalized });
  return normalized;
}

async function persistBackendConfig(backendConfig) {
  const normalized = normalizeBackendConfig(backendConfig);
  await chrome.storage.local.set({ backendConfig: normalized });
  return normalized;
}

function applyServerConfigToUi(serverConfig) {
  const normalized = normalizeServerConfig(serverConfig);
  serverHostSelect.value = normalized.host;
  serverPortInput.value = String(normalized.port);
}

function applyBackendConfigToUi(backendConfig) {
  const normalized = normalizeBackendConfig(backendConfig);
  backendSelect.value = normalized.backend;
  browserModelProfileSelect.value = normalized.browserModelVariant;
  browserModelPathInput.value = normalized.browserModelPath;
  syncBackendUi(normalized);
}

function getServerConfigFromUi() {
  return normalizeServerConfig({
    host: serverHostSelect.value,
    port: serverPortInput.value
  });
}

function getBackendConfigFromUi() {
  return normalizeBackendConfig({
    backend: backendSelect.value,
    browserModelVariant: browserModelProfileSelect.value,
    browserModelPath: browserModelPathInput.value
  });
}

function syncBackendUi(backendConfig = getBackendConfigFromUi()) {
  const normalized = normalizeBackendConfig(backendConfig);
  const usingServer = normalized.backend === 'server';
  document.querySelector('.server-connection-settings')?.classList.toggle('hidden', !usingServer);
  browserModelProfileSelect.disabled = usingServer;
  browserModelPathInput.disabled = usingServer;
  btnPrepareBrowserBackend.disabled = usingServer;
}

function normalizeMetadataText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeUploadedDisplayName(value) {
  const cleaned = normalizeMetadataText(value);
  if (!cleaned) {
    throw new Error('Display name is required');
  }
  if (cleaned.length > 80) {
    throw new Error('Display name must be 80 characters or fewer');
  }
  return cleaned;
}

function normalizeUploadedVoiceGroup(value) {
  const cleaned = normalizeMetadataText(value);
  if (!cleaned) {
    throw new Error('Group is required');
  }
  if (cleaned.length > 80) {
    throw new Error('Group must be 80 characters or fewer');
  }
  return cleaned;
}

function slugifyVoiceIdBase(displayName) {
  const asciiText = String(displayName)
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '');
  const slug = asciiText.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'voice';
}

function buildUniqueVoiceId(displayName, existingVoiceIds = []) {
  const normalizedExistingIds = new Set(
    Array.from(existingVoiceIds || [], (voiceId) => String(voiceId || '').trim().toLowerCase()).filter(Boolean)
  );
  const baseSlug = slugifyVoiceIdBase(displayName);
  let suffix = 1;
  while (true) {
    const candidate = `${baseSlug}-${String(suffix).padStart(3, '0')}`;
    if (!normalizedExistingIds.has(candidate.toLowerCase())) {
      return candidate;
    }
    suffix += 1;
  }
}

function normalizeBrowserVoiceRow(row) {
  if (!row || !Array.isArray(row.prompt_audio_codes) || row.prompt_audio_codes.length === 0) {
    return null;
  }
  const voice = normalizeMetadataText(row.voice || row.id || row.display_name);
  if (!voice) {
    return null;
  }
  return {
    voice,
    display_name: normalizeMetadataText(row.display_name) || voice,
    group: normalizeMetadataText(row.group),
    audio_file: normalizeMetadataText(row.audio_file),
    prompt_audio_codes: row.prompt_audio_codes
  };
}

async function getPopupBrowserRuntimeModule() {
  if (!popupBrowserRuntimeModulePromise) {
    popupBrowserRuntimeModulePromise = import(chrome.runtime.getURL('browser_onnx_runtime.js'));
  }
  return popupBrowserRuntimeModulePromise;
}

async function getPopupBrowserRuntime(ttsSettings = null, backendConfig = null) {
  const resolvedBackendConfig = backendConfig ? normalizeBackendConfig(backendConfig) : await loadBackendConfig();
  const resolvedTtsSettings = ttsSettings ? normalizeTtsSettings(ttsSettings) : normalizeTtsSettings(
    (await chrome.storage.local.get('ttsSettings')).ttsSettings
  );
  if (!resolvedBackendConfig.browserModelPath) {
    throw new Error('Browser ONNX model path is not configured.');
  }
  const runtimeModule = await getPopupBrowserRuntimeModule();
  if (!popupBrowserRuntime) {
    popupBrowserRuntime = runtimeModule.createBrowserOnnxTtsRuntime({
      logger: (message) => console.debug('[browser_onnx popup]', message)
    });
  }
  await popupBrowserRuntime.configure({
    modelPath: resolveBrowserModelPath(resolvedBackendConfig.browserModelPath),
    threadCount: resolvedTtsSettings.cpuThreads > 0
      ? resolvedTtsSettings.cpuThreads
      : (navigator.hardwareConcurrency || 4)
  });
  return popupBrowserRuntime;
}

async function loadBrowserUploadedVoices() {
  const { browserUploadedVoices } = await chrome.storage.local.get('browserUploadedVoices');
  return Array.isArray(browserUploadedVoices) ? browserUploadedVoices : [];
}

async function saveBrowserUploadedVoices(rows) {
  await chrome.storage.local.set({ browserUploadedVoices: Array.isArray(rows) ? rows : [] });
}

async function handleBackendConfigChange() {
  syncBackendUi(getBackendConfigFromUi());
}

function handleBrowserModelProfileChange() {
  const nextVariant = normalizeBrowserModelVariant(browserModelProfileSelect.value);
  browserModelPathInput.value = getDefaultBrowserModelRelativePath(nextVariant);
  syncBackendUi(getBackendConfigFromUi());
}

async function handleApplyBackendConfig() {
  const originalApplyText = btnApplyBackendConfig.textContent;
  const originalPrepareText = btnPrepareBrowserBackend.textContent;
  btnApplyBackendConfig.disabled = true;
  btnPrepareBrowserBackend.disabled = true;
  btnApplyBackendConfig.textContent = 'Applying...';

  try {
    const backendConfig = await persistBackendConfig(getBackendConfigFromUi());
    const ttsSettings = getTtsSettingsFromUi();
    applyBackendConfigToUi(backendConfig);
    await refreshBackendStatusAndVoices({
      preferredVoice: voiceSelect.value,
      backendConfig,
      ttsSettings
    });
    if (backendConfig.backend === 'browser_onnx') {
      showMessage('success', 'Switched to browser_onnx backend');
    } else {
      const serverConfig = await loadServerConfig();
      showMessage('success', `Switched to server backend: ${getServerBaseUrl(serverConfig)}`);
    }
  } catch (error) {
    console.error('Apply backend config error:', error);
    showMessage('error', error.message || 'Failed to update backend configuration');
  } finally {
    btnApplyBackendConfig.disabled = false;
    syncBackendUi(getBackendConfigFromUi());
    btnApplyBackendConfig.textContent = originalApplyText;
    btnPrepareBrowserBackend.textContent = originalPrepareText;
  }
}

async function handlePrepareBrowserBackend() {
  const originalApplyText = btnApplyBackendConfig.textContent;
  const originalPrepareText = btnPrepareBrowserBackend.textContent;
  btnApplyBackendConfig.disabled = true;
  btnPrepareBrowserBackend.disabled = true;
  btnPrepareBrowserBackend.textContent = 'Preparing...';

  try {
    const { backendConfig, ttsSettings } = await ensureBrowserOnnxReadyForUserAction({ prepareInActiveTab: true });
    await populateVoiceOptions(voiceSelect.value, null, backendConfig, ttsSettings);
    showMessage('success', 'Loaded and prepared browser_onnx backend in the current tab');
  } catch (error) {
    console.error('Prepare browser backend error:', error);
    showMessage('error', error.message || 'Failed to prepare browser_onnx backend');
  } finally {
    btnApplyBackendConfig.disabled = false;
    syncBackendUi(getBackendConfigFromUi());
    btnApplyBackendConfig.textContent = originalApplyText;
    btnPrepareBrowserBackend.textContent = originalPrepareText;
  }
}

function getFallbackVoiceGroups() {
  return FALLBACK_VOICE_GROUPS.map(({ label }) => label);
}

function uniqueNonEmptyStrings(values = []) {
  const result = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized || result.includes(normalized)) continue;
    result.push(normalized);
  }
  return result;
}

/**
 * Initialize popup
 */
async function init() {
  // Load saved voice preference
  const { voice, speed, ttsSettings, serverConfig, backendConfig } = await chrome.storage.local.get([
    'voice',
    'speed',
    'ttsSettings',
    'serverConfig',
    'backendConfig'
  ]);
  const effectiveServerConfig = normalizeServerConfig(serverConfig);
  const effectiveBackendConfig = normalizeBackendConfig(backendConfig);
  applyServerConfigToUi(effectiveServerConfig);
  applyBackendConfigToUi(effectiveBackendConfig);
  setPreparedTextPlaceholder();
  if (speed) {
    speedControl.value = speed;
    speedValue.textContent = `${speed}x`;
  }
  applyTtsSettingsToUi(normalizeTtsSettings(ttsSettings));

  await refreshBackendStatusAndVoices({
    preferredVoice: voice,
    serverConfig: effectiveServerConfig,
    backendConfig: effectiveBackendConfig,
    ttsSettings: normalizeTtsSettings(ttsSettings)
  });

  // Set up event listeners
  btnOpenBrowserPoc.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  backendSelect.addEventListener('change', handleBackendConfigChange);
  browserModelProfileSelect.addEventListener('change', handleBrowserModelProfileChange);
  browserModelPathInput.addEventListener('change', handleBackendConfigChange);
  btnApplyBackendConfig.addEventListener('click', handleApplyBackendConfig);
  btnPrepareBrowserBackend.addEventListener('click', handlePrepareBrowserBackend);
  btnApplyServerConfig.addEventListener('click', handleApplyServerConfig);
  btnResetServerConfig.addEventListener('click', handleResetServerConfig);
  voiceSelect.addEventListener('change', saveVoicePreference);
  btnReloadVoices.addEventListener('click', handleReloadVoices);
  btnToggleAddVoice.addEventListener('click', toggleAddVoicePanel);
  newVoiceGroupSelect.addEventListener('change', handleVoiceGroupSelectionChange);
  btnSaveVoice.addEventListener('click', handleSaveVoice);
  btnCancelAddVoice.addEventListener('click', closeAddVoicePanel);
  speedControl.addEventListener('input', handleSpeedChange);
  sampleModeSelect.addEventListener('change', saveTtsSettings);
  realtimeStreamingDecodeToggle.addEventListener('change', handleRealtimeStreamingDecodeChange);
  enableWeTextProcessingToggle.addEventListener('change', saveTtsSettings);
  enableNormalizeTtsTextToggle.addEventListener('change', saveTtsSettings);
  initialPlaybackDelayInput.addEventListener('change', saveTtsSettings);
  cpuThreadsInput.addEventListener('change', saveTtsSettings);
  attnImplementationSelect.addEventListener('change', saveTtsSettings);
  voiceCloneMaxTextTokensInput.addEventListener('change', saveTtsSettings);
  ttsMaxBatchSizeInput.addEventListener('change', saveTtsSettings);
  codecMaxBatchSizeInput.addEventListener('change', saveTtsSettings);
  startPosition.addEventListener('change', updateReadingTimeDisplay);
  btnScan.addEventListener('click', handleScan);
  btnRead.addEventListener('click', handleRead);
  btnPause.addEventListener('click', handlePause);
  btnStop.addEventListener('click', handleStop);

  // Listen for messages from content script
  chrome.runtime.onMessage.addListener(handleContentMessage);

  // Check current playback state
  const { playing } = await chrome.storage.local.get('playing');
  if (playing) {
    setPlayingState(true);
  }

  // Auto-scan on open if server is connected
  if (effectiveBackendConfig.backend === 'browser_onnx' || serverConnected) {
    handleScan();
  }
}

/**
 * Check if the TTS server is running
 */
async function checkServerStatus(serverConfig = null) {
  const effectiveServerConfig = serverConfig ? normalizeServerConfig(serverConfig) : await loadServerConfig();
  const serverBaseUrl = getServerBaseUrl(effectiveServerConfig);
  setServerStatus('checking', `Checking ${effectiveServerConfig.host}:${effectiveServerConfig.port}...`);
  try {
    const response = await fetch(buildServerRequestUrl('/health', effectiveServerConfig), {
      method: 'GET',
      signal: AbortSignal.timeout(3000)
    });

    if (response.ok) {
      setServerStatus('connected', `Connected: ${effectiveServerConfig.host}:${effectiveServerConfig.port}`);
      serverConnected = true;
      btnRead.disabled = false;
      btnScan.disabled = false;
      btnReloadVoices.disabled = false;
      btnToggleAddVoice.disabled = false;
    } else {
      throw new Error('Server returned error');
    }
  } catch (error) {
    setServerStatus('disconnected', `Offline: ${effectiveServerConfig.host}:${effectiveServerConfig.port}`);
    serverConnected = false;
    btnRead.disabled = true;
    btnScan.disabled = true;
    btnReloadVoices.disabled = true;
    btnToggleAddVoice.disabled = true;
    if (!addVoicePanel.classList.contains('hidden')) {
      closeAddVoicePanel();
    }
    showMessage(
      'error',
      `Server not running at ${serverBaseUrl}. Start it with: python server.py --port ${effectiveServerConfig.port}`
    );
  }
}

async function checkBrowserBackendStatus(backendConfig = null, ttsSettings = null) {
  const effectiveBackendConfig = backendConfig ? normalizeBackendConfig(backendConfig) : await loadBackendConfig();
  const effectiveTtsSettings = ttsSettings ? normalizeTtsSettings(ttsSettings) : normalizeTtsSettings(
    (await chrome.storage.local.get('ttsSettings')).ttsSettings
  );
  if (!effectiveBackendConfig.browserModelPath) {
    setServerStatus('disconnected', 'Browser ONNX path not configured');
    serverConnected = false;
    btnRead.disabled = true;
    btnScan.disabled = true;
    btnReloadVoices.disabled = true;
    btnToggleAddVoice.disabled = true;
    return false;
  }

  if (
    isDefaultPackagedBrowserModelPath(effectiveBackendConfig.browserModelPath)
    && !(await packagedBrowserModelExists(effectiveBackendConfig.browserModelPath))
  ) {
    setServerStatus('disconnected', 'Packaged browser_onnx models missing. Read/Save Voice/Load And Prepare will download them into browser-managed storage when needed.');
    serverConnected = false;
    setBrowserBackendActionAvailability(true);
    return false;
  }

  try {
    setServerStatus('checking', 'Checking browser_onnx assets...');
    const runtime = await getPopupBrowserRuntime(effectiveTtsSettings, effectiveBackendConfig);
    await runtime.ensureManifestLoaded();
    setServerStatus('connected', 'browser_onnx ready');
    serverConnected = true;
    setBrowserBackendActionAvailability(true);
    return true;
  } catch (error) {
    setServerStatus('disconnected', `browser_onnx offline: ${error.message || String(error)}`);
    serverConnected = false;
    setBrowserBackendActionAvailability(false);
    showMessage('error', error.message || 'Failed to load browser ONNX assets');
    return false;
  }
}

async function refreshBackendStatusAndVoices({
  preferredVoice = null,
  serverConfig = null,
  backendConfig = null,
  ttsSettings = null
} = {}) {
  const effectiveBackendConfig = backendConfig ? normalizeBackendConfig(backendConfig) : await loadBackendConfig();
  if (effectiveBackendConfig.backend === 'browser_onnx') {
    const browserReady = await checkBrowserBackendStatus(effectiveBackendConfig, ttsSettings);
    await populateVoiceOptions(preferredVoice, null, effectiveBackendConfig, ttsSettings, browserReady);
    return;
  }
  const effectiveServerConfig = serverConfig ? normalizeServerConfig(serverConfig) : await loadServerConfig();
  await checkServerStatus(effectiveServerConfig);
  await populateVoiceOptions(preferredVoice, effectiveServerConfig, effectiveBackendConfig, ttsSettings);
}

function renderVoiceOptions(voices, preferredVoice, voiceMetadataRows = []) {
  const availableVoices = Array.isArray(voices) && voices.length > 0 ? voices : [];
  const metadataMap = new Map();
  const orderedGroups = [];
  for (const row of Array.isArray(voiceMetadataRows) ? voiceMetadataRows : []) {
    if (!row || !row.voice) continue;
    metadataMap.set(row.voice, row);
    const groupLabel = row.group || 'Mapped Voices';
    if (!orderedGroups.includes(groupLabel)) {
      orderedGroups.push(groupLabel);
    }
  }

  const renderableVoices = orderedGroups.length > 0
    ? availableVoices.filter((voiceName) => metadataMap.has(voiceName))
    : availableVoices;
  const selectedVoice = renderableVoices.includes(preferredVoice)
    ? preferredVoice
    : (renderableVoices[0] || voiceSelect.value || 'Junhao');

  voiceSelect.innerHTML = '';
  const groupsToRender = orderedGroups.length > 0
    ? orderedGroups.map((label) => ({
        label,
        voices: voiceMetadataRows
          .filter((row) => (row.group || 'Mapped Voices') === label && renderableVoices.includes(row.voice))
          .map((row) => row.voice)
      }))
    : FALLBACK_VOICE_GROUPS;
  for (const group of groupsToRender) {
    const groupVoices = group.voices.filter((voiceName) => renderableVoices.includes(voiceName));
    if (groupVoices.length === 0) continue;
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.label;
    for (const voiceName of groupVoices) {
      const option = document.createElement('option');
      option.value = voiceName;
      option.textContent = metadataMap.get(voiceName)?.display_name || voiceName;
      if (voiceName === selectedVoice) {
        option.selected = true;
      }
      optgroup.appendChild(option);
    }
    voiceSelect.appendChild(optgroup);
  }

  if (!voiceSelect.value && selectedVoice) {
    voiceSelect.value = selectedVoice;
  }
  return selectedVoice;
}

function renderVoiceGroupOptions(groups = availableVoiceGroups, preferredGroup = '') {
  const candidateGroups = uniqueNonEmptyStrings(groups);
  availableVoiceGroups = candidateGroups.length > 0 ? candidateGroups : getFallbackVoiceGroups();
  const customGroup = preferredGroup && !availableVoiceGroups.includes(preferredGroup) ? preferredGroup : '';
  const selectedValue = customGroup ? CUSTOM_GROUP_OPTION : (preferredGroup || availableVoiceGroups[0] || CUSTOM_GROUP_OPTION);

  newVoiceGroupSelect.innerHTML = '';
  for (const groupLabel of availableVoiceGroups) {
    const option = document.createElement('option');
    option.value = groupLabel;
    option.textContent = groupLabel;
    newVoiceGroupSelect.appendChild(option);
  }

  const customOption = document.createElement('option');
  customOption.value = CUSTOM_GROUP_OPTION;
  customOption.textContent = 'Custom...';
  newVoiceGroupSelect.appendChild(customOption);
  newVoiceGroupSelect.value = selectedValue;
  newVoiceGroupCustomInput.value = customGroup;
  handleVoiceGroupSelectionChange();
}

function handleVoiceGroupSelectionChange() {
  const isCustom = newVoiceGroupSelect.value === CUSTOM_GROUP_OPTION;
  newVoiceGroupCustomInput.classList.toggle('hidden', !isCustom);
  if (!isCustom) {
    newVoiceGroupCustomInput.value = '';
  }
}

function resetAddVoiceForm() {
  newVoiceNameInput.value = '';
  newVoiceFileInput.value = '';
  renderVoiceGroupOptions(availableVoiceGroups);
}

function openAddVoicePanel() {
  if (!serverConnected && getBackendConfigFromUi().backend !== 'browser_onnx') {
    showMessage('error', 'Current backend is not ready');
    return;
  }
  renderVoiceGroupOptions(availableVoiceGroups);
  addVoicePanel.classList.remove('hidden');
  btnToggleAddVoice.textContent = 'Hide Add Voice';
  newVoiceNameInput.focus();
}

function closeAddVoicePanel() {
  addVoicePanel.classList.add('hidden');
  btnToggleAddVoice.textContent = 'Add Voice';
  resetAddVoiceForm();
}

function toggleAddVoicePanel() {
  if (addVoicePanel.classList.contains('hidden')) {
    openAddVoicePanel();
  } else {
    closeAddVoicePanel();
  }
}

function getSelectedVoiceGroup() {
  const rawGroup = newVoiceGroupSelect.value === CUSTOM_GROUP_OPTION
    ? newVoiceGroupCustomInput.value
    : newVoiceGroupSelect.value;
  return rawGroup.replace(/\s+/g, ' ').trim();
}

async function populateVoiceOptions(
  savedVoice,
  serverConfig = null,
  backendConfig = null,
  ttsSettings = null,
  browserReady = null
) {
  let availableVoices = [];
  let defaultVoice = 'Junhao';
  let voiceMetadataRows = [];
  const effectiveBackendConfig = backendConfig ? normalizeBackendConfig(backendConfig) : await loadBackendConfig();

  if (effectiveBackendConfig.backend === 'browser_onnx') {
    const uploadedVoices = (await loadBrowserUploadedVoices())
      .map(normalizeBrowserVoiceRow)
      .filter(Boolean);
    const isRuntimeReady = browserReady === null
      ? await checkBrowserBackendStatus(effectiveBackendConfig, ttsSettings)
      : browserReady;

    if (isRuntimeReady) {
      try {
        const runtime = await getPopupBrowserRuntime(ttsSettings, effectiveBackendConfig);
        await runtime.ensureManifestLoaded();
        const builtinVoices = runtime.listBuiltinVoices().map((row) => ({
          voice: row.voice,
          display_name: row.display_name || row.voice,
          group: row.group || '',
          prompt_audio_codes: row.prompt_audio_codes,
          audio_file: row.audio_file || ''
        }));
        voiceMetadataRows = [...builtinVoices, ...uploadedVoices];
        availableVoices = voiceMetadataRows.map((row) => row.voice);
        defaultVoice = voiceMetadataRows[0]?.voice || defaultVoice;
        availableVoiceGroups = uniqueNonEmptyStrings(voiceMetadataRows.map((row) => row.group));
      } catch (error) {
        console.warn('Failed to load browser_onnx voice metadata:', error);
      }
    }

    if (availableVoices.length === 0) {
      voiceMetadataRows = uploadedVoices;
      availableVoices = uploadedVoices.map((row) => row.voice);
      availableVoiceGroups = uniqueNonEmptyStrings(uploadedVoices.map((row) => row.group));
    }

    if (availableVoices.length === 0) {
      availableVoices = Array.from(voiceSelect.querySelectorAll('option')).map((option) => option.value);
    }
    if (availableVoiceGroups.length === 0) {
      availableVoiceGroups = getFallbackVoiceGroups();
    }

    const effectiveVoice = renderVoiceOptions(availableVoices, savedVoice || defaultVoice, voiceMetadataRows);
    renderVoiceGroupOptions(availableVoiceGroups);
    if (effectiveVoice) {
      chrome.storage.local.set({ voice: effectiveVoice });
    }
    return;
  }

  const effectiveServerConfig = serverConfig ? normalizeServerConfig(serverConfig) : await loadServerConfig();

  if (serverConnected) {
    try {
      const response = await fetch(buildServerRequestUrl('/voices', effectiveServerConfig), {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      });
      if (response.ok) {
        const data = await response.json();
        availableVoices = Array.isArray(data.voices) ? data.voices : [];
        defaultVoice = data.default || defaultVoice;
        voiceMetadataRows = Array.isArray(data.voice_metadata) ? data.voice_metadata : [];
        availableVoiceGroups = uniqueNonEmptyStrings(
          Array.isArray(data.voice_groups) ? data.voice_groups : voiceMetadataRows.map((row) => row.group)
        );
      }
    } catch (error) {
      console.warn('Failed to fetch voices from server:', error);
    }
  }

  if (availableVoices.length === 0) {
    availableVoices = Array.from(voiceSelect.querySelectorAll('option')).map((option) => option.value);
  }
  if (availableVoiceGroups.length === 0) {
    availableVoiceGroups = getFallbackVoiceGroups();
  }

  const effectiveVoice = renderVoiceOptions(availableVoices, savedVoice || defaultVoice, voiceMetadataRows);
  renderVoiceGroupOptions(availableVoiceGroups);
  if (effectiveVoice) {
    chrome.storage.local.set({ voice: effectiveVoice });
  }
}

/**
 * Update server status indicator
 */
function setServerStatus(status, text) {
  serverStatus.className = `status status-${status}`;
  serverStatus.querySelector('.status-text').textContent = text;
}

/**
 * Save voice preference
 */
function saveVoicePreference() {
  chrome.storage.local.set({ voice: voiceSelect.value });
}

async function handleReloadVoices() {
  const requestedBackendConfig = getBackendConfigFromUi();
  if (!serverConnected && requestedBackendConfig.backend !== 'browser_onnx') {
    showMessage('error', 'Current backend is not ready');
    return;
  }

  const originalButtonText = btnReloadVoices.textContent;
  btnReloadVoices.disabled = true;
  btnToggleAddVoice.disabled = true;
  btnReloadVoices.textContent = 'Reloading...';

  try {
    let backendConfig = await loadBackendConfig();
    let ttsSettings = getTtsSettingsFromUi();
    if (requestedBackendConfig.backend === 'browser_onnx') {
      ({ backendConfig, ttsSettings } = await ensureBrowserOnnxReadyForUserAction());
    }
    await refreshBackendStatusAndVoices({
      preferredVoice: voiceSelect.value,
      backendConfig,
      ttsSettings
    });
    showMessage('success', 'Voice list reloaded');
  } catch (error) {
    console.error('Reload voices error:', error);
    showMessage('error', error.message || 'Failed to reload voices');
  } finally {
    const keepBrowserButtonsEnabled = serverConnected || getBackendConfigFromUi().backend === 'browser_onnx';
    btnReloadVoices.disabled = !keepBrowserButtonsEnabled;
    btnToggleAddVoice.disabled = !keepBrowserButtonsEnabled;
    btnReloadVoices.textContent = originalButtonText;
  }
}

async function applyAndRefreshServerConfig(serverConfig, successType, successMessage) {
  const normalized = await persistServerConfig(serverConfig);
  applyServerConfigToUi(normalized);
  const backendConfig = await loadBackendConfig();
  if (backendConfig.backend === 'server') {
    await checkServerStatus(normalized);
    await populateVoiceOptions(voiceSelect.value, normalized, backendConfig);
  }
  showMessage(successType, successMessage || `Server connection updated to ${getServerBaseUrl(normalized)}`);
  return normalized;
}

async function handleApplyServerConfig() {
  const originalApplyText = btnApplyServerConfig.textContent;
  const originalResetText = btnResetServerConfig.textContent;
  btnApplyServerConfig.disabled = true;
  btnResetServerConfig.disabled = true;
  btnApplyServerConfig.textContent = 'Applying...';

  try {
    await applyAndRefreshServerConfig(
      getServerConfigFromUi(),
      'success',
      `Server connection updated to ${getServerBaseUrl(getServerConfigFromUi())}`
    );
  } catch (error) {
    console.error('Apply server config error:', error);
    showMessage('error', error.message || 'Failed to update server connection');
  } finally {
    btnApplyServerConfig.disabled = false;
    btnResetServerConfig.disabled = false;
    btnApplyServerConfig.textContent = originalApplyText;
    btnResetServerConfig.textContent = originalResetText;
  }
}

async function handleResetServerConfig() {
  const originalApplyText = btnApplyServerConfig.textContent;
  const originalResetText = btnResetServerConfig.textContent;
  btnApplyServerConfig.disabled = true;
  btnResetServerConfig.disabled = true;
  btnResetServerConfig.textContent = 'Resetting...';

  try {
    await applyAndRefreshServerConfig(
      DEFAULT_SERVER_CONFIG,
      'info',
      `Server connection reset to ${getServerBaseUrl(DEFAULT_SERVER_CONFIG)}`
    );
  } catch (error) {
    console.error('Reset server config error:', error);
    showMessage('error', error.message || 'Failed to reset server connection');
  } finally {
    btnApplyServerConfig.disabled = false;
    btnResetServerConfig.disabled = false;
    btnApplyServerConfig.textContent = originalApplyText;
    btnResetServerConfig.textContent = originalResetText;
  }
}

async function handleSaveVoice() {
  let voiceName;
  let groupName;
  const uploadedFile = newVoiceFileInput.files?.[0];

  try {
    voiceName = normalizeUploadedDisplayName(newVoiceNameInput.value);
    groupName = normalizeUploadedVoiceGroup(getSelectedVoiceGroup());
  } catch (error) {
    showMessage('error', error.message || 'Invalid voice metadata');
    if (!normalizeMetadataText(newVoiceNameInput.value)) {
      newVoiceNameInput.focus();
    } else if (newVoiceGroupSelect.value === CUSTOM_GROUP_OPTION) {
      newVoiceGroupCustomInput.focus();
    } else {
      newVoiceGroupSelect.focus();
    }
    return;
  }
  if (!uploadedFile || uploadedFile.size <= 0) {
    showMessage('error', 'Prompt audio file is required');
    newVoiceFileInput.focus();
    return;
  }

  const originalButtonText = btnSaveVoice.textContent;
  btnSaveVoice.disabled = true;
  btnCancelAddVoice.disabled = true;
  btnToggleAddVoice.disabled = true;
  btnSaveVoice.textContent = 'Saving...';

  try {
    let backendConfig = normalizeBackendConfig(getBackendConfigFromUi());
    if (backendConfig.backend === 'browser_onnx') {
      ({ backendConfig } = await ensureBrowserOnnxReadyForUserAction());
      const runtime = await getPopupBrowserRuntime(getTtsSettingsFromUi(), backendConfig);
      await runtime.ensureManifestLoaded();
      await runtime.ensureCodecEncodeLoaded();
      const existingVoices = [
        ...runtime.listBuiltinVoices().map((row) => row.voice),
        ...(await loadBrowserUploadedVoices()).map((row) => row.voice)
      ];
      const displayNames = new Set(
        [
          ...runtime.listBuiltinVoices().map((row) => row.display_name || row.voice),
          ...(await loadBrowserUploadedVoices()).map((row) => row.display_name || row.voice)
        ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
      );
      if (displayNames.has(voiceName.toLowerCase())) {
        throw new Error(`Display name "${voiceName}" already exists`);
      }

      const promptAudioCodes = await runtime.encodeReferenceAudioFromFile(uploadedFile);
      const voiceId = buildUniqueVoiceId(voiceName, existingVoices);
      const uploadedVoices = (await loadBrowserUploadedVoices())
        .map(normalizeBrowserVoiceRow)
        .filter(Boolean);
      const newRow = {
        voice: voiceId,
        display_name: voiceName,
        group: groupName,
        audio_file: uploadedFile.name || '',
        prompt_audio_codes: promptAudioCodes
      };
      await saveBrowserUploadedVoices([...uploadedVoices, newRow]);
      availableVoiceGroups = uniqueNonEmptyStrings([...availableVoiceGroups, groupName]);
      await populateVoiceOptions(newRow.voice, null, backendConfig, getTtsSettingsFromUi(), true);
      voiceSelect.value = newRow.voice;
      saveVoicePreference();
      closeAddVoicePanel();
      showMessage('success', `Saved voice "${voiceName}" for browser_onnx`);
    } else {
      if (!serverConnected) {
        throw new Error('Current backend is not ready');
      }
      const serverConfig = await loadServerConfig();
      const formData = new FormData();
      formData.append('name', voiceName);
      formData.append('group', groupName);
      formData.append('audio', uploadedFile);

      const response = await fetch(buildServerRequestUrl('/voices', serverConfig), {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(20000)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to save voice');
      }

      availableVoiceGroups = uniqueNonEmptyStrings(payload.voice_groups);
      await populateVoiceOptions(payload.voice?.voice || voiceName, serverConfig, backendConfig);
      if (payload.voice?.voice) {
        voiceSelect.value = payload.voice.voice;
        saveVoicePreference();
      }
      closeAddVoicePanel();
      showMessage('success', `Saved voice "${payload.voice?.display_name || voiceName}"`);
    }
  } catch (error) {
    console.error('Save voice error:', error);
    showMessage('error', error.message || 'Failed to save voice');
  } finally {
    btnSaveVoice.disabled = false;
    btnCancelAddVoice.disabled = false;
    const keepBrowserButtonsEnabled = serverConnected || getBackendConfigFromUi().backend === 'browser_onnx';
    btnReloadVoices.disabled = !keepBrowserButtonsEnabled;
    btnToggleAddVoice.disabled = !keepBrowserButtonsEnabled;
    btnSaveVoice.textContent = originalButtonText;
  }
}

function normalizeTtsSettings(rawSettings = {}) {
  const source = rawSettings || {};
  const normalized = { ...DEFAULT_TTS_SETTINGS, ...source };
  normalized.sampleMode = normalizeSampleMode(
    source.sampleMode !== undefined ? source.sampleMode : normalized.sampleMode,
    source.doSample !== undefined ? source.doSample !== false : normalized.doSample !== false
  );
  normalized.doSample = true;
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

function getTtsSettingsFromUi() {
  const sampleMode = normalizeSampleMode(sampleModeSelect.value, true);
  return normalizeTtsSettings({
    sampleMode,
    doSample: true,
    realtimeStreamingDecode: realtimeStreamingDecodeToggle.checked,
    enableWeTextProcessing: enableWeTextProcessingToggle.checked,
    enableNormalizeTtsText: enableNormalizeTtsTextToggle.checked,
    initialPlaybackDelaySeconds: initialPlaybackDelayInput.value,
    cpuThreads: cpuThreadsInput.value,
    attnImplementation: attnImplementationSelect.value,
    voiceCloneMaxTextTokens: voiceCloneMaxTextTokensInput.value,
    ttsMaxBatchSize: ttsMaxBatchSizeInput.value,
    codecMaxBatchSize: codecMaxBatchSizeInput.value
  });
}

function applyTtsSettingsToUi(settings) {
  const normalized = normalizeTtsSettings(settings);
  sampleModeSelect.value = normalized.sampleMode;
  realtimeStreamingDecodeToggle.checked = normalized.realtimeStreamingDecode;
  enableWeTextProcessingToggle.checked = normalized.enableWeTextProcessing;
  enableNormalizeTtsTextToggle.checked = normalized.enableNormalizeTtsText;
  initialPlaybackDelayInput.value = normalized.initialPlaybackDelaySeconds.toFixed(2);
  cpuThreadsInput.value = String(normalized.cpuThreads);
  attnImplementationSelect.value = normalized.attnImplementation;
  voiceCloneMaxTextTokensInput.value = String(normalized.voiceCloneMaxTextTokens);
  ttsMaxBatchSizeInput.value = String(normalized.ttsMaxBatchSize);
  codecMaxBatchSizeInput.value = String(normalized.codecMaxBatchSize);
  syncPlaybackSpeedVisibility(normalized);
}

function saveTtsSettings() {
  chrome.storage.local.set({ ttsSettings: getTtsSettingsFromUi() });
}

function syncPlaybackSpeedVisibility(settings = getTtsSettingsFromUi()) {
  const normalized = normalizeTtsSettings(settings);
  playbackSpeedGroup.classList.toggle('hidden', normalized.realtimeStreamingDecode);
}

function getEffectivePlaybackSpeed(settings = getTtsSettingsFromUi()) {
  const normalized = normalizeTtsSettings(settings);
  if (normalized.realtimeStreamingDecode) {
    return 1.0;
  }

  const speed = parseFloat(speedControl.value);
  if (!Number.isFinite(speed) || speed <= 0) {
    return 1.0;
  }
  return speed;
}

function handleRealtimeStreamingDecodeChange() {
  const settings = getTtsSettingsFromUi();
  saveTtsSettings();
  syncPlaybackSpeedVisibility(settings);
  updateReadingTimeDisplay();

  if (currentTabId && isPlaying) {
    chrome.tabs.sendMessage(currentTabId, { action: 'setSpeed', speed: getEffectivePlaybackSpeed(settings) }).catch(() => {});
  }
}

/**
 * Handle speed change
 */
function handleSpeedChange() {
  const speed = parseFloat(speedControl.value);
  speedValue.textContent = `${speed.toFixed(1)}x`;
  chrome.storage.local.set({ speed: speed });
  
  // Update reading time estimate
  updateReadingTimeDisplay();
  
  // Update current playback speed if playing
  if (currentTabId && isPlaying) {
    const settings = getTtsSettingsFromUi();
    if (!normalizeTtsSettings(settings).realtimeStreamingDecode) {
      chrome.tabs.sendMessage(currentTabId, { action: 'setSpeed', speed: speed }).catch(() => {});
    }
  }
}

/**
 * Truncate text for display
 */
function truncateText(text, maxLength = 50) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

function getParagraphText(paragraph) {
  if (typeof paragraph === 'string') {
    return paragraph.trim();
  }
  return String(paragraph?.text || '').trim();
}

function setNowReadingPlaceholder(text = 'No active paragraph.') {
  nowReadingValue.textContent = text;
  nowReadingValue.classList.add('is-placeholder');
}

function setPreparedTextPlaceholder(text = 'No prepared text yet.', meta = 'No prepared text yet.') {
  preparedTextValue.textContent = text;
  preparedTextValue.classList.add('is-placeholder');
  preparedTextMeta.textContent = meta;
}

function updatePreparedTextDisplay(message = {}) {
  const preparedText = String(message.text || '').trim();
  const method = String(message.normalizationMethod || 'none').trim() || 'none';
  const warnings = Array.isArray(message.warnings) ? message.warnings.filter(Boolean) : [];
  const wetextRequested = Boolean(message.wetextRequested);
  const wetextApplied = Boolean(message.wetextApplied);
  const wetextAvailable = Boolean(message.wetextAvailable);
  const metaParts = [
    `method=${method}`,
    `wetext_requested=${wetextRequested}`,
    `wetext_applied=${wetextApplied}`,
    `wetext_available=${wetextAvailable}`
  ];
  if (warnings.length > 0) {
    metaParts.push(`warnings=${warnings.join(' | ')}`);
  }
  preparedTextMeta.textContent = metaParts.join(' | ');
  preparedTextValue.textContent = preparedText || 'Prepared text is empty.';
  preparedTextValue.classList.toggle('is-placeholder', !preparedText);
}

function updateNowReadingDisplay(index, total = null) {
  const normalizedIndex = Number.parseInt(index, 10);
  if (!Number.isFinite(normalizedIndex) || normalizedIndex < 0) {
    setNowReadingPlaceholder();
    return;
  }

  const normalizedTotal = Number.parseInt(total, 10);
  const paragraphTotal = Number.isFinite(normalizedTotal) && normalizedTotal > 0
    ? normalizedTotal
    : scannedParagraphs.length;
  const paragraphText = normalizedIndex < scannedParagraphs.length
    ? getParagraphText(scannedParagraphs[normalizedIndex])
    : '';
  const header = paragraphTotal > 0
    ? `Paragraph ${normalizedIndex + 1}/${paragraphTotal}`
    : `Paragraph ${normalizedIndex + 1}`;

  nowReadingValue.textContent = paragraphText ? `${header}\n${paragraphText}` : header;
  nowReadingValue.classList.remove('is-placeholder');
}

/**
 * Estimate reading time based on word count
 * Average TTS speed is roughly 150 words per minute at 1.0x speed
 */
function estimateReadingTime(paragraphs, speed = 1.0) {
  // Handle both string arrays and object arrays with {text, elementIndex}
  const getText = (p) => typeof p === 'string' ? p : p.text;
  const totalText = paragraphs.map(getText).join(' ');
  const wordCount = totalText.split(/\s+/).filter(w => w.length > 0).length;
  const wordsPerMinute = 150 * speed;
  const minutes = wordCount / wordsPerMinute;
  
  if (minutes < 1) {
    return 'Less than 1 min';
  } else if (minutes < 60) {
    return `~${Math.round(minutes)} min`;
  } else {
    const hours = Math.floor(minutes / 60);
    const remainingMins = Math.round(minutes % 60);
    return `~${hours}h ${remainingMins}m`;
  }
}

/**
 * Update the reading time display based on current start position
 */
function updateReadingTimeDisplay() {
  if (scannedParagraphs.length === 0) {
    readingTimeEl.classList.add('hidden');
    return;
  }
  
  const startIndex = parseInt(startPosition.value, 10) || 0;
  const remainingParagraphs = scannedParagraphs.slice(startIndex);
  const speed = getEffectivePlaybackSpeed();
  const timeEstimate = estimateReadingTime(remainingParagraphs, speed);
  
  readingTimeValue.textContent = `Est. reading time: ${timeEstimate}`;
  readingTimeEl.classList.remove('hidden');
}

/**
 * Handle Scan button click - extract and show paragraphs
 */
async function handleScan() {
  if (!serverConnected && getBackendConfigFromUi().backend !== 'browser_onnx') {
    showMessage('error', 'Current backend is not ready');
    return;
  }

  try {
    btnScan.disabled = true;
    btnScan.textContent = 'Scanning...';

    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error('No active tab found');
    }

    currentTabId = tab.id;

    await ensureContentScriptReady(tab);

    // Scan for readable elements (with DOM references for highlighting)
    const response = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { action: 'scanElements' }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Could not access page'));
        } else {
          resolve(resp);
        }
      });
    });

    if (!response || !response.success) {
      throw new Error(response?.error || 'Could not scan page content');
    }

    // Store paragraphs with element indices for highlighting
    scannedParagraphs = response.paragraphs;

    // Populate the dropdown
    startPosition.innerHTML = '';
    scannedParagraphs.forEach((para, index) => {
      const option = document.createElement('option');
      option.value = index;
      const text = typeof para === 'string' ? para : para.text;
      option.textContent = `${index + 1}. ${truncateText(text)}`;
      startPosition.appendChild(option);
    });

    startPosition.disabled = false;
    updateReadingTimeDisplay();
    showMessage('success', `Found ${scannedParagraphs.length} paragraphs`);

    // Check for saved reading position
    try {
      const savedPosition = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tab.id, { action: 'getSavedPosition' }, (resp) => {
          if (chrome.runtime.lastError) {
            resolve(null);
          } else {
            resolve(resp);
          }
        });
      });

      if (savedPosition && savedPosition.index >= 0 && savedPosition.index < scannedParagraphs.length) {
        startPosition.value = savedPosition.index;
        if (isPlaying) {
          updateNowReadingDisplay(savedPosition.index, savedPosition.total || scannedParagraphs.length);
        }
        showMessage('info', `Resuming from paragraph ${savedPosition.index + 1}`);
      }
    } catch (e) {
      // Ignore errors in getting saved position
    }

  } catch (error) {
    console.error('Scan error:', error);
    showMessage('error', error.message);
  } finally {
    btnScan.disabled = false;
    btnScan.textContent = 'Scan';
  }
}

/**
 * Handle Read button click
 */
async function handleRead() {
  hideMessage();
  setPlayingState(true);
  updateProgress(0, 'Starting...');
  setPreparedTextPlaceholder('Waiting for prepared text...', 'Waiting for browser_onnx text preparation.');

  try {
    const requestedBackendConfig = getBackendConfigFromUi();
    let effectiveTtsSettings = getTtsSettingsFromUi();
    if (requestedBackendConfig.backend === 'browser_onnx') {
      const ensured = await ensureBrowserOnnxReadyForUserAction({ prepareInActiveTab: true });
      effectiveTtsSettings = ensured.ttsSettings;
      await populateVoiceOptions(voiceSelect.value, null, ensured.backendConfig, ensured.ttsSettings, true);
    } else if (!serverConnected) {
      throw new Error('Current backend is not ready');
    }

    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      throw new Error('No active tab found');
    }

    currentTabId = tab.id;

    await ensureContentScriptReady(tab);

    // Get start index
    const startIndex = parseInt(startPosition.value, 10) || 0;

    // If we have scanned paragraphs, use them directly
    if (scannedParagraphs.length > 0) {
      const voice = voiceSelect.value;
      const speed = getEffectivePlaybackSpeed(effectiveTtsSettings);
      updateNowReadingDisplay(startIndex, scannedParagraphs.length);
      chrome.tabs.sendMessage(tab.id, {
        action: 'readParagraphs',
        paragraphs: scannedParagraphs,
        startIndex: startIndex,
        voice: voice,
        speed: speed,
        settings: effectiveTtsSettings
      });
    } else {
      // Otherwise extract and read from beginning
      chrome.tabs.sendMessage(tab.id, { action: 'extractContent' }, (response) => {
        if (chrome.runtime.lastError) {
          showMessage('error', 'Could not access page content');
          setPlayingState(false);
          setNowReadingPlaceholder();
          return;
        }

        if (!response || !response.text) {
          showMessage('error', 'Could not extract page content');
          setPlayingState(false);
          setNowReadingPlaceholder();
          return;
        }

        const voice = voiceSelect.value;
        const speed = getEffectivePlaybackSpeed(effectiveTtsSettings);
        chrome.tabs.sendMessage(tab.id, {
          action: 'readText',
          text: response.text,
          voice: voice,
          speed: speed,
          settings: effectiveTtsSettings
        });
      });
    }
  } catch (error) {
    console.error('Error starting read:', error);
    showMessage('error', error.message);
    setPlayingState(false);
    setNowReadingPlaceholder();
  }
}

/**
 * Handle Pause/Resume button click
 */
async function handlePause() {
  const wasPaused = isPaused;
  const nextPausedState = !wasPaused;
  setPausedState(nextPausedState);
  try {
    if (wasPaused) {
      await sendPlaybackAction('resume');
    } else {
      await sendPlaybackAction('pause');
    }
  } catch (error) {
    setPausedState(!nextPausedState);
    console.error('Pause/resume failed:', error);
    showMessage('error', error.message || 'Pause/resume failed');
  }
}

/**
 * Handle Stop button click
 */
async function handleStop() {
  setPlayingState(false);
  setPausedState(false);
  setNowReadingPlaceholder();
  hideMessage();
  progressContainer.classList.add('hidden');
  try {
    await sendPlaybackAction('stop');
  } catch (error) {
    console.error('Stop failed:', error);
    showMessage('error', error.message || 'Stop failed');
  }
}

/**
 * Handle messages from content script
 */
function handleContentMessage(message, sender) {
  // Only handle messages from content scripts (they have a tab)
  if (!sender.tab) return;
  currentTabId = sender.tab.id;

  switch (message.action) {
    case 'progress':
      updateProgress(message.percent, message.text);
      break;

    case 'preparedText':
      updatePreparedTextDisplay(message);
      break;

    case 'playing':
      setPlayingState(true);
      if (message.current) {
        updateNowReadingDisplay((parseInt(message.current, 10) || 1) - 1, message.total);
      }
      if (message.total && message.total > 1) {
        updateProgress(
          10 + Math.floor((message.current / message.total) * 80),
          `Playing ${message.current}/${message.total}...`
        );
      } else {
        updateProgress(100, 'Playing audio...');
      }
      break;

    case 'stopped':
      setPlayingState(false);
      setPausedState(false);
      progressContainer.classList.add('hidden');
      setNowReadingPlaceholder();
      break;

    case 'paused':
      setPausedState(true);
      break;

    case 'resumed':
      setPausedState(false);
      break;

    case 'error':
      showMessage('error', message.text);
      setPlayingState(false);
      setNowReadingPlaceholder();
      break;

    case 'complete':
      setPlayingState(false);
      progressContainer.classList.add('hidden');
      setNowReadingPlaceholder();
      showMessage('success', 'Finished reading');
      break;
  }
}

/**
 * Update playing state UI
 */
function setPlayingState(playing) {
  isPlaying = playing;
  btnRead.disabled = playing || !serverConnected;
  btnPause.disabled = !playing;
  btnStop.disabled = !playing;
  btnScan.disabled = playing;
  startPosition.disabled = playing || scannedParagraphs.length === 0;

  if (playing) {
    progressContainer.classList.remove('hidden');
  }

  chrome.storage.local.set({ playing: playing });
}

/**
 * Update paused state UI
 */
function setPausedState(paused) {
  isPaused = paused;
  const pauseIcon = btnPause.querySelector('.icon');
  const pauseText = btnPause.childNodes[btnPause.childNodes.length - 1];
  
  if (paused) {
    pauseIcon.className = 'icon icon-play';
    pauseText.textContent = 'Resume';
  } else {
    pauseIcon.className = 'icon icon-pause';
    pauseText.textContent = 'Pause';
  }
}

/**
 * Update progress bar
 */
function updateProgress(percent, text) {
  progressContainer.classList.remove('hidden');
  progressFill.style.width = `${percent}%`;
  progressText.textContent = text;
}

/**
 * Show message
 */
function showMessage(type, text) {
  messageEl.className = `message ${type}`;
  messageEl.textContent = text;
  messageEl.classList.remove('hidden');
}

/**
 * Hide message
 */
function hideMessage() {
  messageEl.classList.add('hidden');
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
