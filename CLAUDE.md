# Penquire implementation guide

Updated October 29, 2026. Applies to any coding agent.

## Mission and deadline

Penquire helps students turn confusion into understanding they can use independently. The immediate target is a founder-operated iPad demo ready November 2, before November 3, Pacific time.

Read [demo spec](../docs/12-demo-spec.md), [architecture](../docs/04-architecture.md), [learning principles](../docs/07-learning-science.md) and [BACKLOG](BACKLOG.md). This file explains implementation invariants, not a competing strategy.

## Current source versus target

The app is an existing checker/tutor. It already includes canvas, parsing, marks, local storage, policy levels, disputes, streamed chat and voice. Auto-checking exists. The new episode model, isolated independent task and review due record are not implemented by the docs rewrite.

Use a small learning-flow layer, not a replacement app. Keep App.tsx's state router. Do not introduce Expo Router, a new state library, SQLite, cloud sync or a curriculum graph for the deadline.

## Commands

From app/:

```powershell
npm start
npm run typecheck
npm test
```

No lint script is configured. Before code completion, run typecheck and tests, then relevant device/model checks. Before a release/build change, run CI-equivalent doctor/bundle checks as appropriate. API calls/evals may cost money; ordinary unit tests do not establish model behavior.

Do not launch EAS builds without user approval. Any native change/new native dependency requires a rebuilt client. JS-only work is preferred. Check installed capability first.

## Source map

| Area | Files |
|---|---|
| Routing/screens | App.tsx; src/screens/HomeScreen.tsx, NewAssignmentScreen.tsx, WorkspaceScreen.tsx, SettingsScreen.tsx |
| Native canvas | modules/pencil-canvas/ios/PencilCanvasView.swift, PencilCanvasModule.swift, PdfExport.swift; typed JS wrapper |
| Capture/layout | src/ink/lines.ts; src/page.ts; src/blocks.ts; PageLayer and overlay components |
| Provider | src/ai/index.ts, claude.ts, types.ts, prompts.ts, parsePrompt.ts, sanitize.ts, stream.ts |
| Checking | src/check/auto.ts, carry.ts, confirmed.ts, finalize.ts |
| Math/reading/leaks | src/verify/expr.ts, units.ts, guard.ts, leak.ts |
| Help/issues | src/tutor/ladder.ts, issues.ts, revealed.ts, identity helpers and marks |
| Persistence | src/store/db.ts, types.ts, sources.ts, evals.ts, evalRecords.ts, saveGuard.ts |
| Progress/disclosure | src/store/progress.ts; src/log.ts |
| Voice | src/voice/engine.ts, turns.ts, text.ts |

