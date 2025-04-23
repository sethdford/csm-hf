let ws;
let sessionStartTime = null;
let messageCount = 0;
let audioLevelsChart = null;
let isRecording = false;
let configSaved = false;
console.log("chat.js loaded");
let audioContext;
let micStream;
let mediaRecorder;
let recordedChunks = [];
let analyzer;
let micAnalyser, micContext, micSource;
let outputAnalyser, outputAudioCtx;
let selectedMicId = null;
let selectedOutputId = null;
const SESSION_ID = "default";
// Audio playback queue system
let audioPlaybackQueue = [];
let isAudioCurrentlyPlaying = false;

async function populateAudioDevices() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.warn("Microphone permission denied or not granted.");
    return;
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const micSelect = document.getElementById('micSelect');
  const outputSelect = document.getElementById('outputSelect');

  if (!micSelect || !outputSelect) return;

  micSelect.innerHTML = '';
  outputSelect.innerHTML = '';

  devices.forEach(device => {
    const option = new Option(device.label || `${device.kind}`, device.deviceId);
    if (device.kind === 'audioinput') micSelect.add(option);
    if (device.kind === 'audiooutput') outputSelect.add(option);
  });

  if (micSelect.options.length === 0) {
    micSelect.add(new Option("No mic devices found", ""));
  }
  if (outputSelect.options.length === 0) {
    outputSelect.add(new Option("Default Output", "default"));
  }
}

async function matchSavedDeviceIds(savedMicId, savedOutputId) {
  try {
    // Get current devices
    const devices = await navigator.mediaDevices.enumerateDevices();
    
    console.log("Available audio devices:", devices);
    console.log("Looking for saved mic ID:", savedMicId);
    console.log("Looking for saved output ID:", savedOutputId);
    
    // Populate device selects
    const micSelect = document.getElementById('micSelect');
    const outputSelect = document.getElementById('outputSelect');
    
    if (!micSelect || !outputSelect) return;
    
    // First check if we have exact matches with current devices
    let foundMic = false;
    let foundOutput = false;
    
    // For mic
    if (savedMicId && micSelect.options.length > 0) {
      for (let i = 0; i < micSelect.options.length; i++) {
        if (micSelect.options[i].value === savedMicId) {
          micSelect.selectedIndex = i;
          selectedMicId = savedMicId;
          foundMic = true;
          console.log("Found exact match for mic ID");
          break;
        }
      }
    }
    
    // For output
    if (savedOutputId && outputSelect.options.length > 0) {
      for (let i = 0; i < outputSelect.options.length; i++) {
        if (outputSelect.options[i].value === savedOutputId) {
          outputSelect.selectedIndex = i;
          selectedOutputId = savedOutputId;
          foundOutput = true;
          console.log("Found exact match for output ID");
          break;
        }
      }
    }
    
    if (!foundMic && savedMicId) {
      const savedMicDevice = devices.find(d => d.deviceId === savedMicId && d.kind === 'audioinput');
      if (savedMicDevice && savedMicDevice.label) {
        const savedLabel = savedMicDevice.label;
        for (let i = 0; i < micSelect.options.length; i++) {
          const optDevice = devices.find(d => d.deviceId === micSelect.options[i].value);
          if (optDevice && optDevice.label === savedLabel) {
            micSelect.selectedIndex = i;
            selectedMicId = micSelect.options[i].value;
            console.log("Found match based on mic label:", savedLabel);
            break;
          }
        }
      } else {
        // Try to use the first available device
        if (micSelect.options.length > 0) {
          micSelect.selectedIndex = 0;
          selectedMicId = micSelect.options[0].value;
          console.log("Using first available mic as fallback");
        }
      }
    }
    
    if (!foundOutput && savedOutputId) {
      // First, we need to translate the saved ID to a label if possible
      const savedOutputDevice = devices.find(d => d.deviceId === savedOutputId && d.kind === 'audiooutput');
      if (savedOutputDevice && savedOutputDevice.label) {
        const savedLabel = savedOutputDevice.label;
        for (let i = 0; i < outputSelect.options.length; i++) {
          const optDevice = devices.find(d => d.deviceId === outputSelect.options[i].value);
          if (optDevice && optDevice.label === savedLabel) {
            outputSelect.selectedIndex = i;
            selectedOutputId = outputSelect.options[i].value;
            console.log("Found match based on output label:", savedLabel);
            break;
          }
        }
      } else {
        // Use default or first available output
        if (outputSelect.options.length > 0) {
          // Try to select "default" if available
          let defaultIndex = -1;
          for (let i = 0; i < outputSelect.options.length; i++) {
            if (outputSelect.options[i].value === 'default') {
              defaultIndex = i;
              break;
            }
          }
          
          if (defaultIndex >= 0) {
            outputSelect.selectedIndex = defaultIndex;
          } else {
            outputSelect.selectedIndex = 0;
          }
          
          selectedOutputId = outputSelect.options[outputSelect.selectedIndex].value;
          console.log("Using first available output as fallback");
        }
      }
    }
    
    return {
      micId: selectedMicId,
      outputId: selectedOutputId
    };
    
  } catch (err) {
    console.error("Error matching saved device IDs:", err);
    return {
      micId: null,
      outputId: null
    };
  }
}

