# `/understand` — prerequisite fix, graph explorer, and observability

Date: 2026-08-03
Status: approved, not yet implemented
Follows: the `/understand` MVP (commit `cad09a0`)

## Context

The MVP shipped and produced its first real session: `learners/hiro/concepts/Q812535--bayesian-inference.md`.
That file exposed a defect in the grounding layer and made the case for two additions.

Three pieces of work, in this order:

1. **Fix prerequisite extraction.** 28 of 36 recorded "prerequisites" are not prerequisites.
2. **Add a read-only graph explorer** at `learners/<name>/map.html`.
3. **Make the fragile heuristics observable**, so the next failure of this kind is visible.

They are ordered deliberately: the graph's central visual claim is that prerequisites flow
into concepts. Building it on the current data would render a hairball that asserts
something false.

## Part 1 — Prerequisite extraction

### The defect

`prerequisites()` calls `action=parse&prop=links&section=0`. Section 0 of a rendered
Wikipedia article includes **transcluded templates**, and `Bayesian inference` transcludes
the `Template:Bayesian statistics` sidebar. Its links are returned as lead-section links.

Measured on `Bayesian inference` (revid 1364298666):

| Source | Count |
|---|---|
| Currently recorded as `prerequisites` | 36 |
| Of those, originating in the transcluded sidebar | 28 |
| Links in actual lead **prose** | 21 |
| Prose links surviving the existing filters | **9** |

The nine: `Bayes' theorem`, `Statistical inference`, `Prior probability`,
`Posterior probability`, `Bayesian probability`, `Statistics`, `Mathematical statistics`,
`Decision theory`, `Sequential analysis`.

This escaped planning because the sidebar is *topically coherent* — it is a curated list of
Bayesian topics, so spot-checked samples (`Conjugate prior`, `Credible interval`,
`Cromwell's rule`) looked like plausible prerequisites. They are related concepts, not
upstream ones. Some are strictly downstream: `Nested sampling algorithm` is a method that
*uses* Bayesian inference.

### The fix

Switch to `action=parse&prop=text&section=0` — same single request — and extract links from
the prose only:

1. Partition the HTML into **prose** and **furniture** rather than discarding furniture:
   `<table>` blocks (sidebars, infoboxes, navboxes), `<style>`, and elements classed
   `hatnote`, `metadata`, `reflist`, or `reference`.
   Tables nest, so the split must strip **innermost-first, repeatedly, until no `<table>`
   remains**. A single non-greedy `<table>[\s\S]*?</table>` pass leaves outer-table content
   behind and must not be used.
   Both halves are kept: links found only in furniture are reported as dropped with reason
   `table`, which is what makes the defect visible (Part 3, Tier 1). Discarding furniture
   outright would fix the data and hide the reason.
2. Collect `href="/wiki/..."` targets from each half. Percent-decode and convert `_` to
   space. Red links point at `/w/index.php?...&redlink=1`; they are excluded by this
   pattern and are **not** reported as dropped, since they are not article links at all.
3. Drop titles whose prefix before `:` is a known MediaWiki namespace (`Template`, `Help`,
   `Portal`, `Category`, `File`, `Wikipedia`, `Talk`, and the `… talk` variants). Match
   against that list rather than "contains a colon" — article titles may legitimately
   contain one.
4. Apply the existing filters: `REFERENCE_WORKS`, `BROAD_TOPICS`, `NOISE_PATTERNS`.

Two exported functions, so each is testable alone:

- `extractLeadLinks(html)` → `{prose: string[], furniture: string[]}` — steps 1–2, pure.
- `filterLeadLinks(...)` — steps 3–4, keeping its current role. Its **return type changes**
  from `string[]` to `{kept, dropped}` (Part 3, Tier 1); callers and its existing tests are
  updated accordingly.

### Consequence for existing data

`cache/wikipedia/Q812535.md` and the saved concept file both carry the wrong list. Both are
regenerated after the fix. The concept file's **evidence sections are preserved verbatim** —
only `prerequisites` in its frontmatter is rewritten. That evidence was gathered in a real
session and is not derivable again.

