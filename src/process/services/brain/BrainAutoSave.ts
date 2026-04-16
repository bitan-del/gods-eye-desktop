/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BrainAutoSave — listens to conversation turn-completion events and
 * automatically writes a summary note to the Brain vault under
 * `conversations/<name>.md`.
 *
 * Only activates when `brain.enabled` AND `brain.autoSummarize` are both true.
 * Each conversation gets one note that is appended to on every completed turn.
 */

import type { IConversationTurnCompletedEvent } from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';
import type { BrainFrontmatter } from '@/common/types/brain';
import { getDatabase } from '@process/services/database';
import { onTurnCompleted } from '@process/task/ConversationTurnCompletionService';
import { ProcessConfig } from '@process/utils/initStorage';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { brainService } from './BrainService';

const LOG_TAG = '[BrainAutoSave]';

/** Conversations already saved in this session — avoids duplicate writes per turn. */
const savedTurns = new Map<string, number>();

/** Minimum interval (ms) between saves for the same conversation. */
const SAVE_COOLDOWN_MS = 10_000;

/** Max recent messages to include in the note body. */
const MAX_MESSAGES = 30;

/**
 * Extract displayable text from a message content field.
 * Messages have varied shapes: string, { content: string }, { text: string }, etc.
 */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!content || typeof content !== 'object') return '';
  const obj = content as Record<string, unknown>;
  if (typeof obj.content === 'string') return obj.content;
  if (typeof obj.text === 'string') return obj.text;
  // ACP tool call summary
  if (obj.update && typeof obj.update === 'object') {
    const update = obj.update as Record<string, unknown>;
    if (typeof update.title === 'string') return `[Tool] ${update.title}`;
  }
  return '';
}

/**
 * Sanitise a conversation name into a safe filename (no path separators, no
 * special characters that would break Obsidian, limited length).
 */
function safeFilename(name: string): string {
  return name
    .replace(/[\\/:<>"?*|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

async function isAutoSaveEnabled(): Promise<boolean> {
  const enabled = (await ProcessConfig.get('brain.enabled')) ?? false;
  if (!enabled) return false;
  const auto = (await ProcessConfig.get('brain.autoSummarize')) ?? false;
  return Boolean(auto);
}

async function handleTurnCompleted(event: IConversationTurnCompletedEvent): Promise<void> {
  // Only save when the agent is waiting for user input (turn is complete)
  if (event.state !== 'ai_waiting_input') return;

  const conversationId = event.sessionId;
  if (!conversationId) return;

  // Check cooldown
  const lastSave = savedTurns.get(conversationId) ?? 0;
  if (Date.now() - lastSave < SAVE_COOLDOWN_MS) return;

  // Check feature flags
  if (!(await isAutoSaveEnabled())) return;

  // Check vault is configured
  const vaultPath = await brainService.getVaultPath();
  if (!vaultPath) return;

  try {
    // Load conversation metadata
    const db = await getDatabase();
    const convResult = db.getConversation(conversationId);
    if (!convResult.success || !convResult.data) return;
    const conversation = convResult.data as TChatConversation;

    // Load recent messages
    const msgsResult = db.getConversationMessages(conversationId, 0, MAX_MESSAGES, 'ASC');
    const messages = msgsResult.data ?? [];
    if (messages.length === 0) return;

    // Build note content
    const convName = conversation.name || conversationId.slice(0, 8);
    const extra = (conversation.extra ?? {}) as Record<string, unknown>;
    const backend = (extra.backend as string) || conversation.type || 'unknown';
    const workspace = (extra.workspace as string) || '';

    const frontmatter: BrainFrontmatter = {
      title: convName,
      type: 'conversation',
      backend,
      conversationId,
      created: new Date(conversation.createTime ?? Date.now()).toISOString(),
      updated: new Date().toISOString(),
      ...(workspace ? { workspace } : {}),
      ...(event.model?.useModel ? { model: event.model.useModel } : {}),
    };

    // Format messages into readable markdown
    const lines: string[] = [];
    for (const msg of messages) {
      const text = extractText(msg.content);
      if (!text.trim()) continue;

      const role = msg.position === 'right' ? '👤 User' : '🤖 Agent';
      const time = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString() : '';
      const timeStr = time ? ` _(${time})_` : '';

      // Truncate very long messages
      const truncated = text.length > 500 ? `${text.slice(0, 500)}…` : text;
      lines.push(`**${role}**${timeStr}\n${truncated}\n`);
    }

    if (lines.length === 0) return;

    const body = lines.join('\n---\n\n');
    const filename = `conversations/${safeFilename(convName)}.md`;

    await brainService.writeNote(filename, frontmatter, body);
    savedTurns.set(conversationId, Date.now());

    mainLog(LOG_TAG, `saved ${messages.length} messages to ${filename}`);
  } catch (err) {
    mainWarn(LOG_TAG, `failed to auto-save conversation ${conversationId}`, err);
  }
}

let unsubscribe: (() => void) | null = null;

/** Start listening for turn-completion events. Call once at boot. */
export function initBrainAutoSave(): void {
  unsubscribe?.();
  // Use main-process hook (buildEmitter.on() only works in renderer)
  unsubscribe = onTurnCompleted(handleTurnCompleted);
  mainLog(LOG_TAG, 'initialized');
}

/** Clean up the listener. */
export function disposeBrainAutoSave(): void {
  unsubscribe?.();
  unsubscribe = null;
}