// Visualize audio on canvas
function visualizeMic(analyser, canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  
  const ctx = canvas.getContext("2d");
  analyser.fftSize = 256;
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function draw() {
    const drawRequest = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);
    ctx.fillStyle = "#1f2937";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const barWidth = canvas.width / bufferLength;
    for (let i = 0; i < bufferLength; i++) {
      const barHeight = dataArray[i];
      ctx.fillStyle = "#4ade80";
      ctx.fillRect(i * barWidth, canvas.height - barHeight / 2, barWidth - 1, barHeight / 2);
    }
    
    // Stop animation if the modal is closed
    if (document.getElementById('settingsModal').classList.contains('hidden')) {
      cancelAnimationFrame(drawRequest);
    }
  }
  draw();
}

// Connect to WebSocket for chat communications
function connectWebSocket() {
  if (ws) ws.close();

  const connectionStatus = document.getElementById('connectionStatus');
  connectionStatus.textContent = 'Connecting...';
  connectionStatus.className = 'font-medium text-yellow-500';

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  console.log(`Connecting to WebSocket at ${wsUrl}`);
  
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket connection established');
    connectionStatus.textContent = 'Connected';
    connectionStatus.className = 'font-medium text-green-500';

    // Request saved config on connect
    ws.send(JSON.stringify({ type: 'request_saved_config' }));
    
    // Add a debug message to conversationHistory
    addMessageToConversation('ai', 'WebSocket connected. Ready for voice input.');
  };

  ws.onclose = (event) => {
    console.log(`WebSocket closed with code: ${event.code}`);
    connectionStatus.textContent = 'Disconnected';
    connectionStatus.className = 'font-medium text-red-500';
    setTimeout(connectWebSocket, 5000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    connectionStatus.textContent = 'Error';
    connectionStatus.className = 'font-medium text-red-500';
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWebSocketMessage(data);
    } catch (error) {
      console.error('Error parsing or handling message:', error);
    }
  };
}

function showNotification(message, type = 'info') {
  console.log(`NOTIFICATION: ${message} (${type})`);
  const notification = document.createElement('div');
  notification.className = `fixed bottom-4 right-4 p-4 rounded-lg shadow-lg ${
    type === 'success' ? 'bg-green-600' : 
    type === 'error' ? 'bg-red-600' : 
    'bg-indigo-600'
  } text-white z-50`;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.classList.add('opacity-0', 'transition-opacity', 'duration-500');
    setTimeout(() => document.body.removeChild(notification), 500);
  }, 3000);
}

