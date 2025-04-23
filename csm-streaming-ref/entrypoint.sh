#!/bin/bash
set -e

echo "Starting CSM streaming app initialization..."

# Create a default configuration if it doesn't exist
if [ ! -f "/app/config.json" ]; then
    echo "Creating default configuration..."
    cat > /app/config.json << EOF
{
    "system_prompt": "You are an AI assistant. Be concise and helpful.",
    "reference_audio_path": "/app/audio/reference_voice.wav",
    "reference_text": "This is a reference voice sample.",
    "model_path": "/app/models/csm-1b",
    "llm_path": "/app/models/llm",
    "max_tokens": 8192,
    "voice_speaker_id": 0,
    "vad_enabled": true,
    "vad_threshold": 0.5,
    "embedding_model": "all-MiniLM-L6-v2"
}
EOF
fi

# Download CSM model if it doesn't exist
if [ ! -f "/app/models/csm-1b/model.safetensors" ]; then
    echo "Downloading CSM model..."
    # Replace this with the actual download logic for your CSM model
    # Example: huggingface-cli download MODEL_NAME /app/models/csm-1b
    # Or curl/wget commands to download from a URL
    python -c '
import os
from huggingface_hub import snapshot_download
os.makedirs("/app/models/csm-1b", exist_ok=True)
snapshot_download(repo_id="META-Labs/CSM-1B", local_dir="/app/models/csm-1b")
'
fi

# Download LLM if it doesn't exist
if [ ! -d "/app/models/llm" ] || [ -z "$(ls -A /app/models/llm)" ]; then
    echo "Downloading LLM model..."
    # Replace this with the actual download logic for your LLM
    # Example for a small model like Phi-2 for testing
    python -c '
import os
from huggingface_hub import snapshot_download
os.makedirs("/app/models/llm", exist_ok=True)
snapshot_download(repo_id="microsoft/phi-2", local_dir="/app/models/llm")
'
fi

# Check if we need to create templates
if [ ! -f "/app/templates/chat.html" ]; then
    echo "Creating basic templates..."
    
    # Create chat.html if it doesn't exist
    cat > /app/templates/chat.html << EOF
