# Chadson (Fork of Gemini CLI)

> **Note:** This is a fork of
> [Google's Gemini CLI](https://github.com/google-gemini/gemini-cli) that has
> been modified to work with local Ollama models.

[![License](https://img.shields.io/github/license/google-gemini/gemini-cli)](https://github.com/google-gemini/gemini-cli/blob/main/LICENSE)

![Gemini CLI Screenshot](./docs/assets/gemini-screenshot.png)

**Chadson** is an open-source AI agent that runs **100% locally** using
[Ollama](https://ollama.com). It's based on Google's Gemini CLI but adapted to
work with larger language models that don't natively support tool calling
through **prompt-based tool calling**.

## 🆚 Chadson vs Gemini CLI

| Feature          | Gemini CLI (Original)                | Chadson (This Fork)        |
| ---------------- | ------------------------------------ | -------------------------- |
| **Backend**      | Google Gemini API                    | Local Ollama               |
| **Privacy**      | Cloud-based                          | 100% Local                 |
| **Cost**         | API key required (free tier)         | Completely free            |
| **Models**       | Gemini 2.5 Pro/Flash                 | gemma2:27b, llama3.1, etc. |
| **Tool Calling** | Native Gemini tools                  | Prompt-based tool calling  |
| **Web Search**   | google_web_search (Gemini grounding) | tavily_search (API-based)  |
| **Setup**        | Google account/API key               | Just install Ollama        |

## 🚀 Why Chadson?

- **🔒 100% Local**: All processing happens on your machine - no cloud
  dependencies
- **💰 Completely Free**: No API keys, no quotas, no usage limits
- **🧠 Powerful Models**: Works with gemma2:27b, llama3.1, and other large
  models
- **🔧 Built-in Tools**: File operations, shell commands, web search via Tavily
- **🎯 Prompt-Based Tool Calling**: Innovative approach for models without
  native tool support
- **🌐 Real Web Search**: Tavily integration for live web results (requires free
  API key)
- **🔌 Extensible**: Same MCP (Model Context Protocol) support as Gemini CLI
- **💻 Terminal-first**: Designed for developers who live in the command line
- **🛡️ Open source**: Apache 2.0 licensed

## 📚 What's Different in This Fork?

### 1. **Ollama Backend Integration**

- New `OllamaContentGenerator` that interfaces with Ollama's API
- Uses Ollama's OpenAI-compatible `/v1/chat/completions` endpoint
- Automatically converts between Gemini and Ollama message formats

### 2. **Prompt-Based Tool Calling**

Since models like gemma2:27b don't have native tool calling support, Chadson
uses a clever workaround:

- Tool schemas are injected into the system prompt
- Model responds with JSON tool calls in its output
- Parser extracts and executes the tool calls
- Results are fed back to the model

This works surprisingly well with larger models (27B+ parameters)!

### 3. **Tavily Search Instead of Google Search**

- Replaced `google_web_search` (requires Gemini API) with `tavily_search`
- Get a free Tavily API key at [tavily.com](https://tavily.com) (1,000
  searches/month free)
- Real-time web search that actually works with local models
- Returns AI-optimized results with direct answers and source citations

### 4. **Simplified Setup**

No Google account, no OAuth flow, no API management - just:

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model
ollama pull gemma2:27b

# Run Chadson
/home/ubuntu/llama/chadson -p "What is this codebase?"
```

Learn all about Gemini CLI in our [documentation](https://geminicli.com/docs/).

## 🚀 Why Gemini CLI?

- **🎯 Free tier**: 60 requests/min and 1,000 requests/day with personal Google
  account.
- **🧠 Powerful Gemini 2.5 Pro**: Access to 1M token context window.
- **🔧 Built-in tools**: Google Search grounding, file operations, shell
  commands, web fetching.
- **🔌 Extensible**: MCP (Model Context Protocol) support for custom
  integrations.
- **💻 Terminal-first**: Designed for developers who live in the command line.
- **🛡️ Open source**: Apache 2.0 licensed.

## 📦 Installation

### Pre-requisites

- **Node.js** version 20 or higher (required - v18 won't work)
- **Docker** with GPU support (NVIDIA GPU + NVIDIA Container Toolkit)
- **NVIDIA GPU** with 8GB+ VRAM recommended
- macOS, Linux, or Windows with WSL2

### Quick Install

#### 1. Install Node.js 20+

```bash
# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc  # or ~/.zshrc
nvm install 20
nvm use 20
nvm alias default 20

# Verify
node --version  # Should show v20.x.x
```

#### 2. Setup NVIDIA Docker (for GPU acceleration)

```bash
# Install NVIDIA Container Toolkit
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
    sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit

# Configure Docker
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

# Test GPU access
docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi
```

#### 3. Clone and Build Chadson

```bash
# Clone this repository
git clone https://github.com/kungfuflex/chadson.git
cd chadson

# Install dependencies (will auto-build)
npm install

# Bundle is created automatically
```

#### 4. Start Ollama with GPU

```bash
# Start Ollama in Docker with GPU support
docker-compose -f docker-compose.cuda.yaml up -d

# Pull and create the chadson model
docker exec ollama ollama pull gemma2:27b
docker cp Modelfile ollama:/tmp/Modelfile
docker exec ollama ollama create chadson -f /tmp/Modelfile

# Verify it's running
docker exec ollama ollama list
```

#### 5. Run Chadson

```bash
# Using the startup script (recommended)
./start-chadson.sh

# Or directly
export OLLAMA_BASE_URL=http://localhost:11434
export OLLAMA_MODEL=chadson
node ./bundle/gemini.js

# Or with npm link for global access
npm link
chadson
```

### Configuration Files

Chadson automatically creates configuration in `~/.chadson/`:

- **settings.json** - Auth type set to Ollama
- **.env** - Ollama connection settings
  ```bash
  OLLAMA_BASE_URL=http://localhost:11434
  OLLAMA_MODEL=chadson
  GEMINI_DISABLE_UPDATE_CHECK=true
  ```

See [SETUP.md](./SETUP.md) for complete setup instructions and troubleshooting.

## Release Cadence and Tags

See [Releases](./docs/releases.md) for more details.

### Preview

New preview releases will be published each week at UTC 2359 on Tuesdays. These
releases will not have been fully vetted and may contain regressions or other
outstanding issues. Please help us test and install with `preview` tag.

```bash
npm install -g @google/gemini-cli@preview
```

### Stable

- New stable releases will be published each week at UTC 2000 on Tuesdays, this
  will be the full promotion of last week's `preview` release + any bug fixes
  and validations. Use `latest` tag.

```bash
npm install -g @google/gemini-cli@latest
```

### Nightly

- New releases will be published each week at UTC 0000 each day, This will be
  all changes from the main branch as represented at time of release. It should
  be assumed there are pending validations and issues. Use `nightly` tag.

```bash
npm install -g @google/gemini-cli@nightly
```

## 📋 Key Features

### Code Understanding & Generation

- Query and edit large codebases
- Generate new apps from PDFs, images, or sketches using multimodal capabilities
- Debug issues and troubleshoot with natural language

### Automation & Integration

- Automate operational tasks like querying pull requests or handling complex
  rebases
- Use MCP servers to connect new capabilities, including
  [media generation with Imagen, Veo or Lyria](https://github.com/GoogleCloudPlatform/vertex-ai-creative-studio/tree/main/experiments/mcp-genmedia)
- Run non-interactively in scripts for workflow automation

### Advanced Capabilities

- Ground your queries with built-in
  [Google Search](https://ai.google.dev/gemini-api/docs/grounding) for real-time
  information
- Conversation checkpointing to save and resume complex sessions
- Custom context files (GEMINI.md) to tailor behavior for your projects

### GitHub Integration

Integrate Gemini CLI directly into your GitHub workflows with
[**Gemini CLI GitHub Action**](https://github.com/google-github-actions/run-gemini-cli):

- **Pull Request Reviews**: Automated code review with contextual feedback and
  suggestions
- **Issue Triage**: Automated labeling and prioritization of GitHub issues based
  on content analysis
- **On-demand Assistance**: Mention `@gemini-cli` in issues and pull requests
  for help with debugging, explanations, or task delegation
- **Custom Workflows**: Build automated, scheduled and on-demand workflows
  tailored to your team's needs

## 🔐 Configuration

Chadson uses Ollama instead of Google's Gemini API - no authentication required!

### Ollama Configuration (Default)

```bash
# Set Ollama backend (automatically set by launcher script)
export USE_OLLAMA=true
export OLLAMA_BASE_URL="http://localhost:11434"
export OLLAMA_MODEL="gemma2:27b"

# Run Chadson
chadson
```

### Optional: Tavily Web Search

For real-time web search capabilities, get a free Tavily API key:

```bash
# Get your free key from https://tavily.com (1,000 searches/month free)
export TAVILY_API_KEY="tvly-YOUR-KEY"
```

Without this key, Chadson will still work but the `tavily_search` tool will
return an error message.

### Model Recommendations

| Model            | Size      | Tool Calling      | Speed  | Recommended For                       |
| ---------------- | --------- | ----------------- | ------ | ------------------------------------- |
| **gemma2:27b**   | ~16GB RAM | Prompt-based ⭐   | Medium | Best balance - recommended default    |
| **llama3.1:8b**  | ~5GB RAM  | Native ⭐⭐⭐     | Fast   | Smaller machines, native tool support |
| **llama3.1:70b** | ~40GB RAM | Native ⭐⭐⭐     | Slow   | Maximum capability                    |
| **qwen2.5:14b**  | ~9GB RAM  | Prompt-based ⭐⭐ | Medium | Good alternative to gemma2            |

To change models:

```bash
export OLLAMA_MODEL="llama3.1:8b"
chadson
```

### Compatibility Note

This fork still supports the original Gemini CLI authentication methods (Google
OAuth, API keys, Vertex AI) if you want to use Google's models. Simply don't set
`USE_OLLAMA=true` and follow the original authentication guide.

## 🚀 Getting Started

### Basic Usage

#### Start in current directory

```bash
# Using the launcher script (recommended - sets environment variables)
/home/ubuntu/llama/chadson

# Or directly
export USE_OLLAMA=true
./bundle/gemini.js
```

#### Include multiple directories

```bash
chadson --include-directories ../lib,../docs
```

#### Change Ollama model

```bash
# Use a different model
export OLLAMA_MODEL="llama3.1:8b"
chadson

# Or temporarily
OLLAMA_MODEL="qwen2.5:14b" chadson
```

#### Non-interactive mode for scripts

Get a simple text response:

```bash
chadson -p "Explain the architecture of this codebase"
```

For more advanced scripting, including how to parse JSON and handle errors, use
the `--output-format json` flag to get structured output:

```bash
chadson -p "Explain the architecture of this codebase" --output-format json
```

For real-time event streaming (useful for monitoring long-running operations),
use `--output-format stream-json` to get newline-delimited JSON events:

```bash
chadson -p "Run tests and deploy" --output-format stream-json
```

### Quick Examples

#### Start a new project

```bash
cd new-project/
chadson
> Write me a Discord bot that answers questions using a FAQ.md file I will provide
```

#### Analyze existing code

```bash
git clone https://github.com/your-repo/project
cd project
chadson
> Give me a summary of all of the changes that went in yesterday
```

#### Web search with Tavily

```bash
export TAVILY_API_KEY="tvly-YOUR-KEY"
chadson
> Use tavily_search to find the latest news about AI developments
```

#### Read and modify files

```bash
chadson
> Read package.json and explain what this project does
> Update the README.md to add installation instructions
```

## 📚 Documentation

### Getting Started

- [**Quickstart Guide**](./docs/get-started/index.md) - Get up and running
  quickly.
- [**Authentication Setup**](./docs/get-started/authentication.md) - Detailed
  auth configuration.
- [**Configuration Guide**](./docs/get-started/configuration.md) - Settings and
  customization.
- [**Keyboard Shortcuts**](./docs/cli/keyboard-shortcuts.md) - Productivity
  tips.

### Core Features

- [**Commands Reference**](./docs/cli/commands.md) - All slash commands
  (`/help`, `/chat`, etc).
- [**Custom Commands**](./docs/cli/custom-commands.md) - Create your own
  reusable commands.
- [**Context Files (GEMINI.md)**](./docs/cli/gemini-md.md) - Provide persistent
  context to Gemini CLI.
- [**Checkpointing**](./docs/cli/checkpointing.md) - Save and resume
  conversations.
- [**Token Caching**](./docs/cli/token-caching.md) - Optimize token usage.

### Tools & Extensions

- [**Built-in Tools Overview**](./docs/tools/index.md)
  - [File System Operations](./docs/tools/file-system.md)
  - [Shell Commands](./docs/tools/shell.md)
  - [Web Fetch](./docs/tools/web-fetch.md)
  - **Tavily Search** (replaces Google web search) - See
    `/home/ubuntu/llama/CHADSON_TAVILY_SEARCH.md`
- [**MCP Server Integration**](./docs/tools/mcp-server.md) - Extend with custom
  tools.
- [**Custom Extensions**](./docs/extensions/index.md) - Build and share your own
  commands.

### Chadson-Specific Documentation

- **[CHADSON_README.md](../CHADSON_README.md)** - Complete Chadson user guide
- **[CHADSON_SUCCESS.md](../CHADSON_SUCCESS.md)** - Implementation details and
  architecture
- **[CHADSON_TAVILY_SEARCH.md](../CHADSON_TAVILY_SEARCH.md)** - Tavily search
  integration guide
- **[CHADSON_WEB_SEARCH_STATUS.md](../CHADSON_WEB_SEARCH_STATUS.md)** - Why
  Google web search doesn't work with Ollama

### Advanced Topics

- [**Headless Mode (Scripting)**](./docs/cli/headless.md) - Use Gemini CLI in
  automated workflows.
- [**Architecture Overview**](./docs/architecture.md) - How Gemini CLI works.
- [**IDE Integration**](./docs/ide-integration/index.md) - VS Code companion.
- [**Sandboxing & Security**](./docs/cli/sandbox.md) - Safe execution
  environments.
- [**Trusted Folders**](./docs/cli/trusted-folders.md) - Control execution
  policies by folder.
- [**Enterprise Guide**](./docs/cli/enterprise.md) - Deploy and manage in a
  corporate environment.
- [**Telemetry & Monitoring**](./docs/cli/telemetry.md) - Usage tracking.
- [**Tools API Development**](./docs/core/tools-api.md) - Create custom tools.
- [**Local development**](./docs/local-development.md) - Local development
  tooling.

### Troubleshooting & Support

- [**Troubleshooting Guide**](./docs/troubleshooting.md) - Common issues and
  solutions.
- [**FAQ**](./docs/faq.md) - Frequently asked questions.
- Use `/bug` command to report issues directly from the CLI.

### Using MCP Servers

Configure MCP servers in `~/.gemini/settings.json` to extend Gemini CLI with
custom tools:

```text
> @github List my open pull requests
> @slack Send a summary of today's commits to #dev channel
> @database Run a query to find inactive users
```

See the [MCP Server Integration guide](./docs/tools/mcp-server.md) for setup
instructions.

## 🤝 Contributing

We welcome contributions! Gemini CLI is fully open source (Apache 2.0), and we
encourage the community to:

- Report bugs and suggest features.
- Improve documentation.
- Submit code improvements.
- Share your MCP servers and extensions.

See our [Contributing Guide](./CONTRIBUTING.md) for development setup, coding
standards, and how to submit pull requests.

Check our [Official Roadmap](https://github.com/orgs/google-gemini/projects/11)
for planned features and priorities.

## 📖 Resources

- **[Official Roadmap](./ROADMAP.md)** - See what's coming next.
- **[Changelog](./docs/changelogs/index.md)** - See recent notable updates.
- **[NPM Package](https://www.npmjs.com/package/@google/gemini-cli)** - Package
  registry.
- **[GitHub Issues](https://github.com/google-gemini/gemini-cli/issues)** -
  Report bugs or request features.
- **[Security Advisories](https://github.com/google-gemini/gemini-cli/security/advisories)** -
  Security updates.

### Uninstall

See the [Uninstall Guide](docs/cli/uninstall.md) for removal instructions.

## 🎯 How Prompt-Based Tool Calling Works

Since models like gemma2:27b don't have native tool calling, Chadson uses an
innovative approach:

1. **Tool Schema Injection**: All available tool definitions are injected into
   the system prompt in JSON format
2. **Model Response Parsing**: The model is instructed to respond with JSON when
   it wants to use a tool
3. **Execution & Feedback**: Chadson parses the JSON, executes the tool, and
   feeds the result back
4. **Iterative Loop**: The model can continue calling tools until it has the
   answer

This works well with larger models (27B+) that have good instruction-following
capabilities!

## 🔧 Technical Architecture

### Key Components

1. **OllamaContentGenerator**
   (`packages/core/src/core/ollamaContentGenerator.ts`)
   - Implements the ContentGenerator interface
   - Converts between Gemini and Ollama message formats
   - Handles tool schema injection and response parsing
   - Supports streaming responses

2. **TavilySearchTool** (`packages/core/src/tools/tavily-search.ts`)
   - Replaces Google's web search grounding
   - Integrates with Tavily's search API
   - Returns AI-optimized results with citations

3. **Tool Registry** (Modified)
   - All existing Gemini CLI tools work: read_file, write_file, shell, glob,
     etc.
   - Added: tavily_search
   - Removed: google_web_search (requires Gemini API)

## 📊 Performance Comparison

| Metric                    | Gemini CLI (Cloud) | Chadson (Local)                |
| ------------------------- | ------------------ | ------------------------------ |
| **First Response**        | ~1-2 sec           | ~3-5 sec                       |
| **Tool Calling Accuracy** | Native (99%+)      | Prompt-based (~85-95%)         |
| **Privacy**               | Cloud              | 100% Local                     |
| **Cost**                  | API usage          | $0 (hardware only)             |
| **Internet Required**     | Yes (API)          | No (except web search)         |
| **Context Window**        | 1M tokens          | Model-dependent (128K typical) |

## 📄 Legal

- **License**: [Apache License 2.0](LICENSE)
- **Original Project**:
  [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli)
- **Terms of Service**: [Terms & Privacy](./docs/tos-privacy.md)
- **Security**: [Security Policy](SECURITY.md)

---

<p align="center">
  Chadson: Bringing Gemini CLI to local Ollama models<br>
  Based on the original Gemini CLI built with ❤️ by Google<br>
  Fork maintained by the open source community
</p>
