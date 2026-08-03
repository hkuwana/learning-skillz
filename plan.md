# `/understand` — a Socratic diagnostic that builds a persistent learner model

## Context

You want a **long-term place to hold learning** — not a course, not a curriculum. The goal is a system that talks with you Socratically, figures out where your understanding is genuinely strong and where it's shaky, and slowly accretes that into a personal knowledge database you own.

The 2025–26 literature points at one specific reason to build it this way:

- LLM tutors routinely **underperform classic intelligent tutoring systems**, sometimes with near-null learning gains. [Borchers & Shou](https://arxiv.org/pdf/2602.01415) stripped learner-context out of tutoring prompts and the LLM's output barely changed — it wasn't using the learner state at all. **The persistent learner model is the product; the chat is just the sensor that fills it.**
- The working frame is **Perception → Orchestration → Elicitation** ([Discerning Minds or Generic Tutors?](https://arxiv.org/html/2508.06583v1)): infer state, choose strategy, *then* ask. Generic Socratic bots jump straight to elicitation and fall back on canned scaffolds.
- Two documented failure modes to design directly against, from the same paper: models are **insensitive to confidently-incorrect answers**, and they **go vague on wrong answers** instead of engaging the error. Both get explicit countermeasures below.
- [Open/transparent learner models](https://www.uni-due.de/imperia/md/content/soco/alatrash_ukde24_final.pdf) beat opaque ones on trust, because the learner can see and contest their own model. Hence: plain markdown, git-versioned, editable by you.
- Free recall *before* exposure is the only clean read on prior state, and is itself the highest-yield study operation ([retrieval practice / desirable difficulties](https://pmc.ncbi.nlm.nih.gov/articles/PMC12292765/)).

**Anti-hallucination is structural, not a prompt instruction.** Every judgment the system makes about your understanding is compared against Wikipedia text that was actually fetched and cached to disk, with its revision ID. If a claim isn't in the cache, the system says so rather than filling it in from parametric memory.

### Decisions locked in

| Decision | Choice |
|---|---|
| Interface | Claude Code skill + local files. No UI to build. |
| Storage | One markdown file per concept, git-versioned, human-editable |
| Grounding | Live Wikipedia/Wikidata API fetch, cached locally with revid; every claim cites a cached snippet |
| Scoring | No numeric mastery. Specific gaps/errors logged as evidence, plus a coarse state label |
| Node identity | One Wikipedia article = one node, anchored by Wikidata QID |
| Session start | You bring the topic |
| Relationship to `/teach` | Fully standalone — own directory, own formats |
| Learner namespace | Paths run through a learner name (`learners/hiro/…`), so it's multi-learner from day one |
| End of session | Updated files + terse terminal map: solid / shaky / frontier |

### Assumption flagged
The learner directory is **committed to git** — the version history becomes the record of how your understanding evolved over time, which is genuinely valuable. If you'd rather keep it private, add `learners/` to `.gitignore`; nothing else changes.

## Verified facts (checked live against the API during planning)

These drove the design and are worth not re-deriving:

- **One call gets everything.** `action=query&prop=extracts|pageprops&ppprop=wikibase_item&explaintext=1` returns full plaintext + QID. `Bayesian inference` → `Q812535`. Confirmed working.
- **`prop=links` is useless for relevance.** It returns 500 links in *alphabetical* order — `Abraham Wald`, `Actuarial science`, `Akaike information criterion`… pure navbox noise. Do not use it for the concept graph.
- **Two good neighbor sources instead:**
  - `action=parse&prop=links&section=0` → 49 lead-section links = what the definition itself depends on (**prerequisites**): `Bayes' theorem`, `Conjugate prior`, `Credible interval`, `Cromwell's rule`…
  - `list=search&srsearch=morelike:<title>` → conceptually adjacent articles (**frontier**): `Marginal likelihood`, `Likelihood function`, `Posterior predictive distribution`, `Conjugate prior`…
- **Revision IDs are available** via `prop=revisions&rvprop=ids` — required for cache staleness checks.
- Lead-section links include some junk (`Engineering`, `Evidence`, `Information`, `Bayesian Analysis (journal)`) that needs light filtering.
- **No `.claude/` directory exists yet** — it must be created. The repo's existing skills live in `.agents/skills/` (a different tooling convention); this skill goes in `.claude/skills/` so `/understand` is invocable in Claude Code.

## Prior art in this repo — read before writing

`.agents/skills/teach/` is a stateful learning workspace and is **deliberately not being reused**, per your decision. But read it once for vocabulary, don't import its machinery:

- `.agents/skills/teach/SKILL.md` — has a good **fluency strength vs storage strength** distinction. Reuse the framing (in-the-moment retrieval ≠ long-term retention); ignore everything about lessons, missions, and HTML output.
- `.agents/skills/teach/LEARNING-RECORD-FORMAT.md` — its **supersession** idea is worth stealing: when understanding is corrected, mark the old entry superseded rather than deleting it. The history of how you were wrong is signal.
- `.agents/skills/grilling/SKILL.md` — already encodes the interaction discipline this skill needs: *"Ask the questions one at a time… Asking multiple questions at once is bewildering"* and *"If a fact can be found by exploring the environment, look it up rather than asking me."* Both rules carry over verbatim.

## Architecture

```
.claude/skills/understand/
  SKILL.md                    # the loop, the rules, the discipline
  CONCEPT-FORMAT.md           # concept file spec
scripts/
  wiki.mjs                    # fetch + cache + neighbors  (deterministic, tested)
  map.mjs                     # read concept frontmatter -> solid/shaky/frontier
  wiki.test.mjs
  map.test.mjs
cache/wikipedia/
  Q812535.md                  # shared across learners: it's just Wikipedia
learners/hiro/
  PROFILE.md                  # who, why, standing preferences for how to be probed
  concepts/
    Q812535--bayesian-inference.md
  sessions/
    2026-08-03-1930-bayesian-inference.md
```

The split matters: **`cache/` is shared truth, `learners/<name>/` is a personal overlay on it.** Concept files are named by QID so they survive Wikipedia article renames.

### Concept file format

```md
---
qid: Q812535
title: Bayesian inference
url: https://en.wikipedia.org/wiki/Bayesian_inference
state: shaky              # solid | shaky | shallow | untested
first_probed: 2026-08-03
last_probed: 2026-08-03
sessions: 1
source_revid: 1364298666
prerequisites: [Q5163, Q1128838]
adjacent: [Q1194438, Q622733]
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

Three sections carry the weight. **`Confidently wrong`** is a first-class section precisely because that's the documented blind spot in LLM tutors — making it a slot in the file forces the model to look for it. **`Open questions raised`** captures what *you* asked, which is often a sharper signal of your frontier than anything you answered.

## The loop

1. **Resolve.** You name a topic. Search Wikipedia, show candidate articles, you confirm which one. Get the QID.
2. **Ground.** Fetch extract + prerequisites + adjacent, cache to `cache/wikipedia/<QID>.md` with revid and fetch date. Re-fetch if the cache is stale or the revid moved.
3. **Perceive — before asking anything.** Read the existing concept file for this QID, plus its prerequisite and adjacent nodes. Enter the conversation already knowing what you've shown before. *This step is what the research says LLM tutors skip.*
4. **Free recall first.** Open with "explain this as you currently understand it" — **before** showing any article text. This is the only uncontaminated read on prior state, and it's the highest-value retrieval-practice move.
5. **Elicit, one question at a time.** Never batch questions. Aim each question at the specific boundary between what the concept file says is solid and what isn't.
6. **Compare against the cache, not memory.** Every judgment quotes the cached snippet it's based on. If the cache doesn't cover it: fetch the relevant section, or say "the article doesn't address this" — never fill the gap from parametric knowledge.
7. **Engage errors, don't soften them.** On a wrong answer, do not go vague or hedge. Ask the question that makes the contradiction visible to you. On a *confidently* wrong answer, flag the confidence itself — that mismatch is the highest-value thing the system can find.
8. **Record.** Append evidence to the concept file. Update `state`. Supersede corrected entries instead of deleting.
9. **Map.** Print solid / shaky / frontier.

## Files to write

**`scripts/wiki.mjs`** — the grounding layer. Pure functions over `fetch`, so it's testable:
- `search(query)` → candidate `{title, snippet, pageid}[]`
- `fetchConcept(title)` → `{qid, title, url, revid, extract}` (single API call, `prop=extracts|pageprops|revisions`)
- `prerequisites(title)` → lead-section links via `action=parse&section=0`, filtered
- `adjacent(title)` → `morelike:` search results
- `ensureCached(title)` → writes `cache/wikipedia/<QID>.md`, skips if fresh and revid unchanged
- CLI entry: `node scripts/wiki.mjs fetch "Bayesian inference"`

**`scripts/map.mjs`** — reads all `learners/<name>/concepts/*.md` frontmatter and prints three groups. Frontier = QIDs listed in some concept's `adjacent`/`prerequisites` that have **no concept file yet**. Computed entirely from cached data — no model call needed, so it's instant and free.

**`.claude/skills/understand/SKILL.md`** — the loop above, the one-question-at-a-time rule, and the hard grounding rules from step 6/7.

**`.claude/skills/understand/CONCEPT-FORMAT.md`** — the format spec, including when to promote `state` and how supersession works.

**`learners/hiro/PROFILE.md`** — seeded in the first session.

Both scripts get vitest tests (`fetch` mocked, using real captured API payloads as fixtures). The repo already has vitest configured with `npm test` / `npm run test:watch`, and its stated purpose is fast feedback loops — so TDD these two modules, they're small and pure.

## Explicitly out of scope for tonight

Cut so the MVP actually lands: numeric mastery scores / BKT, spaced-repetition scheduling, Wikidata embedding MCP, HTML graph visualisation, lesson generation, and any integration with `/teach`. The concept-file format leaves room for all of them later — `state` can become a distribution, `last_probed` is already the field a scheduler would read.

## Verification

1. `npm test` — wiki.mjs and map.mjs unit tests pass against fixture payloads.
2. `node scripts/wiki.mjs fetch "Bayesian inference"` → creates `cache/wikipedia/Q812535.md` containing the extract, revid `1364298666`-or-later, and non-empty prerequisite/adjacent lists.
3. Run it twice — second run must skip the network (cache hit).
4. **End-to-end, the real test:** run `/understand Bayesian inference` in Claude Code. Confirm it (a) asks you to explain it *before* showing any article text, (b) asks exactly one question at a time, (c) cites a cached snippet when it says you got something wrong, (d) writes `learners/hiro/concepts/Q812535--bayesian-inference.md`.
5. `node scripts/map.mjs hiro` → prints solid / shaky / frontier, with frontier containing adjacent QIDs that have no concept file.
6. **Adversarial check:** ask it something Wikipedia's article genuinely doesn't cover. It must say the source doesn't address it rather than answering from memory. This is the whole anti-hallucination premise — if it fails here, the grounding is decorative.
7. Second session on a neighbouring concept (e.g. `Conjugate prior`) — confirm it reads the existing Bayesian inference file first and references what you already showed.
