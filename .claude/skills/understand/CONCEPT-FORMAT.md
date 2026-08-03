# Concept file format

One file per concept, at `learners/<name>/concepts/<QID>--<slug>.md`.

Named by QID because Wikipedia renames articles and Wikidata items are stable. The slug
is there so the directory is readable by a human; if the article is renamed, change the
slug and leave the QID alone.

## Template

```md
---
qid: Q812535
title: Bayesian inference
url: https://en.wikipedia.org/wiki/Bayesian_inference
state: shaky
first_probed: 2026-08-03
last_probed: 2026-08-03
sessions: 1
source_revid: 1364298666
prerequisites: [Q182505, Q3711784]
adjacent: [Q6760420, Q45284]
---

## Can explain unaided
- Stated the prior → likelihood → posterior update in his own words, before any exposure. (2026-08-03)

## Gaps
- **Conflated likelihood with the probability of the hypothesis.** Said "the likelihood is how likely the hypothesis is."
  Source: "the likelihood function … the probability of the evidence given the hypothesis" — `cache/wikipedia/Q812535.md` (revid 1364298666)  (2026-08-03)

## Confidently wrong
- (empty — but this section is why the file exists)

## Open questions raised
- Why doesn't the prior wash out with small samples?
```

Frontmatter is flat `key: value` plus inline `[a, b]` lists — that's all `scripts/frontmatter.mjs`
parses, and keeping it that simple is what keeps the files hand-editable.

## Frontmatter fields

| Field | Meaning |
|---|---|
| `qid` | Wikidata item. The identity of the node. Never changes. |
| `title` | Article title at last fetch. |
| `url` | Convenience link. |
| `state` | `solid` \| `shaky` \| `shallow` \| `untested`. See below. |
| `first_probed` / `last_probed` | ISO dates. `last_probed` is the field a scheduler would read later. |
| `sessions` | Count of sessions that touched this concept. |
| `source_revid` | Revision the evidence was judged against. If the cache's revid has moved past this, the citations may no longer match the live article. |
| `prerequisites` | QIDs from the cache's lead-section links. |
| `adjacent` | QIDs from the cache's `morelike:` neighbours. |

`prerequisites` and `adjacent` are copied from `cache/wikipedia/<QID>.md`. They're what
`scripts/map.mjs` reads to compute the frontier, so keep them in sync when the cache is
refreshed.

## The four states

There is deliberately no numeric score. A number invites false precision about something
that was measured in one conversation, and it hides the evidence. The specific gaps in
the body are the real model; `state` is only a coarse handle for sorting.

- **`untested`** — the file exists (usually created as a prerequisite stub) but nothing
  has been probed.
- **`shallow`** — they can produce the definition, but it hasn't been pushed on. Recall
  without application.
- **`shaky`** — probed, and at least one real gap or error is recorded. **This is the
  default outcome of a first session.** Assume `shaky` unless you have evidence for
  `solid`.
- **`solid`** — explained unaided, *before* seeing article text, and held up under at
  least one question aimed at the boundary.

### Promotion rules

Promote to `solid` only when all of these hold:

1. The explanation was unaided and preceded any exposure to the article in that session.
2. It survived a question aimed at the edge of the concept, not the centre.
3. There is no unsuperseded entry under `## Gaps` or `## Confidently wrong`.

Being led to the right answer is not promotion. Agreeing with a correction is not
promotion. Getting it right immediately after reading the extract is fluency, not
storage — leave it at `shallow`.

Demote freely. If a later session shows a gap in something marked `solid`, drop it to
`shaky` and record why. Demotion is the system working.

## The four sections

**`## Can explain unaided`** — positive evidence, with the date. Note whether it came
before or after exposure; that distinction is the whole value of the entry.

**`## Gaps`** — what they couldn't do or got wrong. Every entry needs:
- what specifically went wrong, in their own words where possible;
- the cached snippet it contradicts, with file path and revid;
- the date.

**`## Confidently wrong`** — a subset of gaps, promoted to its own section on purpose.
Use it when the answer was stated flatly, without hedging, and was wrong. This section is
first-class because models are documented to be insensitive to confidently-incorrect
answers — giving it a slot forces the question "was this hedged?" to be asked every time.
An empty section is fine and normal; leaving the heading in place is the point.

**`## Open questions raised`** — questions *they* asked, unanswered or answered. What
someone chooses to ask about locates their frontier better than what they manage to
answer.

## Supersession

When a later session corrects an earlier entry, do not delete it. Mark it:

```md
## Gaps
- ~~**Conflated likelihood with the probability of the hypothesis.**~~ (2026-08-03)
  Superseded 2026-09-12: distinguished them unprompted and gave a worked example.
```

The history of how someone was wrong predicts where they'll stumble on related concepts.
Deleting it throws away the most useful thing in the file. It's also why the directory is
in git — the diff over time *is* the record of how understanding changed.

## Prerequisite stubs

When probing surfaces a prerequisite the user clearly hasn't met, you may create a stub:
frontmatter with `state: untested` and empty sections. Only do this for prerequisites that
actually came up in the session. Don't pre-create the whole prerequisite list — an
inbox of 40 untested stubs makes the map useless.