Suggested src/learning/* files in the architecture document are proposed additions. Do not claim they exist before writing them.

## Native invariants

- Windows host; no local Xcode workflow assumed.
- Expo/RN versions come from package.json; check installed definitions, not remembered APIs.
- Native source API 6: source 3 added points/exportPage; 4 PDF/squeeze/speech capabilities; 5 palm/scroll behavior; 6 native overlay movement. Detect the actual binary.
- Generic native primitives stay thin; JS owns workflow and UI.
- Bridge JSON strings remain the existing transport.
- Page geometry uses fixed page coordinates; viewport transforms map to screen. Do not judge or place marks using inconsistent coordinate spaces.
- New overlays should reuse PageLayer/native-overlay compatibility rather than add another independent transform.
- Keep model coordinates symbolic: line IDs/quoted text, never raw model pixels.
- Paper remains white; use PAPER/PAPER_VERDICT on paper and theme tokens elsewhere.
- Preserve lazy native-library loading for older installed clients.
- A failed drawing decode/load must never be autosaved as a blank replacement.
- Erased/masked stroke ranges and pixel eraser effects matter to signatures/carry-over.

## Persistence and learning evidence

Current JSON DB stores assignments/page files and latest checks. Add optional compatible learning records; old DBs must load with empty new state. Do not change DB versions casually or discard historical work.

Preserve initial, repair and submitted independent snapshots separately. Latest-check files can be overwritten, so a reference to “latest” is not immutable evidence.

Issue disappearance means the old flag is absent. A withdrawal on unchanged ink is a tutor correction. Neither implies independent skill. Issue outcomes are bucketed by `resolvedAfter(level)` (marks only, pointer, explanation, example, step, unrecorded); none is an independent pass. Do not backfill old episodes as independent passes.

Record actual assistance across channels; selected level alone is not actual exposure. Unknown remains unknown. Do not assert the student authored everything solely because the event log has no hint.

## Independent boundary

Create a distinct task/page/attempt. Hide old marks, chat, examples and speech. Disable auto checks regardless of legacy settings. Cancel or discard stale provider/stream/voice callbacks by episode/attempt/phase identity.

No assessment before explicit submission. Do not include old assignment problems, prior chat, lastCheck or settled lines in independent-task context. Assess actual submitted work and requested explanation against the correct task. Prevent duplicate submits.

If the learner requests instructional help, make the exit explicit and classify the attempt as supported practice. If work changes after assessment, invalidate/reopen the result. A due review date is not a delayed result.

## Teaching and permissions

Keep LIMITS separate from HOW TO HELP. Diagnose the obstacle; choose a discriminating question, precise pointer, direct explanation or different example; stop when the learner can proceed. No required waiting or repeated vague questions.

Stored HelpLevel meanings remain:
0 check/location; 1 pointer; 2 general principle; 3 different worked example; 4 one task step/subgoal where allowed. ALLOWED_REVEALS must stay consistent with these meanings. A direct help button may jump to a permitted level without broadening it.

For the original demo pack, explanation/example permissions are explicit. Existing imported restrictions remain. A near-identical example is not a policy loophole. Complete examples need a properly scoped study task and guard coverage, not a global bypass.

## Checking/guard invariants

- Sanitize untrusted model output before UI. Unknown/missing verdicts must not become valid.
- Transcribe exactly, including mistakes; low-confidence readings require confirmation/abstention.
- Deterministic checks lower claims; they do not prove physical/conceptual understanding.
- Preserve original model verdict and guard evidence for evaluation.
- Stable issue identity is part + ink signature where present, not changing transcription.
- Carry-over retains unchanged work; later changed dependencies and pixel erasing must invalidate appropriately.
- Units/rounding tolerances must follow the original written precision; conversion multipliers must not loosen tolerance.
- Unparsed/prose/unknown units are not safely verified.
- Guard failure is not permission to show unchecked content as verified. Existing fail-open paths are known limitations to address narrowly.
- Preserve “verify, don't audit”: correct routine work gets no manufactured question. Offer independent practice at a workflow transition instead.
- Do not use a matching final number to approve invalid reasoning.
- Test the reviewed example through actual leak guarding; ensure legitimate instruction is not stripped into an unhelpful fallback.

## Parsing and existing evals

Keep structured problem setup once, parts/subparts/hints/closing and asksFor. Large source PDFs are sliced rather than sent whole. Figure descriptions are machine interpretations and may be wrong.

Private parsing/check/mark runners and saved outputs live in ../evals-private/. Existing small synthetic results are regression evidence, not population accuracy or learner outcomes. Use invented text in committed tests; never commit real course material to this public app checkout.

For prompt/provider/guard changes run relevant saved-case comparison and inspect actual output. String assertions on prompts are insufficient. Record count, version, input source and uncertainty; do not repeat old percentages as current performance.

## Delivery and safety

The owner's development key is currently in device/config. Never print it, commit it or distribute it. Demo is founder-operated. External independent builds need secure access, provider/data-flow consent and suitable deletion/export handling first; no claim of full privacy/compliance readiness.

Keep raw work out of analytics. Do not add monitoring, cheating scores, peer comparisons or engagement targets. Accessibility support is not automatically instructional assistance.

## Working agreement

Follow the user task and ordered backlog. Prefer small reviewable changes. Update docs/status when source changes; do not mark device acceptance from unit tests. No source implementation is authorized by the documentation rewrite alone.

Original implementation history is preserved in [the archive](../archive/2026-10-29-before-pivot/app/CLAUDE.md.txt).
