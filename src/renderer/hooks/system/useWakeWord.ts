/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wake word detection hook.
 *
 * Uses the Web Audio API for microphone capture and energy-based voice
 * activity detection (VAD). When a speech segment is detected, the audio
 * is sent to the main process for transcription via Gemini and checked
 * for the "Jarvis" keyword.
 *
 * This approach is:
 * - Fully free — no extra API keys or accounts beyond the Gemini key
 *   the user already has for JARVIS Live
 * - Offline VAD — only short speech clips trigger an API call
 * - Works in Electron (no webkitSpeechRecognition dependency)
 */

import { ipcBridge } from '@/common';
import { useCallback, useEffect, useRef } from 'react';

type WakeWordOptions = {
  /** Whether wake word detection is active */
  enabled: boolean;
  /** Called when the wake word is detected */
  onWake: () => void;
};

/** Virtual audio device keywords to skip */
const VIRTUAL_KEYWORDS = ['blackhole', 'virtual', 'soundflower', 'loopback'];

/** Target sample rate for audio sent to Gemini */
const TARGET_SAMPLE_RATE = 16000;

/** ScriptProcessor buffer size — 2048 at 48kHz ≈ 43ms per frame */
const BUFFER_SIZE = 2048;

/** RMS energy threshold to consider as speech */
const SPEECH_THRESHOLD = 0.012;

/** RMS level below which silence is confirmed */
const SILENCE_THRESHOLD = 0.006;

/**
 * Minimum speech duration in ms before we consider it a valid segment.
 * "Jarvis" takes about 400-800ms to say.
 */
const MIN_SPEECH_MS = 250;

/** Maximum speech duration in ms — wake words are short */
const MAX_SPEECH_MS = 2500;

/** Silence duration in ms after speech to mark end — fast cutoff */
const SILENCE_END_MS = 350;

/** Cooldown between wake word API checks in ms */
const COOLDOWN_MS = 2000;

/** Max rolling buffer duration in seconds */
const ROLLING_BUFFER_SECONDS = 4;

/**
 * Continuously listens for the "Jarvis" wake word.
 * Uses energy-based VAD in the renderer and Gemini transcription in the main process.
 */
