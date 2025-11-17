# Chadson Setup Guide

## Prerequisites

### 1. Upgrade Node.js to version 20+

Your current Node.js version (18.20.5) is too old. Upgrade using nvm:

```bash
# Install nvm if you don't have it
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash

# Reload shell
source ~/.bashrc  # or ~/.zshrc

# Install Node 20
nvm install 20
nvm use 20
nvm alias default 20

# Verify
node --version  # Should show v20.x.x
```

### 2. GPU Setup (Already Done ✓)

- NVIDIA Container Toolkit installed
- Docker configured for GPU access
- Ollama running with GPU support

## Configuration Files Created

### 1. **~/.chadson/settings.json**

```json
{
  "security": {
    "auth": {
      "selectedType": "ollama"
    }
  },
  "general": {
    "disableAutoUpdate": true
  }
}
```

### 2. **~/.chadson/.env**

```bash
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=chadson
GEMINI_DISABLE_UPDATE_CHECK=true
```

### 3. **/home/ghostinthegrey/chadson/Modelfile**

Defines the chadson personality and parameters.

## Usage

### Start Ollama (if not running)

```bash
docker-compose -f docker-compose.cuda.yaml up -d
```

### Check Ollama is working

```bash
docker ps | grep ollama
docker exec ollama ollama list
```

### Run Chadson CLI

**Option 1: Using the startup script**

```bash
cd /home/ghostinthegrey/chadson
./start-chadson.sh
```

**Option 2: Direct execution**

```bash
cd /home/ghostinthegrey/chadson
export OLLAMA_BASE_URL=http://localhost:11434
export OLLAMA_MODEL=chadson
node ./bundle/gemini.js
```

**Option 3: With npm link (recommended for global access)**

```bash
cd /home/ghostinthegrey/chadson
npm link
# Now you can run from anywhere:
chadson
```

## Model Management

### Switch to a faster model

The current `gemma2:27b` model is slow on your 8GB GPU. Use a smaller model:

```bash
# Pull a faster model
docker exec ollama ollama pull qwen2.5:7b

# Update Modelfile (change first line)
FROM qwen2.5:7b

# Recreate chadson
docker cp /home/ghostinthegrey/chadson/Modelfile ollama:/tmp/Modelfile
docker exec ollama ollama create chadson -f /tmp/Modelfile

# Or update env variable to use a different model directly
export OLLAMA_MODEL=qwen2.5:7b
```

### Available models by speed (fastest to slowest):

- `qwen2.5:3b` - Fastest, good for simple tasks
- `qwen2.5:7b` - Best balance for 8GB GPU
- `qwen2.5:14b` - Slower but smarter
- `gemma2:27b` - Current, very slow on 8GB

## Troubleshooting

### "Ollama is not running"

```bash
docker-compose -f docker-compose.cuda.yaml up -d
docker logs ollama
```

### "chadson model not found"

```bash
docker cp /home/ghostinthegrey/chadson/Modelfile ollama:/tmp/Modelfile
docker exec ollama ollama create chadson -f /tmp/Modelfile
```

### Check GPU usage

```bash
watch -n 1 nvidia-smi
```

### CLI not working

1. Check Node version: `node --version` (must be 20+)
2. Check bundle exists: `ls -la bundle/gemini.js`
3. Rebuild if needed: `npm run bundle`

## Features

- Full chat interface with Ollama
- Tool calling support (file operations, code execution, etc.)
- Custom personality via Modelfile
- GPU acceleration
- Offline operation (no API keys needed)

## Next Steps

1. Upgrade Node.js to version 20+
2. Test the CLI: `./start-chadson.sh`
3. Consider switching to a faster model for better performance
4. Customize the Modelfile personality as needed
