#!/bin/bash

cd /home/ubuntu/llama/gemini-cli

echo "Testing google_web_search tool with Chadson"
echo "==========================================="
echo ""
echo "Note: google_web_search requires Google's Gemini API with grounding enabled."
echo "It will NOT work with Ollama as it needs Google's web search integration."
echo ""
echo "Test 1: Asking model to use google_web_search"
echo "----------------------------------------------"

USE_OLLAMA=true OLLAMA_MODEL=gemma2:27b node bundle/gemini.js -p "Use the google_web_search tool to search for 'Python tutorials'. Output the exact JSON format for calling this tool." 2>&1 | grep -v "DeprecationWarning" | grep -v "Use.*trace"

echo ""
echo ""
echo "Test 2: Check what happens when we try to force the tool call"
echo "---------------------------------------------------------------"

# Create a simple script that will show us the tool call attempt
cat > /tmp/test-prompt.txt << 'EOF'
You MUST use the google_web_search tool to search for "AI news".
Output ONLY this JSON format:
{
  "tool_call": {
    "name": "google_web_search",
    "arguments": {
      "query": "AI news"
    }
  }
}
EOF

USE_OLLAMA=true OLLAMA_MODEL=gemma2:27b node bundle/gemini.js -p "$(cat /tmp/test-prompt.txt)" 2>&1 | grep -v "DeprecationWarning" | grep -v "Use.*trace"

rm /tmp/test-prompt.txt

echo ""
echo ""
echo "==========================================="
echo "CONCLUSION:"
echo "==========================================="
echo ""
echo "The google_web_search tool is designed for Google's Gemini API"
echo "and uses Google's web grounding feature which is NOT available"
echo "in Ollama."
echo ""
echo "Alternative solutions:"
echo "1. Use the 'web_fetch' tool to fetch specific URLs"
echo "2. Implement a custom search tool using DuckDuckGo or similar"
echo "3. Use a web scraping service"
echo ""
