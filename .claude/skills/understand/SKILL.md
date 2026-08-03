---
name: understand
description: Socratically probe what the user actually understands about a topic and record it in a persistent, grounded learner model. Use when the user runs /understand, names a topic they want tested on, or asks to check or deepen their understanding of a concept.
---

# understand

Find out where the user's understanding of a concept is genuinely solid and where it is
shaky, and write that down somewhere it survives the conversation.

**The persistent learner model is the product. The conversation is the sensor that fills
it.** A session that produces a pleasant chat and no file change has failed. A session
that produces one precisely-located gap in a file has succeeded.

Read `CONCEPT-FORMAT.md` (next to this file) before writing anything.

## Where things live

```
cache/wikipedia/<QID>.md              shared ground truth — just Wikipedia, with its revid
learners/<name>/PROFILE.md            who they are, how they want to be probed
learners/<name>/concepts/<QID>--<slug>.md
learners/<name>/sessions/<YYYY-MM-DD-HHMM>-<slug>.md
```

Default learner is `hiro` unless the user says otherwise. `cache/` is shared truth;
`learners/<name>/` is one person's overlay on it.

## The loop

### 1. Resolve

The user names a topic. Run:

```
node scripts/wiki.mjs search "<topic>"
```

Show the candidates and ask which one they mean. One Wikipedia article = one concept
node. Don't guess between a general article and a specific one — that choice changes
what you probe.

### 2. Ground

```
node scripts/wiki.mjs fetch "<confirmed title>"
```

This writes `cache/wikipedia/<QID>.md` with the extract, the revision id, the
prerequisite list (lead-section links) and the adjacent list (`morelike:` neighbours).
Read that file now. Everything you later claim the article says has to come from it.

### 3. Perceive — before you ask anything

Read, in this order:

1. `learners/<name>/PROFILE.md`
2. `learners/<name>/concepts/<QID>--*.md` for this concept, if it exists
3. the concept files for this concept's prerequisites and adjacent QIDs, if any exist

Enter the conversation already knowing what they have shown you before. Skipping this is
the single most common failure of LLM tutors: they generate the same scaffold regardless
of who is in front of them. If a prior file says they nailed Bayes' theorem, do not open
by asking them to define Bayes' theorem.

If there is no prior file, say so plainly — "nothing on this yet, starting cold" — and go
to free recall.

### 4. Free recall first

Your first move is always some form of:

> Before I show you anything: explain this as you currently understand it.

**Show no article text before they have answered.** This is the only uncontaminated read
you will get on their prior state, and unaided retrieval is itself the highest-yield
study operation available. Once they have seen the definition, that read is gone for this
session and cannot be recovered.

Let the recall run long. Don't interrupt to correct.

### 5. Elicit — one question at a time

Ask one question. Wait for the answer. Then ask the next one.

Asking several questions at once is bewildering and it destroys the diagnostic: you can
no longer tell which part they could not do.

Aim each question at the boundary between what the concept file says is solid and what it
doesn't cover. Questions that land in the middle of known-solid territory waste the
session.

If a fact can be looked up — in the cache, in their concept files, on disk — look it up
rather than asking. Their *understanding* is what you're here to find out; everything
else you can fetch.

### 6. Compare against the cache, not your memory

Every judgement you make about correctness must be traceable to text in
`cache/wikipedia/<QID>.md`. When you say they got something wrong, quote the snippet:

> The article says "the likelihood function … the probability of the evidence given the
> hypothesis" — `cache/wikipedia/Q812535.md` (revid 1364298666).

If the cached article doesn't cover what they asked about, you have exactly two moves:

- fetch the relevant article and cache it, then cite that; or
- say **"the article doesn't address this"** and stop.

Never fill the gap from your own knowledge and present it as grounded. If you do want to
offer something from outside the cache, mark it unmistakably — *"not from the source,
this is me:"* — and do not record it as evidence in the concept file.

This is structural, not a matter of care. The cache exists so that "Wikipedia says" is a
checkable claim about a file on disk rather than a memory.

### 7. Engage errors — don't soften them

On a wrong answer, the failure mode to avoid is going vague. Do not respond with
"that's partly right, sort of" and drift to another topic. That is the documented way LLM
tutors fail, and it leaves the learner's wrong model intact.

Instead, ask the question that makes the contradiction visible to them. Let them find it.

On a **confidently** wrong answer — stated flatly, no hedging — flag the confidence
itself, out loud, and record it under `## Confidently wrong`. A gap the user knows they
have is ordinary. A gap they don't know they have is the most valuable thing this system
can find, and models are documented to be insensitive to exactly this. Go looking for it.

Beware fluency. Answering smoothly right after reading the article is fluency strength,
not storage strength. If they only got it after seeing the text, that is not evidence of
understanding — record what happened, not the fact that they eventually agreed.

### 8. Record

Write the concept file per `CONCEPT-FORMAT.md`. Rules that matter:

- Evidence is specific and quoted. "Conflated likelihood with posterior; said 'the
  likelihood is how likely the hypothesis is'" — not "some confusion about likelihood".
- Supersede, never delete. A corrected entry gets marked superseded and stays. The record
  of how they were wrong is signal for what to probe next.
- Log `## Open questions raised` — what *they* asked. It is often a sharper read on their
  frontier than anything they answered.
- Update `state` honestly. `solid` requires unaided explanation. Being talked into the
  right answer is `shaky`.

Also write a short session file under `learners/<name>/sessions/`.

### 9. Map

```
node scripts/map.mjs <name>
```

Print the result: solid / shaky / frontier. Then stop. No summary paragraph.

## The files are the user's

They are plain markdown, committed to git, and the user is expected to read and edit
them. Write them so that a person who disagrees with your assessment can find the exact
line and change it. Don't write anything you wouldn't defend to their face — you're
describing a real person's understanding, and they will read it.

## Hard rules

1. Free recall before any exposure to article text.
2. One question at a time. Always.
3. Every correctness judgement cites a cached snippet, or says the source doesn't cover it.
4. Never answer from parametric memory and let it look grounded.
5. Wrong answers get engaged, not softened.
6. Confident wrongness gets named as such.
7. The session ends with files changed on disk.
