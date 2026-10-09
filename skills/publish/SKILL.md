---
name: publish
description: Take committed work through a gate and publish it - rebase, adversarial review against the repository's own rules, then whatever gate that repository declares (tests, lint, docs), then bring the documentation the change made stale up to date, then commit the fixes, push, open the change request, watch CI, answer feedback, and report the checked commit and results to the requester. Works on any forge with an adapter - GitHub and GitLab ship with it. Load this whenever someone asks to push, publish, ship, land, open a PR or MR, or get a branch merged, and whenever a task says to publish its own work. Do not load it when the repository ships its own publish, ship or release skill - that one wins.
license: MIT
---

# publish

Review the branch, run the gate the repository declares, push, open the change
request (a pull request on GitHub, a merge request on GitLab), wait for CI and
answer feedback. Done means green CI and settled feedback for the current head.
Only phases 1, 8, 9 and 10 touch the forge, through the adapter table in [`references/forge.md`](references/forge.md).

```
  0 precedence ──── someone else's gate? ──▶ hand over and stop
  1 preflight       branch, clean tree, forge, base, existing change request
  2 rebase          onto the fresh base
  3 review     ◀─┐  adversarial, against this repository's rules
      └─ fixes ──┘  until a round finds nothing
  4 gate            exactly the declared steps
  5 documentation   what the change made stale, its own commit
  6 commit          the review and gate fixes
  7 push
  8 change request  four human-facing headings
  9 CI              wait for it; infrastructure plan review when applicable
 10 feedback   ◀─┐  every review, thread and comment, answered and resolved
      └─ fixes ──┘  back through review, gate, push, CI
```

## Statuses

Every step records exactly one status. There is no fifth status and no way to leave a phase
unreported.

| status | means |
| --- | --- |
| `passed` | it ran and was clean |
| `failed` | it ran and was not clean |
| `skipped` | it should have run and could not - say why |
| `not-applicable` | the repository declares it has no such step |

**A `skipped` step and a `failed` step both block.** The verdict is `passed`
only when every step is `passed` or `not-applicable`; anything else is
`blocked`, reported as not done. A step you could not run is never reported as one that passed, and
"CI was still running" is never green.

## Claim only what was verified here

Everything written for somebody else - the change request body, a reply on a
thread, a comment - is a claim the reader can only trust.
**Every statement must be backed by something run locally in this session**: a
command, test or measurement whose output you read.

- Anything not verified is left out or **labelled as not verified** in the same
  sentence. It is **never stated as fact**.
- A skipped step is named as skipped in the body and the final report.
- A reply quotes the command and the output line that settles the point.
- Another platform, toolchain or forge than the one exercised is unverified by
  definition; name the one that was exercised.

## Phase 0 - precedence

Stop at the first hit:

1. **A `publish`, `ship`, `release` or `deploy` skill inside the repository.**
   Run that instead.
2. **An installed gate tool** - its config at the repository root and the tool
   set up in this clone. Running both pushes twice and opens two change
   requests.
3. **The repository's agent rules name another way to publish.**

Nothing found: continue.

## Phase 1 - preflight

```sh
git rev-parse --abbrev-ref HEAD          # not the base branch
git status --porcelain                   # empty
git rev-parse --short HEAD
git remote get-url origin                # which forge
```

- **Working tree must be clean.** Stop and say what is uncommitted;
  do not commit them on their behalf and do not discard them.
- **Never publish from the base branch.** Stop and ask for a branch name;
  never create one silently.
- **Gate:** read [`references/gate.md`](references/gate.md). Read it now: it
  resolves the declaration, including `forge:` and `base:`, and the steps phase
  4 runs. A gate you could not resolve is `skipped`.
- **Forge:** read [`references/forge.md`](references/forge.md) and pick the
  adapter from `forge:` or the origin host.
  **Check the forge CLI is authenticated here, before phase 2**, not after the
  push; if it is not, stop.
  A forge with no adapter is a stop, not an improvisation.
