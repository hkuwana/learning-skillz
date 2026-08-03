/**
 * A deliberately tiny frontmatter reader/writer.
 *
 * Concept and cache files are meant to be edited by hand, so the format they use
 * is a flat `key: value` block plus inline `[a, b]` lists — nothing that needs a
 * real YAML parser. Keeping the parser this small is what lets the files stay
 * human-owned: anything it can't represent doesn't belong in frontmatter.
 */

const FENCE = '---';

function parseScalar(raw) {
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw;
}

export function parseFrontmatter(text) {
  const lines = String(text).split('\n');
  if (lines[0]?.trim() !== FENCE) {
    return { data: {}, body: String(text).trim() };
  }

  const end = lines.indexOf(FENCE, 1);
  if (end === -1) {
    return { data: {}, body: String(text).trim() };
  }

  const data = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;

    const [, key, rest] = match;
    const raw = rest.trim();

    if (raw.startsWith('[') && raw.endsWith(']')) {
      const inner = raw.slice(1, -1).trim();
      data[key] = inner === '' ? [] : inner.split(',').map((item) => item.trim()).filter(Boolean);
    } else {
      data[key] = parseScalar(raw);
    }
  }

  return { data, body: lines.slice(end + 1).join('\n').trim() };
}

export function stringifyFrontmatter(data, body = '') {
  const lines = Object.entries(data).map(([key, value]) =>
    Array.isArray(value) ? `${key}: [${value.join(', ')}]` : `${key}: ${value}`,
  );

  return `${FENCE}\n${lines.join('\n')}\n${FENCE}\n\n${String(body).trim()}\n`;
}
