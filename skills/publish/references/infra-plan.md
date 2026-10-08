# Infrastructure plan review

Loaded in phase 3 for infrastructure changes; completed after phase 9 and
verified again before Reporting. Publishing authorizes posting and updating this
review automatically. Repository precedence still wins. This is a preview
review, never authorization to apply or merge.

## Recognize and obtain evidence

Read repository rules, the branch diff, and actual plan/apply workflows together.
Look for Terraform/OpenTofu, Terragrunt units, Pulumi previews, CloudFormation
change sets, or other declared infrastructure tooling. Include infrastructure
subdirectories in mixed application repositories, shared modules, variables,
provider/lockfile changes and workflow changes affecting the plan. A filename
alone neither proves nor rules out infrastructure impact. Determine all affected
units, environments and workspaces from the workflow's selection rules. An
application-only change with no infrastructure impact records `infra-plan` as
`not-applicable`; it adds no comment and changes no existing publish behavior.

Maintain an explicit list of expected scopes before fetching plans. Record each
scope's directory/unit, environment/workspace, backend identity (redacted if
sensitive), tool and checked version, command/flags, variables' provenance
(without values), and whether dependencies or targeting restrict coverage.
Include affected downstream units for a shared module. Uncertain selection is a
coverage gap, not permission to choose only the successful jobs.

Use the repository's declared read-only preview command or CI plan job, through
operation 4 of the [forge adapter](forge.md). Inspect the command and workflow
before running or triggering it: a job called "plan" can still mutate state or
run apply hooks. Never apply, deploy, import into live state, run refresh/write
state commands, or merge to obtain evidence. Reading remote objects during a
plan is acceptable; persisting refreshed state is not. Do not trigger a pipeline
that also deploys. If no safe declared preview exists, record the gap and stop
that step. Use existing pinned tools; do not install a guessed version.

For every selected plan, read the actual output/artifact, not just its green
check or an old bot comment. Record the current full PR/MR head, commit link,
run/pipeline and job links, scope, timestamp and provenance of the artifact.
Verify the run's source SHA and the artifact's input checkout: a synthetic merge
SHA needs verified head/base ancestry and its exact checkout identified; a reused
artifact from another run or head is stale. Local previews must run on the clean
checked head with identical declared inputs; link the current commit and the
relevant workflow/job, explicitly saying that the preview was local and not that
job's artifact. If no run or job exists, say so; do not invent links. Inspect
plan exit semantics: Terraform/OpenTofu detailed exit code 2 means changes, not
a failed plan. CI job success alone does not establish a complete plan.

Missing, partial, deferred, failed, inaccessible or stale evidence makes that
scope unreviewed. Never replace a missing current plan with an old-head plan,
and never turn a subset into a clean whole-change verdict. Post/update the same
comment with explicit gaps even when evidence is unavailable. Bound fetching and
reruns by `ci.timeout`; if evidence cannot be obtained safely, report `skipped`
(or `failed` for a failed preview), which blocks publish success.

## Inspect and count

Use the tool's actual semantics. For Terraform/OpenTofu saved-plan JSON,
`resource_changes[].change.importing` counts imports independently of actions;
imports can also have in-place updates. Additions are exactly `["create"]`,
changes `["update"]`, destructions `["delete"]`, and replacements either
`["delete","create"]` or `["create","delete"]`. Count a replacement once,
not again as an addition and destruction. Exclude data reads and output changes
from managed-resource counts. Imports overlap action counts: never sum these
five numbers as a unique-resource total. If quoting the CLI headline, label it
separately: its adds/destroys can include replacement operations. Unknown action
semantics require explicit unavailable counts, not guessed zeroes.

The following optional jq filter is for a locally assembled evidence envelope,
not arbitrary CI JSON. Set `head` from operation 3, `expected_scopes` from the
workflow, and `plans` from inspected evidence. Each plan has `scope`, verified
source `head`, `status` (`success` only when preview succeeded), `complete`
(coverage verified independently, including older tools without a JSON flag),
`run`, `job`, `provenance`, and `plan` (the saved-plan JSON). A missing link is a
gap for this filter; describe genuinely local evidence manually instead. This
filter produces counts and evidence gaps; it does **not** assess safety, drift
causality, apply status, or redact addresses. Review its output before posting.

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

