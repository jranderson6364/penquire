# Penquire: guide for Claude Code

Penquire is an iPad app where a student handwrites STEM homework with Apple Pencil and an AI tutor checks it: it marks each line ✓ / ~ / ✗ / ?, diagnoses the obstacle, and gives the one push that fits it (a pointer, a question, or the missing idea), **never giving answers**. The goal is understanding the student can use without the tutor. It's built for courses whose policy allows AI only for checking reasoning.

Product and strategy docs live one level up in `../docs/` (01 market, 02 strategy, 03 features F1–F17, 04 architecture, 05 roadmap, 06 risks, 07 learning science → product). Read `../docs/07-learning-science.md` before changing tutor behavior. Read `../docs/03-features.md` before building a new feature.

## Hard constraints (read first)

- **There is no Mac.** The developer is on Windows. iOS builds happen only in the cloud through EAS (`npm run build:dev`), with about 15 free builds a month and 10–20 minutes each.
  - **Any change under `modules/pencil-canvas/ios/` or any new package with native code requires a new cloud build.** Batch native changes, review Swift extra carefully (it can't be compiled locally), and say clearly when a change needs a rebuild.
  - JS/TS changes hot-reload over Wi-Fi with no build.
- **Never create or edit `ios/` or `android/`.** They're generated (Continuous Native Generation). Configure through `app.json` or config plugins.
- **Expo SDK 57 / RN 0.86 / React 19 / New Architecture.** Expo APIs change every SDK; check the installed package's type definitions in `node_modules` instead of relying on memory. See `AGENTS.md`.
  - Install packages with `npx expo install <pkg>`.
  - `expo-file-system` uses the **new** class API (`File`, `Directory`, `Paths`), not the legacy functions.
- **Pedagogy is a product requirement, not a style choice.** The tutor must never output final answers, corrected expressions, or multi-step derivations unless the help level and course policy allow it. A false ✓ (calling wrong or unreadable work valid) is the worst bug. Rules live in `src/ai/prompts.ts`; change them deliberately.
  - `TUTOR_RULES` has two kinds of rule: LIMITS (policy: what may be revealed, also enforced in code) and HOW TO HELP (teaching: diagnose, then choose the move). Don't turn a teaching preference into a limit or the reverse.
  - **Never widen a help level.** Stored `policyMaxLevel` values depend on each level's meaning. `ALLOWED_REVEALS` (`src/tutor/revealed.ts`) must match the "Allowed in revealed" line of each `HELP_LEVELS` rule (a test enforces it).
- **The API key is on the device (dev only).** `EXPO_PUBLIC_ANTHROPIC_API_KEY` from `.env` is bundled into the app. Never commit `.env`. Tester builds need the backend proxy (see the backlog).

## Commands

```powershell
npm start               # dev server (expo start --dev-client); iPad connects over LAN
npm run typecheck       # tsc --noEmit (must pass)
npm test                # node --test unit tests (src/**/*.test.ts)
npm run build:dev       # EAS cloud dev build (native changes only)
npx expo export --platform ios --output-dir dist-check   # quick bundle sanity check
```

Before saying a task is done: `npm run typecheck` and `npm test` pass. If native code changed, re-read the Swift against `node_modules/expo-modules-core/ios` APIs and flag that a rebuild is needed.

## Architecture (v0)

```
App.tsx                         state router: home | new | settings | workspace
modules/pencil-canvas/          local Expo module (autolinked from ./modules)
  ios/PencilCanvasView.swift      ExpoView wrapping PKCanvasView + PaperView background
  ios/PencilCanvasModule.swift    Props: allowFingerDrawing, showToolPicker, paper
                                  Event: onDrawingChanged {strokeCount} (debounced 350 ms)
                                  AsyncFunctions: getStrokes, getDrawing, setDrawing, clear,
                                  undo, redo, focus, exportImage(linesJSON, maxDim)
  src/PencilCanvasView.tsx        typed component + ref handle (PencilCanvasHandle)
src/ink/lines.ts                stroke boxes → lines L1..Ln, reading order (pure; property-tested in lines.property.test.ts; splits at wide horizontal gaps)
src/ai/types.ts                 TutorProvider interface (parseAssignment, check, reply)
src/ai/claude.ts                Anthropic Messages API via fetch; forced tool output
                                (report_check, report_problems); prompt caching on rules + context
src/ai/prompts.ts               TUTOR_RULES (ported from the validated Socratic skill), HELP_LEVELS 0–4
src/store/db.ts                 JSON store at Documents/penquire/db.json; pages at penquire/pages/<id>.pk
src/store/evalRecords.ts        pure accuracy-feedback records + export builder (unit-tested)
src/store/evals.ts              disk layer: penquire/evals/feedback.json, check images, JSON export
src/screens/WorkspaceScreen.tsx canvas + MarksOverlay + SidePanel; check/send/reparse/autosave
src/components/                 MarksOverlay, SidePanel (Feedback|Chat|Problems|Log), HelpLevelPicker
src/verify/expr.ts            deterministic math checker (parser, sampling equivalence, step relations); no deps
src/verify/leak.ts             answer-leak detector: judges the MATH in hint text with the checker (not keywords)
src/tutor/ladder.ts           per-issue hint rungs, clamped to policy in code, pruned when fixed
src/tutor/issues.ts           issue history per page: most help each open issue had; resolved on your own (<= level 1) vs with help
src/tutor/revealed.ts         reveal kinds allowed per level; overLevel() flags reported reveals above the level (logged, not hidden)
src/verify/guard.ts           downgrade-only algebra guard on check results; wired in src/ai/index.ts (guarded())
src/log.ts                      deterministic AI-use disclosure from the event log
```

Conventions that matter:

- **Native ↔ JS bridge passes JSON strings** (Sendable, simplest to bridge). Native view functions run on the main queue; Swift wraps UIKit work in `MainActor.assumeIsolated`, and async work uses `Task { @MainActor in … }`, not `DispatchQueue` closures.
- **Coordinates (apiVersion >= 2):** everything stored (strokes, line boxes, checks, exported images) is in PAGE space: a fixed 816x1056 pt Letter sheet (`src/page.ts`) that never changes with zoom, rotation or Split View. The native canvas reports `{scale, tx, ty}`; screen = page * scale + (tx, ty). Marks are mapped page -> screen from the line boxes **saved at check time**, hidden while pinching, and culled when off-screen. Checks saved before this (no `space: 'page-v2'`) are not drawn.
- **Native surface is thin and versioned:** native exposes generic primitives only (`setTool(spec)`, `setRulerActive`, `fitToWidth`, viewport events, `apiVersion`). All tool/toolbar UI is JS (`src/tools.ts`, `DrawingToolbar`), so UI changes cost no build. JS must keep working on an older binary: feature-detect with `nativeApiVersion` (1 = original, 2 = fixed page + zoom + tools).
- **Swift is compile-checked for free:** `.github/workflows/ios-compile.yml` builds the app on `macos-26` (Xcode 26.3's Swift rejects a header that EAS's newer toolchain only warns about, so macos-15 fails). Treat it as a gate before any EAS build; write Swift only with the Write/Edit tools (the shell eats `\(`).
- **The AI never outputs pixel coordinates.** It refers to line IDs (`L4`) drawn in the exported image's left gutter. Keep that contract for future annotation features (F10).
- **Providers are pluggable.** Add a new model or provider by implementing `TutorProvider`; screens call only `getProvider()`.
- **The event log is append-only** (`Assignment.events`). Every check or reply records the help level used. Event types: check, reply, start, dispute, resolved (level = most help the issue had), level_change, parse. The disclosure (`src/log.ts`) is derived from these; never hard-code claims there that the levels don't guarantee.
- **Reply intents:** buttons send `ReplyInput.intent` (`start` = Help me start, `dispute` = I think this is right, `more_help` = hint ladder); `intentBlock()` adds the matching instructions.
- Style: TypeScript strict, functional React components, `StyleSheet`, colors from `src/theme.ts`. Small files, no new state library.

## Build discipline (EAS builds are scarce: ~15 free iOS/month; user approved running the CLI, but ASK FIRST)

- Default to JS-only. Before any native change, check whether JS, `app.json`/config plugin, or an existing native API can do it.
- Batch native work. Build 2 (code written and CI-compiled, awaiting the user's OK to build): fixed page + zoom/pan + viewport events, `setTool`/ruler/Pencil double-tap, all orientations + Split View, page-rect export. Still pending after that: `exportImage` crop + JPEG/file-URI output, honor `maskedPathRanges`, `pageId`/`revision` on events, `expo-updates` + fingerprint `runtimeVersion`, `ios.privacyManifests`, optional KaTeX WebView (real LaTeX typesetting). Don't spend a build on one of these alone.
- Gate every build: `npm run typecheck`, `npm test`, `npx expo-doctor`, `npx expo export --platform ios --output-dir dist-check` (then delete `dist-check`). Re-read new Swift against `node_modules/expo-modules-core/ios`. Confirm native files are tracked (`git ls-files modules`) and committed before building: EAS packs from git.
- Say "NATIVE CHANGE: needs rebuild" in the commit and the reply. Never start a build without the user's yes.

## Research digest (details and sources in `../research/*.md`; tags [V]/[S]/[U] mark confidence; re-verify numbers)

Accuracy and pedagogy (the product's core risk):
- A false ✓ is the worst bug. Most grading errors are *transcription* errors, skewed toward "correct" (arXiv 2605.19043, not tested on Claude); models also silently "fix" the student's mistakes when reading. Every line needs a transcription + legibility field; `unreadable` and `needs_review` are normal verdicts, not failures.
- Target pipeline (backend phase): blind transcription with line IDs, independent second read (cheaper model), grade on the transcript, SymPy check that can only DOWNGRADE, refute-every-✓ verifier, student confirms the transcript. Best-of-N only on borderline cases.
- Hint ladder (user decision): one-tap escalation within `HELP_LEVELS` and the course policy ceiling. Pure questioning loses users (Khanmigo); unguarded answers hurt learning (Bastani PNAS). Never exceed `policyMaxLevel`.
- Answer-leak guards for any hint text: CAS check on contents, cross-family judge, templated fallback hint, adversarial-student suite in CI. Keyword filters alone miss adversarial leaks.
- Evals run on Windows: seed from feedback exports (`src/store/evals.ts`), code graders for false-valid rate (hard gate 0) and leakage, score with pass^k, log cache hits.

Algebra guard rules (src/verify, keep these invariants; tests in physics.test.ts are the false-downgrade gate):
- Only ever LOWERS a verdict (valid -> partial), never raises; stores `modelVerdict`. Unreadable/unparsed/prose lines and lines after an unreadable line are skipped.
- Substituting numbers for variables is a normal step: judge a step only when it is a rearrangement (same variables) or a full numeric answer. Tolerance comes from the decimals written (`roundingTol`), so rounded answers written with "=" pass.
- LaTeX in tests/strings: write it with the Write/Edit tools, not shell heredocs (the shell eats backslashes).

Untrusted model output: every check goes through `src/ai/sanitize.ts` (unknown/missing verdict -> "unreadable", never "valid"; bad/duplicate line IDs dropped) before guards or UI. Guards are wrapped in try/catch in guarded() and fall back to the model's own result, and `src/verify/fuzz.test.ts` (parser round-trip, garbage, hostile input, timing) must stay green. Parser input is capped at 400 chars.

Leak guard rules (src/verify/leak.ts): levels 0-3 withhold the corrected step, solved forms and final answers; level 4 may explain one step but a final numeric answer is withheld at EVERY level. Quoting the student's own line, and math unrelated to their work (analogous examples, named laws), is allowed. Normal-tutoring sentences in leak.physics.test.ts must never be withheld. Runs on question, feedback, line notes AND chat replies (pass `lines` in ReplyInput) in guarded(). Hint ladder: "More help" on a mark escalates that issue's rung (Assignment.ladder), re-asks at that level via reply(), logs a reply event with detail "hint ladder"; pruned after each check by issue key (part + transcribed reading, so a re-transcription resets a rung).

Claude API (verify with the `claude-api` skill before changing `src/ai/claude.ts`):
- Forced `tool_choice` (`any`/`tool`) is a 400 on Sonnet 5.5, Opus 5.5, Fable 5.1: use `auto` + explicit instruction + retry (`callTool`). Adding `strict: true` needs `additionalProperties: false` in every schema.
- Image tokens = ceil(w/28)*ceil(h/28); cap 2576 px on 4.7+ models, 1568 px older. Images go BEFORE text. Crop blank page, avoid recompression. Cached prefix reads are ~0.1x; keep the system prompt and tool list byte-stable.
- Always check `stop_reason` (`refusal`, `max_tokens`) before using content. Never put the key in a shipped build.

iPad / PencilKit:
- Never let a failed load blank a page that autosave can then persist (`setDrawing` throws; `loadedPageRef` guards saves). Erased strokes are masked, not removed (`maskedPathRanges`). `PKStroke` IDs are stable only on newer iOS: use `#available`.
- [U] iPadOS 27 may stop honoring `UIRequiresFullScreen` (re-read Apple TN3192). Prefer a fixed logical page size and compute line boxes, marks and exports in page points, not `canvas.bounds`. Without `requireFullScreen`, all four iPad orientations are needed (ITMS-90474).
- Keep marks as RN views with `pointerEvents="box-none"`; Skia adds a transparent Metal layer that hurts Pencil latency. PDF backgrounds: render under one canvas. Vision `VNRecognizeTextRequest` is unsuitable for math; Mathpix is an optional second reader.
- Marks need accessibility labels and 44 pt touch targets.

Ship blockers (before any tester build): backend proxy (Hono on Cloudflare Workers, key only as a Worker secret, App Attest + Durable Object spend caps, Anthropic workspace limit), AI consent screen naming Anthropic (App Store 5.1.2(i)), in-app account deletion, privacy policy + reviewer demo account, `PrivacyInfo.xcprivacy` via `ios.privacyManifests`, 13+ age screen, no ink content in analytics. The repo is PUBLIC (user decision): never commit secrets, and expect prompts to be visible.

Tooling: no Mac, so Swift only compiles in the cloud. Plan: GitHub Actions macOS job (`expo prebuild`, `pod install`, unsigned simulator `xcodebuild`) to catch Swift errors without spending an EAS build; `eas-build-pre-install` runs typecheck. Apple's simulator can't emulate Pencil input; use `allowFingerDrawing` for any automated UI test. Skip agent teams and Spec Kit; write short `specs/<feature>.md` with a "native? Y/N" line.

## Assignment parsing (measured, keep it that way)

- Output is STRUCTURED (`src/problems/`): per problem a title, the setup stored ONCE (`context`), lettered `parts` with `subparts` and `hint`, `closing` text for all parts, `notes` for non-problem text. `flatten()` derives the flat `Problem[]` ("6a", "1b.ii") that the tutor, part picker, ladder and snapshots key on; `formatGroups()` shows the tutor each setup once. Labels go through `normalizeProblemLabel/PartLabel`.
- Pipeline in `ClaudeProvider.parseAssignment`: strict tool schema -> `sanitizeParsed` -> `validateGroups` (letter gaps, empty parts, repeated setup, LaTeX health) -> ONE repair pass if there are errors -> remaining issues are shown in the Problems tab. Prompt: `src/ai/parsePrompt.ts`. Default parse model is Opus 5.5 (Sonnet 5.5 misread a figure's angle axis; judge-verified), effort high.
- Large PDFs are never sent whole: the student gives a page range and `slicePdf` (pure-JS pdf-lib) cuts it on-device; the sliced PDF is the re-parse source. Assignment stores `sourcePages`, `sourceOnly`, `activePart`.
- Figure text `[Figure: ...]` is machine-written and may be wrong: the UI labels it "auto-described" and TUTOR_RULES tells the tutor never to rely on it.
- EVAL LOOP lives OUTSIDE the repo in `Penquire/evals-private/parse/` (gold files quote real course PSets; this repo is PUBLIC, so never commit them or real problem text; committed tests use invented text). Build: `npx --yes esbuild run.ts --bundle --platform=node --format=esm --outfile=dist/run.mjs`; run from that folder: `node dist/run.mjs --sets pset0,pset1,m51_ch3 --variant new --label X [--model M --effort E --repeat N]`; `--rescore <out dir>` re-grades saved output free; `judge.ts` runs a stronger independent model over page images. Scorer: `src/problems/score.ts`. Baseline (old flat parser) 65.2% -> structured parser 99.7% over 6 runs. Change the prompt/schema only with a before/after run.

## Check stance and eval (measured, keep it that way)

- The tutor VERIFIES, it does not audit: assume a competent student, do the maths, accept mental arithmetic/routine algebra, ask only when a line is actually wrong/incomplete or the problem asks for shown work. Correct page => empty `question`. Guarded by `src/ai/stance.test.ts`; change `TUTOR_RULES` only with a before/after run.
- Eval lives OUTSIDE the repo in `Penquire/evals-private/check/` (real handwritten page + synthetic pages with known truth: `python synth.py`, then `node dist/synth.mjs --label X`; build with esbuild). Result of the reframing: needless questions on correct pages 6/6 -> 0/8, false alarms 1/16 -> 0/20, real mistakes caught 8/8 kept.
- Carry-over (`src/check/carry.ts`): each line gets a stroke-box signature; after a check, unchanged `valid`/`context` lines are SETTLED and the next check grades only new/changed lines (the model sees settled lines as context and is told not to mention them). A change or erased line re-grades the later lines of the same part; pixel-eraser use disables carry; the model may only downgrade a settled line; untouched parts keep their chip (`mergeParts`). Per-line `part` is required in the tool schema and sanitised to the problem list. Eval: `evals-private/check/run_tworound.ts` (6/6 scenarios; single-round regression 0/23 false alarms, 13/13 caught).
- Tutor marks (`src/tutor/marks.ts`, `TutorMarksLayer`): chat replies use the `reply_to_student` tool (message + marks). The model names a gutter line ID, code stores that line's page-space box; kinds highlight/circle/underline/note; max 4; only the latest 2 chat turns keep marks; notes pass the leak guard; the student never sees gutter labels, so replies must not cite L-ids. Eval `evals-private/check/run_marks.ts`: marks land on the mistaken row 8/8, 0 L-label mentions.
- Question blocks (`src/blocks.ts`, `BlocksLayer`): "Place part / Place setup" typesets the problem text on the page (above the ink, touch-through, drag/remove handle). Stored in `Assignment.blocks[pageId]`.
- `src/ink/lines.ts` merges everything inside a matched tall-bracket pair into one line (matrices), so the AI sees one label per equation.
- The AI sidebar DOCKS (shrinks the canvas area) so the page re-centres in the remaining space instead of being overlaid.

## Working agreement

- Read `BACKLOG.md`, pick the top unchecked item unless told otherwise, and keep changes scoped to it.
- Prefer JS-only solutions when they're good enough; native changes cost a cloud build.
- Add unit tests for pure logic (ink geometry, parsing, prompt and schema helpers).
- Update `BACKLOG.md` (check items off, add discovered work) and this file if architecture changes.
- Commit in small, descriptive commits.
