// `skills add` copies skills/publish/ and nothing else. Every link that climbs
// out of that directory resolves perfectly for whoever wrote it and is dead in
// every installed copy, which is the quiet way a skill loses the reference it
// told an agent to read at the moment it mattered.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, SKILL_DIR, SKILL_MD, read, shippedFiles } from "./helpers.mjs";

const markdown = shippedFiles().filter((f) => f.endsWith(".md"));

/** Every markdown link target in a file, minus anchors and external URLs. */
function localLinks(text) {
  const links = [];
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = m[1].split("#")[0].trim();
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    links.push(target);
  }
  return links;
}

test("there is a skill, laid out where the installer looks", () => {
  assert.ok(fs.existsSync(SKILL_MD), "skills/publish/SKILL.md is missing");
  assert.ok(markdown.length >= 4, "the skill ships fewer files than it documents");
  assert.ok(shippedFiles().includes("templates/change-request-body.md"));
  assert.ok(shippedFiles().includes("references/forge.md"));
});

test("every link in the skill resolves, and none escapes the skill directory", () => {
  const broken = [];
  const escaping = [];
  for (const rel of markdown) {
    const from = path.join(SKILL_DIR, rel);
    for (const target of localLinks(read(from))) {
      const resolved = path.resolve(path.dirname(from), target);
      if (!resolved.startsWith(SKILL_DIR + path.sep)) escaping.push(`${rel} -> ${target}`);
      else if (!fs.existsSync(resolved)) broken.push(`${rel} -> ${target}`);
    }
  }
  assert.deepEqual(escaping, [], "a link outside skills/publish/ is dead in every installed copy");
  assert.deepEqual(broken, [], "a link to a file that is not there");
});

test("the skill names no path outside itself", () => {
  const offences = [];
  for (const rel of markdown) {
    const text = read(path.join(SKILL_DIR, rel));
    for (const m of text.matchAll(/(?:^|\s|`)(\.\.\/[\w./-]+|skills\/publish\/[\w./-]+)/g)) {
      offences.push(`${rel}: ${m[1]}`);
    }
  }
  assert.deepEqual(
    offences,
    [],
    "paths are relative to the skill directory; an installed copy has no parent to climb to",
  );
});

test("every file the skill ships is reachable from SKILL.md", () => {
  const seen = new Set(["SKILL.md"]);
  const queue = ["SKILL.md"];
  while (queue.length) {
    const rel = queue.shift();
    for (const target of localLinks(read(path.join(SKILL_DIR, rel)))) {
      const next = path.relative(SKILL_DIR, path.resolve(path.dirname(path.join(SKILL_DIR, rel)), target));
      if (!seen.has(next)) {
        seen.add(next);
        if (next.endsWith(".md")) queue.push(next);
      }
    }
  }
  const orphans = shippedFiles().filter((f) => !seen.has(f));
  assert.deepEqual(orphans, [], "a shipped file nothing points at is a file no agent will ever load");
});

test("the skill ships no code and nothing to install", () => {
  const code = shippedFiles().filter((f) => /\.(mjs|js|cjs|ts|py|sh|rb)$/.test(f));
  assert.deepEqual(code, [], "the skill is prose; a program here would need a second install step");
});

test("the package ships the skill directory", () => {
  const pkg = JSON.parse(read(path.join(ROOT, "package.json")));
  assert.deepEqual(pkg.files, ["skills"], "package.json must publish the skill and only the skill");
  assert.equal(pkg.type, "module");
});

test("the tests are not shipped inside the skill", () => {
  assert.ok(
    !shippedFiles().some((f) => /(^|\/)tests?\//.test(f) || /\.test\.[a-z]+$/.test(f)),
    "test files inside skills/publish/ would be copied into every install",
  );
});

test("nothing the skill loads is optional-if-present", () => {
  // A reference the skill only reads "if available" is a reference it will one
  // day silently not read.
  const text = read(SKILL_MD);
  assert.doesNotMatch(
    text,
    /if (?:it is )?(?:present|available|there)[^.\n]*references\//i,
    "a conditionally-loaded reference is a step that can vanish without a trace",
  );
  assert.match(text, /Read it now/, "the gate reference must be loaded, not offered");
  assert.match(text, /Read \[`references\/review\.md`\]\(references\/review\.md\) before the first round/);
});

test("every code fence stands on a line of its own", () => {
  // Text after a closing fence keeps the block open, so the rest of the file
  // renders as code and an agent reading the rendered page loses it.
  const offences = [];
  for (const rel of markdown) {
    for (const [i, line] of read(path.join(SKILL_DIR, rel)).split("\n").entries()) {
      if (/```/.test(line) && !/^\s*```[\w-]*\s*$/.test(line)) offences.push(`${rel}:${i + 1}`);
    }
  }
  assert.deepEqual(offences, [], "a fence with text beside it never closes");
});
