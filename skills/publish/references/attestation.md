# The attestation

Loaded by phase 8. The attestation is the block this skill writes into the
change request body, under its `## Attestation` heading and last. It is a
verdict about one commit, and it is worth exactly as much as its ability to go
stale.

## The marker

```
publish-attestation/v1
```

That exact string. It appears twice in every block - once in the opening HTML
comment, once as the `schema` field - so a consumer can find the block by
grepping the raw body and then parse the JSON it wraps. Do not version it in
place: a `v2` block is a different marker, and consumers configured for `v1`
should stop matching rather than silently read a shape they were not written
for.

## The block

````markdown
<!-- publish-attestation/v1 -->
```json
{
  "schema": "publish-attestation/v1",
  "head_sha": "<full 40-character sha of the pushed head>",
  "base": "<base branch>",
  "base_sha": "<full sha the branch is rebased onto>",
  "repository": "<owner>/<repo>",
  "attested_at": "<UTC ISO-8601, seconds precision>",
  "gate_source": ".publish.yaml",
  "steps": [],
  "verdict": "passed"
}
```
<!-- /publish-attestation -->
````

## The fields

| field | contract |
| --- | --- |
| `schema` | The marker, literally. |
| `head_sha` | Full 40 hex characters, lowercase. The commit at the tip of the pushed branch when the gate finished. **This is the field everything rests on.** |
| `base` | The branch the change request targets. |
| `base_sha` | The commit the branch is rebased onto, so a reader can reconstruct the diff that was reviewed. |
| `repository` | `owner/repo`. |
| `attested_at` | When the block was written, not when the run started. |
| `gate_source` | `.publish.yaml`, or `discovered:<file>`, or `none`. |
| `steps` | One object per step, in the order they ran. |
| `verdict` | `passed` or `blocked`. Nothing else. |

Each step:

```json
{ "name": "test", "status": "passed", "command": "cargo nextest run --all" }
```

- `name` and `status` are required on every step. `status` is one of `passed`,
  `failed`, `skipped`, `not-applicable`.
- `command` on anything the shell ran.
- `reason` is **required** whenever `status` is `skipped` or `failed`, in the
  step's own words. A skip with no reason is the failure mode this whole design
  exists to prevent, so a block containing one is malformed.
- The review step also carries `rounds`, `findings` and `fixed`.
- The review step's `command` is the thurview command that ran, pinned to the
  version it ran at, which is how the block says which reviewer produced the
  findings and at what version:
  `npx --yes thurview@0.17.0 graph impact --base <sha> --head <sha>`. The
  built-in review runs no command of its own, so it carries no `command`, and
  that absence is what says it reviewed alone. There is no field for the
  reviewer: `v1` is the shape below, a new key would be a new shape, and a
  version belongs in the command that carried it anyway.
- The CI step also carries `run_url` and `conclusion`.
- The documentation step is named `documentation`, comes after the gate's
  steps and before CI, and carries nothing beyond `name`, `status` and, when it
  did not pass, `reason`.
- The feedback step is named `feedback`, comes after CI, and carries the same
  three: `name`, `status` and, when it did not pass, `reason` - the count of
  threads still unresolved or review checks still failing.

## The verdict rule

```
verdict = "passed"   if every step is "passed" or "not-applicable"
verdict = "blocked"  otherwise
```

There is no third value and no override. A `skipped` step blocks. A `failed`
step blocks. A pipeline that was still running when you stopped watching is
`skipped`, and it blocks.

## Staleness is the property

An attestation names one commit. If the head is a different commit, the
attestation describes code that is not what would merge, and it authorises
nothing at all - not partially, not provisionally.

```
attested: a1b2c3…   head: a1b2c3…   →  current. The proof is about the code that merges.
attested: a1b2c3…   head: 9f8e7d…   →  stale. Says nothing about 9f8e7d.
no attestation                      →  nothing was proved.
```

They come apart on their own, and one way in particular: the skill opens the
change request, CI goes red, the skill pushes a fix, and now the head is one
commit ahead of the block it wrote a minute ago. **Every push after the
attestation obliges a re-attestation.** Rewrite the whole block for the new
head - with operation 2 of the forge adapter - and never patch `head_sha` on
its own. A `head_sha` typed by hand into a block whose steps ran against an
older commit is worse than no attestation, because it looks like one.

## Verifying it, as a consumer

One command answers the only question worth asking: does the proof in the body
belong to the code that would merge? The command is per forge - it is operation
3 plus the body, and both are in [`forge.md`](forge.md) beside that adapter.
Every adapter's version answers with the same three words:

```
current          the attestation names the head. The proof is about the code that merges.
stale            it names another commit. It says nothing about this one.
no attestation   nothing was proved.
```

`current` is the only answer that authorises anything. `stale` and
`no attestation` are the same answer for a consumer's purposes: this change
request has not been proved.

A consumer that also cares whether the gate was clean - and it should - reads
`verdict` from the same block and requires `passed`. A `blocked` attestation on
the current head is an honest report that the gate did not pass, which is
exactly what it is for.
