# Guardians — AI Integration Roadmap

> How Guardians uses AI to serve its actual mission — getting cats home faster and
> safer — not AI for its own sake. Companion to [`PRD.md`](./PRD.md) (product
> requirements) and [`ROADMAP.md`](./ROADMAP.md) (launch-readiness engineering).

**Effort key:** `S` ≤ 1 day · `M` ≈ 2–4 days · `L` ≈ 1–2 weeks · `XL` > 2 weeks.
**Sequencing:** AI-M0 can start once [`ROADMAP.md`](./ROADMAP.md) M1 (Observability) is
live — AI features need the same cost/latency visibility. AI-M1+ should not compete
with M0 (store launch) for founder attention; treat this track as **post-launch**
unless a specific milestone is pulled forward deliberately.

## Principles (non-negotiable across every milestone)

1. **Server-side only.** Every AI call goes through a Supabase Edge Function, same
   pattern as `send-push`/`delete-account`. No model API key ever reaches the client.
2. **Human always confirms.** AI drafts, suggests, flags, and ranks — it never
   auto-submits a report, auto-bans a user, or auto-sends an irreversible action.
3. **No medical/veterinary diagnosis.** Injury/health language is always phrased as
   "consider" + "seek professional care," never a diagnosis.
4. **Grounded, not open-ended, for anything advice-like.** RAG over a curated,
   vetted knowledge base — not free-form generation — for the rescue copilot.
5. **Disclosed.** Every new AI processor/data flow gets added to
   [`docs/legal/privacy-policy.md`](./docs/legal/privacy-policy.md) before it ships.
6. **Cheap by default.** Haiku-class models for high-volume classification/extraction;
   reserve larger models for the one low-volume RAG copilot. Cost is tracked from day one.

---

## AI-M0 — Foundation & Guardrails

**Goal:** the shared plumbing every later milestone reuses, so no feature starts from zero.

| Task                                                                                                                | Notes                                                                                   |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `supabase/functions/ai-*` edge-function scaffold + secrets pattern                                                  | Mirrors `send-push`: service-role key, JWT-identified caller, no client-side model keys |
| Enable `pgvector`; add an `embeddings` table (RLS: no direct client access, written only via SECURITY DEFINER RPCs) | Foundation for AI-M3/M4/M6                                                              |
| Model/provider + cost-ceiling policy doc                                                                            | Which tier for which use case; a per-endpoint budget                                    |
| Rate limiting on AI endpoints                                                                                       | Reuse the insert rate-limit trigger pattern from migration `0011`                       |
| `analytics_events` extended with AI cost/latency fields                                                             | Builds on the `track_event` RPC already live                                            |
| Privacy Policy amendment                                                                                            | Disclose the AI processor(s) and what data reaches them                                 |

**Exit criteria:** one inert vision-model edge function deployed and callable; pgvector
enabled with a tested similarity-search RPC stub; privacy policy updated and merged.
**Agent:** `ai-infra-agent`

---

## AI-M1 — Quick Wins

**Goal:** ship two low-risk, high-visibility features to prove the pattern end-to-end
and start collecting real usage/cost data before touching anything safety-critical.

| #   | Feature                     | What it does                                                                                                                  | Guardrail                                                              |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | **Photo → report autofill** | Vision call on the report photo suggests color, distinguishing marks, a title/description, and an injury flag                 | Shown as "AI suggested — tap to edit"; user must confirm before submit |
| 13  | **Adoption profile writer** | On transition to `available`, drafts listing copy from the sighting's real timeline (reporter note, rescue updates, guardian) | Draft only — guardian/reporter edits before publish                    |

