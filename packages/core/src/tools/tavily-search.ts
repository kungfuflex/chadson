/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type { ToolInvocation, ToolResult } from './tools.js';
import { BaseDeclarativeTool, BaseToolInvocation } from './tools.js';
import { ToolErrorType } from './tool-error.js';
import { getErrorMessage } from '../utils/errors.js';
import type { Config } from '../config/config.js';

const TAVILY_TOOL_NAME = 'tavily_search';

interface TavilySearchRequest {
  query: string;
  search_depth?: 'basic' | 'advanced';
  include_answer?: boolean;
  include_raw_content?: boolean;
  max_results?: number;
  include_domains?: string[];
  exclude_domains?: string[];
}

interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
}

interface TavilyResponse {
  answer?: string;
  query: string;
  response_time: number;
  images?: string[];
  follow_up_questions?: string[];
  results: TavilySearchResult[];
}

/**
 * Parameters for the TavilySearchTool.
 */
export interface TavilySearchToolParams {
  /**
   * The search query.
   */
  query: string;

  /**
   * Search depth: "basic" or "advanced"
   */
  search_depth?: 'basic' | 'advanced';

  /**
   * Whether to include a direct answer
   */
  include_answer?: boolean;

  /**
   * Maximum number of results (1-20)
   */
  max_results?: number;

  /**
   * Domains to include in search
   */
  include_domains?: string[];

  /**
   * Domains to exclude from search
   */
  exclude_domains?: string[];
}

/**
 * Extends ToolResult to include sources for Tavily search.
 */
export interface TavilySearchToolResult extends ToolResult {
  sources?: Array<{
    title: string;
    url: string;
    score: number;
  }>;
}

class TavilySearchToolInvocation extends BaseToolInvocation<
  TavilySearchToolParams,
  TavilySearchToolResult
> {
  constructor(
    params: TavilySearchToolParams,
    messageBus?: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  override getDescription(): string {
    return `Searching the web with Tavily: "${this.params.query}"`;
  }

  async execute(signal: AbortSignal): Promise<TavilySearchToolResult> {
    const apiKey = process.env['TAVILY_API_KEY'];

    if (!apiKey) {
      return {
        llmContent: 'Error: TAVILY_API_KEY environment variable is not set. Please set your Tavily API key to use web search.',
        returnDisplay: 'Tavily API key not configured',
        error: {
          message: 'TAVILY_API_KEY environment variable is required',
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    try {
      const searchRequest: TavilySearchRequest = {
        query: this.params.query,
        search_depth: this.params.search_depth || 'basic',
        include_answer: this.params.include_answer !== false,
        include_raw_content: false,
        max_results: Math.min(
          Math.max(this.params.max_results || 5, 1),
          20,
        ),
        include_domains: this.params.include_domains,
        exclude_domains: this.params.exclude_domains,
      };

      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...searchRequest,
          api_key: apiKey,
        }),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Tavily API error (${response.status})`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error || errorJson.message || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }

        return {
          llmContent: `Error searching the web: ${errorMessage}`,
          returnDisplay: `Search failed: ${errorMessage}`,
          error: {
            message: errorMessage,
            type: ToolErrorType.EXECUTION_FAILED,
          },
        };
      }

      const data: TavilyResponse = await response.json();

      // Format the response for the LLM
      let formattedResponse = `# Web Search Results: "${data.query}"\n\n`;

      if (data.answer) {
        formattedResponse += `## Direct Answer\n${data.answer}\n\n`;
      }

      if (data.results && data.results.length > 0) {
        formattedResponse += `## Search Results (${data.results.length} found)\n\n`;

        data.results.forEach((result, index) => {
          formattedResponse += `### ${index + 1}. ${result.title}\n`;
          formattedResponse += `**URL:** ${result.url}\n`;
          if (result.published_date) {
            formattedResponse += `**Published:** ${result.published_date}\n`;
          }
          formattedResponse += `**Relevance Score:** ${(result.score * 100).toFixed(1)}%\n\n`;
          formattedResponse += `${result.content}\n\n`;
          formattedResponse += `---\n\n`;
        });
      } else {
        formattedResponse += 'No search results found.\n\n';
      }

      if (data.follow_up_questions && data.follow_up_questions.length > 0) {
        formattedResponse += `## Suggested Follow-up Questions\n`;
        data.follow_up_questions.forEach((question, index) => {
          formattedResponse += `${index + 1}. ${question}\n`;
        });
        formattedResponse += '\n';
      }

      formattedResponse += `*Search completed in ${data.response_time.toFixed(2)}s*`;

      // Extract sources for potential citation
      const sources = data.results.map((result) => ({
        title: result.title,
        url: result.url,
        score: result.score,
      }));

      return {
        llmContent: formattedResponse,
        returnDisplay: `Found ${data.results.length} results for "${data.query}"`,
        sources,
      };
    } catch (error: unknown) {
      if (signal.aborted) {
        return {
          llmContent: 'Search was cancelled.',
          returnDisplay: 'Search cancelled',
        };
      }

      const errorMessage = getErrorMessage(error);
      return {
        llmContent: `Error performing web search: ${errorMessage}`,
        returnDisplay: `Search error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
  }
}

/**
 * Implementation of the TavilySearch tool logic.
 * Provides web search capabilities using the Tavily API.
 */
export class TavilySearchTool extends BaseDeclarativeTool<
  TavilySearchToolParams,
  TavilySearchToolResult
> {
  static readonly Name = TAVILY_TOOL_NAME;

  constructor(
    _config: Config,
    messageBus?: MessageBus,
  ) {
    super(
      TAVILY_TOOL_NAME,
      TAVILY_TOOL_NAME,
      'Search the web using Tavily API. Returns relevant, up-to-date search results with content snippets and direct answers. Requires TAVILY_API_KEY environment variable.',
      'other' as any,
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to execute',
          },
          search_depth: {
            type: 'string',
            enum: ['basic', 'advanced'],
            description:
              'The depth of the search. "basic" is faster, "advanced" provides more comprehensive results.',
            default: 'basic',
          },
          include_answer: {
            type: 'boolean',
            description:
              'Whether to include a direct AI-generated answer to the query',
            default: true,
          },
          max_results: {
            type: 'number',
            description:
              'Maximum number of search results to return (1-20)',
            default: 5,
            minimum: 1,
            maximum: 20,
          },
          include_domains: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional list of domains to include in the search (e.g., ["wikipedia.org", "github.com"])',
          },
          exclude_domains: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional list of domains to exclude from the search',
          },
        },
        required: ['query'],
      },
      true,
      false,
      messageBus,
    );
  }

  createInvocation(
    params: TavilySearchToolParams,
  ): ToolInvocation<TavilySearchToolParams, TavilySearchToolResult> {
    return new TavilySearchToolInvocation(
      params,
      this.messageBus,
      this.name,
      this.displayName,
    );
  }
}
