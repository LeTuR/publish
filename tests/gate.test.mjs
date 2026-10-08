// The gate declaration is a contract: repositories write it, the skill reads
// it. These tests hold the documented examples to the documented keys, so a key
// that is renamed in prose and not in the examples fails here rather than in
// somebody's publish.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { ROOT, SKILL_DIR, SKILL_MD, STEP_KEYS, fencedBlocks, parseDeclaration, read, validateDeclaration } from "./helpers.mjs";

const GATE_MD = path.join(SKILL_DIR, "references", "gate.md");
const reference = read(GATE_MD);

const TOP_LEVEL = ["version", "forge", "base", "review", "gate", "ci", "feedback"];


/** Every `.publish.yaml` the reference shows, parsed. */
const examples = fencedBlocks(reference, "yaml").map((y) => ({
  yaml: y,
  doc: parseDeclaration(y),
}));

test("the reference documents the file, and it is .publish.yaml at the root", () => {
  assert.match(reference, /`\.publish\.yaml`, at the repository root/);
  assert.ok(examples.length >= 4, `only ${examples.length} worked declarations`);
});

test("every documented key is in the table, and every table key is documented", () => {
  const table = new Set();
  for (const m of reference.matchAll(/^\| `([\w.[\]]+)` \|/gm)) table.add(m[1]);
  const documented = ["version", "forge", "base", "gate", "review.rules", "gate[].name", "gate[].run", "gate[].fix", "gate[].instructions", "ci.required", "ci.timeout", "feedback.wait"];
  for (const key of documented) {
    assert.ok(table.has(key), `the key table does not describe ${key}`);
  }
  for (const key of table) {
    const top = key.split(/[.[]/)[0];
    assert.ok(TOP_LEVEL.includes(top), `the table describes ${key}, which is under no documented top-level key`);
  }
});

test("every worked declaration uses only documented keys", () => {
  for (const { doc, yaml } of examples) {
    for (const key of Object.keys(doc)) {
      assert.ok(TOP_LEVEL.includes(key), `${key} is not a documented top-level key:\n${yaml}`);
    }
    assert.deepEqual(validateDeclaration(doc), [], `a worked declaration is broken:\n${yaml}`);
    assert.equal(doc.version, 1, `every example must declare version 1:\n${yaml}`);
    assert.ok(Array.isArray(doc.gate), `gate must be a list:\n${yaml}`);
    for (const step of doc.gate) {
      for (const key of Object.keys(step)) {
        assert.ok(STEP_KEYS.includes(key), `${key} is not a documented step key:\n${yaml}`);
      }
      assert.ok(step.name, `a step with no name:\n${yaml}`);
      assert.ok(step.run, `a step with no run:\n${yaml}`);
    }
  }
});

test("the worked declarations are three different gates, not three spellings of one", () => {
  const shapes = examples
    .map(({ doc }) => doc.gate.map((s) => (Array.isArray(s.run) ? s.run.join("; ") : s.run)).join(" | "))
    .filter((s) => s.length > 0);
  assert.ok(new Set(shapes).size >= 3, "the point is that repositories declare different gates");
});

test("a step's run is one command or an ordered list of them", () => {
  const runs = examples.flatMap(({ doc }) => doc.gate.map((s) => s.run));
  assert.ok(runs.some((r) => typeof r === "string"), "no example shows the single-command form");
  assert.ok(runs.some((r) => Array.isArray(r)), "no example shows the list form");
});

test("an empty gate is declared, and an absent gate is not the same thing", () => {
  assert.deepEqual(parseDeclaration("version: 1\ngate: []\n").gate, []);
  assert.match(
    reference,
    /`gate: \[\]` - an empty list - is a repository stating it has no mechanical gate/,
  );
  assert.match(
    reference,
    /Leaving `gate` out entirely is\s+not the same thing/,
    "the reference must separate declaring none from declaring nothing",
  );
});

test("an undeclared repository falls back in a stated order and never silently", () => {
  const section = reference.slice(reference.indexOf("## When there is no declaration"));
  assert.ok(section.length > 400, "there is no fallback section");
  for (const source of ["AGENTS.md", "CONTRIBUTING.md", "justfile", "package.json"]) {
    assert.ok(section.includes(source), `the fallback order does not mention ${source}`);
  }
  assert.match(section, /name the gate source in the final report/, "an inferred gate must be labelled as one");
  assert.match(section, /discovered:/, "the reference must show what an inferred gate_source looks like");
  assert.match(
    section,
    /the gate is `skipped`, not absent/,
    "finding no gate must block, not pass",
  );
  assert.match(
    section,
    /Do\s+not write that file for them/,
    "a skill that writes the gate it then certifies against has certified nothing",
  );
});

test("the reference refuses to make the repository depend on a YAML parser", () => {
  assert.match(reference, /Do not add a YAML parser to the repository being\s+published/);
});

test("a broken declaration is reported, not guessed at", () => {
  assert.match(reference, /An entry missing either is a\s+broken declaration/);
  assert.match(reference, /do\s+not guess what was meant/);
});

test("this repository declares its own gate, and it parses", () => {
  const own = parseDeclaration(read(path.join(ROOT, ".publish.yaml")));
  assert.equal(own.version, 1);
  assert.ok(Array.isArray(own.gate) && own.gate.length > 0, "a repository shipping a gate should have one");
  for (const step of own.gate) {
    assert.ok(step.name && step.run, "this repository's own declaration is malformed");
    for (const key of Object.keys(step)) assert.ok(STEP_KEYS.includes(key), `${key} is not a step key`);
  }
  assert.deepEqual(validateDeclaration(own), [], "this repository's own declaration is broken");
  assert.equal(own.ci.required, true);
});

test("the parser rejects what it cannot read rather than guessing", () => {
  assert.throws(() => parseDeclaration("version: 1\n\tgate: []\n"), /tab indentation/);
  assert.throws(() => parseDeclaration("- one\nnot a list item\n"), /not a key|expected a list item/);
});

const step = (extra) => `version: 1\ngate:\n  - name: test\n    run: npm test\n${extra}`;

test("a step's instructions, when present, are text handed over as written", () => {
  const doc = parseDeclaration(step('    instructions: "Run it twice before calling the socket test red."\n'));
  assert.deepEqual(validateDeclaration(doc), []);
  assert.equal(doc.gate[0].instructions, "Run it twice before calling the socket test red.");
  assert.ok(
    examples.some(({ doc }) => doc.gate.some((s) => typeof s.instructions === "string")),
    "no worked declaration shows instructions",
  );
});

test("a step with no instructions is exactly what it was before", () => {
  const doc = parseDeclaration(step(""));
  assert.deepEqual(validateDeclaration(doc), []);
  assert.deepEqual(Object.keys(doc.gate[0]), ["name", "run"]);
});

test("instructions that are not text make the declaration broken", () => {
  const wrong = {
    number: "    instructions: 42\n",
    boolean: "    instructions: true\n",
    "empty list": "    instructions: []\n",
    list: "    instructions:\n      - one\n      - two\n",
    map: "    instructions:\n      when: red\n",
    nothing: "    instructions:\n",
  };
  for (const [kind, extra] of Object.entries(wrong)) {
    const problems = validateDeclaration(parseDeclaration(step(extra)));
    assert.ok(problems.some((p) => p.includes("instructions")), `instructions as ${kind} was accepted`);
  }
});

test("the reference and the skill say what instructions are for", () => {
  assert.match(reference, /\| `gate\[\]\.instructions` \| no \|/);
  assert.match(reference, /`instructions`, when it is there, is text/, "the reference must reject non-text instructions");
  const gate = /## Phase 4 - gate\n([\s\S]*?)\n## /.exec(read(SKILL_MD));
  assert.ok(gate, "there is no gate phase");
  assert.match(gate[1], /`instructions`/, "the gate phase never hands a step's instructions over");
  assert.match(gate[1], /read its failure|fix/, "instructions must reach whoever fixes the step, not only who runs it");
});