// Handle saved configuration data properly
async function handleSavedConfig(data) {
  console.log('Received saved configuration:', data.config);
  
  if (data.config) {
    configSaved = true;
    
    const modelStatus = document.getElementById('modelStatus');
    if (modelStatus) {
      modelStatus.textContent = 'Loaded';
      modelStatus.className = 'font-medium text-green-500';
    }
    
    // Populate any input fields in settings
    if (data.config.system_prompt) {
      const systemPrompt = document.getElementById('systemPrompt');
      if (systemPrompt) systemPrompt.value = data.config.system_prompt;
    }
    
    if (data.config.reference_audio_path) {
      const refAudioPath = document.getElementById('referenceAudioPath');
      if (refAudioPath) refAudioPath.value = data.config.reference_audio_path;
    }
    
    if (data.config.reference_text) {
      const refText = document.getElementById('referenceText');
      if (refText) refText.value = data.config.reference_text;
    }
    
    if (data.config.model_path) {
      const modelPath = document.getElementById('modelPath');
      if (modelPath) modelPath.value = data.config.model_path;
    }
    
    if (data.config.llm_path) {
      const llmPath = document.getElementById('llmPath');
      if (llmPath) llmPath.value = data.config.llm_path;
    }
    
    if (data.config.max_tokens) {
      const maxTokens = document.getElementById('maxTokens');
      if (maxTokens) maxTokens.value = data.config.max_tokens;
    }
    
    if (data.config.voice_speaker_id) {
      const speakerId = document.getElementById('speakerId');
      if (speakerId) speakerId.value = data.config.voice_speaker_id;
    }
    
    if (typeof data.config.vad_enabled !== 'undefined') {
      const vadEnabled = document.getElementById('vadEnabled');
      if (vadEnabled) vadEnabled.checked = data.config.vad_enabled;
    }
    
    if (data.config.vad_threshold) {
      const vadThreshold = document.getElementById('vadThreshold');
      const vadThresholdValue = document.getElementById('vadThresholdValue');
      if (vadThreshold) vadThreshold.value = data.config.vad_threshold;
      if (vadThresholdValue) vadThresholdValue.textContent = data.config.vad_threshold;
    }
    
    // Make sure audio devices are populated before trying to select saved devices
    await populateAudioDevices();
    
    // Handle saved device IDs
    if (data.config.mic_id || data.config.output_id) {
      await matchSavedDeviceIds(data.config.mic_id, data.config.output_id);
    }
  }
}

// Handle incoming messages from WebSocket
function handleWebSocketMessage(data) {
  console.log('Processing message type:', data.type);
  
  const modelStatus = document.getElementById('modelStatus');
  const conversationHistory = document.getElementById('conversationHistory');
  const audioStatus = document.getElementById('audioStatus');

  switch (data.type) {
    case 'transcription':
      addMessageToConversation('user', data.text);
      break;

    case 'response':
      addMessageToConversation('ai', data.text);
      break;
      
    case 'audio_chunk':
      // Handle incoming audio chunk from server
      if (Array.isArray(data.audio)) {
        console.log(`Received audio chunk: ${data.audio.length} samples at ${data.sample_rate}Hz`);
        if (audioStatus) audioStatus.textContent = 'Playing';
        queueAudioForPlayback(data.audio, data.sample_rate);
      }
      break;
      
    case 'status':
      console.log('Status update:', data.message);
      if (data.message === 'Models initialized' || data.message === 'Models initialized and configuration saved') {
        modelStatus.textContent = 'Loaded';
        modelStatus.className = 'font-medium text-green-500';
        if (data.message === 'Models initialized and configuration saved') {
          showNotification('Configuration saved successfully!', 'success');
        }
      }
      break;

    case 'saved_config':
      handleSavedConfig(data);
      break;
      
    case 'audio_status':
      const audioWaveform = document.getElementById('audioWaveform');

      if (data.status === 'generating') {
        isRecording = true;
        if (audioWaveform) audioWaveform.classList.remove('hidden');
      } else if (data.status === 'interrupted' || data.status === 'complete') {
        isRecording = false;
        if (audioWaveform) audioWaveform.classList.add('hidden');
      }
      break;

    case 'vad_status':
      if (data.status === 'speech_started') {
        const micStatus = document.getElementById('micStatus'); 
        if (micStatus) micStatus.textContent = 'Listening...';
      }
      break;

    case 'mute_status':
      updateMicButtonUI(data.muted);
      break;
      
    default:
      console.log('Unknown message type:', data.type);
      break;
  }
}

