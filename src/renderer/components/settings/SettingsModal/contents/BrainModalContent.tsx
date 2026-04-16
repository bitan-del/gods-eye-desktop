/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

import { shell, brain } from '@/common/adapter/ipcBridge';
import type { BrainStatus } from '@/common/types/brain';
import { ConfigStorage } from '@/common/config/storage';
import { Button, Input, Message, Switch, Tag } from '@arco-design/web-react';
import { CheckOne, Close, FolderOpen, Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import BrainGraphView from './BrainGraphView';

/**
 * Inline preference row — reused pattern across settings tabs.
 */
const PreferenceRow: React.FC<{
  label: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, description, children }) => (
  <div className='flex items-center justify-between gap-12px py-12px'>
    <div className='min-w-0 flex-1'>
      <div className='text-14px text-t-primary'>{label}</div>
      {description && <div className='text-12px text-t-tertiary mt-2px'>{description}</div>}
    </div>
    <div className='flex items-center shrink-0'>{children}</div>
  </div>
);

/**
 * BrainModalContent — settings panel for the Obsidian-compatible vault.
 */
const BrainModalContent: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<BrainStatus | null>(null);
  const [defaultPath, setDefaultPath] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [injectMemory, setInjectMemory] = useState(true);
  const [autoSummarize, setAutoSummarize] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, d, memPref, sumPref] = await Promise.all([
        brain.getStatus.invoke(),
        brain.defaultVaultPath.invoke(),
        ConfigStorage.get('brain.injectAgentMemory').catch(() => true),
        ConfigStorage.get('brain.autoSummarize').catch(() => false),
      ]);
      setStatus(s);
      setDefaultPath(d);
      setInjectMemory(memPref !== false);
      setAutoSummarize(sumPref === true);
    } catch (err) {
      console.error('[BrainModalContent] refresh failed', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleToggle = async (enabled: boolean) => {
    try {
      await brain.setEnabled.invoke({ enabled });
      if (enabled && !status?.vaultPath) {
        // Auto-materialise the default vault on first enable so the user sees something immediately.
        const chosen = await brain.ensureVault.invoke({});
        await brain.setVaultPath.invoke({ vaultPath: chosen });
      }
      await refresh();
    } catch (err) {
      Message.error((err as Error)?.message ?? 'Failed to toggle Brain');
    }
  };

  const handlePick = async () => {
    try {
      const picked = await brain.pickVaultFolder.invoke();
      if (!picked) return;
      await brain.setVaultPath.invoke({ vaultPath: picked });
      Message.success(t('brain.chooseFolder'));
      await refresh();
    } catch (err) {
      Message.error((err as Error)?.message ?? 'Failed to choose folder');
    }
  };

  const handleUseDefault = async () => {
    try {
      const chosen = await brain.ensureVault.invoke({});
      await brain.setVaultPath.invoke({ vaultPath: chosen });
      await refresh();
    } catch (err) {
      Message.error((err as Error)?.message ?? 'Failed to create default vault');
    }
  };

  const handleReveal = async () => {
    if (!status?.vaultPath) return;
    try {
      await shell.showItemInFolder.invoke(status.vaultPath);
    } catch (err) {
      console.error('[BrainModalContent] reveal failed', err);
    }
  };

  const handleInjectMemoryChange = async (val: boolean) => {
    setInjectMemory(val);
    await ConfigStorage.set('brain.injectAgentMemory', val);
  };

  const handleAutoSummarizeChange = async (val: boolean) => {
    setAutoSummarize(val);
    await ConfigStorage.set('brain.autoSummarize', val);
  };

  const enabled = status?.enabled ?? false;

  return (
    <div className='flex flex-col gap-8px text-14px text-t-primary'>
      <div>
        <div className='text-16px font-500'>{t('brain.title')}</div>
        <div className='text-12px text-t-tertiary mt-4px'>{t('brain.description')}</div>
      </div>

      <div className='border-color-border-2 border-rd-8px px-12px'>
        <PreferenceRow label={t('brain.enable')} description={t('brain.enableDescription')}>
          <Switch checked={enabled} onChange={handleToggle} />
        </PreferenceRow>
      </div>

      <div className='border-color-border-2 border-rd-8px px-12px'>
        <PreferenceRow label={t('brain.vaultPath')} description={t('brain.vaultPathDescription')}>
          <Button size='small' icon={<Refresh theme='outline' size='14' />} onClick={refresh} loading={loading}>
            {t('brain.status')}
          </Button>
        </PreferenceRow>

        <div className='pb-12px flex flex-col gap-8px'>
          <Input value={status?.vaultPath ?? ''} placeholder={t('brain.defaultHint', { path: defaultPath })} readOnly />
          <div className='flex flex-wrap gap-8px items-center'>
            <Button size='small' icon={<FolderOpen theme='outline' size='14' />} onClick={handlePick}>
              {t('brain.chooseFolder')}
            </Button>
            <Button size='small' onClick={handleUseDefault}>
              {t('brain.useDefault')}
            </Button>
            {status?.vaultPath && (
              <Button size='small' type='text' onClick={handleReveal}>
                {t('brain.revealInFinder')}
              </Button>
            )}
          </div>
          <div className='flex flex-wrap gap-6px items-center'>
            {!enabled && <Tag color='gray'>{t('brain.statusDisabled')}</Tag>}
            {enabled && status?.exists && (
              <Tag color='green' icon={<CheckOne theme='filled' size='12' />}>
                {t('brain.statusExists')}
              </Tag>
            )}
            {enabled && !status?.exists && (
              <Tag color='red' icon={<Close theme='outline' size='12' />}>
                {t('brain.statusMissing')}
              </Tag>
            )}
            {enabled && status?.writable && <Tag color='arcoblue'>{t('brain.statusWritable')}</Tag>}
            {enabled && status && !status.writable && status.exists && (
              <Tag color='orange'>{t('brain.statusReadOnly')}</Tag>
            )}
            {enabled && status?.exists && (
              <Tag color='gray'>{t('brain.statusNoteCount', { count: status.noteCount })}</Tag>
            )}
          </div>
        </div>
      </div>

      <div className='border-color-border-2 border-rd-8px px-12px'>
        <PreferenceRow label={t('brain.injectAgentMemory')} description={t('brain.injectAgentMemoryDescription')}>
          <Switch checked={injectMemory} onChange={handleInjectMemoryChange} disabled={!enabled} />
        </PreferenceRow>
        <PreferenceRow label={t('brain.autoSummarize')} description={t('brain.autoSummarizeDescription')}>
          <Switch checked={autoSummarize} onChange={handleAutoSummarizeChange} disabled={!enabled} />
        </PreferenceRow>
      </div>

      {enabled && status?.exists && (
        <div className='border-color-border-2 border-rd-8px p-12px'>
          <BrainGraphView />
        </div>
      )}
    </div>
  );
};

export default BrainModalContent;
