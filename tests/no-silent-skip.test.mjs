// Two silent skips are possible here and both are fatal to the point of the
// repository: a test in this suite that quietly does not run, and a phase in
// the skill that quietly does not run. This file closes both.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SKILL_DIR, SKILL_MD, STATUSES, TESTS_DIR, read, shippedFiles } from "./helpers.mjs";

const testFiles = fs
  .readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort();

// A test runner is happy to report a skipped test as a passing run. Every way
// this suite could ask it to, listed so that adding one is a deliberate act.
const OPT_OUTS = [
  [/\btest\.skip\b|\bit\.skip\b|\bdescribe\.skip\b/, "test.skip"],
  [/\btest\.todo\b|\bit\.todo\b/, "test.todo"],
  [/\bt\.skip\s*\(/, "t.skip()"],
  [/\{[^}\n]*\bskip:\s*(?!false\b)/, "{ skip: ... }"],
  [/\{[^}\n]*\btodo:\s*(?!false\b)/, "{ todo: ... }"],
  [/\btest\.only\b|\bit\.only\b|\{[^}\n]*\bonly:\s*(?!false\b)/, "only, which silences the rest"],
];

test("no test in this suite opts out of running", () => {
  const offences = [];
  for (const file of testFiles) {
    // The list above is quoted inside this file, so this file is checked by the
    // next test instead of by a scan that would match its own table.
    if (file === "no-silent-skip.test.mjs") continue;
    const source = read(path.join(TESTS_DIR, file));
    for (const [pattern, name] of OPT_OUTS) {
      if (pattern.test(source)) offences.push(`${file}: ${name}`);
    }
  }
  assert.deepEqual(offences, [], "a test that does not run is a test that proves nothing");
});

test("this file does not opt itself out either", () => {
  const source = read(path.join(TESTS_DIR, "no-silent-skip.test.mjs"));
  const executable = source
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .filter((l) => !/^\s*\[\/.*\/,\s*"/.test(l)) // the OPT_OUTS table itself
    .join("\n");
  for (const [pattern, name] of OPT_OUTS) {
    assert.doesNotMatch(executable, pattern, `no-silent-skip.test.mjs uses ${name}`);
  }
});

test("the suite is not vacuous", () => {
  assert.ok(testFiles.length >= 4, `only ${testFiles.length} test files`);
  let total = 0;
  for (const file of testFiles) {
    const source = read(path.join(TESTS_DIR, file));
    const tests = (source.match(/^test\(/gm) ?? []).length;
    const asserts = (source.match(/\bassert[.(]/g) ?? []).length;
    assert.ok(tests > 0, `${file} declares no tests`);
    assert.ok(asserts >= tests, `${file} has ${tests} tests and only ${asserts} assertions`);
    total += tests;
  }
  assert.ok(total >= 25, `the suite is only ${total} tests; that is not a gate`);
});

const skill = read(SKILL_MD);

test("the skill declares a closed set of statuses and no way out of it", () => {
  for (const status of STATUSES) {
    assert.ok(skill.includes(`\`${status}\``), `the skill never mentions ${status}`);
  }
  assert.match(
    skill,
    /There is no fifth status and no way to leave a phase\s+unreported/,
    "the skill must close the status set explicitly",
  );
});

test("a skipped step cannot be reported as success", () => {
  assert.match(
    skill,
    /\*\*A `skipped` step and a `failed` step both block\.\*\*/,
    "the skill must say plainly that a skip blocks",
  );
  assert.match(
    skill,
    /verdict is `passed`\s+only when every step is `passed` or `not-applicable`/,
    "the skill must state the verdict rule where the statuses are defined",
  );
  assert.match(
    skill,
    /A step\s+you could not run is never reported as one that passed/,
    "the skill must forbid the substitution outright",
  );
});

test("a red pipeline cannot be reported as success", () => {
  const ci = /## Phase 9 - CI\n([\s\S]*?)\n## /.exec(skill);
  assert.ok(ci, "there is no CI phase");
  assert.match(
    ci[1],
    /\*\*a red pipeline is not done, and a\s+pipeline still running is not done either\.\*\*/,
    "the CI phase must rule out both red and still-running",
  );
  assert.match(
    ci[1],
    /Watch the pipeline with operation 4 from your adapter/,
    "the CI phase must wait for the pipeline rather than sample it",
  );
  assert.match(
    ci[1],
    /Still running past `ci\.timeout`\.\*\* `skipped`/,
    "a pipeline that never finishes must land on a status that blocks",
  );
  assert.match(
    ci[1],
    /`ci\.required: false`/,
    "the only way a missing pipeline is acceptable must be an explicit declaration",
  );
});

test("a repository with no pipeline is not quietly green", () => {
  assert.match(
    skill,
    /a repository with no checks is\s+`skipped`/,
    "absent CI must be a skip, which blocks, not an absence that passes",
  );
});

test("no declared gate step may be dropped", () => {
  const gate = /## Phase 4 - gate\n([\s\S]*?)\n## /.exec(skill);
  assert.ok(gate, "there is no gate phase");
  assert.match(
    gate[1],
    /do not drop a step\s+because it looks redundant/,
    "the gate phase must forbid dropping a declared step",
  );
  assert.match(
    gate[1],
    /Never edit the declaration to make a step pass/,
    "the gate phase must forbid the other way of making a step disappear",
  );
});

test("the reporting section makes a blocked verdict audible", () => {
  const reporting = skill.slice(skill.indexOf("## Reporting"));
  assert.ok(reporting.length > 200, "there is no reporting section");
  assert.match(reporting, /\*\*say it is not done\*\*/);
  assert.match(reporting, /name every step\s+that is `failed` or `skipped`/);
  assert.match(
    reporting,
    /The change\s+request may well be open; that is not the same claim as published/,
    "an open pull request must not be allowed to stand in for a green one",
  );
});

test("no shipped file invents a status outside the four", () => {
  const invented = [];
  for (const rel of shippedFiles()) {
    if (!rel.endsWith(".md")) continue;
    const text = read(path.join(SKILL_DIR, rel));
    for (const m of text.matchAll(/"status":\s*"([a-z-]+)"/g)) {
      if (!STATUSES.includes(m[1])) invented.push(`${rel}: ${m[1]}`);
    }
  }
  assert.deepEqual(invented, [], "a fifth status is a way to report something that did not run");
});
