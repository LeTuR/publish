# The review

Loaded by phase 3, before the first round. Work every pass.

## What you are reviewing

The whole branch against the base it merges into, not the last commit: a defect
added in one commit and hidden in a later one still lands on a squash.

```sh
BASE=$(git merge-base origin/<base> HEAD)
git diff --stat "$BASE"...HEAD
git diff "$BASE"...HEAD
```

Where a hunk changes behaviour, read the whole file: defects live where changed
lines meet unchanged ones.

## Read the rules first

Before round one, read:

1. `review.rules` from the declaration.
2. `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, and the style or architecture
   documents they point to.
3. The code next to the change: its naming, error handling, test style, logging
   and comment density are the standard where nothing is written down.

Breaking a written rule is a finding. A preference the repository does not
share is not.

## The two rules

**Recall:** work every pass, even on a diff that looks clean; do not stop at a
file's first defect.

**Precision:** every finding carries a failure scenario - the concrete input or
state and the wrong result (a crash, wrong value, leak, dropped write):

> `parse_window("")` returns `None`, and the caller at `sched.rs:88` unwraps it,
> so an empty `WINDOW` env var panics the scheduler at start-up instead of
> falling back to the default the docs promise.

No scenario, no finding: drop it or find the scenario.

## thurview

[thurview](https://www.npmjs.com/package/thurview) builds a code graph at both
commits: callers of a changed symbol, tests that reach it, exported signatures
that moved - what passes 2 and 6 need and a diff does not show. It is optional
and **never a requirement**: without it the review below is the whole review and
can pass on its own.

**Detect it** before the first round. Either the CLI or an installed `thurview` or `review-fix` skill
counts:

```sh
command -v thurview                  # the CLI on PATH
npx --no-install thurview --version  # a copy npx already has, without downloading one
```

**Update it** before it reviews anything:

```sh
npm view thurview version   # latest published
thurview --version          # installed
thurview update             # upgrade in place
npm i -g thurview@latest    # when installed with npm
```

Update the skill with `npx skills@latest update thurview review-fix --global --yes`.

**Offline**, or the update fails because it cannot reach the registry: use the
installed version and say so in the Testing section - the version that ran and
that it was not checked against the registry. An unchecked version is never
reported as current.

**Run it** over the reviewed range, pinned to that version, so the command in the final report names the
reviewer and version:

```sh
npx --yes thurview@<version> graph impact     --base <base_sha> --head <head_sha>
npx --yes thurview@<version> graph interfaces --base <base_sha> --head <head_sha>
npx --yes thurview@<version> graph callers <name> --base <base_sha> --head <head_sha>
```

- `impact.reach`: unchanged code calling something changed. Read each call site
  against the new behaviour.
- `reach[].tested: false` and `impact.untested`: paths nothing tests.
- `interfaces` rows `changed` or `removed`: run `graph callers` on each; for a
  removed one, ask the base graph.
- `unresolved` and `truncated`: what the graph could not see. A finding that
  rests on "no callers" states these numbers.

Its rows are evidence. Each becomes a finding only with a failure scenario, and
goes through the same rounds as the rest.

**Not available at all** (no CLI or skill, or it cannot run): the built-in review, unchanged. Say
in the Testing section that thurview did not run.

## The passes

1. **Correctness.** Boundaries and off-by-one; empty, one, many; null, zero,
   negative, absent; numeric edges; time zones and DST; encoding. Does the code
   do what its name and docstring say?
2. **The contract.** Every changed signature, export, route, schema, config key,
   CLI flag or column: search for its callers. A changed default changes every
   caller that omitted it; a removed field can break a consumer outside this
   repository.
3. **Error handling.** Every new failure path: handled, propagated with context,
   or swallowed? A catch that logs and continues reports false success. After a
   partial multi-step write, what state remains, and can it be retried?
4. **Concurrency and resources.** Shared mutable state, async ordering,
   check-then-act races. Files, sockets, locks, transactions and subprocesses
   closed on error paths too.
5. **Security.** Credentials and keys in code, fixtures, logs or history. Input
   reaching a shell, query, path, template or deserializer. Authorization on new
   entry points; widened permissions. A new dependency: what, who maintains it,
   which version, and why not the latest stable.
6. **Tests.** Does the change have tests that fail without it, asserting
   behaviour rather than mock calls? A test with no assertion, that swallows its
   own failure, or recomputes the expected value the code's way is worse than
   none. A bug fix without a regression test is a finding.
7. **Documentation.** READMEs, help text, comments, examples and changelog
   entries the change made untrue. A stale comment beside a changed line is the
   most common one.
8. **Simplification.** Duplicates of existing helpers (search first), dead code,
   unreachable branches, unused parameters, single-implementation abstractions.
   Name what to delete and what to use instead.
9. **Scope.** Anything the task did not ask for: unrelated reformatting,
   drive-by renames, incidental dependency bumps.
10. **Leakage.** Machine names, usernames, home paths, internal hosts, IP
    addresses, private URLs, ticket systems, customer names, absolute local
    paths - in code, comments, fixtures or test names.

## Rounds

1. Work the passes; write down each finding with its scenario.
2. Fix the cause with the smallest change.
3. Review the fixes - new code is unreviewed code - from the top, on the new
   diff.
4. Stop when a full round finds nothing.

Cap at five rounds. Real defects still found in round five: stop, record
`failed` with what is open, and do not push.

Report rounds run, findings raised and findings fixed. A dropped unsubstantiated
finding is not counted; a finding left unfixed is counted, with its reason in
the change request body.

This step finds and fixes defects against the repository's rules. It does not
approve the change or judge whether the design is the one you would choose.
