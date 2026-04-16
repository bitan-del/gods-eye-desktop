/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Brain — Obsidian-compatible local markdown vault used as persistent agent memory.
 *
 * A "brain" is just a folder on disk. Each note is a plain `.md` file optionally
 * prefixed with a YAML frontmatter block. Subfolders organise notes by kind
 * (`agents/`, `conversations/`, `tasks/`, `people/`, `daily/`).
 */

/** Frontmatter value — intentionally narrow: strings, numbers, booleans, and arrays thereof. */
export type BrainFrontmatterValue = string | number | boolean | string[] | null;

/** Parsed YAML frontmatter. Keys are free-form; values stay simple. */
export type BrainFrontmatter = Record<string, BrainFrontmatterValue>;

/** A note's minimal on-disk identity: the repo-relative path (forward-slash) and file mtime. */
export interface BrainNoteRef {
  /** Vault-relative path, e.g. `agents/Profile Analyst.md`. Always uses `/`. */
  path: string;
  /** File modification time (ms since epoch). */
  mtime: number;
  /** File size in bytes. */
  size: number;
}

/** A fully loaded note — frontmatter + markdown body. */
export interface BrainNote extends BrainNoteRef {
  /** Parsed YAML frontmatter. Empty object when the file has no frontmatter block. */
  frontmatter: BrainFrontmatter;
  /** Markdown body (everything after the closing `---`). */
  body: string;
}

/** A folder entry when listing. */
export interface BrainFolderEntry {
  /** Vault-relative path. */
  path: string;
  /** Display name (basename, no extension for files). */
  name: string;
  kind: 'note' | 'folder';
  mtime: number;
}

/** Vault status — used by settings UI to show health. */
export interface BrainStatus {
  enabled: boolean;
  vaultPath: string | null;
  exists: boolean;
  writable: boolean;
  noteCount: number;
}

/** Search hit returned by `brain.search`. */
export interface BrainSearchHit {
  path: string;
  title: string;
  /** Snippet of surrounding context with the match. */
  snippet: string;
  /** 0-based score; higher = better. */
  score: number;
}

/** File watcher event published to the renderer. */
export interface BrainFileChangeEvent {
  /** Vault-relative path of the changed file. */
  path: string;
  kind: 'created' | 'updated' | 'deleted';
}

/** A node in the knowledge graph. One per note. */
export interface BrainGraphNode {
  /** Stable id — the vault-relative path, e.g. `agents/Foo.md`. */
  id: string;
  /** Display name (basename, no extension). */
  name: string;
  /** Top-level folder bucket, used for colouring (e.g. `agents`, `conversations`). */
  folder: string;
  /** Number of outgoing + incoming links. Drives node radius. */
  degree: number;
}

/** An undirected link between two notes. */
export interface BrainGraphEdge {
  /** Source note path. */
  source: string;
  /** Target note path. */
  target: string;
}

/** Full graph payload returned by `brain.get-graph`. */
export interface BrainGraph {
  nodes: BrainGraphNode[];
  edges: BrainGraphEdge[];
}
