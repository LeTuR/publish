# Infrastructure plan review

Loaded in phase 3 when infrastructure is affected, completed after phase 9 and
verified again before Reporting. Invoking publish authorizes posting and
updating this review comment. It never authorizes apply, deploy, state writes
or merge, and repository precedence (phase 0) still wins.

## Scope

Read the repository rules, the branch diff and the actual plan/apply workflows
together: Terraform/OpenTofu, Terragrunt units, Pulumi previews, CloudFormation
change sets or other declared tooling. Include infrastructure subdirectories in
mixed repositories, shared modules, variables, provider and lockfile changes,
and workflow changes that affect the plan. A filename neither proves nor rules
out impact. No infrastructure impact: `infra-plan` is `not-applicable`, with no
comment.

Before fetching plans, list every expected scope from the workflow's selection
rules, including downstream units of a shared module. For each, record the
unit or directory, environment or workspace, backend identity (redacted if
sensitive), tool and checked version, command and flags, variable provenance
(never values), and any dependency or target restriction on coverage. Uncertain
selection is a coverage gap, not permission to keep only the successful jobs.

## Evidence

Use the repository's declared read-only preview command or CI plan job, through
operation 4 ([forge commands](#forge-commands)). Inspect the command and
workflow first: a job called "plan" can still mutate state or run apply hooks.

- Never apply, deploy, import into live state, run refresh or other
  state-writing commands, or merge to get evidence. Reading remote objects
  during a plan is fine; persisting refreshed state is not.
- Never trigger a pipeline that also deploys. No safe declared preview: record
  the gap and stop the step.
- Use the pinned tools already there; never install a guessed version.

For every selected plan, read the actual output or artifact, not a green check
or an old bot comment. Record the full current head, its commit link, run or
pipeline and job links, scope, timestamp and artifact provenance.

- Verify the run's source SHA and the artifact's checkout. A synthetic merge SHA
  needs verified head/base ancestry and its exact checkout; an artifact reused
  from another run or head is stale.
- A local preview must run on the clean checked head with the same declared
  inputs. Link the commit and relevant workflow or job, and say it was local,
  not that job's artifact. No run or job: say so; never invent links.
- Terraform/OpenTofu detailed exit code 2 means changes, not failure. A
  successful job alone does not establish a complete plan.

Missing, partial, deferred, failed, inaccessible or stale evidence leaves that
scope unreviewed. Never substitute an old-head plan or present a subset as the
whole change. Still post or update the comment, naming the gaps. Bound fetching
and reruns by `ci.timeout`; evidence that cannot be obtained safely is
`skipped` (`failed` for a failed preview), and either blocks.

## Count

Use the tool's real semantics. For Terraform/OpenTofu saved-plan JSON:

- `resource_changes[].change.importing` counts imports, independent of actions
  (an import can also update in place).
- Additions are exactly `["create"]`, changes `["update"]`, destructions
  `["delete"]`; a replacement is `["delete","create"]` or `["create","delete"]`
  and counts once, not also as an addition and destruction.
- Exclude data reads and output changes. Imports overlap actions, so never sum
  the five as unique resources. A quoted CLI headline is labelled separately:
  its adds and destroys include replacements.
- Unknown action semantics give counts labelled unavailable, never zeroes.

This optional filter reads a locally assembled envelope, not arbitrary CI JSON:
`head` from operation 3, `expected_scopes` from the workflow, and `plans`, each
with `scope`, verified source `head`, `status` (`success` only for a successful
preview), `complete` (coverage verified independently, including older tools
with no JSON flag), `run`, `job`, `provenance` and `plan` (saved-plan JSON). A
missing link is a gap here; describe genuinely local evidence by hand. It gives
counts and gaps only - no safety, drift, apply-status or redaction judgement.
Review its output before posting.

```jq
def recognized:
  . == ["no-op"] or . == ["create"] or . == ["update"] or
  . == ["delete"] or . == ["delete", "create"] or
  . == ["create", "delete"];
def replacement: . == ["delete", "create"] or . == ["create", "delete"];
def nonempty: type == "string" and length > 0;
. as $e
| [$e.expected_scopes[] as $scope
   | [$e.plans[] | select(.scope == $scope)] as $found
   | ($found[0] // {}) as $p
   | [($p.plan.resource_changes // [])[] | select(.mode == "managed")] as $changes
   | (if ($found | length) == 0 then "missing plan"
      elif ($found | length) != 1 then "multiple plans; select the verified current rerun"
      elif ($e.head | test("^[0-9a-f]{40}$") | not) or $p.head != $e.head then "stale or unverified head"
      elif $p.status != "success" then "failed or unfinished preview"
      elif $p.complete != true or $p.plan.complete == false or
           (($p.plan.deferred_changes // []) | length) > 0 or $p.plan.errored == true
        then "partial or deferred plan"
      elif ([$p.run, $p.job, $p.provenance] | all(nonempty) | not) then "missing provenance or links"
      elif ($p.plan.format_version // "" | startswith("1.") | not) or
           (($p.plan.resource_changes | type) != "array" and
            (($p.plan | has("resource_changes")) or ($p.plan.planned_values | type) != "object"))
        then "unsupported or missing plan JSON"
      elif ([$p.plan.resource_changes[]? | .mode == "managed" or .mode == "data"] | all | not)
        then "unsupported resource mode"
      elif ([$changes[].change.actions | recognized] | all | not) then "unsupported actions"
      else null end) as $reason
   | {scope: $scope, available: ($reason == null), reason: $reason,
      counts: (if $reason != null then null else {
        imports: ([$changes[] | select(.change.importing != null)] | length),
        additions: ([$changes[] | select(.change.actions == ["create"])] | length),
        changes: ([$changes[] | select(.change.actions == ["update"])] | length),
        destructions: ([$changes[] | select(.change.actions == ["delete"])] | length),
        replacements: ([$changes[] | select(.change.actions | replacement)] | length)
      } end),
      destructive: (if $reason != null then [] else
        [$changes[] | select(.change.actions | index("delete"))
         | {address, actions: .change.actions}] end)}]
| {available: (length > 0 and all(.available)), scopes: .}
```

Check the repository's tool version and output schema first
([Terraform's plan representation](https://developer.hashicorp.com/terraform/internals/json-format));
OpenTofu and others can differ. With text-only evidence, inspect resource
actions, not just the summary, and label unavailable counts. Pulumi and change
sets use their own operation names and replacement semantics.

Keep per-scope counts and coverage visible. Aggregate only verified, disjoint
scopes with the same counting semantics; never add duplicate reruns or
overlapping states. Mixed tools, overlapping ownership or unknown units get
separate summaries with the gap named, and a partial subtotal names the scopes
it excludes. A whole-change assessment needs every expected scope, no-op units
included.

## Write

Fill [the six-section template](../templates/infra-plan-comment.md): its level-two
headings, in order. Short paragraphs; bullets only for several risks or limits.
Evidence links, scope and provenance go in Counts. Remove instruction comments
and placeholders. Repository voice and signature rules apply, signature last.
No attestation or hidden marker.

- **Safety:** an assessment with a concrete reason and conditions - never "safe"
  because the job is green or nothing is deleted. Weigh import ownership, blast
  radius, dependencies, in-place and destructive changes, unknown values,
  policy checks and plan/apply differences. Missing evidence: "Not assessable",
  with the gaps. A destructive plan needs explicit risks and safeguards.
- **Destroyed or replaced:** each resource and its evidenced implications (data
  loss, interruption, ordering, dependencies). "None" covers inspected scopes
  only.
- **Drift not caused by this change:** separate observed drift with evidence of
  unrelated cause from suspected and unchecked drift. A `resource_drift` entry
  proves drift exists, not that this change did not cause it; attribute it from
  an inspected baseline. Do not query production beyond the read-only preview to
  fill this.
- **What the plan cannot tell you:** targeted or partial coverage, unknown or
  deferred values, provider apply-time validation, external or database drift,
  concurrent changes, shared ownership and dependencies. Version-specific
  claims only when checked against the locked version and current documentation.
- **Not applied:** verified status with evidence, or "Apply status unverified;
  this preview performed no apply." Read the apply triggers, approval and merge
  policy and available apply history, including reruns and other branches. A
  plan cannot prove nobody applied; say merge triggers apply only when the
  workflow confirms it, and "no apply recorded" only within the history checked.

Redact secrets, import IDs, sensitive identifiers and addresses, and plan values
before saving the body: Terraform show JSON prints sensitive values in plain
text. Publish only action names, safe resource labels, counts, evidence links
and conclusions - never raw JSON, state, variable values or full logs. Keep raw
files private, untracked and uncommitted, and never link a sensitive artifact
publicly.

## Post and verify

One review comment per change request, updated on re-publish or rerun. Read
every page of comments (excluding GitLab system notes), normalise to
`{actor, comments, body}` (GitHub `author.login` or REST `user.login` as
`author`; GitLab `author.username`), with REST comment or note IDs, and select
the comment with this filter. It matches only the authenticated author's comment
with the six headings, never a maintainer's or bot's similar review:

```jq
def author: if (.author | type) == "string" then .author else
  (.author.login // .author.username) end;
def review:
  [scan("(?m)^## (.+)$") | .[0]] == ["Safety", "Counts", "Destroyed or replaced",
    "Drift not caused by this change", "What the plan cannot tell you", "Not applied"];
. as $e
| [.comments[] | select(author == $e.actor) | select(.body | review)]
| if length > 1 then error("multiple plan review comments; resolve ambiguity before writing")
  else {id: (.[0].id // null)} end
```

A null ID means create; otherwise edit that exact comment. After a timeout,
re-read before retrying so no duplicate appears. Never overwrite or delete
another account's comment; several matches are resolved before writing, never by
adding another.

Read operation 3 immediately before posting and again after reading the saved
comment back; both must equal the full reviewed head. Verify the saved body's
author, six sections, full current head, scopes, provenance and links - the
write API's response proves nothing. A changed head invalidates the review:
fetch new plans. Repeat this check before Reporting, including newer reruns.

Record `infra-plan`: `passed` only with complete current evidence, a supported
assessment and the saved current-head review verified. Honestly reviewed
destructive actions do not fail it; unresolved blocking risks do. Gaps and
write or read failures are `skipped` or `failed`, block the verdict, and are
reported with the comment URL and unreviewed scopes. `ci.required: false` does
not waive this step.

## Forge commands

Infrastructure forms of operations 4 and 5, not another publishing path. Prefer an installed forge wrapper
for what it supports; use the authenticated CLI for API features it lacks.
`-F body=@<path>` sends the file; `-f` would send the literal `@<path>`.

### GitHub

```sh
gh run list --commit <head> --json databaseId,headSha,status,conclusion,url # 4
gh run view <run-id> --json headSha,jobs,url                             # 4
gh run view <run-id> --job <job-id> --log                                # 4
gh run download <run-id> --name <plan-artifact> --dir <private-dir>       # 4
gh api user --jq .login                                                 # 5, authenticated author
gh api --paginate 'repos/{owner}/{repo}/issues/<number>/comments' | jq -s add # 5, all pages
gh api -X POST 'repos/{owner}/{repo}/issues/<number>/comments' -F body=@<path> # 5, create
gh api -X PATCH 'repos/{owner}/{repo}/issues/comments/<comment-id>' -F body=@<path> # 5, update
gh api 'repos/{owner}/{repo}/issues/comments/<comment-id>'                # 5, read back
```

Page the run list if the relevant run is missing. Check source SHA, checkout
and artifact provenance even for a green run, and download artifacts only into
private, untracked storage. The
[comment endpoints](https://docs.github.com/en/rest/issues/comments) never edit
the pull request body.

### GitLab

```sh
glab api 'projects/:fullpath/merge_requests/<number>/pipelines'           # 4
glab api 'projects/:fullpath/pipelines/<pipeline-id>'                     # 4, SHA and URL
glab api --paginate 'projects/:fullpath/pipelines/<pipeline-id>/jobs?include_retried=true' # 4
glab ci trace <job-id>                                                  # 4, plan log
glab api user | jq -er '.username | select(type == "string" and length > 0)' # 5, authenticated author
glab api --paginate 'projects/:fullpath/merge_requests/<number>/notes' | jq -s add # 5, all pages
glab api -X POST 'projects/:fullpath/merge_requests/<number>/notes' -F body=@<path> # 5, create
glab api -X PUT 'projects/:fullpath/merge_requests/<number>/notes/<note-id>' -F body=@<path> # 5, update
glab api 'projects/:fullpath/merge_requests/<number>/notes/<note-id>'     # 5, read back
```

Use the newest verified current-head preview job, including retried jobs and
child or downstream pipelines the workflow selects; page pipeline listings when
needed. When logs lack evidence, download the declared artifact with the
repository's authenticated mechanism. Merged-result pipelines need their actual
checkout inspected; their SHA need not be the source SHA. Update with the
[notes API](https://docs.gitlab.com/api/notes/)'s PUT rather than a new
`mr note` per rerun. If the author lookup fails (missing or empty username),
stop before selecting or writing. Pass `-R` on self-hosted GitLab as in the
main adapter.
