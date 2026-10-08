# The forge

Loaded by phase 1. The gate is the same everywhere; only four phases
touch a forge, and they touch it through five operations. This file is the
adapter table.

## The five operations

Everything phases 1, 8, 9 and 10 need, and nothing else:

| # | operation | why the skill needs it |
| --- | --- | --- |
| 1 | **default branch** | what to rebase onto and target, when the declaration does not say |
| 2 | **open or update a change request**, body from a file | phase 8; human-facing intent, change, risk and testing |
| 3 | **the head commit** the change request would merge | verify the checked commit is still current |
| 4 | **watch the pipeline** to a terminal state | phase 9; a pipeline still running is not a green one |
| 5 | **read and answer the feedback** on a change request | phase 10; a thread nobody answered is not a published change |

A change request is a pull request on GitHub and a merge request on GitLab. The
skill says "change request" where the difference does not matter and uses the
forge's own word when talking to a user.

## Choosing the adapter

`forge:` in the gate declaration wins. Otherwise read the remote:

```sh
git remote get-url origin
```

Match the host, and confirm the CLI is authenticated before phase 2 rather than
discovering it at phase 8, after the branch is already pushed. An
unauthenticated CLI is a `skipped` publish, not a retry loop.

## GitHub, through `gh`

```sh
gh auth status                                                  # 0
gh repo view --json defaultBranchRef -q .defaultBranchRef.name  # 1
gh pr create --base <base> --title "<title>" --body-file <path> # 2
gh pr edit <number> --body-file <path>                          # 2, existing
gh pr view <number> --json headRefOid -q .headRefOid            # 3
gh pr checks <number> --watch --fail-fast                       # 4
gh run view <run-id> --log-failed                               # 4, reading a red job
gh pr checks <number>                                           # 5, the review checks too
```

Operation 5 is one query and three ways of answering it. The query is GraphQL,
because REST cannot say whether a thread is resolved:

```sh
gh api graphql -F owner='{owner}' -F repo='{repo}' -F number=<number> -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        headRefOid
        reviewThreads(first: 100) {
          nodes { id isResolved isOutdated path line
                  comments(first: 100) { nodes { author { login } body url } } } }
        latestOpinionatedReviews(first: 100) {
          nodes { author { login } state body url } }
        reviews(first: 100) { nodes { author { login } state body url } }
        comments(first: 100) { nodes { author { login } body url } } } } }'
```

`reviewThreads` is every inline thread with its replies and its `isResolved`.
`latestOpinionatedReviews` is where each reviewer stands now - what a required
review check reads. `reviews` carries the review bodies, a bot's summary among
them, and `comments` is the conversation below the change request. Past a
hundred of any of them, page with that connection's `pageInfo` and `after`.

Pipe the response through this filter, then through the ledger in
[`feedback.md`](feedback.md). It keeps every thread and comment, and every
review that says something: a review with an empty body that only commented is
the envelope its inline threads came in, and those threads are already listed.

```jq
.data.repository.pullRequest
| {head: .headRefOid,
   threads: [.reviewThreads.nodes[]
     | {id, resolved: .isResolved,
        where: (.path + (if .line then ":\(.line)" else "" end)),
        notes: [.comments.nodes[] | {author: .author.login, body, url}]}],
   notes: ([.reviews.nodes[]
             | select(.body != "" or .state != "COMMENTED")
             | {kind: "review", verdict: .state, author: .author.login, body, url}]
           + [.comments.nodes[] | {kind: "comment", author: .author.login, body, url}])}
```

```sh
gh api graphql -F thread=<thread-id> -F body=@<path> -f query='
  mutation($thread: ID!, $body: String!) {
    addPullRequestReviewThreadReply(
      input: {pullRequestReviewThreadId: $thread, body: $body}) {
      comment { url } } }'                                      # 5, reply on a thread
gh api graphql -F thread=<thread-id> -f query='
  mutation($thread: ID!) {
    resolveReviewThread(input: {threadId: $thread}) {
      thread { isResolved } } }'                                # 5, resolve it
gh pr comment <number> --body-file <path>                       # 5, answer a conversation comment
```

`-F body=@<path>` reads the reply out of a file. `-f body=@<path>` posts the
literal string `@<path>` instead, so write the reply to a file and pass it
with `-F`.

## GitLab, through `glab`

Same five operations, GitLab's own field names: the head is `sha`, the body is
`description`. `-R` takes the project's full URL so that a self-hosted instance
is asked and not gitlab.com.

```sh
glab auth status                                                       # 0
glab repo view -F json --jq .default_branch                            # 1
glab mr create --target-branch <base> --title "<title>" \
  --description "$(cat <path>)"                                        # 2
glab mr update <number> --description "$(cat <path>)"                  # 2, existing
glab mr view <number> -F json --jq .sha                                # 3
glab ci status --branch <branch> --live                                # 4
glab ci trace <job-id>                                                 # 4, reading a red job
```

Operation 5, in GitLab's own words: a thread is a discussion, a comment is a
note, and a conversation comment is a discussion holding one note.

```sh
glab api --paginate 'projects/:fullpath/merge_requests/<number>/discussions' \
  | jq -s add                                                          # 5, one array however it pages
glab api -X POST \
  'projects/:fullpath/merge_requests/<number>/discussions/<discussion-id>/notes' \
  -f body=@<path>                                                      # 5, reply
glab api -X PUT \
  'projects/:fullpath/merge_requests/<number>/discussions/<discussion-id>?resolved=true'
glab mr note <number> --message "<text>"                               # 5, a conversation comment
```

