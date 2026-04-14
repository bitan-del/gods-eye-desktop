/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared JARVIS action handler used by both JarvisFloat and JarvisPage.
 * Processes action events from the main process (GeminiLiveService)
 * and executes them in the renderer context.
 */

import { ipcBridge } from '@/common';
import { ConfigStorage, type TProviderWithModel } from '@/common/config/storage';
import type { JarvisAction } from '@/common/types/speech';
import type { NavigateFunction } from 'react-router-dom';

/**
 * Handle a JARVIS action event from the main process.
 * Called when GeminiLiveService emits an action via tool execution.
 */
export async function handleJarvisAction(action: JarvisAction, navigate: NavigateFunction): Promise<void> {
  const { name, params } = action;

  switch (name) {
    case 'navigate_to_conversation': {
      const convId = params?.conversationId as string;
      if (convId) navigate(`/conversation/${convId}`);
      break;
    }

    case 'open_new_conversation': {
      navigate('/');
      break;
    }

    case 'create_task': {
      const prompt = params?.prompt as string;
      const title = (params?.title as string) || 'JARVIS Task';
      if (!prompt) break;

      try {
        // Resolve the user's Gemini model for the conversation
        const model = await resolveDefaultModel();

        const conv = await ipcBridge.conversation.create.invoke({
          type: 'gemini',
          name: title,
          model,
          extra: {},
        });

        // Store the initial message so the conversation auto-sends it on mount
        sessionStorage.setItem(
          `gemini_initial_message_${conv.id}`,
          JSON.stringify({ input: prompt, files: [] }),
        );

        // Navigate to the new conversation
        navigate(`/conversation/${conv.id}`);
        console.log(`[JARVIS] Created task "${title}" → ${conv.id}`);
      } catch (err) {
        console.error('[JARVIS] create_task failed:', err);
      }
      break;
    }

    case 'send_to_conversation': {
      const convId = params?.conversationId as string;
      const message = params?.message as string;
      if (!convId || !message) break;

      try {
        // Send the message via IPC — the agent will process it
        await ipcBridge.acpConversation.sendMessage.invoke({
          input: message,
          msg_id: crypto.randomUUID(),
          conversation_id: convId,
        });

        // Navigate so the user can see the response
        navigate(`/conversation/${convId}`);
        console.log(`[JARVIS] Sent message to ${convId}`);
      } catch (err) {
        console.error('[JARVIS] send_to_conversation failed:', err);
      }
      break;
    }

    default:
      console.warn(`[JARVIS] Unknown action: ${name}`);
  }
}

/**
 * Resolve the user's default Gemini model config for creating conversations.
 * Returns a full TProviderWithModel including API key and base URL.
 */
async function resolveDefaultModel(): Promise<TProviderWithModel> {
  try {
    const providers = await ConfigStorage.get('model.config');
    if (providers && Array.isArray(providers)) {
      const gemini = providers.find(
        (p) => p.platform === 'gemini' && p.apiKey && p.model?.length,
      );
      if (gemini?.model?.[0]) {
        const { model: _models, ...rest } = gemini;
        return { ...rest, useModel: gemini.model[0] };
      }
    }
  } catch {
    /* empty */
  }

  // Fallback — minimal config
  return {
    id: 'jarvis-default',
    platform: 'gemini',
    name: 'Gemini',
    baseUrl: '',
    apiKey: '',
    useModel: 'gemini-2.5-flash',
  };
}