// Queue audio for sequential playback
function queueAudioForPlayback(audioData, sampleRate) {
  audioPlaybackQueue.push({
    audio: audioData,
    sampleRate: sampleRate || 24000 // Default CSM sample rate
  });
  
  // Start processing queue if not already running
  if (!isAudioCurrentlyPlaying) {
    processAudioPlaybackQueue();
  }
}

// Process audio queue one chunk at a time
async function processAudioPlaybackQueue() {
  if (audioPlaybackQueue.length === 0) {
    isAudioCurrentlyPlaying = false;
    const audioStatus = document.getElementById('audioStatus');
    if (audioStatus) audioStatus.textContent = 'Idle';
    return;
  }
  
  isAudioCurrentlyPlaying = true;
  const nextChunk = audioPlaybackQueue.shift();
  
  try {
    await playAudioChunk(nextChunk.audio, nextChunk.sampleRate);
  } catch (err) {
    console.error("Error playing audio chunk:", err);
  }
  
  // Continue with next chunk
  processAudioPlaybackQueue();
}

// Play a single audio chunk with improved auto-resume
async function playAudioChunk(audioData, sampleRate) {
  return new Promise(async (resolve, reject) => {
    try {
      // Create audio context if needed
      if (!window.audioContext) {
        window.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log("Created audio context:", window.audioContext.state);
        
        // Immediately try to unlock audio context on iOS
        const silentBuffer = window.audioContext.createBuffer(1, 1, 22050);
        const source = window.audioContext.createBufferSource();
        source.buffer = silentBuffer;
        source.connect(window.audioContext.destination);
        source.start(0);
      }
      
      // Automatically resume audio context if suspended
      if (window.audioContext.state === 'suspended') {
        try {
          console.log("Resuming audio context automatically");
          await window.audioContext.resume();
          console.log("Audio context resumed:", window.audioContext.state);
        } catch (err) {
          console.warn("Could not resume audio context:", err);
        }
      }
      
      // Convert to Float32Array
      const floatArray = audioData instanceof Float32Array ? 
        audioData : new Float32Array(audioData);
      
      // Create buffer
      const audioBuffer = window.audioContext.createBuffer(
        1, // mono
        floatArray.length,
        sampleRate
      );
      
      // Fill buffer with data
      audioBuffer.copyToChannel(floatArray, 0);
      
      // Create source
      const source = window.audioContext.createBufferSource();
      source.buffer = audioBuffer;

      // Get selected output device if available
      const outputSelect = document.getElementById('outputSelect');
      const selectedOutputId = outputSelect ? outputSelect.value : 'default';
            
      // Connect to destination and play
      source.connect(window.audioContext.destination);
      source.start(0);
      source.onended = resolve;
      
    } catch (err) {
      console.error("Audio playback error:", err);
      reject(err);
    }
  });
}

// Convert AudioBuffer to WAV format for device output selection
function audioBufferToWav(buffer) {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2;
  const sampleRate = buffer.sampleRate;
  
  const buffer16Bit = new Int16Array(length);
  const audioData = [];
  
  // Get audio data from all channels
  for (let channel = 0; channel < numOfChan; channel++) {
    const channelData = buffer.getChannelData(channel);
    let offset = channel;
    
    for (let i = 0; i < buffer.length; i++) {
      // Convert -1.0...1.0 to -32768...32767
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      buffer16Bit[offset] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      offset += numOfChan;
    }
  }
  
  const wav = new ArrayBuffer(44 + buffer16Bit.length * 2);
  const view = new DataView(wav);
  
  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + buffer16Bit.length * 2, true);
  writeString(view, 8, 'WAVE');
  
  // FMT sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numOfChan, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numOfChan * 2, true); // byte rate
  view.setUint16(32, numOfChan * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  
  // Data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, buffer16Bit.length * 2, true);
  
  // Write PCM samples
  const offset = 44;
  for (let i = 0; i < buffer16Bit.length; i++) {
    view.setInt16(offset + i * 2, buffer16Bit[i], true);
  }
  
  return new Blob([view], { type: 'audio/wav' });
}

function writeString(dataView, offset, string) {
  for (let i = 0; i < string.length; i++) {
    dataView.setUint8(offset + i, string.charCodeAt(i));
  }
}

