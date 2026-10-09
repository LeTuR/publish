# publish

An agent skill that takes committed work through a gate before it leaves the
machine: adversarial review, the tests, lint and docs commands the repository
declares, and the documentation the change made stale. Only then does it push,
open the change request, wait for CI and answer every review.

It ships adapters for GitHub pull requests and GitLab merge requests. The gate
is the same on both.

## Install

```sh
npx skills@latest add https://github.com/Thurbeen/publish \
  --skill publish --agent universal claude-code --global --yes
```

`--global` covers every repository you publish from. `universal` puts the one
real copy in `~/.agents/skills/publish` and links each other agent you name to
it, so an update lands everywhere at once. Swap `claude-code` for any agent
[`skills`](https://www.npmjs.com/package/skills) supports, but keep `universal`
and at least one more: with `--yes` and a single target, the CLI copies instead
of linking. Nothing is compiled or put on `PATH`; the skill is prose an agent
reads.

## When an agent should load it

On "push this", "ship it", "publish", "open a PR", "get this merged", and on any
task whose instructions say to publish its own work.

Not when the repository ships its own `publish`, `ship` or `release` skill, and
not when a gate tool is already installed and configured in that clone. Both
push and open a change request too, and running two is how a branch ends up
with two.

## How it works

<p align="center">
  <img src="assets/workflow.svg" width="860" alt="The publish workflow. Phases 0 to 10 run in order: precedence, preflight, rebase, review, gate, documentation, commit, push, change request, CI, an infrastructure plan review when infrastructure is affected, then feedback and the report. Review findings, gate failures, red CI and feedback fixes all return to review. Another publishing path hands over; a wrong branch, dirty tree, missing adapter or rebase conflict stops; an unrunnable gate step, a fifth review round still finding defects, missing plan evidence or a point raised after two rounds blocks.">
</p>

- **Review is the product.** It reads the repository's own rules first, keeps
  only findings with a concrete failure scenario, and loops until a round finds
  nothing, five rounds at most. Measured against the tool this replaces, it
  produced the large majority of the fixes. Method:
  [`review.md`](skills/publish/references/review.md).
- **Every step reports one of four statuses**: `passed`, `failed`, `skipped`
  or `not-applicable`. The verdict is `passed` only when every step is `passed`
  or `not-applicable`. A step that could not run, a red pipeline and a pipeline
  still running all block.
- **The change request body** has four headings, in order: `## Intent`,
  `## What Changed`, `## Risk Assessment`, `## Testing`. It carries no machine
  attestation; the checked head and results go to the requester.
- **Infrastructure changes**, including infrastructure directories in mixed
  repositories, get one plan-review comment built from current-head preview
  evidence, updated on every re-publish. Missing or stale plans block, and the
  skill never applies anything. Procedure:
  [`infra-plan.md`](skills/publish/references/infra-plan.md).
- **Feedback is answered, not skimmed.** Every review, thread and bot summary
  is fixed or answered with evidence, then resolved. Late review bots get
  `feedback.wait`, and a point still raised after two rounds stops the run.
  On a re-publish it also runs before review. Details:
  [`feedback.md`](skills/publish/references/feedback.md).

## Declare the gate

Put `.publish.yaml` at the repository root:

```yaml
version: 1

forge: github
base: main

review:
  rules:
    - AGENTS.md

gate:
  - name: lint
    run: just lint
    fix: just fmt
  - name: test
    run:
      - cargo nextest run --all
      - cargo test --doc
    instructions: "The sqlite tests share one port, so a bind failure means an earlier run is still up. Stop it and re-run."

ci:
  required: true
  timeout: 30m

feedback:
  wait: 15m
```

| key | required | meaning |
| --- | --- | --- |
| `version` | yes | `1`. |
| `forge` | no | `github` or `gitlab`. Default: matched from the origin remote's host. |
| `base` | no | Branch to rebase onto and target. Default: the remote's default branch. |
| `review.rules` | no | Extra files the review must read. |
| `gate` | yes | Ordered list of steps, run in the order written. |
| `gate[].name` | yes | The step's name in the final report. Free text. |
| `gate[].run` | yes | One command, or a list run in order, from the repository root. |
| `gate[].fix` | no | Applies the mechanical fixes, once, before a re-run. |
| `gate[].instructions` | no | Text handed, as written, to whoever runs, reads or fixes the step. |
| `ci.required` | no | Default `true`. `false` declares the repository has no CI. |
| `ci.timeout` | no | Default `30m`. |
| `feedback.wait` | no | Default `15m`. How long to keep reading feedback after CI is green. |

`gate: []` declares no mechanical gate and records `not-applicable`. With no
`.publish.yaml`, the skill looks in `AGENTS.md`, `CLAUDE.md` or
`CONTRIBUTING.md`, then a task runner's check target, then the package
manifest's scripts, and reports the source as `discovered:<file>`. If none
yields commands, the gate is `skipped` and the verdict is `blocked`. Full
contract: [`gate.md`](skills/publish/references/gate.md).

## Reference

| file | what it holds |
| --- | --- |
| [`SKILL.md`](skills/publish/SKILL.md) | the skill an agent loads: every phase and the report |
| [`gate.md`](skills/publish/references/gate.md) | the declaration, its keys and the discovery order |
| [`review.md`](skills/publish/references/review.md) | the review method, its passes and rounds |
| [`forge.md`](skills/publish/references/forge.md) | the five forge operations, for `gh` and `glab` |
| [`feedback.md`](skills/publish/references/feedback.md) | the feedback ledger, review bots, the wait and the round cap |
| [`infra-plan.md`](skills/publish/references/infra-plan.md) | the infrastructure plan review: evidence, counts, comment |
| [`change-request-body.md`](skills/publish/templates/change-request-body.md) | the four-heading body template |
| [`infra-plan-comment.md`](skills/publish/templates/infra-plan-comment.md) | the six-section plan-review template |

`npx skills add` installs `skills/publish/` and nothing else, so everything the
skill relies on lives there.
[`tests/skill-self-contained.test.mjs`](tests/skill-self-contained.test.mjs)
keeps it that way.

## Development

```sh
npm test
```

The suite needs Node 22 or later, `jq` and `glab` on `PATH`. It runs the
documented jq filters against recorded forge responses, and drives the real
`glab` CLI against a local HTTP server, so no forge credentials are used.

CI exposes two stable checks for branch protection on `main`:

- **`All Checks`** needs every other job in
  [`ci.yml`](.github/workflows/ci.yml) and fails if any failed, was cancelled
  or was skipped.
- **`PR Title`** requires a conventional-commit title, because squash merge
  makes it the commit on `main`.

## License

MIT. See [LICENSE](LICENSE).
