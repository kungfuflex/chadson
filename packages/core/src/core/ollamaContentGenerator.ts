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
    model: string = 'gemma2:27b',
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

    const toolPrompt = `

## Available Tools

You have access to the following tools:

${JSON.stringify(toolsDescription, null, 2)}

## Tool Calling Protocol

When you need to call a tool, respond with a JSON object in this exact format:
\`\`\`json
{
  "tool_call": {
    "name": "tool_name",
    "arguments": {
      "param1": "value1",
      "param2": "value2"
    }
  }
}
\`\`\`

IMPORTANT:
- Only output the JSON object when you want to call a tool, nothing else
- Use the exact format shown above
- After calling a tool, you will receive the result and can continue the conversation
- You can call multiple tools by making separate tool calls
- If you don't need to call a tool, respond normally with text

`;

    return systemInstruction + toolPrompt;
  }

  /**
   * Parses the model's response for tool calls.
   * Returns the extracted tool call or null if none found.
   */
  private parseToolCall(text: string): FunctionCall | null {
    // Try to find JSON in code blocks first
    const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    let jsonText = codeBlockMatch ? codeBlockMatch[1] : text.trim();

    // If no code block, try to extract JSON object from the text
    if (!codeBlockMatch) {
      const jsonMatch = text.match(/\{[\s\S]*"tool_call"[\s\S]*\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }
    }

    try {
      const parsed = JSON.parse(jsonText);
      if (parsed.tool_call && parsed.tool_call.name) {
        return {
          name: parsed.tool_call.name,
          args: parsed.tool_call.arguments || {},
        };
      }
    } catch (_e) {
      // Not a valid JSON or tool call, return null
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
    const toolCall = hasTools ? this.parseToolCall(content) : null;

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
    const contents = normalizeContents(_request.contents);
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
    return this.generateContentStreamInternal(request, userPromptId);
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
    const contents = normalizeContents(_request.contents);
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
                  ? this.parseToolCall(accumulatedText)
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
              debugLogger.log(`Error parsing SSE chunk: ${e}`);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async countTokens(
    _request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    // Ollama doesn't have a direct token counting API
    // We'll estimate based on text length: ~4 chars per token
    const contents = normalizeContents(_request.contents);
    const allParts = contents.flatMap((c: Content) => c.parts || []);
    const text = this.partsToText(allParts);
    const estimatedTokens = Math.ceil(text.length / 4);

    return {
      totalTokens: estimatedTokens,
    };
  }

  async embedContent(
    _request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    throw new Error('Ollama embedContent not implemented');
  }
}
