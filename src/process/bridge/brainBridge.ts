/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * brainBridge — thin adapter that exposes the `BrainService` to the renderer
 * through the IPC channels declared in `src/common/adapter/ipcBridge.ts`.
 */

import { BrowserWindow, dialog } from 'electron';
import { ipcBridge } from '@/common';
import { brainService } from '@process/services/brain/BrainService';

let unsubscribe: (() => void) | null = null;

export function initBrainBridge(): void {
  ipcBridge.brain.getStatus.provider(() => brainService.getStatus());
  ipcBridge.brain.getVaultPath.provider(() => brainService.getVaultPath());
  ipcBridge.brain.defaultVaultPath.provider(() => Promise.resolve(brainService.defaultVaultPath()));

  ipcBridge.brain.setVaultPath.provider(async ({ vaultPath }) => {
    await brainService.setVaultPath(vaultPath);
  });

  ipcBridge.brain.setEnabled.provider(async ({ enabled }) => {
    await brainService.setEnabled(enabled);
  });

  ipcBridge.brain.pickVaultFolder.provider(async () => {
    const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const opts = {
      title: 'Choose Brain vault folder',
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory' | 'promptToCreate'>,
      defaultPath: brainService.defaultVaultPath(),
    };
    const res = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });

  ipcBridge.brain.ensureVault.provider(async ({ vaultPath }) => {
    const target = vaultPath ?? brainService.defaultVaultPath();
    await brainService.ensureVaultStructure(target);
    return target;
  });

  ipcBridge.brain.listFolder.provider(({ path }) => brainService.listFolder(path ?? ''));
  ipcBridge.brain.readNote.provider(({ path }) => brainService.readNote(path));
  ipcBridge.brain.writeNote.provider(({ path, frontmatter, body }) => brainService.writeNote(path, frontmatter, body));
  ipcBridge.brain.appendToNote.provider(({ path, markdown }) => brainService.appendToNote(path, markdown));
  ipcBridge.brain.deleteNote.provider(({ path }) => brainService.deleteNote(path));
  ipcBridge.brain.search.provider(({ query, limit }) => brainService.search(query, limit));
  ipcBridge.brain.getGraph.provider(() => brainService.getGraph());

  // Forward file change events from the watcher to the renderer.
  unsubscribe?.();
  unsubscribe = brainService.onChange((event) => {
    ipcBridge.brain.fileChanged.emit(event);
  });
}

export function disposeBrainBridge(): void {
  unsubscribe?.();
  unsubscribe = null;
}
