/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Minimal YAML frontmatter parser — no external dependency.
 *
 * Supported subset (everything Obsidian produces by default):
 *   key: value                     → string
 *   key: 42                        → number
 *   key: true | false              → boolean
 *   key: null | ~                  → null
 *   key: [a, b, c]                 → string[]
 *   key:                           → string[]
 *     - a
 *     - b
 *   "key with spaces": "value"     → quoted string
 *
 * Anything more exotic (nested maps, anchors, multi-line strings) falls back to
 * a raw-string value so the file round-trips losslessly on save.
 */

import type { BrainFrontmatter, BrainFrontmatterValue } from '@/common/types/brain';

const FRONTMATTER_FENCE = '---';

export interface ParsedMarkdown {
  frontmatter: BrainFrontmatter;
  body: string;
}

/**
 * Parse a markdown file that may start with a YAML frontmatter block.
 * Leaves `frontmatter` empty when there is no block.
 */
export function parseMarkdown(raw: string): ParsedMarkdown {
  if (!raw.startsWith(FRONTMATTER_FENCE)) {
    return { frontmatter: {}, body: raw };
  }
  const newlineAfterOpen = raw.indexOf('\n');
  if (newlineAfterOpen < 0) {
    return { frontmatter: {}, body: raw };
  }
  // Find the closing fence — must be on its own line.
  const closeIdx = raw.indexOf(`\n${FRONTMATTER_FENCE}`, newlineAfterOpen);
  if (closeIdx < 0) {
    return { frontmatter: {}, body: raw };
  }
  const yaml = raw.slice(newlineAfterOpen + 1, closeIdx);
  const restStart = closeIdx + 1 + FRONTMATTER_FENCE.length;
  // Skip one trailing newline after the closing fence when present.
  const body = raw[restStart] === '\n' ? raw.slice(restStart + 1) : raw.slice(restStart);
  return { frontmatter: parseYamlLite(yaml), body };
}

/** Serialize frontmatter + body back into a markdown file. Omits the block when empty. */
export function serializeMarkdown(frontmatter: BrainFrontmatter, body: string): string {
  const keys = Object.keys(frontmatter);
  if (keys.length === 0) {
    return body;
  }
  const lines = [FRONTMATTER_FENCE];
  for (const key of keys) {
    const value = frontmatter[key];
    lines.push(serializeValue(key, value));
  }
  lines.push(FRONTMATTER_FENCE);
  lines.push('');
  return `${lines.join('\n')}${body}`;
}

function serializeValue(key: string, value: BrainFrontmatterValue): string {
  const safeKey = /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
  if (value === null) return `${safeKey}: null`;
  if (typeof value === 'boolean' || typeof value === 'number') return `${safeKey}: ${String(value)}`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${safeKey}: []`;
    return `${safeKey}: [${value.map((v) => quoteIfNeeded(v)).join(', ')}]`;
  }
  return `${safeKey}: ${quoteIfNeeded(value)}`;
}

function quoteIfNeeded(value: string): string {
  if (/^[A-Za-z0-9_\-./ ]+$/.test(value) && !/^\s|\s$/.test(value)) return value;
  return JSON.stringify(value);
}

/** Parse the tiny YAML subset described in the file header. */
function parseYamlLite(yaml: string): BrainFrontmatter {
  const out: BrainFrontmatter = {};
  const lines = yaml.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) {
      i++;
      continue;
    }
    // "key: value" or "key:" (list follows)
    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (!match) {
      i++;
      continue;
    }
    const rawKey = match[1].trim();
    const key = rawKey.startsWith('"') && rawKey.endsWith('"') ? JSON.parse(rawKey) : rawKey;
    const rawValue = match[2];
    if (rawValue.trim() === '') {
      // Collect following `  - item` list entries.
      const list: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
        list.push(parseScalar(lines[j].replace(/^\s*-\s+/, '').trim()) as string);
        j++;
      }
      if (list.length > 0) {
        out[key] = list;
        i = j;
        continue;
      }
      out[key] = '';
      i++;
      continue;
    }
    out[key] = parseScalar(rawValue.trim());
    i++;
  }
  return out;
}

function parseScalar(raw: string): BrainFrontmatterValue {
  if (raw === '') return '';
  if (raw === 'null' || raw === '~') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  // Inline array: [a, "b c", 3]
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (inner === '') return [];
    const items = splitTopLevelCommas(inner);
    return items.map((s) => {
      const val = parseScalar(s.trim());
      return typeof val === 'string' ? val : String(val);
    });
  }
  // Quoted string
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    try {
      return JSON.parse(raw.startsWith("'") ? `"${raw.slice(1, -1).replace(/"/g, '\\"')}"` : raw);
    } catch {
      return raw.slice(1, -1);
    }
  }
  // Number
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
  // Bare string
  return raw;
}

/** Split `a, "b, c", d` into `['a', '"b, c"', 'd']` respecting quoted commas. */
function splitTopLevelCommas(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let buf = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      buf += ch;
      if (ch === quote && input[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim() !== '') out.push(buf);
  return out;
}
