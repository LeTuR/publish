# How a repository declares its gate

Loaded by phase 1. The skill does not know a repository's commands; it reads
them from the repository.

## The file

`.publish.yaml`, at the repository root:

```yaml
# .publish.yaml
version: 1

forge: github
base: main

review:
  rules:
    - AGENTS.md
    - docs/conventions.md

gate:
  - name: lint
    run: just lint
    fix: just fmt
  - name: test
    run:
      - cargo nextest run --all
      - cargo test --doc
    instructions: "The sqlite tests share one port, so a bind failure means an earlier run is still up. Stop it and re-run; do not mark the test flaky."
  - name: docs
    run: ./scripts/check-docs.sh

ci:
  required: true
  timeout: 30m

feedback:
  wait: 15m
```

| key | required | meaning |
| --- | --- | --- |
| `version` | yes | `1`. Anything else: the repository is undeclared. |
| `forge` | no | `github` or `gitlab`, an adapter in `forge.md`. Default: matched from the origin host. |
| `base` | no | The branch to rebase onto and target. Default: the remote's default branch. |
| `review.rules` | no | Extra files the review must read, relative to the repository root. |
| `gate` | yes | Ordered steps, run in the order written. |
| `gate[].name` | yes | The step's name in the report, such as `test`, `lint`, `docs` or `check`. |
| `gate[].run` | yes | One shell command, or a list run in order, from the repository root. |
| `gate[].fix` | no | A command applying this step's mechanical fixes, run once on failure before re-running `run`. |
| `gate[].instructions` | no | Text: the repository's notes on this step, handed as written to whoever runs it, reads its failure or fixes it. |
| `ci.required` | no | Default `true`. `false` declares that the repository has no CI. |
| `ci.timeout` | no | Default `30m`. How long to wait before CI is `skipped`. |
| `feedback.wait` | no | Default `15m`. How long to keep reading feedback after CI is green; see [`feedback.md`](feedback.md). |

`gate: []` - an empty list - is a repository stating it has no mechanical gate:
`not-applicable`. Leaving `gate` out entirely is not the same thing.

Other repositories declare other gates; run what is declared rather than what
the toolchain suggests:

```yaml
version: 1
gate:
  - name: check
    run: ./scripts/check.sh
    fix: ./scripts/check.sh --fix
```

```yaml
version: 1
gate:
  - name: lint
    run: prek run --all-files
  - name: test
    run: cargo test --all-features
```

```yaml
version: 1
gate:
  - name: test
    run: npm test
```

## Reading the file

Read it as text (`cat .publish.yaml`). Do not add a YAML parser to the repository being
published, and do not install one. Check as you read:

- `version` is `1`; otherwise fall back as undeclared, and say so.
- Every `gate[]` entry has a `name` and a `run`. An entry missing either is a
  broken declaration: report a `skipped` step naming the entry, and do
  not guess what was meant.
- `instructions`, when it is there, is text. A number, list, map or empty
  value is a broken declaration too, reported the same way.

`review`, `ci` and `feedback` take no `instructions`.

## When there is no declaration

No `.publish.yaml`: take the first source that yields commands.

1. **Agent or contributor instructions** - `AGENTS.md`, `CLAUDE.md`,
   `CONTRIBUTING.md` - naming the commands to run before pushing, verbatim.
2. **A task runner target** in a `justfile`, `Makefile` or `scripts/check.sh`,
   only when named as the check: `check`, `lint`, `test`, `ci`, `verify`.
   Never a target you are guessing about.
3. **The manifest's scripts** - `package.json` `scripts.test` and
   `scripts.lint`; `Cargo.toml` (`cargo test`); `pyproject.toml` (its configured
   test runner).

Always name the gate source in the final report - `.publish.yaml`,
`discovered:AGENTS.md`, `discovered:justfile` - with the commands actually run,
so a declared gate is distinguishable from an inferred one.

Nothing found: the gate is `skipped`, not absent. Record:

```json
{ "name": "gate", "status": "skipped",
  "reason": "no .publish.yaml and no gate found in AGENTS.md, justfile or package.json" }
```

The verdict is `blocked` until the owner adds a `.publish.yaml`. Do
not write that file for them as part of publishing a change: a gate is their
policy, and one you invent certifies nothing.
