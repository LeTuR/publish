# The forge

Loaded by phase 1. Phases 1, 8, 9 and 10 reach the forge only through these
five operations.

| # | operation | used for |
| --- | --- | --- |
| 1 | **default branch** | the base, when the declaration names none |
| 2 | **open or update a change request**, body from a file | phase 8 |
| 3 | **the head commit** the change request would merge | the current-head checks |
| 4 | **watch the pipeline** to a terminal state | phase 9; running is not green |
| 5 | **read and answer the feedback** on a change request | phase 10 |

Say "change request" where the forge does not matter, and the forge's own word
(pull request, merge request) to a user.

## Choosing the adapter

`forge:` in the declaration wins; otherwise match the host of
`git remote get-url origin`. Run the adapter's auth check (`# 0`) before phase
2. An unauthenticated CLI makes the publish `skipped`; do not retry in a loop.

File-valued API fields use `-F body=@<path>` in both CLIs. `-f body=@<path>`
sends the literal string `@<path>`.

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

Operation 5 reads through GraphQL, because REST cannot say whether a thread is
resolved:

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

`reviewThreads` are inline threads with `isResolved`; `latestOpinionatedReviews`
is where each reviewer stands now; `reviews` carry review bodies, bot summaries
among them; `comments` is the conversation. Past 100 of any connection, page
with its `pageInfo` and `after`.

Normalise the response with this filter, then run the ledger in
[`feedback.md`](feedback.md). It drops only empty `COMMENTED` reviews, which are
envelopes for threads already listed.

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

## GitLab, through `glab`

The head is `sha` and the body is `description`. `:fullpath` comes from
`origin`; pass `-R https://<host>/<group>/<project>` when `origin` is not the
project, so a self-hosted instance is asked rather than gitlab.com.

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

`--description` takes a string, so read the file in the command; never shorten
the body to fit.

Operation 5: a thread is a discussion, a comment is a note, and a conversation
comment is a discussion holding one note.

```sh
glab api --paginate 'projects/:fullpath/merge_requests/<number>/discussions' \
  | jq -s add                                                          # 5, one array however it pages
glab api -X POST \
  'projects/:fullpath/merge_requests/<number>/discussions/<discussion-id>/notes' \
  -F body=@<path>                                                      # 5, reply
glab api -X PUT \
  'projects/:fullpath/merge_requests/<number>/discussions/<discussion-id>?resolved=true'
glab mr note <number> --message "<text>"                               # 5, a conversation comment
```

`resolvable` and `resolved` sit on a discussion's first note; `system: true`
notes are GitLab narrating itself. Discussions carry no head, so pass operation
3's as `--arg head <sha>` to this filter, then run the ledger in
[`feedback.md`](feedback.md):

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

A project can forbid squashing (`squash_option: never`). The skill does not
merge, but say so in the change request when the repository assumes squash.

## Any other forge

Stop, and say which forge and which operation is missing. A `git push` plus a
link to a web form is not a change request this skill opened.

A new adapter needs all five operations, including the head as a full commit
sha and a pipeline wait rather than a sample. Without operation 3 the head
cannot be verified; without 4 phase 9, and without 5 phase 10, is always
`skipped`, which blocks. Half of an adapter is worse than none: the missing half
is discovered after the push.
