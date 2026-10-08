// Fixture workflow: execute the shipped jq, render its template, select the
// forge write, then read it back. No live state or forge mutations.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ROOT, SKILL_DIR, SKILL_MD, read, fencedBlocks } from './helpers.mjs';

const ref = () => {
  assert.ok(read(SKILL_MD).includes('references/infra-plan.md'),
    'publish has no infrastructure plan-review workflow');
  return read(path.join(SKILL_DIR, 'references/infra-plan.md'));
};
function jq(filter, input) {
  return JSON.parse(execFileSync('jq', ['-c', filter], {
    input: JSON.stringify(input), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  }));
}
function evidence() {
  return JSON.parse(read(new URL('./fixtures/infra/evidence.json', import.meta.url)));
}
function forgeRoundTrip(body, write, comments, forge) {
  const scratchRoot = path.join(ROOT, 'node_modules', '.cache');
  fs.mkdirSync(scratchRoot, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(scratchRoot, 'infra-'));
  try {
    const statePath = path.join(scratch, 'state.json');
    const bodyPath = path.join(scratch, 'body.md');
    fs.writeFileSync(statePath, JSON.stringify({ comments, requests: [] }));
    fs.writeFileSync(bodyPath, body);
    const forgeRef = read(path.join(SKILL_DIR, 'references/forge.md'));
    const start = forgeRef.indexOf(forge === 'gh' ? '### GitHub' : '### GitLab');
    const block = fencedBlocks(forgeRef.slice(start), 'sh')[0];
    const command = (kind) => block.split('\n').find(l => l.includes(`# 5, ${kind}`))
      .replace(/\s+#.*$/, '').replace('<number>', '7')
      .replace('<comment-id>', '12').replace('<note-id>', '12')
      .replace('<path>', bodyPath).replace(/\{owner\}/g, 'owner').replace(/\{repo\}/g, 'repo');
    // Command tokens in these three adapter forms have no spaces in quoted
    // values. Pass argv directly, preserving the @file field's actual newlines.
    const run = (kind) => {
      const args = command(kind).match(/'[^']*'|[^\s]+/g).map(a => a.replace(/^'|'$/g, ''));
      return JSON.parse(execFileSync(process.execPath, [
        fileURLToPath(new URL('./fixture-forge.mjs', import.meta.url)), ...args,
      ], { encoding: 'utf8', env: { ...process.env, FIXTURE_FORGE_STATE: statePath } }));
    };
    run(write.id === null ? 'create' : 'update');
    const saved = run('read back');
    const after = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return { saved, after: after.comments, requests: after.requests };
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
function workflow(input, comments = [], actor = 'publisher', forge = 'gh') {
  const [summaryFilter, writeFilter] = fencedBlocks(ref(), 'jq');
  const summary = jq(summaryFilter, input);
  const template = read(path.join(SKILL_DIR, 'templates/infra-plan-comment.md'));
  // These are a fixture reviewer's evidence-based conclusions, not a safety
  // verdict inferred from counts. The skill must require a human-style review.
  const values = {
    safety: summary.available && summary.scopes.some(s => s.destructive.length) ? 'Destructive: the plan deletes or replaces services; outage and data-loss safeguards need review.' : summary.available ? 'Safe with care: the reviewed scope imports existing objects and adds a lock; ownership must be checked before apply.' : 'Not assessable: current complete plan evidence is unavailable.',
    counts: summary.available ? summary.scopes.map(s => `${s.scope}: ${s.counts.imports} to import, ${s.counts.additions} to add, ${s.counts.changes} to change, ${s.counts.destructions} to destroy, ${s.counts.replacements} to replace (exclusive of adds/destroys).`).join('\n') : 'Unavailable for one or more scopes; see the evidence gaps.',
    destroyed: summary.scopes.flatMap(s => s.destructive).map(a => `${a.address}: ${a.actions.join(', ')}; review outage and data-loss implications.`).join('\n') || (summary.available ? 'None in the reviewed plan.' : 'Unknown for unreviewed scopes.'),
    drift: 'Observed drift is not attributed to this change without a baseline; unrelated drift was not checked.',
    limits: summary.scopes.filter(s => !s.available).map(s => `${s.scope}: ${s.reason}`).join('; ') || 'Database-side drift was not checked.',
    applied: 'Apply status unverified; the preview performed no apply.',
    evidence: `Reviewed head: [${input.head}](https://github.com/owner/repo/commit/${input.head}). ` + input.plans.map(p => `${p.scope}: plan source ${p.head}; [run](${p.run}); [job](${p.job}); ${p.provenance}`).join('\n'),
  };
  const body = template.replace(/<!--[\s\S]*?-->/g, '').replace(/\{\{(\w+)\}\}/g, (_, k) => {
    assert.ok(k in values, `unfilled field ${k}`); return values[k];
  }).trim();
  const write = jq(writeFilter, { actor, comments, body });
  const { saved: verified, after, requests } = forgeRoundTrip(body, write, comments, forge);
  assert.equal(verified.body, body);
  assert.ok(verified.body.includes(input.head), 'saved review must name the current full head');
  return { summary, body, write, after, requests };
}

test('publish reviews a fixture import/create plan, posts once and updates its own review on rerun', () => {
  for (const forge of ['gh', 'glab']) {
    const input = evidence();
    const other = { id: 3, author: 'maintainer', body: '## Safety\nA separate review.' };
    const first = workflow(input, [other], 'publisher', forge);
    assert.equal(first.summary.available, true);
    assert.deepEqual(first.summary.scopes[0].counts, { imports: 2, additions: 1, changes: 0, destructions: 0, replacements: 0 });
    assert.equal(first.write.id, null);
    input.head = 'c'.repeat(40);
    input.plans[0].head = input.head;
    input.plans[0].plan.resource_changes.push(
      { mode: 'managed', address: 'role.extra', change: { actions: ['update'] } },
    );
    const again = workflow(input, first.after, 'publisher', forge);
    assert.equal(again.write.id, 12);
    assert.notEqual(again.body, first.body);
    assert.ok(again.body.includes(input.head));
    assert.match(again.body, /1 to change/);
    assert.equal(again.after.length, 2);
    assert.deepEqual(first.requests.map(r => r.method), ['POST', 'GET']);
    assert.deepEqual(again.requests.map(r => r.method), [forge === 'gh' ? 'PATCH' : 'PUT', 'GET']);
    assert.deepEqual(again.after[0], other);
    assert.deepEqual([...first.body.matchAll(/^## (.+)$/gm)].map(m => m[1]), [
      'Safety', 'Counts', 'Destroyed or replaced', 'Drift not caused by this change', 'What the plan cannot tell you', 'Not applied',
    ]);
    assert.doesNotMatch(first.body, /SECRET|import-id|raw-password|\{\{/);
    assert.match(first.body, /Apply status unverified/);
  }
});

test('replacement orders count once, deletes and import updates remain distinct', () => {
  const input = evidence();
  input.plans[0].plan.resource_changes.push(
    { mode: 'managed', address: 'service.before', change: { actions: ['delete', 'create'] } },
    { mode: 'managed', address: 'service.after', change: { actions: ['create', 'delete'] } },
    { mode: 'managed', address: 'service.old', change: { actions: ['delete'] } },
    { mode: 'managed', address: 'service.imported', change: { importing: { id: 'import-id' }, actions: ['update'] } },
  );
  const result = workflow(input);
  assert.deepEqual(result.summary.scopes[0].counts, { imports: 3, additions: 1, changes: 1, destructions: 1, replacements: 2 });
  assert.equal(result.summary.scopes[0].destructive.length, 3);
  assert.match(result.body, /service.before/);
  assert.match(result.body, /service.after/);
});

test('missing, stale, failed, partial, unsupported and duplicate scoped evidence cannot look clean', () => {
  for (const mutate of [
    i => { i.expected_scopes.push('infra/database'); },
    i => { i.plans[0].head = 'b'.repeat(40); },
    i => { i.plans[0].status = 'failed'; },
    i => { i.plans[0].complete = false; },
    i => { i.plans[0].plan.complete = false; },
    i => { i.plans[0].plan.resource_changes[0].change.actions = ['forget']; },
    i => { i.plans.push(structuredClone(i.plans[0])); },
    i => { delete i.plans[0].job; },
    i => { i.plans[0].plan.errored = true; },
    i => { i.plans[0].plan.deferred_changes = [{}]; },
    i => { i.plans[0].plan.resource_changes[0].mode = 'unknown'; },
  ]) {
    const input = evidence(); mutate(input);
    const result = workflow(input);
    assert.equal(result.summary.available, false);
    assert.match(result.body, /Not assessable/);
    assert.match(result.body, /Unavailable/);
    assert.ok(result.summary.scopes.some(s => !s.available && s.reason));
  }
});

test('comment ownership selection handles both forge responses and refuses ambiguity', () => {
  const filter = fencedBlocks(ref(), 'jq')[1];
  const body = workflow(evidence()).body;
  for (const author of [{ login: 'publisher' }, { username: 'publisher' }]) {
    assert.deepEqual(jq(filter, { actor: 'publisher', body, comments: [{ id: 15, author, body }] }), { id: 15 });
  }
  assert.throws(() => jq(filter, { actor: 'publisher', body, comments: [
    { id: 15, author: 'publisher', body }, { id: 16, author: 'publisher', body },
  ] }), /multiple plan review comments/);
});


test('multiple expected scopes keep a complete no-op plan visible without inventing counts', () => {
  const input = evidence();
  input.expected_scopes.push('infra/database');
  const noop = structuredClone(input.plans[0]);
  noop.scope = 'infra/database';
  noop.plan = { format_version: '1.2', complete: true, planned_values: { root_module: {} } };
  input.plans.push(noop);
  const result = workflow(input);
  assert.equal(result.summary.available, true);
  assert.deepEqual(result.summary.scopes[1].counts,
    { imports: 0, additions: 0, changes: 0, destructions: 0, replacements: 0 });
  assert.match(result.body, /infra\/database: 0 to import/);
  input.plans.pop();
  const partial = workflow(input);
  assert.equal(partial.summary.available, false);
  assert.equal(partial.summary.scopes[0].available, true);
  assert.equal(partial.summary.scopes[1].counts, null);
});
