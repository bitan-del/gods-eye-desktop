/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BrainService — manages an Obsidian-compatible markdown vault used as persistent
 * agent memory. Reads/writes plain `.md` files with YAML frontmatter; no database.
 *
 * Storage layout (inside the chosen vault):
 *   <vault>/
 *   ├── agents/          # one note per agent — long-lived memory
 *   ├── conversations/   # per-session transcripts + summaries
 *   ├── tasks/           # task notes
 *   ├── people/          # auto-extracted entities
 *   └── daily/           # JARVIS daily journal
 */

import { app } from 'electron';
import { EventEmitter } from 'node:events';
import { promises as fs, watch as fsWatch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type {
  BrainFileChangeEvent,
  BrainFolderEntry,
  BrainFrontmatter,
  BrainGraph,
  BrainGraphEdge,
  BrainGraphNode,
  BrainNote,
  BrainNoteRef,
  BrainSearchHit,
  BrainStatus,
} from '@/common/types/brain';
import { ProcessConfig } from '@process/utils/initStorage';
import { mainError, mainLog, mainWarn } from '@process/utils/mainLogger';
import { parseMarkdown, serializeMarkdown } from './frontmatter';

const LOG_TAG = '[Brain]';

/** Subfolders the service guarantees exist when the vault is enabled. */
const CORE_SUBFOLDERS = ['agents', 'conversations', 'tasks', 'people', 'daily'] as const;

/** Recursion depth cap for listing + search, to keep huge vaults responsive. */
const MAX_WALK_DEPTH = 8;
const MAX_SEARCH_FILES = 2000;

export class BrainService {
  private static _instance: BrainService | null = null;

  static get instance(): BrainService {
    if (!this._instance) this._instance = new BrainService();
    return this._instance;
  }

  private readonly events = new EventEmitter();
  private watcher: FSWatcher | null = null;
  private currentVault: string | null = null;
  private initialised = false;

  /** Subscribe to file change events in the vault. */
  onChange(listener: (event: BrainFileChangeEvent) => void): () => void {
    this.events.on('change', listener);
    return () => {
      this.events.off('change', listener);
    };
  }

  /** Resolve where the vault lives on disk; may return null when feature is disabled. */
  async getVaultPath(): Promise<string | null> {
    const configured = await ProcessConfig.get('brain.vaultPath');
    if (configured && typeof configured === 'string') return configured;
    return null;
  }

  /** Default vault location when the user hasn't picked one. */
  defaultVaultPath(): string {
    // ~/Documents/Gods Eye Vault — lives alongside the user's docs; app can read+write freely.
    const docs = process.platform === 'win32' ? path.join(homedir(), 'Documents') : path.join(homedir(), 'Documents');
    try {
      const appName = app?.getName?.();
      return path.join(docs, `${appName ?? 'Gods Eye'} Vault`);
    } catch {
      return path.join(docs, 'Gods Eye Vault');
    }
  }

  /** Boot-time hook: read config, wire watcher, ensure subfolders exist. */
  async initialize(): Promise<void> {
    if (this.initialised) return;
    this.initialised = true;
    const enabled = (await ProcessConfig.get('brain.enabled')) ?? false;
    const vaultPath = await this.getVaultPath();
    if (!enabled || !vaultPath) {
      mainLog(LOG_TAG, 'disabled or no vault path configured');
      return;
    }
    try {
      await this.ensureVaultStructure(vaultPath);
      this.startWatching(vaultPath);
      mainLog(LOG_TAG, `initialized vault at ${vaultPath}`);
    } catch (err) {
      mainError(LOG_TAG, 'initialize failed', err);
    }
  }

  /** Apply a new vault path — creates structure, restarts watcher. */
  async setVaultPath(vaultPath: string): Promise<void> {
    const normalised = path.resolve(vaultPath);
    await ProcessConfig.set('brain.vaultPath', normalised);
    await this.ensureVaultStructure(normalised);
    this.startWatching(normalised);
  }

  /** Enable/disable the feature. Watcher is torn down when disabling. */
  async setEnabled(enabled: boolean): Promise<void> {
    await ProcessConfig.set('brain.enabled', enabled);
    if (!enabled) {
      this.stopWatching();
      return;
    }
    const vaultPath = await this.getVaultPath();
    if (vaultPath) {
      await this.ensureVaultStructure(vaultPath);
      this.startWatching(vaultPath);
    }
  }

  /** Current vault status — used by settings UI. */
  async getStatus(): Promise<BrainStatus> {
    const enabled = (await ProcessConfig.get('brain.enabled')) ?? false;
    const vaultPath = await this.getVaultPath();
    if (!vaultPath) {
      return { enabled, vaultPath: null, exists: false, writable: false, noteCount: 0 };
    }
    let exists = false;
    let writable = false;
    let noteCount = 0;
    try {
      const stat = await fs.stat(vaultPath);
      exists = stat.isDirectory();
    } catch {
      exists = false;
    }
    if (exists) {
      try {
        // Probe write-access with a sentinel file.
        const probe = path.join(vaultPath, '.gods-eye-probe');
        await fs.writeFile(probe, '', 'utf8');
        await fs.unlink(probe);
        writable = true;
      } catch {
        writable = false;
      }
      try {
        noteCount = (await this.walkMarkdown(vaultPath, MAX_WALK_DEPTH)).length;
      } catch {
        noteCount = 0;
      }
    }
    return { enabled, vaultPath, exists, writable, noteCount };
  }

  /** Ensure core subfolders exist. Safe to call repeatedly. */
  async ensureVaultStructure(vaultPath: string): Promise<void> {
    await fs.mkdir(vaultPath, { recursive: true });
    for (const sub of CORE_SUBFOLDERS) {
      await fs.mkdir(path.join(vaultPath, sub), { recursive: true });
    }
  }

  /** Read a note by vault-relative path. */
  async readNote(relPath: string): Promise<BrainNote | null> {
    const vault = await this.requireVault();
    const abs = this.resolveInVault(vault, relPath);
    try {
      const [raw, stat] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)]);
      const { frontmatter, body } = parseMarkdown(raw);
      return {
        path: toForwardSlash(path.relative(vault, abs)),
        mtime: stat.mtimeMs,
        size: stat.size,
        frontmatter,
        body,
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Write (or create) a note. Uses atomic rename to avoid half-written files. */
  async writeNote(relPath: string, frontmatter: BrainFrontmatter, body: string): Promise<BrainNoteRef> {
    const vault = await this.requireVault();
    const abs = this.resolveInVault(vault, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const raw = serializeMarkdown(frontmatter, body);
    const tmp = `${abs}.${process.pid}.tmp`;
    await fs.writeFile(tmp, raw, 'utf8');
    await fs.rename(tmp, abs);
    const stat = await fs.stat(abs);
    return {
      path: toForwardSlash(path.relative(vault, abs)),
      mtime: stat.mtimeMs,
      size: stat.size,
    };
  }

  /** Append a markdown block to an existing note; creates the note when missing. */
  async appendToNote(relPath: string, markdown: string): Promise<BrainNoteRef> {
    const existing = await this.readNote(relPath);
    if (!existing) {
      return this.writeNote(relPath, {}, markdown.endsWith('\n') ? markdown : `${markdown}\n`);
    }
    const sep = existing.body.endsWith('\n') ? '' : '\n';
    const nextBody = `${existing.body}${sep}\n${markdown}${markdown.endsWith('\n') ? '' : '\n'}`;
    return this.writeNote(relPath, existing.frontmatter, nextBody);
  }

  /** Delete a note. Idempotent — returns false when the file is already gone. */
  async deleteNote(relPath: string): Promise<boolean> {
    const vault = await this.requireVault();
    const abs = this.resolveInVault(vault, relPath);
    try {
      await fs.unlink(abs);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  /** List the direct children of a folder (relative to the vault root). */
  async listFolder(relPath = ''): Promise<BrainFolderEntry[]> {
    const vault = await this.requireVault();
    const abs = relPath ? this.resolveInVault(vault, relPath) : vault;
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const out: BrainFolderEntry[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // skip .obsidian, .DS_Store, etc.
      const fullPath = path.join(abs, entry.name);
      const rel = toForwardSlash(path.relative(vault, fullPath));
      if (entry.isDirectory()) {
        out.push({ path: rel, name: entry.name, kind: 'folder', mtime: 0 });
      } else if (entry.name.endsWith('.md')) {
        try {
          const stat = await fs.stat(fullPath);
          out.push({
            path: rel,
            name: entry.name.replace(/\.md$/, ''),
            kind: 'note',
            mtime: stat.mtimeMs,
          });
        } catch {
          /* ignore stat failures */
        }
      }
    }
    out.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return out;
  }

  /**
   * Load a teammate agent's persistent memory note — returns the raw markdown
   * body of `agents/<agentName>.md`, or null when brain is disabled, the note
   * doesn't exist, or the `brain.injectAgentMemory` preference is off.
   *
   * Never throws: memory injection must be a best-effort enhancement, not a
   * hard dependency of the team runtime.
   */
  async loadAgentMemory(agentName: string): Promise<string | null> {
    try {
      const enabled = (await ProcessConfig.get('brain.enabled')) ?? false;
      if (!enabled) return null;
      const inject = (await ProcessConfig.get('brain.injectAgentMemory')) ?? true;
      if (!inject) return null;
      const vault = await this.getVaultPath();
      if (!vault) return null;
      const safeName = agentName.replace(/[\\/]/g, '_');
      const note = await this.readNote(path.join('agents', `${safeName}.md`));
      return note?.body?.trim() ? note.body : null;
    } catch (err) {
      mainWarn(LOG_TAG, `loadAgentMemory failed for ${agentName}`, err);
      return null;
    }
  }

  /**
   * Case-insensitive substring search across note bodies + titles. Returns the
   * top `limit` hits ranked by a simple frequency score.
   */
  async search(query: string, limit = 20): Promise<BrainSearchHit[]> {
    const vault = await this.requireVault();
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const files = await this.walkMarkdown(vault, MAX_WALK_DEPTH, MAX_SEARCH_FILES);
    const hits: BrainSearchHit[] = [];
    for (const file of files) {
      try {
        const raw = await fs.readFile(file, 'utf8');
        const lower = raw.toLowerCase();
        let idx = lower.indexOf(needle);
        if (idx < 0) continue;
        let count = 0;
        while (idx >= 0) {
          count++;
          idx = lower.indexOf(needle, idx + needle.length);
        }
        const titleMatch = path.basename(file).toLowerCase().includes(needle);
        const score = count + (titleMatch ? 5 : 0);
        const firstIdx = lower.indexOf(needle);
        const start = Math.max(0, firstIdx - 60);
        const end = Math.min(raw.length, firstIdx + needle.length + 60);
        const snippet = raw.slice(start, end).replace(/\s+/g, ' ');
        hits.push({
          path: toForwardSlash(path.relative(vault, file)),
          title: path.basename(file, '.md'),
          snippet,
          score,
        });
      } catch {
        /* skip unreadable files */
      }
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  /**
   * Build a link graph across the whole vault — one node per note, edges for
   * `[[wiki-links]]` and relative markdown links (`[text](path.md)`).
   *
   * Cheap enough for a few thousand notes; for huge vaults we cap at
   * `MAX_SEARCH_FILES`. Links that don't resolve to a known note are dropped
   * (we're not tracking orphans).
   */
  async getGraph(): Promise<BrainGraph> {
    const vault = await this.getVaultPath();
    if (!vault) return { nodes: [], edges: [] };

    const files = await this.walkMarkdown(vault, MAX_WALK_DEPTH, MAX_SEARCH_FILES);

    // Build a basename → vault-relative-path index so `[[Foo]]` can resolve to `agents/Foo.md`.
    // On collision we keep the first one seen (Obsidian's behaviour too — users avoid same-basename clashes).
    const byBasename = new Map<string, string>();
    const byPath = new Map<string, string>(); // normalised vault-relative → canonical
    const nodes: BrainGraphNode[] = [];

    for (const abs of files) {
      const rel = toForwardSlash(path.relative(vault, abs));
      const base = path.basename(rel, '.md').toLowerCase();
      byPath.set(rel.toLowerCase(), rel);
      if (!byBasename.has(base)) byBasename.set(base, rel);
      nodes.push({
        id: rel,
        name: path.basename(rel, '.md'),
        folder: rel.includes('/') ? rel.split('/', 1)[0] : '',
        degree: 0,
      });
    }

    // Resolve a link target string (from wiki-link body or markdown href) to a
    // canonical vault-relative path. Returns null when nothing matches.
    const resolve = (fromRel: string, raw: string): string | null => {
      // Strip anchors and display text: `Foo#section|Display` → `Foo`
      const cleaned = raw.split('#')[0].split('|')[0].trim();
      if (!cleaned) return null;
      // Explicit .md extension? Treat as a path.
      const withExt = cleaned.endsWith('.md') ? cleaned : `${cleaned}.md`;
      // 1. Relative to the current note's folder.
      const fromDir = path.posix.dirname(fromRel);
      const rel1 = path.posix.normalize(path.posix.join(fromDir, withExt));
      const hit1 = byPath.get(rel1.toLowerCase());
      if (hit1) return hit1;
      // 2. Absolute-from-vault.
      const rel2 = path.posix.normalize(withExt.replace(/^\/+/, ''));
      const hit2 = byPath.get(rel2.toLowerCase());
      if (hit2) return hit2;
      // 3. Basename match (Obsidian wiki-link default).
      const hit3 = byBasename.get(path.basename(cleaned, '.md').toLowerCase());
      if (hit3) return hit3;
      return null;
    };

    const wikiLink = /\[\[([^\]\n]+)\]\]/g;
    const mdLink = /\[[^\]\n]*\]\(([^)\s]+)\)/g;

    const edgeSet = new Set<string>();
    const edges: BrainGraphEdge[] = [];
    const nodeById = new Map(nodes.map((n) => [n.id, n]));

    for (const node of nodes) {
      const abs = path.join(vault, node.id);
      let raw: string;
      try {
        raw = await fs.readFile(abs, 'utf8');
      } catch {
        continue;
      }
      const seen = new Set<string>();
      const addEdge = (targetRaw: string): void => {
        const target = resolve(node.id, targetRaw);
        if (!target || target === node.id) return;
        if (seen.has(target)) return;
        seen.add(target);
        // Canonical edge key (undirected): sort the endpoints.
        const key = node.id < target ? `${node.id}\u0000${target}` : `${target}\u0000${node.id}`;
        if (edgeSet.has(key)) return;
        edgeSet.add(key);
        edges.push({ source: node.id, target });
        const a = nodeById.get(node.id);
        const b = nodeById.get(target);
        if (a) a.degree += 1;
        if (b) b.degree += 1;
      };

      let m: RegExpExecArray | null;
      wikiLink.lastIndex = 0;
      while ((m = wikiLink.exec(raw)) !== null) addEdge(m[1]);
      mdLink.lastIndex = 0;
      while ((m = mdLink.exec(raw)) !== null) {
        const href = m[1];
        // Skip URLs and anchors-only links.
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) continue;
        addEdge(href);
      }
    }

    return { nodes, edges };
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async requireVault(): Promise<string> {
    const vault = await this.getVaultPath();
    if (!vault) throw new Error('Brain vault is not configured. Set one in Settings → Brain.');
    return vault;
  }

  /**
   * Resolve a vault-relative path into an absolute path, defending against
   * directory traversal (`..`). Throws when the target escapes the vault.
   */
  private resolveInVault(vault: string, relPath: string): string {
    const clean = relPath.replace(/^[/\\]+/, '');
    const abs = path.resolve(vault, clean);
    const relCheck = path.relative(vault, abs);
    if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
      throw new Error(`Path escapes vault: ${relPath}`);
    }
    // Enforce .md extension when writing/reading a note (still allow folder listing callers to pass without).
    return abs;
  }

  /** Recursively list .md files under `root`. */
  private async walkMarkdown(root: string, maxDepth: number, cap = Infinity): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > maxDepth || out.length >= cap) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full, depth + 1);
          if (out.length >= cap) return;
        } else if (entry.name.endsWith('.md')) {
          out.push(full);
          if (out.length >= cap) return;
        }
      }
    };
    await walk(root, 0);
    return out;
  }

  private startWatching(vaultPath: string): void {
    this.stopWatching();
    this.currentVault = vaultPath;
    try {
      // `recursive: true` is supported on macOS + Windows; on Linux it falls back
      // to watching the root dir only. Good enough for the default scenario.
      this.watcher = fsWatch(vaultPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const rel = toForwardSlash(String(filename));
        if (!rel.endsWith('.md')) return;
        void this.emitChangeForPath(vaultPath, rel);
      });
      this.watcher.on('error', (err) => {
        mainWarn(LOG_TAG, 'watcher error', err);
      });
    } catch (err) {
      mainWarn(LOG_TAG, 'failed to start watcher', err);
    }
  }

  private stopWatching(): void {
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        /* ignore */
      }
      this.watcher = null;
    }
    this.currentVault = null;
  }

  private async emitChangeForPath(vault: string, relPath: string): Promise<void> {
    const abs = path.join(vault, relPath);
    let kind: BrainFileChangeEvent['kind'] = 'updated';
    try {
      await fs.stat(abs);
    } catch {
      kind = 'deleted';
    }
    this.events.emit('change', { path: relPath, kind } satisfies BrainFileChangeEvent);
  }
}

function toForwardSlash(p: string): string {
  return p.split(path.sep).join('/');
}

/** Convenience singleton re-export. */
export const brainService = BrainService.instance;
