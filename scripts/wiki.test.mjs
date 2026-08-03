import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  adjacent,
  ensureCached,
  fetchConcept,
  filterLeadLinks,
  prerequisites,
  renderCacheEntry,
  search,
} from './wiki.mjs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

const CONCEPT = fixture('query-concept-bayesian-inference');
const LEAD_LINKS = fixture('parse-lead-links-bayesian-inference');
const MORELIKE = fixture('search-morelike-bayesian-inference');
const SEARCH = fixture('search-bayesian-inference');
/** Real title -> QID answers for every title these fixtures can ask about. */
const QID_MAP = fixture('qid-map');

/** Rebuild the pageprops response the API would return for the titles requested. */
function pagepropsFor(url, qidMap) {
  const titles = new URL(url).searchParams.get('titles').split('|');
  return {
    query: {
      pages: titles.map((title, index) =>
        qidMap[title]
          ? { pageid: index + 1, ns: 0, title, pageprops: { wikibase_item: qidMap[title] } }
          : { ns: 0, title, missing: true },
      ),
    },
  };
}

/**
 * Routes a request to the fixture that the real endpoint would have returned,
 * and records every URL so tests can assert the network was (or wasn't) touched.
 */
function makeFetch({ qidMap = QID_MAP } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = String(url);
    calls.push(u);
    let body;
    if (u.includes('action=parse')) body = LEAD_LINKS;
    else if (u.includes('morelike')) body = MORELIKE;
    else if (u.includes('prop=extracts')) body = CONCEPT;
    else if (u.includes('list=search')) body = SEARCH;
    else if (u.includes('prop=pageprops')) body = pagepropsFor(u, qidMap);
    else throw new Error(`unrouted request: ${u}`);
    return { ok: true, status: 200, json: async () => body };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

describe('search', () => {
  test('returns candidate articles with search-match markup stripped', async () => {
    const results = await search('Bayesian inference', { fetchImpl: makeFetch() });

    expect(results[0]).toEqual({
      title: 'Bayesian inference',
      pageid: 49571,
      snippet: expect.stringContaining('method of statistical inference'),
    });
    expect(results[0].snippet).not.toContain('<span');
  });
});

describe('fetchConcept', () => {
  test('gets qid, revid, url and full extract from one request', async () => {
    const fetchImpl = makeFetch();

    const concept = await fetchConcept('Bayesian inference', { fetchImpl });

    expect(concept.qid).toBe('Q812535');
    expect(concept.title).toBe('Bayesian inference');
    expect(concept.pageid).toBe(49571);
    expect(concept.revid).toBe(1364298666);
    expect(concept.url).toBe('https://en.wikipedia.org/wiki/Bayesian_inference');
    expect(concept.extract).toContain("Bayes' theorem");
    expect(fetchImpl.calls).toHaveLength(1);
  });

  test('throws when the article does not exist', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ query: { pages: [{ title: 'Nope', missing: true }] } }),
    });

    await expect(fetchConcept('Nope', { fetchImpl })).rejects.toThrow(/no wikipedia article/i);
  });
});

describe('filterLeadLinks', () => {
  const titles = () => filterLeadLinks(LEAD_LINKS.parse.links);

  test('keeps the concepts the definition actually depends on', () => {
    expect(titles()).toEqual(
      expect.arrayContaining([
        "Bayes' theorem",
        'Conjugate prior',
        'Credible interval',
        'Likelihood function',
        'Prior probability',
        'Statistical inference',
      ]),
    );
  });

  test('drops links outside the article namespace', () => {
    expect(titles()).not.toContain('Template:Bayesian statistics');
    expect(titles()).not.toContain('Portal:Mathematics');
    expect(titles()).not.toContain('Help:IPA/English');
  });

  test('drops citation and identifier artifacts', () => {
    expect(titles()).not.toContain('Bayesian Analysis (journal)');
    expect(titles()).not.toContain('OCLC (identifier)');
    expect(titles()).not.toContain('Merriam-Webster');
  });

  test('drops the broad application domains that follow "has found application in"', () => {
    for (const broad of ['Engineering', 'Evidence', 'Information', 'Law', 'Medicine', 'Philosophy', 'Psychology', 'Science', 'Sport']) {
      expect(titles()).not.toContain(broad);
    }
  });

  test('drops red links', () => {
    expect(filterLeadLinks([{ ns: 0, title: 'Imaginary concept', exists: false }])).toEqual([]);
  });
});

describe('prerequisites', () => {
  test('pairs each surviving lead link with its qid', async () => {
    const list = await prerequisites('Bayesian inference', { fetchImpl: makeFetch() });

    expect(list).toContainEqual({ title: "Bayes' theorem", qid: 'Q182505' });
    expect(list).toContainEqual({ title: 'Conjugate prior', qid: 'Q3711784' });
  });

  test('omits links that have no wikidata item', async () => {
    const list = await prerequisites('Bayesian inference', { fetchImpl: makeFetch({ qidMap: {} }) });

    expect(list).toEqual([]);
  });
});

