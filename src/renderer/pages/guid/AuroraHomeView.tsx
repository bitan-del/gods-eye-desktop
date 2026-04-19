/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Aurora Pro Home — cinematic landing surface that matches the Aurora Pro
 * reference design exactly (greeting eyebrow, Instrument Serif display,
 * morphing agent pill, composer-pro card, magnetic skill chips, action
 * rail, ⌘K hint). All send / input / agent / model logic is routed through
 * the existing Guid hooks so functionality is preserved 1:1.
 */

import { Message } from '@arco-design/web-react';
import { Plus, Send, Comment as ChatIcon, Star, Earth, Down, Robot, Up } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

import { resolveLocaleKey } from '@/common/utils';
import { useAssistantBackends } from '@/renderer/hooks/assistant';
import { useConversationTabs } from '@/renderer/pages/conversation/hooks/ConversationTabsContext';
import { resolveAgentLogo } from '@/renderer/utils/model/agentLogo';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';

import { useGuidAgentSelection } from './hooks/useGuidAgentSelection';
import { useGuidInput } from './hooks/useGuidInput';
import { useGuidMention } from './hooks/useGuidMention';
import { useGuidModelSelection } from './hooks/useGuidModelSelection';
import { useGuidSend } from './hooks/useGuidSend';

import type { AcpBackend } from './types';

