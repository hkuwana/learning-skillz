# `/understand` Dev Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A zero-dependency `pnpm dev` server that launches an `/understand` session into your terminal and shows the learner model updating live while that session runs.

**Architecture:** `serve.mjs` is a thin `node:http` layer over pure functions. `payload.mjs` reads a learner directory and returns the API body; `launch.mjs` builds the `claude` command. Live updates are `fs.watch` → debounce → SSE ping → browser refetches the whole payload. The server holds no state; every request re-reads from disk.

**Tech Stack:** Node built-ins only (`node:http`, `node:fs`, `node:child_process`). Plain ES modules in the browser, no bundler. vitest for tests (already configured).

## Global Constraints

- **Zero new dependencies.** Nothing may be added to `package.json` dependencies or devDependencies. This is what lets `pnpm dev` work against the existing npm-installed `node_modules` with no lockfile migration.
- **No build step.** Nothing is bundled or compiled. Do not add a `build` script.
- **ES modules throughout.** `package.json` has `"type": "module"`; use `import`, never `require`.
- **Do not modify** `scripts/map.mjs`, `scripts/wiki.mjs`, or `scripts/frontmatter.mjs`. They are consumed as-is.
- **Bind `127.0.0.1` only.** Never `0.0.0.0`.
- **Default port 4321**, overridable with `--port`.
- **No shell.** Use `execFile`, never `exec` or `spawn` with `shell: true`.
- Existing tests must keep passing: `pnpm test`.

## Scope note

This plan covers **Phase 1 only** — the server, launcher, and list dashboard. That is the independently shippable piece and it is unblocked.

Phases 2 and 3 from the spec (the prerequisite extraction fix, then the graph view) belong to the already-approved `2026-08-03-understand-graph-explorer-design.md` and should get their own plan once Phase 1 lands. Phase 3 depends on Phase 2, and folding all three into one plan would produce a document no reviewer could gate meaningfully.

Consequence for this plan: `buildPayload` returns **no `graph` key**. Its absence is the signal that Phase 3 has not landed, and the UI renders no graph panel.

---

### Task 1: Concept body section parser

Concept files carry their evidence in `##` sections with multi-line bullets. This parses that body into structured data. Generic over headings rather than hardcoding the four current ones, because concept files are hand-editable and `CONCEPT-FORMAT.md` may add sections.

**Files:**
- Create: `scripts/payload.mjs`
- Test: `scripts/payload.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces: `parseSections(body: string) -> { preamble: string, sections: Array<{heading: string, items: string[]}> }`

- [ ] **Step 1: Write the failing test**

```js
// scripts/payload.test.mjs
import { describe, expect, test } from 'vitest';
import { parseSections } from './payload.mjs';

