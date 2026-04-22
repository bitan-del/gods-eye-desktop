/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

import { acpConversation } from '@/common/adapter/ipcBridge';
import GodsEyeModal from '@/renderer/components/base/GodsEyeModal';
import { resolveAgentLogo } from '@/renderer/utils/model/agentLogo';
import { Alert, Avatar, Button, Input, Message, Typography } from '@arco-design/web-react';
import { CheckOne, CloseOne } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AcpBackend } from '@/common/types/acpTypes';

type TestStatus = 'idle' | 'testing' | 'success' | 'fail_cli' | 'fail_acp';

/**
 * Modal that lets the user manually configure (or clear) the `cliPath` for
 * a builtin ACP backend such as Claude Code, Codex, Qwen, etc.
 *
 * Why this exists:
 *   On a fresh install the app auto-detects CLI tools via `which`. For tools
 *   that live outside the default PATH — most commonly `~/.claude/local/claude`
 *   from Anthropic's official installer — that probe fails and the agent
 *   appears as "Not detected". Before this modal, users had no way out: the
 *   settings gear was greyed out and there was no path field anywhere in the
 *   UI. Now any builtin backend can have its path pointed somewhere explicit,
 *   persisted to `acp.config.<backend>.cliPath`, and re-validated via the
 *   same `testCustomAgent` ACP handshake the custom-agent editor uses.
 */

export interface BuiltinAgentPathModalProps {
  visible: boolean;
  /** The backend id (e.g. 'claude', 'codex', 'qwen'). */
  backend: AcpBackend;
  /** Display name shown in the modal title. */
  name: string;
  /** CLI command name the app probes by default (e.g. 'claude'). */
  defaultCommand: string;
  /** ACP arguments to pass when launching this backend. */
  acpArgs?: string[];
  /** Currently saved override path, if any. */
  currentPath?: string;
  /** Whether the CLI is currently detected (via override or PATH). */
  detected?: boolean;
  onCancel: () => void;
  /** Called with the saved path (or empty string if cleared) after a successful save. */
  onSaved: (cliPath: string) => void;
}

