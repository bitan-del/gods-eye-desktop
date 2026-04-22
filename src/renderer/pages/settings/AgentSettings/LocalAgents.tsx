/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { ConfigStorage } from '@/common/config/storage';
import type { AcpBackend, AcpBackendConfig } from '@/common/types/acpTypes';
import GodsEyeModal from '@/renderer/components/base/GodsEyeModal';
import { resolveAgentLogo } from '@/renderer/utils/model/agentLogo';
import { Avatar, Button, Typography } from '@arco-design/web-react';
import { Home, Plus, Setting } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import AgentCard from './AgentCard';
import { AgentHubModal } from './AgentHubModal';
import BuiltinAgentPathModal from './BuiltinAgentPathModal';
import InlineAgentEditor from './InlineAgentEditor';

interface KnownBackendInfo {
  backend: AcpBackend;
  name: string;
  defaultCommand: string;
  acpArgs: string[];
  detected: boolean;
  cliPath?: string;
  overridePath?: string;
}

// Backends that already have a dedicated settings page; the gear should
// navigate there rather than opening the generic path-override modal.
const DEDICATED_SETTINGS_BACKENDS: Record<string, string> = {
  aionrs: '/settings/aionrs',
  gemini: '/settings/gemini',
};

const LocalAgents: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [hubModalVisible, setHubModalVisible] = useState(false);
  const [pathModalBackend, setPathModalBackend] = useState<KnownBackendInfo | null>(null);

  // Detected agents (include built-in backends and extension-contributed agents, exclude user custom and remote)
  const { data: detectedAgents, mutate: mutateDetected } = useSWR('acp.agents.available.settings', async () => {
    const result = await ipcBridge.acpConversation.getAvailableAgents.invoke();
    if (result.success && result.data) {
      return result.data.filter(
        (agent) => agent.backend !== 'remote' && (agent.backend !== 'custom' || agent.isExtension)
      );
    }
    return [];
  });

  // Known builtin backends — includes entries whose CLI was NOT detected so
  // the user can set a path manually. This is the escape hatch for fresh
  // installs where `which claude` fails because Claude Code lives at
  // ~/.claude/local/claude (outside the default Finder/Dock PATH).
  const { data: knownBackends, mutate: mutateKnown } = useSWR<KnownBackendInfo[]>(
    'acp.agents.known.settings',
    async () => {
      const result = await ipcBridge.acpConversation.getKnownBackends.invoke();
      if (result.success && result.data) return result.data as KnownBackendInfo[];
      return [];
    }
  );

  // Custom agents
  const { data: customAgents, mutate: mutateCustomAgents } = useSWR('acp.customAgents.settings', async () => {
    const agents = await ConfigStorage.get('acp.customAgents');
    return ((agents || []) as AcpBackendConfig[]).filter((a) => !a.isPreset);
  });

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AcpBackendConfig | null>(null);

  const handleSaveCustomAgent = useCallback(
    async (agent: AcpBackendConfig) => {
      const current = (await ConfigStorage.get('acp.customAgents')) || [];
      const existingIndex = (current as AcpBackendConfig[]).findIndex((a) => a.id === agent.id);
      const updatedAgents =
        existingIndex >= 0
          ? (current as AcpBackendConfig[]).map((a, i) => (i === existingIndex ? agent : a))
          : [...(current as AcpBackendConfig[]), agent];
      await ConfigStorage.set('acp.customAgents', updatedAgents);
      await mutateCustomAgents();
      setEditorVisible(false);
      setEditingAgent(null);
    },
    [mutateCustomAgents]
  );

  const handleDeleteCustomAgent = useCallback(
    async (agentId: string) => {
      const current = (await ConfigStorage.get('acp.customAgents')) || [];
      const agents = (current as AcpBackendConfig[]).filter((a) => a.id !== agentId || a.isPreset);
      await ConfigStorage.set('acp.customAgents', agents);
      await mutateCustomAgents();
    },
    [mutateCustomAgents]
  );

  const handleToggleCustomAgent = useCallback(
    async (agentId: string, enabled: boolean) => {
      const current = (await ConfigStorage.get('acp.customAgents')) || [];
      const updatedAgents = (current as AcpBackendConfig[]).map((a) =>
        a.id === agentId && !a.isPreset ? { ...a, enabled } : a
      );
      if (updatedAgents.some((a) => a.id === agentId && !a.isPreset)) {
        await ConfigStorage.set('acp.customAgents', updatedAgents);
        await mutateCustomAgents();
      }
    },
    [mutateCustomAgents]
  );

  // Aion CLI and Gemini CLI first among detected agents
  const aionrsAgent = detectedAgents?.find((a) => a.backend === 'aionrs');
  const geminiAgent = detectedAgents?.find((a) => a.backend === 'gemini');
  const otherDetected = detectedAgents?.filter((a) => a.backend !== 'gemini' && a.backend !== 'aionrs') ?? [];

  // Known backends that are NOT in the detected set — these get "Set path"
  // placeholder cards so the user can manually configure `cliPath` even when
  // auto-detection fails.
  const detectedBackendIds = new Set((detectedAgents ?? []).map((a) => a.backend));
  const undetectedKnown = (knownBackends ?? []).filter((k) => !detectedBackendIds.has(k.backend));

  const openCustomAgentEditor = useCallback(() => {
    setEditingAgent(null);
    setEditorVisible(true);
  }, []);

  const handleOpenPathModal = useCallback(
    (backend: AcpBackend) => {
      const info = knownBackends?.find((k) => k.backend === backend);
      if (!info) {
        // Synthesise a minimal info object so users can still configure
        // a path even if the known-backends query hasn't returned yet.
        setPathModalBackend({
          backend,
          name: backend,
          defaultCommand: backend,
          acpArgs: [],
          detected: true,
          cliPath: undefined,
          overridePath: undefined,
        });
        return;
      }
      setPathModalBackend(info);
    },
    [knownBackends]
  );

  const handlePathSaved = useCallback(async () => {
    setPathModalBackend(null);
    // Re-run backend-side detection by refetching both queries. Detection
    // on the process side has already been re-run by setBuiltinCliPath.
    await Promise.all([mutateDetected(), mutateKnown()]);
  }, [mutateDetected, mutateKnown]);

  const handleSettingsForDetected = useCallback(
    (backend: AcpBackend) => {
      const dedicated = DEDICATED_SETTINGS_BACKENDS[backend];
      if (dedicated) {
        navigate(dedicated);
        return;
      }
      handleOpenPathModal(backend);
    },
    [navigate, handleOpenPathModal]
  );

  return (
    <div className='flex flex-col gap-8px py-16px'>
      <div className='px-16px text-12px text-t-secondary'>
        <span>{t('settings.agentManagement.localAgentsDescription')} </span>
        <Button
          type='text'
          size='mini'
          className='!h-auto !p-0 !align-baseline !text-12px !font-normal !text-primary-6 hover:!text-primary-7 hover:!underline underline-offset-2'
          onClick={openCustomAgentEditor}
        >
          {t('settings.agentManagement.detectCustomAgent')}
        </Button>
      </div>

      {process.env.NODE_ENV === 'development' && (
        <div className='px-16px mt-8px'>
          <div className='flex flex-col gap-14px rounded-16px border border-solid border-[rgba(var(--primary-6),0.18)] bg-[rgba(var(--primary-6),0.06)] p-16px md:flex-row md:items-center md:justify-between'>
            <div className='flex items-center gap-12px'>
              <div className='flex h-40px w-40px items-center justify-center leading-none rounded-12px border border-solid border-[rgba(var(--primary-6),0.12)] bg-[rgba(var(--primary-6),0.10)] text-primary-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]'>
                <Home theme='outline' size='20' strokeWidth={2} className='block' />
              </div>
              <div className='min-w-0'>
                <Typography.Text className='mb-4px block text-15px font-medium text-t-primary'>
                  {t('settings.agentManagement.installFromMarket')}
                </Typography.Text>
                <Typography.Text className='block text-12px leading-18px text-t-secondary'>
                  {t('settings.agentManagement.discoverMoreAgents')}
                </Typography.Text>
              </div>
            </div>

            <Button
              type='primary'
              size='small'
              icon={<Plus size='14' />}
              className='!rounded-10px md:!min-w-144px'
              onClick={() => setHubModalVisible(true)}
            >
              {t('settings.agentManagement.installFromMarket')}
            </Button>
          </div>
        </div>
      )}

      {/* Detected Agents section */}
      <div className='px-16px mt-8px'>
        <Typography.Text className='text-12px font-medium text-t-secondary mb-4px block'>
          {t('settings.agentManagement.detected')}
        </Typography.Text>
      </div>
      <div className='grid grid-cols-2 gap-10px px-16px md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
        {aionrsAgent && (
          <AgentCard
            type='detected'
            agent={aionrsAgent}
            settingsDisabled={false}
            onSettings={() => navigate('/settings/aionrs')}
            variant='grid'
          />
        )}
        {geminiAgent && (
          <AgentCard
            type='detected'
            agent={geminiAgent}
            settingsDisabled={false}
            onSettings={() => navigate('/settings/gemini')}
            variant='grid'
          />
        )}
        {otherDetected.map((agent) => (
          <AgentCard
            key={agent.backend}
            type='detected'
            agent={agent}
            settingsDisabled={false}
            onSettings={() => handleSettingsForDetected(agent.backend as AcpBackend)}
            variant='grid'
          />
        ))}
      </div>
      {(!detectedAgents || detectedAgents.length === 0) && (
        <Typography.Text type='secondary' className='block px-16px py-16px text-center text-12px'>
          {t('settings.agentManagement.localAgentsEmpty')}
        </Typography.Text>
      )}

      {/* Not-detected section — shown when there are known backends we couldn't
          find on PATH. Gives the user an explicit escape hatch to configure
          a path manually so they aren't locked out by detection failures
          (the most common being Claude Code at ~/.claude/local/claude on
          fresh installs). */}
      {undetectedKnown.length > 0 && (
        <>
          <div className='px-16px mt-16px'>
            <Typography.Text className='text-12px font-medium text-t-secondary mb-4px block'>
              {t('settings.agentManagement.notDetectedTitle', { defaultValue: 'Not detected' })}
            </Typography.Text>
            <Typography.Text type='secondary' className='block text-12px leading-18px'>
              {t('settings.agentManagement.notDetectedHint', {
                defaultValue:
                  'These CLIs were not found on your PATH. If one is installed in a custom location, click "Set path" to point the app at it.',
              })}
            </Typography.Text>
          </div>
          <div className='grid grid-cols-2 gap-10px px-16px md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
            {undetectedKnown.map((info) => {
              const logo = resolveAgentLogo({ backend: info.backend });
              return (
                <div
                  key={info.backend}
                  className='flex min-h-[154px] flex-col rounded-12px border border-dashed border-[var(--color-border-2)] bg-[var(--color-bg-1)] p-12px transition-colors hover:border-[var(--color-border-3)]'
                >
                  <div className='mb-10px flex justify-center opacity-70'>
                    <Avatar size={40} shape='square' style={{ flexShrink: 0, backgroundColor: 'transparent' }}>
                      {logo ? <img src={logo} alt={info.name} className='h-full w-full object-contain' /> : '🤖'}
                    </Avatar>
                  </div>
                  <div className='mb-10px flex-1 text-center'>
                    <Typography.Text className='block text-13px font-medium leading-18px line-clamp-2'>
                      {info.name}
                    </Typography.Text>
                    <Typography.Text className='mt-4px block text-11px text-t-tertiary'>
                      {t('settings.agentManagement.notDetected', { defaultValue: 'Not detected' })}
                    </Typography.Text>
                  </div>
                  <Button
                    size='small'
                    type='secondary'
                    icon={<Setting theme='outline' size='14' />}
                    onClick={() => handleOpenPathModal(info.backend)}
                    className='!w-full !justify-center !rounded-10px !text-12px'
                  >
                    {t('settings.agentManagement.setPath', { defaultValue: 'Set path' })}
                  </Button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Custom Agents section */}
      {(editorVisible || (customAgents && customAgents.length > 0)) && (
        <div className='px-16px mt-16px'>
          <Typography.Text className='text-12px font-medium text-t-secondary mb-4px block'>
            {t('settings.agentManagement.customAgents', { defaultValue: 'Custom Agents' })}
          </Typography.Text>
        </div>
      )}

      <GodsEyeModal
        visible={editorVisible}
        onCancel={() => {
          setEditorVisible(false);
          setEditingAgent(null);
        }}
        header={{
          title: editingAgent
            ? t('settings.agentManagement.editCustomAgent')
            : t('settings.agentManagement.detectCustomAgent'),
          showClose: true,
        }}
        footer={null}
        style={{ maxWidth: '92vw', borderRadius: 16 }}
        contentStyle={{
          background: 'var(--dialog-fill-0)',
          borderRadius: 16,
          padding: '20px 24px 16px',
          overflow: 'auto',
        }}
      >
        <InlineAgentEditor
          agent={editingAgent}
          onSave={(agent) => void handleSaveCustomAgent(agent)}
          onCancel={() => {
            setEditorVisible(false);
            setEditingAgent(null);
          }}
        />
      </GodsEyeModal>

      <div className='flex flex-col gap-4px px-0'>
        {customAgents?.map((agent) => (
          <AgentCard
            key={agent.id}
            type='custom'
            agent={agent}
            onEdit={() => {
              setEditingAgent(agent);
              setEditorVisible(true);
            }}
            onDelete={() => void handleDeleteCustomAgent(agent.id)}
            onToggle={(enabled) => void handleToggleCustomAgent(agent.id, enabled)}
          />
        ))}
      </div>

      {hubModalVisible && <AgentHubModal visible={hubModalVisible} onCancel={() => setHubModalVisible(false)} />}

      {pathModalBackend && (
        <BuiltinAgentPathModal
          visible={!!pathModalBackend}
          backend={pathModalBackend.backend}
          name={pathModalBackend.name}
          defaultCommand={pathModalBackend.defaultCommand}
          acpArgs={pathModalBackend.acpArgs}
          currentPath={pathModalBackend.overridePath}
          detected={pathModalBackend.detected}
          onCancel={() => setPathModalBackend(null)}
          onSaved={() => void handlePathSaved()}
        />
      )}
    </div>
  );
};

export default LocalAgents;