function addMessageToConversation(sender, text) {
  console.log("Appending message from:", sender, "with text:", text);
  const conversationHistory = document.getElementById('conversationHistory');
  if (!conversationHistory) return;

  const messageElement = document.createElement('div');
  messageElement.className = `p-4 mb-4 rounded-lg ${sender === 'user' ? 'bg-gray-700 ml-12' : 'bg-indigo-800 mr-12'}`;

  const avatarDiv = document.createElement('div');
  avatarDiv.className = 'flex items-start mb-2';

  const avatar = document.createElement('div');
  avatar.className = `w-8 h-8 rounded-full flex items-center justify-center ${sender === 'user' ? 'bg-gray-300 text-gray-800' : 'bg-indigo-500 text-white'}`;
  avatar.textContent = sender === 'user' ? 'U' : 'AI';

  const timestamp = document.createElement('span');
  timestamp.className = 'text-xs text-gray-400 ml-2';
  timestamp.textContent = new Date().toLocaleTimeString();

  avatarDiv.appendChild(avatar);
  avatarDiv.appendChild(timestamp);

  const textDiv = document.createElement('div');
  textDiv.className = 'text-white mt-1';
  textDiv.textContent = text;

  messageElement.appendChild(avatarDiv);
  messageElement.appendChild(textDiv);
  conversationHistory.appendChild(messageElement);
  conversationHistory.scrollTop = conversationHistory.scrollHeight;
}


function initAudioLevelsChart() {
  const ctx = document.getElementById('audioLevels').getContext('2d');
  if (audioLevelsChart) {
    audioLevelsChart.destroy();
  }
  audioLevelsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array(30).fill(''),
      datasets: [{
        label: 'Audio Level',
        data: Array(30).fill(0),
        backgroundColor: 'rgba(79, 70, 229, 0.2)',
        borderColor: 'rgba(79, 70, 229, 1)',
        borderWidth: 2,
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      animation: { duration: 0 },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: { display: false }
        },
        x: { display: false }
      },
      plugins: { legend: { display: false } },
      elements: { point: { radius: 0 } },
      layout: { padding: 0 },
      devicePixelRatio: 1
    }
  });
}

// Update session duration display
function updateSessionDuration() {
  if (!sessionStartTime) return;
  const now = new Date();
  const diff = now - sessionStartTime;
  const hours = Math.floor(diff / 3600000).toString().padStart(2, '0');
  const minutes = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
  const seconds = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
  document.getElementById('sessionDuration').textContent = `${hours}:${minutes}:${seconds}`;
}

// Update microphone button UI on mute/unmute
function updateMicButtonUI(muted) {
  const micToggleBtn = document.getElementById('micToggleBtn');
  const micStatus = document.getElementById('micStatus');
  if (muted) {
    micToggleBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
    micToggleBtn.classList.add('bg-gray-400', 'hover:bg-gray-500');
    micStatus.textContent = 'Mic muted';
  } else {
    micToggleBtn.classList.remove('bg-gray-400', 'hover:bg-gray-500');
    micToggleBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
    micStatus.textContent = 'Click to speak';
  }
}

// Send settings via WebSocket (for modal configuration)
function sendSettings() {
  console.log('Sending settings to server...');
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const config = {
        system_prompt: document.getElementById('systemPrompt').value,
        reference_audio_path: document.getElementById('referenceAudioPath').value,
        reference_text: document.getElementById('referenceText').value,
        model_path: document.getElementById('modelPath').value,
        llm_path: document.getElementById('llmPath').value,
        max_tokens: parseInt(document.getElementById('maxTokens').value),
        voice_speaker_id: parseInt(document.getElementById('speakerId').value),
        vad_enabled: document.getElementById('vadEnabled').checked,
        vad_threshold: parseFloat(document.getElementById('vadThreshold').value),
        embedding_model: document.getElementById('embeddingModel').value
      };

      ws.send(JSON.stringify({ type: 'config', config: config }));
      const modelStatus = document.getElementById('modelStatus');
      modelStatus.textContent = 'Loading...';
      modelStatus.className = 'font-medium text-yellow-500';
      document.getElementById('settingsModal').classList.add('hidden');
    } else {
      console.error('WebSocket not connected');
      alert('Not connected to server. Please try again later.');
    }
  } catch (error) {
    console.error('Error sending settings:', error);
    alert('Error sending settings to server.');
  }
}

