import os
import runpod
import subprocess
import threading
import signal
import time
import logging
import requests
from typing import Dict, Any

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Global variables
fastapi_process = None
SERVER_PORT = 8000
SERVER_HOST = "0.0.0.0"
SERVER_URL = f"http://127.0.0.1:{SERVER_PORT}"
startup_complete = False

def start_fastapi_server():
    """Start the FastAPI server as a subprocess"""
    global fastapi_process, startup_complete
    
    try:
        # Start the FastAPI server
        logger.info("Starting FastAPI server...")
        cmd = ["python", "/app/main.py"]
        fastapi_process = subprocess.Popen(
            cmd, 
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True
        )
        
        # Monitor the output to determine when the server is ready
        for line in iter(fastapi_process.stdout.readline, ""):
            logger.info(f"Server output: {line.strip()}")
            if "Uvicorn running on" in line:
                startup_complete = True
                logger.info("FastAPI server has started successfully!")
                break
        
        # Continue reading output in the background
        def read_output():
            for line in iter(fastapi_process.stdout.readline, ""):
                logger.info(f"Server: {line.strip()}")
        
        output_thread = threading.Thread(target=read_output, daemon=True)
        output_thread.start()
        
        # Wait for the server to start
        timeout = 60  # 60 seconds timeout
        start_time = time.time()
        while not startup_complete and time.time() - start_time < timeout:
            time.sleep(1)
            
            # Try to connect to the server
            try:
                response = requests.get(f"{SERVER_URL}/")
                if response.status_code == 200:
                    startup_complete = True
                    logger.info("Successfully connected to the FastAPI server!")
                    break
            except requests.exceptions.ConnectionError:
                pass
        
        if not startup_complete:
            logger.error("Failed to start the FastAPI server within the timeout period!")
            if fastapi_process:
                fastapi_process.terminate()
                fastapi_process = None
    
    except Exception as e:
        logger.error(f"Error starting FastAPI server: {e}")
        if fastapi_process:
            fastapi_process.terminate()
            fastapi_process = None

# Start the FastAPI server when the handler module is loaded
start_fastapi_server()

def handler(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    RunPod handler function to process API requests.
    
    This handler serves as a proxy to the internal FastAPI server.
    It forwards requests to the internal server and returns the responses.
    
    Args:
        event: Dictionary containing the request input.
            - endpoint: API endpoint to call (e.g., "/chat", "/setup")
            - method: HTTP method (GET, POST, etc.)
            - data: Request payload (for POST, PUT, etc.)
            
    Returns:
        Dictionary with the response from the FastAPI server.
    """
    if not startup_complete or not fastapi_process:
        return {"error": "FastAPI server is not running"}
        
    try:
        input_data = event.get("input", {})
        endpoint = input_data.get("endpoint", "/")
        method = input_data.get("method", "GET").upper()
        data = input_data.get("data", {})
        
        url = f"{SERVER_URL}{endpoint}"
        
        logger.info(f"Forwarding {method} request to {url}")
        
        # Make the request to the FastAPI server
        if method == "GET":
            response = requests.get(url)
        elif method == "POST":
            response = requests.post(url, json=data)
        elif method == "PUT":
            response = requests.put(url, json=data)
        elif method == "DELETE":
            response = requests.delete(url)
        else:
            return {"error": f"Unsupported HTTP method: {method}"}
        
        # Return the response
        try:
            return {
                "status_code": response.status_code,
                "content_type": response.headers.get("Content-Type"),
                "data": response.json() if "application/json" in response.headers.get("Content-Type", "") else response.text
            }
        except ValueError:
            # If not JSON, return as text
            return {
                "status_code": response.status_code,
                "content_type": response.headers.get("Content-Type"),
                "data": response.text
            }
    
    except Exception as e:
        logger.error(f"Error handling request: {e}")
        return {"error": str(e)}

# Cleanup when the pod is terminated
def cleanup(signum, frame):
    """Clean up resources when the pod is being terminated"""
    logger.info("Received termination signal, cleaning up...")
    if fastapi_process:
        fastapi_process.terminate()
        fastapi_process.wait(timeout=5)
    logger.info("Cleanup complete.")
    exit(0)

# Register signal handlers
signal.signal(signal.SIGTERM, cleanup)
signal.signal(signal.SIGINT, cleanup)

# Start the RunPod serverless handler
if __name__ == "__main__":
    runpod.serverless.start({"handler": handler}) 