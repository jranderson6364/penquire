# Penquire: guide for Claude Code

Penquire is an iPad app where a student handwrites STEM homework with Apple Pencil and an AI tutor gives **Socratic** feedback: it marks each line ✓ / ~ / ✗ / ? and asks one guiding question, **never giving answers**. It's built for courses whose policy allows AI only for checking reasoning.

Product and strategy docs live one level up in `../docs/` (01 market, 02 strategy, 03 features F1–F15, 04 architecture, 05 roadmap, 06 risks). Read `../docs/03-features.md` before building a new feature.

## Hard constraints (read first)

- **There is no Mac.** The developer is on Windows. iOS builds happen only in the cloud through EAS (`npm run build:dev`), with about 15 free builds a month and 10–20 minutes each.
  - **Any change under `modules/pencil-canvas/ios/` or any new package with native code requires a new cloud build.** Batch native changes, review Swift extra carefully (it can't be compiled locally), and say clearly when a change needs a rebuild.
  - JS/TS changes hot-reload over Wi-Fi with no build.
- **Never create or edit `ios/` or `android/`.** They're generated (Continuous Native Generation). Configure through `app.json` or config plugins.
- **Expo SDK 57 / RN 0.86 / React 19 / New Architecture.** Expo APIs change every SDK; check the installed package's type definitions in `node_modules` instead of relying on memory. See `AGENTS.md`.
  - Install packages with `npx expo install <pkg>`.
  - `expo-file-system` uses the **new** class API (`File`, `Directory`, `Paths`), not the legacy functions.
- **Pedagogy is a product requirement, not a style choice.** The tutor must never output final answers, corrected expressions, or multi-step derivations unless the help level and course policy allow it. A false ✓ (calling wrong or unreadable work valid) is the worst bug. Rules live in `src/ai/prompts.ts`; change them deliberately.
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
src/ink/lines.ts                stroke boxes → lines L1..Ln (pure, unit-tested heuristics)
src/ai/types.ts                 TutorProvider interface (parseAssignment, check, reply)
src/ai/claude.ts                Anthropic Messages API via fetch; forced tool output
                                (report_check, report_problems); prompt caching on rules + context
src/ai/prompts.ts               TUTOR_RULES (ported from the validated Socratic skill), HELP_LEVELS 0–4
src/store/db.ts                 JSON store at Documents/penquire/db.json; pages at penquire/pages/<id>.pk
src/store/evalRecords.ts        pure accuracy-feedback records + export builder (unit-tested)
src/store/evals.ts              disk layer: penquire/evals/feedback.json, check images, JSON export
src/screens/WorkspaceScreen.tsx canvas + MarksOverlay + SidePanel; check/send/reparse/autosave
src/components/                 MarksOverlay, SidePanel (Feedback|Chat|Problems|Log), HelpLevelPicker
src/log.ts                      deterministic AI-use disclosure from the event log
```

Conventions that matter:

- **Native ↔ JS bridge passes JSON strings** (Sendable, simplest to bridge). Native view functions run on the main queue; Swift wraps UIKit work in `MainActor.assumeIsolated`, and async work uses `Task { @MainActor in … }`, not `DispatchQueue` closures.
- **Coordinates:** canvas points = RN layout points (portrait only, no zoom or scroll, `requireFullScreen`). Marks are positioned from the line boxes **saved at check time**.
- **The AI never outputs pixel coordinates.** It refers to line IDs (`L4`) drawn in the exported image's left gutter. Keep that contract for future annotation features (F10).
- **Providers are pluggable.** Add a new model or provider by implementing `TutorProvider`; screens call only `getProvider()`.
- **The event log is append-only** (`Assignment.events`). Every check or reply records the help level used.
- Style: TypeScript strict, functional React components, `StyleSheet`, colors from `src/theme.ts`. Small files, no new state library.

## Working agreement

- Read `BACKLOG.md`, pick the top unchecked item unless told otherwise, and keep changes scoped to it.
- Prefer JS-only solutions when they're good enough; native changes cost a cloud build.
- Add unit tests for pure logic (ink geometry, parsing, prompt and schema helpers).
- Update `BACKLOG.md` (check items off, add discovered work) and this file if architecture changes.
- Commit in small, descriptive commits.
