// =============================================================================
// Anthropic client — single source of truth for model and API key.
//
// Every LLM call site imports from here. The model name used to be hardcoded
// in 12 places and the API key resolution repeated 9 times; changing the model
// meant a grep. Now it is one constant and one helper.
// =============================================================================

import Anthropic from '@anthropic-ai/sdk';

/** Default model for every agent. Override per-deploy with ANTHROPIC_MODEL. */
export const MODEL: string = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

/** Resolves the API key. Returns null when it is not configured. */
export function anthropicApiKey(): string | null {
  return process.env.MY_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY || null;
}

/** Memoized client. Throws with a clear message when the key is missing. */
let cached: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (cached) return cached;
  const apiKey = anthropicApiKey();
  if (!apiKey) throw new Error('Anthropic API key is not configured (MY_ANTHROPIC_KEY or ANTHROPIC_API_KEY)');
  cached = new Anthropic({ apiKey });
  return cached;
}

/**
 * Marks a constant system prompt as cacheable. Every agent prompt that does
 * not change between calls goes through this — prompt caching cuts the input
 * cost of the repeated part by ~90%.
 */
export function cachedSystem(text: string): Anthropic.Messages.TextBlockParam[] {
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}
