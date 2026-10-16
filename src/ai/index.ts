import { ENV } from '../config';
import { ClaudeProvider, type ClaudeOptions } from './claude';
import { applyAlgebraGuard, applyLeakGuard, applyReadingGuard, applyReplyLeakGuard } from '../verify/guard';
import { overLevel } from '../tutor/revealed';
import { finishedSentences } from './stream';
import type { CheckResult, HelpLevel, TutorProvider } from './types';

export type ProviderSettings = {
  provider: 'anthropic';
  apiKey?: string;
  checkModel?: string;
  parseModel?: string;
  onUsage?: ClaudeOptions['onUsage'];
  /** expo/fetch in the app: lets chat replies stream (src/ai/stream.ts) */
  streamFetch?: ClaudeOptions['streamFetch'];
};

/** Single place to swap providers. Add Gemini/OpenAI implementations of TutorProvider here. */
export function getProvider(settings?: Partial<ProviderSettings>): TutorProvider {
  const inner = new ClaudeProvider({
    apiKey: settings?.apiKey || ENV.anthropicApiKey,
    checkModel: settings?.checkModel || ENV.checkModel,
    parseModel: settings?.parseModel || ENV.parseModel,
    onUsage: settings?.onUsage,
    streamFetch: settings?.streamFetch,
  });
  return guarded(inner);
}

/** Deterministic guards run on every provider's output: they may lower a verdict, never raise one. */
export function guarded(inner: TutorProvider): TutorProvider {
  return {
    id: inner.id,
    parseAssignment: (i) => inner.parseAssignment(i),
    reply: async (i) => {
      // Streaming: release only finished sentences, and only after the same leak guard as the final reply. A sentence
      // the guard would change is held back (the final, fully guarded reply replaces the stream when it lands).
      const onPartial = i.onPartial
        ? (raw: string) => {
            const done = finishedSentences(raw);
            if (!done) return;
            try {
              const guardedText = applyReplyLeakGuard(done, i.lines ?? [], i.helpLevel);
              if (guardedText === done) i.onPartial!(done);
            } catch {
              // a guard error never shows unguarded text
            }
          }
        : undefined;
      const r = await inner.reply({ ...i, onPartial });
      try {
        const text = applyReplyLeakGuard(r.text, i.lines ?? [], i.helpLevel);
        // A caption on the page is a tutor sentence like any other: drop a note the leak guard would change.
        const marks = r.marks.map((m) => (m.note && applyReplyLeakGuard(m.note, i.lines ?? [], i.helpLevel) !== m.note ? { kind: m.kind === 'note' ? '' : m.kind, line: m.line } : m)).filter((m) => m.kind !== '');
        return { text, marks };
      } catch (e) {
        console.warn('reply leak guard failed', e);
        return { text: r.text, marks: r.marks.filter((m) => !m.note) };
      }
    },
    check: async (i) => {
      const r = await inner.check(i);
      // A guard bug must never lose a check the student already paid for: fall back to the model's own result.
      try {
        const confirmed = new Set((i.confirmed ?? []).map((c) => c.id));
        return withRevealCheck(applyLeakGuard({ ...r, lines: applyAlgebraGuard(applyReadingGuard(r.lines, confirmed)) }, i.helpLevel), i.helpLevel);
      } catch (e) {
        console.warn('verification guards failed; returning the unguarded check', e);
        return r;
      }
    },
  };
}

/** Record reveal kinds the model reported beyond the help level (logged and disclosed, not hidden). */
export function withRevealCheck(r: CheckResult, level: HelpLevel): CheckResult {
  const over = overLevel(r.revealed, level);
  return over.length ? { ...r, overLevel: over } : r;
}

export * from './types';
export { HELP_LEVELS } from './prompts';
