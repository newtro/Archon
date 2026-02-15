/**
 * OpenRouter Agentic Runner.
 * Implements a streaming agentic tool-use loop using the OpenAI-compatible API
 * via OpenRouter. Used by flow LLM nodes when provider === "openrouter".
 */

import OpenAI from "openai";
import {
  executeTool,
  resolveToolsForPreset,
} from "./tool-executor.js";

// ── Public Types ─────────────────────────────────────────────────

export interface OpenRouterOptions {
  apiKey: string;
  model: string; // OpenRouter model ID, e.g. "minimax/minimax-m2.5"
  systemPrompt: string;
  toolPreset: string; // "none" | "read-only" | "full-access"
  temperature: number;
  maxTokens: number;
  cwd: string;
  abortSignal: AbortSignal;
}

export interface StreamCallbacks {
  onTextDelta: (text: string) => void;
  onToolCallStart: (
    id: string,
    name: string,
    args: Record<string, unknown>,
  ) => void;
  onToolCallDone: (
    id: string,
    result: string,
    isError: boolean,
    durationMs: number,
  ) => void;
}

// ── Agentic Loop ─────────────────────────────────────────────────

const MAX_TURNS = 50; // Safety limit to prevent infinite tool loops

export async function runOpenRouterAgent(
  prompt: string,
  options: OpenRouterOptions,
  callbacks: StreamCallbacks,
): Promise<{ result: string; totalCost: number }> {
  const client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: options.apiKey,
    defaultHeaders: {
      "HTTP-Referer": "https://archonide.dev",
      "X-Title": "Archon",
    },
  });

  const tools = resolveToolsForPreset(options.toolPreset);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (options.systemPrompt) {
    messages.push({ role: "system", content: options.systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  let fullResult = "";
  let totalCost = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (options.abortSignal.aborted) break;

    // Call OpenRouter with streaming
    const requestParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
      model: options.model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: true,
    };

    // Only include tools if the preset provides any
    if (tools.length > 0) {
      requestParams.tools =
        tools as OpenAI.Chat.Completions.ChatCompletionTool[];
    }

    const stream = await client.chat.completions.create(requestParams);

    let assistantContent = "";
    const toolCalls: Array<{
      id: string;
      function: { name: string; arguments: string };
    }> = [];

    // Accumulate streaming chunks
    for await (const chunk of stream) {
      if (options.abortSignal.aborted) break;

      const choice = chunk.choices[0];
      if (!choice) continue;

      const delta = choice.delta;

      // Text content
      if (delta.content) {
        assistantContent += delta.content;
        fullResult += delta.content;
        callbacks.onTextDelta(delta.content);
      }

      // Tool calls (streamed incrementally — arguments arrive in fragments)
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCalls[idx]) {
            toolCalls[idx] = {
              id: tc.id ?? `call_${idx}_${Date.now()}`,
              function: { name: tc.function?.name ?? "", arguments: "" },
            };
          }
          if (tc.function?.name) {
            toolCalls[idx].function.name = tc.function.name;
          }
          if (tc.function?.arguments) {
            toolCalls[idx].function.arguments += tc.function.arguments;
          }
        }
      }
    }

    // Build the assistant message for conversation history
    const assistantMessage: OpenAI.Chat.ChatCompletionMessageParam = {
      role: "assistant" as const,
      content: assistantContent || null,
    };

    if (toolCalls.length > 0) {
      (
        assistantMessage as OpenAI.Chat.ChatCompletionAssistantMessageParam
      ).tool_calls = toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }));
    }

    messages.push(assistantMessage);

    // If no tool calls, we are done
    if (toolCalls.length === 0) {
      break;
    }

    // Execute each tool call and append results to the conversation
    for (const tc of toolCalls) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(tc.function.arguments);
      } catch {
        parsedArgs = { raw: tc.function.arguments };
      }

      callbacks.onToolCallStart(tc.id, tc.function.name, parsedArgs);

      const startTime = Date.now();
      const { result, isError } = await executeTool(
        tc.function.name,
        parsedArgs,
        options.cwd,
      );
      const durationMs = Date.now() - startTime;

      callbacks.onToolCallDone(tc.id, result, isError, durationMs);

      // Append tool result message for the model's next turn
      messages.push({
        role: "tool" as const,
        tool_call_id: tc.id,
        content: result,
      });
    }

    // Loop continues — the model will see tool results and generate a new response
  }

  return { result: fullResult, totalCost };
}

// ── Model List Fetching ──────────────────────────────────────────

export interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  supported_parameters?: string[];
}

let modelCache: { models: OpenRouterModel[]; fetchedAt: number } | null = null;
const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function fetchOpenRouterModels(
  apiKey: string,
): Promise<OpenRouterModel[]> {
  if (modelCache && Date.now() - modelCache.fetchedAt < MODEL_CACHE_TTL) {
    return modelCache.models;
  }

  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch OpenRouter models: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as { data: OpenRouterModel[] };
  const models = data.data
    .filter((m) => {
      // Filter to models that support function calling / tools
      const params = m.supported_parameters ?? [];
      return params.includes("tools") || params.includes("functions");
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  modelCache = { models, fetchedAt: Date.now() };
  return models;
}
