# Backlog

Ordered by priority. Each item lists acceptance criteria. "🔨 native" = needs an EAS rebuild.

## Now: make v0 trustworthy in daily use

- [x] **Accuracy feedback loop.** Add 👍/👎 and "this mark is wrong" on each mark popover. Store the page image, the line verdicts and the correction under `Documents/penquire/evals/`. Add a Settings button to export them (share sheet, zip or JSON).
  - *Done when:* corrections persist across restarts and export to Files.
- [x] **Cost/usage meter.** (done: per-call records in db.json, prices in src/ai/pricing.ts, month total in Settings; prices need re-verifying) Record token usage per check and reply (already returned in `CheckResult.usage`). Show this month's estimated cost in Settings, with per-model price constants in one file.
- [x] **Check only the active part.** (done: toolbar PartPicker -> focusPart; plus a no-API-key banner and alert) Add a toolbar picker for the current part (from `assignment.problems`) and pass `focusPart`. Feedback emphasizes that part while still flagging missing ones.
- [ ] **Faster checks.** Shrink the image (JPEG option in `exportImage` 🔨 native, or crop to the written area). Target median under 6 s. Show elapsed time in the feedback footer.
- [x] **Robustness** (done: retry with backoff on 429/5xx/network, Retry-After honored, 180 s timeout, refusal/max_tokens/empty handled, sanitized output). Still open: a clear "no API key" state in the workspace.
- [ ] (old text) **Robustness.** Retry once on 429/5xx with backoff. Handle a missing `report_check` gracefully. Show a clear "no API key" state in the workspace.

## Reliability + experience (../docs/09-reliability-and-experience.md, Oct 6 2026)

Phase 0 (JS-only), branch `reliability-phase0`:
- [x] Guards re-run on the merged page after carry-over (`src/check/finalize.ts`): new line after a settled line is step-checked; leak guard sees settled readings.
- [x] Issue/ladder identity from the ink signature, not the reading (`issueKey(part, reading, sig)`), with migration of stored keys. No more false "resolved on your own".
- [x] Check prompt shows each setup once (`problemsText` → `formatGroups`), with an explicit part-label list; falls back to the flat list on mismatch.
- [x] `read_confidence` + `uncertain` per line; `applyReadingGuard` turns low-confidence graded lines into `?` with a confirm prompt.
- [x] Units v1 (`src/verify/units.ts`): SI comparison, dropped units not judged, dimension mismatch caught; readings now carry units in `\mathrm{}`. Sig-fig rounding for trailing-zero integers.
- [x] Eval hygiene: `run_synth` splits model vs guard flags and prints Wilson 95% CIs.
- [x] Mark popover → 3 actions + "Something's off" sheet; "Read as" evidence with uncertain characters; one Check button; inline notices instead of Alerts for check outcomes.
- [ ] Panel 4 tabs → 2 (Tutor stream · Assignment). Help-level chip in the Tutor header.
- [ ] Part title as the question menu ("3b ▾": prev/next, Place part/setup, expand); ruler into the tool popover.
- [ ] Check button shows its stage (reading → checking → n marks) once streaming exists.
- [ ] Calibrate `read_confidence` on real handwriting (synthetic pages all read "high"; no signal there).
- [ ] Continuation lines that start with "=" are unparsed by `expr.ts`: join them to the previous line's last side.
- [ ] Bare units (`60 km/h` without `\mathrm`) are left unjudged; consider recognising a trailing unit token.
- [ ] Dispute flow: require verifier/second-reader agreement before conceding; add a wrongful-concession eval.

Phase 1 (ONE batched native build; ask first): stroke points with `maskedPathRanges` applied + timing + stable IDs, gutter-free export, Reanimated, react-native-svg, expo-haptics (+ the Build 2 items). Test Pencil latency with an svg overlay on device before considering Skia.

Phase 2: replayable case format (strokes + clean image + per-stage outputs) and a Node `replay` runner; ~200 real gold lines in `../evals-private/`; fused vs split (blind transcription) A/B; Mathpix strokes second reader; animated AI ink (path reveal, pressure outline, single-stroke math, Manim-like timing); TutorTurn `{text, marks, speechCues}`. Tutor draws freely (founder decision): max 3 live marks per turn, older turns fade, one Clear.

