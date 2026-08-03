# `/understand` — local dev server: launcher and live learner dashboard

Date: 2026-08-03
Status: approved, not yet implemented
Follows: the `/understand` MVP (commit `cad09a0`) and the graph explorer spec
(`2026-08-03-understand-graph-explorer-design.md`)

## Context

Today `/understand` is a Claude Code skill over local markdown. You run it in a terminal, it
writes `learners/<name>/`, and the only way to see the resulting learner model is to open the
files or run `node scripts/map.mjs hiro`.

This adds a zero-dependency local dev server (`pnpm dev`) that does two jobs:

1. **Launch** a session — pick a learner and a topic, get the exact `claude` command.
2. **Watch** the learner model change live while that session runs in the other window.

The session itself still runs in your terminal. That is a deliberate MVP choice, not a
limitation of the tooling — see *Why the session stays in the terminal* below.

### Decisions locked in

| Decision | Choice |
|---|---|
| Where the session runs | Your terminal. The page launches and observes; it does not host the conversation. |
| Dependencies | None. `node:http`, `node:fs`, plain ES modules in the browser. |
| Build step | None. Nothing is bundled or compiled, so there is no `pnpm build`. |
| Package manager | Either. Adding no dependencies means `pnpm dev` works against the existing npm-installed `node_modules` with no lockfile migration. |
| Live updates | `fs.watch` → debounce → SSE ping → browser refetches the whole payload. |
| Server state | None. Every request re-reads from disk. |
| Bind address | `127.0.0.1` only, with an `Origin` check on mutating requests. |
| Graph rendering | Served from the API, not from a generated static file. Supersedes part of the graph explorer spec — see *Amendment* below. |

## Why the session stays in the terminal

Worth recording, because the obvious assumption is wrong and it will come up again.

**The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) works on a Pro/Max subscription with
no API key.** It does not call the API directly; it spawns the `claude` CLI as a subprocess and
inherits whatever credential that binary holds. Verified locally: `claude` 2.1.220 is installed
and `ANTHROPIC_API_KEY` is unset, yet Claude Code runs — on the subscription OAuth credential.

So running the conversation *in the browser* would also work on the subscription today. An API
key, a login, and per-user billing only become necessary when **other people** use a deployed
instance, because a personal subscription cannot cover a stranger's usage. That is a deploy-time
fork, not a design constraint now.

The terminal is the MVP because it is less work and the session already works there — not
because the browser needs auth it cannot get. The seam that must stay swappable is therefore
**who runs the session** (your terminal vs. the server process), which is one module either way.

## Architecture

```
scripts/
  serve.mjs             HTTP + SSE. Thin layer over existing pure functions.
  payload.mjs           buildPayload(root, learner, titles) -> the API body (pure, tested)
  launch.mjs            buildCommand(learner, topic) -> string             (pure, tested)
  graph.mjs             buildGraph(concepts, titles) -> {nodes, edges}     (pure, tested)
web/
  index.html
  app.js
  style.css
vendor/
  cytoscape.min.js      vendored once, committed
```

`serve.mjs` holds no state and contains no logic worth testing on its own. Everything it
returns comes from pure functions that take directory contents and return data. That is the
point of the split: the HTTP layer stays thin enough that testing it would only test `node:http`.

### Reuse, not refactor

`scripts/map.mjs` already exports `loadConcepts`, `titlesFromCache`, and `buildMap` as pure
functions with vitest coverage. The server consumes them unchanged. No edits to `map.mjs`,
`wiki.mjs`, or `frontmatter.mjs` are part of this work.

### Endpoints

| Method | Path | Returns |
|---|---|---|
| `GET` | `/` | `web/index.html` |
| `GET` | `/api/learners` | `{learners: string[]}` — directory names under `learners/` |
| `GET` | `/api/learners/:name` | the full payload (below) |
| `GET` | `/api/learners/:name/events` | SSE stream; emits a bare `change` ping |
| `POST` | `/api/launch` | `{learner, topic}` in; `{command}` out |
| `POST` | `/api/launch/terminal` | same input; spawns a macOS Terminal window |
| `GET` | `/web/*`, `/vendor/*` | static files |

### Payload shape

