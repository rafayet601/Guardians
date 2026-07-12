// Shared Anthropic (Claude) client for Guardians edge functions (Deno runtime).
// -----------------------------------------------------------------------------
// Dependency-free wrapper around the Anthropic Messages API using native fetch —
// mirrors send-push's "no SDK, raw fetch" posture (send-push only reaches esm.sh
// for supabase-js). The API key lives ONLY in the edge runtime as the
// ANTHROPIC_API_KEY secret and never reaches the client (AI_ROADMAP principle 1).
//
// Set the secret before any ai-* function that calls the model can work:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// This file is Deno, not part of the React Native app (excluded in tsconfig).

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Default model: Haiku is the cheap, high-volume tier used for classification,
 * extraction and vision autofill. Reserve larger models for the low-volume RAG
 * copilot (AI-M5). Keep this in sync with src/constants/ai.ts (display only).
 */
export const HAIKU = 'claude-haiku-4-5';

export type ClaudeRole = 'user' | 'assistant';

/** A single content block within a message (text or a base64 image). */
export type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: { type: 'base64'; media_type: string; data: string };
    };

export interface ClaudeMessage {
  role: ClaudeRole;
  content: string | ClaudeContentBlock[];
}

export interface CallClaudeArgs {
  /** Optional system prompt (guardrails, role, output contract). */
  system?: string;
  messages: ClaudeMessage[];
  /** Max tokens to generate. Defaults to a modest cap suited to Haiku work. */
  maxTokens?: number;
  /** Model id; defaults to HAIKU. */
  model?: string;
  /**
   * When provided, requests structured output constrained to this JSON schema
   * (Messages API `output_config.format`), and the parsed object is returned
   * instead of raw text.
   */
  jsonSchema?: Record<string, unknown>;
}

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface CallClaudeResult<T = string> {
  /** Parsed text (no jsonSchema) or the parsed structured object (with schema). */
  output: T;
  model: string;
  usage: ClaudeUsage;
}

/** Build a base64 image content block for a vision request. */
export function imageBlock(mediaType: string, base64Data: string): ClaudeContentBlock {
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } };
}

/** Read the Anthropic API key from the edge runtime, or throw a clear error. */
export function requireAnthropicKey(): string {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY is not configured for this edge function.');
  }
  return key;
}

/** True when the Anthropic key is present — lets scaffolds report readiness. */
export function isAnthropicConfigured(): boolean {
  return Boolean(Deno.env.get('ANTHROPIC_API_KEY'));
}

/**
 * POST to the Anthropic Messages API and return the parsed text (default) or,
 * when `jsonSchema` is supplied, the parsed structured object. Throws on a
 * non-2xx response or a body that doesn't contain usable content.
 */
export async function callClaude<T = string>(args: CallClaudeArgs): Promise<CallClaudeResult<T>> {
  const apiKey = requireAnthropicKey();
  const model = args.model ?? HAIKU;

  const body: Record<string, unknown> = {
    model,
    max_tokens: args.maxTokens ?? 1024,
    messages: args.messages,
  };
  if (args.system) body.system = args.system;
  if (args.jsonSchema) {
    body.output_config = { format: { type: 'json_schema', schema: args.jsonSchema } };
  }

  const resp = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Anthropic API error ${resp.status}: ${detail}`);
  }

  const payload = (await resp.json()) as {
    model?: string;
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const text = (payload.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');

  if (!text) {
    throw new Error('Anthropic response contained no text content.');
  }

  const usage: ClaudeUsage = {
    input_tokens: payload.usage?.input_tokens ?? 0,
    output_tokens: payload.usage?.output_tokens ?? 0,
  };

  const output = (args.jsonSchema ? (JSON.parse(text) as T) : (text as unknown as T)) as T;

  return { output, model: payload.model ?? model, usage };
}
