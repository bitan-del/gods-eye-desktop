import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Input, Select, Spin, Tag } from '@arco-design/web-react';
import { Search } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { ASSISTANT_PRESETS } from '@/common/config/presets/assistantPresets';
import GodsEyeModal from '@renderer/components/base/GodsEyeModal';
import { useConversationAgents } from '@renderer/pages/conversation/hooks/useConversationAgents';
import { agentKey, agentFromKey, filterTeamSupportedAgents, AgentOptionLabel } from './agentSelectUtils';

type SkillInfo = {
  name: string;
  description: string;
  location: string;
  isCustom: boolean;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onConfirm: (data: { agentName: string; agentKey: string; systemPrompt?: string; skills?: string[] }) => void;
};

const AddAgentModal: React.FC<Props> = ({ visible, onClose, onConfirm }) => {
  const { t } = useTranslation();
  const { cliAgents, presetAssistants } = useConversationAgents();
  const [agentName, setAgentName] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [customSkillInput, setCustomSkillInput] = useState('');
  const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [skillSearch, setSkillSearch] = useState('');

  const filteredCliAgents = filterTeamSupportedAgents([...cliAgents]);
  const filteredAssistants = filterTeamSupportedAgents([...presetAssistants]);
  const allAgents = [...filteredCliAgents, ...filteredAssistants];

  const handleAgentTypeChange = (key: string | undefined) => {
    setSelectedKey(key);
    if (!key) return;
    // Auto-populate skills from preset assistant defaults
    const agent = agentFromKey(key, allAgents);
    if (agent?.customAgentId?.startsWith('builtin-')) {
      const presetId = agent.customAgentId.replace('builtin-', '');
      const preset = ASSISTANT_PRESETS.find((p) => p.id === presetId);
      if (preset?.defaultEnabledSkills && preset.defaultEnabledSkills.length > 0) {
        setSelectedSkills(preset.defaultEnabledSkills);
      }
      // Auto-fill name from assistant name if empty
      if (!agentName.trim()) {
        setAgentName(agent.name);
      }
    }
  };

  const fetchSkills = useCallback(async () => {
    setLoadingSkills(true);
    try {
      const skills = await ipcBridge.fs.listAvailableSkills.invoke();
      setAvailableSkills(skills);
    } catch (error) {
      console.error('Failed to fetch skills:', error);
    } finally {
      setLoadingSkills(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      void fetchSkills();
    }
  }, [visible, fetchSkills]);

  const filteredSkills = useMemo(() => {
    if (!skillSearch.trim()) return availableSkills;
    const q = skillSearch.toLowerCase();
    return availableSkills.filter(
      (s) => s.name.toLowerCase().includes(q) || (s.description && s.description.toLowerCase().includes(q))
    );
  }, [availableSkills, skillSearch]);

  const toggleSkill = (name: string) => {
    setSelectedSkills((prev) => (prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]));
  };

  const handleAddCustomSkill = () => {
    const trimmed = customSkillInput.trim();
    if (trimmed && !selectedSkills.includes(trimmed)) {
      setSelectedSkills([...selectedSkills, trimmed]);
    }
    setCustomSkillInput('');
  };

  const handleCustomSkillKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddCustomSkill();
    }
  };

  const handleClose = () => {
    setAgentName('');
    setSelectedKey(undefined);
    setSystemPrompt('');
    setSelectedSkills([]);
    setCustomSkillInput('');
    setSkillSearch('');
    onClose();
  };

  const handleConfirm = () => {
    if (!agentName.trim() || !selectedKey) return;
    onConfirm({
      agentName: agentName.trim(),
      agentKey: selectedKey,
      systemPrompt: systemPrompt.trim() || undefined,
      skills: selectedSkills.length > 0 ? selectedSkills : undefined,
    });
    handleClose();
  };

  const canConfirm = agentName.trim().length > 0 && selectedKey !== undefined;

  // Skills that were manually added (not in the available list)
  const customSkills = selectedSkills.filter((s) => !availableSkills.some((a) => a.name === s));

  return (
    <GodsEyeModal
      visible={visible}
      onCancel={handleClose}
      header={t('team.addAgent.title', { defaultValue: 'Add Agent' })}
      footer={
        <div className='flex justify-end pt-4px'>
          <Button
            type='primary'
            disabled={!canConfirm}
            onClick={handleConfirm}
            className='px-20px min-w-80px'
            style={{ borderRadius: 8 }}
          >
            {t('team.addAgent.confirm', { defaultValue: 'Add' })}
          </Button>
        </div>
      }
      size='medium'
    >
      <div className='flex flex-col gap-20px p-20px max-h-[70vh] overflow-y-auto'>
        <div className='flex flex-col gap-6px'>
          <label className='text-sm text-[var(--color-text-2)] font-medium'>
            {t('team.addAgent.name', { defaultValue: 'Agent Name' })}
          </label>
          <Input
            placeholder={t('team.addAgent.namePlaceholder', { defaultValue: 'Enter agent name' })}
            value={agentName}
            onChange={setAgentName}
          />
        </div>

        <div className='flex flex-col gap-6px'>
          <label className='text-sm text-[var(--color-text-2)] font-medium'>
            {t('team.addAgent.type', { defaultValue: 'Agent Type' })}
          </label>
          <Select
            placeholder={
              allAgents.length === 0
                ? t('team.create.noSupportedAgents', { defaultValue: 'No supported agents installed' })
                : t('team.addAgent.typePlaceholder', { defaultValue: 'Select agent type' })
            }
            value={selectedKey}
            onChange={handleAgentTypeChange}
            showSearch
            allowClear
            disabled={allAgents.length === 0}
            getPopupContainer={() => document.body}
            renderFormat={(option) => {
              const agent = option?.value ? allAgents.find((a) => agentKey(a) === option.value) : undefined;
              return agent ? <AgentOptionLabel agent={agent} /> : <span>{option?.children}</span>;
            }}
          >
            {filteredCliAgents.length > 0 && (
              <Select.OptGroup label={t('conversation.dropdown.cliAgents', { defaultValue: 'CLI Agents' })}>
                {filteredCliAgents.map((agent) => (
                  <Select.Option key={agentKey(agent)} value={agentKey(agent)}>
                    <AgentOptionLabel agent={agent} />
                  </Select.Option>
                ))}
              </Select.OptGroup>
            )}
            {filteredAssistants.length > 0 && (
              <Select.OptGroup label={t('team.addAgent.assistants', { defaultValue: 'Assistants' })}>
                {filteredAssistants.map((agent) => (
                  <Select.Option key={agentKey(agent)} value={agentKey(agent)}>
                    <AgentOptionLabel agent={agent} />
                  </Select.Option>
                ))}
              </Select.OptGroup>
            )}
          </Select>
          <span className='text-12px text-[var(--color-text-4)]'>
            {t('team.create.supportedAgentsHint', {
              defaultValue: 'Add CLI agents or pre-configured assistants with specialised skills.',
            })}
          </span>
        </div>

        <div className='flex flex-col gap-6px'>
          <label className='text-sm text-[var(--color-text-2)] font-medium'>
            {t('team.addAgent.systemPrompt', { defaultValue: 'System Prompt' })}
            <span className='text-12px text-[var(--color-text-4)] font-normal ml-4px'>
              {t('team.addAgent.optional', { defaultValue: '(optional)' })}
            </span>
          </label>
          <Input.TextArea
            placeholder={t('team.addAgent.systemPromptPlaceholder', {
              defaultValue:
                'Give this agent specific instructions, e.g. "You are a senior copywriter who specialises in short-form social media content..."',
            })}
            value={systemPrompt}
            onChange={setSystemPrompt}
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
        </div>

        <div className='flex flex-col gap-6px'>
          <label className='text-sm text-[var(--color-text-2)] font-medium'>
            {t('team.addAgent.skills', { defaultValue: 'Skills' })}
            <span className='text-12px text-[var(--color-text-4)] font-normal ml-4px'>
              {t('team.addAgent.optional', { defaultValue: '(optional)' })}
            </span>
          </label>

          {/* Selected skills tags */}
          {selectedSkills.length > 0 && (
            <div className='flex flex-wrap gap-6px mb-4px'>
              {selectedSkills.map((skill) => (
                <Tag
                  key={skill}
                  closable
                  onClose={() => toggleSkill(skill)}
                  color='arcoblue'
                  className='text-13px'
                >
                  {skill}
                </Tag>
              ))}
            </div>
          )}

          {/* Available skills from system */}
          <div className='border border-[var(--color-border)] rd-8px overflow-hidden'>
            <div className='flex items-center gap-8px px-12px py-8px bg-[var(--color-fill-1)] border-b border-[var(--color-border)]'>
              <Search size={14} className='text-[var(--color-text-3)] shrink-0' />
              <input
                type='text'
                className='flex-1 bg-transparent border-none outline-none text-13px text-[var(--color-text-1)] placeholder:text-[var(--color-text-4)]'
                placeholder={t('team.addAgent.searchSkills', { defaultValue: 'Search installed skills...' })}
                value={skillSearch}
                onChange={(e) => setSkillSearch(e.target.value)}
              />
              {loadingSkills && <Spin size={14} />}
            </div>
            <div className='max-h-160px overflow-y-auto'>
              {filteredSkills.length > 0 ? (
                filteredSkills.map((skill) => (
                  <label
                    key={skill.name}
                    className='flex items-start gap-10px px-12px py-8px hover:bg-[var(--color-fill-1)] cursor-pointer transition-colors'
                  >
                    <Checkbox
                      checked={selectedSkills.includes(skill.name)}
                      onChange={() => toggleSkill(skill.name)}
                      className='mt-2px shrink-0'
                    />
                    <div className='flex flex-col min-w-0'>
                      <span className='text-13px text-[var(--color-text-1)] font-medium'>{skill.name}</span>
                      {skill.description && (
                        <span className='text-12px text-[var(--color-text-3)] truncate'>{skill.description}</span>
                      )}
                    </div>
                  </label>
                ))
              ) : (
                <div className='px-12px py-16px text-center text-12px text-[var(--color-text-4)]'>
                  {loadingSkills
                    ? t('common.loading', { defaultValue: 'Loading...' })
                    : t('team.addAgent.noSkillsFound', { defaultValue: 'No skills found' })}
                </div>
              )}
            </div>
          </div>

          {/* Custom skill input */}
          <div className='flex gap-8px mt-4px'>
            <Input
              placeholder={t('team.addAgent.customSkillPlaceholder', {
                defaultValue: 'Add a custom skill tag...',
              })}
              value={customSkillInput}
              onChange={setCustomSkillInput}
              onKeyDown={handleCustomSkillKeyDown}
              onBlur={handleAddCustomSkill}
              className='flex-1'
              size='small'
            />
            <Button size='small' onClick={handleAddCustomSkill} disabled={!customSkillInput.trim()}>
              {t('team.addAgent.addSkill', { defaultValue: 'Add' })}
            </Button>
          </div>
          {customSkills.length > 0 && (
            <span className='text-12px text-[var(--color-text-4)]'>
              {t('team.addAgent.customSkillsNote', {
                defaultValue: 'Custom tags are used as hints for task assignment.',
              })}
            </span>
          )}
          <span className='text-12px text-[var(--color-text-4)]'>
            {t('team.addAgent.skillsHint', {
              defaultValue: 'Select skills to specialise this agent. The leader uses these to assign the right tasks.',
            })}
          </span>
        </div>
      </div>
    </GodsEyeModal>
  );
};

export default AddAgentModal;
