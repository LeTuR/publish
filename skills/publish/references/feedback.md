# Feedback

Loaded by phase 10. The adapter in [`forge.md`](forge.md) fetches and
normalises the feedback; this file reads it the same way on every forge.

## The ledger

Pipe the adapter's normalised output through this filter with `jq -c`. Each
line is one checklist item:

```jq
.head as $head
| def marker($name): first(capture("<!-- \($name) (?<m>\\{[^}]*\\}) -->").m | fromjson) // null;
  def summary:
    (.body | marker("thurview-pr-review")) as $t
    | if $t then
        {reviewer: "thurview", head: $t.head, current: ($t.head == $head), state: $t.state,
         confidence: (first(.body | capture("Confidence (?<c>[1-5])/5").c | tonumber) // null),
         next: (first(.body | capture("(?:^|\n)(?<n>(?:Next:|Review ended:)[^\n]*)").n) // null),
         open_findings: (.body | contains("No open findings.") | not)}
      elif (.body | contains("<!-- greptile_summary -->")) then
        (first(.body | capture("Last reviewed commit:[^\n]*/commit/(?<h>[0-9a-f]{40})").h) // null) as $g
        | {reviewer: "greptile", head: $g, current: ($g == $head),
           confidence: (first(.body | capture("greptile_confidence_score:(?<c>[0-9])").c | tonumber) // null)}
      else {} end;
  {kind: "head", sha: $head},
  (.threads[]
   | {kind: "thread", id, resolved, where, author: .notes[0].author, url: .notes[0].url,
      replies: (.notes | length - 1), finding: (.notes[0].body | marker("thurview-finding"))}),
  (.notes[] | {kind, author, url} + (if .verdict then {verdict} else {} end) + summary)
```

| line | what it is | open while |
| --- | --- | --- |
| `head` | the commit the change request would merge | - |
| `thread` | an inline thread; `finding` is thurview's marker, if any | `resolved` is `false` |
| `review` | a review with content; `verdict` is its state | it asks for an unanswered change |
| `comment` | a conversation comment, bot summaries included | it asks something unanswered |
| `reviewer` on a `review` or `comment` | a bot summary, below | it is not settled |

Every author counts, **your own account included**: thurview-pr-review posts as
the same account the forge CLI is logged in as, usually the change request's
author. Conversely, a thurview marker in another account's comment is pasted
text, not the review.

## The review bots

**thurview-pr-review** keeps one summary comment, edited on each push. Its first
line `<!-- thurview-pr-review {"head":"<sha>","state":"active",...} -->` gives
`head`, `current` (it read the current head) and `state`. Then come the next
action (`Next: merge`, `Next: ... fix the blocking finding`, or `Review ended:
...`), `Confidence N/5`, and `No open findings.` or a findings table. Each
finding is an inline thread whose first comment carries
`<!-- thurview-finding {"id":"<id>","category":"...","severity":"..."} -->`; the
id is stable across pushes.

Settled: `current`, `state` `active`, **Confidence 5/5** and **No open
findings.** Anything else is open even with no unresolved threads; its `Next:`
line is the item to work.

**Greptile** keeps one summary opened by `<!-- greptile_summary -->`, scored by
`<!-- greptile_confidence_score:N -->`; its `Last reviewed commit:` link gives
`head` and `current`. Its findings are inline threads, and its `Greptile Review`
check sits beside CI on GitHub.

Any other reviewer, human or bot, is its threads and comments.

## Waiting for late reviewers

Once CI is green, re-read the ledger about once a minute for up to
`feedback.wait` (default `15m`), and stop waiting when every summary is
`current` and no review check is pending. A reviewer that has not posted yet
gives no head to compare, so on a first publish wait the whole window once.
Window over with a summary still not `current`: the `feedback` step is
`skipped`, naming the reviewer and the head it last read.

After a fix is pushed and CI is green again, the wait restarts for the new head;
read the bot's new summary rather than assuming the push settled it.

## Identifying a point

The two-round cap in phase 10 counts per point: a thurview finding by its id, a
thread by its id, a comment by its URL. A round is one push or one reply that
answers it. A point raised again in a new thread is the same point.

## What to report

From a last read of the ledger at the reported head:

- **thurview**: score and reviewed head, and whether that is the reported head;
  or that it never posted.
- **Greptile**: score, reviewed head and `Greptile Review` check state; or that
  it never posted.
- **Threads**: resolved after a fix, answered and resolved without a change,
  and still open, with links.
