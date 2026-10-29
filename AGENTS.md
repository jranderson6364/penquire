# Penquire app instructions

Read the workspace [instructions](../AGENTS.md) and [README](../README.md), then [demo spec](../docs/12-demo-spec.md), [roadmap](../docs/05-roadmap.md), [BACKLOG](BACKLOG.md) and [CLAUDE guide](CLAUDE.md).

## Product priorities

The November 2 demo must show attempt → fitting help → actual repair → isolated fresh independent attempt → honest outcome and future review date. Existing source does not yet implement that full loop.

No ambient correctness feedback in the pivot flow. Do not label pointer-assisted repairs independent. Keep questions, explanations and examples available within unchanged course permissions. No global answer prohibition on permitted study material, but do not disable existing assignment protections.

## Implementation discipline

- Default to JS/TypeScript using the existing state router and local persistence. Do not migrate to Expo Router.
- Check the installed Expo major in package.json and local type definitions before API work. Fetch matching official docs if local evidence is insufficient. Use `npx expo install` for compatible native/Expo packages only when necessary.
- Never hand-create generated ios/ or android/ directories.
- Preserve original ink, page coordinates, feature detection and older assignments.
- Preserve numeric policy meanings; widening them requires an explicit migration, not a label change.
- Independent-mode boundaries must suppress auto-checks, prior help, streamed/late replies and speech, not merely hide the panel.
- Never commit secrets, raw private coursework, student images or evaluation exports.
- Use the current backlog and user task; do not resurrect archived roadmap items.

## Verification

For code changes run `npm run typecheck` and `npm test`, plus relevant behavior/model evaluations and device checks. No lint script is configured; do not invent one.

For documentation-only changes validate links, source/status claims and consistency; code tests can be reported as a baseline, not proof the demo exists.

Native changes require a new cloud build. Before starting one, obtain the user's build approval unless already explicitly authorized. Re-read affected Swift against installed APIs and preserve compatibility fallbacks.

Update acceptance checkboxes only after verification. Mark current implementation, planned work and simulated/rehearsal content distinctly.

User instructions take precedence. Archived documents are historical, not active instructions.
