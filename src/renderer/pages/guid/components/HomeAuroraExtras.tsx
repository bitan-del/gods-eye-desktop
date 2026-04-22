/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Aurora Pro editorial extras for the home page:
 *   - <GreetingEyebrow> — live time-of-day pill + formatted date with a pulse dot
 *   - <HomeShortcutHints> — footer chips showing ⌘K / ⌘, with functional bindings
 *   - <AuroraHeroTitle> — editorial split: head in ink, tail in italic muted serif
 *
 * Purely additive — no existing feature is touched. Styling lives in aurora-pro.css.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const isMac = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
};

const modKey = (): string => (isMac() ? '⌘' : 'Ctrl');

const timeOfDayLabel = (d: Date): string => {
  const h = d.getHours();
  if (h >= 0 && h < 5) return 'Late Night';
  if (h >= 5 && h < 8) return 'Early Morning';
  if (h >= 8 && h < 12) return 'Morning';
  if (h === 12) return 'Noon';
  if (h > 12 && h < 17) return 'Afternoon';
  if (h >= 17 && h < 21) return 'Evening';
  return 'Night';
};

const formatDate = (d: Date, locale?: string): string => {
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    })
      .format(d)
      .toUpperCase();
  } catch {
    return d.toDateString().toUpperCase();
  }
};

/** Live-updating greeting pill above the hero title. */
export const GreetingEyebrow: React.FC<{ locale?: string }> = ({ locale }) => {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const tick = () => setNow(new Date());
    // Update once per minute (sync to the next minute boundary for accuracy).
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const timeoutId = setTimeout(() => {
      tick();
      intervalId = setInterval(tick, 60_000);
    }, msToNextMinute);
    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const label = useMemo(() => timeOfDayLabel(now), [now]);
  const date = useMemo(() => formatDate(now, locale), [now, locale]);

  return (
    <div className='greeting-eyebrow' role='status' aria-live='polite'>
      <span className='pulse' aria-hidden='true' />
      <span>
        {label.toUpperCase()} · {date}
      </span>
    </div>
  );
};

/**
 * Aurora Pro editorial hero split. Renders the first half of the title in
 * regular ink and the second half in italic muted serif, mirroring the
 * reference design. Falls back to plain rendering for short or CJK titles
 * where a word-boundary split is not meaningful.
 */
const splitHeroTitle = (text: string): { head: string; accent: string } | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const words = trimmed.split(/\s+/).filter(Boolean);
  // Only split when we have enough latin-script words to produce two balanced halves.
  if (words.length >= 4) {
    const mid = Math.floor(words.length / 2);
    return {
      head: words.slice(0, mid).join(' '),
      accent: words.slice(mid).join(' '),
    };
  }
  return null;
};

export const AuroraHeroTitle: React.FC<{ title: string; className?: string }> = ({ title, className }) => {
  const split = useMemo(() => splitHeroTitle(title), [title]);
  if (!split) {
    return <span className={className}>{title}</span>;
  }
  return (
    <span className={className}>
      {split.head}{' '}
      <span className='aurora-hero-accent'>{split.accent}</span>
    </span>
  );
};

/** Keyboard-shortcut hint footer. ⌘K focuses the composer, ⌘, opens settings. */
export const HomeShortcutHints: React.FC = () => {
  const navigate = useNavigate();
  const mod = modKey();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = isMac() ? e.metaKey : e.ctrlKey;
      if (!meta) return;

      // ⌘K — open the global conversation search popover.
      // Falls back to focusing the composer textarea if nothing listens.
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        const opened = window.dispatchEvent(new CustomEvent('gods-eye:open-search'));
        // dispatchEvent returns true unless preventDefault was called; we still
        // attempt the search trigger via DOM click as a secondary fallback so
        // that users get *some* affordance even if the listener is not mounted.
        if (opened) {
          const trigger = document.querySelector<HTMLButtonElement>(
            '[data-gods-eye-search-trigger], [aria-label*="search" i][role="button"], button[aria-label*="search" i]'
          );
          if (trigger && !document.querySelector('.arco-popover-popup-visible')) {
            // Give the custom-event listener a tick; if it didn't open anything,
            // clicking the trigger is the last-resort open path.
            setTimeout(() => {
              if (!document.querySelector('.arco-popover-popup-visible')) {
                trigger.click();
              }
            }, 0);
          }
        }
        return;
      }

      // ⌘, — open settings.
      if (e.key === ',') {
        e.preventDefault();
        Promise.resolve(navigate('/settings/gemini')).catch((err) => {
          console.error('Navigation failed:', err);
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate]);

  return (
    <div className='home-shortcut-hints' aria-hidden='false'>
      <kbd className='k-pill'>{mod}</kbd>
      <kbd className='k-pill'>K</kbd>
      <span className='shortcut-label'>to search everything</span>
      <span className='shortcut-dot' aria-hidden='true'>
        ·
      </span>
      <kbd className='k-pill'>{mod}</kbd>
      <kbd className='k-pill'>,</kbd>
      <span className='shortcut-label'>for settings</span>
    </div>
  );
};
