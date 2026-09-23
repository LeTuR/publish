// The change request body has one shape. Reviewers learn where to look, and the
// attestation has one fixed place under it, so a heading renamed in the template
// and not in the skill fails here rather than in somebody's pull request.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { SKILL_DIR, SKILL_MD, read } from "./helpers.mjs";

const BODY = read(path.join(SKILL_DIR, "templates", "change-request-body.md"));
const ATTESTATION_TEMPLATE = read(path.join(SKILL_DIR, "templates", "attestation.md"));
const HEADINGS = ["## Intent", "## What Changed", "## Risk Assessment", "## Testing", "## Attestation"];

const withoutComments = (text) => text.replace(/<!--[\s\S]*?-->/g, "");

test("the body has exactly the five headings, in order", () => {
  const headings = [...withoutComments(BODY).matchAll(/^#{1,6} .+$/gm)].map((m) => m[0]);
  assert.deepEqual(headings, HEADINGS, "the body template's headings are not the five, in order");
});

test("the attestation block sits under ## Attestation, and nothing follows it", () => {
  const at = BODY.indexOf("\n## Attestation\n");
  assert.ok(at !== -1, "the body template has no ## Attestation heading");
  assert.match(
    BODY.slice(at),
    /templates\/attestation\.md/,
    "the ## Attestation section must say the block from templates/attestation.md goes there",
  );
  assert.doesNotMatch(
    BODY.slice(0, at),
    /templates\/attestation\.md/,
    "the body template places the attestation block somewhere other than under ## Attestation",
  );
  assert.equal(withoutComments(BODY.slice(at)).trim(), "## Attestation", "something follows the attestation");
});

test("the skill and the attestation template place the block the same way", () => {
  const phase = /## Phase 8 - change request\n([\s\S]*?)\n## /.exec(read(SKILL_MD));
  assert.ok(phase, "there is no change request phase");
  assert.match(phase[1], /`## Attestation`/, "phase 8 does not say where the attestation block goes");
  assert.match(ATTESTATION_TEMPLATE, /`## Attestation`/, "the attestation template does not say where it goes");
});

test("the Testing section names the documentation step", () => {
  const testing = /\n## Testing\n([\s\S]*?)\n## /.exec(BODY);
  assert.ok(testing, "the body template has no ## Testing section");
  assert.match(testing[1], /documentation step/, "Testing must say what the documentation step updated");
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
  const testing = /\n## Testing\n([\s\S]*?)\n## /.exec(BODY)[1].replace(/\s+/g, " ");
  assert.match(testing, /run in this session/, "Testing must say what ran here, not what should work");
  assert.match(testing, /not verified/, "Testing must label what was not verified");
});
