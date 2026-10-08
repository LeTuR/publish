// The skill's own shape: its frontmatter, the one install command, the tools it
// tells an agent to run, and the agreement between the README and the skill on
// the two things consumers configure against.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, SKILL_DIR, SKILL_MD, fencedBlocks, frontmatter, read, shippedFiles } from "./helpers.mjs";

const skill = read(SKILL_MD);
const readme = read(path.join(ROOT, "README.md"));

/** Where this skill lives. The install command and the package both point here. */
const REPOSITORY = "https://github.com/Thurbeen/publish";

test("the frontmatter is there and names the skill after its directory", () => {
  const fm = frontmatter(skill);
  assert.ok(fm, "SKILL.md has no frontmatter, so no agent will index it");
  assert.equal(fm.name, path.basename(SKILL_DIR));
  assert.ok(fm.description, "a skill with no description is a skill nothing loads");
  assert.ok(fm.description.length > 200, "the description is what decides whether the skill loads at all");
});

test("the description names the triggers and the precedence rule", () => {
  const { description } = frontmatter(skill);
  for (const trigger of ["push", "publish", "ship", "PR", "merge"]) {
    assert.ok(description.includes(trigger), `the description never mentions "${trigger}"`);
  }
  assert.match(
    description,
    /Do not load it when the repository ships its own publish, ship or release skill/,
    "the description must say when not to load, or two gates run on one branch",
  );
});