- **Base branch:** `base:` in the declaration, else the forge's default branch
  (operation 1). Only if the forge cannot be asked, fall back to
  `git symbolic-ref refs/remotes/origin/HEAD`, then `main`, and report which.
- **A change request already open from this branch** makes this a re-publish:
  find it (operation 2's update form needs its number) and work **phase 10**
  now, before the review, so the waiting comments are fixed in this round.

## Phase 2 - rebase

```sh
git fetch origin
git rebase origin/<base>
```

Rebase before reviewing, so the review sees what will merge. Conflicts are the
user's call: stop and name the conflicted paths.

## Phase 3 - review

Read [`references/review.md`](references/review.md) before the first round and
follow it: the repository's rules, the whole branch diff, a failure scenario for
every finding, rounds until one is clean, capped at five. A review that ends
`failed` stops the publish before the push. Most fixes come from this phase;
give it the rounds it needs.

**thurview**, when available, adds callers and tests the diff does not show. It
is optional and never a requirement; the reference covers detection, updating
and running it.

**Infrastructure** - including infrastructure directories in a mixed
repository - adds a conditional `infra-plan` step. Decide impact from the
repository rules, the diff and the actual plan workflow; when affected, read
[`references/infra-plan.md`](references/infra-plan.md) now to inventory scopes
and arrange read-only preview evidence. Otherwise record `not-applicable`.

Record rounds, findings raised and fixed, and - when thurview ran - its pinned
command as the review step's `command`.

## Phase 4 - gate

Run exactly the declared steps, in order, from the repository root. Do not add
a step the toolchain suggests, and do not drop a step because it looks redundant.

A step's `instructions` are the repository's notes on it: read them before
running it and keep them while you run it, read its failure or fix it. Hand
them over verbatim with any of that work.

- **Passes:** `passed`, with the command.
- **Fails:** run its `fix:` command if declared, fix the cause, re-run. Fixes are
  code: they go back through phase 3.
- **Cannot run** (missing command, toolchain or credential): `skipped` with the
  reason. It blocks; tell the user now.

Never edit the declaration to make a step pass. A wrong declared command is a
finding to report.

## Phase 5 - documentation

Update what this change made stale:

- the README, usage and help text,
- reference docs and examples, including one that no longer runs,
- the changelog, if kept, in its own format,
- a comment beside changed code that describes behaviour that is gone.

A doc that was already wrong is a finding, not a rewrite to slip in. If
anything changed, re-run phase 4's steps, then commit only this phase's files
(a file the review or gate also changed goes into phase 6):

```sh
git add <the files this phase changed>
git commit -m "docs: <what the change made stale>"
```

Record a `documentation` step: `passed` when it ran, whether or not anything
was stale; `failed` when a stale doc could not be fixed; `skipped` when it could
not run.

## Phase 6 - commit

Commit the review and gate fixes separately from the published work, with a
conventional subject saying what each fix was for. Nothing changed: no commit.

```sh
git add -A
git commit -m "fix: <what the review or the gate found>"
```

## Phase 7 - push

```sh
git push --force-with-lease origin HEAD
git rev-parse HEAD
```

`--force-with-lease` and never `--force`: the rebase rewrote the branch, and the
lease keeps a commit somebody else pushed meanwhile. Keep the pushed head for
the head checks.

## Phase 8 - change request

Fill [`templates/change-request-body.md`](templates/change-request-body.md) and
delete its comments. The body is teammate prose under exactly four headings:
`## Intent`, `## What Changed`, `## Risk Assessment`, `## Testing`. Name
skipped checks. Do not put an attestation heading, JSON block, marker or
hidden attestation comment in the body or in a comment.

Open it with operation 2, or update the one already open from this branch. The
title may become the squash commit: conventional prefix, imperative, no
trailing period.

## Phase 9 - CI

Watch the pipeline with operation 4 from your adapter, and read a failing job's
log with the command beside it. One rule: **a red pipeline is not done, and a
pipeline still running is not done either.**

- **Green:** every required check succeeded. `passed`, with the run URL.
- **Red:** fix the cause, back to phase 3, push, and recheck CI for the new
  head. Update the body if its testing account changed.
- **No pipeline:** `not-applicable` only with `ci.required: false`; otherwise
  a repository with no checks is `skipped`, blocked until the declaration sets
  `ci.required: false`.
- **Still running past `ci.timeout`.** `skipped`, with how long you waited; let
  the user decide whether to wait longer.

For infrastructure, after the preview jobs finish, complete the plan review in
[`references/infra-plan.md`](references/infra-plan.md): post or update its
six-section comment with current-head evidence or named gaps. Missing, stale or
partial evidence blocks `infra-plan` even when CI is green. Invoking this skill
authorizes that comment; never apply, deploy, write state or merge.

## Phase 10 - feedback

A comment nobody answered means the change request is still waiting. On a first
publish this runs once, after CI; on a re-publish it also runs before the review
(phase 1).

**Read everything through operation 5**: **every** review, inline thread,
review comment and conversation comment, from humans and bots alike, your own
account's included, resolved or not. Read
[`references/feedback.md`](references/feedback.md) now: it turns the adapter's
answer into a ledger and says how to read a review bot's summary.

**A summary is feedback too.** Even with no unresolved threads, a thurview or
Greptile summary below 5/5, one listing open findings, or one whose `Next:`
line asks for a fix is open, and its findings are items.

**Wait for late reviewers.** Once CI is green - not on the pass phase 1 sends
before anything was pushed - keep reading for up to `feedback.wait` until every
summary names the current head and no review check is pending. A score for an
older head is not a score for this one.

**Write a checklist, one item per comment**, before fixing anything. For each:

1. **Understand or reproduce it** - read the code; get a claimed behaviour in
   front of you as a failing test, command or output.
2. **Fix it, test first** when it is behaviour, then **verify it locally**: run
   the test and the gate step that covers it, and read the output.
3. **Or reply with the evidence why not** when it is wrong, out of scope or
   already handled - the same burden of proof as a fix.
4. **Reply on that thread** with what changed (file, commit, proof) and
   **quote the local evidence**: command and output line. Then **resolve** it.

**A fix is new code**: back to phase 3, gate, commit, push, and recheck CI for
the new head. Reply and resolve after that push, so the reply names a commit the
forge has.

**Loop until each bot is settled** - thurview at 5/5 with No open findings - or
every point it raises is refuted with evidence. While looping:

- A point **already answered** on an earlier pass and raised again in a new
  thread is the same point: link the settling answer and resolve the new
  thread rather than fixing it twice. The reply counts toward its rounds.
- **Two rounds on the same point** and it is still raised: stop, record
  `feedback` `failed`, and report the point, its link and both answers.
- A **third pass** (the third push this phase made) still brings substantive new
  findings: stop the same way.

Any **unresolved thread** or failing **review check** (a bot's check counts,
required or not) makes the `feedback` step `failed`, with the open count. A
forge that could not be asked is `skipped`. All answered and every review check
green, or nothing to answer, is `passed`.

When the phase ends, update the Testing section if its account changed; keep the
body human-facing. Record the `feedback` step and the number of **threads
answered**.

## Reporting

Say the verdict first, in one line.

- All `passed` or `not-applicable` → `passed`: the change request URL and green
  CI.
- Anything else → `blocked`: **say it is not done**, name every step
  that is `failed` or `skipped`, and what would unblock each. The change
  request may well be open; that is not the same claim as published.

Before reporting `passed`, read the change request head (operation 3). It must
equal the pushed head whose gate and CI you checked; otherwise review, gate and
CI again for that head. Report the checked head and commands to the requester,
never as a machine block in the change request.

For infrastructure, re-verify the saved plan review at that head
([`references/infra-plan.md`](references/infra-plan.md)) and report its URL,
scopes and `infra-plan` status.

Report the review state at that head from a last read of the ledger: thurview's
score and reviewed head, Greptile's score, head and check, and threads resolved
after a fix, answered without one, and still open. A reviewer that never posted
is reported as never posted, not as clean.