## Learning science (../docs/07-learning-science.md, Oct 2026)

- [x] Prompt rewrite (LIMITS vs HOW TO HELP), renamed help levels with caps unchanged, `obstacle` per line, `revealed` per check + `overLevel`, issue history with on-your-own vs with-help outcomes, repeat-issue nudge, Help me start, dispute a mark, disclosure derived from levels used.
- [ ] **Dogfood the new prompt** on 3–5 real pages; rate marks; compare with the previous prompt on the same pages (`git show HEAD~1:src/ai/prompts.ts`). Watch for: vaguer slips, level-1 answers that name principles, empty `revealed`.
- [ ] **Tutor-behavior eval cases** (model in the loop, under `../evals-private/`; committed fixtures use invented problems): over-withholding (allowed help asked for, or same error twice, and the tutor only asks a question), repeated-hint loops, correct answer + invalid reasoning (must not ✓), valid alternative method (must not ✗), wrong verdict challenged (must re-check and concede), repeated "I don't know", confident misconception, "ok fixed" with no page change, wrong figure description. Grade `revealed` against the reply text with a judge model. Targets: over-withholding < 5%, leak < 1%.
- [ ] Use `obstacle` to pick the entry move in code (e.g. `prerequisite` at level < 2 → show "Remind me of the idea" on the mark).
- [ ] P2: course-pack enrichment (`target_skill`, `prereqs`, typed errors, verifier-checked variants, pre-generated hints), Error notebook + spaced review (F16), Check yourself (F17), faded similar example.

## Research-driven (from ../research/*.md, Oct 2026; re-verify numbers before acting)

Blockers before any tester build:
- [ ] **Move the API key off the device** (backend proxy, below) and add an **AI consent screen naming Anthropic** (App Store guideline 5.1.2(i)), **in-app account deletion**, a privacy policy and a reviewer demo account.
- [ ] **Fix `setDrawing` so a decode failure throws** instead of loading a blank drawing that the next autosave would persist 🔨 native.
- [ ] **Verify the iPadOS 27 `UIRequiresFullScreen` claim** (re-read Apple TN3192). If true: fixed logical page size, with line boxes, marks and exports in page points rather than `canvas.bounds`; allow all four iPad orientations (else ITMS-90474).

