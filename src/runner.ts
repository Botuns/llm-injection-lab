import { buildPrompt } from './app.ts';
import { newContext } from './context.ts';
import { applyOutputDefenses } from './defenses.ts';
import { runChecks } from './detectors.ts';
import type { DefenseConfig, Outcome, RunResult, Scenario, Target, TrialResult } from './types.ts';

export interface RunOptions {
  target: Target;
  scenarios: Scenario[];
  defenses: DefenseConfig;
  defenseLabel: string;
  repeats: number;
  /** Pause between requests, to stay under free-tier rate limits. */
  delayMs?: number;
  onTrial?: (result: TrialResult, done: number, total: number) => void;
}

export async function runOneTrial(
  target: Target,
  scenario: Scenario,
  defenses: DefenseConfig,
  trial: number,
): Promise<TrialResult> {
  const ctx = newContext();
  const { system, messages } = buildPrompt(scenario, ctx, defenses);

  let rawOutput = '';
  try {
    rawOutput = await target.complete(system, messages);
  } catch (err) {
    return {
      scenarioId: scenario.id,
      trial,
      outcome: 'error',
      rawFindings: [],
      finalFindings: [],
      rawOutput: '',
      finalOutput: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const finalOutput = applyOutputDefenses(rawOutput, ctx, defenses);
  const rawFindings = runChecks(scenario.checks, rawOutput, ctx);
  const finalFindings = runChecks(scenario.checks, finalOutput, ctx);

  const outcome: Outcome = finalFindings.length > 0 ? 'succeeded' : rawFindings.length > 0 ? 'blocked' : 'resisted';
  return { scenarioId: scenario.id, trial, outcome, rawFindings, finalFindings, rawOutput, finalOutput };
}

export async function runSuite(opts: RunOptions): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const trials: TrialResult[] = [];
  const total = opts.scenarios.length * opts.repeats;

  for (const scenario of opts.scenarios) {
    for (let t = 1; t <= opts.repeats; t++) {
      const result = await runOneTrial(opts.target, scenario, opts.defenses, t);
      trials.push(result);
      opts.onTrial?.(result, trials.length, total);
      if (opts.delayMs && trials.length < total) await new Promise((r) => setTimeout(r, opts.delayMs));
    }
  }

  return {
    target: opts.target.name,
    model: opts.target.model,
    defenses: opts.defenses,
    defenseLabel: opts.defenseLabel,
    repeats: opts.repeats,
    startedAt,
    finishedAt: new Date().toISOString(),
    scenarios: opts.scenarios,
    trials,
  };
}