const BuiltinAgentPathModal: React.FC<BuiltinAgentPathModalProps> = ({
  visible,
  backend,
  name,
  defaultCommand,
  acpArgs,
  currentPath,
  detected,
  onCancel,
  onSaved,
}) => {
  const { t } = useTranslation();
  const [path, setPath] = useState(currentPath || '');
  const [saving, setSaving] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const logo = resolveAgentLogo({ backend });

  useEffect(() => {
    if (visible) {
      setPath(currentPath || '');
      setTestStatus('idle');
    }
  }, [visible, currentPath]);

  const handleTest = useCallback(async () => {
    const cmd = path.trim();
    if (!cmd) return;
    setTestStatus('testing');
    try {
      const result = await acpConversation.testCustomAgent.invoke({
        command: cmd,
        acpArgs: acpArgs && acpArgs.length > 0 ? acpArgs : undefined,
      });
      if (result.success) {
        setTestStatus('success');
      } else if (result.data?.step === 'cli_check') {
        setTestStatus('fail_cli');
      } else {
        setTestStatus('fail_acp');
      }
    } catch {
      setTestStatus('fail_cli');
    }
  }, [path, acpArgs]);

  const handleSave = useCallback(async () => {
    const trimmed = path.trim();
    setSaving(true);
    try {
      const result = await acpConversation.setBuiltinCliPath.invoke({
        backend,
        cliPath: trimmed || undefined,
      });
      if (result.success) {
        Message.success(
          trimmed
            ? t('settings.agentManagement.cliPathSaved', { defaultValue: 'CLI path saved' })
            : t('settings.agentManagement.cliPathCleared', { defaultValue: 'CLI path cleared' })
        );
        onSaved(trimmed);
      } else {
        Message.error(result.msg || 'Failed to save CLI path');
      }
    } catch (error) {
      Message.error(error instanceof Error ? error.message : 'Failed to save CLI path');
    } finally {
      setSaving(false);
    }
  }, [backend, path, onSaved, t]);

  const handleClear = useCallback(async () => {
    setPath('');
    setSaving(true);
    try {
      const result = await acpConversation.setBuiltinCliPath.invoke({ backend, cliPath: undefined });
      if (result.success) {
        Message.success(t('settings.agentManagement.cliPathCleared', { defaultValue: 'CLI path cleared' }));
        onSaved('');
      } else {
        Message.error(result.msg || 'Failed to clear CLI path');
      }
    } catch (error) {
      Message.error(error instanceof Error ? error.message : 'Failed to clear CLI path');
    } finally {
      setSaving(false);
    }
  }, [backend, onSaved, t]);

  const testIcon =
    testStatus === 'success' ? (
      <CheckOne theme='filled' size='14' style={{ color: 'var(--color-success-6)' }} />
    ) : testStatus === 'fail_cli' || testStatus === 'fail_acp' ? (
      <CloseOne theme='filled' size='14' style={{ color: 'var(--color-danger-6)' }} />
    ) : undefined;

  return (
    <GodsEyeModal
      visible={visible}
      onCancel={onCancel}
      header={{
        title: t('settings.agentManagement.setCliPathFor', {
          name,
          defaultValue: `Set CLI path for ${name}`,
        }),
        showClose: true,
      }}
      footer={null}
      style={{ maxWidth: '92vw', width: 520, borderRadius: 16 }}
      contentStyle={{
        background: 'var(--dialog-fill-0)',
        borderRadius: 16,
        padding: '20px 24px 16px',
        overflow: 'auto',
      }}
    >
      <div className='flex flex-col gap-16px pt-4px pb-4px'>
        <div className='flex items-center gap-12px'>
          <Avatar size={40} shape='square' style={{ flexShrink: 0, backgroundColor: 'transparent' }}>
            {logo ? <img src={logo} alt={name} className='h-full w-full object-contain' /> : '🤖'}
          </Avatar>
          <div className='min-w-0 flex-1'>
            <Typography.Text className='block text-15px font-medium leading-tight text-t-primary'>
              {name}
            </Typography.Text>
            <Typography.Text className='mt-2px block text-12px leading-18px text-t-secondary'>
              {detected
                ? t('settings.agentManagement.cliDetectedHint', {
                    defaultValue: 'Currently detected — you can override the path below.',
                  })
                : t('settings.agentManagement.cliNotDetectedHint', {
                    defaultValue: 'Not detected on PATH. Point to the binary below to use it.',
                  })}
            </Typography.Text>
          </div>
        </div>

        <Alert
          type='info'
          showIcon
          content={t('settings.agentManagement.cliPathInfo', {
            cmd: defaultCommand,
            defaultValue: `By default the app runs \`${defaultCommand}\`. Provide an absolute path to override this — useful when \`${defaultCommand}\` is installed somewhere outside your shell PATH (e.g. ~/.claude/local/claude).`,
          })}
          style={{ borderRadius: 10 }}
        />

        <div>
          <Typography.Text className='mb-6px block text-13px font-medium text-t-primary'>
            {t('settings.agentManagement.cliPathLabel', { defaultValue: 'Absolute CLI path' })}
          </Typography.Text>
          <Input
            size='large'
            value={path}
            onChange={setPath}
            placeholder={t('settings.agentManagement.cliPathPlaceholder', {
              defaultValue: '/Users/you/.claude/local/claude',
            })}
            allowClear
          />
          <Typography.Text type='secondary' className='mt-4px block text-12px leading-18px text-t-tertiary'>
            {t('settings.agentManagement.cliPathHelp', {
              defaultValue: 'Leave empty to use PATH-based detection.',
            })}
          </Typography.Text>
        </div>

        {testStatus === 'success' && (
          <Alert
            type='success'
            showIcon
            content={t('settings.testConnectionSuccess', { defaultValue: 'Connection test succeeded' })}
            style={{ borderRadius: 10 }}
          />
        )}
        {testStatus === 'fail_cli' && (
          <Alert
            type='error'
            showIcon
            content={t('settings.testConnectionFailCli', {
              defaultValue: 'Could not run the CLI at this path. Check that the binary exists and is executable.',
            })}
            style={{ borderRadius: 10 }}
          />
        )}
        {testStatus === 'fail_acp' && (
          <Alert
            type='warning'
            showIcon
            content={t('settings.testConnectionFailAcp', {
              defaultValue: 'CLI launched but the ACP handshake failed. The binary may be the wrong version.',
            })}
            style={{ borderRadius: 10 }}
          />
        )}

        <div className='flex items-center justify-between gap-8px pt-4px'>
          <div>
            {currentPath && (
              <Button size='small' type='text' status='danger' onClick={handleClear} disabled={saving}>
                {t('settings.agentManagement.clearOverride', { defaultValue: 'Clear override' })}
              </Button>
            )}
          </div>
          <div className='flex items-center gap-8px'>
            <Button
              size='small'
              icon={testIcon}
              onClick={handleTest}
              loading={testStatus === 'testing'}
              disabled={!path.trim() || testStatus === 'testing' || saving}
            >
              {t('settings.agentManagement.testConnection', { defaultValue: 'Test connection' })}
            </Button>
            <Button size='small' onClick={onCancel} disabled={saving}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button size='small' type='primary' onClick={handleSave} loading={saving} disabled={saving}>
              {t('common.save', { defaultValue: 'Save' })}
            </Button>
          </div>
        </div>
      </div>
    </GodsEyeModal>
  );
};

export default BuiltinAgentPathModal;