test("the body keeps the promises the description makes", () => {
  const { description } = frontmatter(skill);
  for (const phase of ["rebase", "review", "push", "change request", "feedback", "report"]) {
    assert.ok(description.toLowerCase().includes(phase), `the description omits ${phase}`);
    assert.ok(skill.toLowerCase().includes(phase), `the body omits ${phase}`);
  }
  const phases = [...skill.matchAll(/^## Phase (\d+) - /gm)].map((m) => Number(m[1]));
  assert.deepEqual(phases, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "the phases are not numbered in order");
});

test("documentation is its own phase, between the gate and the commit", () => {
  const names = [...skill.matchAll(/^## Phase \d+ - (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(names.slice(4, 7), ["gate", "documentation", "commit"]);
  const docs = /## Phase 5 - documentation\n([\s\S]*?)\n## /.exec(skill);
  assert.ok(docs, "there is no documentation phase");
  for (const kind of ["README", "reference", "changelog", "comment"]) {
    assert.ok(docs[1].includes(kind), `the documentation phase never mentions ${kind}`);
  }
  assert.match(docs[1], /git commit -m "docs: /, "the documentation phase must commit what it changed");
  assert.match(docs[1], /`documentation` step/, "the documentation phase must say what it records");
  assert.match(docs[1], /phase 4/, "a doc the gate checks must go back through the gate");
});

test("there is exactly one install command, and it installs this skill", () => {
  const installs = [];
  for (const file of ["README.md", ...shippedFiles().map((f) => path.join("skills/publish", f))]) {
    const text = read(path.join(ROOT, file));
    for (const sh of fencedBlocks(text, "sh")) {
      if (sh.includes("skills@") || /\bskills\s+add\b/.test(sh)) installs.push({ file, sh });
    }
  }
  assert.equal(installs.length, 1, `expected one install recipe, found ${installs.length}`);
  const { sh } = installs[0];
  assert.ok(sh.includes(`npx skills@latest add ${REPOSITORY} `), `install must be a one-liner with npx, from ${REPOSITORY}`);
  assert.match(sh, /--skill publish\b/, "install must name the skill");
  // `universal` is the agent whose directory is .agents/skills, where the one
  // real copy lives. Every other agent named gets a symlink to it. With --yes
  // and a single target, the CLI copies instead, so a second agent is required.
  assert.match(
    sh,
    /--agent universal [a-z][\w-]*/,
    "install must put the skill in .agents/skills and symlink at least one agent to it",
  );
  assert.doesNotMatch(sh, /--copy\b/, "install must symlink agents to .agents/skills, not copy per agent");
  assert.match(sh, /--yes\b/, "install must not stop on a prompt an agent cannot answer");
});

test("the package names the repository the install command installs from", () => {
  const { repository } = JSON.parse(read(path.join(ROOT, "package.json")));
  assert.equal(repository.url, `git+${REPOSITORY}.git`);
});

/** The leading word of each shell statement, ignoring quoted continuations. */
function commandsIn(markdown) {
  const named = new Set();
  for (const sh of fencedBlocks(markdown, "sh")) {
    let open = false;
    for (const line of sh.split("\n")) {
      const code = line.replace(/\s+#.*$/, "").replace(/^#.*$/, "").trim();
      const quotes = (code.match(/'/g) ?? []).length;
      if (open) {
        open = quotes % 2 === 0;
        continue;
      }
      open = quotes % 2 === 1;
      if (!code) continue;
      const first = code.split(/[\s=(]/)[0];
      if (first) named.add(first);
    }
  }
  return named;
}

test("the skill itself runs nothing but git", () => {
  const named = commandsIn(skill);
  assert.deepEqual([...named].sort(), ["git"], "a forge command in SKILL.md is a forge the skill hard-codes");
  assert.doesNotThrow(
    () => execFileSync("command", ["-v", "git"], { shell: "/bin/sh", stdio: "ignore" }),
    "git does not resolve here, and the skill assumes it does",
  );
});

const forgeRef = read(path.join(SKILL_DIR, "references", "forge.md"));

test("the forge is a seam with five named operations", () => {
  assert.match(skill, /through the adapter table in \[`references\/forge\.md`\]/);
  for (const op of [
    "default branch",
    "open or update a change request",
    "the head commit",
    "watch the pipeline",
    "read and answer the feedback",
  ]) {
    assert.ok(forgeRef.includes(op), `the operation table does not name "${op}"`);
  }
  const rows = [...forgeRef.matchAll(/^\| (\d) \| \*\*/gm)].map((m) => Number(m[1]));
  assert.deepEqual(rows, [1, 2, 3, 4, 5], "the operations must be numbered, because the phases cite them by number");
});

test("every shipped adapter implements all five operations", () => {
  const adapters = [...forgeRef.matchAll(/^## (.+), through `(\w+)`$/gm)];
  assert.ok(adapters.length >= 2, "forge-agnostic means more than one adapter is actually written");
  for (const [, name, cli] of adapters) {
    const section = forgeRef.slice(forgeRef.indexOf(`## ${name}, through \`${cli}\``));
    const body = section.slice(0, section.indexOf("\n## ", 4) === -1 ? undefined : section.indexOf("\n## ", 4));
    for (const op of ["# 1", "# 2", "# 3", "# 4", "# 5"]) {
      assert.ok(body.includes(op), `the ${cli} adapter has no command marked ${op}`);
    }
    assert.match(body, /# 3/, `the ${cli} adapter documents no way to read the head`);
    assert.ok(commandsIn(body).has(cli), `the ${cli} adapter's commands do not run ${cli}`);
  }
});

test("an unimplemented forge stops rather than improvising", () => {
  assert.match(forgeRef, /## Any other forge/);
  assert.match(forgeRef, /Stop, and say which forge and which operation is missing/);
  assert.match(
    forgeRef,
    /Half of an adapter is worse than none/,
    "a seam that is half an adapter is discovered after the push",
  );
  assert.match(skill, /A forge with no adapter is a stop, not an improvisation/);
});

test("authentication is checked before the branch is pushed, not after", () => {
  assert.match(skill, /\*\*Check the forge CLI is authenticated here, before phase 2\*\*/);
  for (const [, , cli] of forgeRef.matchAll(/^## (.+), through `(\w+)`$/gm)) {
    assert.ok(forgeRef.includes(`${cli} auth status`), `the ${cli} adapter has no authentication check`);
  }
});

test("the skill publishes committed work and does not commit for the user", () => {
  assert.match(skill, /\*\*Working tree must be clean\.\*\*/);
  assert.match(skill, /do not commit them on their behalf\s+and do not discard them/);
  assert.match(skill, /\*\*Never publish from the base branch\.\*\*/);
});

test("the push is leased, never forced", () => {
  assert.match(skill, /git push --force-with-lease origin HEAD/);
  assert.doesNotMatch(skill, /git push --force\b(?!-with-lease)/, "a bare --force erases somebody's commit");
  assert.match(skill, /`--force-with-lease` and never `--force`/);
});

test("the README and skill describe the same four-section body", () => {
  for (const heading of ["Intent", "What Changed", "Risk Assessment", "Testing"]) {
    assert.ok(readme.includes(`## ${heading}`));
    assert.ok(skill.includes(`\`## ${heading}\``));
  }
  assert.doesNotMatch(readme, /publish-attestation|head_sha|## Attestation/);
});

test("the README and the skill agree on how a repository declares its gate", () => {
  assert.ok(readme.includes(".publish.yaml"), "the README must name the declaration file");
  const table = new Set([...readme.matchAll(/^\| `([\w.[\]]+)` \|/gm)].map((m) => m[1]));
  const reference = read(path.join(SKILL_DIR, "references", "gate.md"));
  const canonical = new Set([...reference.matchAll(/^\| `([\w.[\]]+)` \|/gm)].map((m) => m[1]));
  assert.deepEqual([...table].sort(), [...canonical].sort(), "the README's key table has drifted");
});

test("the README tells an agent when to load the skill and when not to", () => {
  assert.match(readme, /## When an agent should load it/);
  assert.match(readme, /Not when the repository ships its own `publish`, `ship` or `release` skill/);
  assert.match(readme, /## Install/);
});

test("nothing in the repository carries a local path, a private host or an address", () => {
  const PUBLIC_HOSTS = ["github.com", "www.npmjs.com", "axi.md", "developer.hashicorp.com", "docs.github.com", "docs.gitlab.com"];
  const files = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter((f) => f !== "LICENSE");
  const offences = [];
  for (const file of files) {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) continue;
    const text = read(full);
    for (const [i, line] of text.split("\n").entries()) {
      const at = `${file}:${i + 1}`;
      if (/(?:^|[\s"'`(])(?:\/home\/|\/Users\/|\/root\/)[\w.-]/.test(line)) offences.push(`${at} home path`);
      if (/\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(line)) offences.push(`${at} address literal`);
      if (/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(line) && !/git[@]github\.com/.test(line)) offences.push(`${at} email`);
      // `git[@]` rather than the literal: this scan reads its own source too.
      if (/\bssh:\/\/|\bgit[@](?!github\.com)/.test(line)) offences.push(`${at} non-public git remote`);
      for (const m of line.matchAll(/https?:\/\/([\w.-]+)/g)) {
        if (!PUBLIC_HOSTS.includes(m[1])) offences.push(`${at} host ${m[1]}`);
      }
    }
  }
  assert.deepEqual(offences, [], "this repository is public and keeps nothing local in it");
});