See the tool's checked JSON format, including
[Terraform's plan representation](https://developer.hashicorp.com/terraform/internals/json-format).
OpenTofu and equivalent tools can differ: check the repository's version and
output schema before using this filter. With text-only evidence, inspect the
resource actions as well as the summary; unavailable import/replacement counts
are labelled unavailable. Pulumi or change-set counts use their native operation
names and replacement semantics, rather than forcing Terraform arithmetic.

Keep per-scope counts and coverage visible. Aggregate only verified, disjoint
scopes with the same counting semantics. Never add duplicate reruns or
overlapping states/workspaces together. Mixed tools, overlapping ownership, or
unknown units get separate summaries with an explicit coverage gap; partial
subtotals must say which scopes they exclude. A whole-change safety assessment
requires every expected scope, even a unit whose selected plan is a no-op.

## Write the review

Fill [the one six-section template](../templates/infra-plan-comment.md). Keep
exactly those headings in order, at level two. Use short paragraphs, bullets
only for multiple risks or limitations. Put evidence links and scope/provenance
in Counts; remove instruction comments and placeholders. Repository voice and
signature rules still apply, with the signature last. No attestation or hidden
marker is needed.

Safety states an assessment with a concrete reason and conditions, not merely
"safe" because the job is green or counts contain no deletes. Review imports'
ownership, blast radius, dependencies, in-place changes, destructive actions,
unknown values, policy checks and plan/apply differences. Missing evidence means
"Not assessable" with the named gaps. A destructive plan needs explicit risks
and safeguards, never a clean verdict by default.

Destroyed or replaced names each action's resource and implications (data loss,
service interruption, ordering, dependencies) supported by evidence. "None"
means none in the inspected scopes, not none in missing ones.

Drift not caused by this change separates observed drift with evidence of
unrelated causality from suspected drift and drift not checked. A
`resource_drift` entry shows observed drift; it does not prove the PR did not
cause it. Use an inspected baseline or other evidence to attribute it. Do not
query production systems beyond the permitted read-only preview just to fill a
section. "None observed in this plan" does not mean all systems were checked.

What the plan cannot tell you names material limits: targeted/partial coverage,
unknown or deferred values, provider apply-time validation, external/database
drift, concurrent changes, shared ownership and dependencies. Make only
version-specific claims checked against the repository's locked version and
current authoritative documentation; never copy project facts from an example.

Not applied reports verified status and its evidence, or "Apply status
unverified; this preview performed no apply." Read repository apply triggers,
manual approval/merge policy and available apply/deployment history, including
reruns and other branches. A plan cannot prove nobody applied. Say merge
triggers apply only if the workflow confirms it; say no apply was recorded only
within the checked scope and history window. This skill never applies anything.

Redact secrets, import IDs, sensitive identifiers/addresses and plan values
before saving a publishable body. Terraform show JSON exposes sensitive values
in plain text: flags are not a sanitizer. Allow only relevant action names,
safe resource labels, counts, evidence links and reviewed conclusions. Never
post raw JSON, state, variable values or full logs/artifacts. Keep local raw
files private and out of commits; do not publish links granting public access
to sensitive artifacts.

## Post, update and verify

Use operations 4 and 5's infrastructure forms in the
[forge adapter](forge.md). One review comment per PR/MR, updated on re-publish or
rerun; use the authenticated author's existing comment with the six headings,
not a maintainer's or bot's similar review. Query all pages. Select it with the
following jq filter after assembling `{actor, comments, body}`. GitHub comments
have `author.login` (or REST `user.login`, normalize to `author`); GitLab notes
have `author.username`. IDs must be the REST comment/note IDs for the write API.

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

A null ID means create; otherwise edit that exact comment. If a request times
out, re-read comments before retrying to avoid duplicates. Never overwrite
another account's review. Multiple matching comments require resolving ownership
and duplicates without deleting others' comments; do not create another.

Read operation 3 immediately before posting and after reading the saved comment.
Both heads must equal the full reviewed head. Read the saved body through
operation 5 and verify author, six sections, full current head, scope/provenance
and evidence links match the intended review. If the head changed, invalidate
the assessment and obtain new plans; an older comment is not verification.
Before Reporting repeat that check, including newer rerun evidence. Never infer
success just from the write API's response.

Record `infra-plan`: `passed` only with complete current evidence, a supported
assessment, and the saved current-head review verified. Destructive actions
alone do not make the step fail if honestly reviewed; unresolved blocking risks
do. Gaps or write/read failures are `skipped`/`failed`, block the verdict, and
must be named in the final report with the comment URL and unreviewed scopes.
`ci.required: false` does not waive this conditional review step.