```json
{
  "learner": "hiro",
  "profile": "<PROFILE.md contents>",
  "concepts": [
    {
      "qid": "Q812535",
      "title": "Bayesian inference",
      "state": "shaky",
      "lastProbed": "2026-08-03",
      "sessions": 1,
      "sections": { "canExplain": [...], "gaps": [...], "confidentlyWrong": [...], "openQuestions": [...] }
    }
  ],
  "map": { "solid": [...], "shaky": [...], "frontier": [...] },
  "graph": { "nodes": [...], "edges": [...] },
  "sessions": [{ "file": "2026-08-03-1930-bayesian-inference.md", "date": "2026-08-03" }]
}
```

`map` comes from `buildMap`. `graph` comes from `buildGraph`. `concepts` carries the evidence
sections — *Can explain unaided*, *Gaps*, *Confidently wrong*, *Open questions raised* — because
those are the substance of the learner model and the reason to look at the page at all. A
concept file whose frontmatter fails to parse is reported as an error entry rather than
crashing the payload; one malformed file must not blank the dashboard.

### Live updates

`fs.watch` on `learners/<name>/` with `recursive: true`, debounced ~150ms, emits an SSE ping.
The browser refetches `/api/learners/:name` in full.

Refetching everything rather than pushing diffs is deliberate. The payload is a handful of small
markdown files, so re-reading is both simpler and impossible to get subtly wrong, and there is
no cache to invalidate. If a learner directory ever grows large enough for this to matter, that
is the moment to reconsider — not before.

`recursive: true` is supported on macOS and Windows. On Linux it is available on Node 20+; if
the server ever needs to run there on an older runtime, fall back to watching
`learners/<name>/concepts/` and `learners/<name>/sessions/` separately.

## The launcher

`buildCommand(learner, topic)` returns:

```
claude "/understand <topic> (learner: <name>)"
```

The learner is stated explicitly in the prompt for every learner, including `hiro`. `SKILL.md`
says *"Default learner is `hiro` unless the user says otherwise"*, so naming it in the prompt is
the supported mechanism — and stating it always, rather than only for non-default learners,
means the page's name field is actually load-bearing and the command is unambiguous when copied
somewhere else.

Two fidelity levels, both in `launch.mjs`:

1. **Copy the command.** A text field and a copy button. Always works.
2. **Open in Terminal.** `osascript` spawns a Terminal window running the command. The button is
   labelled as macOS-only and is hidden when `process.platform !== 'darwin'`.

Keeping both behind one module is what makes the eventual in-browser SDK session a sibling
rather than a rewrite.

### Security

The server binds `127.0.0.1`. That is not sufficient on its own: any webpage open in your
browser can issue a `POST` to `localhost`, so a launch endpoint that executed what it was handed
would be a genuine remote-code-execution hole on your own machine.

Three mitigations, all required:

1. **`Origin` check on every `POST`.** Reject anything whose `Origin` is not the server's own.
2. **No client-supplied commands.** The endpoints accept a learner name and a topic, and
   *construct* the command server-side. The client cannot submit a command to run.
3. **No shell.** The Terminal spawn passes the topic as a separate `argv` element to `osascript`
   via `execFile`, never interpolated into a shell string. The learner name is validated against
   the actual directory listing under `learners/`; anything not in that list is rejected, which
   also forecloses path traversal.

## Sequencing

The graph explorer spec is explicit that the prerequisite fix comes first: *"the graph's central
visual claim is that prerequisites flow into concepts. Building it on the current data would
render a hairball that asserts something false."* That is still true — 28 of 36 recorded
prerequisites are transcluded sidebar links, and a graph view would render them as authoritative.

Rather than block the server on that fix, the work reorders:

| Phase | Work | Depends on |
|---|---|---|
| 1 | Server, launcher, list dashboard (concepts, evidence sections, solid/shaky/frontier, sessions) | nothing |
| 2 | Prerequisite extraction fix — the graph explorer spec's Part 1, unchanged, plus cache and frontmatter regeneration | nothing |
| 3 | Graph view — `graph.mjs`, Cytoscape, the `graph` key in the payload | Phase 2 |

Phase 1 is honest on today's data: `buildMap` computes the frontier from prerequisite and
adjacent lists together and never claims a prerequisite *relationship*, so the list dashboard
displays nothing false. Only the graph asserts direction, which is why only the graph waits.

