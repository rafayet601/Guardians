export const meta = {
  name: 'ai-roadmap-rollout',
  description:
    'Delegates AI_ROADMAP.md milestones (AI-M0..AI-M5) to specialized agents, verifying after each before proceeding',
  whenToUse:
    'Run when ready to start implementing the Guardians AI integration roadmap. Not auto-triggered by AI_ROADMAP.md — invoke explicitly. Each phase gates on the previous one passing verification (typecheck/lint/test) before the next starts.',
  phases: [
    { title: 'AI-M0 Foundation', detail: 'edge-function scaffold, pgvector, cost policy, privacy update' },
    { title: 'AI-M1 Quick Wins', detail: 'photo autofill + adoption profile writer, in parallel' },
    { title: 'AI-M2 Trust & Safety', detail: 'photo/text moderation, moderator copilot, fraud signals' },
    { title: 'AI-M3 Identity Core', detail: 'duplicate-sighting / re-ID' },
    { title: 'AI-M4 Lost-Cat Reunification', detail: 'flagship feature, depends on AI-M3' },
    { title: 'AI-M5 Guardian Experience', detail: 'rescue copilot + smarter push targeting, in parallel' },
    { title: 'Verify', detail: 'typecheck/lint/test gate after each milestone' },
  ],
};

// Full milestone detail, acceptance criteria, and guardrails live in AI_ROADMAP.md —
// every agent call points there instead of duplicating the spec in this script.
const CONTEXT =
  'Repo: guardians-app/. See AI_ROADMAP.md at the repo root for full milestone detail, ' +
  'acceptance criteria, and guardrails, and follow AGENTS.md conventions (the @/* path ' +
  'alias, SECURITY DEFINER RPCs for sensitive writes, @/lib/dialog not Alert, ' +
  '@/components/PlatformMap not react-native-maps directly). Run ' +
  'npm run typecheck / npm run lint / npm test before reporting done.';

async function verify(milestoneName) {
  const result = await agent(
    'Run `npm run typecheck`, `npm run lint`, and `npm test` in guardians-app/. ' +
      'Report pass/fail for each and paste any errors verbatim. Do not fix anything — only report.',
    { label: `verify:${milestoneName}`, phase: 'Verify' },
  );
  log(`${milestoneName} verification: ${String(result).slice(0, 300)}`);
  return result;
}

// ── AI-M0 — Foundation ───────────────────────────────────────────────────────
phase('AI-M0 Foundation');
await agent(
  'Implement AI-M0 (Foundation & Guardrails) from AI_ROADMAP.md: the ai-* edge-function ' +
    'scaffold pattern (mirroring send-push/delete-account), enable pgvector plus an ' +
    'embeddings table with RLS (SECURITY DEFINER RPC access only, no client policy), a ' +
    'model/cost-ceiling policy note, rate limiting on AI endpoints (reuse the migration ' +
    '0011 pattern), analytics_events cost/latency fields, and the privacy-policy ' +
    'amendment disclosing the new AI processor. ' +
    CONTEXT,
  { agentType: 'ai-infra-agent', label: 'AI-M0', phase: 'AI-M0 Foundation' },
);
await verify('AI-M0');

// ── AI-M1 — Quick Wins (two independent features) ───────────────────────────
phase('AI-M1 Quick Wins');
await parallel([
  () =>
    agent(
      'Implement AI-M1 #1 (Photo → report autofill) from AI_ROADMAP.md, using the AI-M0 ' +
        'edge-function scaffold. ' +
        CONTEXT,
      { agentType: 'ai-vision-agent', label: 'AI-M1:autofill', phase: 'AI-M1 Quick Wins' },
    ),
  () =>
    agent(
      'Implement AI-M1 #13 (Adoption profile writer) from AI_ROADMAP.md, using the AI-M0 ' +
        'edge-function scaffold. ' +
        CONTEXT,
      { agentType: 'ai-copywriter-agent', label: 'AI-M1:adoption-copy', phase: 'AI-M1 Quick Wins' },
    ),
]);
await verify('AI-M1');