export function useWakeWord({ enabled, onWake }: WakeWordOptions): void {
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;

  const cleanupRef = useRef<(() => void) | null>(null);

  const startListening = useCallback(async () => {
    // Clean up any previous session
    cleanupRef.current?.();
    cleanupRef.current = null;

    try {
      // Pick a real mic (skip virtual devices)
      const devices = await navigator.mediaDevices.enumerateDevices();
      const realMic = devices.find(
        (d) => d.kind === 'audioinput' && d.label && !VIRTUAL_KEYWORDS.some((kw) => d.label.toLowerCase().includes(kw))
      );
      const audioConstraints: MediaStreamConstraints['audio'] = realMic
        ? { deviceId: { exact: realMic.deviceId } }
        : true;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });

      // Use native sample rate for accurate RMS, downsample later for API
      const ctx = new AudioContext();
      const nativeSR = ctx.sampleRate;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(BUFFER_SIZE, 1, 1);

      // Frame duration in ms
      const frameDurationMs = (BUFFER_SIZE / nativeSR) * 1000;

      // Rolling buffer: keeps the last N seconds of audio at native sample rate
      const maxSamples = Math.round(nativeSR * ROLLING_BUFFER_SECONDS);
      const rollingBuffer = new Float32Array(maxSamples);
      let writePos = 0;
      let totalWritten = 0;

      // VAD state
      let speechStartTime = 0;
      let lastSpeechTime = 0;
      let isSpeaking = false;
      let cooldownUntil = 0;
      let checking = false;
      let frameCount = 0;

      const computeRMS = (data: Float32Array): number => {
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          sum += data[i] * data[i];
        }
        return Math.sqrt(sum / data.length);
      };

      /**
       * Extract the last N samples from the rolling buffer,
       * downsample to TARGET_SAMPLE_RATE, and convert to Int16.
       */
      const extractAndDownsample = (durationMs: number): Int16Array => {
        const nativeSamples = Math.min(Math.round((durationMs / 1000) * nativeSR), totalWritten, maxSamples);

        // Read from circular buffer
        const float32 = new Float32Array(nativeSamples);
        let readPos = (writePos - nativeSamples + maxSamples) % maxSamples;
        for (let i = 0; i < nativeSamples; i++) {
          float32[i] = rollingBuffer[readPos];
          readPos = (readPos + 1) % maxSamples;
        }

        // Downsample to target rate
        const ratio = nativeSR / TARGET_SAMPLE_RATE;
        const outLength = Math.round(nativeSamples / ratio);
        const int16 = new Int16Array(outLength);

        for (let i = 0; i < outLength; i++) {
          const srcIdx = i * ratio;
          const lo = Math.floor(srcIdx);
          const hi = Math.min(lo + 1, nativeSamples - 1);
          const frac = srcIdx - lo;
          const sample = float32[lo] * (1 - frac) + float32[hi] * frac;
          int16[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
        }

        return int16;
      };

      const checkWakeWord = async (durationMs: number): Promise<void> => {
        if (checking) return;
        checking = true;

        try {
          // Add 300ms pre-buffer to capture the start of speech
          const totalDuration = durationMs + 300;
          const samples = extractAndDownsample(totalDuration);

          console.log(`[useWakeWord] Checking ${Math.round(totalDuration)}ms of audio (${samples.length} samples)`);

          const result = await ipcBridge.jarvisLive.checkWakeWord.invoke({
            audio: Array.from(samples),
            sampleRate: TARGET_SAMPLE_RATE,
          });

          console.log(`[useWakeWord] Result: detected=${result.detected}, transcript="${result.transcript ?? ''}"`);

          if (result.detected) {
            onWakeRef.current();
            cooldownUntil = Date.now() + COOLDOWN_MS;
          }
        } catch (err) {
          console.warn('[useWakeWord] Check failed:', err);
        } finally {
          checking = false;
        }
      };

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        const input = e.inputBuffer.getChannelData(0);

        // Write to rolling buffer
        for (let i = 0; i < input.length; i++) {
          rollingBuffer[writePos] = input[i];
          writePos = (writePos + 1) % maxSamples;
        }
        totalWritten += input.length;

        // Skip during cooldown or while a check is in progress
        if (Date.now() < cooldownUntil || checking) return;

        const rms = computeRMS(input);
        const now = Date.now();

        // Debug: log RMS every ~2 seconds
        frameCount++;
        if (frameCount % Math.round(2000 / frameDurationMs) === 0) {
          console.log(`[useWakeWord] RMS: ${rms.toFixed(4)}, speaking: ${isSpeaking}`);
        }

        if (rms > SPEECH_THRESHOLD) {
          if (!isSpeaking) {
            isSpeaking = true;
            speechStartTime = now;
            console.log(`[useWakeWord] Speech started (RMS: ${rms.toFixed(4)})`);
          }
          lastSpeechTime = now;
        }

        if (isSpeaking) {
          const speechDuration = now - speechStartTime;
          const silenceDuration = now - lastSpeechTime;

          // Safety: if speech goes on too long, reset (not a wake word)
          if (speechDuration > MAX_SPEECH_MS) {
            console.log('[useWakeWord] Speech too long, resetting');
            isSpeaking = false;
            return;
          }

          // Check if silence marks end of speech
          if (silenceDuration > SILENCE_END_MS) {
            isSpeaking = false;

            if (speechDuration >= MIN_SPEECH_MS) {
              console.log(`[useWakeWord] Speech segment: ${Math.round(speechDuration)}ms — sending for check`);
              void checkWakeWord(speechDuration);
            } else {
              console.log(`[useWakeWord] Speech too short (${Math.round(speechDuration)}ms), skipping`);
            }
          }
        }
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      const micLabel = stream.getAudioTracks()[0]?.label ?? 'unknown';
      console.log(`[useWakeWord] Listening on "${micLabel}" at ${nativeSR}Hz, frame=${Math.round(frameDurationMs)}ms`);

      // Store cleanup function
      cleanupRef.current = () => {
        processor.disconnect();
        source.disconnect();
        void ctx.close().catch(() => {});
        stream.getTracks().forEach((t) => t.stop());
        console.log('[useWakeWord] Stopped listening');
      };
    } catch (err) {
      console.warn('[useWakeWord] Failed to start:', err);
    }
  }, []);

  useEffect(() => {
    if (enabled) {
      void startListening();
    } else {
      cleanupRef.current?.();
      cleanupRef.current = null;
    }

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [enabled, startListening]);
}