// Request saved configuration from server
function requestSavedConfig() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'request_saved_config' }));
  }
}

// Initialize event listeners for chat page
document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM loaded, setting up UI for chat...');
  initAudioLevelsChart();
  connectWebSocket();
  
  // Initialize audio context on page load
  try {
    // Create it immediately to be ready
    window.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    console.log("Audio context created on page load:", window.audioContext.state);
    
    // Use first user interaction to unlock audio on iOS and other browsers
    const unlockAudio = () => {
      if (window.audioContext.state === 'suspended') {
        window.audioContext.resume().then(() => {
          console.log("Audio context resumed by user interaction");
        });
      }
      
      // Create silent buffer to unlock audio
      const buffer = window.audioContext.createBuffer(1, 1, 22050);
      const source = window.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(window.audioContext.destination);
      source.start(0);
      
      // Remove event listeners after first interaction
      document.removeEventListener('click', unlockAudio);
      document.removeEventListener('touchstart', unlockAudio);
      document.removeEventListener('keydown', unlockAudio);
    };
    
    // Add multiple events to catch the first user interaction
    document.addEventListener('click', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);
    document.addEventListener('keydown', unlockAudio);
  } catch (err) {
    console.error("Failed to initialize audio context:", err);
  }
  
  // Populate audio devices on startup
  await populateAudioDevices();
  
  // Handle slider value displays
  const vadThreshold = document.getElementById('vadThreshold');
  const vadThresholdValue = document.getElementById('vadThresholdValue');
  if (vadThreshold && vadThresholdValue) {
    vadThreshold.addEventListener('input', () => {
      vadThresholdValue.textContent = vadThreshold.value;
    });
  }

  const volumeLevel = document.getElementById('volumeLevel');
  const volumeLevelValue = document.getElementById('volumeLevelValue');
  if (volumeLevel && volumeLevelValue) {
    volumeLevel.addEventListener('input', () => {
      volumeLevelValue.textContent = volumeLevel.value;
    });
  }

  const speakerVolume = document.getElementById('speakerVolume');
  const speakerVolumeValue = document.getElementById('speakerVolumeValue');
  if (speakerVolume && speakerVolumeValue) {
    speakerVolume.addEventListener('input', () => {
      speakerVolumeValue.textContent = speakerVolume.value;
    });
  }

  // Test microphone button
  const testMicBtn = document.getElementById('testMicBtn');
  if (testMicBtn) {
    testMicBtn.addEventListener('click', async () => {
      if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
      }
      
      // Get selected mic ID
      const micSelect = document.getElementById('micSelect');
      const micId = micSelect ? micSelect.value : null;
      
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ 
          audio: { deviceId: micId ? { exact: micId } : undefined } 
        });
        
        // Remember this selection
        selectedMicId = micId;
        
        // Set up visualizer
        if (micContext) micContext.close();
        micContext = new AudioContext();
        micSource = micContext.createMediaStreamSource(micStream);
        micAnalyser = micContext.createAnalyser();
        micSource.connect(micAnalyser);
        visualizeMic(micAnalyser, 'micCanvas');
        
        // Record briefly to test
        const recorder = new MediaRecorder(micStream);
        const chunks = [];
        
        recorder.ondataavailable = e => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'audio/webm' });
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          
          // Route to selected output device if possible
          if ('setSinkId' in audio) {
            const outputId = document.getElementById('outputSelect').value;
            audio.setSinkId(outputId).then(() => {
              audio.play();
            }).catch(err => {
              console.warn("Couldn't set output device:", err);
              audio.play();
            });
          } else {
            audio.play();
          }
        };
        
        recorder.start();
        setTimeout(() => recorder.stop(), 3000);
        
        showNotification('Testing microphone...', 'info');
      } catch (err) {
        console.error("Error testing microphone:", err);
        showNotification("Failed to access microphone", "error");
      }
    });
  }
  
  // Test audio output
  const testAudioBtn = document.getElementById('testAudioBtn');
  if (testAudioBtn) {
    testAudioBtn.addEventListener('click', () => {
      const outputSelect = document.getElementById('outputSelect');
      const outputId = outputSelect ? outputSelect.value : 'default';
      selectedOutputId = outputId;
      
      // Create a test tone (1 second beep)
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(440, audioCtx.currentTime); // A4 note
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.start();
      setTimeout(() => {
        oscillator.stop();
        audioCtx.close();
      }, 1000);
      
      showNotification('Testing speaker...', 'info');
    });
  }

  // Handle audio settings saving
  const saveAudioSettingsBtn = document.getElementById('saveAudioSettingsBtn');
  if (saveAudioSettingsBtn) {
    saveAudioSettingsBtn.addEventListener('click', () => {
      console.log('Saving audio settings...');
      
      // Get settings values
      const micSelect = document.getElementById('micSelect');
      const outputSelect = document.getElementById('outputSelect');
      
      const settings = {
        vad_enabled: document.getElementById('vadEnabled').checked,
        vad_threshold: parseFloat(document.getElementById('vadThreshold').value),
        mic_volume: parseFloat(document.getElementById('volumeLevel').value),
        speaker_volume: parseFloat(document.getElementById('speakerVolume').value),
        mic_id: micSelect ? micSelect.value : null,
        output_id: outputSelect ? outputSelect.value : null
      };
      
      // Store the selected device IDs
      selectedMicId = settings.mic_id;
      selectedOutputId = settings.output_id;
      
      // Send to server
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ 
          type: 'audio_settings', 
          settings: settings 
        }));
        showNotification('Audio settings saved', 'success');
      } else {
        showNotification('Cannot save settings: not connected to server', 'error');
      }
      
      document.getElementById('settingsModal').classList.add('hidden');
      
      // Stop any streams
      if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
      }
    });
  }

  // Start session timer
  sessionStartTime = new Date();
  setInterval(updateSessionDuration, 1000);
  
  // Microphone toggle button functionality
  const micToggleBtn = document.getElementById('micToggleBtn');
  if (micToggleBtn) {
    micToggleBtn.addEventListener('click', async () => {
      console.log('Mic button clicked, isRecording:', isRecording);
    
      if (isRecording) {
        stopRecording();
        
        // Reset mic status immediately when stopping
        const micStatusElement = document.getElementById('micStatus');
        if (micStatusElement) {
          micStatusElement.textContent = 'Click to speak';
        }
      } else {
        try {
          // Use selected microphone if available
          const constraints = { 
            audio: selectedMicId ? { deviceId: { exact: selectedMicId } } : true 
          };
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          console.log('Mic stream acquired');
          micStream = stream;
    
          // Now call startRecording with the stream
          startRecording(stream);
        } catch (err) {
          console.error("Mic access denied or error:", err);
          const micStatus = document.getElementById("micStatus");
          if (micStatus) micStatus.textContent = "Mic access denied";
        }
      }
    });
  }
  
  // Settings modal handling
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  
  if (settingsBtn) {
    settingsBtn.addEventListener('click', async () => {
      console.log('Settings button clicked');
      // Refresh audio devices when opening settings
      await populateAudioDevices();
      if (settingsModal) settingsModal.classList.remove('hidden');
    });
  }
  
  if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener('click', () => {
      console.log('Close settings button clicked');
      if (settingsModal) settingsModal.classList.add('hidden');
      
      // Stop any test streams when closing
      if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
      }
    });
  }
  
  // VAD enabled checkbox
  const vadEnabled = document.getElementById('vadEnabled');
  const micStatus = document.getElementById('micStatus');
  if (vadEnabled && micStatus) {
    vadEnabled.addEventListener('change', () => {
      micStatus.textContent = vadEnabled.checked ? "Auto-detection enabled" : "Click to speak";
    });
  }
  console.log('Chat UI setup complete');
});

