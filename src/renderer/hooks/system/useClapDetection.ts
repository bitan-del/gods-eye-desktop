/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';

type ClapDetectionStatus = 'idle' | 'listening' | 'error';

type UseClapDetectionOptions = {
  /** Minimum energy threshold to consider a frame as a potential clap (0-1 scale) */
  energyThreshold?: number;
  /** How many consecutive high-energy frames qualify as a clap impulse */
  impulseFrames?: number;
  /** Cooldown in ms between detected claps to avoid double-triggers */
  cooldownMs?: number;
  /** Whether detection is enabled */
  enabled?: boolean;
  /** Callback when a clap is detected */
  onClap: () => void;
};

/**
 * Detects clapping sounds via the Web Audio API.
 *
 * A clap is a sharp, broadband transient — high energy that appears and
 * disappears within a few analysis frames. We measure RMS energy from the
 * time-domain waveform and look for a sudden spike followed by a rapid decay.
 */
export const useClapDetection = ({
  energyThreshold = 0.35,
  impulseFrames = 2,
  cooldownMs = 800,
  enabled = true,
  onClap,
}: UseClapDetectionOptions) => {
  const [status, setStatus] = useState<ClapDetectionStatus>('idle');
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const onClapRef = useRef(onClap);
  onClapRef.current = onClap;

  // Spike detection state
  const spikeCountRef = useRef(0);
  const lastClapTimeRef = useRef(0);
  const prevEnergyRef = useRef(0);

  const cleanup = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    analyserRef.current = null;
    spikeCountRef.current = 0;
    prevEnergyRef.current = 0;
  }, []);

  const startListening = useCallback(async () => {
    cleanup();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const timeDomainData = new Float32Array(analyser.fftSize);

      const detectLoop = () => {
        if (!analyserRef.current) return;

        analyserRef.current.getFloatTimeDomainData(timeDomainData);

        // Compute RMS energy
        let sum = 0;
        for (let i = 0; i < timeDomainData.length; i++) {
          sum += timeDomainData[i] * timeDomainData[i];
        }
        const rms = Math.sqrt(sum / timeDomainData.length);

        const now = performance.now();
        const prevEnergy = prevEnergyRef.current;

        // A clap shows as a sharp rise in energy (transient spike)
        const isSpike = rms > energyThreshold && rms > prevEnergy * 2.5;

        if (isSpike) {
          spikeCountRef.current++;
        } else {
          // If we accumulated enough spike frames and energy dropped, it's a clap
          if (spikeCountRef.current >= impulseFrames && rms < prevEnergy * 0.6) {
            if (now - lastClapTimeRef.current > cooldownMs) {
              lastClapTimeRef.current = now;
              onClapRef.current();
            }
          }
          spikeCountRef.current = 0;
        }

        prevEnergyRef.current = rms;
        rafRef.current = requestAnimationFrame(detectLoop);
      };

      rafRef.current = requestAnimationFrame(detectLoop);
      setStatus('listening');
    } catch {
      setStatus('error');
    }
  }, [cleanup, energyThreshold, impulseFrames, cooldownMs]);

  const stopListening = useCallback(() => {
    cleanup();
    setStatus('idle');
  }, [cleanup]);

  useEffect(() => {
    if (enabled) {
      void startListening();
    } else {
      stopListening();
    }
    return cleanup;
  }, [enabled, startListening, stopListening, cleanup]);

  return { status, startListening, stopListening };
};
