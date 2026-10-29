# Penquire app

Updated October 29, 2026. Existing Expo/PencilKit prototype, being pivoted toward recovery and independent practice.

Promise: **Get help with what stopped you, then find out whether you can handle the next problem on your own.**

## Immediate task

Working founder-operated iPad demo ready November 2, before November 3, Pacific time. Read [demo spec](../docs/12-demo-spec.md), [roadmap](../docs/05-roadmap.md), [backlog](BACKLOG.md), and [implementation guide](CLAUDE.md).

This documentation rewrite does not implement the new learning loop.

## Present in source

- PencilKit handwriting, page-space capture, saving and native PDF export.
- Assignment PDF/text parsing and structured parts.
- Explicit checks, margin marks, reading confirmation and disputes.
- Policy levels, obstacle-oriented prompts and per-issue ladder.
- Local JSON database and page files.
- Tutor marks, streamed chat, speech input/output and conversation behavior.
- Opt-in automatic checking: source-present, to be paused in pivot flow.
- Native module source API 6; installed binary must be checked separately.

Not yet: recovery episode records, isolated fresh independent attempt, honest learning evidence labels and scheduled review records. Backend proxy/services are not implemented.

## Existing developer setup

Use the current project configuration; do not rerun initialization or replace project IDs for the pivot.

From this folder, with Node/npm and the existing dependencies:

```powershell
npm ci
npm start
```

The development client must already be installed on the iPad. Connect to the dev server over the configured network. If local networking fails, inspect firewall/network settings; a tunnel is an alternative, not a guaranteed offline delivery route.

Configuration names are in `.env.example` and `src/config.ts`. Create a local `.env` from the example only if absent; never overwrite an existing secret file or commit its values. Configured model IDs need an actual successful call; do not assume source defaults are available.

**Development only:** EXPO_PUBLIC values are bundled into JS; device settings also hold the owner's key. Never distribute a credential-bearing build. The planned demo is founder-operated. External independent use needs secure access and appropriate consent/privacy handling.

## Local verification

```powershell
npm run typecheck
npm test
```

These are actual package scripts. There is no configured lint script. For a release/build change, also use the configured CI bundle/doctor checks as appropriate:

```powershell
npx expo-doctor
npx expo export --platform ios --output-dir dist-check
```

A passing test suite is not on-device acceptance or educational validation. No live model calls are included in ordinary unit tests.

## Native/build boundary

JS-only changes can use the current development client if they require no absent native capability. Changes to `modules/pencil-canvas/ios/` or native dependencies require a new cloud build; avoid them for the demo unless essential.

Existing profiles are in `eas.json`. Do not launch cloud builds without the user's build approval; this documentation rewrite launches none. Preserve feature detection for older binaries. Source version 6 does not prove that version is installed.

## Code orientation

- `App.tsx`: existing state router; retain it.
- `src/screens/WorkspaceScreen.tsx`: capture, checking, help, saves, voice.
- `src/ai/`: provider, prompts, parsing, sanitation and streaming.
- `src/check/`, `src/verify/`, `src/tutor/`: checking, guards, issue/help state and marks.
- `src/store/`: JSON persistence, sources, eval exports and progress.
- `modules/pencil-canvas/`: native bridge.
- Planned learning-layer additions are specified in [architecture](../docs/04-architecture.md); they are not existing files.

## Evidence and privacy

Use original demo problems. Real psets, images and private evaluation artifacts stay in `../evals-private/`, outside this app Git checkout. Do not publish them or secrets.

Old setup instructions and implementation history are in [the archive](../archive/2026-10-29-before-pivot/app/README.md.txt).
