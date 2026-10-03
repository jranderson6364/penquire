# Backlog

Ordered by priority. Each item lists acceptance criteria. "🔨 native" = needs an EAS rebuild.

## Now: make v0 trustworthy in daily use

- [ ] **Accuracy feedback loop.** Add 👍/👎 and "this mark is wrong" on each mark popover. Store the page image, the line verdicts and the correction under `Documents/penquire/evals/`. Add a Settings button to export them (share sheet, zip or JSON).
  - *Done when:* corrections persist across restarts and export to Files.
- [ ] **Cost/usage meter.** Record token usage per check and reply (already returned in `CheckResult.usage`). Show this month's estimated cost in Settings, with per-model price constants in one file.
- [ ] **Check only the active part.** Add a toolbar picker for the current part (from `assignment.problems`) and pass `focusPart`. Feedback emphasizes that part while still flagging missing ones.
- [ ] **Faster checks.** Shrink the image (JPEG option in `exportImage` 🔨 native, or crop to the written area). Target median under 6 s. Show elapsed time in the feedback footer.
- [ ] **Robustness.** Retry once on 429/5xx with backoff. Handle a missing `report_check` gracefully. Show a clear "no API key" state in the workspace.

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

- Line grouping can split or merge lines on cramped or diagonal writing (`src/ink/lines.ts`). Add a failing test case for each real example you hit.
- Portrait only by design for now.
