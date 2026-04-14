/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Modality, Type } from '@google/genai';
import type { LiveServerMessage, FunctionDeclaration } from '@google/genai';
import type { IProvider } from '@/common/config/storage';
import type { JarvisLiveAudioChunk, JarvisLiveEvent, JarvisLiveRequest } from '@/common/types/speech';
import { cronService } from '@process/services/cron/cronServiceSingleton';
import { SqliteConversationRepository } from '@process/services/database/SqliteConversationRepository';
import { mainError, mainLog, mainWarn } from '@process/utils/mainLogger';
import { ProcessConfig } from '@process/utils/initStorage';

const LOG_TAG = '[JarvisLive]';

/** Male voice — deep, authoritative like JARVIS */
const DEFAULT_VOICE = 'Orus';

// Session type from the SDK
type LiveSession = {
  sendRealtimeInput: (params: Record<string, unknown>) => void;
  sendClientContent: (params: { turns?: unknown[]; turnComplete?: boolean }) => void;
  sendToolResponse: (params: { functionResponses: FunctionResponseItem[] }) => void;
  close: () => void;
};

type FunctionResponseItem = {
  id?: string;
  name: string;
  response: Record<string, unknown>;
};

// ── Function declarations for agentic capabilities ──

const JARVIS_TOOLS: FunctionDeclaration[] = [
  {
    name: 'get_conversations',
    description:
      'Get the list of recent user conversations/chats in Gods Eye. Returns conversation titles, IDs, and timestamps. Use this to know what the user has been working on.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        limit: {
          type: Type.NUMBER,
          description: 'Maximum number of conversations to return (default 10)',
        },
      },
    },
  },
  {
    name: 'get_cron_jobs',
    description:
      'Get all scheduled cron jobs in Gods Eye. Returns job names, schedules, enabled status, last run info, and next run times. Use this to tell the user about their scheduled tasks.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_running_tasks',
    description:
      'Get the count of currently running tasks/conversations in Gods Eye. Use this to inform the user about active workload.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_agent_activity',
    description:
      'Get a snapshot of all AI agent activity in Gods Eye — which agents are running, idle, or in error state, how many conversations each has, and what they are currently doing.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'navigate_to_conversation',
    description:
      'Navigate the user to a specific conversation in Gods Eye. Use this when the user asks to open or go to a chat.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        conversationId: {
          type: Type.STRING,
          description: 'The conversation ID to navigate to',
        },
      },
      required: ['conversationId'],
    },
  },
  {
    name: 'run_cron_job',
    description:
      'Immediately trigger a scheduled cron job to run now, outside of its normal schedule. Use this when the user asks to run a specific scheduled task.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        jobId: {
          type: Type.STRING,
          description: 'The cron job ID to run',
        },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'toggle_cron_job',
    description:
      'Enable or disable a scheduled cron job. Use this when the user asks to pause or resume a scheduled task.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        jobId: {
          type: Type.STRING,
          description: 'The cron job ID to toggle',
        },
        enabled: {
          type: Type.BOOLEAN,
          description: 'Whether to enable (true) or disable (false) the job',
        },
      },
      required: ['jobId', 'enabled'],
    },
  },
  {
    name: 'stop_all_tasks',
    description:
      'Stop all currently running tasks/conversations in Gods Eye. Use this when the user asks to halt all activity or there is an emergency.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_conversation_messages',
    description:
      'Read the recent messages from a specific conversation. Use this to see what happened in a chat, check agent progress, or understand context before acting.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        conversationId: {
          type: Type.STRING,
          description: 'The conversation ID to read messages from',
        },
        limit: {
          type: Type.NUMBER,
          description: 'Maximum number of messages to return (default 10, max 20)',
        },
      },
      required: ['conversationId'],
    },
  },
  {
    name: 'open_new_conversation',
    description:
      'Open a new conversation in Gods Eye. Use this when the user asks to start a new chat or task.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'create_task',
    description:
      'Create a brand new AI conversation and immediately send a prompt to it. Use this when the user asks you to write something, build something, create code, do research, or perform any task. This is the primary way to DO WORK for the user — you create a conversation with an AI agent and send it instructions.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: {
          type: Type.STRING,
          description: 'The detailed task instruction to send to the AI agent. Be specific and comprehensive — expand on what the user asked for.',
        },
        title: {
          type: Type.STRING,
          description: 'A short title for the conversation (e.g. "Python Web Scraper", "Landing Page Design")',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'send_to_conversation',
    description:
      'Send a follow-up message to an existing conversation. Use this when the user wants to continue a previous chat, give additional instructions to a running agent, or ask a question in an existing thread.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        conversationId: {
          type: Type.STRING,
          description: 'The conversation ID to send the message to',
        },
        message: {
          type: Type.STRING,
          description: 'The message to send to the conversation',
        },
      },
      required: ['conversationId', 'message'],
    },
  },
];

