# The review

Loaded by phase 3, before the first round. This step produces most of what the
gate is worth; the rest of the skill is plumbing around it. Read this in full
and work the passes.

## What you are reviewing

The whole branch, against the base it will merge into:

```sh
BASE=$(git merge-base origin/<base> HEAD)
git diff --stat "$BASE"...HEAD
git diff "$BASE"...HEAD
```

Not `HEAD~1`, not the last commit: a defect introduced in commit two and papered
over in commit four is still a defect on `main` if the branch is squashed, and
reviewing commit-by-commit is how it gets missed.

Read whole files, not only hunks, wherever a hunk changes behaviour. Most real
defects live in the interaction between the changed lines and the unchanged ones
around them, and a hunk hides exactly that.

## Read the rules first

Review against this repository's standards, not against generic taste. Before
round one, read:

1. `review.rules` from the gate declaration - the repository naming, explicitly,
   what it wants reviewed against.
2. The repository's agent and contributor instructions: `AGENTS.md`,
   `CLAUDE.md`, `CONTRIBUTING.md`, and any style or architecture document those
   point to.
3. The code next to the change. Naming, error handling, test style, logging,
   comment density - the neighbours are the standard where nothing is written
   down.

A violation of a rule the repository actually wrote down is a finding. A
preference of yours that the repository does not share is not, and shipping it
as one is how a review step trains people to stop reading it.

## The two rules

**Recall: work every pass.** Do not stop at the first defect in a file. Walking
all of the passes below on a diff you think is clean is where the unobvious ones
come from.

**Precision: every finding carries a failure scenario.** Concrete input or
state, and the wrong result it produces - a crash, a wrong value, a leak, a
silently dropped write.

> `parse_window("")` returns `None`, and the caller at `sched.rs:88` unwraps it,
> so an empty `WINDOW` env var panics the scheduler at start-up instead of
> falling back to the default the docs promise.

If you cannot write that sentence, you do not have a finding yet. You have a
feeling. Drop it, or go and find the scenario that makes it real. This is the
rule that keeps the step worth reading.

Both rules at once: raise everything you can substantiate, and nothing you
cannot.

## thurview

