# Pivot backlog: demo before November 3

Updated October 30, 2026 (T10). Ready on **November 2, Pacific time**.

Status key: **[x]** = in source and covered by pure tests (typecheck clean, `npm test` passing); **not device-verified** unless it says so. Device acceptance is `tasks/T11-device-checklist.md` (workspace folder, outside git). Read [demo spec](../docs/12-demo-spec.md) before implementing.

## Critical path

### D0 — Confirm the device baseline
- Status: done October 29 (T01) at API 5; build 7 (API 8) is now installed, build 8 (API 9) is built and not installed. Demo stays JS-only.
- [x] Run current typecheck/tests and record unrelated failures.
- [x] Open installed dev client on iPad; write/save/reopen and make one real configured provider call.
- [x] Record installed native API/capabilities; source is API 6.
- [x] Confirm whether the planned workflow can stay JS-only; prefer compatibility fallback.
- Acceptance: existing app works enough to build on; any true blocker is named.
- Date: Oct 29. Dependencies: none.

### D1 — Seed one original reviewed skill pack
- Status: in source (`src/learning/demoPack.ts`, `seed.ts`, `seedData.ts`; Home › Demo practice). Pure tests cover key isolation and reset scope. Not device-verified.
- [x] Implement deterministic demo entry/reset with the tasks/policy in docs/12.
- [x] Keep independent/future answer keys out of learner content before submission.
- [x] Use static authored context; no live PDF parse or variant generation dependency.
- [x] Reset only demo records; preserve ordinary assignments.
- Acceptance: same pack opens from a clean start and resume; caps are explicit.
- Date: Oct 29–30. Dependencies: D0. Suggested: new src/learning/demoPack.ts.

### D2 — Persist recovery episode and immutable attempt evidence
- Status: in source (`src/learning/types.ts`, `session.ts`, `snapshot.ts`, `store/episodes.ts`). Old DBs load with `episodes: []`. File copies and relaunch not device-verified. Known limit: the workspace repair flag is rebuilt from the latest check, not persisted.
- [x] Add compatible optional episode/attempt/assistance/outcome fields and pure transitions.
- [x] Preserve initial attempt, supported repair and independent submission separately.
- [ ] Resume across relaunch; default old DBs safely.
- [x] Keep issue tracking distinct from learning evidence.
- Acceptance: state survives navigation/restart; old work remains; no disappearance-to-mastery inference.
- Date: Oct 30. Dependencies: D1. Suggested: src/learning/types.ts, session.ts; store/types.ts and db.ts.

### D3 — Quiet work and direct useful help
- Status: in source (WorkspaceScreen pivot flow + `LearningBar`; helpers in `src/learning/workspaceFlow.ts`). Example passes the real leak guard in a test. Not device-verified; real provider replies not reviewed.
- [x] Suppress automatic checking in pivot flow even with legacy autoCheck=true.
- [x] Offer pointer/explanation/example directly, mapped to permitted existing levels.
- [ ] Show a focused finding, accept reading confirmation/dispute, preserve help-me-start.
- [x] Verify authored explanation/example through the real guards; scope any study example to its different task.
- [ ] Record actual delivered text/mark/speech assistance or a bounded reference; unknown exposure stays unknown.
- Acceptance: explicit help works, no forced weaker-rung traversal, restrictions remain.
- Date: Oct 31. Dependencies: D2. Touchpoints: WorkspaceScreen; ai prompts/context; tutor ladder/revealed as needed.

### D4 — Verify actual supported repair and fix labels
- Status: in source (`repairEvidence`, `resolvedAfter` buckets, neutral disclosure). Not device-verified.
- [x] Require changed/re-read work for verified repair; erasing a flag alone is insufficient.
- [x] Label marks/pointer/explanation/example repairs supported.
- [x] Remove “on your own”/authorship guarantees unsupported by the observed record.
- [x] Preserve tutor reversals separately.
- Acceptance: revised work establishes repair; no independent-pass label yet.
- Date: Oct 31. Dependencies: D3. Touchpoints: tutor/issues.ts; log.ts; progress/home/tutor presentation.