describe('parseSections', () => {
  test('splits a body into its ## sections', () => {
    const { sections } = parseSections('## Gaps\n\n- One\n\n## Confidently wrong\n\n- Two\n');

    expect(sections.map((s) => s.heading)).toEqual(['Gaps', 'Confidently wrong']);
    expect(sections[0].items).toEqual(['One']);
    expect(sections[1].items).toEqual(['Two']);
  });

  test('keeps text before the first heading as the preamble', () => {
    const { preamble, sections } = parseSections('No article text was shown.\n\n## Gaps\n\n- One\n');

    expect(preamble).toBe('No article text was shown.');
    expect(sections).toHaveLength(1);
  });

  test('joins a wrapped bullet into one item', () => {
    const { sections } = parseSections('## Gaps\n\n- **Cannot state it.** Free recall gave\n  "if a given b divided by a".\n');

    expect(sections[0].items).toEqual(['**Cannot state it.** Free recall gave "if a given b divided by a".']);
  });

  test('separates bullets that have a blank line between them', () => {
    const { sections } = parseSections('## Gaps\n\n- First gap\n\n- Second gap\n');

    expect(sections[0].items).toEqual(['First gap', 'Second gap']);
  });

  test('returns an empty items list for a section with no bullets', () => {
    const { sections } = parseSections('## Confidently wrong\n\n(empty — but this section is why the file exists)\n');

    expect(sections[0].items).toEqual([]);
  });

  test('returns no sections and no preamble for an empty body', () => {
    expect(parseSections('')).toEqual({ preamble: '', sections: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run scripts/payload.test.mjs`
Expected: FAIL — cannot resolve `./payload.mjs`

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/payload.mjs
/**
 * Reads one learner's directory into the shape the dashboard renders.
 *
 * Everything here is a pure function of what's on disk. The server holds no state
 * and re-runs this per request, which is affordable because a learner directory is
 * a handful of small markdown files — and it means there is no cache to invalidate
 * when /understand rewrites a concept file mid-session.
 */

/**
 * Split a concept body into its `##` sections, with wrapped bullets rejoined.
 *
 * Generic over headings rather than hardcoding the current four: concept files are
 * hand-editable, so a section this parser doesn't recognise should still render.
 */
export function parseSections(body) {
  const lines = String(body).split('\n');
  const preamble = [];
  const sections = [];

  for (const line of lines) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      sections.push({ heading: heading[1].trim(), items: [] });
      continue;
    }

    if (sections.length === 0) {
      preamble.push(line);
      continue;
    }

    const { items } = sections.at(-1);
    const bullet = /^-\s+(.*)$/.exec(line);

    if (bullet) {
      items.push(bullet[1].trim());
    } else if (line.trim() !== '' && items.length > 0) {
      // A wrapped continuation of the bullet above, not a new one.
      items[items.length - 1] = `${items.at(-1)} ${line.trim()}`;
    }
  }

  return {
    preamble: preamble.join('\n').trim(),
    sections: sections.map(({ heading, items }) => ({ heading, items })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run scripts/payload.test.mjs`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/payload.mjs scripts/payload.test.mjs
git commit -m "feat: parse concept body sections into structured evidence"
```

---

### Task 2: The API payload builder

Reads a whole learner directory — profile, concepts, sessions — and folds in the existing `buildMap`. This is the entire body of `GET /api/learners/:name`.

**Files:**
- Modify: `scripts/payload.mjs`
- Modify: `scripts/payload.test.mjs`

**Interfaces:**
- Consumes: `parseSections` (Task 1); `buildMap` from `./map.mjs`; `parseFrontmatter` from `./frontmatter.mjs`
- Produces:
  - `listLearners(root: string) -> string[]`
  - `buildPayload(root: string, learner: string, titles: Record<string,string>) -> { learner, profile, concepts, map, sessions }`
  - A concept entry is `{ qid, title, state, lastProbed, sessions, url, preamble, sections }`
  - A concept file with no `qid` in frontmatter yields `{ file, error }` in the same array

`root` is the repo's `learners/` directory. `titles` is the output of `titlesFromCache()` from `./map.mjs`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/payload.test.mjs`:

```js
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPayload, listLearners } from './payload.mjs';

const CONCEPT = `---
qid: Q812535
title: Bayesian inference
url: https://en.wikipedia.org/wiki/Bayesian_inference
state: shaky
last_probed: 2026-08-03
sessions: 1
prerequisites: [Q5163]
adjacent: [Q45284]
---

No article text was shown.

## Gaps

- **Cannot state Bayes' theorem.**
`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'learners-'));
  mkdirSync(join(root, 'hiro', 'concepts'), { recursive: true });
  mkdirSync(join(root, 'hiro', 'sessions'), { recursive: true });
  writeFileSync(join(root, 'hiro', 'PROFILE.md'), '# Hiro\n\nProbe hard.\n');
  writeFileSync(join(root, 'hiro', 'concepts', 'Q812535--bayesian-inference.md'), CONCEPT);
  writeFileSync(join(root, 'hiro', 'sessions', '2026-08-03-1930-bayesian-inference.md'), 'notes\n');
  return root;
}

describe('listLearners', () => {
  test('lists learner directories', () => {
    expect(listLearners(fixture())).toEqual(['hiro']);
  });

  test('returns empty when the learners root does not exist', () => {
    expect(listLearners(join(tmpdir(), 'definitely-not-here-9f3a'))).toEqual([]);
  });
});

describe('buildPayload', () => {
  test('reads the profile, concepts and sessions', () => {
    const payload = buildPayload(fixture(), 'hiro', {});

    expect(payload.learner).toBe('hiro');
    expect(payload.profile).toContain('Probe hard.');
    expect(payload.concepts[0].title).toBe('Bayesian inference');
    expect(payload.concepts[0].state).toBe('shaky');
    expect(payload.concepts[0].lastProbed).toBe('2026-08-03');
    expect(payload.sessions).toEqual([{ file: '2026-08-03-1930-bayesian-inference.md', date: '2026-08-03' }]);
  });

  test('carries the evidence sections through', () => {
    const [concept] = buildPayload(fixture(), 'hiro', {}).concepts;

    expect(concept.preamble).toBe('No article text was shown.');
    expect(concept.sections).toEqual([
      { heading: 'Gaps', items: ["**Cannot state Bayes' theorem.**"] },
    ]);
  });

  test('includes the solid/shaky/frontier map', () => {
    const payload = buildPayload(fixture(), 'hiro', { Q45284: 'Likelihood function' });

    expect(payload.map.shaky.map((c) => c.title)).toEqual(['Bayesian inference']);
    expect(payload.map.frontier.map((f) => f.title)).toContain('Likelihood function');
  });

  test('omits the graph key until phase 3 lands', () => {
    expect(buildPayload(fixture(), 'hiro', {})).not.toHaveProperty('graph');
  });

  test('reports a concept file with no qid as an error without dropping the others', () => {
    const root = fixture();
    writeFileSync(join(root, 'hiro', 'concepts', 'broken.md'), 'no frontmatter at all\n');

    const { concepts } = buildPayload(root, 'hiro', {});

    expect(concepts).toHaveLength(2);
    expect(concepts.find((c) => c.error)).toMatchObject({ file: 'broken.md' });
    expect(concepts.find((c) => c.qid === 'Q812535')).toBeDefined();
  });

  test('handles a learner with no concepts or sessions yet', () => {
    const root = mkdtempSync(join(tmpdir(), 'learners-'));
    mkdirSync(join(root, 'newbie'), { recursive: true });

    const payload = buildPayload(root, 'newbie', {});

    expect(payload.concepts).toEqual([]);
    expect(payload.sessions).toEqual([]);
    expect(payload.profile).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run scripts/payload.test.mjs`
Expected: FAIL — `buildPayload is not a function`

- [ ] **Step 3: Write minimal implementation**

Append the functions below to `scripts/payload.mjs`, but **move the four `import` lines to the top of the file**, above the module docstring's `parseSections` — imports belong at the top even though ESM hoists them.

```js
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';
import { buildMap } from './map.mjs';

function readDirSafe(dir) {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function readFileSafe(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

/** Directory names under `learners/`. One per person, per the multi-learner path design. */
export function listLearners(root) {
  return readDirSafe(root).filter((name) => statSync(join(root, name)).isDirectory());
}

function readConcept(dir, file) {
  const { data, body } = parseFrontmatter(readFileSafe(join(dir, file)));

  // parseFrontmatter is total — it never throws, it just returns no data. So a
  // malformed file surfaces as a missing qid, and gets reported rather than
  // silently vanishing: one bad file must not blank the dashboard.
  if (!data.qid) return { file, error: 'no qid in frontmatter' };

  const { preamble, sections } = parseSections(body);

  return {
    file,
    qid: String(data.qid),
    title: data.title ?? String(data.qid),
    url: data.url ?? null,
    state: data.state ?? 'untested',
    lastProbed: data.last_probed ?? null,
    sessions: data.sessions ?? 0,
    prerequisites: data.prerequisites ?? [],
    adjacent: data.adjacent ?? [],
    preamble,
    sections,
  };
}

/**
 * One learner's whole model, as the dashboard renders it.
 *
 * No `graph` key: that arrives with phase 3, and its absence is the signal that
 * the graph view hasn't landed — distinct from a learner who genuinely has no edges.
 */
export function buildPayload(root, learner, titles = {}) {
  const dir = join(root, learner);
  const conceptsDir = join(dir, 'concepts');

  const concepts = readDirSafe(conceptsDir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => readConcept(conceptsDir, name));

  const sessions = readDirSafe(join(dir, 'sessions'))
    .filter((name) => name.endsWith('.md'))
    .reverse()
    .map((file) => ({ file, date: /^(\d{4}-\d{2}-\d{2})/.exec(file)?.[1] ?? null }));

  return {
    learner,
    profile: readFileSafe(join(dir, 'PROFILE.md')).trim(),
    concepts,
    map: buildMap(concepts.filter((c) => !c.error), titles),
    sessions,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run scripts/payload.test.mjs`
Expected: PASS — all tests in the file

- [ ] **Step 5: Confirm nothing else regressed**

Run: `pnpm test`
Expected: PASS — `wiki`, `map`, `frontmatter`, `payload`

- [ ] **Step 6: Commit**

```bash
git add scripts/payload.mjs scripts/payload.test.mjs
git commit -m "feat: build the learner dashboard payload from disk"
```

---

### Task 3: The launcher

Builds the `claude` command, and optionally spawns a macOS Terminal window running it.

The learner is named in the prompt for **every** learner including `hiro`, because `SKILL.md` says *"Default learner is `hiro` unless the user says otherwise"* — naming it is the supported mechanism, and doing it always makes the page's name field load-bearing and the copied command unambiguous.

**Files:**
- Create: `scripts/launch.mjs`
- Test: `scripts/launch.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `buildPrompt(learner: string, topic: string) -> string`
  - `buildCommand(learner: string, topic: string) -> string` — display/copy form only
  - `openInTerminal(prompt: string) -> Promise<void>` — macOS only, throws elsewhere

- [ ] **Step 1: Write the failing test**

```js
// scripts/launch.test.mjs
import { describe, expect, test } from 'vitest';
import { buildCommand, buildPrompt } from './launch.mjs';

describe('buildPrompt', () => {
  test('names the learner and the topic', () => {
    expect(buildPrompt('hiro', 'Bayesian inference')).toBe('/understand Bayesian inference (learner: hiro)');
  });

  test('names the learner even when it is the default', () => {
    expect(buildPrompt('hiro', 'Entropy')).toContain('(learner: hiro)');
  });

  test('collapses newlines in the topic so the prompt stays one line', () => {
    expect(buildPrompt('hiro', 'Bayes\nrule')).toBe('/understand Bayes rule (learner: hiro)');
  });

  test('trims surrounding whitespace from the topic', () => {
    expect(buildPrompt('hiro', '  Entropy  ')).toBe('/understand Entropy (learner: hiro)');
  });

  test('rejects an empty topic', () => {
    expect(() => buildPrompt('hiro', '   ')).toThrow(/topic/i);
  });
});

describe('buildCommand', () => {
  test('wraps the prompt in double quotes for copy-paste', () => {
    expect(buildCommand('hiro', 'Entropy')).toBe('claude "/understand Entropy (learner: hiro)"');
  });

  test('escapes characters that would break out of the quoted string', () => {
    const command = buildCommand('hiro', 'say "hi" $USER `id` \\done');

    expect(command).toBe('claude "/understand say \\"hi\\" \\$USER \\`id\\` \\\\done (learner: hiro)"');
  });

  test('a shell metacharacter topic stays inside the quoted argument', () => {
    const command = buildCommand('hiro', '"; rm -rf /tmp/x; echo "');

    expect(command).not.toMatch(/[^\\]"; rm/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run scripts/launch.test.mjs`
Expected: FAIL — cannot resolve `./launch.mjs`

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/launch.mjs
/**
 * Turns a learner and a topic into a runnable /understand invocation.
 *
 * Two fidelity levels live here on purpose — copy-the-command and spawn-a-Terminal —
 * so that running the session in-process later (via the Agent SDK, which works on a
 * Pro/Max subscription with no API key) is a sibling function rather than a rewrite.
 */

import { execFile } from 'node:child_process';
import { platform } from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * The learner is named for every learner, including the default.
 *
 * SKILL.md resolves the learner from natural language ("Default learner is `hiro`
 * unless the user says otherwise"), so saying it explicitly is the supported route —
 * and saying it always keeps the command unambiguous wherever it gets pasted.
 */
export function buildPrompt(learner, topic) {
  const cleaned = String(topic).replace(/\s+/g, ' ').trim();
  if (cleaned === '') throw new Error('topic is required');

  return `/understand ${cleaned} (learner: ${learner})`;
}

/**
 * Display form, for the copy button. Escaping is for the *user's* shell when they
 * paste it — the Terminal path below never routes through a shell at all.
 */
export function buildCommand(learner, topic) {
  const escaped = buildPrompt(learner, topic).replace(/(["$`\\])/g, '\\$1');
  return `claude "${escaped}"`;
}

/**
 * Spawn a Terminal window running the prompt.
 *
 * The prompt goes to osascript as a separate argv element via execFile, so no shell
 * ever parses it. AppleScript string literals only need `\` and `"` escaped.
 */
export function openInTerminal(prompt) {
  if (platform !== 'darwin') {
    throw new Error('opening a terminal window is only supported on macOS');
  }

  const literal = prompt.replace(/([\\"])/g, '\\$1');
  const script = `tell application "Terminal"\nactivate\ndo script "claude " & quoted form of "${literal}"\nend tell`;

  return execFileAsync('osascript', ['-e', script]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run scripts/launch.test.mjs`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add scripts/launch.mjs scripts/launch.test.mjs
git commit -m "feat: build the /understand launch command"
```

---

### Task 4: The HTTP server

Static files, the JSON API, and the two `Origin`-checked launch endpoints. SSE arrives in Task 5.

**Files:**
- Create: `scripts/serve.mjs`
- Create: `web/index.html` (placeholder body; the real UI is Task 6)
- Modify: `package.json` — add the `dev` script

**Interfaces:**
- Consumes: `listLearners`, `buildPayload` (Task 2); `buildPrompt`, `buildCommand`, `openInTerminal` (Task 3); `titlesFromCache` from `./map.mjs`
- Produces: a server on `127.0.0.1:4321` serving the endpoint table below. Exports `createServer({ port }) -> Server`, where the returned server carries an `addRoute(fn)` method so Task 5 can attach the SSE route. A route is `(req, res, path, url) -> boolean`, returning `true` when it has handled the request.

| Method | Path | Body / Returns |
|---|---|---|
| `GET` | `/` | `web/index.html` |
| `GET` | `/api/learners` | `{learners: string[]}` |
| `GET` | `/api/learners/:name` | the Task 2 payload |
| `POST` | `/api/launch` | in `{learner, topic}` → out `{command}` |
| `POST` | `/api/launch/terminal` | in `{learner, topic}` → out `{ok: true}` |
| `GET` | `/web/*`, `/vendor/*` | static files |

- [ ] **Step 1: Write the server**

```js
// scripts/serve.mjs
/**
 * The local dev server: launcher plus live learner dashboard.
 *
 * Deliberately stateless and dependency-free. Every request re-reads from disk and
 * runs the same pure functions the CLI does, so there is nothing to invalidate when
 * /understand rewrites a concept file mid-session.
 */

import { createServer as createHttpServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';
import { titlesFromCache } from './map.mjs';
import { buildPayload, listLearners } from './payload.mjs';
import { buildCommand, buildPrompt, openInTerminal } from './launch.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const LEARNERS_ROOT = join(REPO_ROOT, 'learners');
const HOST = '127.0.0.1';
const DEFAULT_PORT = 4321;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': MIME['.json'], 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

/** Serve a file, refusing anything that resolves outside the repo. */
function sendFile(res, relative) {
  const target = resolve(REPO_ROOT, `.${relative}`);
  if (!target.startsWith(REPO_ROOT + sep) || !existsSync(target) || !statSync(target).isFile()) {
    return sendJson(res, 404, { error: 'not found' });
  }

  const body = readFileSync(target);
  res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
  res.end(body);
}

/**
 * Any page in your browser can POST to localhost, so binding to 127.0.0.1 is not on
 * its own enough — without this check, a visited site could drive the launcher.
 */
function originAllowed(req, port) {
  const origin = req.headers.origin;
  if (origin === undefined) return true; // curl and friends send none
  return origin === `http://${HOST}:${port}` || origin === `http://localhost:${port}`;
}

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let text = '';
    req.on('data', (chunk) => {
      text += chunk;
      if (text.length > 100_000) rejectBody(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolveBody(JSON.parse(text || '{}'));
      } catch {
        rejectBody(new Error('body must be JSON'));
      }
    });
    req.on('error', rejectBody);
  });
}

/**
 * Validate against the real directory listing rather than a pattern. Rejecting
 * anything that isn't an existing learner also forecloses path traversal.
 */
function resolveLearner(name) {
  if (!listLearners(LEARNERS_ROOT).includes(name)) throw new Error(`unknown learner: ${name}`);
  return name;
}

async function handleLaunch(req, res, { spawn }) {
  const { learner, topic } = await readBody(req);
  const prompt = buildPrompt(resolveLearner(learner), topic);

  if (spawn) {
    await openInTerminal(prompt);
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 200, { command: buildCommand(learner, topic) });
}

export function createServer({ port = DEFAULT_PORT } = {}) {
  const routes = [];

  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url, `http://${HOST}:${port}`);
    const path = url.pathname;

    try {
      if (req.method === 'POST' && !originAllowed(req, port)) {
        return sendJson(res, 403, { error: 'bad origin' });
      }

      for (const route of routes) {
        if (route(req, res, path, url)) return;
      }

      if (req.method === 'GET' && path === '/') return sendFile(res, '/web/index.html');
      if (req.method === 'GET' && (path.startsWith('/web/') || path.startsWith('/vendor/'))) {
        return sendFile(res, path);
      }

      if (req.method === 'GET' && path === '/api/learners') {
        return sendJson(res, 200, { learners: listLearners(LEARNERS_ROOT) });
      }

      const learnerMatch = /^\/api\/learners\/([^/]+)$/.exec(path);
      if (req.method === 'GET' && learnerMatch) {
        const learner = resolveLearner(decodeURIComponent(learnerMatch[1]));
        return sendJson(res, 200, buildPayload(LEARNERS_ROOT, learner, titlesFromCache()));
      }

      if (req.method === 'POST' && path === '/api/launch') {
        return await handleLaunch(req, res, { spawn: false });
      }
      if (req.method === 'POST' && path === '/api/launch/terminal') {
        return await handleLaunch(req, res, { spawn: true });
      }

      return sendJson(res, 404, { error: 'not found' });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  });

  // Task 5 attaches the SSE route here.
  server.addRoute = (route) => routes.push(route);
  server.learnersRoot = LEARNERS_ROOT;

  return server;
}

// --- CLI ---------------------------------------------------------------------

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  const flag = argv.indexOf('--port');
  const port = flag === -1 ? DEFAULT_PORT : Number(argv[flag + 1]);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('usage: node scripts/serve.mjs [--port 4321]');
    exit(1);
  }

  createServer({ port }).listen(port, HOST, () => {
    console.log(`understand dashboard  ->  http://${HOST}:${port}`);
  });
}
```

- [ ] **Step 2: Add the placeholder page**

```html
<!-- web/index.html -->
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>understand</title></head>
  <body><p>placeholder — the dashboard lands in task 6</p></body>
</html>
```

- [ ] **Step 3: Add the dev script**

In `package.json`, add to `"scripts"` (keep `test` and `test:watch` unchanged, add no dependencies):

```json
"dev": "node scripts/serve.mjs"
```

- [ ] **Step 4: Verify the server by hand**

```bash
pnpm dev &
sleep 1
curl -s http://127.0.0.1:4321/api/learners
curl -s http://127.0.0.1:4321/api/learners/hiro | head -c 300
curl -s -X POST http://127.0.0.1:4321/api/launch \
  -H 'content-type: application/json' -d '{"learner":"hiro","topic":"Entropy"}'
```

Expected, in order: `{"learners":["hiro"]}`; a JSON payload whose `concepts` contains `Bayesian inference`; `{"command":"claude \"/understand Entropy (learner: hiro)\""}`.

- [ ] **Step 5: Verify the guards reject what they should**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:4321/api/launch \
  -H 'content-type: application/json' -H 'origin: http://evil.example' -d '{"learner":"hiro","topic":"x"}'
curl -s http://127.0.0.1:4321/api/learners/..%2f..%2fetc
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4321/web/../package.json
```

Expected: `403`; `{"error":"unknown learner: ../../etc"}`; `404`.

Then stop it: `kill %1`

- [ ] **Step 6: Commit**

```bash
git add scripts/serve.mjs web/index.html package.json
git commit -m "feat: serve the learner API over a local http server"
```

---

### Task 5: Live updates via SSE and fs.watch

One recursive watcher on `learners/`, debounced, fanning out to SSE clients subscribed to the learner whose directory changed.

A single root watcher rather than one per learner: the first path segment of the change event identifies the learner, so one watcher covers every learner including ones created while the server is running.

**Files:**
- Modify: `scripts/serve.mjs`

**Interfaces:**
- Consumes: `createServer` (Task 4)
- Produces: `GET /api/learners/:name/events` — an SSE stream emitting `event: change` when that learner's files change

- [ ] **Step 1: Add the watcher and the SSE route**

Add `watch` to the **existing** `node:fs` import in `scripts/serve.mjs` — do not add a second import line for the same module:

```js
import { existsSync, readFileSync, statSync, watch } from 'node:fs';
```

Then inside `createServer`, immediately before the `return server;` line:

```js
  // learner -> Set<ServerResponse>
  const listeners = new Map();
  const timers = new Map();

  function notify(learner) {
    clearTimeout(timers.get(learner));
    // /understand rewrites a file in several small writes; one debounce turns that
    // burst into a single refetch.
    timers.set(
      learner,
      setTimeout(() => {
        for (const res of listeners.get(learner) ?? []) res.write('event: change\ndata: {}\n\n');
      }, 150),
    );
  }

  if (existsSync(LEARNERS_ROOT)) {
    // One watcher at the root: the first path segment names the learner, so this
    // also covers learners created while the server is running.
    const watcher = watch(LEARNERS_ROOT, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const learner = String(filename).split(sep)[0];
      if (learner) notify(learner);
    });
    watcher.on('error', (error) => console.error('watch failed:', error.message));
    server.on('close', () => watcher.close());
  }

  server.addRoute((req, res, path) => {
    const match = /^\/api\/learners\/([^/]+)\/events$/.exec(path);
    if (req.method !== 'GET' || !match) return false;

    const learner = decodeURIComponent(match[1]);
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');

    if (!listeners.has(learner)) listeners.set(learner, new Set());
    listeners.get(learner).add(res);

    // Proxies and laptops sleeping mid-session both kill idle streams quietly.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      listeners.get(learner)?.delete(res);
    });

    return true;
  });
```

- [ ] **Step 2: Verify the stream opens and fires**

```bash
pnpm dev &
sleep 1
curl -N -s http://127.0.0.1:4321/api/learners/hiro/events &
sleep 1
touch learners/hiro/concepts/Q812535--bayesian-inference.md
sleep 1
```

Expected: `curl` prints `retry: 1000`, then `event: change` with `data: {}` within about a second of the `touch`.

Then stop both: `kill %1 %2`

- [ ] **Step 3: Verify the debounce coalesces a burst**

```bash
pnpm dev &
sleep 1
curl -N -s http://127.0.0.1:4321/api/learners/hiro/events > /tmp/sse.txt &
sleep 1
for i in 1 2 3 4 5; do touch learners/hiro/concepts/Q812535--bayesian-inference.md; done
sleep 2
grep -c '^event: change' /tmp/sse.txt
kill %1 %2
```

Expected: `1` — five rapid writes coalesce into one ping.

- [ ] **Step 4: Confirm nothing regressed**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/serve.mjs
git commit -m "feat: push learner-model changes to the browser over SSE"
```

---

### Task 6: The dashboard UI

Two panes. Left: learner picker, topic field, launch controls. Right: the learner model — the map, then each concept with its evidence sections, then recent sessions.

**Files:**
- Modify: `web/index.html`
- Create: `web/app.js`
- Create: `web/style.css`

**Interfaces:**
- Consumes: every endpoint from Tasks 4 and 5
- Produces: nothing other tasks depend on

- [ ] **Step 1: Write the page**

```html
<!-- web/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>understand — learner model</title>
    <link rel="stylesheet" href="/web/style.css" />
  </head>
  <body>
    <aside>
      <h1>understand</h1>

      <label for="learner">Learner</label>
      <select id="learner"></select>

      <label for="topic">Topic</label>
      <input id="topic" type="text" placeholder="Bayesian inference" autocomplete="off" />

      <div class="row">
        <button id="copy" type="button">Copy command</button>
        <button id="terminal" type="button" hidden>Open in Terminal</button>
      </div>

      <pre id="command" aria-live="polite"></pre>
      <p id="status" role="status"></p>

      <h2>Profile</h2>
      <pre id="profile"></pre>
    </aside>

    <main>
      <section id="map"></section>
      <section id="concepts"></section>
      <section id="sessions"></section>
    </main>

    <script type="module" src="/web/app.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the styles**

```css
/* web/style.css */
:root {
  --bg: #14161a;
  --panel: #1c1f26;
  --line: #2b3039;
  --ink: #e6e8ec;
  --dim: #9aa3b0;
  --solid: #6ee7a8;
  --shaky: #f0b866;
  --wrong: #f2766b;
  --accent: #7ab8f5;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  display: grid;
  grid-template-columns: 22rem 1fr;
  min-height: 100vh;
  background: var(--bg);
  color: var(--ink);
  font: 15px/1.6 ui-sans-serif, -apple-system, "Segoe UI", sans-serif;
}

aside {
  padding: 1.5rem;
  background: var(--panel);
  border-right: 1px solid var(--line);
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
}

main { padding: 1.5rem 2rem; min-width: 0; }

h1 { margin: 0 0 1.5rem; font-size: 1.1rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); }
h2 { margin: 2rem 0 0.75rem; font-size: 0.8rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); }
h3 { margin: 0; font-size: 1rem; }

label { display: block; margin: 1rem 0 0.35rem; font-size: 0.8rem; color: var(--dim); }

select, input {
  width: 100%;
  padding: 0.5rem 0.6rem;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--ink);
  font: inherit;
}

.row { display: flex; gap: 0.5rem; margin-top: 1rem; }

button {
  flex: 1;
  padding: 0.5rem;
  background: var(--accent);
  border: 0;
  border-radius: 6px;
  color: #0d1117;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

button:disabled { opacity: 0.4; cursor: not-allowed; }

pre {
  margin: 0.75rem 0 0;
  padding: 0.6rem;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 6px;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--dim);
}

pre:empty { display: none; }

#status { min-height: 1.2rem; font-size: 0.8rem; color: var(--dim); }

.card {
  margin-bottom: 1rem;
  padding: 1rem 1.25rem;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
}

.card header { display: flex; align-items: baseline; gap: 0.75rem; margin-bottom: 0.5rem; }

.state {
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background: var(--line);
  color: var(--shaky);
}

.state[data-state="solid"] { color: var(--solid); }

.meta { margin-left: auto; font-size: 0.75rem; color: var(--dim); }

.section-title { margin: 0.9rem 0 0.3rem; font-size: 0.75rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--dim); }
.section-title[data-kind="Confidently wrong"] { color: var(--wrong); }

ul { margin: 0; padding-left: 1.1rem; }
li { margin: 0.25rem 0; }

.pills { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.pill { padding: 0.2rem 0.6rem; background: var(--panel); border: 1px solid var(--line); border-radius: 999px; font-size: 0.8rem; }
.error { border-color: var(--wrong); color: var(--wrong); }
.empty { color: var(--dim); font-style: italic; }

@media (max-width: 60rem) {
  body { grid-template-columns: 1fr; }
  aside { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
}
```

- [ ] **Step 3: Write the client**

```js
// web/app.js
/**
 * Refetch the whole payload on every change ping.
 *
 * The payload is a handful of small markdown files, so re-rendering everything is
 * both simpler than diffing and impossible to get subtly wrong — there is no client
 * state that can drift from what's on disk.
 */

const $ = (id) => document.getElementById(id);

function node(tag, props = {}, ...children) {
  const element = Object.assign(document.createElement(tag), props);
  element.append(...children.filter((child) => child !== null && child !== undefined));
  return element;
}

let stream = null;

async function json(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `request failed: ${response.status}`);
  return body;
}

function renderMap(map) {
  const group = (title, entries, describe) =>
    node(
      'div',
      {},
      node('h2', { textContent: title }),
      entries.length === 0
        ? node('p', { className: 'empty', textContent: 'none yet' })
        : node('div', { className: 'pills' }, ...entries.map((e) => node('span', { className: 'pill', textContent: describe(e) }))),
    );

  $('map').replaceChildren(
    group('Solid', map.solid, (c) => c.title),
    group('Shaky', map.shaky, (c) => `${c.title} · ${c.state}`),
    group('Frontier', map.frontier, (f) => (f.references > 1 ? `${f.title} ×${f.references}` : f.title)),
  );
}

function renderConcept(concept) {
  if (concept.error) {
    return node(
      'article',
      { className: 'card error' },
      node('h3', { textContent: concept.file }),
      node('p', { textContent: concept.error }),
    );
  }

  const sections = concept.sections
    .filter((section) => section.items.length > 0)
    .flatMap((section) => [
      node('p', { className: 'section-title', textContent: section.heading, dataset: { kind: section.heading } }),
      node('ul', {}, ...section.items.map((item) => node('li', { textContent: item }))),
    ]);

  return node(
    'article',
    { className: 'card' },
    node(
      'header',
      {},
      node('h3', { textContent: concept.title }),
      node('span', { className: 'state', textContent: concept.state, dataset: { state: concept.state } }),
      node('span', { className: 'meta', textContent: `${concept.sessions} session(s) · last ${concept.lastProbed ?? 'never'}` }),
    ),
    concept.preamble ? node('p', { className: 'empty', textContent: concept.preamble }) : null,
    ...sections,
  );
}

function render(payload) {
  $('profile').textContent = payload.profile;
  renderMap(payload.map);

  $('concepts').replaceChildren(
    node('h2', { textContent: 'Concepts' }),
    ...(payload.concepts.length === 0
      ? [node('p', { className: 'empty', textContent: 'Nothing probed yet. Launch a session on the left.' })]
      : payload.concepts.map(renderConcept)),
  );

  $('sessions').replaceChildren(
    node('h2', { textContent: 'Sessions' }),
    ...(payload.sessions.length === 0
      ? [node('p', { className: 'empty', textContent: 'none yet' })]
      : [node('div', { className: 'pills' }, ...payload.sessions.map((s) => node('span', { className: 'pill', textContent: s.file })))]),
  );
}

async function load(learner) {
  render(await json(`/api/learners/${encodeURIComponent(learner)}`));

  stream?.close();
  stream = new EventSource(`/api/learners/${encodeURIComponent(learner)}/events`);
  stream.addEventListener('change', async () => {
    render(await json(`/api/learners/${encodeURIComponent(learner)}`));
    $('status').textContent = `updated ${new Date().toLocaleTimeString()}`;
  });
}

async function launch(spawn) {
  const learner = $('learner').value;
  const topic = $('topic').value;

  try {
    const body = JSON.stringify({ learner, topic });
    const headers = { 'content-type': 'application/json' };

    if (spawn) {
      await json('/api/launch/terminal', { method: 'POST', headers, body });
      $('status').textContent = 'Terminal opened — the session runs there.';
      return;
    }

    const { command } = await json('/api/launch', { method: 'POST', headers, body });
    $('command').textContent = command;
    await navigator.clipboard.writeText(command).catch(() => {});
    $('status').textContent = 'Copied. Paste it into your terminal.';
  } catch (error) {
    $('status').textContent = error.message;
  }
}

const { learners } = await json('/api/learners');
$('learner').replaceChildren(...learners.map((name) => node('option', { value: name, textContent: name })));
$('terminal').hidden = !navigator.platform.startsWith('Mac');
$('learner').addEventListener('change', () => load($('learner').value));
$('copy').addEventListener('click', () => launch(false));
$('terminal').addEventListener('click', () => launch(true));

if (learners.length > 0) await load(learners[0]);
```

- [ ] **Step 4: Verify by eye**

```bash
pnpm dev
```

Open `http://127.0.0.1:4321`. Expected: `hiro` selected, `Bayesian inference` shown as `shaky`, its `Gaps` section listing the Bayes' theorem gap, its `Confidently wrong` section listing the `0.8/(1-0.2) = 1` entry, and a `Frontier` row of pills.

- [ ] **Step 5: Commit**

```bash
git add web/
git commit -m "feat: render the live learner dashboard"
```

---

### Task 7: End-to-end and adversarial verification

The spec's verification list, run against the assembled system. This is its own task because it is the gate that says Phase 1 is done.

**Files:** none — verification only.

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: PASS — `wiki`, `map`, `frontmatter`, `payload`, `launch`

- [ ] **Step 2: The live test**

With `pnpm dev` running and the page open, launch a real session from the page, answer one question, and let `/understand` write the concept file.

Expected: the concept's `state` and evidence sections change on screen with no manual reload, and the status line updates.

**This is the test the whole feature exists for.** If it fails, the fault is in the watcher or the SSE route (Task 5), not the UI.

- [ ] **Step 3: Adversarial — forged origin**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:4321/api/launch \
  -H 'content-type: application/json' -H 'origin: http://evil.example' \
  -d '{"learner":"hiro","topic":"x"}'
```

Expected: `403`

- [ ] **Step 4: Adversarial — shell metacharacters in the topic**

In the page's topic field, enter: `"; rm -rf /tmp/x; echo "`

Click **Open in Terminal**. Expected: a Terminal window opens running `claude` with that string as literal prompt text. No file is deleted, and `/tmp/x` is untouched. Confirm with `ls -d /tmp/x 2>&1`.

- [ ] **Step 5: Adversarial — traversal in the learner name**

```bash
curl -s 'http://127.0.0.1:4321/api/learners/..%2f..%2fetc'
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:4321/web/../package.json'
```

Expected: `{"error":"unknown learner: ../../etc"}` and `404`.

- [ ] **Step 6: Resilience — one malformed file must not blank the dashboard**

```bash
printf 'no frontmatter here\n' > learners/hiro/concepts/zz-broken.md
```

Expected: the page shows a red error card for `zz-broken.md` while still rendering `Bayesian inference` in full.

Then clean up: `rm learners/hiro/concepts/zz-broken.md`

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix: address verification findings"
```

Skip this step if nothing needed fixing.

---

## What this plan does not do

Carried forward to the next plan, which should be written against the graph explorer spec once Phase 1 lands:

- **Phase 2** — the prerequisite extraction fix. 28 of 36 recorded prerequisites are transcluded sidebar links.
- **Phase 3** — `scripts/graph.mjs`, the vendored Cytoscape bundle, the `graph` key in the payload, and the graph panel. Depends on Phase 2, because the graph is the only view that asserts prerequisite *direction*.

Note for whoever writes that plan: the dev-server spec **amends** the graph explorer spec to drop `scripts/render-map-html.mjs`, the generated `learners/<name>/map.html`, and the `--html` flag on `map.mjs`. Those existed only to work around `file://` blocking `fetch` and ES modules, which the server removes. Build `buildGraph` exactly as the graph spec describes; do not reintroduce the static generator.

Also out of scope per the spec: running the conversation in the browser, any auth or multi-user support, writing to the learner model from the page, and deployment beyond `localhost`.
