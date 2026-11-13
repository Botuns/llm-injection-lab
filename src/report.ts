import type { Category, RunResult, Scenario, TrialResult } from './types.ts';

export interface Tally {
  succeeded: number;
  blocked: number;
  resisted: number;
  errors: number;
  /** Trials that produced an answer (errors excluded). */
  valid: number;
  /** Attack success rate: succeeded / valid. Null when every trial errored. */
  asr: number | null;
}

export function tally(trials: TrialResult[]): Tally {
  const count = (o: TrialResult['outcome']) => trials.filter((t) => t.outcome === o).length;
  const succeeded = count('succeeded');
  const errors = count('error');
  const valid = trials.length - errors;
  return {
    succeeded,
    blocked: count('blocked'),
    resisted: count('resisted'),
    errors,
    valid,
    asr: valid > 0 ? succeeded / valid : null,
  };
}

export const pct = (n: number | null) => (n === null ? 'n/a' : `${Math.round(n * 100)}%`);

/** 95% Wilson score interval for k successes out of n. Small samples swing a lot; this shows how much. */
export function wilson(k: number, n: number, z = 1.96): [number, number] | null {
  if (n === 0) return null;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function byScenario(run: RunResult): Array<{ scenario: Scenario; tally: Tally }> {
  return run.scenarios.map((scenario) => ({
    scenario,
    tally: tally(run.trials.filter((t) => t.scenarioId === scenario.id)),
  }));
}

export function byCategory(run: RunResult): Array<{ category: Category; tally: Tally }> {
  const categories = [...new Set(run.scenarios.map((s) => s.category))];
  return categories.map((category) => {
    const ids = new Set(run.scenarios.filter((s) => s.category === category).map((s) => s.id));
    return { category, tally: tally(run.trials.filter((t) => ids.has(t.scenarioId))) };
  });
}

const MOCK_NOTE =
  '> **Mock target.** This run used the deliberately naive mock model, which obeys every injection it can pattern-match. ' +
  'It exists to exercise the harness and the output-side defenses. These numbers say nothing about any real model.';

function excerpt(text: string, max = 700): string {
  const clean = text.replace(/```/g, "'''").trim();
  return clean.length > max ? `${clean.slice(0, max)}\n... [${clean.length - max} more characters in the JSON report]` : clean;
}

function headline(t: Tally): string {
  const blocked = t.blocked > 0 ? ` Output-side defenses caught ${t.blocked} more that got past the model.` : '';
  const errors = t.errors > 0 ? ` ${t.errors} trial(s) errored and are excluded.` : '';
  const ci = wilson(t.succeeded, t.valid);
  const interval = ci ? `, 95% CI ${pct(ci[0])}-${pct(ci[1])}` : '';
  return `Attacks succeeded in **${t.succeeded} of ${t.valid}** trials (**${pct(t.asr)}** attack success rate${interval}).${blocked}${errors}`;
}

export function renderRunMarkdown(run: RunResult): string {
  const lines: string[] = [];
  const overall = tally(run.trials);

  lines.push(`# Prompt injection run: ${run.model}`, '');
  lines.push('| | |', '|---|---|');
  lines.push(`| Target | ${run.target} |`);
  lines.push(`| Model | \`${run.model}\` |`);
  lines.push(`| Defenses | ${run.defenseLabel} |`);
  lines.push(`| Trials per scenario | ${run.repeats} |`);
  lines.push(`| Started | ${run.startedAt} |`);
  lines.push(`| Finished | ${run.finishedAt} |`, '');
  if (run.target === 'mock') lines.push(MOCK_NOTE, '');

  lines.push('## Summary', '', headline(overall), '');

  lines.push('## By scenario', '');
  lines.push('| Scenario | Vector | Category | OWASP | Succeeded | Blocked | Resisted | Errors | ASR |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const { scenario: s, tally: t } of byScenario(run)) {
    lines.push(
      `| \`${s.id}\` | ${s.vector} | ${s.category} | ${s.owasp.join(', ')} | ${t.succeeded} | ${t.blocked} | ${t.resisted} | ${t.errors} | ${pct(t.asr)} |`,
    );
  }
  lines.push('');

  lines.push('## By category', '');
  lines.push('| Category | Succeeded | Valid trials | ASR |', '|---|---|---|---|');
  for (const { category, tally: t } of byCategory(run)) {
    lines.push(`| ${category} | ${t.succeeded} | ${t.valid} | ${pct(t.asr)} |`);
  }
  lines.push('');

  const evidence = run.scenarios
    .map((s) => ({ s, trial: run.trials.find((t) => t.scenarioId === s.id && (t.outcome === 'succeeded' || t.outcome === 'blocked')) }))
    .filter((e): e is { s: Scenario; trial: TrialResult } => e.trial !== undefined);

  if (evidence.length > 0) {
    lines.push('## Evidence', '', 'First successful or blocked trial per scenario. Full outputs are in the JSON report.', '');
    for (const { s, trial } of evidence) {
      const findings = trial.outcome === 'succeeded' ? trial.finalFindings : trial.rawFindings;
      lines.push(`### ${s.title} (\`${s.id}\`, trial ${trial.trial}: ${trial.outcome})`, '');
      for (const f of findings) lines.push(`- **${f.check}**: ${f.evidence}`);
      lines.push(
        '',
        trial.outcome === 'succeeded' ? 'Output as the user would see it:' : 'Model output before the output-side defenses caught it:',
        '',
        '```text',
        excerpt(trial.outcome === 'succeeded' ? trial.finalOutput : trial.rawOutput),
        '```',
        '',
      );
    }
  }

  const errored = run.trials.filter((t) => t.outcome === 'error');
  if (errored.length > 0) {
    lines.push('## Errors', '');
    for (const t of errored) lines.push(`- \`${t.scenarioId}\` trial ${t.trial}: ${t.error}`);
    lines.push('');
  }

  return lines.join('\n');
}

export function renderComparisonMarkdown(baseline: RunResult, defended: RunResult): string {
  const lines: string[] = [];
  const base = new Map(byScenario(baseline).map((r) => [r.scenario.id, r.tally]));
  const def = new Map(byScenario(defended).map((r) => [r.scenario.id, r.tally]));
  const b = tally(baseline.trials);
  const d = tally(defended.trials);

  lines.push(`# Defense comparison: ${baseline.model}`, '');
  lines.push(`Target \`${baseline.target}\`, ${baseline.repeats} trial(s) per scenario. Baseline has no defenses; the defended run uses **${defended.defenseLabel}**.`, '');
  if (baseline.target === 'mock') lines.push(MOCK_NOTE, '');

  lines.push(`- Baseline: ${headline(b)}`);
  lines.push(`- Defended: ${headline(d)}`, '');

  lines.push(`| Scenario | Baseline ASR | Defended ASR | Blocked by output defenses |`, '|---|---|---|---|');
  for (const s of baseline.scenarios) {
    const bt = base.get(s.id);
    const dt = def.get(s.id);
    lines.push(`| \`${s.id}\` | ${pct(bt?.asr ?? null)} | ${pct(dt?.asr ?? null)} | ${dt?.blocked ?? 0} |`);
  }
  lines.push(`| **Overall** | **${pct(b.asr)}** | **${pct(d.asr)}** | **${d.blocked}** |`, '');
  lines.push('Per-run details, evidence and raw outputs are in the two run reports saved alongside this file.', '');
  return lines.join('\n');
}

export function renderConsoleSummary(run: RunResult): string {
  const rows = byScenario(run).map(({ scenario, tally: t }) => {
    const bar = `${t.succeeded}/${t.valid}`.padStart(5);
    return `  ${scenario.id.padEnd(32)} ${bar}  ${pct(t.asr).padStart(4)}${t.blocked ? `  (${t.blocked} blocked)` : ''}`;
  });
  const o = tally(run.trials);
  return [
    `\n${run.model} | defenses: ${run.defenseLabel}`,
    ...rows,
    `  ${'OVERALL'.padEnd(32)} ${`${o.succeeded}/${o.valid}`.padStart(5)}  ${pct(o.asr).padStart(4)}${o.blocked ? `  (${o.blocked} blocked)` : ''}`,
  ].join('\n');
}