// ── Base system instruction ──

const BASE_SYSTEM_INSTRUCTION = `You are JARVIS, an intelligent personal AI assistant built into the Gods Eye desktop platform.

Your personality:
- You speak with a calm, confident, authoritative tone — like a trusted advisor
- You are concise and direct — no filler words or unnecessary pleasantries
- You address the user as "sir" occasionally, but not excessively
- You are proactive — you anticipate needs and offer suggestions
- You have a dry wit but stay professional

Gods Eye is an all-in-one AI desktop application that lets users:
- Chat with multiple AI models (Gemini, OpenAI, Claude, etc.)
- Create and manage AI agent teams for complex tasks
- Schedule automated tasks with cron jobs
- Connect messaging channels (Telegram, Lark, DingTalk, WeChat)
- Manage workspaces and files with AI assistance
- Use MCP servers for extended capabilities

IMPORTANT: You have access to tools that let you query real platform data and perform actions. ALWAYS use the tools to get current information rather than guessing or making up data. When the user asks about conversations, tasks, schedules, or agents — call the appropriate tool first, then respond with accurate information.

STARTUP BEHAVIOR: When you first receive audio input after being activated, immediately greet the user. Say "Systems online, sir." followed by a 1-sentence status update based on the context you have (e.g. number of conversations, scheduled tasks). Do NOT wait for the user to speak first — greet proactively as soon as you hear any audio.

Keep responses concise and natural for voice conversation. Avoid long lists — summarize and highlight what matters.`;

export class GeminiLiveService {
  private static session: LiveSession | null = null;
  private static eventHandler: ((event: JarvisLiveEvent) => void) | null = null;
  private static sessionConfirmed = false;

  // ── Caches for fast reconnection ──
  private static cachedApiKey: string | null = null;
  private static cachedInstruction: string | null = null;
  private static cachedInstructionTime = 0;
  private static readonly INSTRUCTION_CACHE_TTL = 60_000; // rebuild every 60s

  /** Register the event handler that forwards events to the renderer */
  static setEventHandler(handler: (event: JarvisLiveEvent) => void): void {
    this.eventHandler = handler;
  }

  private static emit(event: JarvisLiveEvent): void {
    this.eventHandler?.(event);
  }