Accuracy (the product's core risk is a false ✓):
- [ ] **Per-line `transcription` + legibility in `report_check`**; show it to the student; a "Misread" rating forces `?`. Most grading errors are transcription errors (arXiv 2605.19043, not tested on Claude).
- [ ] **Golden eval set** (20-50 cases from feedback exports, grow to ~200). Code graders: false-valid rate (hard gate at 0) and answer leakage; run on Windows, nightly via Batch. Log cache hit counts.
- [x] **Algebra guard v1** (JS, on-device): parser + sampling equivalence + step relations, downgrade-only, wired into every check. Next: hint-ladder leak guard reusing `checkStep` (block any hint that is a valid next step from the student's last line), fixtures file of real derivations, node script replaying exported feedback through the guard, units/vector support, `\text` stripping.
- [ ] **Verifier pass**: blind second read with a cheaper model, a SymPy check that can only downgrade a verdict, a refute-every-✓ pass. Needs the backend.
- [x] **Answer-leak guard v1** (math-equivalence based, wired into check results) and **ladder state logic** (`src/tutor/ladder.ts`). Ladder UI ("More help" on a mark), persisted `ladder`, event logging and the chat-reply guard are done. Remaining: cross-family LLM judge + adversarial-student suite (backend phase).
- [ ] **Answer-leak guards (remaining layers)**: CAS check on hint contents, cross-family judge, templated fallback hint, adversarial-student suite. Consider a one-tap hint ladder (Khanmigo evidence); product decision.
- [ ] Add `strict: true` to `report_check` / `report_problems` (needs `additionalProperties: false` throughout).
- [ ] Honor `maskedPathRanges` for erased strokes; add `pageId` and `revision` to canvas events.

Cost and speed:
- [ ] Crop blank page, make `maxDimension` model-aware (cap 2576 px on 4.7+, 1568 px older), return a file URI instead of base64. About 3.9k image tokens per check today (estimate).

Tooling (no Mac):
- [ ] **CLAUDE.md as single source**, imported from AGENTS.md (AGENTS.md currently says Expo Router, but the app uses a state router).
- [ ] **Hooks (Node scripts)**: block edits to `ios/` and `android/`; print REBUILD NEEDED on native changes; Stop hook running typecheck and tests.
- [ ] **Fix the macOS Swift compile job** (`.github/workflows/ios-compile.yml`, currently experimental): fails resolving package dependencies in ExpoModulesJSI's script phase; try `xcodebuild -resolvePackageDependencies` first or build only the PencilCanvas pod target. (Repo is public: github.com/jranderson6364/penquire; CI checks job passes.)
- [x] **GitHub remote + CI**: typecheck, tests, `expo-doctor`; optional macOS job (`expo prebuild`, `pod install`, unsigned `xcodebuild`) to compile-check Swift. Free on public repos, so decide on prompt visibility first.
- [ ] **Install `expo-updates` with a fingerprint `runtimeVersion` policy** 🔨 native (bundle with the next rebuild), then EAS Workflows so JS-only changes ship OTA. Do not publish updates to a shared channel until the proxy exists.
- [ ] `eas-build-pre-install` hook running typecheck so a TS error never burns one of the ~15 monthly builds.
- [ ] Specs: lightweight `specs/<feature>.md` with a "native? Y/N" field and named acceptance tests.

Later: Sentry + PostHog (no ink content in events), RevenueCat, 13+ age screen, `PrivacyInfo.xcprivacy` via `expo.ios.privacyManifests`, App Attest + Durable Object budgets in the Worker, Mathpix as an optional second reader, accessible marks (labels, 44 pt targets), `PKStrokeRecognizer` as a readability preflight.

## Next: v0.2 features (see ../docs/03-features.md)

- [ ] **F10 AI ink (overlay only, JS).** Extend `report_check` with an `annotations` array: `circle{line, span?}`, `underline{line}`, `arrow{from, to}`, `note{near, text}`. Render on an overlay above the canvas (react-native-svg, or Skia if animation is needed), in a distinct color, dismissible, using the same line boxes as the marks. Schema-validate and drop invalid commands.
  - *Done when:* 95% of annotations land on the intended line in 20 test pages.
- [ ] **Backend proxy** (`../backend/worker`, Cloudflare Worker + Hono). Add `/check`, `/reply`, `/parse` holding the API key. App setting: "Use Penquire server," with URL and a simple device token.
  - *Done when:* a TestFlight build works with no key on the device.
- [ ] **Pset PDF as page background.** Render a PDF page under the ink (PaperView option or a PDFKit view 🔨 native). Include it in the exported image so the AI sees the printed problem next to the work.
- [ ] **Edit parsed problems.** Edit or delete parts and fix `asks_for` in the Problems tab.
- [ ] ~~Exam review summary~~ → superseded by the Error notebook + spaced review (F16, P2).

## Later

- [ ] SymPy verifier service (algebra equivalence between consecutive lines, units, plug-back) feeding "evidence" into the check prompt.
- [ ] Diff-based checks (send only changed lines plus previous verdicts).
- [ ] Zoom and scroll on the canvas, with the overlay sharing the transform 🔨 native.
- [ ] Voice push-to-talk (Apple speech recognition + speech synthesis with per-word callbacks for drawing cues) 🔨 native.
- [ ] Lecture mode (F12), instructor view (F14), photo capture for students without an iPad (F15).
- [ ] TestFlight distribution to classmates (needs the backend proxy first).

## Known issues

- Fixed: forced `tool_choice` returned a 400 on Sonnet 5.5 / Opus 5.5 / Fable 5.1; `claude.ts` now uses `auto` + instruction + one retry. Not yet tested against the live API.
- Line grouping (`src/ink/lines.ts`) is property-tested on synthetic pages (level to 36 pt spacing, tilt to ~3 degrees, subscripts, shuffled input) and splits side-by-side work at wide gaps. Synthetic data is not real handwriting: add a failing test for each real example you hit (export strokes boxes from a bad page).
- Portrait only by design for now.
