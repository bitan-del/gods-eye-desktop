/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { ICronJob } from '@/common/adapter/ipcBridge';
import type { JarvisLiveEvent } from '@/common/types/speech';
import { useClapDetection } from '@/renderer/hooks/system/useClapDetection';
import { useWakeWord } from '@/renderer/hooks/system/useWakeWord';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './jarvis.module.css';

type JarvisState = 'sleeping' | 'waking' | 'connecting' | 'listening' | 'speaking' | 'active';

/** Virtual audio device keywords to skip */
const VIRTUAL_DEVICE_KEYWORDS = ['blackhole', 'virtual', 'soundflower', 'loopback'];

/** Audio output sample rate from Gemini Live API (24 kHz PCM16) */
const OUTPUT_SAMPLE_RATE = 24000;

/** Mic capture sample rate expected by Gemini */
const INPUT_SAMPLE_RATE = 16000;

type ActivityData = {
  activeCronJobs: number;
  runningTasks: number;
  greeting: string;
  summaryLines: string[];
};

const getTimeGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

/**
 * Downsample Float32 audio from the source sample rate to the target sample rate.
 * Returns an Int16Array ready for Gemini Live.
 */
const downsampleToInt16 = (float32: Float32Array, sourceSR: number, targetSR: number): Int16Array => {
  if (sourceSR === targetSR) {
    const result = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      result[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32767)));
    }
    return result;
  }

  const ratio = sourceSR / targetSR;
  const newLength = Math.round(float32.length / ratio);
  const result = new Int16Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const low = Math.floor(srcIndex);
    const high = Math.min(low + 1, float32.length - 1);
    const frac = srcIndex - low;
    const sample = float32[low] * (1 - frac) + float32[high] * frac;
    result[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
  }

  return result;
};

/** Compute RMS audio level from Float32 audio data (0-1 scale) */
const computeRMS = (data: Float32Array): number => {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i] * data[i];
  }
  return Math.sqrt(sum / data.length);
};