`resolvable` and `resolved` sit on the discussion's first note, and a note with
`system: true` is GitLab narrating itself - a label added, a branch pushed -
rather than a reviewer. The discussions do not carry the head, so pass it in
from operation 3 as `--arg head <sha>` to this filter, then pipe the result
through the ledger in [`feedback.md`](feedback.md):

```jq
[.[] | .notes |= map(select(.system | not)) | select(.notes != [])]
| {head: $head,
   threads: [.[] | select(.individual_note | not)
     | .notes[0].position as $at
     | {id, resolved: (.notes[0].resolved // false),
        where: (($at.new_path // "") + (if $at.new_line then ":\($at.new_line)" else "" end)),
        notes: [.notes[] | {author: .author.username, body, url: "#note_\(.id)"}]}],
   notes: [.[] | select(.individual_note) | .notes[0]
     | {kind: "comment", author: .author.username, body, url: "#note_\(.id)"}]}
```

`:fullpath` is filled in from `origin`; pass
`-R https://<host>/<group>/<project>` when `origin` is not the project to read.

Two differences that change behaviour rather than spelling:

- **Squash.** A GitLab project can forbid squashing (`squash_option: never`).
  The skill does not merge, so this is not its problem to solve, but say it in
  the change request if the repository's own convention assumes a squash.
- **`--description` takes a string, not a file.** Read the file in the command,
  as above. Do not shorten the body to fit an argument you found awkward.

## Infrastructure forms of operations 4 and 5

For the conditional [infrastructure review](infra-plan.md), operation 4 also
reads plan evidence and operation 5 creates or edits one conversation comment.
These are forms of the existing operations, not another publishing path.
Prefer an installed forge wrapper for operations it supports (for example
`gh-axi`); use the underlying authenticated CLI for API features it lacks.

### GitHub

```sh
gh run list --commit <head> --json databaseId,headSha,status,conclusion,url # 4
gh run view <run-id> --json headSha,jobs,url                             # 4
gh run view <run-id> --job <job-id> --log                                # 4
gh run download <run-id> --name <plan-artifact> --dir <private-dir>       # 4
gh api user --jq .login                                                 # 5, authenticated author
gh api --paginate 'repos/{owner}/{repo}/issues/<number>/comments'         # 5, all pages
gh api -X POST 'repos/{owner}/{repo}/issues/<number>/comments' -F body=@<path> # 5, create
gh api -X PATCH 'repos/{owner}/{repo}/issues/comments/<comment-id>' -F body=@<path> # 5, update
gh api 'repos/{owner}/{repo}/issues/comments/<comment-id>'                # 5, read back
```

Collect every comment page into one array for the selection filter in
`infra-plan.md`; normalize REST `user` to `author`. Use REST numeric IDs, not
GraphQL node IDs. Inspect source SHA, checkout and artifact provenance even if
the run is green. The run list must be paged if the relevant run is not returned.
Only download artifacts into private, untracked storage. These
[comment endpoints](https://docs.github.com/en/rest/issues/comments) preserve
the exact selected comment; they never edit the PR body.

### GitLab

```sh
glab api 'projects/:fullpath/merge_requests/<number>/pipelines'           # 4
glab api 'projects/:fullpath/pipelines/<pipeline-id>'                     # 4, SHA and URL
glab api --paginate 'projects/:fullpath/pipelines/<pipeline-id>/jobs?include_retried=true' # 4
glab ci trace <job-id>                                                  # 4, plan log
glab api user --jq .username                                            # 5, authenticated author
glab api --paginate 'projects/:fullpath/merge_requests/<number>/notes'    # 5, all pages
glab api -X POST 'projects/:fullpath/merge_requests/<number>/notes' -f body=@<path> # 5, create
glab api -X PUT 'projects/:fullpath/merge_requests/<number>/notes/<note-id>' -f body=@<path> # 5, update
glab api 'projects/:fullpath/merge_requests/<number>/notes/<note-id>'     # 5, read back
```

Use the newest verified current-head preview job, including retried jobs and
child/downstream pipelines selected by the workflow. Page pipeline listings
when needed. Download a declared artifact with the repository's authenticated
artifact mechanism when logs lack sufficient evidence. Inspect the actual
checkout for merged-result pipelines; their SHA need not be the MR source SHA.
Collect all note pages, excluding system notes, before selection. Use the
[merge-request notes API](https://docs.gitlab.com/api/notes/), whose update is
PUT, rather than a new `mr note` on every rerun. File-valued fields use `-f` in
glab and `-F` in gh. Pass `-R` for the origin project on self-hosted GitLab as
in the main adapter.

Both adapters read operation 3 before and after the saved review readback;
head changes invalidate the review and require fresh evidence.

## Any other forge

Stop, and say which forge and which operation is missing. Do not improvise: a
`git push` and a link to a web form is not a change request the skill opened,
and nothing downstream can verify a body nobody wrote.

Adding a forge means giving all five operations, with a way to read the head as
a full commit sha and a way to wait for a pipeline rather than sample it. A
forge that cannot do operation 3 cannot verify the checked head, a forge
that cannot do operation 4 makes phase 9 permanently `skipped`, and one that
cannot do operation 5 makes phase 10 permanently `skipped` - and each of those
blocks.
Half of an adapter is worse than none, because the missing half is discovered
after the push.
