/**
 * Nano Reader - Popup Script
 * Handles UI interactions and communication with content script
 */

const SERVER_URL = 'http://localhost:5050';

// DOM Elements
const serverStatus = document.getElementById('server-status');
const voiceSelect = document.getElementById('voice-select');
const playbackSpeedGroup = document.getElementById('playback-speed-group');
const speedControl = document.getElementById('speed-control');
const speedValue = document.getElementById('speed-value');
const startPosition = document.getElementById('start-position');
const nowReadingValue = document.getElementById('now-reading-value');
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
const realtimeStreamingDecodeToggle = document.getElementById('realtime-streaming-decode');
const enableWeTextProcessingToggle = document.getElementById('wetext-processing-enabled');
const enableNormalizeTtsTextToggle = document.getElementById('normalize-tts-text-enabled');
const initialPlaybackDelayInput = document.getElementById('initial-playback-delay');
const cpuThreadsInput = document.getElementById('cpu-threads');
const attnImplementationSelect = document.getElementById('attn-implementation');
const voiceCloneMaxTextTokensInput = document.getElementById('voice-clone-max-text-tokens');
const ttsMaxBatchSizeInput = document.getElementById('tts-max-batch-size');
const codecMaxBatchSizeInput = document.getElementById('codec-max-batch-size');

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

// State
let isPlaying = false;
let isPaused = false;
let serverConnected = false;
let currentTabId = null;
let scannedParagraphs = [];

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

/**
 * Initialize popup
 */
async function init() {
  // Load saved voice preference
  const { voice, speed, ttsSettings } = await chrome.storage.local.get(['voice', 'speed', 'ttsSettings']);
  if (speed) {
    speedControl.value = speed;
    speedValue.textContent = `${speed}x`;
  }
  applyTtsSettingsToUi(normalizeTtsSettings(ttsSettings));

  // Check server status
  await checkServerStatus();
  await populateVoiceOptions(voice);

  // Set up event listeners
  voiceSelect.addEventListener('change', saveVoicePreference);
  speedControl.addEventListener('input', handleSpeedChange);
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
  if (serverConnected) {
    handleScan();
  }
}

/**
 * Check if the TTS server is running
 */
async function checkServerStatus() {
  try {
    const response = await fetch(`${SERVER_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000)
    });

    if (response.ok) {
      setServerStatus('connected', 'Server connected');
      serverConnected = true;
      btnRead.disabled = false;
      btnScan.disabled = false;
    } else {
      throw new Error('Server returned error');
    }
  } catch (error) {
    setServerStatus('disconnected', 'Server offline');
    serverConnected = false;
    btnRead.disabled = true;
    btnScan.disabled = true;
    showMessage('error', 'Server not running. Start it with: python server.py');
  }
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

async function populateVoiceOptions(savedVoice) {
  let availableVoices = [];
  let defaultVoice = 'Junhao';
  let voiceMetadataRows = [];

  if (serverConnected) {
    try {
      const response = await fetch(`${SERVER_URL}/voices`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      });
      if (response.ok) {
        const data = await response.json();
        availableVoices = Array.isArray(data.voices) ? data.voices : [];
        defaultVoice = data.default || defaultVoice;
        voiceMetadataRows = Array.isArray(data.voice_metadata) ? data.voice_metadata : [];
      }
    } catch (error) {
      console.warn('Failed to fetch voices from server:', error);
    }
  }

  if (availableVoices.length === 0) {
    availableVoices = Array.from(voiceSelect.querySelectorAll('option')).map((option) => option.value);
  }

  const effectiveVoice = renderVoiceOptions(availableVoices, savedVoice || defaultVoice, voiceMetadataRows);
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

function normalizeTtsSettings(rawSettings = {}) {
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

function getTtsSettingsFromUi() {
  return normalizeTtsSettings({
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
  if (!serverConnected) {
    showMessage('error', 'Server not connected');
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

    // Ensure content script is loaded
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (e) {
      // Script might already be loaded
    }

    // Scan for readable elements (with DOM references for highlighting)
    const response = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { action: 'scanElements' }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error('Could not access page'));
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
  if (!serverConnected) {
    showMessage('error', 'Server not connected');
    return;
  }

  hideMessage();
  setPlayingState(true);
  updateProgress(0, 'Starting...');

  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      throw new Error('No active tab found');
    }

    currentTabId = tab.id;

    // Ensure content script is loaded
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (e) {
      // Script might already be loaded
    }

    // Get start index
    const startIndex = parseInt(startPosition.value, 10) || 0;

    // If we have scanned paragraphs, use them directly
    if (scannedParagraphs.length > 0) {
      const voice = voiceSelect.value;
      const settings = getTtsSettingsFromUi();
      const speed = getEffectivePlaybackSpeed(settings);
      updateNowReadingDisplay(startIndex, scannedParagraphs.length);
      chrome.tabs.sendMessage(tab.id, {
        action: 'readParagraphs',
        paragraphs: scannedParagraphs,
        startIndex: startIndex,
        voice: voice,
        speed: speed,
        settings: settings
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
        const settings = getTtsSettingsFromUi();
        const speed = getEffectivePlaybackSpeed(settings);
        chrome.tabs.sendMessage(tab.id, {
          action: 'readText',
          text: response.text,
          voice: voice,
          speed: speed,
          settings: settings
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
function handlePause() {
  if (!currentTabId) return;

  if (isPaused) {
    // Resume playback
    chrome.tabs.sendMessage(currentTabId, { action: 'resume' }).catch(() => {});
    setPausedState(false);
  } else {
    // Pause playback
    chrome.tabs.sendMessage(currentTabId, { action: 'pause' }).catch(() => {});
    setPausedState(true);
  }
}

/**
 * Handle Stop button click
 */
function handleStop() {
  if (currentTabId) {
    chrome.tabs.sendMessage(currentTabId, { action: 'stop' }).catch(() => {});
  }
  setPlayingState(false);
  setPausedState(false);
  setNowReadingPlaceholder();
  hideMessage();
  progressContainer.classList.add('hidden');
}

/**
 * Handle messages from content script
 */
function handleContentMessage(message, sender) {
  // Only handle messages from content scripts (they have a tab)
  if (!sender.tab) return;

  switch (message.action) {
    case 'progress':
      updateProgress(message.percent, message.text);
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