const AuroraHomeView: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { closeAllTabs, openTab } = useConversationTabs();
  const { availableBackends, extensionAcpAdapters: _extensionAcpAdapters } = useAssistantBackends();
  const localeKey = resolveLocaleKey(i18n.language);

  // Real hooks (no logic changes)
  const modelSelection = useGuidModelSelection();
  const resetAssistantRequested = (location.state as { resetAssistant?: boolean } | null)?.resetAssistant === true;
  const agentSelection = useGuidAgentSelection({
    modelList: modelSelection.modelList,
    isGoogleAuth: modelSelection.isGoogleAuth,
    localeKey,
    resetAssistant: resetAssistantRequested,
    locationKey: location.key,
  });
  const guidInput = useGuidInput({ locationState: location.state as { workspace?: string } | null });
  const mention = useGuidMention({
    availableAgents: agentSelection.availableAgents,
    customAgentAvatarMap: agentSelection.customAgentAvatarMap,
    selectedAgentKey: agentSelection.selectedAgentKey,
    setSelectedAgentKey: agentSelection.setSelectedAgentKey,
    setInput: guidInput.setInput,
    selectedAgentInfo: agentSelection.selectedAgentInfo,
  });
  const send = useGuidSend({
    input: guidInput.input,
    setInput: guidInput.setInput,
    files: guidInput.files,
    setFiles: guidInput.setFiles,
    dir: guidInput.dir,
    setDir: guidInput.setDir,
    setLoading: guidInput.setLoading,
    loading: guidInput.loading,
    selectedAgent: agentSelection.selectedAgent,
    selectedAgentKey: agentSelection.selectedAgentKey,
    selectedAgentInfo: agentSelection.selectedAgentInfo,
    isPresetAgent: agentSelection.isPresetAgent,
    selectedMode: agentSelection.selectedMode,
    selectedAcpModel: agentSelection.selectedAcpModel,
    pendingConfigOptions: agentSelection.pendingConfigOptions,
    cachedConfigOptions: agentSelection.cachedConfigOptions,
    currentModel: modelSelection.currentModel,
    findAgentByKey: agentSelection.findAgentByKey,
    getEffectiveAgentType: agentSelection.getEffectiveAgentType,
    resolvePresetRulesAndSkills: agentSelection.resolvePresetRulesAndSkills,
    resolveEnabledSkills: agentSelection.resolveEnabledSkills,
    isMainAgentAvailable: agentSelection.isMainAgentAvailable,
    getAvailableFallbackAgent: agentSelection.getAvailableFallbackAgent,
    currentEffectiveAgentInfo: agentSelection.currentEffectiveAgentInfo,
    isGoogleAuth: modelSelection.isGoogleAuth,
    setMentionOpen: mention.setMentionOpen,
    setMentionQuery: mention.setMentionQuery,
    setMentionSelectorOpen: mention.setMentionSelectorOpen,
    setMentionActiveIndex: mention.setMentionActiveIndex,
    navigate,
    closeAllTabs,
    openTab,
    t,
  });

  // Agent pill morph indicator
  const pillRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  // Take up to 4 real agents (prefer backends available; include preset custom agents too)
  const displayAgents = useMemo(() => {
    const agents = agentSelection.availableAgents || [];
    return agents.slice(0, 4).map((agent) => ({
      key: agentSelection.getAgentKey(agent),
      label: agent.name,
      backend: agent.backend as AcpBackend,
      customAgentId: agent.customAgentId,
      isExtension: agent.isExtension,
      avatar: agent.avatar,
    }));
  }, [agentSelection.availableAgents, agentSelection.getAgentKey]);

  const activeKey = agentSelection.selectedAgentKey;

  useEffect(() => {
    const el = btnRefs.current[activeKey];
    const parent = pillRef.current;
    if (el && parent) {
      const rect = el.getBoundingClientRect();
      const pRect = parent.getBoundingClientRect();
      setIndicator({ left: rect.left - pRect.left, width: rect.width });
    }
  }, [activeKey, displayAgents]);

  // Greeting
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return 'Late night';
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);
  const dateStr = useMemo(() => {
    return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }, []);

  const activeLabel = displayAgents.find((a) => a.key === activeKey)?.label || 'Agent';

  // Skill chips from customAgents / built-in assistants
  const skillChips = useMemo(() => {
    const customs = (agentSelection.customAgents || []).slice(0, 12);
    return customs.map((c) => ({
      id: c.id,
      name: c.nameI18n?.[localeKey] || c.name || c.id,
      icon: c.avatar?.trim() || '✦',
    }));
  }, [agentSelection.customAgents, localeKey]);

  // Composer keydown: Enter → send; Shift+Enter → newline
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!guidInput.input.trim()) return;
        send.handleSend().catch((err) => {
          console.error('Failed to send:', err);
          Message.error(t('common.failed', { defaultValue: 'Failed' }));
        });
      }
    },
    [guidInput.input, send, t]
  );

  const magnetic = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left - r.width / 2;
    const y = e.clientY - r.top - r.height / 2;
    el.style.transform = `translate(${x * 0.15}px, ${y * 0.15 - 2}px) scale(1.03)`;
  }, []);
  const demagnetize = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.transform = '';
  }, []);

  const chipBackendClass = (backend: AcpBackend) => backend;

  const selectedModelLabel = useMemo(() => {
    const acp = agentSelection.selectedAcpModel;
    const acpLabel = typeof acp === 'string' ? acp : undefined;
    return modelSelection.currentModel?.useModel || modelSelection.currentModel?.platform || acpLabel || 'Gods Eye';
  }, [modelSelection.currentModel, agentSelection.selectedAcpModel]);

  const handleSkillClick = useCallback(
    (skillId: string) => {
      agentSelection.setSelectedAgentKey(skillId);
    },
    [agentSelection]
  );

  const disabled = send.isButtonDisabled || !guidInput.input.trim();

  return (
    <div className='home-pro view-enter-pro' {...guidInput.dragHandlers}>
      <div className='aurora-stage' aria-hidden='true'>
        <div className='aurora-blob b1' />
        <div className='aurora-blob b2' />
        <div className='aurora-blob b3' />
        <div className='aurora-blob b4' />
      </div>

      <div className='stage'>
        <div className='greeting-eyebrow'>
          <span className='pulse' />
          <span>
            {greeting} · {dateStr}
          </span>
        </div>

        <div className='display-pro'>
          {t('conversation.welcome.title').replace(/\?$/, '').split(' ').slice(0, -2).join(' ')}{' '}
          <span className='accent'>
            {t('conversation.welcome.title').replace(/\?$/, '').split(' ').slice(-2).join(' ')}?
          </span>
        </div>

        {/* Agent pill with morphing indicator */}
        {displayAgents.length > 0 && (
          <div className='agent-pill' ref={pillRef}>
            <div className='indicator' style={{ left: indicator.left, width: indicator.width }} />
            {displayAgents.map((a, i) => {
              const isActive = a.key === activeKey;
              const prevActive = i > 0 && displayAgents[i - 1]?.key === activeKey;
              const extensionAvatar = resolveExtensionAssetUrl(a.isExtension ? a.avatar : undefined);
              const logoSrc =
                extensionAvatar ||
                resolveAgentLogo({
                  backend: a.backend,
                  customAgentId: a.customAgentId,
                  isExtension: a.isExtension,
                });
              return (
                <React.Fragment key={a.key}>
                  {i > 0 && <div className='divider' style={{ opacity: isActive || prevActive ? 0 : 1 }} />}
                  <button
                    ref={(el) => {
                      btnRefs.current[a.key] = el;
                    }}
                    className={'agent' + (isActive ? ' active' : '')}
                    onClick={() => agentSelection.setSelectedAgentKey(a.key)}
                    data-agent-backend={chipBackendClass(a.backend)}
                  >
                    {logoSrc ? (
                      <img src={logoSrc} alt='' width={16} height={16} style={{ objectFit: 'contain' }} />
                    ) : (
                      <Robot theme='outline' size={16} fill='currentColor' />
                    )}
                    {isActive && <span>{a.label}</span>}
                  </button>
                </React.Fragment>
              );
            })}
            <button
              className='agent'
              onClick={() => navigate('/settings/agent?tab=local')}
              style={{ padding: '7px 10px', color: 'var(--ink-3)' }}
              title='Add agent'
            >
              <Plus theme='outline' size={14} fill='currentColor' />
            </button>
          </div>
        )}

        {/* Composer */}
        <div className='composer-pro composer-focus-target'>
          <textarea
            value={guidInput.input}
            onChange={(e) => guidInput.setInput(e.target.value)}
            onFocus={guidInput.handleTextareaFocus}
            onBlur={guidInput.handleTextareaBlur}
            onPaste={guidInput.onPaste}
            onKeyDown={onKeyDown}
            placeholder={`${activeLabel}, ${t('conversation.welcome.placeholder')}`}
          />
          <div className='toolbar'>
            <div className='flex items-center gap-4px'>
              <button className='meta-chip' title={t('conversation.welcome.uploadFile', { defaultValue: 'Upload' })}>
                <Plus theme='outline' size={13} fill='currentColor' />
              </button>
              <div className='vert-sep' />
              <button className='meta-chip'>
                <Robot theme='outline' size={13} fill='currentColor' />
                <span>{selectedModelLabel} · Gods Eye</span>
                <Down theme='outline' size={12} fill='currentColor' />
              </button>
              <div className='vert-sep' />
              <button className='meta-chip'>
                <span>Default</span>
                <Down theme='outline' size={12} fill='currentColor' />
              </button>
              <div className='vert-sep' />
              <button className='meta-chip'>
                <span>Medium</span>
                <Down theme='outline' size={12} fill='currentColor' />
              </button>
            </div>
            <button
              className={'send ' + (disabled ? 'dim' : '')}
              disabled={disabled}
              onClick={() => {
                send.handleSend().catch((err) => {
                  console.error('Failed to send:', err);
                });
              }}
              aria-label={t('conversation.welcome.send', { defaultValue: 'Send' })}
            >
              {guidInput.loading ? (
                <Up theme='outline' size={14} fill='currentColor' />
              ) : (
                <Send theme='outline' size={14} fill='currentColor' />
              )}
            </button>
          </div>
        </div>

        {/* Skill chips (magnetic) */}
        {skillChips.length > 0 && (
          <div className='skill-grid'>
            {skillChips.map((s) => (
              <button
                key={s.id}
                className='skill-chip'
                onMouseMove={magnetic}
                onMouseLeave={demagnetize}
                onClick={() => handleSkillClick(s.id)}
              >
                <span className='icon'>{s.icon}</span>
                <span>{s.name}</span>
              </button>
            ))}
            <button className='skill-chip' style={{ padding: '7px 10px' }} onClick={() => navigate('/settings/agent')}>
              <Plus theme='outline' size={14} fill='currentColor' />
            </button>
          </div>
        )}

        {/* Action rail */}
        <div className='action-rail'>
          <button className='ab' onClick={() => navigate('/chat')} title='Open Chat'>
            <ChatIcon theme='outline' size={16} fill='currentColor' />
          </button>
          <button className='ab' title='Favorite'>
            <Star theme='outline' size={16} fill='currentColor' />
          </button>
          <button className='ab green' title='Browse web'>
            <Earth theme='outline' size={16} fill='currentColor' />
          </button>
        </div>

        <div
          style={{
            marginTop: 40,
            fontSize: 11.5,
            letterSpacing: '.04em',
            color: 'var(--ink-3)',
            textAlign: 'center',
          }}
        >
          <kbd className='k-pill'>⌘</kbd> <kbd className='k-pill'>K</kbd> &nbsp;to search everything ·{' '}
          <kbd className='k-pill'>⌘</kbd> <kbd className='k-pill'>,</kbd> &nbsp;for tweaks
        </div>

        {/* File dragging visual */}
        {guidInput.isFileDragging && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              background: 'color-mix(in oklch, var(--paper) 60%, transparent)',
              backdropFilter: 'blur(8px)',
              pointerEvents: 'none',
              zIndex: 10,
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontSize: 32,
              letterSpacing: '-0.02em',
              color: 'var(--ink)',
            }}
          >
            Drop to upload
          </div>
        )}
      </div>
    </div>
  );
};

export default AuroraHomeView;
