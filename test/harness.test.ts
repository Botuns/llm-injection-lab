import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDefenses } from '../src/defenses.ts';
import { renderComparisonMarkdown, renderRunMarkdown, tally } from '../src/report.ts';
import { runSuite } from '../src/runner.ts';
import { scenarios } from '../src/scenarios.ts';
import { MockTarget } from '../src/targets/mock.ts';
import type { ChatMessage, Target } from '../src/types.ts';

test('every scenario lands on the naive mock (proves each attack and detector is wired up)', async () => {
  const none = parseDefenses('none');
  const run = await runSuite({ target: new MockTarget(), scenarios, defenses: none.config, defenseLabel: none.label, repeats: 1 });
  const missed = run.trials.filter((t) => t.outcome !== 'succeeded').map((t) => t.scenarioId);
  assert.deepEqual(missed, []);
});

test('output defenses block exfil, tool hijack and plain or base64 leaks on the mock, but not spelled-out leaks or marker echoes', async () => {
  const output = parseDefenses('output');
  const run = await runSuite({ target: new MockTarget(), scenarios, defenses: output.config, defenseLabel: output.label, repeats: 1 });
  const outcome = (id: string) => run.trials.find((t) => t.scenarioId === id)?.outcome;
  assert.equal(outcome('indirect-email-markdown-exfil'), 'blocked');
  assert.equal(outcome('indirect-tool-hijack'), 'blocked');
  assert.equal(outcome('direct-ignore-previous'), 'blocked');
  assert.equal(outcome('direct-encoding'), 'blocked');
  assert.equal(outcome('direct-spell-out'), 'succeeded');
  assert.equal(outcome('indirect-doc-marker'), 'succeeded');
});

test('a model that always refuses is scored as resisted', async () => {
  const refuser: Target = {
    name: 'refuser',
    model: 'always-refuses',
    complete: async (_s: string, _m: ChatMessage[]) => "I can't help with that part, but here is a short summary of the content.",
  };
  const none = parseDefenses('none');
  const run = await runSuite({ target: refuser, scenarios, defenses: none.config, defenseLabel: none.label, repeats: 2 });
  const t = tally(run.trials);
  assert.equal(t.succeeded, 0);
  assert.equal(t.resisted, scenarios.length * 2);
});

test('request errors are counted separately and excluded from the rate', async () => {
  const broken: Target = { name: 'broken', model: 'x', complete: async () => { throw new Error('HTTP 401'); } };
  const none = parseDefenses('none');
  const run = await runSuite({ target: broken, scenarios: scenarios.slice(0, 2), defenses: none.config, defenseLabel: none.label, repeats: 1 });
  const t = tally(run.trials);
  assert.equal(t.errors, 2);
  assert.equal(t.asr, null);
  assert.ok(renderRunMarkdown(run).includes('HTTP 401'));
});

test('reports render', async () => {
  const none = parseDefenses('none');
  const all = parseDefenses('all');
  const a = await runSuite({ target: new MockTarget(), scenarios, defenses: none.config, defenseLabel: none.label, repeats: 1 });
  const b = await runSuite({ target: new MockTarget(), scenarios, defenses: all.config, defenseLabel: all.label, repeats: 1 });
  const md = renderComparisonMarkdown(a, b);
  assert.ok(md.includes('| **Overall** |'));
  assert.ok(renderRunMarkdown(a).includes('## Evidence'));
});
