/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
  Content,
  Part,
  FunctionCall,
  Tool,
} from '@google/genai';
import { FinishReason } from '@google/genai';
import type { ContentGenerator } from './contentGenerator.js';
import { debugLogger } from '../utils/debugLogger.js';

// Helper functions to normalize inputs
function normalizeContents(contents: unknown): Content[] {
  if (typeof contents === 'string') {
    return [{ role: 'user', parts: [{ text: contents }] }];
  }
  if (Array.isArray(contents)) {
    return contents.map((c) => {
      if (typeof c === 'string') {
        return { role: 'user', parts: [{ text: c }] };
      }
      return c as Content;
    });
  }
  return [contents as Content];
}

function normalizeParts(parts: unknown): Part[] {
  if (!parts) return [];
  if (typeof parts === 'string') {
    return [{ text: parts }];
  }
  if (Array.isArray(parts)) {
    return parts.map((p) => {
      if (typeof p === 'string') {
        return { text: p };
      }
      return p as Part;
    });
  }
  return [parts as Part];
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OllamaStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
}

/**
 * ContentGenerator implementation that uses Ollama's OpenAI-compatible API.
 * Since gemma2:27b doesn't support native tool calling, we use prompt engineering
 * to make the model emit tool calls in a parseable JSON format.
 */
export class OllamaContentGenerator implements ContentGenerator {
  private baseUrl: string;
  private model: string;

  constructor(
    baseUrl: string = 'http://localhost:11434',
    model: string = 'qwen2.5:14b',
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.model = model;
    debugLogger.log(
      `OllamaContentGenerator initialized: ${this.baseUrl} with model ${this.model}`,
    );
  }

  /**
   * Converts Gemini Content format to Ollama messages format.
   */
  private convertToOllamaMessages(
    contents: Content[],
    systemInstruction?: string | Part | Part[] | Content,
  ): OllamaMessage[] {
    const messages: OllamaMessage[] = [];

    // Add system instruction if provided
    if (systemInstruction) {
      let systemText = '';
      if (typeof systemInstruction === 'string') {
        systemText = systemInstruction;
      } else if ('parts' in systemInstruction) {
        systemText = this.partsToText(systemInstruction.parts);
      } else if (Array.isArray(systemInstruction)) {
        systemText = this.partsToText(systemInstruction);
      } else if ('text' in systemInstruction) {
        systemText = systemInstruction.text || '';
      }

      if (systemText) {
        messages.push({ role: 'system', content: systemText });
      }
    }

    // Convert content history
    for (const content of contents) {
      const role =
        content.role === 'model' ? 'assistant' : (content.role as 'user');
      const text = this.partsToText(content.parts || []);

      if (text) {
        messages.push({ role, content: text });
      }
    }

    return messages;
  }

  /**
   * Converts Gemini Parts to plain text.
   * For tool calls, we format them as JSON for the model to see.
   * For function responses, we format them as text results.
   */
  private partsToText(parts: Part[] | undefined): string {
    if (!parts || parts.length === 0) {
      return '';
    }
    const textParts: string[] = [];

    for (const part of parts) {
      if (part.text) {
        textParts.push(part.text);
      } else if (part.functionCall) {
        // Format function call as JSON for the model to see in history
        const toolCall = {
          tool_call: {
            name: part.functionCall.name,
            arguments: part.functionCall.args,
          },
        };
        textParts.push(`\n${JSON.stringify(toolCall, null, 2)}\n`);
      } else if (part.functionResponse) {
        // Format function response as text result
        const response = part.functionResponse.response;
        let responseText = '';

        if (response && typeof response === 'object') {
          if ('llmContent' in response) {
            responseText = String(
              (response as Record<string, unknown>)['llmContent'],
            );
          } else {
            responseText = JSON.stringify(response);
          }
        } else if (response) {
          responseText = String(response);
        }

        textParts.push(
          `\nTool "${part.functionResponse.name}" returned:\n${responseText}\n`,
        );
      } else if (part.inlineData) {
        textParts.push(`[Inline data: ${part.inlineData.mimeType}]`);
      } else if (part.fileData) {
        textParts.push(`[File: ${part.fileData.fileUri}]`);
      }
    }

    return textParts.join('');
  }

