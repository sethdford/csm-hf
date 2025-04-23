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
# Assumes build context contains the submodule structure
COPY csm-streaming-ref/requirements.txt ./

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir runpod

# Copy the entire application submodule code into the container's /app directory
COPY ./csm-streaming-ref/ /app/

# Create necessary directories (some might be created by the COPY above)
RUN mkdir -p /app/audio/user /app/audio/ai /app/audio/fallback /app/embeddings_cache /app/static /app/templates

# For model handling, we'll use a download at runtime approach
# Create directories where models will be downloaded
RUN mkdir -p /app/models/csm-1b /app/models/llm

# Expose the port the application runs on
EXPOSE 8000

# Make the entrypoint script executable (it should be at /app/entrypoint.sh now)
RUN chmod +x /app/entrypoint.sh

# Command to run the application
ENTRYPOINT ["/app/entrypoint.sh"] 