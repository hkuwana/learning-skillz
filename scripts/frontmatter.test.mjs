import { describe, expect, test } from 'vitest';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.mjs';

describe('parseFrontmatter', () => {
  test('reads scalar keys and returns the remaining body', () => {
    const text = ['---', 'qid: Q812535', 'title: Bayesian inference', '---', '', '## Gaps', '- none'].join('\n');

    const { data, body } = parseFrontmatter(text);

    expect(data.qid).toBe('Q812535');
    expect(data.title).toBe('Bayesian inference');
    expect(body).toBe('## Gaps\n- none');
  });

  test('reads bare integers as numbers so revids compare correctly', () => {
    const { data } = parseFrontmatter('---\nrevid: 1364298666\nsessions: 1\n---\n');

    expect(data.revid).toBe(1364298666);
    expect(data.sessions).toBe(1);
  });

  test('reads inline lists into arrays', () => {
    const { data } = parseFrontmatter('---\nprerequisites: [Q182505, Q3711784]\nadjacent: []\n---\n');

    expect(data.prerequisites).toEqual(['Q182505', 'Q3711784']);
    expect(data.adjacent).toEqual([]);
  });

  test('keeps colons inside a value', () => {
    const { data } = parseFrontmatter('---\nurl: https://en.wikipedia.org/wiki/Bayesian_inference\n---\n');

    expect(data.url).toBe('https://en.wikipedia.org/wiki/Bayesian_inference');
  });

  test('returns empty data when the document has no frontmatter', () => {
    const { data, body } = parseFrontmatter('# Just a heading\n');

    expect(data).toEqual({});
    expect(body).toBe('# Just a heading');
  });
});

describe('stringifyFrontmatter', () => {
  test('round-trips through parseFrontmatter', () => {
    const data = { qid: 'Q812535', revid: 1364298666, prerequisites: ['Q182505'], adjacent: [] };

    const round = parseFrontmatter(stringifyFrontmatter(data, '## Gaps'));

    expect(round.data).toEqual(data);
    expect(round.body).toBe('## Gaps');
  });
});