function testAudioPlayback() {
  if (!window.audioContext) {
    window.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  if (window.audioContext.state === 'suspended') {
    window.audioContext.resume().then(() => {
      console.log("Audio context resumed for test");
    });
  }

  // Generate a sine wave for 1 second
  const sampleRate = window.audioContext.sampleRate;
  const duration = 1; // seconds
  const frequency = 440; // Hz (A4)

  const audioBuffer = window.audioContext.createBuffer(1, sampleRate * duration, sampleRate);
  const channelData = audioBuffer.getChannelData(0);

  for (let i = 0; i < channelData.length; i++) {
    channelData[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.5;
  }

  const source = window.audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(window.audioContext.destination);
  source.start();

  console.log("Test audio playing");
  showNotification("Test sound playing", "info");
}

const startRecording = async (stream) => {
  console.log('Starting VAD-only recording...');
  try {
    if (!window.audioContext) {
      window.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    const audioContext = window.audioContext;
    const microphone = audioContext.createMediaStreamSource(stream);
    analyzer = audioContext.createAnalyser();
    microphone.connect(analyzer);
    analyzer.fftSize = 256;

    const bufferLength = analyzer.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const updateAudioLevels = () => {
      if (!isRecording || !audioLevelsChart) return;

      analyzer.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b, 0) / bufferLength;

      const newData = [...audioLevelsChart.data.datasets[0].data.slice(1), average];
      audioLevelsChart.data.datasets[0].data = newData;
      audioLevelsChart.update('none');

      if (isRecording) requestAnimationFrame(updateAudioLevels);
    };

    updateAudioLevels();

    const processorNode = audioContext.createScriptProcessor(4096, 1, 1);
    microphone.connect(processorNode);
    processorNode.connect(audioContext.destination);

    processorNode.onaudioprocess = (e) => {
      if (!isRecording) return;
      const audioSlice = Array.from(e.inputBuffer.getChannelData(0));
      
      console.log(`Sending audio chunk: length=${audioSlice.length}, sample_rate=${audioContext.sampleRate}`);
      
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'audio',
          audio: audioSlice,
          sample_rate: audioContext.sampleRate,
          session_id: SESSION_ID
        }));
      }
    };

    window.processorNode = processorNode;
    isRecording = true;
    document.getElementById('micStatus').textContent = 'Listening...';
    document.getElementById('micToggleBtn').classList.add('pulse');

  } catch (err) {
    console.error('Error starting recording:', err);
    document.getElementById('micStatus').textContent = 'Mic access denied or failed';
  }
};

