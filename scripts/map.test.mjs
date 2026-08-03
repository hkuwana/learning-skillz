import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { buildMap, formatMap, loadConcepts, titlesFromCache } from './map.mjs';

const concept = (over = {}) => ({
  qid: 'Q1',
  title: 'One',
  state: 'solid',
  prerequisites: [],
  adjacent: [],
  ...over,
});

describe('buildMap', () => {
  test('splits probed concepts by whether they are solid', () => {
    const map = buildMap([
      concept({ qid: 'Q1', title: 'Solid one', state: 'solid' }),
      concept({ qid: 'Q2', title: 'Shaky one', state: 'shaky' }),
      concept({ qid: 'Q3', title: 'Shallow one', state: 'shallow' }),
      concept({ qid: 'Q4', title: 'Untested one', state: 'untested' }),
    ]);

    expect(map.solid.map((c) => c.title)).toEqual(['Solid one']);
    expect(map.shaky.map((c) => c.title)).toEqual(['Shaky one', 'Shallow one', 'Untested one']);
  });

  test('frontier is neighbours that have no concept file yet', () => {
    const map = buildMap([
      concept({ qid: 'Q1', prerequisites: ['Q9'], adjacent: ['Q8'] }),
      concept({ qid: 'Q8', title: 'Already studied' }),
    ]);

    expect(map.frontier.map((f) => f.qid)).toEqual(['Q9']);
  });

  test('frontier ranks the most-referenced neighbours first', () => {
    const map = buildMap([
      concept({ qid: 'Q1', adjacent: ['Q7', 'Q9'] }),
      concept({ qid: 'Q2', adjacent: ['Q9'] }),
      concept({ qid: 'Q3', prerequisites: ['Q9'] }),
    ]);

    expect(map.frontier.map((f) => `${f.qid}x${f.references}`)).toEqual(['Q9x3', 'Q7x1']);
  });

  test('names frontier entries from the shared cache when it knows them', () => {
    const map = buildMap([concept({ qid: 'Q1', adjacent: ['Q45284'] })], { Q45284: 'Likelihood function' });

    expect(map.frontier[0].title).toBe('Likelihood function');
  });

  test('falls back to the bare qid when the cache has no title for it', () => {
    const map = buildMap([concept({ qid: 'Q1', adjacent: ['Q45284'] })]);

    expect(map.frontier[0].title).toBe('Q45284');
  });

  test('counts a neighbour once per concept that lists it, not once per list', () => {
    const map = buildMap([concept({ qid: 'Q1', prerequisites: ['Q9'], adjacent: ['Q9'] })]);

    expect(map.frontier[0].references).toBe(1);
  });
});

describe('formatMap', () => {
  test('labels each non-solid concept with its state', () => {
    const output = formatMap(buildMap([concept({ qid: 'Q2', title: 'Bayes', state: 'shallow' })]));

    expect(output).toContain('Bayes (shallow)');
  });

  test('says so when nothing has been probed yet', () => {
    expect(formatMap(buildMap([]))).toMatch(/no concepts/i);
  });
});

describe('loadConcepts and titlesFromCache', () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'map-'));
  });

  test('reads concept frontmatter from a learner directory', () => {
    const dir = join(root, 'learners', 'hiro', 'concepts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'Q812535--bayesian-inference.md'),
      '---\nqid: Q812535\ntitle: Bayesian inference\nstate: shaky\nprerequisites: [Q182505]\nadjacent: [Q45284]\n---\n\n## Gaps\n',
    );

    const concepts = loadConcepts(dir);

    expect(concepts).toEqual([
      {
        qid: 'Q812535',
        title: 'Bayesian inference',
        state: 'shaky',
        prerequisites: ['Q182505'],
        adjacent: ['Q45284'],
      },
    ]);
  });

  test('returns nothing for a learner who has no concepts directory yet', () => {
    expect(loadConcepts(join(root, 'nope'))).toEqual([]);
  });

  test('builds a qid to title index from the shared cache', () => {
    const cacheDir = join(root, 'cache');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'Q45284.md'), '---\nqid: Q45284\ntitle: Likelihood function\n---\n');

    expect(titlesFromCache(cacheDir)).toEqual({ Q45284: 'Likelihood function' });
  });

  test('also names neighbours that are only mentioned inside a cached article', () => {
    const cacheDir = join(root, 'cache');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      join(cacheDir, 'Q812535.md'),
      [
        '---',
        'qid: Q812535',
        'title: Bayesian inference',
        '---',
        '',
        '## Prerequisites (lead-section links)',
        '',
        "- [Q182505] Bayes' theorem",
        '',
        '## Adjacent (morelike)',
        '',
        '- [Q45284] Likelihood function',
        '',
      ].join('\n'),
    );

    expect(titlesFromCache(cacheDir)).toEqual({
      Q812535: 'Bayesian inference',
      Q182505: "Bayes' theorem",
      Q45284: 'Likelihood function',
    });
  });

  test('a cached article names itself even when another article mentions it', () => {
    const cacheDir = join(root, 'cache');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'Q1.md'), '---\nqid: Q45284\ntitle: Likelihood function\n---\n');
    writeFileSync(
      join(cacheDir, 'Q2.md'),
      '---\nqid: Q2\ntitle: Other\n---\n\n## Adjacent (morelike)\n\n- [Q45284] Likelihood fn (stale name)\n',
    );

    expect(titlesFromCache(cacheDir).Q45284).toBe('Likelihood function');
  });
});