Until Phase 3 lands, `/api/learners/:name` omits the `graph` key and the page shows no graph
panel. The payload builder treats it as optional rather than returning an empty graph, so the
absence is explicit rather than looking like a learner with no edges.

## Amendment to the graph explorer spec

The graph explorer spec chose vendored Cytoscape with graph data **inlined** into a generated
`learners/<name>/map.html`, because `file://` blocks both `fetch` and ES modules. A server
removes that constraint.

Therefore:

- **`scripts/graph.mjs` is built exactly as specced.** `buildGraph(concepts, titles)` stays pure,
  and keeps its edge deduplication, frontier sizing, and dangling-edge rejection.
- **`scripts/render-map-html.mjs` and the generated `learners/<name>/map.html` are dropped.** The
  dashboard serves the same graph from the API with no generation step, no regenerated file, and
  no gitignore entry.
- **`node scripts/map.mjs <learner> --html` is dropped** along with it. The text map is unchanged.

The cost is losing an offline, shareable, double-click artifact. If that is wanted later it is a
small generator on top of the same `buildGraph`, and nothing in this design forecloses it.

## Testing

| Module | Tests |
|---|---|
| `payload.mjs` | `buildPayload` against fixture learner directories: a populated learner, an empty one, a malformed concept file. |
| `launch.mjs` | `buildCommand` output, including topics containing quotes and shell metacharacters. |
| `graph.mjs` | Per the graph explorer spec — edge dedup, frontier sizing, dangling-edge rejection. Phase 3. |
| `serve.mjs` | None. It is HTTP plumbing over the above; testing it would test `node:http`. |

Existing `map.mjs`, `wiki.mjs`, and `frontmatter.mjs` tests are untouched and must still pass.

## Files to write

**`scripts/serve.mjs`** — `node:http` server. Routes the table above, serves static files with
correct MIME types, holds the SSE client set, owns the `fs.watch` debounce. CLI entry:
`node scripts/serve.mjs [--port 4321]`.

**`scripts/payload.mjs`** — `buildPayload(root, learner, titles)`, where `root` is the repo's
`learners/` directory. Reads `PROFILE.md`,
every concept file, and the sessions listing; runs `buildMap` and (Phase 3) `buildGraph`. Pure
over the filesystem, no HTTP awareness.

**`scripts/launch.mjs`** — `buildCommand(learner, topic)` and `openInTerminal(command)`.

**`scripts/graph.mjs`** — Phase 3, per the graph explorer spec.

**`web/index.html`, `web/app.js`, `web/style.css`** — two panes. Left: learner picker, topic
field, launch controls. Right: the learner model — solid/shaky/frontier, then each concept with
its evidence sections, then recent sessions. `app.js` opens the SSE connection and refetches on
ping.

**`package.json`** — add `"dev": "node scripts/serve.mjs"`. No `build` script.

**`.gitignore`** — no change. Nothing generated is written to disk.

## Verification

1. `pnpm test` — new `payload.mjs` and `launch.mjs` tests pass; existing tests still pass.
2. `pnpm dev` — server starts on `127.0.0.1`, page loads, `hiro` appears in the learner list.
3. The dashboard shows `Bayesian inference` as `shaky`, with its recorded gap about conflating
   likelihood with the probability of the hypothesis.
4. **The live test:** with the page open, launch a session, answer one question, and confirm the
   concept file's state and evidence sections update on screen without a manual reload.
5. Copy button yields a command that runs and starts a real `/understand` session.
6. "Open in Terminal" spawns a window running that command.
7. **Adversarial:** `POST /api/launch` with a forged `Origin` is rejected. A topic containing
   `"; rm -rf /tmp/x; echo "` reaches the skill as literal text and spawns no shell. A learner
   name of `../../etc` is rejected against the directory listing.
8. Hand-corrupt a concept file's frontmatter and confirm the dashboard reports that one file as
   an error while still rendering every other concept.

## Explicitly out of scope

Running the conversation in the browser; any auth, login, or multi-user support; writing to the
learner model from the page (editing stays in markdown and `/understand`, per the graph explorer
spec's read-only decision); deployment beyond `localhost`; and the static `map.html` artifact
dropped above.
