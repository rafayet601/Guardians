/**
 * Client-side AI configuration and feature flags.
 *
 * All AI inference runs server-side in `supabase/functions/ai-*` — no model API
 * key ever reaches the client (AI_ROADMAP principle 1). These flags only gate
 * whether AI *UI* (e.g. "AI suggested — tap to edit" affordances) is shown, so
 * screens can stay dark until the server plumbing is deployed and enabled.
 *
 * `AI_ENABLED` is derived from EXPO_PUBLIC_AI_ENABLED (default false). Per-feature
 * flags currently all inherit from it; they exist so individual AI-M1+ features
 * can be rolled out independently later without touching call sites.
 */
import { env } from '@/lib/env';

/** Master switch — when false, all AI UI must be hidden. */
export const AI_ENABLED = env.aiEnabled;

/** Per-feature gates. Extend as AI-M1+ features land; keep them behind AI_ENABLED. */
export const AI_FEATURES = {
  reportAutofill: AI_ENABLED,
  adoptionCopy: AI_ENABLED,
  photoModeration: AI_ENABLED,
  textModeration: AI_ENABLED,
  modCopilot: AI_ENABLED,
  fraudSignals: AI_ENABLED,
  reid: AI_ENABLED,
  lostCatReunion: AI_ENABLED,
  journeyTimeline: AI_ENABLED,
  rescueCopilot: AI_ENABLED,
} as const;

export type AiFeature = keyof typeof AI_FEATURES;
