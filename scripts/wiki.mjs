/**
 * The grounding layer for /understand.
 *
 * Everything the skill claims about a concept has to be traceable to text that
 * was actually fetched and written to disk, together with the revision id it came
 * from. That is the whole point of this module: it turns "Wikipedia says…" from a
 * memory claim into a file the learner can open.
 *
 * All network access goes through an injected `fetchImpl` so the behaviour can be
 * driven from captured API payloads in tests.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.mjs';

const API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'understand-skill/0.1 (local learning tool)';
const DEFAULT_CACHE_DIR = fileURLToPath(new URL('../cache/wikipedia/', import.meta.url));
const DEFAULT_MAX_AGE_DAYS = 7;

/**
 * Lead-section links are the best available signal for "what does this definition
 * lean on", but they still carry three kinds of noise. These are the filters.
 */
const NOISE_PATTERNS = [
  /\((identifier|journal|magazine|newspaper|disambiguation)\)$/i,
  /^(List|Index|Outline|Glossary) of\b/i,
];

/** Reference works that appear only because a citation linked them. */
const REFERENCE_WORKS = new Set([
  'Merriam-Webster',
  'Oxford English Dictionary',
  'Encyclopædia Britannica',
  'Dictionary.com',
]);

/**
 * Broad fields that show up in "has found application in science, engineering,
 * philosophy, medicine…" sentences. They are domains of application, not
 * prerequisites, and probing them would be meaningless.
 */
const BROAD_TOPICS = new Set([
  'Art', 'Biology', 'Business', 'Chemistry', 'Economics', 'Education', 'Engineering',
  'Evidence', 'Finance', 'Government', 'History', 'Information', 'Knowledge', 'Language',
  'Law', 'Literature', 'Medicine', 'Music', 'Philosophy', 'Physics', 'Politics',
  'Psychology', 'Religion', 'Science', 'Society', 'Sport', 'Sports', 'Technology', 'War',
]);

function apiUrl(params) {
  const search = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
  return `${API}?${search}`;
}

