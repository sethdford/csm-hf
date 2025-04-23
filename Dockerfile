# Use a Python base image with PyTorch pre-installed for better compatibility
FROM pytorch/pytorch:2.0.1-cuda11.7-cudnn8-runtime

# Set the working directory inside the container
WORKDIR /app

# Install essential system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    build-essential \
    portaudio19-dev \
    ffmpeg \
    libsqlite3-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy only the requirements file first to leverage Docker layer caching
COPY csm-streaming-ref/requirements.txt ./

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir runpod

# Copy the application code into the container
COPY ./csm-streaming-ref/ /app/

# Create necessary directories
RUN mkdir -p /app/audio/user /app/audio/ai /app/audio/fallback /app/embeddings_cache /app/static /app/templates

# For model handling, we'll use a download at runtime approach
# We'll create directories where models will be downloaded
RUN mkdir -p /app/models/csm-1b /app/models/llm

# Expose the port the application runs on
EXPOSE 8000

# Add an entrypoint script to handle model downloads and startup
COPY entrypoint.sh /app/
RUN chmod +x /app/entrypoint.sh

# Command to run the application
ENTRYPOINT ["/app/entrypoint.sh"] 