  /**
   * Adds tool calling instructions to the system prompt.
   */
  private addToolInstructions(
    systemInstruction: string,
    tools?: Tool[],
  ): string {
    if (!tools || tools.length === 0) {
      return systemInstruction;
    }

    const firstTool = tools[0];
    if (
      !('functionDeclarations' in firstTool) ||
      !firstTool.functionDeclarations
    ) {
      return systemInstruction;
    }

    const functionDeclarations = firstTool.functionDeclarations;
    if (functionDeclarations.length === 0) {
      return systemInstruction;
    }

    const toolsDescription = functionDeclarations.map((fn) => ({
      name: fn.name || 'unknown',
      description: fn.description || '',
      parameters: fn.parameters || {},
    }));

    // Build tool descriptions with required parameters clearly marked
    const toolDescriptions = toolsDescription
      .map((tool) => {
        const props = tool.parameters.properties || {};
        const required = tool.parameters.required || [];
        const paramsList = Object.entries(props)
          .map(([key, value]: [string, any]) => {
            const isRequired = required.includes(key);
            const desc = value.description || '';
            return `    ${key}${isRequired ? ' (required)' : ' (optional)'}: ${value.type} - ${desc}`;
          })
          .join('\n');

        return `${tool.name}: ${tool.description}
  Parameters:
${paramsList || '    (none)'}`;
      })
      .join('\n\n');

    const toolPrompt = `

You have access to these tools. Only use them when the user explicitly requests an action:

${toolDescriptions}

To call a tool, respond with JSON using the EXACT parameter names shown above:
\`\`\`json
{"tool_call": {"name": "tool_name", "arguments": {"param_name": "value"}}}
\`\`\`

IMPORTANT:
- Use the exact parameter names from the tool definition (e.g., "dir_path" not "directory_path")
- Include all required parameters
- For questions or conversation, respond with normal text (no JSON)

`;

    return systemInstruction + toolPrompt;
  }

  /**
   * Parses the model's response for tool calls.
   * Returns the extracted tool call or null if none found.
   * Only recognizes tool calls that match actual available tools.
   */
  private parseToolCall(
    text: string,
    availableTools?: Tool[],
  ): FunctionCall | null {
    debugLogger.log(
      `[OllamaContentGenerator] parseToolCall input: ${text.substring(0, 200)}...`,
    );

    // Try to find JSON in code blocks first
    const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    let jsonText = codeBlockMatch ? codeBlockMatch[1] : null;

    debugLogger.log(
      `[OllamaContentGenerator] codeBlockMatch: ${jsonText ? 'found' : 'not found'}`,
    );

    // If no code block, try to extract JSON object from the text
    if (!jsonText) {
      // Look for a JSON object containing "tool_call" - use a more sophisticated approach
      // to handle nested objects properly
      const toolCallIndex = text.indexOf('"tool_call"');
      if (toolCallIndex !== -1) {
        // Find the opening brace before "tool_call"
        let openBraceIndex = text.lastIndexOf('{', toolCallIndex);
        if (openBraceIndex !== -1) {
          // Count braces to find the matching closing brace
          let braceCount = 0;
          let endIndex = openBraceIndex;
          for (let i = openBraceIndex; i < text.length; i++) {
            if (text[i] === '{') braceCount++;
            else if (text[i] === '}') {
              braceCount--;
              if (braceCount === 0) {
                endIndex = i + 1;
                break;
              }
            }
          }
          if (braceCount === 0) {
            jsonText = text.substring(openBraceIndex, endIndex);
            debugLogger.log(
              `[OllamaContentGenerator] jsonMatch found: ${jsonText.substring(0, 100)}`,
            );
          }
        }
      }
      if (!jsonText) {
        debugLogger.log(`[OllamaContentGenerator] No JSON match found in text`);
      }
    }

    if (!jsonText) {
      return null;
    }

    try {
      const parsed = JSON.parse(jsonText);
      debugLogger.log(
        `[OllamaContentGenerator] Parsed JSON: ${JSON.stringify(parsed)}`,
      );

      if (parsed.tool_call && parsed.tool_call.name) {
        const toolName = parsed.tool_call.name;

        // Validate that the tool actually exists
        if (availableTools && availableTools.length > 0) {
          const firstTool = availableTools[0];
          if (
            'functionDeclarations' in firstTool &&
            firstTool.functionDeclarations
          ) {
            const validToolNames = firstTool.functionDeclarations.map(
              (fn) => fn.name,
            );
            if (!validToolNames.includes(toolName)) {
              debugLogger.log(
                `[OllamaContentGenerator] Tool "${toolName}" not found in available tools: ${validToolNames.join(', ')}`,
              );
              return null;
            }
          }
        }

        const functionCall = {
          name: toolName,
          args: parsed.tool_call.arguments || {},
        };
        debugLogger.log(
          `[OllamaContentGenerator] Extracted tool call: ${JSON.stringify(functionCall)}`,
        );
        return functionCall;
      } else {
        debugLogger.log(
          `[OllamaContentGenerator] JSON does not contain valid tool_call structure`,
        );
      }
    } catch (e) {
      debugLogger.log(`[OllamaContentGenerator] JSON parse error: ${e}`);
    }

    return null;
  }

