// A change request is not done while a maintainer's comment is unanswered. The
// feedback phase reads every review, thread and comment through the forge
// adapter, fixes or answers each one, and blocks while any is still open.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { SKILL_DIR, SKILL_MD, fencedBlocks, read } from "./helpers.mjs";

const skill = read(SKILL_MD);
const forgeRef = read(path.join(SKILL_DIR, "references", "forge.md"));

function phase(n, name) {
  const m = new RegExp(`## Phase ${n} - ${name}\\n([\\s\\S]*?)(?=\\n## |$)`).exec(skill);
  assert.ok(m, `there is no phase ${n} - ${name}`);
  // Collapsed, because this prose is wrapped at 80 columns and a phrase that
  // happens to straddle a line break is the same phrase.
  return m[1].replace(/\s+/g, " ");
}

/** One adapter's section of forge.md. */
function adapter(cli) {
  const start = forgeRef.search(new RegExp(`^## .+, through \`${cli}\`$`, "m"));
  assert.ok(start !== -1, `forge.md has no ${cli} adapter`);
  const next = forgeRef.indexOf("\n## ", start + 4);
  return forgeRef.slice(start, next === -1 ? undefined : next);
}

test("feedback is the last phase, after CI", () => {
  const names = [...skill.matchAll(/^## Phase \d+ - (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(names.slice(-2), ["CI", "feedback"]);
});

test("a re-publish reads the existing feedback before it reviews", () => {
  const preflight = phase(1, "preflight");
  assert.match(preflight, /already open from this branch/);
  assert.match(preflight, /phase 10/, "a re-publish must work the open feedback, not only new code");
});

test("the feedback phase reads everything, from humans and bots", () => {
  const text = phase(10, "feedback");
  for (const kind of ["review", "inline thread", "review comment", "conversation comment"]) {
    assert.ok(text.includes(kind), `the feedback phase never mentions ${kind}`);
  }
  assert.match(text, /\*\*every\*\*/, "the feedback phase must read every item, not a sample");
  assert.match(text, /humans and bots/);
  assert.match(text, /operation 5/, "the feedback must be read through the forge adapter");
});

test("each comment is one checklist item, fixed test-first or answered with evidence", () => {
  const text = phase(10, "feedback");
  assert.match(text, /one item per comment/);
  assert.match(text, /test first/i);
  assert.match(text, /verify it locally/);
  assert.match(text, /reply with the evidence/);
  assert.match(text, /resolve/);
  assert.match(text, /quote the local evidence/, "a reply must carry what was run, not a promise");
});

test("a fix goes back through the gate and CI, and open feedback blocks", () => {
  const text = phase(10, "feedback");
  assert.match(text, /back to phase 3/, "a fix is new code and new code is unreviewed");
  assert.match(text, /recheck CI for the new head/);
  assert.match(text, /unresolved thread/);
  assert.match(text, /review check/, "a failing review bot is not done either");
  assert.match(text, /threads answered/, "the report must count the threads answered");
  assert.match(text, /`feedback` step/);
});

test("feedback keeps the body human-facing", () => {
  const text = phase(10, "feedback");
  assert.match(text, /update the Testing section/);
  assert.doesNotMatch(text, /rewrite the whole block|re-attest/);
});

test("the feedback loop terminates rather than chasing a bot forever", () => {
  const text = phase(10, "feedback");
  assert.match(text, /already answered/, "a point answered once is answered, not re-fixed");
  assert.match(text, /third pass/, "the loop needs a cap, as the review phase has one");
  assert.match(text, /`failed`/, "a loop that will not settle ends as a step that blocks");
});

test("both adapters read, answer and resolve feedback", () => {
  const gh = adapter("gh");
  for (const needle of [
    "reviewThreads",
    "latestOpinionatedReviews",
    "addPullRequestReviewThreadReply",
    "resolveReviewThread",
    "gh pr comment",
  ]) {
    assert.ok(gh.includes(needle), `the gh adapter never uses ${needle}`);
  }
  const glab = adapter("glab");
  assert.match(glab, /merge_requests\/<number>\/discussions/);
  assert.match(glab, /discussions\/<discussion-id>\/notes/, "no way to reply on a GitLab thread");
  assert.match(glab, /resolved=true/, "no way to resolve a GitLab thread");
});

test("the documented GraphQL documents are balanced", () => {
  for (const sh of fencedBlocks(adapter("gh"), "sh")) {
    for (const m of sh.matchAll(/query='([\s\S]*?)'/g)) {
      const opens = (m[1].match(/\{/g) ?? []).length;
      const closes = (m[1].match(/\}/g) ?? []).length;
      assert.equal(opens, closes, `unbalanced GraphQL: ${m[1].slice(0, 60)}`);
    }
  }
});