[thurview](https://www.npmjs.com/package/thurview) reviews a change against a
code graph built at the two pinned commits: who calls a changed symbol, which
tests reach it, which exported signatures moved. That is the half of a change a
diff cannot show, and it is where pass 2 and pass 6 below find what a search
misses.

It is optional and it is **never a requirement**. It is a second pair of eyes,
not a gate: a machine without it, or without a network, runs the review exactly
as written here and the review step is `passed` all the same.

**Detect it** before round one. Either form counts - the CLI is what the review
runs, and the `thurview` or `review-fix` skill is how an agent already knows how
to read what it prints.

```sh
command -v thurview                  # the CLI on PATH
npx --no-install thurview --version  # a copy npx already has, without downloading one
```

**Keep it current** before it reviews anything - a graph built by an old version
is an old answer about today's code.

```sh
npm view thurview version   # the latest published version
thurview --version          # what is installed here
thurview update             # upgrade an installed CLI in place
npm i -g thurview@latest    # the same, when it was installed with npm
```

The skill is updated through the skills CLI, which takes the names it installed
them under: `npx skills@latest update thurview review-fix --global --yes`.

**Offline, or the update fails.** `npm view` cannot reach the registry, or the
upgrade will not run: use the installed version, and **say so** in the change
request's Testing section - which version ran, and that it could not be checked
against the registry. An unchecked version is reported, never assumed current.

**Run it** over the same range this file already told you to review, pinned to
the version you just settled on, so that the command recorded in the attestation
names the reviewer and its version:

```sh
npx --yes thurview@<version> graph impact     --base <base_sha> --head <head_sha>
npx --yes thurview@<version> graph interfaces --base <base_sha> --head <head_sha>
npx --yes thurview@<version> graph callers <name> --base <base_sha> --head <head_sha>
```

What to take from them:

- `impact.reach` - code that calls something the change touched and was not
  changed itself. Read each of those call sites against the new behaviour. This
  is the finding pass 2 is looking for and a diff does not contain.
- `reach[].tested: false` and `impact.untested` - a path nothing tests, which is
  pass 6's question answered without guessing.
- `interfaces` rows marked `changed` or `removed` - run `graph callers` on each,
  and for a removed one ask the base graph, because head has no callers left.
- `unresolved` and `truncated` - what the graph could not see. "No callers" is
  only as true as those numbers allow, so a finding resting on them says so.

Its rows are evidence, not findings. Each one still becomes a finding only with
a failure scenario written out, and the findings it produces go through the
**same rounds** as the rest: fix, review the fixes, stop when a round is clean.

**Not available at all** - no CLI, no skill, or no way to run one: the built-in
review, unchanged. Say in the Testing section that thurview did not run, and
carry on with the passes below.

## The passes

Work them in order. Each is a different way of looking at the same diff, which
is why the order matters less than doing all of them.

**1. Correctness.** Off-by-one and boundary conditions. Empty, one, many. Null,
zero, negative, absent. Integer and float behaviour at the edges. Time zones and
DST. Encoding. Does the code do what its own name and docstring say?

**2. The contract.** Every changed signature, exported symbol, route, schema,
config key, CLI flag, database column. Who calls it? Search - do not assume.
A changed default is a behaviour change for every caller that did not pass the
argument. A removed field breaks a consumer that is not in this repository.

**3. Error handling.** Every new failure path. Is it handled, propagated with
context, or swallowed? A bare catch that logs and continues leaves the caller
believing something succeeded. Partial failure in the middle of a multi-step
write - what is the state afterwards, and can it be retried?

**4. Concurrency and resources.** Shared mutable state, async ordering, a check
followed by an act on something another task can change in between. Files,
sockets, locks, transactions, subprocesses: is each closed on the error path as
well as the happy one?

**5. Security.** Credentials, tokens, keys, connection strings - in code, in
fixtures, in test data, in logs, in the diff's own history. Input that reaches a
shell, a query, a path, a template, a deserializer. Authorization checks on new
entry points. Permissions widened. A dependency added: what is it, who
maintains it, what version, and why not the latest stable.

**6. Tests.** Does the change have tests, and do they fail without it? Assert on
behaviour, not on a mock's call count. A test with no assertion, a test that
catches its own exception and passes, a test asserting a value it just computed
the same way the code does - each is worse than no test, because it reports
safety it does not have. Bug fix with no regression test: that is a finding.

**7. Documentation.** Anything the change made untrue. READMEs, help text,
comments describing behaviour that no longer exists, an example that no longer
runs, a changelog the repository keeps. A comment that lies is a defect, and a
stale comment beside a changed line is the most common one in any diff.

**8. Simplification.** Duplication of something the repository already has -
search before accepting a new helper. Dead code, unreachable branches, a
parameter no caller passes, an abstraction with one implementation. Say what to
delete and what to call instead; a cleanup finding with no replacement named is
noise.

**9. Scope.** Does the diff contain anything the task did not ask for? Unrelated
reformatting, a drive-by rename, a dependency bump that came along for the ride.
These are findings: they cost the reviewer the ability to read either half.

**10. Leakage.** Machine names, usernames, home directory paths, internal
hostnames, IP addresses, private URLs, ticket systems, customer names, absolute
paths from the machine this ran on. In code, in comments, in fixtures, in test
names. Published repositories keep whatever ships to them.

## Rounds

1. Work the passes. Write down every finding with its failure scenario.
2. Fix them. Smallest change that removes the cause, not the symptom.
3. **Review the fixes.** They are new code, and new code is unreviewed code. Go
   back to the top with the new diff.
4. Stop when a full round produces nothing.

Cap at five rounds. Still finding real defects at round five means the change is
not ready to publish: stop, record `failed` with what is still open, and say so.
Do not push it.

Count honestly for the attestation: rounds run, findings raised, findings fixed.
A finding you dropped as unsubstantiated was never a finding and is not
counted; a finding you decided not to fix is counted, and the reason belongs in
the pull request body where a reviewer will see it.

## What this step does not do

It does not approve the change. It does not decide whether the work was worth
doing, or gate on the design being the one you would have chosen. It finds
defects in the change as written, against the rules the repository set for
itself, and it fixes them.