## Part 2 — Graph explorer

Read-only. Editing the learner model stays in markdown and `/understand`. An editing surface
needs a local server and a write API; that is a later, deliberate decision, not MVP
scaffolding.

### Structure

```
scripts/graph.mjs             buildGraph(concepts, titles) -> {nodes, edges}   pure
scripts/render-map-html.mjs   renderMapHtml(graph, meta)   -> HTML string      pure
vendor/cytoscape.min.js       vendored once, committed
learners/<name>/map.html      generated, gitignored
```

`node scripts/map.mjs <learner>` prints the text map as today. `--html` additionally writes
`map.html`. Both stay dependency-free, offline, and instant.

Shaping is separated from rendering because the logic lives in the shaping — edge
deduplication, frontier sizing, dangling-edge rejection — and it is testable without a DOM.
The renderer stays a dumb template.

### Why Cytoscape.js

Drag, zoom, box-select, state-based styling and layout switching come built in, as do the
two layouts this needs — `breadthfirst` for prerequisite hierarchy and `cose` for organic
clustering. No extensions, so no dependency tree.

Vendored rather than inlined because `learners/` is committed: inlining ~400KB into a
regenerated file would put a 400KB diff in history on every refresh. Vendored, it lands
once and `map.html` diffs stay readable. `map.html` references it as
`<script src="../../vendor/cytoscape.min.js">` — a classic script tag, which loads over
`file://`. ES modules and `fetch` do not, which is why the graph data is inlined rather
than fetched from a sibling JSON file.

### Data model

Nodes — one per concept file, plus one per frontier QID:

```js
{ id: 'Q812535', label: 'Bayesian inference', state: 'shaky',
  url, lastProbed, sections: { Gaps: [...], 'Open questions raised': [...] } }

{ id: 'Q45284', label: 'Likelihood function', state: 'frontier', references: 3 }
```

Edges:

```js
{ id: 'Q182505->Q812535', source: 'Q182505', target: 'Q812535', kind: 'prerequisite' }
{ id: 'Q45284--Q812535',  source: 'Q45284',  target: 'Q812535', kind: 'adjacent' }
```

Prerequisites are directed, prerequisite → concept, so the graph reads "this feeds into
that". Adjacency is symmetric, so its edge ids are canonical sorted pairs; otherwise A↔B
renders twice. Self-edges are dropped. Edges to QIDs that are not nodes are dropped and
counted (see Part 3).

### Change to existing code

`loadConcepts` returns frontmatter only. The side panel needs the recorded gaps, so it gains
a `sections` field: the file body split on `##` headings into `{heading: [lines]}`.
`buildMap` and `formatMap` are unaffected.

### Visual encoding

State carries the strongest signal. `solid` and `shaky` get filled colour; `shallow` and
`untested` get muted fills; `frontier` gets a dashed outline and no fill — visibly "not
yours yet". Frontier nodes scale with how many of your concepts reference them, so the
obvious next thing to study is the largest unfilled circle.

That encoding is weak at one concept, where every frontier node has a reference count of 1.
This is expected and self-correcting: the graph earns its keep from roughly the third
concept on.

Prerequisite edges are solid with an arrowhead; adjacency edges are dashed with none.

### Interaction

Drag, zoom, pan and box-select come from the library. On top of it:

- layout toggle: `breadthfirst` (hierarchy) / `cose` (clusters)
- state filter checkboxes, including hide-frontier
- search box highlighting matching labels
- click a node → side panel: state, last probed, Wikipedia link, and the concept file's
  sections, with `~~superseded~~` entries struck through

A minimal inline-markdown renderer covers `**bold**`, `~~strike~~` and `` `code` `` — the
subset `CONCEPT-FORMAT.md` actually uses. Not a general markdown implementation.

## Part 3 — Observability

The lead-link filter failed silently for a full session. Every heuristic here has that
property, so drop decisions become **data** rather than a side effect.