<!DOCTYPE html>
<html>
<head>
    <title>CSM Streaming Chat</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
        #chat { height: 70vh; overflow-y: scroll; border: 1px solid #ccc; padding: 10px; margin-bottom: 10px; }
        #controls { display: flex; margin-bottom: 10px; }
        button { padding: 10px; margin-right: 5px; }
        .user-message { background: #e6f7ff; padding: 10px; border-radius: 5px; margin: 5px 0; }
        .ai-message { background: #f0f0f0; padding: 10px; border-radius: 5px; margin: 5px 0; }
    </style>
</head>
<body>
    <h1>CSM Streaming Chat</h1>
    <div id="chat"></div>
    <div id="controls">
        <button id="startButton">Start Recording</button>
        <button id="stopButton" disabled>Stop Recording</button>
        <button id="interruptButton">Interrupt</button>
    </div>
    <div id="status">Status: Ready</div>

    <script>
        const chatDiv = document.getElementById('chat');
        const startButton = document.getElementById('startButton');
        const stopButton = document.getElementById('stopButton');
        const interruptButton = document.getElementById('interruptButton');
        const statusDiv = document.getElementById('status');
        
        let ws;
        let mediaRecorder;
        let audioChunks = [];
        let isRecording = false;
        let audioContext;
        let audioQueue = [];
        let isPlaying = false;
        
        // Connect to WebSocket
        function connectWebSocket() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = \`\${protocol}//\${window.location.host}/ws\`;
            ws = new WebSocket(wsUrl);
            
            ws.onopen = () => {
                statusDiv.textContent = 'Status: Connected';
                console.log('WebSocket connected');
            };
            
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                console.log('Received message:', data);
                
                if (data.type === 'transcription') {
                    appendMessage('You', data.text);
                } else if (data.type === 'response') {
                    appendMessage('AI', data.text);
                } else if (data.type === 'audio_chunk') {
                    playAudioChunk(data.audio, data.sample_rate);
                } else if (data.type === 'status') {
                    statusDiv.textContent = 'Status: ' + data.message;
                } else if (data.type === 'audio_status') {
                    if (data.status === 'complete') {
                        statusDiv.textContent = 'Status: Audio complete';
                    } else if (data.status === 'interrupted') {
                        statusDiv.textContent = 'Status: Interrupted';
                    }
                }
            };
            
            ws.onclose = () => {
                statusDiv.textContent = 'Status: Disconnected';
                console.log('WebSocket disconnected, attempting to reconnect...');
                setTimeout(connectWebSocket, 3000);
            };
            
            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                statusDiv.textContent = 'Status: Error - See console';
            };
        }
        
        // Initialize audio playback
        function initAudioContext() {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        // Append message to chat
        function appendMessage(sender, text) {
            const messageDiv = document.createElement('div');
            messageDiv.className = sender === 'You' ? 'user-message' : 'ai-message';
            messageDiv.innerHTML = \`<strong>\${sender}:</strong> \${text}\`;
            chatDiv.appendChild(messageDiv);
            chatDiv.scrollTop = chatDiv.scrollHeight;
        }
        
        // Play audio chunk
        function playAudioChunk(audioData, sampleRate) {
            if (!audioContext) {
                initAudioContext();
            }
            
            const audioArray = new Float32Array(audioData);
            const audioBuffer = audioContext.createBuffer(1, audioArray.length, sampleRate);
            audioBuffer.getChannelData(0).set(audioArray);
            
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            source.start();
        }
        
        // Start recording
        startButton.addEventListener('click', async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                
                mediaRecorder.ondataavailable = (event) => {
                    audioChunks.push(event.data);
                };
                
                mediaRecorder.onstop = async () => {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                    audioChunks = [];
                    
                    // Convert to float32 array
                    const arrayBuffer = await audioBlob.arrayBuffer();
                    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                    const audioData = audioBuffer.getChannelData(0);
                    
                    // Send to server
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'audio',
                            audio: Array.from(audioData),
                            sample_rate: audioBuffer.sampleRate
                        }));
                        statusDiv.textContent = 'Status: Processing audio...';
                    }
                };
                
                mediaRecorder.start();
                isRecording = true;
                startButton.disabled = true;
                stopButton.disabled = false;
                statusDiv.textContent = 'Status: Recording...';
            } catch (error) {
                console.error('Error accessing microphone:', error);
                statusDiv.textContent = 'Status: Microphone error - See console';
            }
        });
        
        // Stop recording
        stopButton.addEventListener('click', () => {
            if (mediaRecorder && isRecording) {
                mediaRecorder.stop();
                isRecording = false;
                startButton.disabled = false;
                stopButton.disabled = true;
            }
        });
        
        // Interrupt button
        interruptButton.addEventListener('click', () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'interrupt' }));
                statusDiv.textContent = 'Status: Interrupting...';
            }
        });
        
        // Initialize connection
        connectWebSocket();
    </script>
</body>
</html>
EOF

    # Create setup.html if it doesn't exist
    cat > /app/templates/setup.html << EOF
<!DOCTYPE html>
<html>
<head>
    <title>CSM Setup</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
        form { max-width: 600px; margin: 0 auto; }
        label { display: block; margin-top: 10px; }
        input, textarea { width: 100%; padding: 8px; margin-top: 5px; }
        button { padding: 10px; margin-top: 20px; background: #4CAF50; color: white; border: none; cursor: pointer; }
    </style>
</head>
<body>
    <h1>CSM Configuration</h1>
    <form id="configForm">
        <label for="systemPrompt">System Prompt:</label>
        <textarea id="systemPrompt" rows="4"></textarea>
        
        <label for="modelPath">CSM Model Path:</label>
        <input type="text" id="modelPath" value="/app/models/csm-1b">
        
        <label for="llmPath">LLM Path:</label>
        <input type="text" id="llmPath" value="/app/models/llm">
        
        <label for="maxTokens">Max Tokens:</label>
        <input type="number" id="maxTokens" value="8192">
        
        <label for="vadEnabled">VAD Enabled:</label>
        <input type="checkbox" id="vadEnabled" checked>
        
        <label for="vadThreshold">VAD Threshold:</label>
        <input type="number" id="vadThreshold" step="0.1" value="0.5">
        
        <button type="submit">Save Configuration</button>
    </form>
    
    <div id="status" style="margin-top: 20px;"></div>
    
    <script>
        const form = document.getElementById('configForm');
        const statusDiv = document.getElementById('status');
        let ws;
        
        // Connect to WebSocket
        function connectWebSocket() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = \`\${protocol}//\${window.location.host}/ws\`;
            ws = new WebSocket(wsUrl);
            
            ws.onopen = () => {
                console.log('WebSocket connected');
                ws.send(JSON.stringify({ type: 'request_saved_config' }));
            };
            
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                console.log('Received message:', data);
                
                if (data.type === 'saved_config' && data.config) {
                    document.getElementById('systemPrompt').value = data.config.system_prompt || '';
                    document.getElementById('modelPath').value = data.config.model_path || '/app/models/csm-1b';
                    document.getElementById('llmPath').value = data.config.llm_path || '/app/models/llm';
                    document.getElementById('maxTokens').value = data.config.max_tokens || 8192;
                    document.getElementById('vadEnabled').checked = data.config.vad_enabled !== false;
                    document.getElementById('vadThreshold').value = data.config.vad_threshold || 0.5;
                } else if (data.type === 'status') {
                    statusDiv.textContent = data.message;
                }
            };
            
            ws.onclose = () => {
                console.log('WebSocket disconnected, attempting to reconnect...');
                setTimeout(connectWebSocket, 3000);
            };
        }
        
        // Handle form submission
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const config = {
                system_prompt: document.getElementById('systemPrompt').value,
                reference_audio_path: '/app/audio/reference_voice.wav',
                reference_text: 'This is a reference voice sample.',
                model_path: document.getElementById('modelPath').value,
                llm_path: document.getElementById('llmPath').value,
                max_tokens: parseInt(document.getElementById('maxTokens').value),
                voice_speaker_id: 0,
                vad_enabled: document.getElementById('vadEnabled').checked,
                vad_threshold: parseFloat(document.getElementById('vadThreshold').value),
                embedding_model: 'all-MiniLM-L6-v2'
            };
            
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'config', config }));
                statusDiv.textContent = 'Saving configuration...';
            } else {
                statusDiv.textContent = 'WebSocket not connected. Please refresh the page.';
            }
        });
        
        // Initialize connection
        connectWebSocket();
    </script>
</body>
</html>
EOF

    # Create crud.html template
    cat > /app/templates/crud.html << EOF
<!DOCTYPE html>
<html>
<head>
    <title>Conversation History</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
        .conversation { border: 1px solid #ccc; padding: 15px; margin-bottom: 15px; border-radius: 5px; }
        .user-message { background: #e6f7ff; padding: 10px; border-radius: 5px; margin: 5px 0; }
        .ai-message { background: #f0f0f0; padding: 10px; border-radius: 5px; margin: 5px 0; }
        button { padding: 8px; margin-right: 5px; }
    </style>
</head>
<body>
    <h1>Conversation History</h1>
    <button id="clearAllBtn">Clear All Conversations</button>
    <div id="conversationsContainer"></div>
    
    <script>
        const container = document.getElementById('conversationsContainer');
        const clearAllBtn = document.getElementById('clearAllBtn');
        
        // Load conversations
        async function loadConversations() {
            try {
                const response = await fetch('/api/conversations');
                const conversations = await response.json();
                
                container.innerHTML = '';
                conversations.forEach(conv => {
                    const convDiv = document.createElement('div');
                    convDiv.className = 'conversation';
                    convDiv.innerHTML = \`
                        <div class="user-message"><strong>User:</strong> \${conv.user_message}</div>
                        <div class="ai-message"><strong>AI:</strong> \${conv.ai_message}</div>
                        <button onclick="deleteConversation(\${conv.id})">Delete</button>
                    \`;
                    container.appendChild(convDiv);
                });
            } catch (error) {
                console.error('Error loading conversations:', error);
            }
        }
        
        // Delete conversation
        async function deleteConversation(id) {
            if (confirm('Are you sure you want to delete this conversation?')) {
                try {
                    await fetch(\`/api/conversations/\${id}\`, { method: 'DELETE' });
                    loadConversations();
                } catch (error) {
                    console.error('Error deleting conversation:', error);
                }
            }
        }
        
        // Clear all conversations
        clearAllBtn.addEventListener('click', async () => {
            if (confirm('Are you sure you want to delete ALL conversations?')) {
                try {
                    await fetch('/api/conversations', { method: 'DELETE' });
                    loadConversations();
                } catch (error) {
                    console.error('Error clearing conversations:', error);
                }
            }
        });
        
        // Initial load
        loadConversations();
    </script>
</body>
</html>
EOF
fi

# Create a simple reference voice file if it doesn't exist
if [ ! -f "/app/audio/reference_voice.wav" ]; then
    echo "Creating empty reference voice file..."
    touch /app/audio/reference_voice.wav
fi

# Start the application
echo "Starting the FastAPI application..."
exec python /app/main.py 