async function callApi(params, { fetchImpl = globalThis.fetch } = {}) {
  const url = apiUrl(params);
  const response = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Wikipedia API ${response.status} for ${url}`);
  }
  const body = await response.json();
  if (body.error) {
    throw new Error(`Wikipedia API error: ${body.error.info ?? body.error.code}`);
  }
  return body;
}

function stripMarkup(html) {
  return String(html ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function articleUrl(title) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/** Candidate articles for a topic the learner named, for them to disambiguate. */
export async function search(query, opts = {}) {
  const body = await callApi(
    { action: 'query', list: 'search', srsearch: query, srlimit: '5', srprop: 'snippet' },
    opts,
  );
  return (body.query?.search ?? []).map((hit) => ({
    title: hit.title,
    pageid: hit.pageid,
    snippet: stripMarkup(hit.snippet),
  }));
}

/** Extract, QID and revision id in a single request. */
export async function fetchConcept(title, opts = {}) {
  const body = await callApi(
    {
      action: 'query',
      prop: 'extracts|pageprops|revisions',
      ppprop: 'wikibase_item',
      rvprop: 'ids',
      explaintext: '1',
      redirects: '1',
      titles: title,
    },
    opts,
  );

  const page = body.query?.pages?.[0];
  if (!page || page.missing) {
    throw new Error(`No Wikipedia article for "${title}"`);
  }

  return {
    qid: page.pageprops?.wikibase_item ?? null,
    title: page.title,
    pageid: page.pageid,
    revid: page.revisions?.[0]?.revid ?? null,
    url: articleUrl(page.title),
    extract: page.extract ?? '',
  };
}

/** Pure: the noise filter applied to `action=parse&section=0` links. */
export function filterLeadLinks(links) {
  return (links ?? [])
    .filter((link) => link.ns === 0 && link.exists === true)
    .map((link) => link.title)
    .filter((title) => !REFERENCE_WORKS.has(title))
    .filter((title) => !BROAD_TOPICS.has(title))
    .filter((title) => !NOISE_PATTERNS.some((pattern) => pattern.test(title)));
}

/** Resolve article titles to Wikidata QIDs in one batched request. */
export async function resolveQids(titles, opts = {}) {
  const found = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50);
    if (chunk.length === 0) continue;
    const body = await callApi(
      { action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', redirects: '1', titles: chunk.join('|') },
      opts,
    );
    for (const page of body.query?.pages ?? []) {
      const qid = page.pageprops?.wikibase_item;
      if (qid) found.set(page.title, qid);
    }
    // A redirect changes the returned title, so map the requested title too.
    for (const redirect of body.query?.redirects ?? []) {
      const qid = found.get(redirect.to);
      if (qid) found.set(redirect.from, qid);
    }
  }
  return found;
}

function withQids(titles, qids) {
  return titles.map((title) => ({ title, qid: qids.get(title) })).filter((item) => Boolean(item.qid));
}

/** What the definition itself leans on: filtered lead-section links. */
export async function prerequisites(title, opts = {}) {
  const body = await callApi(
    { action: 'parse', page: title, prop: 'links', section: '0', redirects: '1' },
    opts,
  );
  const titles = filterLeadLinks(body.parse?.links);
  return withQids(titles, await resolveQids(titles, opts));
}

/** Conceptually nearby articles — the frontier, via `morelike:`. */
export async function adjacent(title, opts = {}) {
  const body = await callApi(
    { action: 'query', list: 'search', srsearch: `morelike:${title}`, srlimit: '12', srprop: '' },
    opts,
  );
  const titles = (body.query?.search ?? [])
    .filter((hit) => hit.ns === 0 && hit.title !== title)
    .map((hit) => hit.title);
  return withQids(titles, await resolveQids(titles, opts));
}

function bullets(items) {
  return items.length === 0 ? '- (none)' : items.map((item) => `- [${item.qid}] ${item.title}`).join('\n');
}

/** Pure: the on-disk shape of a cached article. */
export function renderCacheEntry({ qid, title, url, pageid, revid, fetched, extract, prerequisites: prereqs = [], adjacent: adj = [] }) {
  const body = [
    '## Prerequisites (lead-section links)',
    '',
    bullets(prereqs),
    '',
    '## Adjacent (morelike)',
    '',
    bullets(adj),
    '',
    '## Extract',
    '',
    String(extract).trim(),
  ].join('\n');

  return stringifyFrontmatter({ qid, title, url, pageid, revid, fetched }, body);
}

function daysBetween(fromIso, toIso) {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return Infinity;
  return Math.round((to - from) / 86400000);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Ensure `cache/wikipedia/<QID>.md` exists and is current.
 *
 * Within the freshness window this makes no network calls at all — the cached
 * text is the source of truth for the session. Past it, one call re-checks the
 * revision id; only a moved revid costs a full re-fetch, and hand-written notes
 * in an unchanged file are preserved.
 */
export async function ensureCached(title, opts = {}) {
  const {
    cacheDir = DEFAULT_CACHE_DIR,
    today = todayIso(),
    maxAgeDays = DEFAULT_MAX_AGE_DAYS,
    ...rest
  } = opts;

  const existingPath = findCachedByTitle(cacheDir, title);
  if (existingPath) {
    const text = readFileSync(existingPath, 'utf8');
    const { data } = parseFrontmatter(text);

    if (daysBetween(data.fetched, today) < maxAgeDays) {
      return { status: 'hit', qid: data.qid, title: data.title, revid: data.revid, path: existingPath };
    }

    const concept = await fetchConcept(title, rest);
    if (concept.revid === data.revid) {
      writeFileSync(existingPath, text.replace(/^fetched: .*$/m, `fetched: ${today}`));
      return { status: 'unchanged', qid: data.qid, title: data.title, revid: data.revid, path: existingPath };
    }

    const path = writeEntry(cacheDir, concept, await neighbours(concept.title, rest), today);
    return { status: 'stale', qid: concept.qid, title: concept.title, revid: concept.revid, path };
  }

  const concept = await fetchConcept(title, rest);
  const path = writeEntry(cacheDir, concept, await neighbours(concept.title, rest), today);
  return { status: 'miss', qid: concept.qid, title: concept.title, revid: concept.revid, path };
}

async function neighbours(title, opts) {
  return {
    prerequisites: await prerequisites(title, opts),
    adjacent: await adjacent(title, opts),
  };
}

function writeEntry(cacheDir, concept, links, fetched) {
  if (!concept.qid) {
    throw new Error(`"${concept.title}" has no Wikidata item, so it cannot be a concept node`);
  }
  mkdirSync(cacheDir, { recursive: true });
  const path = join(cacheDir, `${concept.qid}.md`);
  writeFileSync(path, renderCacheEntry({ ...concept, ...links, fetched }));
  return path;
}

/**
 * Cache files are named by QID, but a session starts from a title — so a lookup
 * has to scan. The cache is small (one file per concept ever studied) and this
 * keeps the QID-stable naming that survives article renames.
 */
function findCachedByTitle(cacheDir, title) {
  if (!existsSync(cacheDir)) return null;
  const wanted = title.toLowerCase();
  for (const name of readdirSync(cacheDir)) {
    if (!name.endsWith('.md')) continue;
    const path = join(cacheDir, name);
    const { data } = parseFrontmatter(readFileSync(path, 'utf8'));
    if (String(data.title ?? '').toLowerCase() === wanted) return path;
  }
  return null;
}

// --- CLI ---------------------------------------------------------------------

const USAGE = `usage:
  node scripts/wiki.mjs search "<query>"    list candidate articles for a topic
  node scripts/wiki.mjs fetch  "<title>"    cache the article, its prerequisites and its neighbours`;

async function main([command, argument]) {
  if (!command || !argument) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  if (command === 'search') {
    for (const hit of await search(argument)) {
      console.log(`${hit.title}\n  ${hit.snippet}`);
    }
    return;
  }

  if (command === 'fetch') {
    const result = await ensureCached(argument);
    console.log(`${result.status}  ${result.qid}  ${result.title}  revid ${result.revid}`);
    console.log(result.path);
    return;
  }

  console.error(USAGE);
  process.exitCode = 1;
}

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  await main(argv.slice(2));
}