  /** Connect to Gemini Live API */
  static async connect(request: JarvisLiveRequest): Promise<{ success: boolean }> {
    this.disconnectSession();
    this.sessionConfirmed = false;

    try {
      // Use cached API key for fast reconnect
      const apiKey = this.cachedApiKey || (await this.resolveGeminiApiKey());
      if (!apiKey) {
        mainError(LOG_TAG, 'No Gemini API key found');
        this.emit({ type: 'error', message: 'No Gemini API key configured. Add one in Settings → Models.' });
        return { success: false };
      }
      this.cachedApiKey = apiKey;

      // Use cached system instruction (rebuild every 60s)
      const now = Date.now();
      let systemInstruction = request.systemInstruction;
      if (!systemInstruction) {
        if (this.cachedInstruction && now - this.cachedInstructionTime < this.INSTRUCTION_CACHE_TTL) {
          systemInstruction = this.cachedInstruction;
          mainLog(LOG_TAG, 'Using cached system instruction');
        } else {
          mainLog(LOG_TAG, 'Building system instruction...');
          systemInstruction =
            (await this.withTimeout(this.buildSystemInstruction(), 3000)) || BASE_SYSTEM_INSTRUCTION;
          this.cachedInstruction = systemInstruction;
          this.cachedInstructionTime = now;
        }
      }
      mainLog(LOG_TAG, `System instruction ready (${systemInstruction.length} chars)`);

      // Resolve model from user config
      const model = await this.resolveLiveModel();
      mainLog(LOG_TAG, `Connecting with model: ${model}, voice: ${request.voiceName || DEFAULT_VOICE}`);

      const ai = new GoogleGenAI({ apiKey });

      const session = await ai.live.connect({
        model,
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction,
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: request.voiceName || DEFAULT_VOICE,
              },
            },
          },
          tools: [{ functionDeclarations: JARVIS_TOOLS }],
        },
        callbacks: {
          onopen: () => {
            mainLog(LOG_TAG, 'WebSocket connection opened');
          },
          onmessage: (msg: LiveServerMessage) => {
            if (msg.setupComplete) {
              mainLog(LOG_TAG, `Setup complete! Session ID: ${msg.setupComplete.sessionId ?? 'n/a'}`);
              this.sessionConfirmed = true;
              this.emit({ type: 'connected' });
            }
            this.handleServerMessage(msg);
          },
          onerror: (e: ErrorEvent) => {
            mainError(LOG_TAG, 'WebSocket error:', {
              message: e.message,
              type: e.type,
            });
            this.emit({ type: 'error', message: e.message || 'WebSocket error' });
          },
          onclose: (e: CloseEvent) => {
            mainLog(LOG_TAG, 'WebSocket closed:', {
              code: e.code,
              reason: e.reason,
              wasClean: e.wasClean,
              sessionConfirmed: this.sessionConfirmed,
            });
            this.session = null;

            if (!this.sessionConfirmed) {
              const reason = e.reason || `WebSocket closed with code ${e.code}`;
              this.emit({ type: 'error', message: `Connection rejected: ${reason}` });
            }
            this.emit({ type: 'disconnected' });
          },
        },
      });

      this.session = session as unknown as LiveSession;
      mainLog(LOG_TAG, 'ai.live.connect() resolved — waiting for setupComplete...');

      // Wait for setupComplete confirmation (up to 10 seconds)
      const confirmed = await this.waitForSetup(10000);
      if (!confirmed) {
        mainError(LOG_TAG, 'Timed out waiting for setupComplete');
        this.disconnectSession();
        this.emit({ type: 'error', message: 'Connection timed out. The model may not support Live API.' });
        return { success: false };
      }

      mainLog(LOG_TAG, 'Session fully established and confirmed');
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      mainError(LOG_TAG, 'Connect failed:', message);
      this.emit({ type: 'error', message: `Failed to connect: ${message}` });
      return { success: false };
    }
  }

  /** Wait for sessionConfirmed flag up to timeoutMs */
  private static waitForSetup(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.sessionConfirmed) {
        resolve(true);
        return;
      }

      const interval = 100;
      let elapsed = 0;
      const timer = setInterval(() => {
        elapsed += interval;
        if (this.sessionConfirmed) {
          clearInterval(timer);
          resolve(true);
        } else if (elapsed >= timeoutMs || !this.session) {
          clearInterval(timer);
          resolve(false);
        }
      }, interval);
    });
  }

  /** Send an audio chunk to the active Gemini Live session */
  static sendAudio(chunk: JarvisLiveAudioChunk): void {
    if (!this.session || !this.sessionConfirmed) return;

    try {
      const int16 = new Int16Array(chunk.audio);
      const buffer = Buffer.from(int16.buffer);
      const base64 = buffer.toString('base64');

      this.session.sendRealtimeInput({
        audio: {
          data: base64,
          mimeType: 'audio/pcm;rate=16000',
        },
      } as Record<string, unknown>);
    } catch (err) {
      mainWarn(LOG_TAG, 'sendAudio error:', err instanceof Error ? err.message : String(err));
    }
  }

  /** Disconnect */
  static disconnect(): void {
    this.disconnectSession();
  }

  static get isConnected(): boolean {
    return this.session !== null && this.sessionConfirmed;
  }

  private static disconnectSession(): void {
    if (this.session) {
      try { this.session.close(); } catch { /* */ }
      this.session = null;
      this.sessionConfirmed = false;
      mainLog(LOG_TAG, 'Session disconnected');
    }
  }

  // ── Build dynamic system instruction with live app context ──

  /** Race a promise against a timeout — resolves to null on timeout */
  private static withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    return Promise.race([
      promise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
  }

  private static async buildSystemInstruction(): Promise<string> {
    const contextParts: string[] = [BASE_SYSTEM_INSTRUCTION];

    try {
      mainLog(LOG_TAG, 'Gathering app context for system instruction...');

      // Each context call gets max 3s — if bridges are not ready, we skip them
      const sections = await Promise.allSettled([
        this.withTimeout(this.getConversationContext(), 3000),
        this.withTimeout(this.getCronContext(), 3000),
        this.withTimeout(this.getTaskContext(), 3000),
        this.withTimeout(this.getAgentActivityContext(), 3000),
      ]);

      for (const result of sections) {
        if (result.status === 'fulfilled' && result.value) {
          contextParts.push(result.value);
        }
      }
    } catch (err) {
      mainWarn(LOG_TAG, 'Failed to gather some context:', err instanceof Error ? err.message : String(err));
    }

    contextParts.push(`\nCurrent time: ${new Date().toLocaleString()}`);

    const instruction = contextParts.join('\n\n');
    mainLog(LOG_TAG, `System instruction built: ${instruction.length} chars with live context`);
    return instruction;
  }

  private static async getConversationContext(): Promise<string | null> {
    try {
      mainLog(LOG_TAG, 'Fetching conversation context from database...');
      const repo = new SqliteConversationRepository();
      const result = await repo.getUserConversations(undefined, 0, 15);
      const conversations = result.data;
      mainLog(LOG_TAG, `Got ${conversations.length} conversations from database`);

      if (!conversations.length) return null;

      const lines = conversations.map((c) => {
        const time = c.modifyTime ? new Date(c.modifyTime).toLocaleString() : 'unknown';
        return `- "${c.name || 'Untitled'}" (ID: ${c.id}, type: ${c.type}, last active: ${time})`;
      });

      return `## Current Conversations (${conversations.length} total)\n${lines.join('\n')}`;
    } catch (err) {
      mainWarn(LOG_TAG, 'getConversationContext failed:', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  private static async getCronContext(): Promise<string | null> {
    try {
      mainLog(LOG_TAG, 'Fetching cron context...');
      const jobs = await cronService.listJobs();
      mainLog(LOG_TAG, `Got ${jobs?.length ?? 0} cron jobs`);
      if (!jobs?.length) return null;

      const lines = jobs.map((j) => {
        const status = j.enabled ? 'enabled' : 'disabled';
        const lastRun = j.state.lastRunAtMs ? new Date(j.state.lastRunAtMs).toLocaleString() : 'never';
        const nextRun = j.state.nextRunAtMs ? new Date(j.state.nextRunAtMs).toLocaleString() : 'n/a';
        return `- "${j.name}" (ID: ${j.id}, ${status}, runs: ${j.state.runCount}, last: ${lastRun}, next: ${nextRun})`;
      });

      return `## Scheduled Tasks (${jobs.length} cron jobs)\n${lines.join('\n')}`;
    } catch (err) {
      mainWarn(LOG_TAG, 'getCronContext failed:', err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  private static getTaskContext(): Promise<string | null> {
    // Task and agent activity are not available via direct service access —
    // use the tools at runtime instead (user can ask JARVIS about running tasks)
    return Promise.resolve(null);
  }

  private static getAgentActivityContext(): Promise<string | null> {
    return Promise.resolve(null);
  }

  // ── Handle messages from Gemini Live server ──

  private static handleServerMessage(msg: LiveServerMessage): void {
    // Handle tool calls (function calling)
    const toolCall = (msg as unknown as Record<string, unknown>).toolCall as
      | { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> }
      | undefined;

    if (toolCall?.functionCalls?.length) {
      mainLog(LOG_TAG, `Tool call received: ${toolCall.functionCalls.map((f) => f.name).join(', ')}`);
      void this.handleToolCalls(toolCall.functionCalls);
      return;
    }

    const content = msg.serverContent;
    if (!content) return;

    // Audio / text from model
    if (content.modelTurn?.parts) {
      for (const part of content.modelTurn.parts) {
        if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('audio/')) {
          const buffer = Buffer.from(part.inlineData.data, 'base64');
          const int16 = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);
          this.emit({ type: 'audio', audio: Array.from(int16) });
        }
        if (part.text) {
          this.emit({ type: 'text', text: part.text });
        }
      }
    }

    if (content.inputTranscription?.text) {
      this.emit({ type: 'input_transcript', text: content.inputTranscription.text });
    }
    if (content.outputTranscription?.text) {
      this.emit({ type: 'output_transcript', text: content.outputTranscription.text });
    }
    if (content.interrupted) {
      this.emit({ type: 'interrupted' });
    }
    if (content.turnComplete) {
      this.emit({ type: 'turn_complete' });
    }
  }

  // ── Execute tool calls and send responses ──

  private static async handleToolCalls(
    calls: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>,
  ): Promise<void> {
    const responses: FunctionResponseItem[] = [];

    for (const call of calls) {
      const name = call.name || 'unknown';
      mainLog(LOG_TAG, `Executing tool: ${name}`, call.args);

      try {
        const result = await this.withTimeout(this.executeFunction(name, call.args || {}), 5000);
        if (result === null) {
          mainWarn(LOG_TAG, `Tool ${name} timed out after 5s`);
          responses.push({ id: call.id, name, response: { error: 'Function timed out' } });
          continue;
        }
        responses.push({
          id: call.id,
          name,
          response: { output: result },
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        mainError(LOG_TAG, `Tool ${name} failed:`, errorMsg);
        responses.push({
          id: call.id,
          name,
          response: { error: errorMsg },
        });
      }
    }

    // Send tool responses back to Gemini
    if (this.session && responses.length > 0) {
      try {
        this.session.sendToolResponse({ functionResponses: responses });
        mainLog(LOG_TAG, `Sent ${responses.length} tool response(s)`);
      } catch (err) {
        mainError(LOG_TAG, 'Failed to send tool responses:', err instanceof Error ? err.message : String(err));
      }
    }
  }

  private static async executeFunction(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'get_conversations': {
        const limit = typeof args.limit === 'number' ? args.limit : 10;
        const repo = new SqliteConversationRepository();
        const result = await repo.getUserConversations(undefined, 0, limit);
        return result.data.map((c) => ({
          id: c.id,
          name: c.name || 'Untitled',
          lastActive: c.modifyTime ? new Date(c.modifyTime).toLocaleString() : 'unknown',
          type: c.type,
        }));
      }

      case 'get_cron_jobs': {
        const jobs = await cronService.listJobs();
        return (jobs || []).map((j) => ({
          id: j.id,
          name: j.name,
          enabled: j.enabled,
          runCount: j.state.runCount,
          lastRun: j.state.lastRunAtMs ? new Date(j.state.lastRunAtMs).toLocaleString() : 'never',
          nextRun: j.state.nextRunAtMs ? new Date(j.state.nextRunAtMs).toLocaleString() : 'n/a',
          lastStatus: j.state.lastStatus || 'n/a',
        }));
      }

      case 'get_running_tasks': {
        // Not available via direct service — report as unavailable
        return { message: 'Task count is not available in this context. Try asking about cron jobs or conversations instead.' };
      }

      case 'get_agent_activity': {
        // Not available via direct service — report as unavailable
        return { message: 'Agent activity snapshot is not available in this context. Try asking about conversations or cron jobs instead.' };
      }

      case 'navigate_to_conversation': {
        const conversationId = args.conversationId as string;
        if (!conversationId) throw new Error('conversationId is required');
        this.emit({
          type: 'action',
          action: { name: 'navigate_to_conversation', params: { conversationId } },
        });
        return { success: true, message: `Navigating to conversation ${conversationId}` };
      }

      case 'run_cron_job': {
        const jobId = args.jobId as string;
        if (!jobId) throw new Error('jobId is required');
        const conversationId = await cronService.runNow(jobId);
        return { success: true, conversationId, message: `Cron job ${jobId} triggered` };
      }

      case 'toggle_cron_job': {
        const toggleJobId = args.jobId as string;
        const enabled = args.enabled as boolean;
        if (!toggleJobId) throw new Error('jobId is required');
        await cronService.updateJob(toggleJobId, { enabled });
        return { success: true, message: `Cron job ${toggleJobId} ${enabled ? 'enabled' : 'disabled'}` };
      }

      case 'stop_all_tasks': {
        return { message: 'Task management is not available in this context. Please stop tasks manually from the conversation panel.' };
      }

      case 'get_conversation_messages': {
        const convId = args.conversationId as string;
        if (!convId) throw new Error('conversationId is required');
        const msgLimit = Math.min(typeof args.limit === 'number' ? args.limit : 10, 20);
        const repo = new SqliteConversationRepository();
        const msgs = await repo.getMessages(convId, 1, msgLimit, 'DESC');
        return msgs.data.map((m) => {
          const pos = m.position === 'right' ? 'user' : m.position === 'left' ? 'assistant' : m.position ?? 'unknown';
          let text = '[non-text]';
          if (m.type === 'text' && m.content && typeof m.content === 'object' && 'text' in m.content) {
            text = String((m.content as { text: string }).text).slice(0, 500);
          }
          return { role: pos, content: text, timestamp: m.createdAt ? new Date(m.createdAt).toLocaleString() : 'unknown' };
        });
      }

      case 'open_new_conversation': {
        this.emit({
          type: 'action',
          action: { name: 'open_new_conversation' },
        });
        return { success: true, message: 'Opening a new conversation' };
      }

      case 'create_task': {
        const prompt = args.prompt as string;
        if (!prompt) throw new Error('prompt is required');
        const title = (args.title as string) || 'JARVIS Task';
        this.emit({
          type: 'action',
          action: { name: 'create_task', params: { prompt, title } },
        });
        return { success: true, message: `Creating task: "${title}"` };
      }

      case 'send_to_conversation': {
        const targetId = args.conversationId as string;
        const msg = args.message as string;
        if (!targetId || !msg) throw new Error('conversationId and message are required');
        this.emit({
          type: 'action',
          action: { name: 'send_to_conversation', params: { conversationId: targetId, message: msg } },
        });
        return { success: true, message: `Message sent to conversation ${targetId}` };
      }

      default:
        throw new Error(`Unknown function: ${name}`);
    }
  }

  // ── Model and API key resolution ──

  /** Find a live model from user's Gemini config */
  private static async resolveLiveModel(): Promise<string> {
    try {
      const providers: IProvider[] | undefined = await ProcessConfig.get('model.config');
      if (providers && Array.isArray(providers)) {
        const geminiProvider = providers.find(
          (p) => p.platform === 'gemini' && p.apiKey && p.model?.length,
        );
        if (geminiProvider?.model) {
          const liveModel = geminiProvider.model.find((m) => m.toLowerCase().includes('live'));
          if (liveModel) {
            mainLog(LOG_TAG, `Found live model in config: ${liveModel}`);
            return liveModel;
          }
        }
      }
    } catch { /* */ }

    // Fallback
    const fallback = 'gemini-2.0-flash-live-001';
    mainLog(LOG_TAG, `No live model in config, using fallback: ${fallback}`);
    return fallback;
  }

  /** Resolve Gemini API key from env or config */
  private static async resolveGeminiApiKey(): Promise<string | null> {
    if (process.env.GEMINI_API_KEY) {
      mainLog(LOG_TAG, 'Using API key from environment');
      return process.env.GEMINI_API_KEY;
    }

    try {
      const providers: IProvider[] | undefined = await ProcessConfig.get('model.config');
      if (providers && Array.isArray(providers)) {
        const geminiProvider = providers.find(
          (p) => p.platform === 'gemini' && p.apiKey && p.apiKey.trim().length > 0,
        );
        if (geminiProvider?.apiKey) {
          mainLog(LOG_TAG, 'Using API key from model config');
          return geminiProvider.apiKey.trim();
        }
      }
    } catch (err) {
      mainWarn(LOG_TAG, 'Failed to read model config:', err instanceof Error ? err.message : String(err));
    }

    return null;
  }
}
