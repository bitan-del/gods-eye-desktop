/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { ICronJob } from '@/common/adapter/ipcBridge';
import { useClapDetection } from '@/renderer/hooks/system/useClapDetection';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import styles from './jarvis.module.css';

type JarvisState = 'sleeping' | 'waking' | 'active' | 'speaking';

type ActivityData = {
  recentConversationCount: number;
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

const speak = (text: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 0.9;
    utterance.volume = 1;
    // Prefer a deep English voice
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
      (v) => v.lang.startsWith('en') && (v.name.includes('Daniel') || v.name.includes('Alex') || v.name.includes('Male'))
    );
    if (preferred) utterance.voice = preferred;
    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new Error('TTS failed'));
    window.speechSynthesis.speak(utterance);
  });
};

const JarvisPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [jarvisState, setJarvisState] = useState<JarvisState>('sleeping');
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [statusText, setStatusText] = useState('Listening for clap to wake up...');
  const [clapEnabled, setClapEnabled] = useState(true);
  const hasWokenRef = useRef(false);
  const orbRef = useRef<HTMLDivElement>(null);

  // Ensure TTS voices are loaded
  useEffect(() => {
    window.speechSynthesis?.getVoices();
    const handleVoicesChanged = () => window.speechSynthesis?.getVoices();
    window.speechSynthesis?.addEventListener('voiceschanged', handleVoicesChanged);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', handleVoicesChanged);
  }, []);

  const fetchActivity = useCallback(async (): Promise<ActivityData> => {
    const greeting = `${getTimeGreeting()}, sir.`;
    const summaryLines: string[] = [];

    let recentConversationCount = 0;
    let activeCronJobs = 0;
    let runningTasks = 0;

    try {
      const cronJobs: ICronJob[] = await ipcBridge.cron.listJobs.invoke();
      activeCronJobs = cronJobs.filter((j) => j.enabled).length;
      if (activeCronJobs > 0) {
        summaryLines.push(`You have ${activeCronJobs} active scheduled task${activeCronJobs > 1 ? 's' : ''} running.`);
      }
    } catch {
      // Cron data unavailable
    }

    try {
      const taskResult = await ipcBridge.task.getRunningCount.invoke();
      runningTasks = taskResult.count;
      if (runningTasks > 0) {
        summaryLines.push(`${runningTasks} task${runningTasks > 1 ? 's are' : ' is'} currently running.`);
      }
    } catch {
      // Task data unavailable
    }

    if (summaryLines.length === 0) {
      summaryLines.push('All systems are nominal. No active tasks at the moment.');
    }

    summaryLines.push('How can I assist you today?');

    return { recentConversationCount, activeCronJobs, runningTasks, greeting, summaryLines };
  }, []);

  const handleWakeUp = useCallback(async () => {
    if (hasWokenRef.current) return;
    hasWokenRef.current = true;
    setClapEnabled(false);

    setJarvisState('waking');
    setStatusText('Waking up...');

    // Brief pause for the wake animation
    await new Promise((r) => setTimeout(r, 800));

    setJarvisState('speaking');
    const activityData = await fetchActivity();
    setActivity(activityData);

    // Speak the greeting
    setStatusText(activityData.greeting);
    try {
      await speak(activityData.greeting);

      // Speak each summary line
      for (const line of activityData.summaryLines) {
        setStatusText(line);
        await speak(line);
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch {
      // TTS not available, just show text
    }

    setJarvisState('active');
    setStatusText('At your service.');
  }, [fetchActivity]);

  useClapDetection({
    enabled: clapEnabled,
    onClap: handleWakeUp,
    energyThreshold: 0.3,
    cooldownMs: 1000,
  });

  // Allow manual wake with click/Enter
  const handleManualWake = useCallback(() => {
    if (jarvisState === 'sleeping') {
      void handleWakeUp();
    }
  }, [jarvisState, handleWakeUp]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        handleManualWake();
      }
    },
    [handleManualWake]
  );

  const handleGoToChat = useCallback(() => {
    navigate('/guid');
  }, [navigate]);

  const orbClassName = useMemo(() => {
    const base = styles.orb;
    switch (jarvisState) {
      case 'sleeping':
        return `${base} ${styles.orbSleeping}`;
      case 'waking':
        return `${base} ${styles.orbWaking}`;
      case 'speaking':
        return `${base} ${styles.orbSpeaking}`;
      case 'active':
        return `${base} ${styles.orbActive}`;
      default:
        return base;
    }
  }, [jarvisState]);

  return (
    <div className={styles.jarvisContainer}>
      <div className={styles.jarvisContent}>
        {/* Animated Orb */}
        <div
          ref={orbRef}
          className={orbClassName}
          onClick={handleManualWake}
          onKeyDown={handleKeyDown}
          role='button'
          tabIndex={0}
          aria-label={jarvisState === 'sleeping' ? 'Clap or click to wake Jarvis' : 'Jarvis is active'}
        >
          <div className={styles.orbCore} />
          <div className={styles.orbRing1} />
          <div className={styles.orbRing2} />
          <div className={styles.orbRing3} />
          {jarvisState === 'sleeping' && <div className={styles.orbPulse} />}
        </div>

        {/* Title */}
        <h1 className={styles.jarvisTitle}>
          {jarvisState === 'sleeping' ? 'J.A.R.V.I.S.' : 'JARVIS'}
        </h1>

        {/* Status Text */}
        <p className={styles.statusText}>{statusText}</p>

        {/* Activity Summary */}
        {activity && jarvisState === 'active' && (
          <div className={styles.activityPanel}>
            <div className={styles.activityHeader}>System Status</div>
            <div className={styles.activityGrid}>
              <div className={styles.activityCard}>
                <div className={styles.activityValue}>{activity.activeCronJobs}</div>
                <div className={styles.activityLabel}>Scheduled Tasks</div>
              </div>
              <div className={styles.activityCard}>
                <div className={styles.activityValue}>{activity.runningTasks}</div>
                <div className={styles.activityLabel}>Running Tasks</div>
              </div>
            </div>
            <div className={styles.summaryLines}>
              {activity.summaryLines.map((line, i) => (
                <p key={i} className={styles.summaryLine}>
                  {line}
                </p>
              ))}
            </div>
            <button type='button' className={styles.startChatButton} onClick={handleGoToChat}>
              Start a Conversation
            </button>
          </div>
        )}

        {jarvisState === 'sleeping' && (
          <p className={styles.hintText}>
            Clap your hands or click the orb to wake me up
          </p>
        )}
      </div>
    </div>
  );
};

export default JarvisPage;