const JarvisPage: React.FC = () => {
  const navigate = useNavigate();
  const [jarvisState, setJarvisState] = useState<JarvisState>('sleeping');
  const jarvisStateRef = useRef<JarvisState>('sleeping');
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [statusText, setStatusText] = useState('Clap or click the orb to wake me up');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [micWarning, setMicWarning] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const hasWokenRef = useRef(false);
  const wakeUpRef = useRef<() => void>(() => {});

  // Audio streaming refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);
  const eventUnsubRef = useRef<(() => void) | null>(null);
  const audioLevelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Update both React state and the ref so callbacks always see current state */
  const updateState = useCallback((state: JarvisState) => {
    jarvisStateRef.current = state;
    setJarvisState(state);
  }, []);

  // Check if the default mic is a virtual device
  useEffect(() => {
    const checkMic = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const label = stream.getAudioTracks()[0]?.label ?? '';
        stream.getTracks().forEach((t) => t.stop());
        const isVirtual = VIRTUAL_DEVICE_KEYWORDS.some((kw) => label.toLowerCase().includes(kw));
        if (isVirtual) {
          setMicWarning(
            `Default mic is "${label}" (virtual). Change to a real microphone in System Settings → Sound → Input.`,
          );
        }
      } catch {
        setMicWarning('Microphone access denied. Grant permission in System Settings → Privacy → Microphone.');
      }
    };
    void checkMic();
  }, []);

  const fetchActivity = useCallback(async (): Promise<ActivityData> => {
    const greeting = `${getTimeGreeting()}, sir.`;
    const summaryLines: string[] = [];
    let activeCronJobs = 0;
    let runningTasks = 0;

    try {
      const cronJobs: ICronJob[] = await ipcBridge.cron.listJobs.invoke();
      activeCronJobs = cronJobs.filter((j) => j.enabled).length;
      if (activeCronJobs > 0) {
        summaryLines.push(`${activeCronJobs} scheduled task${activeCronJobs > 1 ? 's' : ''} running.`);
      }
    } catch {
      /* empty */
    }

    try {
      const taskResult = await ipcBridge.task.getRunningCount.invoke();
      runningTasks = taskResult.count;
      if (runningTasks > 0) {
        summaryLines.push(`${runningTasks} task${runningTasks > 1 ? 's are' : ' is'} active.`);
      }
    } catch {
      /* empty */
    }

    if (summaryLines.length === 0) {
      summaryLines.push('All systems nominal.');
    }

    return { activeCronJobs, runningTasks, greeting, summaryLines };
  }, []);

  // ── Audio playback (Gemini → speaker) ──

  /** Play queued audio chunks sequentially */
  const playNextChunk = useCallback(() => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    isPlayingRef.current = true;

    const chunk = audioQueueRef.current.shift()!;

    if (!playbackCtxRef.current || playbackCtxRef.current.state === 'closed') {
      playbackCtxRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    }

    const ctx = playbackCtxRef.current;
    const buffer = ctx.createBuffer(1, chunk.length, OUTPUT_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < chunk.length; i++) {
      channel[i] = chunk[i] / 32768;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      isPlayingRef.current = false;
      playNextChunk();
    };
    source.start();
  }, []);

  /** Queue an audio chunk for playback */
  const enqueueAudio = useCallback(
    (int16Samples: number[]) => {
      audioQueueRef.current.push(new Int16Array(int16Samples));
      playNextChunk();
    },
    [playNextChunk],
  );

  /** Clear audio queue and stop playback */
  const clearAudioQueue = useCallback(() => {
    audioQueueRef.current = [];
    isPlayingRef.current = false;
  }, []);

  // ── Microphone streaming (mic → Gemini) with audio level ──

  const startMicStream = useCallback(async () => {
    try {
      // Pick a real mic
      const devices = await navigator.mediaDevices.enumerateDevices();
      const realMic = devices.find(
        (d) =>
          d.kind === 'audioinput' &&
          d.label &&
          !VIRTUAL_DEVICE_KEYWORDS.some((kw) => d.label.toLowerCase().includes(kw)),
      );
      const audioConstraints: MediaStreamConstraints['audio'] = realMic
        ? { deviceId: { exact: realMic.deviceId } }
        : true;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      micStreamRef.current = stream;

      const micLabel = stream.getAudioTracks()[0]?.label ?? 'unknown';
      console.log('[JARVIS] Mic started:', micLabel);

      // Create audio context — request 16kHz if supported
      const ctx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        const float32 = e.inputBuffer.getChannelData(0);

        // Update audio level for visualization
        const rms = computeRMS(float32);
        setAudioLevel(Math.min(1, rms * 5)); // Amplify for visual effect

        const int16 = downsampleToInt16(float32, ctx.sampleRate, INPUT_SAMPLE_RATE);

        // Send audio chunk to main process → Gemini Live
        void ipcBridge.jarvisLive.sendAudio.invoke({ audio: Array.from(int16) });
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      // Decay audio level when no new data comes in
      audioLevelTimerRef.current = setInterval(() => {
        setAudioLevel((prev) => Math.max(0, prev * 0.85));
      }, 100);
    } catch (err) {
      console.error('[JARVIS] Failed to start mic stream:', err);
      setMicWarning('Failed to access microphone. Check permissions.');
    }
  }, []);

  const stopMicStream = useCallback(() => {
    if (audioLevelTimerRef.current) {
      clearInterval(audioLevelTimerRef.current);
      audioLevelTimerRef.current = null;
    }
    setAudioLevel(0);

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
  }, []);

  // ── Gemini Live event handler ──

  const handleLiveEvent = useCallback(
    (event: JarvisLiveEvent) => {
      switch (event.type) {
        case 'connected':
          updateState('listening');
          setStatusText('Listening... speak freely');
          break;

        case 'audio':
          if (event.audio) {
            if (jarvisStateRef.current !== 'speaking') {
              updateState('speaking');
              setStatusText('Speaking...');
            }
            enqueueAudio(event.audio);
          }
          break;

        case 'text':
          if (event.text) setResponse((prev) => prev + event.text);
          break;

        case 'input_transcript':
          if (event.text) setTranscript((prev) => prev + event.text);
          break;

        case 'output_transcript':
          if (event.text) setResponse((prev) => prev + event.text);
          break;

        case 'interrupted':
          clearAudioQueue();
          updateState('listening');
          setStatusText('Listening...');
          break;

        case 'turn_complete':
          updateState('listening');
          setStatusText('Listening... speak freely');
          // Clear transcript/response for next turn after a delay
          setTimeout(() => {
            setTranscript('');
            setResponse('');
          }, 3000);
          break;

        case 'action':
          if (event.action) {
            const { name: actionName, params } = event.action;
            if (actionName === 'navigate_to_conversation' && params?.conversationId) {
              void navigate(`/conversation/${params.conversationId as string}`);
            } else if (actionName === 'open_new_conversation') {
              void navigate('/');
            }
          }
          break;

        case 'wake':
          wakeUpRef.current();
          break;

        case 'error':
          if (event.message) setMicWarning(event.message);
          break;

        case 'disconnected':
          stopMicStream();
          clearAudioQueue();
          updateState('sleeping');
          setStatusText('Disconnected. Say "Jarvis", clap, or click to reconnect.');
          break;
      }
    },
    [clearAudioQueue, enqueueAudio, navigate, stopMicStream, updateState],
  );

  // Subscribe to Gemini Live events from main process
  useEffect(() => {
    const unsub = ipcBridge.jarvisLive.event.on(handleLiveEvent);
    eventUnsubRef.current = unsub;
    return () => {
      unsub();
      eventUnsubRef.current = null;
    };
  }, [handleLiveEvent]);

  // ── Wake / Connect ──

  const connectToGemini = useCallback(async () => {
    updateState('connecting');
    setStatusText('Connecting to Gemini Live...');
    setTranscript('');
    setResponse('');
    setMicWarning('');

    const result = await ipcBridge.jarvisLive.connect.invoke({});
    if (!result.success) {
      updateState('sleeping');
      setStatusText('Failed to connect. Check your Gemini API key in Settings → Models.');
      return;
    }

    // Start streaming mic audio to Gemini
    await startMicStream();
  }, [startMicStream, updateState]);

  const handleWakeUp = useCallback(async () => {
    if (jarvisStateRef.current !== 'sleeping') return;
    hasWokenRef.current = true;
    // Go straight to connecting — no delay, no blocking fetchActivity
    void fetchActivity().then(setActivity);
    await connectToGemini();
  }, [connectToGemini, fetchActivity]);

  // Keep ref current so handleLiveEvent (defined before handleWakeUp) can call it
  wakeUpRef.current = () => void handleWakeUp();

  const handleSleep = useCallback(() => {
    stopMicStream();
    clearAudioQueue();
    void ipcBridge.jarvisLive.disconnect.invoke();
    updateState('sleeping');
    setStatusText('Clap or click the orb to wake me up');
    setTranscript('');
    setResponse('');
    setMicWarning('');
  }, [clearAudioQueue, stopMicStream, updateState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMicStream();
      clearAudioQueue();
      void ipcBridge.jarvisLive.disconnect.invoke();
    };
  }, [clearAudioQueue, stopMicStream]);

  // Clap detection (only when sleeping)
  useClapDetection({
    enabled: jarvisState === 'sleeping',
    onClap: () => void handleWakeUp(),
    energyThreshold: 0.3,
    cooldownMs: 2000,
  });

  // Wake word detection — VAD in renderer + Gemini transcription in main process
  useWakeWord({
    enabled: jarvisState === 'sleeping',
    onWake: () => void handleWakeUp(),
  });

  const handleOrbClick = useCallback(() => {
    if (jarvisState === 'sleeping') {
      void handleWakeUp();
    } else if (jarvisState === 'listening' || jarvisState === 'speaking' || jarvisState === 'active') {
      handleSleep();
    }
  }, [handleSleep, handleWakeUp, jarvisState]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        handleOrbClick();
      }
    },
    [handleOrbClick],
  );

  const orbClassName = useMemo(() => {
    const base = styles.orb;
    switch (jarvisState) {
      case 'sleeping':
        return `${base} ${styles.orbSleeping}`;
      case 'waking':
      case 'connecting':
        return `${base} ${styles.orbWaking}`;
      case 'listening':
        return `${base} ${styles.orbListening}`;
      case 'speaking':
        return `${base} ${styles.orbSpeaking}`;
      case 'active':
        return `${base} ${styles.orbActive}`;
      default:
        return base;
    }
  }, [jarvisState]);

  // Dynamic orb scale based on audio level when listening
  const orbDynamicStyle = useMemo(() => {
    if (jarvisState === 'listening' && audioLevel > 0.01) {
      const scale = 1 + audioLevel * 0.15;
      const glowIntensity = Math.round(20 + audioLevel * 40);
      const glowSpread = Math.round(8 + audioLevel * 24);
      return {
        '--jarvis-audio-scale': `${scale}`,
        '--jarvis-glow-intensity': `${glowIntensity}`,
        '--jarvis-glow-spread': `${glowSpread}`,
      } as React.CSSProperties;
    }
    return {
      '--jarvis-audio-scale': '1',
      '--jarvis-glow-intensity': '20',
      '--jarvis-glow-spread': '8',
    } as React.CSSProperties;
  }, [audioLevel, jarvisState]);

  return (
    <div className={styles.jarvisContainer}>
      <div className={styles.jarvisContent}>
        {/* Siri-style Glass Orb */}
        <div
          className={orbClassName}
          onClick={handleOrbClick}
          onKeyDown={handleKeyDown}
          role='button'
          tabIndex={0}
          aria-label={jarvisState === 'sleeping' ? 'Clap or click to wake JARVIS' : 'Click to sleep JARVIS'}
          style={orbDynamicStyle}
        >
          <div className={styles.orbCore} />
          <div className={styles.orbRing1} />
          <div className={styles.orbRing2} />
          <div className={styles.orbRing3} />
          {jarvisState === 'sleeping' && <div className={styles.orbPulse} />}

          {/* Audio level visualizer rings — visible when listening */}
          {jarvisState === 'listening' && (
            <>
              <div
                className={styles.audioRing}
                style={{
                  transform: `scale(${1 + audioLevel * 0.5})`,
                  opacity: Math.min(0.6, audioLevel * 2),
                }}
              />
              <div
                className={styles.audioRing2}
                style={{
                  transform: `scale(${1 + audioLevel * 0.8})`,
                  opacity: Math.min(0.3, audioLevel * 1.2),
                }}
              />
            </>
          )}
        </div>

        {/* Title */}
        <h1 className={styles.jarvisTitle}>
          {jarvisState === 'sleeping' ? 'J . A . R . V . I . S' : 'JARVIS'}
        </h1>

        {/* Live indicator when connected */}
        {(jarvisState === 'listening' || jarvisState === 'speaking') && (
          <div className={styles.micIndicator}>
            <span className={styles.micDot} />
            <span>{jarvisState === 'listening' ? 'Live — Listening' : 'Live — Speaking'}</span>
          </div>
        )}

        {/* Connecting indicator */}
        {jarvisState === 'connecting' && (
          <div className={styles.micIndicator}>
            <span className={styles.micDot} />
            <span>Connecting to Gemini...</span>
          </div>
        )}

        {/* Audio level bar — shows real-time mic activity */}
        {jarvisState === 'listening' && (
          <div className={styles.audioLevelContainer}>
            <div className={styles.audioLevelBar} style={{ width: `${Math.max(4, audioLevel * 100)}%` }} />
          </div>
        )}

        {/* Status text */}
        <p className={styles.statusText}>{statusText}</p>

        {/* User transcript (what Gemini heard) */}
        {transcript && jarvisState !== 'sleeping' && (
          <p className={styles.transcript}>&ldquo;{transcript}&rdquo;</p>
        )}

        {/* Gemini response text */}
        {response && (jarvisState === 'speaking' || jarvisState === 'listening') && (
          <p className={styles.response}>{response}</p>
        )}

        {/* Activity panel */}
        {activity && jarvisState !== 'sleeping' && (
          <div className={styles.activityPanel}>
            <div className={styles.activityHeader}>System Status</div>
            <div className={styles.activityGrid}>
              <div className={styles.activityCard}>
                <div className={styles.activityValue}>{activity.activeCronJobs}</div>
                <div className={styles.activityLabel}>Scheduled</div>
              </div>
              <div className={styles.activityCard}>
                <div className={styles.activityValue}>{activity.runningTasks}</div>
                <div className={styles.activityLabel}>Running</div>
              </div>
            </div>
          </div>
        )}

        {/* Mic warning */}
        {micWarning && (
          <p className={styles.micWarning}>{micWarning}</p>
        )}

        {/* Sleeping hint */}
        {jarvisState === 'sleeping' && (
          <p className={styles.hintText}>
            Say &ldquo;Hello JARVIS&rdquo;, clap, or click
          </p>
        )}

        {/* Active hint — click to disconnect */}
        {(jarvisState === 'listening' || jarvisState === 'speaking') && (
          <p className={styles.hintText}>
            Click the orb to disconnect
          </p>
        )}
      </div>
    </div>
  );
};

export default JarvisPage;
