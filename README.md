# Penquire app: v0 prototype

An iPad app where you write with Apple Pencil and tap **Check**. Claude reads your page along with the actual assignment, marks each line ✓ / ~ / ✗ / ? in the margin, and asks one guiding question. Tap a mark to see why. Use the Chat tab to push back or describe a fix in words.

**v0 includes:**

- PencilKit canvas (native ink, palm rejection, Apple's tool palette), multiple pages, autosave
- Pset PDF import → Claude splits it into parts, with what each part asks for
- Check: line grouping on the iPad → labeled page image → Claude → margin marks + feedback panel
- "Fixed since last check" / "still open" tracking
- Help levels 0–4, capped by the course policy you enter
- Chat with optional page attachment
- Session log + one-tap AI-use disclosure text

**Not yet:** AI drawing on the page (circles and arrows), a backend proxy, PDF as the page background, SymPy verification, voice. See "Next steps."

> ⚠️ **Dev only:** the Anthropic API key is bundled into the app on your iPad. Fine for you; move AI calls behind the backend before giving builds to testers.

---

## One-time setup (Windows → iPad)

You need: Windows PC, iPad + Apple Pencil on the **same Wi-Fi**, Node.js 20+ LTS, an **Apple Developer account** ($99/yr), and a free **Expo account** (expo.dev).

```powershell
cd $HOME\Downloads\Penquire\app
npm install
copy .env.example .env      # then edit .env and paste your Anthropic API key
npm install -g eas-cli
eas login                   # Expo account
eas init                    # links this folder to an Expo project (adds projectId to app.json)
```

**Register your iPad** (once):

```powershell
eas device:create
```

Open the link it prints **on the iPad in Safari** and install the profile. Then turn on **Settings → Privacy & Security → Developer Mode** on the iPad and restart it. Development builds need this on iOS 16+.

**Build the development app in the cloud** (~10–20 min; no Mac needed):

```powershell
npm run build:dev           # = eas build --profile development --platform ios
```

EAS will ask for your Apple ID and create the certificates and provisioning profile automatically. When it finishes, open the build link or QR code on the iPad and install it.

If `com.jander.penquire` is rejected as a bundle ID, change `ios.bundleIdentifier` in `app.json` and build again.

## Daily loop

```powershell
npm start                   # = expo start --dev-client
```

Open **Penquire** on the iPad. It finds the dev server on your network (or scan the QR code / enter the URL). Edits to TypeScript reload instantly on the iPad.

- **Rebuild (`npm run build:dev`) only** when native code changes: anything in `modules/pencil-canvas/ios/`, or a new package with native code. EAS Free allows about 15 iOS builds a month.
- If the iPad can't reach the server: allow Node through Windows Firewall (Private networks), or run `npx expo start --dev-client --tunnel`.
- Logs show in the terminal. Shake the iPad (or three-finger long-press) for the dev menu.

## Using it

1. **+ New assignment** → title, course, choose the pset PDF (from Files; save Canvas PDFs to Files first). For textbook chapters, fill in "Only these problems." Set the course AI policy and the maximum help level it allows.
2. Write. The Apple tool palette gives you pen, eraser and lasso. Use **＋** for more pages.
3. **Check** → marks appear in the margin and the Tutor panel opens with the guiding question, part status, and fixed/open lists.
4. Tap a mark → see how it read the line and why it was flagged → **Ask about this** to discuss it in Chat.
5. Fix, then **Check** again. Marks fade when the page has changed since the last check.
6. **Log** tab → copy the disclosure summary for your submission.

Help levels: 0 Verify · 1 Socratic (default) · 2 Concept nudge · 3 Analogous example · 4 Walkthrough. Levels above the policy cap are locked.

## Code map

```
App.tsx                         simple state router
modules/pencil-canvas/          local Expo native module
  ios/PencilCanvasView.swift      PKCanvasView wrapper: strokes, save/load, labeled page export
  ios/PencilCanvasModule.swift    JS bridge (props, events, async functions)
  src/PencilCanvasView.tsx        typed React component + ref handle
src/ink/lines.ts                stroke boxes → lines L1..Ln (pure; unit-tested)
src/ai/types.ts                 TutorProvider interface (swap models/providers here)
src/ai/prompts.ts               tutor rules (ported from your Socratic skill) + help levels
src/ai/claude.ts                Claude implementation: parse PDF, check page, chat
src/store/                      on-device JSON store + PencilKit page files
src/screens/                    Home, New assignment, Workspace, Settings
src/components/                 margin marks, tutor side panel, help-level picker
```

How a check works: PencilKit strokes → `groupLines()` → native export of the page as a PNG with a gutter of line labels and faint boxes → Claude with forced tool output `report_check` (verdict per line, part status, feedback, one question, fixed/open) → marks positioned from the line boxes.

## Commands

```powershell
npm run typecheck           # tsc --noEmit
npm test                    # line-grouping unit tests (Node 22+)
```

## Known limitations (v0)

- Portrait only, one fixed-size page per screen (no zoom or scroll). This keeps coordinates simple.
- The whole page is sent on each check; checking only the lines that changed comes later.
- Line grouping is heuristic. Very cramped or diagonal writing may group oddly. The model can still read the page; marks may just sit next to the wrong line.
- If the Swift module fails to compile on EAS, the build log shows the exact line. Paste it to me.

## Next steps (v0.2 candidates)

1. **AI ink:** circle / underline / arrow / margin-note commands drawn on the overlay (docs/03-features.md F10).
2. **Backend proxy** (Cloudflare Worker) so testers don't hold an API key.
3. **Pset PDF as the page background** (write directly on the handout).
4. **SymPy verifier** for algebra equivalence, units and plug-back checks.
5. **Eval harness:** save (page image, your corrections) pairs from real use to measure false-✓ rate.