### Tier 1 — dropped links recorded in the cache file (always on)

`filterLeadLinks` returns `{kept, dropped: [{title, reason}]}` instead of a bare array.
Reasons are a closed set, each produced at exactly one stage:

| Reason | Produced by |
|---|---|
| `table` | link appeared only in furniture, not prose (`extractLeadLinks`) |
| `namespace` | `filterLeadLinks` step 3 |
| `broad-topic`, `reference-work`, `noise-pattern` | `filterLeadLinks` step 4 |
| `no-qid` | `resolveQids` — survived filtering but has no Wikidata item |

`prerequisites()` merges the `no-qid` drops into the same list before writing, so the cache
file carries one complete account of everything the lead offered and why each was rejected.

The cache file gains a section:

```md
## Dropped from lead links

- [table] Conjugate prior
- [broad-topic] Engineering
- [reference-work] Merriam-Webster
```

No flag required, permanently auditable, and it diffs in git. This is the tier that would
have surfaced the current defect immediately: 28 entries reading `[table]` is not subtle.

### Tier 2 — `--debug` trace to stderr

Every API URL with its duration; stage counts for the extraction pipeline (raw → after
furniture removal → after namespace → after filters); QID resolution misses; the cache
decision (`hit` / `miss` / `stale` / `unchanged`) with the comparison that produced it.

stderr, so `--debug` never corrupts the text map on stdout.

### Tier 3 — `--debug` also writes a run log

Same records, appended as JSONL to `.debug/<ISO-timestamp>-<command>.jsonl`. `.debug/` is
gitignored. This is the "look at it later" surface.

### Tier 4 — `map.html?debug`

A panel showing node and edge counts by kind, dropped dangling edges with their reasons, and
the raw graph JSON. Off unless the query string is present.

## Testing

Unit tests, vitest, real captured API payloads as fixtures.

**Extraction** — a captured `prop=text&section=0` payload for `Bayesian inference` is the
fixture. Assert the nine expected prerequisites exactly; assert every sidebar-only title is
absent; assert nested tables are fully removed; assert namespace and red-link exclusion;
assert `dropped` reasons are correct and exhaustive.

**Graph** — prerequisite edges directed; adjacency deduped to one canonical edge; self-edges
dropped; edges to unknown QIDs dropped and counted; frontier nodes present and sized by
reference count; a QID listed as both prerequisite and adjacent by one concept counts once.

**Render** — graph data is embedded; `</script>` and `<!--` in a concept title are escaped
rather than breaking the document; the vendor path is correct relative to the output file;
`?debug` content is present but inert by default.

**Stated limit:** these verify the HTML's *structure*, not that the graph renders. There is
no jsdom and no browser harness. Confirmation that it draws is opening the file — this will
be reported as a manual step, not implied as covered.

## Out of scope

Editing from the browser; a local server; spaced repetition; numeric mastery; capturing the
sidebar cluster as a third relation type (it overlaps heavily with `morelike` adjacency);
multi-learner comparison views; any change to the `/understand` conversational loop.

## Verification

1. `npm test` — all green, including the new extraction, graph and render tests.
2. `node scripts/wiki.mjs fetch "Bayesian inference"` after cache deletion → cache file
   records exactly the nine prerequisites, and a `## Dropped from lead links` section whose
   `[table]` entries include `Conjugate prior` and `Nested sampling algorithm`.
3. The saved concept file's frontmatter carries the nine; its evidence sections are
   byte-identical to the session output.
4. `node scripts/map.mjs hiro` → text map unchanged in form.
5. `node scripts/map.mjs hiro --html` → writes `learners/hiro/map.html`.
6. **Manual:** open `map.html` from disk with no server and no network. One filled `shaky`
   node, ~20 dashed frontier nodes, both layouts work, clicking the concept shows its
   recorded gaps with superseded entries struck through.
7. `node scripts/map.mjs hiro --html --debug` → stderr trace, and a JSONL file under
   `.debug/`.
8. `map.html?debug` → panel with counts and raw JSON.