**Exit criteria:** both features instrumented (`ai_report_autofill_used`,
`ai_adoption_copy_used`), cost-per-call visible in `analytics_events`, soft-launched
to internal testers first.
**Agents:** `ai-vision-agent` (#1) · `ai-copywriter-agent` (#13)

---

## AI-M2 — Trust & Safety

**Goal:** close the open `PRODUCTION.md` "photo moderation" gap and give the solo
founder-moderator real leverage — this is the highest-value milestone for a
one-person moderation team.

| #   | Feature                                  | What it does                                                                                                                      |
| --- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 9   | **Photo moderation**                     | Screens uploads (Storage trigger) for NSFW/gore/off-topic; auto-hides + queues violations via the existing `moderate_content` RPC |
| 10  | **Comment/report-text screening**        | Same auto-queue pattern for toxicity/harassment in comments and report text                                                       |
| 11  | **Moderator copilot**                    | In `app/moderation.tsx`: per-report summary + reported user's history + a drafted action — moderator still clicks to act          |
| 12  | **Fake-report / points-farming signals** | Image-similarity-to-stock-photos + velocity/GPS-pattern heuristics flag a report for review (never auto-blocks)                   |

**Exit criteria:** pgTAP coverage on the new moderation RPCs; manually spot-checked
false-positive rate; founder reports a real drop in per-item triage time.
**Agent:** `ai-safety-agent`

---

## AI-M3 — Identity Core

**Goal:** fix the core coordination flaw — today, three neighbors reporting the same
cat produces three fragmented, uncoordinated rescues.

| #   | Feature                                  | What it does                                                                                                                                                                             |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4   | **Duplicate-sighting detection (re-ID)** | On new-sighting insert: compute a photo embedding, query nearest neighbors in a geo+time window (PostGIS ∩ pgvector), surface "this might be the same cat as [X]" with a merge/link flow |

New table: `sighting_links (sighting_id, linked_sighting_id, confidence, status:
suggested\|confirmed\|rejected)`. Feed/map group confirmed links into one visual record.

**Exit criteria:** merge RPC covered by pgTAP; manual QA against a batch of real and
synthetic duplicate photos; map/feed correctly collapse linked sightings.
**Agent:** `ai-embeddings-agent`

---

## AI-M4 — Flagship: Lost-Cat Reunification 🏆

**Goal:** the single highest-impact, most shareable feature — built almost entirely
on AI-M3's embeddings infrastructure.

| #   | Feature                    | What it does                                                                                                                                                                                                                                                                                            |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | **Lost-cat reunification** | New "I lost my cat" post (photo, last-seen location/time). New sightings are continuously matched against open lost-cat posts by embedding + geo/time proximity. Push: "a cat matching Miso was spotted 400 m from home." Owner confirms/rejects; confirming closes the loop and routes to the reporter |
| 6   | **Cat journey timeline**   | Once a cat has ≥2 linked sightings, show movement over time/area — helps a guardian actually locate the cat on arrival                                                                                                                                                                                  |

**Exit criteria:** end-to-end demo on synthetic + real data; push latency measured;
false-match rate acceptable on manual review. This is the feature to lead a store
update or marketing push with.
**Agents:** `ai-embeddings-agent` (matching) + `ai-vision-agent` (notification/UI), orchestrated together

---

## AI-M5 — Guardian Experience

**Goal:** deepen retention for the Guardian persona once the funnel and trust layers
are solid — do not pull this forward of AI-M2/M3.

| #   | Feature                           | What it does                                                                                                                                             | Guardrail                                                                                                                                              |
| --- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 7   | **Rescue copilot**                | RAG over a small, founder-curated knowledge base (TNR basics, humane trapping, safe transport), contextualized by the sighting's temperament/injury data | Hard system-prompt guardrail: never diagnose, always recommend professional care for anything medical; evaluated against a golden test set before ship |
| 8   | **Smarter urgent-push targeting** | Ranks/filters `tokens_near` recipients by past responsiveness and activity, using `analytics_events`                                                     | Ranking only — never silently excludes someone from an urgent alert; ship as A/B-able                                                                  |

**Exit criteria:** RAG answers pass the golden-set safety/accuracy review; push
targeting change measured against the PRD's <60 min claim-latency target.
**Agents:** `ai-rag-agent` (#7) · `ai-analytics-agent` (#8)

---

## AI-M6 — Adoption & Community Intelligence (post-GA backlog)

Lower priority — revisit once user volume justifies it.

| #   | Feature                                                                                     |
| --- | ------------------------------------------------------------------------------------------- |
| 14  | Adopter ↔ cat matching (bio/temperament/needs fit)                                          |
| 15  | Colony/hotspot insights — weekly digest for guardians + a data story for local TNR partners |
| 16  | Natural-language sighting search ("orange tabby near the park last week")                   |

**Agents:** `ai-copywriter-agent` / `ai-analytics-agent` / `ai-embeddings-agent` (mixed, scope each when picked up)

---

## Sequencing

```
AI-M0 (infra + pgvector + policy + privacy update)
  └─ AI-M1 (quick wins)              ── parallel: #1, #13
       └─ AI-M2 (trust & safety)     ── parallel: #9, #10, #11, #12
            └─ AI-M3 (identity core: re-ID)
                 └─ AI-M4 (flagship: lost-cat reunification)  ── depends on AI-M3
                      └─ AI-M5 (guardian experience)          ── independent of AI-M4, sequenced after for attention
                           └─ AI-M6 (backlog)
```

## Specialized agents

Each milestone above is scoped to one of seven domain-specialist subagents (defined
in [`.claude/agents/`](./.claude/agents/)) rather than one generalist doing everything —
narrower scope produces more consistent, codebase-conventional output:

| Agent                                                            | Domain                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [`ai-infra-agent`](./.claude/agents/ai-infra-agent.md)           | Edge-function scaffolding, secrets, pgvector schema, cost/observability plumbing      |
| [`ai-vision-agent`](./.claude/agents/ai-vision-agent.md)         | Vision-model integration: photo autofill, injury triage, photo moderation             |
| [`ai-embeddings-agent`](./.claude/agents/ai-embeddings-agent.md) | pgvector, similarity search, re-ID, duplicate detection, lost-cat matching, NL search |
| [`ai-safety-agent`](./.claude/agents/ai-safety-agent.md)         | Moderation AI, text screening, moderator copilot, fraud signals                       |
| [`ai-rag-agent`](./.claude/agents/ai-rag-agent.md)               | Grounded RAG copilot, knowledge-base curation, hallucination guardrails               |
| [`ai-copywriter-agent`](./.claude/agents/ai-copywriter-agent.md) | Low-risk generative text: listings, notification copy                                 |
| [`ai-analytics-agent`](./.claude/agents/ai-analytics-agent.md)   | Applied stats/heuristics on `analytics_events`: push ranking, colony clustering       |

## Orchestrator

[`.claude/workflows/ai-roadmap-rollout.js`](./.claude/workflows/ai-roadmap-rollout.js)
is an authored — **not yet run** — Workflow script that delegates each milestone's
tasks to the agents above in the order shown, with a verify pass (typecheck/lint/test)
gating progress between milestones. Invoke it explicitly with the Workflow tool when
ready to start implementation; it is not triggered by this document.

## Cost & risk notes

- At Guardians' current scale, Haiku-class calls for #1/#9/#10/#12 run to low
  dollars/month. The one model to watch is the AI-M5 RAG copilot (larger context per
  call, lower volume) — cap it with a per-user daily-call ceiling.
- AI-M2 and AI-M3 are the two milestones most worth doing even if nothing else in
  this doc ships: one protects the app from store/legal risk, the other fixes a
  structural correctness gap in the core product.
