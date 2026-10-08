# Feedback

Loaded by phase 10. The forge adapter in [`forge.md`](forge.md) fetches the
feedback and normalises it; this file reads it the same way on every forge,
says what a review bot's summary means, how long to wait for one, and when the
loop stops.

## The ledger

Run operation 5's query, pipe it through your adapter's filter, then through
this one with `jq -c`. Each line it prints is one checklist item:

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
| `thread` | an inline thread; `finding` is thurview's marker on it, if any | `resolved` is `false` |
| `review` | a review that says something; `verdict` is its state | it asks for a change nobody answered |
| `comment` | a conversation comment, a bot's summary among them | it asks something nobody answered |
| `reviewer` on a `review` or `comment` | a bot summary, read below | it is not settled |

Every author counts, **your own account included**: thurview-pr-review posts
its summary and its findings as the same account the forge CLI is logged in
as, which is usually the change request's author. A filter that drops "my own
comments" drops the review that matters most.

## The review bots

**thurview-pr-review** keeps one summary comment and edits it on each push. Its
first line is `<!-- thurview-pr-review {"head":"<sha>","state":"active",...} -->`,
and the ledger turns that into `head`, `current` - whether it has read the
current head - and `state`. Then come the next action (`Next: merge`,
`Next: ... fix the blocking finding`, or `Review ended: ...` once stopped,
merged or closed), `Confidence N/5`, and either `No open findings.` or a table
of them. Each finding is an inline thread whose first comment carries
`<!-- thurview-finding {"id":"<id>","category":"...","severity":"..."} -->`;
the id stays the same when the same finding comes back on a later push.

It is **settled** when it is `current`, its `state` is `active`, it reads
**Confidence 5/5** and **No open findings.** A summary below 5/5, or one that
still lists findings, is open feedback **even when there are no unresolved
threads**: its `Next:` line is the item to work.

**Greptile** keeps one summary comment too, opened by `<!-- greptile_summary -->`.
`<!-- greptile_confidence_score:N -->` is its score, and its
`Last reviewed commit:` link names the head it read, which the ledger turns
into `head` and `current`. Its findings are inline threads, worked like any
other. Its `Greptile Review` check sits beside CI on GitHub.

Any other reviewer, human or bot, is its threads and comments: read every one.

## Waiting for reviewers who come after CI

Review bots post minutes after a push, often after CI has already gone green.
So when CI is green, keep reading the ledger, about once a minute, for up to
`feedback.wait` from the gate declaration (default `15m`), and stop waiting as
soon as both are true:

- every summary on the change request is `current`, and
- no review check is still pending.

A reviewer that has never posted on this change request gives no head to
compare, so on a first publish that is the whole window, once. When the window
closes with a summary still not `current`, the `feedback` step is `skipped`:
name the reviewer and the head it last read. Never report a score that was
given to an older head as the score of this one.

## The loop, and where it stops

Work every open item as phase 10 says: fix it test-first, or reply with the
evidence that it is wrong or already handled; then reply on its thread and
resolve it. A fix goes back through review, the gate, the push and CI, and
then this file's wait starts again for the new head. thurview re-scores the
new head on its own; read its new summary rather than assuming the push
settled it.

Keep going until each bot is settled, or every point it still raises has been
**refuted** with evidence on its thread.

Track each point by what identifies it: a thurview finding by its id, a thread
by its id, a comment by its URL. A round is one push or one reply that answers
it. **Two rounds on the same point** and it is still raised: stop. Do not fix it
a third time and do not argue it a third time. Record the `feedback` step
`failed`, and report the point, its link and both answers. A point answered on
an earlier pass and raised again in a new thread is the same point: reply with a
link to the answer and resolve the new thread.

## What to report

For the final report, read the ledger one last time at the reported head:

- **thurview**: the score, the head it reviewed, and whether that is the
  reported head; or that it never posted.
- **Greptile**: the score and the head it reviewed, the `Greptile Review`
  check's state, or that it never posted.
- **Threads**: how many were resolved after a fix, how many were answered and
  resolved without a code change, and how many are still open, with links.
