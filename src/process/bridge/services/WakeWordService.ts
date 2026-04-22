/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wake word detection service — transcribes short audio clips via Gemini
 * and checks for the "Jarvis" keyword.
 *
 * Runs in the main process. The renderer captures mic audio, performs
 * voice-activity detection, and sends detected speech segments here
 * for transcription. No third-party API keys or accounts are needed
 * beyond the Gemini key the user already has for JARVIS Live.
 */

import { GoogleGenAI } from '@google/genai';
import type { WakeWordCheckRequest, WakeWordCheckResult } from '@/common/types/speech';
import type { IProvider } from '@/common/config/storage';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { ProcessConfig } from '@process/utils/initStorage';

const LOG_TAG = '[WakeWord]';

/**
 * Fuzzy keyword fragments that trigger a wake-up (case-insensitive).
 * Covers common transcription variants, accents, and misheard spellings:
 *   jarvis → jarv, jarvins → jarv, jarves → jarv
 *   jervis → jerv, gervis → gerv (accent / g-j confusion)
 *   "jar vis" (two-word split), "j.a.r.v.i.s" (spelled out)
 *   jarbis → jarb (b/v confusion)
 */
const WAKE_FRAGMENTS = [
  'jarv', // jarvis, jarvins, jarves, jarvus, jarvas
  'jerv', // jervis (accent)
  'gerv', // gervis (g/j confusion)
  'jarb', // jarbis (b/v confusion)
  'j.a.r', // spelled out with dots
  'j a r v', // spelled out with spaces
];

export class WakeWordService {
  /**
   * Check an audio clip for the "Jarvis" wake word.
   * Sends the audio to Gemini for transcription and matches against known phrases.
   */
  static async checkAudio(request: WakeWordCheckRequest): Promise<WakeWordCheckResult> {
    try {
      const apiKey = await this.resolveGeminiApiKey();
      if (!apiKey) {
        mainWarn(LOG_TAG, 'No Gemini API key — wake word disabled');
        return { detected: false };
      }

      // Convert Int16 PCM samples → WAV buffer → base64
      const wavBase64 = this.encodeWavBase64(request.audio, request.sampleRate);

      const ai = new GoogleGenAI({ apiKey });

      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  data: wavBase64,
                  mimeType: 'audio/wav',
                },
              },
              {
                text: 'What word is said? Reply with just the word. If unclear say NONE.',
              },
            ],
          },
        ],
      });

      const transcript = (result.text ?? '').trim().toLowerCase();
      mainLog(LOG_TAG, `Transcript: "${transcript}"`);

      if (!transcript || transcript === 'none') {
        return { detected: false, transcript };
      }

      const detected = WAKE_FRAGMENTS.some((frag) => transcript.includes(frag));

      if (detected) {
        mainLog(LOG_TAG, 'Wake word detected!');
      }

      return { detected, transcript };
    } catch (err) {
      mainWarn(LOG_TAG, 'checkAudio failed:', err instanceof Error ? err.message : String(err));
      return { detected: false };
    }
  }

  /**
   * Encode Int16 PCM samples into a WAV file and return as base64.
   */
  private static encodeWavBase64(samples: number[], sampleRate: number): string {
    const numSamples = samples.length;
    const dataSize = numSamples * 2; // 16-bit = 2 bytes per sample
    const headerSize = 44;
    const buffer = Buffer.alloc(headerSize + dataSize);

    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(headerSize - 8 + dataSize, 4);
    buffer.write('WAVE', 8);

    // fmt chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // chunk size
    buffer.writeUInt16LE(1, 20); // PCM format
    buffer.writeUInt16LE(1, 22); // mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
    buffer.writeUInt16LE(2, 32); // block align
    buffer.writeUInt16LE(16, 34); // bits per sample

    // data chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    // Write Int16 samples
    for (let i = 0; i < numSamples; i++) {
      buffer.writeInt16LE(Math.max(-32768, Math.min(32767, samples[i])), headerSize + i * 2);
    }

    return buffer.toString('base64');
  }

  /** Resolve Gemini API key from env or config */
  private static async resolveGeminiApiKey(): Promise<string | null> {
    if (process.env.GEMINI_API_KEY) {
      return process.env.GEMINI_API_KEY;
    }

    try {
      const providers: IProvider[] | undefined = await ProcessConfig.get('model.config');
      if (providers && Array.isArray(providers)) {
        const geminiProvider = providers.find((p) => p.platform === 'gemini' && p.apiKey && p.apiKey.trim().length > 0);
        if (geminiProvider?.apiKey) return geminiProvider.apiKey.trim();
      }
    } catch {
      /* empty */
    }

    return null;
  }
}
