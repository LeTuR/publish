// Shared paths and the two small parsers the suite needs. No dependencies:
// this repository ships a skill, and a skill is prose, so the test suite is the
// only code here and it stays on the standard library.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

export const ROOT = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  "..",
);
export const SKILL_DIR = path.join(ROOT, "skills", "publish");
export const SKILL_MD = path.join(SKILL_DIR, "SKILL.md");
export const TESTS_DIR = path.join(ROOT, "tests");


/** The closed set of step statuses. A fifth one is a bug, not a feature. */
export const STATUSES = ["passed", "failed", "skipped", "not-applicable"];

export const read = (p) => fs.readFileSync(p, "utf8");

/** Every file under skills/publish - what `skills add` copies and nothing else. */
export function shippedFiles(dir = SKILL_DIR, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...shippedFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

/** Markdown frontmatter, which is a flat `key: value` map and nothing more. */
export function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  const fields = {};
  let key = null;
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z_][\w-]*):\s?(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      fields[key] = kv[2];
    } else if (key && line.trim()) {
      fields[key] += " " + line.trim();
    }
  }
  return fields;
}

/**
 * A parser for the subset of YAML `.publish.yaml` is documented to use: nested
 * maps, lists of maps, lists of scalars, plain scalars, `#` comments. It exists
 * to hold the documented examples to the documented keys. It is deliberately
 * strict - anything outside the subset throws rather than being guessed at,
 * because a test that quietly accepts a shape the skill cannot read is the same
 * silent skip this repository is built to make impossible.
 */
export function parseDeclaration(text) {
  const lines = [];
  for (const [i, raw] of text.split("\n").entries()) {
    const line = raw.replace(/\s+#.*$/, "").replace(/^#.*$/, "");
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    if (line.includes("\t")) throw new Error(`tab indentation on line ${i + 1}`);
    lines.push({ indent, text: line.trim(), n: i + 1 });
  }
  let pos = 0;

  const scalar = (s) => {
    if (s === "") return null;
    if (s === "[]") return [];
    if (s === "true" || s === "false") return s === "true";
    if (/^-?\d+$/.test(s)) return Number(s);
    return s.replace(/^["'](.*)["']$/, "$1");
  };

  function parseBlock(indent) {
    if (pos >= lines.length || lines[pos].indent < indent) return null;
    return lines[pos].text.startsWith("- ") || lines[pos].text === "-"
      ? parseList(indent)
      : parseMap(indent);
  }

  function parseList(indent) {
    const items = [];
    while (pos < lines.length && lines[pos].indent === indent) {
      const line = lines[pos];
      if (!line.text.startsWith("- ") && line.text !== "-")
        throw new Error(`expected a list item on line ${line.n}`);
      const inline = line.text === "-" ? "" : line.text.slice(2);
      pos++;
      if (inline === "") {
        const nested = parseBlock(indent + 2);
        if (nested === null) throw new Error(`empty list item on line ${line.n}`);
        items.push(nested);
      } else if (/^[A-Za-z_][\w.-]*:(\s|$)/.test(inline)) {
        // `- name: lint`, whose sibling keys are indented to the text, not the dash.
        lines.splice(pos, 0, { indent: indent + 2, text: inline, n: line.n });
        items.push(parseMap(indent + 2));
      } else {
        items.push(scalar(inline));
      }
    }
    return items;
  }

  function parseMap(indent) {
    const map = {};
    while (pos < lines.length && lines[pos].indent === indent) {
      const line = lines[pos];
      const kv = /^([A-Za-z_][\w.-]*):(?:\s+(.*))?$/.exec(line.text);
      if (!kv) throw new Error(`not a key on line ${line.n}: ${line.text}`);
      pos++;
      if (kv[2] !== undefined && kv[2] !== "") {
        map[kv[1]] = scalar(kv[2]);
      } else {
        const nested = parseBlock(indent + 2);
        map[kv[1]] = nested === null ? null : nested;
      }
    }
    return map;
  }

  const doc = parseBlock(0);
  if (pos !== lines.length) throw new Error(`unparsed content from line ${lines[pos].n}`);
  return doc ?? {};
}

/** The keys a `gate[]` entry may carry. */
export const STEP_KEYS = ["name", "run", "fix", "instructions"];

/**
 * What is wrong with a parsed declaration, as one line per problem - empty when
 * it is well-formed. A broken entry is reported, never repaired, because the
 * skill records it as a skipped step rather than guessing what was meant.
 */
export function validateDeclaration(doc) {
  const problems = [];
  if (doc.version !== 1) problems.push("version is not 1");
  if (!Array.isArray(doc.gate)) return [...problems, "gate is not a list"];
  const text = (v) => typeof v === "string" && v.length > 0;
  for (const [i, step] of doc.gate.entries()) {
    const at = `gate[${i}]`;
    if (step === null || typeof step !== "object" || Array.isArray(step)) {
      problems.push(`${at} is not a step`);
      continue;
    }
    for (const key of Object.keys(step)) {
      if (!STEP_KEYS.includes(key)) problems.push(`${at}.${key} is not a step key`);
    }
    if (!text(step.name)) problems.push(`${at}.name is missing`);
    const runs = Array.isArray(step.run) ? step.run : [step.run];
    if (runs.length === 0 || !runs.every(text)) problems.push(`${at}.run is not a command or a list of them`);
    if ("fix" in step && !text(step.fix)) problems.push(`${at}.fix is not a command`);
    if ("instructions" in step && !text(step.instructions)) problems.push(`${at}.instructions is not text`);
  }
  return problems;
}

/** Every fenced code block of a given language in a markdown file. */
export function fencedBlocks(text, lang) {
  const out = [];
  const re = new RegExp("(?:^|\\n)```" + lang + "\\n([\\s\\S]*?)\\n```(?=\\n|$)", "g");
  let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}