const stopRecording = () => {
  console.log('Stopping recording...');

  const vadEnabledElement = document.getElementById('vadEnabled');
  const vadEnabled = vadEnabledElement ? vadEnabledElement.checked : true;

  isRecording = false;

  if (vadEnabled) {
    if (window.processorNode) {
      window.processorNode.disconnect();
      window.processorNode = null;
    }
    
    if (micStream) {
      micStream.getTracks().forEach(track => track.stop());
      micStream = null;
    }
    
    const micStatusElement = document.getElementById('micStatus');
    if (micStatusElement) {
      micStatusElement.textContent = 'Voice detection stopped';
    }
    const micToggleBtnElement = document.getElementById('micToggleBtn');
    if (micToggleBtnElement) {
      micToggleBtnElement.classList.remove('pulse');
    }
    
  } else {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      
      if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
      }
      
      const micStatusElement = document.getElementById('micStatus');
      if (micStatusElement) {
        micStatusElement.textContent = 'Processing...';
      }
      
      const micToggleBtnElement = document.getElementById('micToggleBtn');
      if (micToggleBtnElement) {
        micToggleBtnElement.classList.remove('pulse');
      }
    }
  }
};

const sendAudioToServer = async (audioBlob) => {
  console.log('Sending audio to server...');
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioData = new Float32Array(arrayBuffer);
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'audio',
        audio: Array.from(audioData),
        sample_rate: audioContext.sampleRate,
        session_id: SESSION_ID
      }));
    } else {
      console.error('WebSocket not connected');
      document.getElementById('micStatus').textContent = 'Not connected';
    }
    
    document.getElementById('micStatus').textContent = 'Click to speak';
  } catch (error) {
    console.error('Error sending audio to server:', error);
    document.getElementById('micStatus').textContent = 'Error sending audio';
  }
};