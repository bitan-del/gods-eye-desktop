/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { GeminiLiveService } from './services/GeminiLiveService';
import { WakeWordService } from './services/WakeWordService';

export function initJarvisLiveBridge(): void {
  // Wire up the event emitter so GeminiLiveService can push events to the renderer
  GeminiLiveService.setEventHandler((event) => {
    ipcBridge.jarvisLive.event.emit(event);
  });

  ipcBridge.jarvisLive.connect.provider(async (request) => {
    return GeminiLiveService.connect(request);
  });

  ipcBridge.jarvisLive.sendAudio.provider(async (chunk) => {
    GeminiLiveService.sendAudio(chunk);
  });

  ipcBridge.jarvisLive.disconnect.provider(async () => {
    GeminiLiveService.disconnect();
  });

  // Wake word: renderer sends short audio clips, main process transcribes via Gemini
  ipcBridge.jarvisLive.checkWakeWord.provider(async (request) => {
    return WakeWordService.checkAudio(request);
  });
}
