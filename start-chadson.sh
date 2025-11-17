#!/bin/bash

# Start Chadson CLI with Ollama backend

# Set environment variables
export OLLAMA_BASE_URL=http://localhost:11434
export OLLAMA_MODEL=chadson
export GEMINI_DISABLE_UPDATE_CHECK=true

# Check if Ollama is running
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "Error: Ollama is not running on http://localhost:11434"
    echo "Start it with: docker-compose -f docker-compose.cuda.yaml up -d"
    exit 1
fi

# Check if chadson model exists
if ! docker exec ollama ollama list | grep -q "chadson"; then
    echo "Error: chadson model not found"
    echo "Create it with: docker cp Modelfile ollama:/tmp/ && docker exec ollama ollama create chadson -f /tmp/Modelfile"
    exit 1
fi

# Run the CLI
exec node ./bundle/gemini.js "$@"
