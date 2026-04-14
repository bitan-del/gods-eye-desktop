import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Message, Tag } from '@arco-design/web-react';
import { Search, Download, CheckOne, Refresh } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';

type InstalledSkill = {
  name: string;
  description: string;
  location: string;
  isCustom: boolean;
};

type RegistrySkill = {
  name: string;
  description: string;
  category: string;
  /** When set, download SKILL.md from this URL; when empty, import from external sources */
  url: string;
  /** Source label for UI grouping */
  source?: string;
};

/**
 * Curated catalog of bundled / well-known skills.
 * Empty `url` means the skill is imported from detected external CLI sources.
 */
const BUNDLED_CATALOG: RegistrySkill[] = [
  // ── Document ──
  { name: 'pdf', description: 'Extract text, tables, create, merge, split PDFs and fill forms.', category: 'Document', url: '' },
  { name: 'officecli-xlsx', description: 'Create and edit Excel spreadsheets with formulas, charts, and formatting.', category: 'Document', url: '' },
  { name: 'officecli-docx', description: 'Create, read, edit Word documents — reports, letters, memos, proposals.', category: 'Document', url: '' },
  { name: 'officecli-pptx', description: 'Create and edit PowerPoint slide decks, pitch decks, and presentations.', category: 'Document', url: '' },
  { name: 'morph-ppt', description: 'Generate beautiful morph-animated PowerPoint presentations.', category: 'Document', url: '' },
  { name: 'officecli-academic-paper', description: 'Create academic papers, research papers, and technical reports.', category: 'Document', url: '' },
  // ── Business ──
  { name: 'officecli-pitch-deck', description: 'Create investor pitch decks, fundraising decks, and business proposals.', category: 'Business', url: '' },
  { name: 'officecli-financial-model', description: 'Build financial models, projections, and analysis spreadsheets.', category: 'Business', url: '' },
  { name: 'officecli-data-dashboard', description: 'Create data dashboards, KPI reports, and analytics summaries.', category: 'Business', url: '' },
  // ── Coding ──
  { name: 'code-review', description: 'Automated code review — find bugs, security issues, and suggest improvements.', category: 'Coding', url: '' },
  { name: 'testing', description: 'Write and run tests — unit, integration, and end-to-end test generation.', category: 'Coding', url: '' },
  { name: 'refactoring', description: 'Refactor code for readability, performance, and maintainability.', category: 'Coding', url: '' },
  // ── Creative ──
  { name: 'story-roleplay', description: 'Interactive story roleplay with character cards and narrative management.', category: 'Creative', url: '' },
  { name: 'mermaid', description: 'Render Mermaid diagrams as SVG or ASCII — flowcharts, sequence, ER diagrams.', category: 'Utility', url: '' },
  // ── Social Media ──
  { name: 'x-recruiter', description: 'Publish and manage recruitment content on X (Twitter).', category: 'Social Media', url: '' },
  { name: 'xiaohongshu-recruiter', description: 'Create and publish recruitment content on Xiaohongshu.', category: 'Social Media', url: '' },
  // ── Research ──
  { name: 'web-research', description: 'Deep web research — search, summarise, and synthesise information.', category: 'Research', url: '' },
  { name: 'data-analysis', description: 'Analyse datasets, generate insights, charts, and statistical reports.', category: 'Research', url: '' },
  // ── Utility ──
  { name: 'cron', description: 'Create, query, and manage scheduled tasks for automated operations.', category: 'Utility', url: '' },
  // ── Integration ──
  { name: 'moltbook', description: 'The social network for AI agents — post, comment, upvote, create communities.', category: 'Integration', url: '' },
  { name: 'godseye-skills', description: 'Access the Gods Eye Skills registry — discover and download community skills.', category: 'Integration', url: '' },
];

const categoryColors: Record<string, string> = {
  Document: 'blue',
  Business: 'green',
  Coding: 'geekblue',
  Creative: 'purple',
  'Social Media': 'orangered',
  Research: 'gold',
  Utility: 'cyan',
  Integration: 'lime',
  External: 'magenta',
};

type SkillStoreSettingsProps = {
  withWrapper?: boolean;
};

