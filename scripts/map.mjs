/**
 * The end-of-session map: solid / shaky / frontier.
 *
 * This is computed entirely from files already on disk — concept frontmatter plus
 * the shared Wikipedia cache — so it costs nothing and can be run any time,
 * including by the learner without a model in the loop. That matters: an open
 * learner model is only open if you can look at it whenever you like.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from './frontmatter.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE_DIR = join(REPO_ROOT, 'cache', 'wikipedia');

function readFrontmatterFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => parseFrontmatter(readFileSync(join(dir, name), 'utf8')).data);
}

/** Every concept file for one learner, reduced to the fields the map needs. */
export function loadConcepts(conceptsDir) {
  return readFrontmatterFiles(conceptsDir)
    .filter((data) => data.qid)
    .map((data) => ({
      qid: String(data.qid),
      title: data.title ?? String(data.qid),
      state: data.state ?? 'untested',
      prerequisites: data.prerequisites ?? [],
      adjacent: data.adjacent ?? [],
    }));
}

/**
 * QID -> article title, for naming frontier entries.
 *
 * Frontier concepts are by definition ones with no file of their own, so their
 * titles have to come from somewhere else: the neighbour bullets inside the
 * articles that point at them. A cached article's own frontmatter wins over any
 * name a neighbour gave it, since link text can lag a rename.
 */
export function titlesFromCache(cacheDir = CACHE_DIR) {
  if (!existsSync(cacheDir)) return {};

  const fromNeighbours = {};
  const fromFrontmatter = {};

  for (const name of readdirSync(cacheDir).filter((n) => n.endsWith('.md')).sort()) {
    const text = readFileSync(join(cacheDir, name), 'utf8');
    const { data } = parseFrontmatter(text);
    if (data.qid && data.title) fromFrontmatter[String(data.qid)] = data.title;
    for (const [, qid, title] of text.matchAll(/^- \[(Q\d+)\] (.+)$/gm)) {
      fromNeighbours[qid] ??= title.trim();
    }
  }

  return { ...fromNeighbours, ...fromFrontmatter };
}

/**
 * Pure. The frontier is the interesting part: neighbours that the concepts you
 * *have* probed keep pointing at, but which have no file yet. Ranking by how many
 * of your concepts reference a QID makes the next thing worth studying obvious.
 */
export function buildMap(concepts, titles = {}) {
  const known = new Set(concepts.map((c) => c.qid));

  const references = new Map();
  for (const concept of concepts) {
    // Dedupe within a concept: listing a neighbour as both prerequisite and
    // adjacent is one concept pointing at it, not two.
    for (const qid of new Set([...concept.prerequisites, ...concept.adjacent])) {
      if (known.has(qid)) continue;
      references.set(qid, (references.get(qid) ?? 0) + 1);
    }
  }

  const frontier = [...references.entries()]
    .map(([qid, count]) => ({ qid, title: titles[qid] ?? qid, references: count }))
    .sort((a, b) => b.references - a.references || a.title.localeCompare(b.title));

  return {
    solid: concepts.filter((c) => c.state === 'solid'),
    shaky: concepts.filter((c) => c.state !== 'solid'),
    frontier,
  };
}

function section(heading, lines) {
  return [heading, ...(lines.length === 0 ? ['  —'] : lines)].join('\n');
}

export function formatMap(map) {
  if (map.solid.length === 0 && map.shaky.length === 0) {
    return 'No concepts probed yet. Run /understand <topic> to start one.';
  }

  return [
    section('SOLID', map.solid.map((c) => `  ${c.title}`)),
    '',
    section('SHAKY', map.shaky.map((c) => `  ${c.title} (${c.state})`)),
    '',
    section(
      'FRONTIER',
      map.frontier.map((f) => `  ${f.title}${f.references > 1 ? `  ×${f.references}` : ''}`),
    ),
  ].join('\n');
}

// --- CLI ---------------------------------------------------------------------

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  const learner = argv[2];
  if (!learner) {
    console.error('usage: node scripts/map.mjs <learner>');
    process.exitCode = 1;
  } else {
    const conceptsDir = join(REPO_ROOT, 'learners', learner, 'concepts');
    console.log(formatMap(buildMap(loadConcepts(conceptsDir), titlesFromCache())));
  }
}
