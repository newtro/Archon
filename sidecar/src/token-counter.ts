/**
 * Token counting via the Anthropic countTokens API.
 *
 * Uses `client.messages.countTokens()` for accurate pre-call token counts.
 * Falls back to character-based estimation (chars / 4) if the API call fails.
 */

import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  }
  return client;
}

/** Reset the client (e.g., when API key changes). */
export function resetTokenCounterClient(): void {
  client = null;
}

/** Rough character-based estimate: ~4 chars per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Map our model shortnames to Anthropic model IDs for countTokens. */
function resolveModelId(model: string): string {
  switch (model) {
    case "opus":
      return "claude-opus-4-6";
    case "sonnet":
      return "claude-sonnet-4-5-20250929";
    case "haiku":
      return "claude-haiku-4-5-20251001";
    default:
      return model; // pass through if already a full ID
  }
}

export interface TokenCountResult {
  inputTokens: number;
  accurate: boolean; // true if from API, false if estimated
}

/**
 * Count tokens for a set of messages using the Anthropic countTokens API.
 * Falls back to character-based estimation on failure.
 */
export async function countTokens(
  model: string,
  systemPrompt: string | undefined,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<TokenCountResult> {
  try {
    const anthropic = getClient();
    const response = await anthropic.messages.countTokens({
      model: resolveModelId(model),
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    return { inputTokens: response.input_tokens, accurate: true };
  } catch (err) {
    // Fall back to estimation
    const totalChars =
      (systemPrompt?.length ?? 0) +
      messages.reduce((sum, m) => sum + m.content.length, 0);
    console.warn(`[token-counter] countTokens API failed, using estimate: ${err instanceof Error ? err.message : err}`);
    return { inputTokens: Math.ceil(totalChars / 4), accurate: false };
  }
}

/**
 * Count tokens for individual text segments.
 * Returns a breakdown of token counts per segment.
 */
export async function countTokenBreakdown(
  model: string,
  segments: Array<{ key: string; text: string }>,
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};

  // Use a single countTokens call with all segments concatenated as separate messages,
  // then also call individually for the breakdown. To minimize API calls, we estimate
  // the breakdown proportionally from one total count.
  let totalChars = 0;
  for (const seg of segments) {
    totalChars += seg.text.length;
  }

  if (totalChars === 0) {
    for (const seg of segments) {
      result[seg.key] = 0;
    }
    return result;
  }

  // Get total count from API
  const allText = segments.map((s) => s.text).join("\n");
  const total = await countTokens(model, undefined, [{ role: "user", content: allText }]);

  // Distribute proportionally based on character length
  let allocated = 0;
  for (let i = 0; i < segments.length; i++) {
    if (i === segments.length - 1) {
      // Last segment gets the remainder to avoid rounding errors
      result[segments[i].key] = total.inputTokens - allocated;
    } else {
      const proportion = segments[i].text.length / totalChars;
      const tokens = Math.round(total.inputTokens * proportion);
      result[segments[i].key] = tokens;
      allocated += tokens;
    }
  }

  return result;
}
