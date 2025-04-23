# CSM Streaming Application - RunPod Deployment Guide

This guide explains how to deploy the CSM (Compositional Streaming Model) speech application to RunPod using GitHub integration.

## Overview

The CSM streaming application is a real-time conversational AI that:
- Processes audio input via WebSocket connections
- Transcribes speech using Whisper
- Generates responses using an LLM
- Synthesizes speech using the CSM-1B model
- Streams the audio back to the browser

## Deployment Steps

### 1. Prerequisites

- A GitHub account with this repository
- A RunPod.io account with adequate credits
- GPU resources (recommended for optimal performance)

### 2. RunPod GitHub Integration

1. Go to the RunPod dashboard and navigate to the "Serverless" section
2. Click on "+ New Endpoint"
3. Select "GitHub Repo"
4. Connect your GitHub account if not already connected
5. Select this repository
6. Configure deployment:
   - Branch: `main` (or your preferred branch)
   - Dockerfile path: `Dockerfile` (root of the repository)
7. Configure compute:
   - Select a GPU option (A10 or better recommended)
   - Set min/max workers (1/1 is fine for testing)
   - Configure memory limit (at least 16GB recommended)
8. Click "Deploy"

### 3. Accessing the Application

Once deployed, RunPod will provide an endpoint URL. You can access the application through:

- `/` - Redirects to setup page
- `/setup` - Configure models and system parameters
- `/chat` - Main conversation interface
- `/crud` - Conversation history management

### 4. Model Configuration

The application automatically downloads models at startup:
- CSM-1B model from the Hugging Face Hub (META-Labs/CSM-1B)
- LLM from the Hugging Face Hub (microsoft/phi-2 by default, but configurable)

You can change model paths in the setup interface.

### 5. Customization

You can customize the system prompt and other parameters in the setup page.

## Development and Customization

### Key Files

- `Dockerfile` - Container definition for RunPod
- `entrypoint.sh` - Startup script that prepares the environment
- `handler.py` - RunPod serverless handler to interface with the API
- `csm-streaming-ref/` - The main application code

### Modifying Templates

The application templates are generated at startup if they don't exist. If you want to customize them:

1. Modify the HTML templates in the `entrypoint.sh` file
2. Or, deploy once, then use the RunPod web terminal to edit the files directly at `/app/templates/`

## Troubleshooting

- **Slow Performance**: Try increasing GPU resources in RunPod configuration
- **Model Download Errors**: Check for errors in the container logs
- **Connection Issues**: Ensure WebSocket connections are being correctly established

## Additional Resources

- [RunPod Documentation](https://docs.runpod.io/serverless/github-integration)
- [CSM-1B Model Information](https://huggingface.co/META-Labs/CSM-1B) 