---
name: publish
description: Take committed work through a gate and publish it - rebase, adversarial review against the repository's own rules, then whatever gate that repository declares (tests, lint, docs), then bring the documentation the change made stale up to date, then commit the fixes, push, open the change request, watch CI, answer feedback, and report the checked commit and results to the requester. Works on any forge with an adapter - GitHub and GitLab ship with it. Load this whenever someone asks to push, publish, ship, land, open a PR or MR, or get a branch merged, and whenever a task says to publish its own work. Do not load it when the repository ships its own publish, ship or release skill - that one wins.
license: MIT
---

# publish

Committed work goes out through one door. This skill is the door: it reviews the
change, runs the gate the repository declares for itself, pushes, opens the
change request, and waits for continuous integration. It reports done only when
the pipeline is green for the current head. The change request body explains
the intent, change, risk and testing in plain language. The final report names
the checked head and the gate results.

A change request is a pull request on GitHub and a merge request on GitLab. The
gate is the same either way; only phases 1, 8, 9 and 10 touch the forge, and they go
through the adapter table in [`references/forge.md`](references/forge.md).

```
  "ship this"
      │
      ▼
  0 precedence ──── someone else's gate? ──▶ hand over and stop
      │
  1 preflight       branch, clean tree, forge, base
  2 rebase          onto the base branch, fresh from the remote
  3 review     ◀─┐  adversarial, against this repository's rules
      │          │
      └─ fixes ──┘  iterate until a round finds nothing
      │
  4 gate            exactly the steps the repository declares
  5 documentation   what the change made stale, committed on its own
  6 commit          the fixes review and the gate produced
  7 push
  8 change request  four human-facing headings
  9 CI              watch it; a red pipeline is not done
 10 feedback   ◀─┐  every review, thread and comment, answered and resolved
      │          │
      └─ fixes ──┘  back through review, gate, push, CI
      │
      ▼
  green CI and feedback for the current head
```

Every phase below reports one of four statuses, and the report turns them into a
verdict. There is no fifth status and no way to leave a phase unreported:
`passed`, `failed`, `skipped`, `not-applicable`.

| status | means |
| --- | --- |
| `passed` | it ran and it was clean |
| `failed` | it ran and it was not clean |
| `skipped` | it should have run and could not - say why |
| `not-applicable` | the repository declares it has no such step |

**A `skipped` step and a `failed` step both block.** The verdict is `passed`
only when every step is `passed` or `not-applicable`. Anything else is
`blocked`, and a `blocked` verdict is reported to the user as not done. A step
you could not run is never reported as one that passed, and "CI was still
running" is never reported as green.

## Claim only what was verified here

Everything this skill writes for somebody else to read - the change request
body, a reply on a thread, a comment - is a claim about work that was done, and
a reader has no way to check it except by trusting it. So there is one rule,
and it holds in every phase below:

**Every statement must be backed by something run locally in this session**: a
command, a test, a measurement, with its output read. Not what the code should
do, not what the change is expected to fix - what was run here, and what it
printed.

- Something that was not verified is left out, or it is **labelled as not
  verified** in the same sentence that makes it. It is **never stated as fact**.
- "The tests pass" means they were run here and they passed. A step that was
  skipped is named as skipped in the body and final report.
- A reply on a thread quotes the evidence briefly - the command and the line of
  output that settles the point, not a promise about the next run.
- A claim about another platform, another toolchain or another forge than the
  one in front of you is unverified by definition. Say which one was exercised.

This is the same discipline the statuses above encode, applied to prose: a
sentence nobody ran is the `skipped` step of a change request body.

## Phase 0 - precedence

Three things outrank this skill. Check in this order and stop at the first hit.

1. **The repository's own skill.** A `publish`, `ship`, `release` or `deploy`
   skill inside the repository being published knows things this one cannot.
   Run that instead.
2. **An installed gate tool.** If the repository root has a gate tool's own
   config and that tool is set up in this clone, it is already the door. Running
   both pushes twice and opens two change requests.
3. **An explicit instruction in the repository's agent rules** naming a
   different way to publish.

Nothing found: this skill is the door. Continue.

## Phase 1 - preflight

Establish four facts and stop if any of them is wrong.

