/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Floating draggable JARVIS orb — always-on-top voice assistant widget.
 *
 * Renders a small glass orb that can be dragged anywhere on screen.
 * Handles its own Gemini Live connection, mic streaming, audio playback,
 * and wake word / clap detection independently of the full JARVIS page.
 */

import { ipcBridge } from '@/common';
import type { JarvisLiveEvent } from '@/common/types/speech';
import { useWakeWord } from '@/renderer/hooks/system/useWakeWord';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styles from './JarvisFloat.module.css';

type FloatState = 'sleeping' | 'connecting' | 'listening' | 'speaking';

/** Virtual audio device keywords to skip */
const VIRTUAL_KEYWORDS = ['blackhole', 'virtual', 'soundflower', 'loopback'];
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

/** Downsample and convert Float32 to Int16 */
const toInt16 = (float32: Float32Array, srcRate: number, dstRate: number): Int16Array => {
  const ratio = srcRate / dstRate;
  const len = Math.round(float32.length / ratio);
  const out = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const si = i * ratio;
    const lo = Math.floor(si);
    const hi = Math.min(lo + 1, float32.length - 1);
    const f = si - lo;
    const s = float32[lo] * (1 - f) + float32[hi] * f;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
  }
  return out;
};

const JarvisFloat: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const isOnJarvisPage = location.pathname === '/jarvis';

  const [state, setState] = useState<FloatState>('sleeping');
  const stateRef = useRef<FloatState>('sleeping');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [showBubble, setShowBubble] = useState(false);

  // Drag state
  const [position, setPosition] = useState({ x: -1, y: -1 });
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Audio refs
  const micStreamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);
  const eventUnsubRef = useRef<(() => void) | null>(null);
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateState = useCallback((s: FloatState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  // ── Default position (bottom-right) ──
  useEffect(() => {
    if (position.x < 0) {
      setPosition({ x: window.innerWidth - 72, y: window.innerHeight - 80 });
    }
  }, [position.x]);

  // ── Audio playback ──

  const playNext = useCallback(() => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
    isPlayingRef.current = true;
    const chunk = audioQueueRef.current.shift()!;
    if (!playCtxRef.current || playCtxRef.current.state === 'closed') {
      playCtxRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    }
    const ctx = playCtxRef.current;
    const buf = ctx.createBuffer(1, chunk.length, OUTPUT_SAMPLE_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < chunk.length; i++) ch[i] = chunk[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => { isPlayingRef.current = false; playNext(); };
    src.start();
  }, []);

  const enqueue = useCallback((samples: number[]) => {
    audioQueueRef.current.push(new Int16Array(samples));
    playNext();
  }, [playNext]);

  const clearQueue = useCallback(() => {
    audioQueueRef.current = [];
    isPlayingRef.current = false;
  }, []);

  // ── Mic streaming ──

  const startMic = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mic = devices.find(
        (d) => d.kind === 'audioinput' && d.label && !VIRTUAL_KEYWORDS.some((k) => d.label.toLowerCase().includes(k)),
      );
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: mic ? { deviceId: { exact: mic.deviceId } } : true,
      });
      micStreamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
      micCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = proc;
      proc.onaudioprocess = (e: AudioProcessingEvent) => {
        const data = e.inputBuffer.getChannelData(0);
        const int16 = toInt16(data, ctx.sampleRate, INPUT_SAMPLE_RATE);
        void ipcBridge.jarvisLive.sendAudio.invoke({ audio: Array.from(int16) });
      };
      source.connect(proc);
      proc.connect(ctx.destination);
    } catch (err) {
      console.error('[JarvisFloat] Mic failed:', err);
    }
  }, []);

  const stopMic = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    if (micCtxRef.current) { void micCtxRef.current.close().catch(() => {}); micCtxRef.current = null; }
    if (micStreamRef.current) { micStreamRef.current.getTracks().forEach((t) => t.stop()); micStreamRef.current = null; }
  }, []);

  // ── Show bubble temporarily ──

  const flashBubble = useCallback((durationMs = 5000) => {
    setShowBubble(true);
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = setTimeout(() => setShowBubble(false), durationMs);
  }, []);

  // ── Gemini Live event handler ──

  const handleEvent = useCallback((event: JarvisLiveEvent) => {
    switch (event.type) {
      case 'connected':
        updateState('listening');
        break;
      case 'audio':
        if (event.audio) {
          if (stateRef.current !== 'speaking') updateState('speaking');
          enqueue(event.audio);
        }
        break;
      case 'input_transcript':
        if (event.text) {
          setTranscript((p) => p + event.text);
          flashBubble(6000);
        }
        break;
      case 'output_transcript':
      case 'text':
        if (event.text) {
          setResponse((p) => p + event.text);
          flashBubble(6000);
        }
        break;
      case 'interrupted':
        clearQueue();
        updateState('listening');
        break;
      case 'turn_complete':
        updateState('listening');
        setTimeout(() => { setTranscript(''); setResponse(''); }, 4000);
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
      case 'error':
        if (event.message) {
          setResponse(event.message);
          flashBubble(5000);
        }
        break;
      case 'disconnected':
        stopMic();
        clearQueue();
        updateState('sleeping');
        break;
    }
  }, [clearQueue, enqueue, flashBubble, navigate, stopMic, updateState]);

  // Subscribe to events
  useEffect(() => {
    if (isOnJarvisPage) return; // JarvisPage handles events
    const unsub = ipcBridge.jarvisLive.event.on(handleEvent);
    eventUnsubRef.current = unsub;
    return () => { unsub(); eventUnsubRef.current = null; };
  }, [handleEvent, isOnJarvisPage]);

  // ── Connect / Disconnect ──

  const connect = useCallback(async () => {
    updateState('connecting');
    setTranscript('');
    setResponse('');
    const result = await ipcBridge.jarvisLive.connect.invoke({});
    if (!result.success) {
      updateState('sleeping');
      setResponse('Failed to connect. Check Gemini API key.');
      flashBubble(4000);
      return;
    }
    await startMic();
  }, [flashBubble, startMic, updateState]);

  const disconnect = useCallback(() => {
    stopMic();
    clearQueue();
    void ipcBridge.jarvisLive.disconnect.invoke();
    updateState('sleeping');
    setTranscript('');
    setResponse('');
  }, [clearQueue, stopMic, updateState]);

  const handleWakeUp = useCallback(async () => {
    if (stateRef.current !== 'sleeping' || isOnJarvisPage) return;
    await connect();
  }, [connect, isOnJarvisPage]);

  // Wake word detection (only when sleeping and not on jarvis page)
  useWakeWord({
    enabled: state === 'sleeping' && !isOnJarvisPage,
    onWake: () => void handleWakeUp(),
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMic();
      clearQueue();
    };
  }, [clearQueue, stopMic]);

  // ── Drag handling ──

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, origX: position.x, origY: position.y };
    e.preventDefault();
  }, [position]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d.dragging) return;
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 60, d.origX + (e.clientX - d.startX))),
        y: Math.max(0, Math.min(window.innerHeight - 60, d.origY + (e.clientY - d.startY))),
      });
    };
    const onUp = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d.dragging) return;
      d.dragging = false;
      // If barely moved, treat as click
      const dist = Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY);
      if (dist < 5) {
        if (stateRef.current === 'sleeping') {
          void handleWakeUp();
        } else {
          disconnect();
        }
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [disconnect, handleWakeUp]);

  // ── Orb class ──

  const orbClass = useMemo(() => {
    const base = styles.orb;
    switch (state) {
      case 'sleeping': return `${base} ${styles.orbSleeping}`;
      case 'connecting': return `${base} ${styles.orbConnecting}`;
      case 'listening': return `${base} ${styles.orbListening}`;
      case 'speaking': return `${base} ${styles.orbSpeaking}`;
      default: return base;
    }
  }, [state]);

  // Hide when on the full JARVIS page
  if (isOnJarvisPage) return null;

  return (
    <div
      ref={containerRef}
      className={styles.floatContainer}
      style={{ left: position.x, top: position.y }}
    >
      {/* Speech bubble */}
      {showBubble && (transcript || response) && (
        <div className={styles.bubble}>
          {transcript && <div className={styles.bubbleTranscript}>&ldquo;{transcript}&rdquo;</div>}
          {response && <div className={styles.bubbleResponse}>{response}</div>}
          {!transcript && !response && <div className={styles.bubbleStatus}>Listening...</div>}
        </div>
      )}

      {/* Orb */}
      <div className={orbClass} onMouseDown={onMouseDown}>
        <div className={styles.orbInner} />

        {state === 'sleeping' && <div className={styles.pulseRing} />}

        {state === 'listening' && <div className={styles.audioRing} />}

        {/* State indicator dot */}
        {state === 'listening' && <div className={`${styles.stateDot} ${styles.stateDotListening}`} />}
        {state === 'speaking' && <div className={`${styles.stateDot} ${styles.stateDotSpeaking}`} />}
        {state === 'connecting' && <div className={`${styles.stateDot} ${styles.stateDotConnecting}`} />}
      </div>
    </div>
  );
};

export default JarvisFloat;
