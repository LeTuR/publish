# How a repository declares its gate

Loaded by phase 1. Every repository runs different commands, so this skill does
not know them - it asks the repository. This file is how it asks.

## The file

`.publish.yaml`, at the repository root. YAML, no schema registry, no plugin:
read it and run what it says.

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
```

## The keys

| key | required | meaning |
| --- | --- | --- |
| `version` | yes | `1`. A file without it is not this format; treat the repository as undeclared. |
| `forge` | no | `github` or `gitlab`, naming the adapter in `forge.md`. Default: matched from the origin remote's host. |
| `base` | no | The branch to rebase onto and open the change request against. Default: the remote's default branch. |
| `review.rules` | no | Extra files the review must read, beyond the ones it finds on its own. Paths relative to the repository root. |
| `gate` | yes | An ordered list of steps. Run them in the order written. |
| `gate[].name` | yes | The step's name in the final report. Free text; `test`, `lint` and `docs` are the conventional ones, and a repository whose whole gate is one script is free to call it `check`. |
| `gate[].run` | yes | One shell command, or a list run in order. Run from the repository root. |
| `gate[].fix` | no | A command that applies the mechanical fixes this step can apply. Run once on failure, before re-running `run`. |
| `gate[].instructions` | no | Text: the repository's own notes on this step. The skill hands it, as written, to whoever runs the step, reads its failure or fixes it. Absent: the step is handled with no notes. |
| `ci.required` | no | Default `true`. `false` declares that this repository genuinely has no continuous integration. |
| `ci.timeout` | no | Default `30m`. How long to wait before calling the pipeline `skipped` rather than green. |

`gate: []` - an empty list - is a repository stating it has no mechanical gate.
That is allowed, and it records `not-applicable`. Leaving `gate` out entirely is
not the same thing, and does not get the same treatment.

## Three worked declarations

A repository whose entire gate is one script:

```yaml
version: 1
gate:
  - name: check
    run: ./scripts/check.sh
    fix: ./scripts/check.sh --fix
```

A Rust repository with a task runner in front of the linters:

```yaml
version: 1
gate:
  - name: lint
    run: just lint
  - name: test
    run: cargo nextest run --all
```

A Rust repository whose linting is pre-commit hooks:

```yaml
version: 1
gate:
  - name: lint
    run: prek run --all-files
  - name: test
    run: cargo test --all-features
```

Three repositories, three gates, one skill. That is the whole point of reading
the declaration rather than guessing from the toolchain.

## When there is no declaration

No `.publish.yaml`: fall back, in this order, and stop at the first that yields
commands.

1. **The repository's agent or contributor instructions** - `AGENTS.md`,
   `CLAUDE.md`, `CONTRIBUTING.md`. If one of them names the commands to run
   before pushing, those are the gate. Take them verbatim.
2. **A task runner's default target** - a `justfile`, a `Makefile`, or
   `scripts/check.sh`. Only a target whose name says it is the check for this
   repository: `check`, `lint`, `test`, `ci`, `verify`. Never a target you are
   guessing about.
3. **The package manifest's own scripts** - `package.json` `scripts.test` and
   `scripts.lint`, `Cargo.toml` (then `cargo test`), `pyproject.toml` (then the
   test runner it configures).

Whatever you used, name the gate source in the final report: `.publish.yaml`,
or `discovered:AGENTS.md`, or `discovered:justfile`, and the steps carry the
commands you actually ran. A reader has to be able to tell a declared gate from
an inferred one.

**Nothing found by any of the three.** Then the gate is `skipped`, not absent.
Record one step:

```json
{ "name": "gate", "status": "skipped",
  "reason": "no .publish.yaml and no gate found in AGENTS.md, justfile or package.json" }
```

The verdict is `blocked`, and the way to unblock it is a `.publish.yaml` - which
is exactly the conversation worth having with whoever owns the repository. Do
not write that file for them as part of publishing someone else's change: a gate
is a policy decision, and a skill that invents one has invented the standard it
is about to certify against.

## Reading the file

Read it as text and act on it. Do not add a YAML parser to the repository being
published, and do not install one to read six keys.

```sh
test -f .publish.yaml && cat .publish.yaml
```

Three things to check as you read, because each is a silent failure otherwise:

- `version` is `1`. Anything else: treat the repository as undeclared and fall
  back, saying so.
- Every `gate[]` entry has a `name` and a `run`. An entry missing either is a
  broken declaration - report it as a `skipped` step naming the entry, and do
  not guess what was meant.
- `instructions`, when it is there, is text. A number, a list, a map or an
  empty value is a broken declaration too - report it the same way, rather
  than turning it into something to follow.

`review` and `ci` are not `gate[]` entries and take no `instructions`.
