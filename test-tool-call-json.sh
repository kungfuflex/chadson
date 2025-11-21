#!/bin/bash

cd /home/ubuntu/llama/gemini-cli

echo "Testing: Can we get the model to output tool call JSON?"
echo "========================================================="
echo ""

# Create a test file that we know exists
echo "Testing 123" > test-tool-output.txt

echo "Test 1: Force JSON output for read_file (should work)"
echo "------------------------------------------------------"

OLLAMA_MODEL=gemma2:27b DEBUG=1 node bundle/gemini.js -p "Output ONLY this JSON to call the read_file tool for test-tool-output.txt: {\"tool_call\": {\"name\": \"read_file\", \"arguments\": {\"file_path\": \"test-tool-output.txt\"}}}" 2>&1 | grep -E "(tool_call|Tool|hasTools|Converting)" | head -20

echo ""
echo ""
echo "Test 2: Force JSON output for google_web_search"
echo "------------------------------------------------"

OLLAMA_MODEL=gemma2:27b DEBUG=1 node bundle/gemini.js -p "Output ONLY this JSON to call google_web_search: {\"tool_call\": {\"name\": \"google_web_search\", \"arguments\": {\"query\": \"test search\"}}}" 2>&1 | grep -E "(tool_call|Tool|hasTools|Converting|Error executing)" | head -20

rm test-tool-output.txt

echo ""
echo ""
echo "========================================================="
echo "ANALYSIS:"
echo "========================================================="
echo ""
echo "If we see 'hasTools: true, toolCall: read_file' - tool calling works!"
echo "If we see 'hasTools: false' - tools aren't being passed to the generator"
echo "If we see 'Error executing tool' - the tool was called but failed"
echo ""
