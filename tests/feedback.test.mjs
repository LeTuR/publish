// A change request is not done while a maintainer's comment is unanswered. The
// feedback phase reads every review, thread and comment through the forge
// adapter, fixes or answers each one, and blocks while any is still open.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
  assert.match(text, /Two rounds on the same point/, "the loop needs a cap, as the review phase has one");
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

// The feedback ledger: each adapter's query, normalised by the jq block beside
// it, then read by the one shared filter in feedback.md. These run the
// documented filters themselves against recorded forge responses, so a filter
// that drifts from the forge's shape fails here rather than in a publish that
// reports a change request settled while a reviewer is still waiting.
const feedbackRef = read(path.join(SKILL_DIR, "references", "feedback.md"));
const FIXTURES = path.join(path.dirname(SKILL_DIR), "..", "tests", "fixtures");

function onlyJq(text, where) {
  const blocks = fencedBlocks(text, "jq");
  assert.equal(blocks.length, 1, `${where} must carry exactly one jq filter`);
  return blocks[0];
}

function ledger(cli, fixture, args = []) {
  const jq = (filter, input, extra = []) =>
    execFileSync("jq", ["-c", ...extra, filter], { input, encoding: "utf8" });
  const normalised = jq(onlyJq(adapter(cli), `the ${cli} adapter`), read(path.join(FIXTURES, fixture)), args);
  return jq(onlyJq(feedbackRef, "feedback.md"), normalised)
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}

const GH_HEAD = "2".repeat(40);

test("the GitHub ledger lists every thread, review, comment and bot summary", () => {
  assert.deepEqual(ledger("gh", "github-feedback.json"), [
    { kind: "head", sha: GH_HEAD },
    {
      kind: "thread", id: "PRRT_open", resolved: false, where: "src/upload.ts:42",
      author: "octo-author", url: "https://github.com/owner/repo/pull/7#discussion_r1", replies: 0,
      finding: { id: "3f2a9c1b07", category: "bug", severity: "blocking" },
    },
    {
      kind: "thread", id: "PRRT_done", resolved: true, where: "src/retry.ts",
      author: "greptile-apps", url: "https://github.com/owner/repo/pull/7#discussion_r2", replies: 1,
      finding: null,
    },
    {
      kind: "review", author: "a-maintainer", verdict: "CHANGES_REQUESTED",
      url: "https://github.com/owner/repo/pull/7#pullrequestreview-1",
    },
    {
      kind: "comment", author: "octo-author", url: "https://github.com/owner/repo/pull/7#issuecomment-1",
      reviewer: "thurview", head: "1".repeat(40), current: false, state: "active", confidence: 2,
      next: "Next: @octo-author — fix the blocking finding.", open_findings: true,
    },
    {
      kind: "comment", author: "greptile-apps", url: "https://github.com/owner/repo/pull/7#issuecomment-2",
      reviewer: "greptile", head: GH_HEAD, current: true, confidence: 4,
    },
    { kind: "comment", author: "a-maintainer", url: "https://github.com/owner/repo/pull/7#issuecomment-3" },
  ]);
});

test("the GitLab ledger reads discussions the same way, minus GitLab's own system notes", () => {
  const head = "3".repeat(40);
  assert.deepEqual(ledger("glab", "gitlab-feedback.json", ["--arg", "head", head]), [
    { kind: "head", sha: head },
    {
      kind: "thread", id: "d-thread", resolved: false, where: "lib/cache.rb:12",
      author: "a-maintainer", url: "#note_103", replies: 1, finding: null,
    },
    {
      kind: "comment", author: "octo-author", url: "#note_101",
      reviewer: "thurview", head, current: true, state: "active", confidence: 5,
      next: "Next: merge", open_findings: false,
    },
    { kind: "comment", author: "a-maintainer", url: "#note_105" },
  ]);
});

test("a bot summary's open findings are open feedback, not only its threads", () => {
  const text = phase(10, "feedback");
  assert.match(text, /references\/feedback\.md/, "phase 10 must load the feedback reference");
  assert.match(text, /summary/);
  assert.match(text, /Next:/, "a summary's next action is feedback too");
  assert.match(text, /no unresolved threads/i, "an empty thread list is not the end of it");
  assert.match(feedbackRef, /thurview-pr-review/);
  assert.match(feedbackRef, /thurview-finding/);
  assert.match(feedbackRef, /greptile_confidence_score/);
  assert.match(feedbackRef, /same account/, "thurview posts as the author; their own comments still count");
});

test("feedback waits, bounded, for reviewers that post after CI", () => {
  const text = phase(10, "feedback");
  assert.match(text, /`feedback\.wait`/, "the wait must be configurable");
  assert.match(text, /current head/);
  assert.match(feedbackRef, /`feedback\.wait`/);
  assert.match(feedbackRef, /`current`/, "the summary's head marker says whether it read this head");
});

test("thurview is looped to 5/5, and one point is worked at most twice", () => {
  const text = phase(10, "feedback") + " " + feedbackRef.replace(/\s+/g, " ");
  assert.match(text, /5\/5/);
  assert.match(text, /No open findings/);
  assert.match(text, /two rounds/i, "the same point is not chased a third time");
  assert.match(text, /refuted/, "a finding answered with evidence ends the loop for that point");
});

test("the report names the reviewers' final state", () => {
  const report = /## Reporting\n([\s\S]*)$/.exec(skill)[1].replace(/\s+/g, " ");
  assert.match(report, /thurview/);
  assert.match(report, /score/);
  assert.match(report, /Greptile/);
  assert.match(report, /resolved/);
  assert.match(report, /answered/);
});