// ── AI-M2 — Trust & Safety ───────────────────────────────────────────────────
// One agent owns the whole milestone: its four tasks (#9-#12) share the same
// abuse_reports/moderate_content data model and app/moderation.tsx screen, so
// splitting them across parallel agents risks conflicting edits to shared files.
phase('AI-M2 Trust & Safety');
await agent(
  'Implement AI-M2 (Trust & Safety) from AI_ROADMAP.md: photo moderation (#9 — the ' +
    'vision-call portion follows ai-vision-agent conventions, you own the moderation ' +
    'wiring), comment/report-text screening (#10), the moderator copilot in ' +
    'app/moderation.tsx (#11), and fake-report/points-farming signals (#12). ' +
    CONTEXT,
  { agentType: 'ai-safety-agent', label: 'AI-M2', phase: 'AI-M2 Trust & Safety' },
);
await verify('AI-M2');

// ── AI-M3 — Identity Core ────────────────────────────────────────────────────
phase('AI-M3 Identity Core');
await agent(
  'Implement AI-M3 (Identity Core / duplicate-sighting detection, #4) from ' +
    'AI_ROADMAP.md: the sighting_links table, the embedding+geo+time match RPC, and ' +
    'the merge/link UI flow. ' +
    CONTEXT,
  { agentType: 'ai-embeddings-agent', label: 'AI-M3', phase: 'AI-M3 Identity Core' },
);
await verify('AI-M3');

// ── AI-M4 — Flagship: Lost-Cat Reunification (depends on AI-M3) ─────────────
phase('AI-M4 Lost-Cat Reunification');
await parallel([
  () =>
    agent(
      'Implement the matching engine for AI-M4 #5 (Lost-cat reunification) from ' +
        'AI_ROADMAP.md: the lost_cats table and the continuous embedding+geo+time match ' +
        'against open lost-cat posts, reusing AI-M3\'s infrastructure. ' +
        CONTEXT,
      { agentType: 'ai-embeddings-agent', label: 'AI-M4:matching', phase: 'AI-M4 Lost-Cat Reunification' },
    ),
  () =>
    agent(
      'Implement the notification + UI half of AI-M4 from AI_ROADMAP.md: the push ' +
        '"a cat matching X was spotted near you" via the existing send-push infra, the ' +
        'confirm/reject flow, and #6 the cat journey timeline once a cat has 2+ linked ' +
        'sightings. ' +
        CONTEXT,
      { agentType: 'ai-vision-agent', label: 'AI-M4:notify-ui', phase: 'AI-M4 Lost-Cat Reunification' },
    ),
]);
await verify('AI-M4');

// ── AI-M5 — Guardian Experience (two independent features) ──────────────────
phase('AI-M5 Guardian Experience');
await parallel([
  () =>
    agent(
      'Implement AI-M5 #7 (Rescue copilot) from AI_ROADMAP.md: curate/embed the ' +
        'knowledge base, build the RAG-grounded Q&A surface on claimed sightings, and ' +
        'evaluate against a golden test set before considering this done. ' +
        CONTEXT,
      { agentType: 'ai-rag-agent', label: 'AI-M5:copilot', phase: 'AI-M5 Guardian Experience' },
    ),
  () =>
    agent(
      'Implement AI-M5 #8 (Smarter urgent-push targeting) from AI_ROADMAP.md: rank/filter ' +
        'tokens_near recipients by responsiveness using analytics_events, ship it ' +
        'A/B-able, and never exclude anyone from an urgent alert. ' +
        CONTEXT,
      { agentType: 'ai-analytics-agent', label: 'AI-M5:push-ranking', phase: 'AI-M5 Guardian Experience' },
    ),
]);
await verify('AI-M5');

log(
  'AI roadmap rollout complete through AI-M5. AI-M6 is backlog — run individual ' +
    'milestone agents directly once a specific AI-M6 item is picked up.',
);

return { completedMilestones: ['AI-M0', 'AI-M1', 'AI-M2', 'AI-M3', 'AI-M4', 'AI-M5'] };