describe('adjacent', () => {
  test('returns morelike neighbours with qids', async () => {
    const list = await adjacent('Bayesian inference', { fetchImpl: makeFetch() });

    expect(list.map((item) => item.title)).toEqual(
      expect.arrayContaining(['Marginal likelihood', 'Likelihood function', 'Conjugate prior']),
    );
    expect(list.every((item) => /^Q\d+$/.test(item.qid))).toBe(true);
  });

  test('never lists the article itself as its own neighbour', async () => {
    const selfHit = {
      query: { search: [{ ns: 0, title: 'Bayesian inference', pageid: 49571 }, { ns: 0, title: "Bayes' theorem", pageid: 49569 }] },
    };
    const fetchImpl = async (url) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).includes('morelike')
          ? selfHit
          : { query: { pages: [{ title: "Bayes' theorem", pageprops: { wikibase_item: 'Q182505' } }] } },
    });

    const list = await adjacent('Bayesian inference', { fetchImpl });

    expect(list.map((item) => item.title)).toEqual(["Bayes' theorem"]);
  });
});

describe('renderCacheEntry', () => {
  const entry = () =>
    renderCacheEntry({
      qid: 'Q812535',
      title: 'Bayesian inference',
      url: 'https://en.wikipedia.org/wiki/Bayesian_inference',
      pageid: 49571,
      revid: 1364298666,
      fetched: '2026-08-03',
      extract: 'Bayesian inference is a method of statistical inference.',
      prerequisites: [{ title: "Bayes' theorem", qid: 'Q182505' }],
      adjacent: [{ title: 'Marginal likelihood', qid: 'Q6763373' }],
    });

  test('records the revision the text was quoted from', () => {
    expect(entry()).toContain('revid: 1364298666');
    expect(entry()).toContain('fetched: 2026-08-03');
  });

  test('lists neighbours as qid-tagged bullets', () => {
    expect(entry()).toContain("- [Q182505] Bayes' theorem");
    expect(entry()).toContain('- [Q6763373] Marginal likelihood');
  });

  test('carries the article text so judgements can quote it', () => {
    expect(entry()).toContain('Bayesian inference is a method of statistical inference.');
  });
});

describe('ensureCached', () => {
  let cacheDir;
  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'wiki-cache-'));
  });

  test('writes the cache file on a miss', async () => {
    const fetchImpl = makeFetch();

    const result = await ensureCached('Bayesian inference', { fetchImpl, cacheDir, today: '2026-08-03' });

    expect(result.status).toBe('miss');
    expect(result.qid).toBe('Q812535');
    expect(result.path).toBe(join(cacheDir, 'Q812535.md'));
    expect(readFileSync(result.path, 'utf8')).toContain('revid: 1364298666');
  });

  test('a fresh cache entry is served without touching the network', async () => {
    await ensureCached('Bayesian inference', { fetchImpl: makeFetch(), cacheDir, today: '2026-08-03' });

    const second = makeFetch();
    const result = await ensureCached('Bayesian inference', { fetchImpl: second, cacheDir, today: '2026-08-03' });

    expect(result.status).toBe('hit');
    expect(second.calls).toEqual([]);
  });

  test('past the freshness window it re-checks the revid but keeps an unchanged entry', async () => {
    const first = await ensureCached('Bayesian inference', { fetchImpl: makeFetch(), cacheDir, today: '2026-08-03' });
    writeFileSync(first.path, `${readFileSync(first.path, 'utf8')}\n<!-- hand-edited -->\n`);

    const recheck = makeFetch();
    const result = await ensureCached('Bayesian inference', { fetchImpl: recheck, cacheDir, today: '2026-09-30' });

    expect(result.status).toBe('unchanged');
    expect(recheck.calls).toHaveLength(1);
    expect(readFileSync(result.path, 'utf8')).toContain('fetched: 2026-09-30');
    expect(readFileSync(result.path, 'utf8')).toContain('<!-- hand-edited -->');
  });

  test('a moved revid rewrites the entry', async () => {
    const first = await ensureCached('Bayesian inference', { fetchImpl: makeFetch(), cacheDir, today: '2026-08-03' });
    writeFileSync(first.path, readFileSync(first.path, 'utf8').replace('revid: 1364298666', 'revid: 1000000000'));

    const result = await ensureCached('Bayesian inference', { fetchImpl: makeFetch(), cacheDir, today: '2026-09-30' });

    expect(result.status).toBe('stale');
    expect(readFileSync(result.path, 'utf8')).toContain('revid: 1364298666');
  });
});