  /**
   * Converts Ollama response to Gemini GenerateContentResponse format.
   */
  private convertToGeminiResponse(
    ollamaResponse: OllamaCompletionResponse,
    tools?: Tool[],
  ): GenerateContentResponse {
    const choice = ollamaResponse.choices[0];
    const content = choice.message.content;

    debugLogger.log(
      `[OllamaContentGenerator] Converting response. Tools available: ${!!tools}, Tools length: ${tools?.length}`,
    );

    // Check if this is a tool call
    const hasTools =
      tools && tools.length > 0 && 'functionDeclarations' in tools[0];
    const toolCall = hasTools ? this.parseToolCall(content, tools) : null;

    debugLogger.log(
      `[OllamaContentGenerator] hasTools: ${hasTools}, toolCall: ${toolCall ? toolCall.name : 'null'}`,
    );

    const parts: Part[] = [];

    if (toolCall) {
      // This is a tool call
      parts.push({ functionCall: toolCall });
    } else {
      // Regular text response
      parts.push({ text: content });
    }

    // Map finish_reason
    let finishReason = FinishReason.STOP;
    if (choice.finish_reason === 'length') {
      finishReason = FinishReason.MAX_TOKENS;
    } else if (choice.finish_reason === 'stop') {
      finishReason = FinishReason.STOP;
    }

    return {
      candidates: [
        {
          content: {
            role: 'model',
            parts,
          },
          finishReason,
          index: 0,
        },
      ],
      usageMetadata: {
        promptTokenCount: ollamaResponse.usage.prompt_tokens,
        candidatesTokenCount: ollamaResponse.usage.completion_tokens,
        totalTokenCount: ollamaResponse.usage.total_tokens,
      },
    } as GenerateContentResponse;
  }