### D5 — Isolated fresh independent task
- Status: in source (`IndependentScreen.tsx`, `context.ts`, `assess.ts`, `independentFlow.ts`, gate + `stopAllVoice`). Typed fallback not built. Not device-verified; real model labelling of explanation lines unconfirmed.
- [x] Allocate fresh task/page/attempt; hide previous assistance.
- [ ] Suppress auto-checks, queued speech, old transcript/marks and stale streamed/provider responses.
- [x] No provider assessment until Submit; isolate task context from original problems/history/settled/lastCheck.
- [x] Freeze submitted work; check against reviewed task/rubric; handle wrong/ambiguous/alternative reasoning.
- [x] Help requires explicit exit; classify supported practice. Edits invalidate prior assessment.
- [x] Prevent duplicate submit and late-result crossover.
- Acceptance: no instructional cues or wrong-task assessment; outcome follows actual submitted evidence.
- Date: Nov 1. Dependencies: D2–D4. Suggested: learning/context.ts and small LearningFlow/independent surface.

### D6 — Outcome and real future review record
- Status: in source (`OutcomeCard`, `EpisodeCard`, `scheduleReview`). After an edit-and-resubmit the first review date is kept. Not device-verified.
- [x] Separate supported repair from fresh independent pass/needs practice/unassessable.
- [x] Persist due timestamp seven days after scheduling and display local date.
- [x] Delayed outcome remains empty; no mastery/retained badge.
- [x] Add minimum resume/history display; no dashboard project.
- Acceptance: result and due date survive relaunch and are semantically honest.
- Date: Nov 1. Dependencies: D5.

### D7 — Demo verification and rehearsal
- Status: typecheck/tests/bundle done by T10 (October 30); device items are T11.
- [x] Run typecheck/tests and targeted transition/guard cases.
- [ ] Complete every docs/12 acceptance item on the actual iPad.
- [ ] Rehearse live path three times; inspect snapshot persistence and reset.
- [ ] Exercise wrong independent answer, misleading correct final answer, uncertainty, restricted policy and delayed prior response.
- [ ] Check network/guard failure preserves work and never invents success.
- [ ] Record a short actual working run; clearly label recording/fixture fallback.
- [ ] Freeze features; record known limits and delivery mode in presenter notes.
- Acceptance: working founder-operated demo ready Nov 2; no unsupported learning claim.
- Date: Nov 2. Dependencies: D0–D6.

## Tests worth writing during implementation

Pure state transitions/legacy loading; direct-choice permission clamp; independent context isolation and stale callback handling; assistance reclassification; post-submit invalidation; snapshot/due-date persistence; reset scope; reviewed-pack correct/wrong/uncertain assessments.

Use existing guard/parser tests. Add model/device checks only where actual behavior depends on them. Do not create tests merely duplicating static copy.

## Cuts if late

Drop second subject, full onboarding, dashboard, notifications, new voice/ink polish and broader ingestion. Use a minimal separate typed-working screen for independent practice if canvas coordination dominates; preserve reasoning and label the modality.

Never cut honest outcomes, cue isolation, work preservation, cap compatibility or a genuine fresh submission. Full prioritized cuts are in [roadmap](../docs/05-roadmap.md).

## Deferred until after demo

- Real delayed retrieval delivery and a richer review queue.
- Second reviewed skill and stronger method-selection transfer.
- Concierge paper/photo intake and native-value comparison.
- Secure proxy and external-distribution privacy/consent/deletion work.
- Real learner comparison and outcome scoring.
- Broader verifier/replay work based on observed failures.

Paused: subscriptions, instructor dashboards, cloud sync, generalized curriculum/adaptation, premium/hands-free voice expansion, new native libraries, Expo Router migration, public launch.

## Existing assets to preserve

Canvas/page-space and native feature detection; structured parsing; capture/save guards; uncertainty/disputes; algebra/units/leak checks; signature identity/carry-over; original-work export; existing accessible voice. Documentation does not authorize deleting these.

Old completed items and implementation chronology remain in [the archived backlog](../archive/2026-10-29-before-pivot/app/BACKLOG.md.txt). Re-verify source/device before relying on a historical checkbox.
