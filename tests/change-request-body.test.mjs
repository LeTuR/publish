// The published body template and skill must agree on a clean, human-facing shape.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { SKILL_DIR, SKILL_MD, read } from "./helpers.mjs";

const BODY = read(path.join(SKILL_DIR, "templates", "change-request-body.md"));
const HEADINGS = ["## Intent", "## What Changed", "## Risk Assessment", "## Testing"];
const withoutComments = (text) => text.replace(/<!--[\s\S]*?-->/g, "");

test("the body has exactly four headings, in order", () => {
  const headings = [...withoutComments(BODY).matchAll(/^#{1,6} .+$/gm)].map((m) => m[0]);
  assert.deepEqual(headings, HEADINGS);
});

test("the skill and body both use the clean shape", () => {
  const phase = /## Phase 8 - change request\n([\s\S]*?)\n## /.exec(read(SKILL_MD));
  assert.ok(phase);
  for (const heading of HEADINGS) assert.ok(phase[1].includes(`\`${heading}\``));
  assert.doesNotMatch(BODY + phase[1], /publish-attestation|head_sha|## Attestation|templates\/attestation\.md/);
});

test("the Testing section names the documentation step", () => {
  const testing = /\n## Testing\n([\s\S]*)/.exec(BODY);
  assert.ok(testing);
  assert.match(testing[1], /documentation step/);
});

test("every claim is backed by something run in this session, or labelled", () => {
  const skill = read(SKILL_MD);
  const found = /\n## Claim only what was verified here\n([\s\S]*?)\n## /.exec(skill);
  assert.ok(found, "the skill has no rule on what may be claimed");
  const rule = found[1].replace(/\s+/g, " ");
  assert.match(rule, /run locally in this session/);
  assert.match(rule, /labelled as not verified/);
  assert.match(rule, /never stated as fact/);
  for (const where of ["change request body", "reply", "comment"]) {
    assert.ok(rule.includes(where), `the rule does not cover a ${where}`);
  }
});

test("the Testing section asks for evidence and names what was not verified", () => {
  const testing = /\n## Testing\n([\s\S]*)/.exec(BODY)[1].replace(/\s+/g, " ");
  assert.match(testing, /run in this session/, "Testing must say what ran here, not what should work");
  assert.match(testing, /not verified/, "Testing must label what was not verified");
});