  async generateContent(
    request: GenerateContentParameters,
    _userPromptId: string,
  ): Promise<GenerateContentResponse> {
    const systemInstruction = request.config?.systemInstruction;
    let systemText = '';

    if (systemInstruction) {
      if (typeof systemInstruction === 'string') {
        systemText = systemInstruction;
      } else if ('parts' in systemInstruction) {
        systemText = this.partsToText(normalizeParts(systemInstruction.parts));
      } else if (Array.isArray(systemInstruction)) {
        systemText = this.partsToText(normalizeParts(systemInstruction));
      } else if ('text' in systemInstruction) {
        systemText = systemInstruction.text || '';
      }
    }

    // Add tool instructions if tools are provided
    const tools = request.config?.tools as Tool[] | undefined;
    if (systemText) {
      systemText = this.addToolInstructions(systemText, tools);
    }

    // Ensure contents is an array
    const contents = normalizeContents(request.contents);
    const messages = this.convertToOllamaMessages(contents, systemText);

    const ollamaRequest = {
      model: this.model,
      messages,
      stream: false,
      temperature: request.config?.temperature,
      max_tokens: request.config?.maxOutputTokens,
    };

    debugLogger.log(
      `Ollama request: ${JSON.stringify(ollamaRequest, null, 2)}`,
    );

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ollamaRequest),
      signal: request.config?.abortSignal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} ${errorText}`);
    }

    const ollamaResponse: OllamaCompletionResponse = await response.json();
    debugLogger.log(
      `Ollama response: ${JSON.stringify(ollamaResponse, null, 2)}`,
    );

    return this.convertToGeminiResponse(ollamaResponse, tools);
  }

  async generateContentStream(
    request: GenerateContentParameters,
    _userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    return this.generateContentStreamInternal(request, _userPromptId);
  }

  private async *generateContentStreamInternal(
    request: GenerateContentParameters,
    _userPromptId: string,
  ): AsyncGenerator<GenerateContentResponse> {
    const systemInstruction = request.config?.systemInstruction;
    let systemText = '';

    if (systemInstruction) {
      if (typeof systemInstruction === 'string') {
        systemText = systemInstruction;
      } else if ('parts' in systemInstruction) {
        systemText = this.partsToText(normalizeParts(systemInstruction.parts));
      } else if (Array.isArray(systemInstruction)) {
        systemText = this.partsToText(normalizeParts(systemInstruction));
      } else if ('text' in systemInstruction) {
        systemText = systemInstruction.text || '';
      }
    }

    // Add tool instructions if tools are provided
    const tools = request.config?.tools as Tool[] | undefined;
    if (systemText) {
      systemText = this.addToolInstructions(systemText, tools);
    }

    // Ensure contents is an array
    const contents = normalizeContents(request.contents);
    const messages = this.convertToOllamaMessages(contents, systemText);

    const ollamaRequest = {
      model: this.model,
      messages,
      stream: true,
      temperature: request.config?.temperature,
      max_tokens: request.config?.maxOutputTokens,
    };

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ollamaRequest),
      signal: request.config?.abortSignal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body from Ollama');
    }

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedText = '';
    const tokenCounts = { prompt: 0, completion: 0, total: 0 };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const chunk: OllamaStreamChunk = JSON.parse(data);
              const delta = chunk.choices[0]?.delta;

              if (delta?.content) {
                accumulatedText += delta.content;

                yield {
                  candidates: [
                    {
                      content: {
                        role: 'model',
                        parts: [{ text: delta.content }],
                      },
                      finishReason: chunk.choices[0].finish_reason
                        ? chunk.choices[0].finish_reason === 'length'
                          ? FinishReason.MAX_TOKENS
                          : FinishReason.STOP
                        : undefined,
                      index: 0,
                    },
                  ],
                } as GenerateContentResponse;
              }

              // On finish, check for tool calls
              if (chunk.choices[0]?.finish_reason) {
                const hasTools =
                  tools &&
                  tools.length > 0 &&
                  'functionDeclarations' in tools[0];
                const toolCall = hasTools
                  ? this.parseToolCall(accumulatedText, tools)
                  : null;

                if (toolCall) {
                  // Replace the accumulated text with a function call
                  yield {
                    candidates: [
                      {
                        content: {
                          role: 'model',
                          parts: [{ functionCall: toolCall }],
                        },
                        finishReason: FinishReason.STOP,
                        index: 0,
                      },
                    ],
                    usageMetadata: {
                      promptTokenCount: tokenCounts.prompt,
                      candidatesTokenCount: tokenCounts.completion,
                      totalTokenCount: tokenCounts.total,
                    },
                  } as GenerateContentResponse;
                }
              }
            } catch (_e) {
              debugLogger.log(`Error parsing SSE chunk: ${_e}`);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    // Ollama doesn't have a direct token counting API
    // We'll estimate based on text length: ~4 chars per token
    const contents = normalizeContents(request.contents);
    const allParts = contents.flatMap((c: Content) => c.parts || []);
    const text = this.partsToText(allParts);
    const estimatedTokens = Math.ceil(text.length / 4);

    return {
      totalTokens: estimatedTokens,
    };
  }

  async embedContent(
    request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    throw new Error('Ollama embedContent not implemented');
  }
}
