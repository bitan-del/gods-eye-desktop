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
import type { AcpBackendAll } from '@/common/types/acpTypes';
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
      const agent = (params?.agent as string) || 'gemini';
      if (!prompt) break;

      try {
        if (agent === 'gemini' || !agent) {
          // ── Gemini flow (built-in, uses sessionStorage for initial message) ──
          const model = await resolveDefaultModel();
          const conv = await ipcBridge.conversation.create.invoke({
            type: 'gemini',
            name: title,
            model,
            extra: {},
          });

          sessionStorage.setItem(`gemini_initial_message_${conv.id}`, JSON.stringify({ input: prompt, files: [] }));

          navigate(`/conversation/${conv.id}`);
          console.log(`[JARVIS] Created Gemini task "${title}" → ${conv.id}`);
        } else {
          // ── ACP agent flow (Claude, Qwen, Codex, Goose, etc.) ──
          const model = resolveAgentModel(agent);
          const conv = await ipcBridge.conversation.create.invoke({
            type: 'acp',
            name: title,
            model,
            extra: { backend: agent as AcpBackendAll },
          });

          // Navigate immediately so user sees the conversation
          navigate(`/conversation/${conv.id}`);

          // Send the initial message after a short delay to let the agent bootstrap
          setTimeout(() => {
            void ipcBridge.acpConversation.sendMessage.invoke({
              input: prompt,
              msg_id: crypto.randomUUID(),
              conversation_id: conv.id,
            });
          }, 1500);

          console.log(`[JARVIS] Created ${agent} task "${title}" → ${conv.id}`);
        }
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

    case 'navigate_to_route': {
      const route = params?.route as string;
      if (route) navigate(route);
      break;
    }

    default:
      console.warn(`[JARVIS] Unknown action: ${name}`);
  }
}

/** Platform mappings for known ACP agents */
const AGENT_PLATFORM_MAP: Record<string, string> = {
  claude: 'anthropic',
  codex: 'openai',
  copilot: 'openai',
  qwen: 'qwen',
  gemini: 'gemini',
  kimi: 'moonshot',
  cursor: 'cursor',
  goose: 'goose',
  codebuddy: 'tencent',
  droid: 'droid',
  auggie: 'augment',
  opencode: 'opencode',
  kiro: 'kiro',
  hermes: 'hermes',
  vibe: 'mistral',
};

/**
 * Build a minimal model config for an ACP agent.
 * ACP agents run as CLI processes with their own auth — the model config
 * is mostly for record-keeping and conversation creation.
 */
function resolveAgentModel(agent: string): TProviderWithModel {
  const platform = AGENT_PLATFORM_MAP[agent] || agent;
  return {
    id: `jarvis-${agent}`,
    platform,
    name: agent.charAt(0).toUpperCase() + agent.slice(1),
    baseUrl: '',
    apiKey: '',
    useModel: agent,
  };
}

/**
 * Resolve the user's default Gemini model config for creating conversations.
 * Returns a full TProviderWithModel including API key and base URL.
 */
async function resolveDefaultModel(): Promise<TProviderWithModel> {
  try {
    const providers = await ConfigStorage.get('model.config');
    if (providers && Array.isArray(providers)) {
      const gemini = providers.find((p) => p.platform === 'gemini' && p.apiKey && p.model?.length);
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
