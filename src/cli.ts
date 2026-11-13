import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseDefenses } from './defenses.ts';
import { renderComparisonMarkdown, renderConsoleSummary, renderRunMarkdown } from './report.ts';
import { runSuite } from './runner.ts';
import { findScenarios, scenarios } from './scenarios.ts';
import { AnthropicTarget } from './targets/anthropic.ts';
import { MockTarget } from './targets/mock.ts';
import { OpenAICompatibleTarget } from './targets/openai.ts';
import type { RunResult, Target } from './types.ts';

const HELP = `llm-injection-lab: test an LLM app against prompt injection

Usage
  npm run attack  -- [options]
  npm run compare -- [options]     baseline (no defenses) vs --defense (default: all)
  npm run scenarios                list scenarios

Options
  -t, --target <name>      mock | openai | anthropic            (default: mock)
  -m, --model <id>         model id, required for openai and anthropic
      --base-url <url>     OpenAI-compatible endpoint (default: $OPENAI_BASE_URL or https://api.openai.com/v1)
  -d, --defense <spec>     none | prompt | output | all, or a comma list of
                           delimit,datamark,sandwich,outputFilter,toolGuard  (default: none)
  -r, --repeat <n>         trials per scenario, 1-50                 (default: 1)
      --only <filter>      comma list of scenario ids, categories or vectors (direct, indirect)
      --temperature <t>    sampling temperature (default: provider default)
      --delay <ms>         pause between requests, for free-tier rate limits (default: 0)
      --out <dir>          where reports go                          (default: reports)
      --no-save            print the summary only
      --compare            run baseline and defended, write a comparison
      --list               list scenarios and exit
  -h, --help               show this help

Keys are read from the environment or a .env file:
  OPENAI_API_KEY (or LLM_API_KEY), OPENAI_BASE_URL, ANTHROPIC_API_KEY
`;

function loadDotEnv(path = '.env'): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!(key in process.env)) process.env[key] = value;
  }
}

function fail(message: string): never {
  console.error(`\nError: ${message}\nRun with --help for usage.`);
  process.exit(1);
}

function makeTarget(name: string, model: string | undefined, baseUrlArg: string | undefined, temperature?: number): Target {
  if (name === 'mock') return new MockTarget();

  if (!model) fail(`--model is required for --target ${name}`);

  if (name === 'openai') {
    const baseUrl = baseUrlArg ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
    const isLocal = /localhost|127\.0\.0\.1/.test(baseUrl);
    const key = process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY ?? (isLocal ? 'local' : undefined);
    if (!key) fail('Set OPENAI_API_KEY (or LLM_API_KEY) in your environment or .env file.');
    return new OpenAICompatibleTarget(model, key, baseUrl, temperature);
  }

  if (name === 'anthropic') {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) fail('Set ANTHROPIC_API_KEY in your environment or .env file.');
    return new AnthropicTarget(model, key, baseUrlArg ?? 'https://api.anthropic.com', temperature);
  }

  fail(`Unknown target "${name}". Use mock, openai or anthropic.`);
}

function listScenarios(): void {
  console.log('\nScenarios\n');
  for (const s of scenarios) {
    console.log(`  ${s.id.padEnd(32)} ${s.vector.padEnd(9)} ${s.category.padEnd(20)} ${s.owasp.join(',')}`);
    console.log(`  ${''.padEnd(32)} ${s.title}\n`);
  }
}

function fileStem(run: RunResult): string {
  const stamp = run.startedAt.replace(/[:.]/g, '-').slice(0, 19);
  const slug = `${run.target}_${run.model}`.replace(/[^a-z0-9.-]+/gi, '_');
  return `${stamp}_${slug}_${run.defenseLabel.replace(/[^a-z0-9+]+/gi, '_')}`;
}

function save(dir: string, run: RunResult): string {
  mkdirSync(dir, { recursive: true });
  const stem = fileStem(run);
  writeFileSync(join(dir, `${stem}.json`), JSON.stringify(run, null, 2));
  writeFileSync(join(dir, `${stem}.md`), renderRunMarkdown(run));
  return join(dir, `${stem}.md`);
}

async function main(): Promise<void> {
  loadDotEnv();

  const { values } = parseArgs({
    options: {
      target: { type: 'string', short: 't', default: 'mock' },
      model: { type: 'string', short: 'm' },
      'base-url': { type: 'string' },
      defense: { type: 'string', short: 'd' },
      repeat: { type: 'string', short: 'r', default: '1' },
      only: { type: 'string' },
      temperature: { type: 'string' },
      delay: { type: 'string', default: '0' },
      out: { type: 'string', default: 'reports' },
      'no-save': { type: 'boolean', default: false },
      compare: { type: 'boolean', default: false },
      list: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) return void console.log(HELP);
  if (values.list) return listScenarios();

  const repeats = Number(values.repeat);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 50) fail('--repeat must be a whole number from 1 to 50');
  const temperature = values.temperature !== undefined ? Number(values.temperature) : undefined;
  if (temperature !== undefined && Number.isNaN(temperature)) fail('--temperature must be a number');
  const delayMs = Number(values.delay);

  let picked;
  try {
    picked = findScenarios(values.only);
  } catch (err) {
    fail((err as Error).message);
  }

  const target = makeTarget(values.target!, values.model, values['base-url'], temperature);
  const defenseSpec = values.defense ?? (values.compare ? 'all' : 'none');
  let defended;
  try {
    defended = parseDefenses(defenseSpec);
  } catch (err) {
    fail((err as Error).message);
  }

  const progress = (label: string) => (r: { scenarioId: string; trial: number; outcome: string }, done: number, total: number) =>
    console.log(`  [${label} ${String(done).padStart(String(total).length)}/${total}] ${r.scenarioId} #${r.trial}: ${r.outcome}`);

  const runOnce = async (config: typeof defended.config, label: string) => {
    console.log(`\nRunning ${picked.length} scenario(s) x ${repeats} against ${target.name}/${target.model}, defenses: ${label}`);
    return runSuite({ target, scenarios: picked, defenses: config, defenseLabel: label, repeats, delayMs, onTrial: progress(label) });
  };

  if (!values.compare) {
    const run = await runOnce(defended.config, defended.label);
    console.log(renderConsoleSummary(run));
    if (!values['no-save']) console.log(`\nReport: ${save(values.out!, run)}`);
    return;
  }

  if (defended.label === 'none') fail('--compare needs a --defense other than none');
  const baseline = await runOnce(parseDefenses('none').config, 'none');
  const withDefenses = await runOnce(defended.config, defended.label);
  console.log(renderConsoleSummary(baseline));
  console.log(renderConsoleSummary(withDefenses));

  if (!values['no-save']) {
    const a = save(values.out!, baseline);
    const b = save(values.out!, withDefenses);
    const cmpPath = join(values.out!, `${fileStem(baseline).replace(/_none$/, '')}_compare_${defended.label}.md`);
    writeFileSync(cmpPath, renderComparisonMarkdown(baseline, withDefenses));
    console.log(`\nComparison: ${cmpPath}\nRun reports: ${a}\n             ${b}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
