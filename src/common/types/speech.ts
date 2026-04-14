/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

export type SpeechToTextProvider = 'openai' | 'deepgram';

export type OpenAISpeechToTextConfig = {
  apiKey: string;
  baseUrl?: string;
  language?: string;
  model: string;
  prompt?: string;
  temperature?: number;
};

export type DeepgramSpeechToTextConfig = {
  apiKey: string;
  baseUrl?: string;
  detectLanguage?: boolean;
  language?: string;
  model: string;
  punctuate?: boolean;
  smartFormat?: boolean;
};

export type SpeechToTextConfig = {
  autoSend?: boolean;
  enabled: boolean;
  provider: SpeechToTextProvider;
  deepgram?: DeepgramSpeechToTextConfig;
  openai?: OpenAISpeechToTextConfig;
};

export type SpeechToTextAudioBuffer = Uint8Array | number[] | Record<string, number>;

export type SpeechToTextRequest = {
  audioBuffer: SpeechToTextAudioBuffer;
  fileName: string;
  languageHint?: string;
  mimeType: string;
};

export type SpeechToTextResult = {
  language?: string;
  model: string;
  provider: SpeechToTextProvider;
  text: string;
};

// ── Jarvis Wake Word ──

export type WakeWordCheckRequest = {
  /** PCM16 audio samples as number[] for IPC serialization */
  audio: number[];
  /** Sample rate of the audio data */
  sampleRate: number;
};

export type WakeWordCheckResult = {
  /** Whether a wake phrase ("jarvis") was detected in the audio */
  detected: boolean;
  /** Raw transcript from the audio (for debugging) */
  transcript?: string;
};

// ── Jarvis Live (Gemini Live API) ──

export type JarvisLiveRequest = {
  systemInstruction?: string;
  voiceName?: string;
};

export type JarvisLiveAudioChunk = {
  /** PCM16 samples encoded as number[] for IPC serialization */
  audio: number[];
};

export type JarvisLiveEvent = {
  type:
    | 'connected'
    | 'audio'
    | 'text'
    | 'input_transcript'
    | 'output_transcript'
    | 'interrupted'
    | 'turn_complete'
    | 'error'
    | 'disconnected'
    | 'action'
    | 'wake';
  /** PCM16 audio samples (present when type === 'audio') */
  audio?: number[];
  /** Text content (present for text, transcript, or error types) */
  text?: string;
  /** Error message (present when type === 'error') */
  message?: string;
  /** Action to perform in renderer (present when type === 'action') */
  action?: JarvisAction;
};

/** Actions JARVIS can trigger in the renderer */
export type JarvisAction = {
  name: string;
  params?: Record<string, unknown>;
};
