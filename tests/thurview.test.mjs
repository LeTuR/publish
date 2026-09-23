// thurview is a second reviewer the review phase uses when it can: a code graph
// of the callers and tests a diff does not show. It is optional, it is kept
// current before it runs, and the attestation says which reviewer ran and at
// which version - without a field the v1 contract does not define.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { SKILL_DIR, SKILL_MD, fencedBlocks, read } from "./helpers.mjs";

const skill = read(SKILL_MD);
const review = read(path.join(SKILL_DIR, "references", "review.md"));
const attestation = read(path.join(SKILL_DIR, "references", "attestation.md"));

/** The thurview section of review.md, up to the next second-level heading. */
function thurviewSection() {
  const m = /\n## thurview\n([\s\S]*?)(?=\n## |$)/.exec(review);
  assert.ok(m, "review.md has no `## thurview` section");
  return m[1];
}

/** The same section with its line breaks collapsed, for phrases that wrap. */
function thurviewProse() {
  return thurviewSection().replace(/\s+/g, " ");
}

test("the review phase uses thurview when it can, and only then", () => {
  const phase = /## Phase 3 - review\n([\s\S]*?)\n## /.exec(skill);
  assert.ok(phase, "there is no review phase");
  assert.match(phase[1], /thurview/, "the review phase never mentions thurview");
  assert.match(phase[1], /optional/i, "the review phase must say thurview is optional");
});

test("thurview is detected as a skill and as a CLI, on PATH or through npx", () => {
  const section = thurviewSection();
  const sh = fencedBlocks(section, "sh").join("\n");
  assert.match(sh, /command -v thurview/, "no check for the CLI on PATH");
  assert.match(sh, /npx --no-install thurview --version/, "no check for a copy npx already has");
  assert.match(thurviewProse(), /`thurview` or `review-fix` skill/, "no check for the installed agent skill");
});

test("thurview is brought up to date before it reviews anything", () => {
  const section = thurviewSection();
  const sh = fencedBlocks(section, "sh").join("\n");
  assert.match(sh, /npm view thurview version/, "no way to learn the latest published version");
  assert.match(sh, /thurview update/, "no way to update an installed CLI");
  assert.match(sh, /npm i(?:nstall)? -g thurview@latest/, "no way to update a CLI installed with npm");
  assert.match(thurviewProse(), /skills@latest update thurview review-fix --global --yes/, "no way to update the skill");
  assert.match(thurviewProse(), /before (?:the first round|it reviews)/, "the update must come before the review");
});

test("offline or unable to update: say so and use the installed version", () => {
  const section = thurviewProse();
  assert.match(section, /offline|cannot reach the registry/i);
  assert.match(section, /installed version/, "the fallback is the version already installed");
  assert.match(section, /say so/i, "a version that could not be checked must be reported as such");
});

test("no thurview at all: the built-in review, unchanged, and never a requirement", () => {
  const section = thurviewProse();
  assert.match(section, /built-in review, unchanged/);
  assert.match(section, /never a requirement/i);
  assert.match(skill, /never a requirement/i, "the skill itself must say thurview is never required");
});

test("thurview runs pinned to the version that was checked, against the reviewed range", () => {
  const sh = fencedBlocks(thurviewSection(), "sh").join("\n");
  const runs = sh.split("\n").filter((l) => /thurview@<version> graph/.test(l));
  assert.ok(runs.length >= 2, "impact and interfaces must both run");
  for (const line of runs) {
    assert.match(line, /^npx --yes thurview@<version> graph \w+/, `not a pinned invocation: ${line}`);
    assert.match(line, /--base <base_sha> --head <head_sha>/, `not pinned to the reviewed range: ${line}`);
  }
});

test("thurview's findings go through the same rounds and the same failure-scenario rule", () => {
  const section = thurviewProse();
  assert.match(section, /same rounds/);
  assert.match(section, /failure scenario/);
});

test("the attestation records which reviewer ran, and its version, within v1", () => {
  const prose = attestation.replace(/\s+/g, " ");
  assert.match(
    prose,
    /The review step's `command` is the thurview command that ran/,
    "the field contract must say where the reviewer and its version are recorded",
  );
  assert.match(prose, /npx --yes thurview@\d+\.\d+\.\d+ graph impact/, "no worked example of the command");
  assert.match(prose, /built-in review .*no `command`/);
  assert.doesNotMatch(attestation, /"reviewer"/, "a new field is a new shape, and v1 does not define one");
});