const SkillStoreSettings: React.FC<SkillStoreSettingsProps> = () => {
  const { t } = useTranslation();
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [externalSkills, setExternalSkills] = useState<RegistrySkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [skills, external] = await Promise.all([
        ipcBridge.fs.listAvailableSkills.invoke(),
        ipcBridge.fs.detectAndCountExternalSkills.invoke(),
      ]);
      setInstalledSkills(skills);

      // Build extra skills from external sources that aren't in the bundled catalog
      const bundledNames = new Set(BUNDLED_CATALOG.map((s) => s.name));
      const discovered: RegistrySkill[] = [];
      if (external.success && external.data) {
        for (const source of external.data) {
          for (const skill of source.skills) {
            if (!bundledNames.has(skill.name)) {
              discovered.push({
                name: skill.name,
                description: skill.description || `Discovered from ${source.name}`,
                category: 'External',
                url: '',
                source: source.name,
              });
            }
          }
        }
      }
      setExternalSkills(discovered);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const allSkills = useMemo(() => [...BUNDLED_CATALOG, ...externalSkills], [externalSkills]);

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(allSkills.map((s) => s.category)))],
    [allSkills]
  );

  const installedNames = useMemo(() => new Set(installedSkills.map((s) => s.name)), [installedSkills]);

  const filteredCatalog = useMemo(() => {
    let skills = allSkills;
    if (activeCategory !== 'All') {
      skills = skills.filter((s) => s.category === activeCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      skills = skills.filter(
        (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
      );
    }
    // Sort: not-installed first, then alphabetical
    return [...skills].sort((a, b) => {
      const aInstalled = installedNames.has(a.name) ? 1 : 0;
      const bInstalled = installedNames.has(b.name) ? 1 : 0;
      if (aInstalled !== bInstalled) return aInstalled - bInstalled;
      return a.name.localeCompare(b.name);
    });
  }, [allSkills, activeCategory, searchQuery, installedNames]);

  const handleInstall = useCallback(
    async (skill: RegistrySkill) => {
      setInstalling(skill.name);
      try {
        if (skill.url) {
          const result = await ipcBridge.fs.downloadSkill.invoke({ url: skill.url, name: skill.name });
          if (result.success) {
            Message.success(`"${skill.name}" installed`);
            void fetchData();
          } else {
            Message.error(result.msg || 'Install failed');
          }
        } else {
          // Try importing from external sources
          const external = await ipcBridge.fs.detectAndCountExternalSkills.invoke();
          if (external.success && external.data) {
            for (const source of external.data) {
              const match = source.skills.find((s) => s.name === skill.name);
              if (match) {
                const result = await ipcBridge.fs.importSkillWithSymlink.invoke({ skillPath: match.path });
                if (result.success) {
                  Message.success(`"${skill.name}" installed`);
                  void fetchData();
                  return;
                }
              }
            }
          }
          Message.info(`"${skill.name}" — install a CLI agent (Claude, Gemini) to discover this skill, or import it manually from the My Skills tab.`);
        }
      } catch (error) {
        console.error('Failed to install skill:', error);
        Message.error('Failed to install skill');
      } finally {
        setInstalling(null);
      }
    },
    [fetchData]
  );

  const installedCount = filteredCatalog.filter((s) => installedNames.has(s.name)).length;

  return (
    <div className='flex flex-col gap-16px'>
      {/* Header */}
      <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-12px'>
        <div className='flex flex-col'>
          <div className='flex items-center gap-10px'>
            <h3 className='text-18px font-bold text-[var(--color-text-1)] m-0'>
              {t('settings.skillStore.title', { defaultValue: 'Skill Store' })}
            </h3>
            <span className='bg-[rgba(var(--primary-6),0.08)] text-[rgb(var(--primary-6))] text-12px px-10px py-2px rd-full font-medium'>
              {allSkills.length}
            </span>
          </div>
          <span className='text-13px text-[var(--color-text-3)] mt-4px'>
            {t('settings.skillStore.subtitle', {
              defaultValue: 'Browse and install skills to specialise your agents. Skills from Claude CLI and Gemini CLI are detected automatically.',
            })}
          </span>
        </div>
        <div className='flex items-center gap-8px'>
          <button
            className='outline-none border-none bg-transparent cursor-pointer p-6px text-[var(--color-text-3)] hover:text-[var(--color-primary-6)] transition-colors rd-full hover:bg-[var(--color-fill-2)]'
            onClick={() => void fetchData()}
            title='Refresh'
          >
            <Refresh theme='outline' size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Search + Categories */}
      <div className='flex flex-col gap-12px'>
        <div className='relative'>
          <div className='absolute left-12px top-1/2 -translate-y-1/2 text-[var(--color-text-3)] flex pointer-events-none'>
            <Search size={15} />
          </div>
          <input
            type='text'
            className='w-full bg-[var(--color-fill-1)] hover:bg-[var(--color-fill-2)] border border-[var(--color-border)] focus:border-[var(--color-primary-5)] focus:bg-[var(--color-bg-1)] outline-none rd-8px py-8px pl-36px pr-12px text-13px text-[var(--color-text-1)] placeholder:text-[var(--color-text-4)] transition-all'
            placeholder={t('settings.skillStore.searchPlaceholder', { defaultValue: 'Search skills...' })}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className='flex flex-wrap gap-6px'>
          {categories.map((cat) => {
            const count = cat === 'All' ? allSkills.length : allSkills.filter((s) => s.category === cat).length;
            return (
              <button
                key={cat}
                type='button'
                className={`outline-none cursor-pointer px-14px py-5px text-13px rd-full transition-all border flex items-center gap-4px ${
                  activeCategory === cat
                    ? 'bg-[var(--color-primary-6)] border-[var(--color-primary-6)] text-white font-medium'
                    : 'bg-[var(--color-bg-1)] border-[var(--color-border)] text-[var(--color-text-2)] hover:bg-[var(--color-fill-1)] hover:text-[var(--color-text-1)]'
                }`}
                onClick={() => setActiveCategory(cat)}
              >
                {cat}
                <span className={`text-11px ${activeCategory === cat ? 'opacity-70' : 'opacity-50'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Stats bar */}
      <div className='flex items-center gap-16px text-12px text-[var(--color-text-3)]'>
        <span>{filteredCatalog.length} skills</span>
        <span>{installedCount} installed</span>
        {externalSkills.length > 0 && (
          <span>{externalSkills.length} discovered from CLI agents</span>
        )}
      </div>

      {/* Skill Grid */}
      <div className='grid grid-cols-1 md:grid-cols-2 gap-12px'>
        {filteredCatalog.map((skill) => {
          const isInstalled = installedNames.has(skill.name);
          const isInstalling = installing === skill.name;
          return (
            <div
              key={skill.name}
              className={`flex flex-col gap-10px p-16px border rd-12px transition-all hover:shadow-sm ${
                isInstalled
                  ? 'bg-[var(--color-bg-1)] border-[var(--color-border)] opacity-75'
                  : 'bg-[var(--color-bg-1)] border-[var(--color-border)] hover:border-[var(--color-primary-4)]'
              }`}
            >
              <div className='flex items-start justify-between gap-12px'>
                <div className='flex flex-col gap-4px min-w-0'>
                  <div className='flex items-center gap-8px flex-wrap'>
                    <span className='text-14px font-semibold text-[var(--color-text-1)]'>{skill.name}</span>
                    <Tag size='small' color={categoryColors[skill.category] || 'gray'}>
                      {skill.category}
                    </Tag>
                    {skill.source && (
                      <span className='text-11px text-[var(--color-text-4)]'>from {skill.source}</span>
                    )}
                  </div>
                  <span className='text-13px text-[var(--color-text-3)] line-clamp-2'>{skill.description}</span>
                </div>
                <div className='shrink-0'>
                  {isInstalled ? (
                    <Button size='small' disabled className='rd-full'>
                      <CheckOne theme='filled' size={14} className='mr-4px text-[var(--color-success-6)]' />
                      Installed
                    </Button>
                  ) : (
                    <Button
                      size='small'
                      type='primary'
                      loading={isInstalling}
                      onClick={() => void handleInstall(skill)}
                      className='rd-full'
                    >
                      {!isInstalling && <Download theme='outline' size={14} className='mr-4px' />}
                      Install
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredCatalog.length === 0 && (
        <div className='text-center text-[var(--color-text-4)] text-13px py-40px bg-[var(--color-fill-1)] rd-12px border border-dashed border-[var(--color-border)]'>
          No skills match your search.
        </div>
      )}

      {/* Footer tip */}
      <div className='flex items-start gap-10px p-16px bg-[var(--color-fill-1)] rd-12px text-[var(--color-text-3)] text-13px'>
        <span>
          Installed skills appear when adding agents to a team. Install Claude CLI or Gemini CLI to discover more skills automatically.
          You can also ask the leader agent to search the Gods Eye Skills registry for community skills.
        </span>
      </div>
    </div>
  );
};

export default SkillStoreSettings;
