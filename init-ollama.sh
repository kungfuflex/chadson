#!/bin/bash
set -e

# Start Ollama in the background
/bin/ollama serve &
OLLAMA_PID=$!

# Wait for Ollama to be ready
echo "Waiting for Ollama to start..."
for i in {1..30}; do
    if ollama list >/dev/null 2>&1; then
        echo "Ollama is ready!"
        break
    fi
    sleep 1
done

# Check if model exists, if not pull it
MODEL="gemma2:27b"
if ! ollama list | grep -q "gemma2:27b"; then
    echo "Pulling model $MODEL (this may take 5-10 minutes for ~15GB download)..."
    ollama pull "$MODEL"
    echo "Model $MODEL pulled successfully!"
else
    echo "Model $MODEL already exists."
fi

# Keep the process running
wait $OLLAMA_PID
