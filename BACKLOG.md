# Backlog

Ordered by priority. Each item lists acceptance criteria. "🔨 native" = needs an EAS rebuild.

## Now: make v0 trustworthy in daily use

- [x] **Accuracy feedback loop.** Add 👍/👎 and "this mark is wrong" on each mark popover. Store the page image, the line verdicts and the correction under `Documents/penquire/evals/`. Add a Settings button to export them (share sheet, zip or JSON).
  - *Done when:* corrections persist across restarts and export to Files.
- [ ] **Cost/usage meter.** Record token usage per check and reply (already returned in `CheckResult.usage`). Show this month's estimated cost in Settings, with per-model price constants in one file.
- [ ] **Check only the active part.** Add a toolbar picker for the current part (from `assignment.problems`) and pass `focusPart`. Feedback emphasizes that part while still flagging missing ones.
- [ ] **Faster checks.** Shrink the image (JPEG option in `exportImage` 🔨 native, or crop to the written area). Target median under 6 s. Show elapsed time in the feedback footer.
- [ ] **Robustness.** Retry once on 429/5xx with backoff. Handle a missing `report_check` gracefully. Show a clear "no API key" state in the workspace.

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
- [x] **Answer-leak guard v1** (math-equivalence based, wired into check results) and **ladder state logic** (`src/tutor/ladder.ts`). Remaining: UI ("More help" on a mark popover that escalates THAT issue and re-asks at the new rung), persist `ladder` on the Assignment, log each rung to `events`, cover chat `reply()`, cross-family LLM judge + adversarial-student suite (backend phase).
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
- [ ] **Exam review summary.** From the event log and verdict notes, list recurring mistake types per course (cheap model).

## Later

- [ ] SymPy verifier service (algebra equivalence between consecutive lines, units, plug-back) feeding "evidence" into the check prompt.
- [ ] Diff-based checks (send only changed lines plus previous verdicts).
- [ ] Zoom and scroll on the canvas, with the overlay sharing the transform 🔨 native.
- [ ] Voice push-to-talk (Apple speech recognition + speech synthesis with per-word callbacks for drawing cues) 🔨 native.
- [ ] Lecture mode (F12), instructor view (F14), photo capture for students without an iPad (F15).
- [ ] TestFlight distribution to classmates (needs the backend proxy first).

## Known issues

- Fixed: forced `tool_choice` returned a 400 on Sonnet 5.5 / Opus 5.5 / Fable 5.1; `claude.ts` now uses `auto` + instruction + one retry. Not yet tested against the live API.
- Line grouping can split or merge lines on cramped or diagonal writing (`src/ink/lines.ts`). Add a failing test case for each real example you hit.
- Portrait only by design for now.
