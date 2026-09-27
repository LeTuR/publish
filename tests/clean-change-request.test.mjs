import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { SKILL_DIR, SKILL_MD, read } from "./helpers.mjs";

test("a new change request can use the shipped body without publishing an attestation", () => {
  const body = read(path.join(SKILL_DIR, "templates", "change-request-body.md"))
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  const headings = [...body.matchAll(/^## .+$/gm)].map(([heading]) => heading);
  assert.deepEqual(headings, ["## Intent", "## What Changed", "## Risk Assessment", "## Testing"]);
  assert.doesNotMatch(body, /attestation|head_sha|```json/i);

  const phase = /## Phase 8 - change request\n([\s\S]*?)\n## /.exec(read(SKILL_MD));
  assert.ok(phase);
  assert.match(phase[1], /Do not put an attestation heading, JSON block, marker or/);
});