```sh
git rev-parse --abbrev-ref HEAD          # not the base branch
git status --porcelain                   # empty; this skill publishes commits
git rev-parse --short HEAD
git remote get-url origin                # which forge this is
```

- **Working tree must be clean.** This skill publishes committed work. Uncommitted
  changes are the user's to keep or commit; do not commit them on their behalf
  and do not discard them. Stop and say what is uncommitted.
- **Never publish from the base branch.** If `HEAD` is the base, stop and ask for
  a branch name. Do not create one silently - the user may have meant to commit
  somewhere else entirely.
- **The forge** comes from `forge:` in the gate declaration, or from the origin
  host. Read [`references/forge.md`](references/forge.md) now and pick the
  adapter: it is the five operations phases 1, 8, 9 and 10 need, one command
  each.
  **Check the forge CLI is authenticated here, before phase 2** - an
  authentication failure discovered at phase 8 is one discovered after the push.
  A forge with no adapter is a stop, not an improvisation: `git push` and a link
  to a web form is not a change request this skill opened, and nothing
  downstream can verify a body nobody wrote.
- **A change request already open from this branch** makes this a re-publish,
  and a re-publish starts by reading what the last one was told. Ask the forge
  for it (operation 2's update form needs the number anyway), and if there is
  one, work **phase 10** now, before the review: its checklist of maintainer
  comments is input to this round of fixes, not an afterthought once the branch
  has already been pushed again.
- **The base branch** is, in order: `base:` in the gate declaration, else the
  forge's default branch (operation 1). Fall back to
  `git symbolic-ref refs/remotes/origin/HEAD` and then to `main` only if the
  forge cannot be asked, and say in the final report which one you used.

Then read the gate declaration -
[`references/gate.md`](references/gate.md) has the file, the keys and the
discovery order for a repository that declares nothing. Read it now: the rest of
this skill runs the steps it returns, and a gate you could not resolve is a
`skipped` step, not an assumption.

## Phase 2 - rebase

```sh
git fetch origin
git rebase origin/<base>
```

Rebase before reviewing, not after. Reviewing a diff against a stale base means
reviewing code that will not exist after the merge, and every finding you spend
a round fixing may be a finding about somebody else's already-merged work.

Conflicts are the user's call. Stop, name the conflicted paths, and let them
choose - a conflict resolved by an agent guessing at intent is the one mistake
this whole gate cannot catch afterwards.

## Phase 3 - review

**This is the product.** Everything after it is plumbing. Measured against the
tool this replaces, the review step produced the large majority of the fixes and
the other steps produced a handful between them, so give it the time and the
rounds it needs and do not rush to phase 4.

Read [`references/review.md`](references/review.md) before the first round and
follow it. In outline:

1. Read the repository's own rules first - the declaration's `review.rules`,
   then the agent and contributor instructions the repository ships. Review
   against those, not against generic taste.
2. Review the whole branch, `git diff $(git merge-base origin/<base> HEAD)...HEAD`,
   not the last commit.
3. Every finding carries a concrete failure scenario: the input or state, and
   the wrong result it produces. **A finding with no failure scenario is not a
   finding** - drop it. That rule is what keeps the step precise enough to be
   worth the rounds.
4. Fix what you find, then review again - the fixes are new code and new code is
   unreviewed code. Iterate until a round finds nothing.
5. Cap it at five rounds. Still finding real defects at round five means the
   change is not ready: stop, report `failed`, and do not push.

**thurview**, when this machine has it, reviews the same branch against a code
graph of the callers and tests the diff does not show, and its rows feed the
same rounds. The reference says how to detect it, how to bring it up to date
before it runs, and what to do when the registry cannot be reached. It is
optional and it is never a requirement: without it, the review above is the
review, and the step passes on its own merits.

Record for the final report: rounds run, findings raised, findings fixed, and -
when thurview ran - the command it ran, pinned to its version, as the review
step's `command`.

## Phase 4 - gate

Run exactly the steps the declaration returned, in the order it lists them, from
the repository root, and nothing else. Do not add a step because the toolchain
suggests one, and do not drop a step because it looks redundant - a gate the
repository declared and this skill quietly skipped is the failure this design
exists to prevent.

A step may carry `instructions`: the repository's own notes on that step, as
text. Read them before you run it, and keep them in front of you whenever you
handle it - running it, reading its failure, fixing it. If you hand any of that
to another agent, hand the instructions over with it, as written. A step with
none runs exactly as below.

For each step:

- **It passes.** Record `passed` with the command.
- **It fails.** Fix the cause, not the symptom. Run the step's `fix:` command
  first if it declares one, then re-run the step. Fixes are code, so anything
  they touch goes back through phase 3 before you move on.
- **It cannot run at all** - the command is missing, a toolchain is not
  installed, it needs a credential you do not have. Record `skipped` and the
  reason in the step's own words, and remember that this blocks the verdict.
  Say it out loud to the user too; a blocked publish they do not hear about is
  a publish that silently did not happen.

Never edit the declaration to make a step pass. If a declared command is wrong,
that is a finding to report, not a file to change on the way past.

## Phase 5 - documentation

The review flags a doc the diff made untrue. This phase is where the
documentation catches up with the change. Walk what the change touches and
update whatever it made stale:

- the README, and any usage or help text,
- reference docs and their examples, including an example that no longer runs,
- the changelog, if the repository keeps one, in its own format,
- comments beside changed code that describe behaviour that is gone.

Only what this change made stale. A doc that was already wrong before this
branch is a finding to report, not a rewrite to slip in.

If anything changed, run phase 4's steps again - a repository that checks its
docs has just had them change under its tests. Then commit the documentation on
its own, staging only the files this phase touched; a file the review or the
gate also changed goes into phase 6's commit instead.

```sh
git add <the files this phase changed>
git commit -m "docs: <what the change made stale>"
```

Record a `documentation` step: `passed` when it ran, whether it updated
something or found nothing stale; `failed` with the reason when a stale doc
could not be brought in line; `skipped` with the reason when it could not run.
Nothing changed: no commit, and the step is still `passed`.

## Phase 6 - commit

Commit what phases 3 and 4 changed, separately from the work being published, so
a reviewer can read the original change without the gate's corrections mixed
into it. Conventional-commit subjects, imperative mood, and say what the fix
was for:

```sh
git add -A
git commit -m "fix: <what the review or the gate found>"
```

Nothing changed: no commit. An empty commit is a lie about what the gate did.

## Phase 7 - push

```sh
git push --force-with-lease origin HEAD
```

`--force-with-lease` and never `--force`: phase 2 rewrote this branch, and the
lease is what stops the push from erasing a commit somebody else put on it while
you were reviewing.

Capture the head that is now on the remote for the final report and
exact-head checks.

```sh
git rev-parse HEAD
```

## Phase 8 - change request

Start from
[`templates/change-request-body.md`](templates/change-request-body.md), fill it
in, and delete every instruction comment as you answer it. What ships must read
as prose a teammate wrote, under exactly four headings: `## Intent`,
`## What Changed`, `## Risk Assessment`, `## Testing`. State any skipped
checks honestly. Do not put an attestation heading, JSON block, marker or
hidden attestation comment in the body or in a comment.

Open it with operation 2 from your adapter, or update the one that is already
open from this branch rather than opening a second one.

The remote may squash-merge, in which case the title becomes the commit on the
base branch. Write it as that commit message: conventional-commit prefix,
imperative, no trailing period.

## Phase 9 - CI

Watch the pipeline with operation 4 from your adapter, and read a failing job
with the log command beside it. Wait for it. This is the phase with the only
failure mode that matters, so it has one rule and the rule has no exceptions:
**a red pipeline is not done, and a pipeline still running is not done either.**

- **Green.** Every required check succeeded. Record `passed` with the run URL.
- **Red.** Read the failing job's log, fix the cause, and go back to phase 3 -
  the fix is new code. Then push again and recheck CI for the new head. Update the body if
  its testing account changed.
- **No pipeline exists at all.** Only `ci.required: false` in the declaration
  makes that `not-applicable`. Without it, a repository with no checks is
  `skipped`, and the verdict is `blocked` until someone says in the declaration
  that this repository genuinely has no CI.
- **Still running past `ci.timeout`.** `skipped`, with how long you waited. It
  blocks, and that is the honest answer - say the pipeline is still going and
  let the user decide whether to wait.

## Phase 10 - feedback

A change request with an unanswered comment on it is not published, it is
waiting. This phase is where it stops waiting. On a first publish it runs once,
here, after CI: that is when the reviews that matter most - a bot's, a
maintainer's - arrive. On a re-publish it runs twice, because phase 1 sent you
here before the review, so that the comments already waiting are fixed in the
same round as everything else.

**Read everything, through operation 5 of your adapter.** Not the unresolved
ones, not the ones addressed to you: **every** review, inline thread, review
comment and conversation comment on this change request, from humans and bots
alike, your own account's included, with the thread each one belongs to and
whether it is resolved. Read [`references/feedback.md`](references/feedback.md)
now: its ledger turns the adapter's answer into one line per item, on any
forge, and it says how to read a review bot's summary.

**A summary is feedback too.** Do not stop at "no unresolved threads": a
thurview-pr-review or Greptile summary below 5/5, one that still lists open
findings, or one whose `Next:` line asks for a fix is open feedback, and its
findings are items like any thread.

**Wait for the reviewers who come after CI.** Review bots post minutes after a
push. When CI is green, keep reading for up to `feedback.wait` from the gate
declaration, until every summary names the current head and no review check is
pending; the reference has the rule. A score given to an older head is not a
score for this one.

**Keep a checklist, one item per comment.** Write it down before you fix
anything: a comment worked from memory is the one that gets answered with a
sentence nobody checked.

For each item, in this order:

1. **Understand or reproduce it.** Read the code it points at. If it claims a
   behaviour, get that behaviour in front of you - a failing test, a command,
   an output.
2. **Fix it, test first** when it is about behaviour: the test that fails for
   the reason the comment gives, then the fix that makes it pass. Then **verify
   it locally** - run the test, run the gate step that covers it, and read what
   it printed.
3. **Or reply with the evidence why not**, when the comment is wrong, out of
   scope, or already handled. That is a legitimate outcome, and it carries the
   same burden of proof as a fix does.
4. **Reply on that thread** saying what changed - the file, the commit, and
   what now proves it - and **quote the local evidence**: the command you ran
   and the line of its output. A reply that cannot point at something run here
   says so plainly instead. Then **resolve** the thread.

**A fix is new code**, so it goes **back to phase 3** and forward from there:
review it, run the gate, commit, push, and recheck CI for the new head. Reply
and resolve after that push, so the thread names a commit the forge already has.

The change request is not done while:

- any **unresolved thread** is open on it, or
- any **review check** is failing - a review bot's check is a check like the
  others, whether or not the branch protection requires it.

Either one is a `failed` `feedback` step, with the count still open as its
reason, and a `failed` step blocks the verdict. A forge that could not be asked
at all is `skipped`, also blocking. Everything answered and every review check
green is `passed`, and a change request nobody has commented on is `passed`
too - it ran, and there was nothing to answer.

A point that was **already answered** on an earlier pass is answered: reply
pointing at the thread that settled it and resolve the new one, rather than
fixing the same thing twice. Keep looping until each review bot is settled -
thurview at 5/5 with No open findings - or every point it still raises is
refuted with evidence. **Two rounds on the same point** is the cap: if it is
still raised, stop, record the `feedback` step `failed`, and report the point
with both answers. A change request that grows a new defect every time it is
touched is not one more round away from ready.

When the phase ends, update the Testing section if its account of checks or
feedback changed. Keep the body human-facing.

Record a `feedback` step, and report the number of **threads answered** in the
same breath as the verdict.

## Reporting

Compute the verdict, then say it in one line before anything else.

- Every step `passed` or `not-applicable` → verdict `passed` → report the change
  request URL and that CI is green.
- Anything else → verdict `blocked` → **say it is not done**, name every step
  that is `failed` or `skipped`, and say what would unblock each one. The change
  request may well be open; that is not the same claim as published.

Before reporting `passed`, read the change request head using operation 3 of
[`references/forge.md`](references/forge.md). It must equal the pushed commit
whose gate and CI results you checked. If it differs, review and run the gate
and CI again for that head. Report the checked head and commands to the requester,
not as a machine block in the change request.

Report the review state at that head from a last read of the ledger: the
thurview score and the head it reviewed, Greptile's score, head and check, and
the threads resolved after a fix, answered without one, and still open. A
reviewer that never posted is reported as never posted, not as clean.
