/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { ConfigStorage } from '@/common/config/storage';
import { openExternalUrl } from '@/renderer/utils/platform';
import { Message, Switch, Tooltip } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const SKILLS_MARKET_DETAILS_ZH = 'https://github.com/bitan-del/gods-eye-desktop/discussions/1326';
const SKILLS_MARKET_DETAILS_EN = 'https://github.com/bitan-del/gods-eye-desktop/discussions/1325';

const SkillsMarketBanner: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);

  // Read the persisted toggle state in the background. Previously this
  // hook gated rendering behind `initialized` with a 2-second fallback
  // timeout — which produced a visible "banner pops in a few seconds
  // after the page loads" shift on every open. The default state of
  // `enabled = false` is a safe initial value, so we render immediately
  // and update silently when the storage read resolves.
  useEffect(() => {
    void ConfigStorage.get('skillsMarket.enabled')
      .then((val) => {
        setEnabled(!!val);
      })
      .catch((error) => {
        console.warn('Failed to read skills market setting, fallback to disabled:', error);
        setEnabled(false);
      });
  }, []);

  const handleToggle = useCallback(
    async (checked: boolean) => {
      if (loading) return;
      setLoading(true);
      try {
        const result = checked
          ? await ipcBridge.fs.enableSkillsMarket.invoke()
          : await ipcBridge.fs.disableSkillsMarket.invoke();

        if (result?.success) {
          setEnabled(checked);
          await ConfigStorage.set('skillsMarket.enabled', checked);
        } else {
          Message.error(result?.msg || 'Operation failed');
        }
      } catch (error) {
        console.error('Failed to toggle Skills Market:', error);
        Message.error('Operation failed');
      } finally {
        setLoading(false);
      }
    },
    [loading]
  );

  const handleOpenDetails = useCallback(async () => {
    try {
      const url = i18n.language.startsWith('zh') ? SKILLS_MARKET_DETAILS_ZH : SKILLS_MARKET_DETAILS_EN;
      await openExternalUrl(url);
    } catch (error) {
      console.error('Failed to open Skills Market URL:', error);
    }
  }, [i18n.language]);

  const [hovered, setHovered] = useState(false);

  return (
    <div
      className='absolute z-10 skills-market-banner'
      style={{
        top: 'calc(12px + env(safe-area-inset-top, 0px))',
        // Anchor the banner horizontally centred over the hero/composer
        // column (not the full main pane) so it stays visually grouped
        // with the content below it. `.guidLayout` sits at left-margin
        // (W-800)*0.35 with width 800, so its centre is at
        // (W-800)*0.35 + 400. For the 220px-wide banner we want
        //   W - right - 110 = (W-800)*0.35 + 400
        // which solves to right = 0.65*W - 230. The `max(12px, …)`
        // floor keeps the banner inside the pane on narrow windows
        // where that expression would go negative.
        right: 'max(12px, calc(100% * 0.65 - 230px))',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className='flex items-center border border-solid border-[var(--color-border-2)] bg-fill-0 gap-8px rd-10px overflow-hidden'
        style={{
          // Only transition properties that don't change the element's
          // bounding box. Previously `transition-all duration-300` was
          // animating `padding` and `max-width` together, which on hover
          // caused the whole banner to "grow and slide" — perceived as
          // the page itself shifting. Padding/max-width now change
          // instantly on hover; colour / shadow changes still animate.
          transition: 'border-color 300ms ease, background-color 300ms ease, box-shadow 300ms ease',
          padding: hovered ? '10px 16px' : '6px 10px',
          maxWidth: hovered ? '300px' : '220px',
        }}
      >
        <div className='flex-1 min-w-0'>
          <div className='text-13px font-medium text-[var(--color-text-1)] whitespace-nowrap'>
            {t('conversation.welcome.skillsMarket')}
          </div>
          {hovered && (
            <div className='text-12px text-[var(--color-text-3)] mt-2px leading-tight animate-fade-in'>
              {t('conversation.welcome.skillsMarketDesc')}{' '}
              <span
                className='text-brand hover:text-brand-hover font-semibold cursor-pointer hover:underline transition-colors'
                onClick={handleOpenDetails}
              >
                {t('conversation.welcome.skillsMarketDetails')}
              </span>
            </div>
          )}
        </div>
        <Switch className='shrink-0' size='small' checked={enabled} loading={loading} onChange={handleToggle} />
      </div>
    </div>
  );
};

export default SkillsMarketBanner;
