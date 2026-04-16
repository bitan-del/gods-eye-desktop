import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TeamAgent, TeammateStatus } from '@/common/types/teamTypes';
import type { AgentStatusInfo } from '../hooks/useTeamSession';

type Props = {
  agents: TeamAgent[];
  statusMap: Map<string, AgentStatusInfo>;
  onAgentClick?: (slotId: string) => void;
};

/**
 * Pixel Office View — "Gods Eye Server" cozy cabin edition.
 *
 * Big top-down pixel-art scene of a warm log-cabin style workspace:
 *   - Stone fireplace with animated flame at the top
 *   - Wooden plank sign reading "GODS EYE SERVER" above the mantle
 *   - Wooden desks with vintage CRT monitors, mugs, plants, area rugs
 *   - Cozy armchair + coffee table in the center
 *   - Bookshelves, framed posters, potted plants around the edges
 *   - Snow accumulation along the outer edges
 *   - Sleeping cat mascot
 *   - Windows revealing a snowy mountain view
 *
 * Each agent occupies a workstation; character animations are driven by
 * real agent status (pending → bouncing, active → typing + glowing CRT,
 * failed → red '!' bubble, completed → green ✓ bubble).
 *
 * Inspired visually by pablodelucca/pixel-agents and cozy Stardew-Valley-ish
 * cabin pixel art.
 */

/* ───────────── Scene constants ───────────── */

const ROOM_W = 1280;
const ROOM_H = 820;

/** Agent workstation footprint */
const DESK_W = 220;
const DESK_H = 240;

/** Workstation positions — 2 cols on left, 2 cols on right, 2 rows each = 8 agents
 *  Center column (x=470..810) is reserved for the sign, fireplace and armchair. */
const DESK_POSITIONS: Array<{ x: number; y: number }> = [
  // Left — outer column
  { x: 20, y: 230 },
  { x: 20, y: 500 },
  // Left — inner column
  { x: 250, y: 230 },
  { x: 250, y: 500 },
  // Right — inner column
  { x: 810, y: 230 },
  { x: 810, y: 500 },
  // Right — outer column
  { x: 1040, y: 230 },
  { x: 1040, y: 500 },
];

/* ───────────── Character palettes ───────────── */

const CHARACTER_PALETTES: Record<string, { skin: string; shirt: string; hair: string; pants: string; beard?: string }> = {
  claude: { skin: '#f5c38a', shirt: '#d97706', hair: '#3a1f0e', pants: '#3b2417', beard: '#5a3418' },
  gemini: { skin: '#f5c38a', shirt: '#3b82f6', hair: '#1e1e2e', pants: '#1e3a8a' },
  codex: { skin: '#f5c38a', shirt: '#10b981', hair: '#111827', pants: '#064e3b' },
  qwen: { skin: '#f5c38a', shirt: '#a855f7', hair: '#1f1b24', pants: '#581c87' },
  copilot: { skin: '#f5c38a', shirt: '#6366f1', hair: '#1e1b2e', pants: '#312e81' },
  cursor: { skin: '#f5c38a', shirt: '#06b6d4', hair: '#0e1a24', pants: '#164e63' },
  goose: { skin: '#f5c38a', shirt: '#f43f5e', hair: '#1a1a1a', pants: '#881337' },
  kimi: { skin: '#f5c38a', shirt: '#eab308', hair: '#1e1a05', pants: '#713f12' },
  codebuddy: { skin: '#f5c38a', shirt: '#ec4899', hair: '#2a0a1d', pants: '#831843' },
  droid: { skin: '#d1d5db', shirt: '#64748b', hair: '#334155', pants: '#1e293b' },
  hermes: { skin: '#f5c38a', shirt: '#8b5cf6', hair: '#1a0b2e', pants: '#4c1d95' },
  opencode: { skin: '#f5c38a', shirt: '#14b8a6', hair: '#0f1f1d', pants: '#134e4a' },
  kiro: { skin: '#f5c38a', shirt: '#f97316', hair: '#1e120a', pants: '#7c2d12' },
  auggie: { skin: '#f5c38a', shirt: '#84cc16', hair: '#172008', pants: '#365314' },
  vibe: { skin: '#f5c38a', shirt: '#e11d48', hair: '#1f0a10', pants: '#881337' },
};

const DEFAULT_PALETTE = { skin: '#f5c38a', shirt: '#4f46e5', hair: '#1e1b2e', pants: '#312e81' };

const getPalette = (agentType: string) =>
  CHARACTER_PALETTES[agentType.toLowerCase()] ?? DEFAULT_PALETTE;

/* ───────────── Character archetypes (15 roles) ───────────── */

type HatKind = 'crown' | 'cap' | 'beret' | 'hardhat' | 'wizard' | 'visor' | 'headset' | 'beanie' | 'fedora';
type AccessoryKind = 'glasses' | 'tie' | 'sunglasses' | 'badge' | 'pen';

type Archetype = {
  id: string;
  title: string;
  emoji: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  hat?: HatKind;
  hatColor?: string;
  hatAccent?: string;
  accessory?: AccessoryKind;
  beard?: boolean;
};

const ARCHETYPES: Archetype[] = [
  { id: 'ceo', title: 'CEO', emoji: '👑', rarity: 'legendary', hat: 'crown', accessory: 'tie' },
  { id: 'cto', title: 'CTO', emoji: '⚡', rarity: 'legendary', hat: 'beanie', hatColor: '#0f172a', beard: true },
  { id: 'founder', title: 'Founder', emoji: '🔥', rarity: 'epic', accessory: 'sunglasses', beard: true },
  { id: 'manager', title: 'Manager', emoji: '📋', rarity: 'rare', hat: 'headset', hatColor: '#334155', accessory: 'tie' },
  { id: 'architect', title: 'Architect', emoji: '🏗️', rarity: 'rare', hat: 'hardhat', hatColor: '#f59e0b' },
  { id: 'senior', title: 'Senior Eng', emoji: '🎯', rarity: 'rare', beard: true, accessory: 'glasses' },
  { id: 'designer', title: 'Designer', emoji: '🎨', rarity: 'rare', hat: 'beret', hatColor: '#111827', accessory: 'glasses' },
  { id: 'research', title: 'Researcher', emoji: '🔮', rarity: 'epic', hat: 'wizard', hatColor: '#1e3a8a', hatAccent: '#fde047', beard: true },
  { id: 'data', title: 'Data Sci', emoji: '📊', rarity: 'common', accessory: 'glasses' },
  { id: 'devops', title: 'DevOps', emoji: '⚙️', rarity: 'common', hat: 'cap', hatColor: '#166534' },
  { id: 'scrum', title: 'Scrum Lead', emoji: '🏃', rarity: 'common', hat: 'visor', hatColor: '#8b5cf6' },
  { id: 'qa', title: 'QA Tester', emoji: '🔍', rarity: 'common', accessory: 'glasses' },
  { id: 'support', title: 'Support', emoji: '💬', rarity: 'common', hat: 'headset', hatColor: '#f97316' },
  { id: 'junior', title: 'Junior Eng', emoji: '🌱', rarity: 'common' },
  { id: 'intern', title: 'Intern', emoji: '☕', rarity: 'common', hat: 'cap', hatColor: '#dc2626' },
];

const RARITY_COLORS: Record<Archetype['rarity'], string> = {
  common: '#94a3b8',
  rare: '#60a5fa',
  epic: '#c084fc',
  legendary: '#fbbf24',
};

/** Deterministic archetype assignment per agent. Lead always gets CEO. */
function archetypeFor(slotId: string, isLead: boolean): Archetype {
  if (isLead) return ARCHETYPES[0];
  let h = 0;
  for (let i = 0; i < slotId.length; i++) h = (h * 31 + slotId.charCodeAt(i)) | 0;
  const pool = ARCHETYPES.length - 1; // skip CEO (index 0)
  return ARCHETYPES[1 + (Math.abs(h) % pool)];
}

/* ───────────── Pixel helpers ───────────── */

const P: React.FC<{ x: number; y: number; fill: string; w?: number; h?: number; opacity?: number }> = ({
  x,
  y,
  fill,
  w = 1,
  h = 1,
  opacity,
}) => <rect x={x} y={y} width={w} height={h} fill={fill} opacity={opacity} shapeRendering='crispEdges' />;

/* ───────────── Pixel character (top-down seated) ───────────── */

/** Renders the hat overlay for an archetype (sits above head at rows y=-5..0) */
const PixelHat: React.FC<{ archetype: Archetype }> = ({ archetype }) => {
  const { hat, hatColor, hatAccent } = archetype;
  const color = hatColor ?? '#1f2937';
  const accent = hatAccent ?? '#ffffff';
  switch (hat) {
    case 'crown':
      return (
        <g>
          <P x={3} y={-2} fill='#fbbf24' /><P x={4} y={-2} fill='#fbbf24' /><P x={5} y={-2} fill='#fbbf24' />
          <P x={6} y={-2} fill='#fbbf24' /><P x={7} y={-2} fill='#fbbf24' /><P x={8} y={-2} fill='#fbbf24' />
          <P x={3} y={-3} fill='#fde047' /><P x={5} y={-3} fill='#fde047' /><P x={7} y={-3} fill='#fde047' />
          <P x={4} y={-4} fill='#fde047' /><P x={6} y={-4} fill='#fde047' /><P x={8} y={-4} fill='#fde047' />
          <P x={5} y={-1} fill='#dc2626' /><P x={7} y={-1} fill='#3b82f6' />
        </g>
      );
    case 'cap':
      return (
        <g>
          <P x={2} y={-1} fill={color} w={8} /><P x={2} y={0} fill={color} w={8} />
          <P x={3} y={-2} fill={color} w={6} />
          <P x={9} y={1} fill={color} w={3} />
          <P x={5} y={-1} fill={accent} w={2} />
        </g>
      );
    case 'beret':
      return (
        <g>
          <P x={2} y={-1} fill={color} w={8} />
          <P x={3} y={-2} fill={color} w={6} />
          <P x={4} y={-3} fill={color} w={3} />
          <P x={2} y={0} fill={color} w={8} />
          <P x={4} y={-4} fill='#dc2626' />
        </g>
      );
    case 'hardhat':
      return (
        <g>
          <P x={2} y={-1} fill={color} w={8} /><P x={2} y={0} fill={color} w={8} />
          <P x={3} y={-2} fill={color} w={6} />
          <P x={4} y={-3} fill={color} w={4} />
          <P x={1} y={0} fill={color} w={10} />
          <P x={5} y={-2} fill={accent} w={2} />
        </g>
      );
    case 'wizard':
      return (
        <g>
          <P x={5} y={-5} fill={hatAccent ?? '#fde047'} />
          <P x={5} y={-4} fill={color} />
          <P x={4} y={-3} fill={color} w={3} />
          <P x={3} y={-2} fill={color} w={5} />
          <P x={2} y={-1} fill={color} w={8} />
          <P x={2} y={0} fill={color} w={8} />
          <P x={3} y={-2} fill={accent} />
          <P x={7} y={-2} fill={accent} />
        </g>
      );
    case 'visor':
      return (
        <g>
          <P x={2} y={0} fill={color} w={8} />
          <P x={9} y={1} fill={color} w={3} />
        </g>
      );
    case 'headset':
      return (
        <g>
          <P x={3} y={-1} fill={color} w={6} />
          <P x={3} y={0} fill={color} /><P x={8} y={0} fill={color} />
          <P x={1} y={2} fill={color} /><P x={1} y={3} fill={color} />
          <P x={10} y={2} fill={color} /><P x={10} y={3} fill={color} />
          <P x={0} y={3} fill='#1a1a1a' /><P x={11} y={3} fill='#1a1a1a' />
        </g>
      );
    case 'beanie':
      return (
        <g>
          <P x={2} y={-1} fill={color} w={8} /><P x={2} y={0} fill={color} w={8} />
          <P x={3} y={-2} fill={color} w={6} />
          <P x={4} y={-3} fill={color} w={4} />
          <P x={2} y={0} fill={accent} w={8} h={1} />
          <P x={5} y={-4} fill={color} w={2} />
        </g>
      );
    case 'fedora':
      return (
        <g>
          <P x={1} y={0} fill={color} w={10} />
          <P x={2} y={-1} fill={color} w={8} />
          <P x={3} y={-2} fill={color} w={6} />
          <P x={2} y={0} fill={accent} w={8} h={1} />
        </g>
      );
    default:
      return null;
  }
};

/** Face accessories (glasses, tie, sunglasses) */
const PixelAccessory: React.FC<{ archetype: Archetype }> = ({ archetype }) => {
  const { accessory } = archetype;
  switch (accessory) {
    case 'glasses':
      return (
        <g>
          <P x={3} y={3} fill='#1a1a1a' /><P x={4} y={3} fill='#1a1a1a' /><P x={5} y={3} fill='#1a1a1a' />
          <P x={6} y={3} fill='#1a1a1a' /><P x={7} y={3} fill='#1a1a1a' /><P x={8} y={3} fill='#1a1a1a' />
          <P x={4} y={3} fill='#bae6fd' /><P x={7} y={3} fill='#bae6fd' />
          <P x={5} y={3} fill='#1a1a1a' />
        </g>
      );
    case 'sunglasses':
      return (
        <g>
          <P x={3} y={3} fill='#0a0a0a' w={7} />
          <P x={4} y={3} fill='#1e293b' /><P x={7} y={3} fill='#1e293b' />
          <P x={5} y={3} fill='#0a0a0a' />
          <P x={4} y={3} fill='#ffffff' w={1} h={1} opacity={0.9} />
        </g>
      );
    case 'tie':
      return (
        <g>
          <P x={5} y={7} fill='#b91c1c' /><P x={6} y={7} fill='#b91c1c' />
          <P x={5} y={8} fill='#7f1d1d' /><P x={6} y={8} fill='#7f1d1d' />
          <P x={5} y={9} fill='#b91c1c' /><P x={6} y={9} fill='#b91c1c' />
          <P x={5} y={10} fill='#7f1d1d' /><P x={6} y={10} fill='#7f1d1d' />
        </g>
      );
    case 'badge':
      return <P x={2} y={8} fill='#fbbf24' />;
    case 'pen':
      return <P x={9} y={7} fill='#3b82f6' />;
    default:
      return null;
  }
};

const PixelCharacter: React.FC<{
  palette: { skin: string; shirt: string; hair: string; pants: string; beard?: string };
  archetype: Archetype;
  typing?: boolean;
  pending?: boolean;
}> = ({ palette, archetype, typing, pending }) => {
  const { skin, shirt, hair } = palette;
  const beardEnabled = archetype.beard ?? !!palette.beard;
  const beardColor = palette.beard ?? '#4a2e17';

  const hairTop = [
    [3, 0], [4, 0], [5, 0], [6, 0], [7, 0], [8, 0],
    [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 1],
    [2, 2], [9, 2],
  ];
  const face = [
    [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2],
    [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3],
    [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4],
    [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5],
  ];
  const eyes = [[4, 3], [7, 3]];
  const mouth = [[5, 5], [6, 5]];
  const beardPixels = beardEnabled
    ? [
        [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5],
        [4, 6], [5, 6], [6, 6], [7, 6],
      ]
    : [];
  const neck = [[5, 6], [6, 6]];
  const shirtRow = [
    [2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7], [8, 7], [9, 7],
    [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 8], [7, 8], [8, 8], [9, 8], [10, 8],
    [1, 9], [2, 9], [3, 9], [4, 9], [5, 9], [6, 9], [7, 9], [8, 9], [9, 9], [10, 9],
  ];
  const armsRest = [[0, 9], [11, 9], [0, 10], [11, 10]];
  const armsType = [[0, 8], [11, 8], [1, 9], [10, 9]];
  const arms = typing ? armsType : armsRest;

  return (
    <g style={{ animation: pending ? 'pixel-bounce 0.7s ease-in-out infinite' : undefined }}>
      {hairTop.map(([x, y], i) => <P key={`h${i}`} x={x} y={y} fill={hair} />)}
      {face.map(([x, y], i) => <P key={`f${i}`} x={x} y={y} fill={skin} />)}
      {beardPixels.map(([x, y], i) => <P key={`bd${i}`} x={x} y={y} fill={beardColor} />)}
      {eyes.map(([x, y], i) => <P key={`e${i}`} x={x} y={y} fill='#0a0a0a' />)}
      {!beardEnabled && mouth.map(([x, y], i) => <P key={`m${i}`} x={x} y={y} fill='#7a4a3a' />)}
      {!beardEnabled && neck.map(([x, y], i) => <P key={`n${i}`} x={x} y={y} fill={skin} />)}
      {shirtRow.map(([x, y], i) => <P key={`s${i}`} x={x} y={y} fill={shirt} />)}
      <PixelAccessory archetype={archetype} />
      <g style={{ animation: typing ? 'pixel-type 0.28s steps(2) infinite' : undefined, transformOrigin: '6px 8px' }}>
        {arms.map(([x, y], i) => <P key={`a${i}`} x={x} y={y} fill={skin} />)}
      </g>
      <PixelHat archetype={archetype} />
    </g>
  );
};

/* ───────────── Workstation (wooden desk + CRT + character) ───────────── */

const AgentWorkstation: React.FC<{
  agent: TeamAgent;
  status: TeammateStatus;
  position: { x: number; y: number };
  xp: number;
  level: number;
  onClick?: () => void;
}> = ({ agent, status, position, xp, level, onClick }) => {
  const palette = getPalette(agent.agentType);
  const isLead = agent.role === 'lead';
  const archetype = useMemo(() => archetypeFor(agent.slotId, isLead), [agent.slotId, isLead]);
  const isTyping = status === 'active';
  const isPending = status === 'pending';
  const isFailed = status === 'failed';
  const isDone = status === 'completed';
  const rarityColor = RARITY_COLORS[archetype.rarity];
  const xpIntoLevel = xp % 100;

  return (
    <g transform={`translate(${position.x}, ${position.y})`} style={{ cursor: 'pointer' }} onClick={onClick} opacity={isFailed ? 0.55 : 1}>
      {/* Area rug beneath workstation */}
      <rect x={6} y={30} width={DESK_W - 12} height={DESK_H - 36} fill='#7c2d12' shapeRendering='crispEdges' />
      <rect x={6} y={30} width={DESK_W - 12} height={5} fill='#b45309' shapeRendering='crispEdges' />
      <rect x={6} y={DESK_H - 11} width={DESK_W - 12} height={5} fill='#78350f' shapeRendering='crispEdges' />
      {/* Rug pattern */}
      {Array.from({ length: 7 }).map((_, i) => (
        <rect
          key={`rug${i}`}
          x={14 + i * 30}
          y={36}
          width={18}
          height={DESK_H - 48}
          fill='none'
          stroke='#92400e'
          strokeWidth={1}
          strokeDasharray='3 3'
          shapeRendering='crispEdges'
        />
      ))}

      {/* Wooden desk (top-down) — bigger, higher */}
      <rect x={20} y={46} width={DESK_W - 40} height={66} fill='#8b5a2b' shapeRendering='crispEdges' />
      <rect x={20} y={46} width={DESK_W - 40} height={3} fill='#b07a46' shapeRendering='crispEdges' />
      <rect x={20} y={60} width={DESK_W - 40} height={1} fill='#6b4423' shapeRendering='crispEdges' />
      <rect x={20} y={78} width={DESK_W - 40} height={1} fill='#6b4423' shapeRendering='crispEdges' />
      <rect x={20} y={110} width={DESK_W - 40} height={3} fill='#4a2e17' shapeRendering='crispEdges' />
      <rect x={20} y={113} width={DESK_W - 40} height={2} fill='#18181f' opacity={0.4} shapeRendering='crispEdges' />

      {/* CRT Monitor (vintage beige) — 2× scale */}
      <g transform={`translate(${DESK_W / 2 - 56}, 14)`}>
        {/* Monitor stand */}
        <rect x={32} y={88} width={48} height={14} fill='#d4c5a0' shapeRendering='crispEdges' />
        <rect x={32} y={88} width={48} height={4} fill='#e8dbb8' shapeRendering='crispEdges' />
        <rect x={20} y={100} width={72} height={6} fill='#a89775' shapeRendering='crispEdges' />
        {/* Monitor body */}
        <rect x={0} y={4} width={112} height={86} fill='#d4c5a0' shapeRendering='crispEdges' />
        <rect x={0} y={4} width={112} height={6} fill='#e8dbb8' shapeRendering='crispEdges' />
        <rect x={0} y={84} width={112} height={6} fill='#a89775' shapeRendering='crispEdges' />
        <rect x={104} y={4} width={8} height={86} fill='#a89775' shapeRendering='crispEdges' />
        {/* Bezel */}
        <rect x={10} y={14} width={92} height={64} fill='#1a1a1a' shapeRendering='crispEdges' />
        {/* Screen */}
        <rect
          x={14}
          y={18}
          width={84}
          height={56}
          fill={isTyping ? '#0f3d2a' : '#0a0f1a'}
          shapeRendering='crispEdges'
        />
        {/* Screen content */}
        {isTyping ? (
          <g style={{ animation: 'pixel-screen-flicker 0.9s steps(2) infinite' }}>
            <rect x={18} y={22} width={28} height={2} fill='#4ade80' shapeRendering='crispEdges' />
            <rect x={50} y={22} width={14} height={2} fill='#86efac' shapeRendering='crispEdges' />
            <rect x={18} y={28} width={44} height={2} fill='#4ade80' shapeRendering='crispEdges' />
            <rect x={18} y={34} width={20} height={2} fill='#86efac' shapeRendering='crispEdges' />
            <rect x={42} y={34} width={30} height={2} fill='#4ade80' shapeRendering='crispEdges' />
            <rect x={18} y={40} width={50} height={2} fill='#4ade80' shapeRendering='crispEdges' />
            <rect x={18} y={46} width={26} height={2} fill='#86efac' shapeRendering='crispEdges' />
            <rect x={18} y={52} width={40} height={2} fill='#4ade80' shapeRendering='crispEdges' />
            <rect x={18} y={58} width={22} height={2} fill='#86efac' shapeRendering='crispEdges' />
            <rect x={18} y={64} width={34} height={2} fill='#4ade80' shapeRendering='crispEdges' />
            <rect x={54} y={64} width={4} height={4} fill='#4ade80' shapeRendering='crispEdges'>
              <animate attributeName='opacity' values='1;0;1' dur='0.8s' repeatCount='indefinite' />
            </rect>
          </g>
        ) : (
          <>
            <rect x={18} y={28} width={30} height={2} fill='#1e293b' shapeRendering='crispEdges' />
            <rect x={18} y={38} width={44} height={2} fill='#1e293b' shapeRendering='crispEdges' />
            <rect x={18} y={48} width={24} height={2} fill='#1e293b' shapeRendering='crispEdges' />
          </>
        )}
        {/* Brand label */}
        <rect x={48} y={86} width={18} height={2} fill='#6b4423' shapeRendering='crispEdges' />
        {/* Power LED */}
        <rect x={88} y={86} width={4} height={2} fill={isTyping ? '#22c55e' : '#991b1b'} shapeRendering='crispEdges' />
      </g>

      {/* Keyboard — wider */}
      <rect x={DESK_W / 2 - 44} y={96} width={88} height={12} fill='#2a2a34' shapeRendering='crispEdges' />
      <rect x={DESK_W / 2 - 42} y={98} width={84} height={1} fill='#4a4a55' shapeRendering='crispEdges' />
      <rect x={DESK_W / 2 - 42} y={101} width={84} height={1} fill='#4a4a55' shapeRendering='crispEdges' />
      <rect x={DESK_W / 2 - 42} y={104} width={84} height={1} fill='#4a4a55' shapeRendering='crispEdges' />

      {/* Coffee mug on desk — bigger */}
      <g transform={`translate(${DESK_W - 66}, 58)`}>
        <rect x={0} y={2} width={18} height={22} fill='#f1f5f9' shapeRendering='crispEdges' />
        <rect x={0} y={2} width={18} height={3} fill='#e2e8f0' shapeRendering='crispEdges' />
        <rect x={18} y={8} width={3} height={10} fill='#f1f5f9' shapeRendering='crispEdges' />
        <rect x={3} y={5} width={12} height={4} fill='#78350f' shapeRendering='crispEdges' />
        <text x={9} y={18} textAnchor='middle' fontFamily='monospace' fontSize={7} fontWeight='bold' fill='#fde047'>
          GE
        </text>
        {/* Steam when active */}
        {isTyping && (
          <g style={{ animation: 'pixel-steam 2s ease-in-out infinite' }}>
            <rect x={6} y={-3} width={2} height={3} fill='#cbd5e1' opacity={0.6} shapeRendering='crispEdges' />
            <rect x={10} y={-6} width={2} height={3} fill='#cbd5e1' opacity={0.4} shapeRendering='crispEdges' />
            <rect x={6} y={-9} width={2} height={3} fill='#cbd5e1' opacity={0.2} shapeRendering='crispEdges' />
          </g>
        )}
      </g>

      {/* Small potted plant on desk — bigger */}
      <g transform={`translate(30, 48)`}>
        <rect x={0} y={14} width={18} height={12} fill='#78350f' shapeRendering='crispEdges' />
        <rect x={0} y={14} width={18} height={2} fill='#92400e' shapeRendering='crispEdges' />
        <rect x={2} y={4} width={14} height={12} fill='#15803d' shapeRendering='crispEdges' />
        <rect x={3} y={0} width={12} height={6} fill='#22c55e' shapeRendering='crispEdges' />
        <rect x={5} y={-4} width={8} height={4} fill='#4ade80' shapeRendering='crispEdges' />
      </g>

      {/* Wooden chair (top-down) — bigger */}
      <g transform={`translate(${DESK_W / 2 - 22}, ${DESK_H - 62})`}>
        <rect x={0} y={0} width={44} height={22} fill='#8b5a2b' shapeRendering='crispEdges' />
        <rect x={0} y={0} width={44} height={3} fill='#b07a46' shapeRendering='crispEdges' />
        <rect x={0} y={19} width={44} height={3} fill='#4a2e17' shapeRendering='crispEdges' />
        {/* Backrest lines */}
        <rect x={6} y={3} width={3} height={17} fill='#6b4423' shapeRendering='crispEdges' />
        <rect x={21} y={3} width={3} height={17} fill='#6b4423' shapeRendering='crispEdges' />
        <rect x={36} y={3} width={3} height={17} fill='#6b4423' shapeRendering='crispEdges' />
        {/* Seat cushion */}
        <rect x={4} y={22} width={36} height={14} fill='#b91c1c' shapeRendering='crispEdges' />
        <rect x={4} y={22} width={36} height={3} fill='#dc2626' shapeRendering='crispEdges' />
        <rect x={4} y={33} width={36} height={3} fill='#7f1d1d' shapeRendering='crispEdges' />
      </g>

      {/* Character sitting in the chair — scaled 4.5× (~half the CRT width) */}
      <g transform={`translate(${DESK_W / 2 - 27}, 135) scale(4.5)`}>
        <PixelCharacter palette={palette} archetype={archetype} typing={isTyping} pending={isPending} />
      </g>

      {/* Archetype role badge — floating above desk */}
      <g transform={`translate(${DESK_W / 2}, 4)`}>
        <rect x={-60} y={0} width={120} height={18} rx={2} fill='rgba(10,14,26,0.92)' shapeRendering='crispEdges' />
        <rect x={-60} y={0} width={3} height={18} fill={rarityColor} shapeRendering='crispEdges' />
        <rect x={57} y={0} width={3} height={18} fill={rarityColor} shapeRendering='crispEdges' />
        <text
          x={-48}
          y={13}
          textAnchor='start'
          fontFamily='ui-monospace, monospace'
          fontSize={10}
        >
          {archetype.emoji}
        </text>
        <text
          x={8}
          y={13}
          textAnchor='middle'
          fontFamily='ui-monospace, "Cascadia Code", monospace'
          fontSize={10}
          fontWeight='bold'
          fill={rarityColor}
          style={{ pointerEvents: 'none' }}
        >
          {archetype.title.toUpperCase()}
        </text>
      </g>

      {/* Level chip — top-left corner of workstation */}
      <g transform='translate(10, 4)'>
        <rect x={0} y={0} width={44} height={18} rx={2} fill={rarityColor} shapeRendering='crispEdges' />
        <rect x={0} y={0} width={44} height={4} fill='rgba(255,255,255,0.35)' shapeRendering='crispEdges' />
        <text
          x={22}
          y={13}
          textAnchor='middle'
          fontFamily='ui-monospace, monospace'
          fontSize={10}
          fontWeight='bold'
          fill='#0a0a0a'
          style={{ pointerEvents: 'none' }}
        >
          LVL {level}
        </text>
      </g>

      {/* XP bar beneath name tag */}
      <g transform={`translate(${DESK_W / 2 - 60}, ${DESK_H - 4})`}>
        <rect x={0} y={0} width={120} height={4} fill='rgba(10,14,26,0.85)' shapeRendering='crispEdges' />
        <rect
          x={1}
          y={1}
          width={Math.max(0, Math.min(118, 1.18 * xpIntoLevel))}
          height={2}
          fill={isTyping ? '#4ade80' : rarityColor}
          shapeRendering='crispEdges'
        />
      </g>

      {/* Speech bubble */}
      {(isFailed || isDone) && (
        <g transform={`translate(${DESK_W / 2 + 22}, 78)`}>
          <g style={{ animation: 'pixel-bubble-float 2s ease-in-out infinite' }}>
            <rect
              x={0}
              y={0}
              width={22}
              height={20}
              rx={2}
              fill={isFailed ? '#ef4444' : '#22c55e'}
              shapeRendering='crispEdges'
            />
            <rect x={3} y={19} width={4} height={4} fill={isFailed ? '#ef4444' : '#22c55e'} shapeRendering='crispEdges' />
            <text
              x={11}
              y={15}
              textAnchor='middle'
              fontFamily='monospace'
              fontSize={14}
              fontWeight='bold'
              fill='#fff'
              style={{ pointerEvents: 'none' }}
            >
              {isFailed ? '!' : '✓'}
            </text>
          </g>
        </g>
      )}

      {/* Name tag — bigger text */}
      <g transform={`translate(${DESK_W / 2}, ${DESK_H - 20})`}>
        <rect x={-60} y={0} width={120} height={16} rx={1} fill='rgba(10,14,26,0.92)' shapeRendering='crispEdges' />
        <text
          x={0}
          y={12}
          textAnchor='middle'
          fontFamily='ui-monospace, "Cascadia Code", monospace'
          fontSize={11}
          fontWeight='bold'
          fill={isTyping ? '#4ade80' : '#fde68a'}
          style={{ pointerEvents: 'none' }}
        >
          {agent.agentName.length > 16 ? `${agent.agentName.slice(0, 16)}…` : agent.agentName}
        </text>
      </g>

      {/* Status LED */}
      <circle
        cx={DESK_W - 18}
        cy={40}
        r={5}
        fill={isTyping ? '#22c55e' : isPending ? '#f59e0b' : isFailed ? '#ef4444' : isDone ? '#3b82f6' : '#78716c'}
      >
        {(isTyping || isPending) && <animate attributeName='opacity' values='1;0.3;1' dur='1s' repeatCount='indefinite' />}
      </circle>

      {/* Hover outline */}
      <rect
        x={6}
        y={30}
        width={DESK_W - 12}
        height={DESK_H - 36}
        fill='none'
        stroke='rgba(251,191,36,0)'
        strokeWidth={2}
        className='ws-hover'
      />
    </g>
  );
};

const EmptyWorkstation: React.FC<{ position: { x: number; y: number } }> = ({ position }) => (
  <g transform={`translate(${position.x}, ${position.y})`} opacity={0.35}>
    {/* Empty rug */}
    <rect x={6} y={30} width={DESK_W - 12} height={DESK_H - 36} fill='#4a2e17' shapeRendering='crispEdges' />
    <rect x={6} y={30} width={DESK_W - 12} height={4} fill='#6b4423' shapeRendering='crispEdges' />
    {/* Empty desk */}
    <rect x={20} y={46} width={DESK_W - 40} height={66} fill='#5a3a17' shapeRendering='crispEdges' />
    <rect x={20} y={46} width={DESK_W - 40} height={2} fill='#78350f' shapeRendering='crispEdges' />
    {/* Plaque */}
    <rect x={DESK_W / 2 - 70} y={DESK_H / 2 - 10} width={140} height={20} fill='rgba(10,14,26,0.75)' shapeRendering='crispEdges' />
    <text
      x={DESK_W / 2}
      y={DESK_H / 2 + 4}
      textAnchor='middle'
      fontFamily='ui-monospace, monospace'
      fontSize={11}
      fill='#a8a29e'
    >
      AWAITING AGENT
    </text>
  </g>
);

/* ───────────── Scene background ───────────── */

/** Wooden plank floor across the whole scene */
const WoodenFloor: React.FC = () => {
  const planks = [];
  const PLANK_H = 32;
  const PLANK_W = 120;
  const rows = Math.ceil(ROOM_H / PLANK_H);
  const cols = Math.ceil(ROOM_W / PLANK_W) + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const offset = r % 2 === 0 ? 0 : PLANK_W / 2;
      const x = c * PLANK_W - offset;
      const y = r * PLANK_H;
      const tone = (r + c) % 3;
      const base = tone === 0 ? '#8b5a2b' : tone === 1 ? '#7a4d24' : '#6b4423';
      planks.push(
        <g key={`pl-${r}-${c}`}>
          <rect x={x} y={y} width={PLANK_W} height={PLANK_H} fill={base} shapeRendering='crispEdges' />
          {/* Top highlight */}
          <rect x={x} y={y} width={PLANK_W} height={1} fill='#a67c52' shapeRendering='crispEdges' />
          {/* Bottom shadow */}
          <rect x={x} y={y + PLANK_H - 1} width={PLANK_W} height={1} fill='#4a2e17' shapeRendering='crispEdges' />
          {/* Wood grain lines */}
          <rect x={x + 20} y={y + 8} width={40} height={1} fill='#6b4423' shapeRendering='crispEdges' />
          <rect x={x + 60} y={y + 20} width={30} height={1} fill='#6b4423' shapeRendering='crispEdges' />
          {/* Nails */}
          <rect x={x + 2} y={y + 4} width={2} height={2} fill='#3a2410' shapeRendering='crispEdges' />
          <rect x={x + PLANK_W - 4} y={y + 4} width={2} height={2} fill='#3a2410' shapeRendering='crispEdges' />
        </g>
      );
    }
  }
  return <g clipPath='url(#room-clip)'>{planks}</g>;
};

/** Stone back wall with windows and "GODS EYE SERVER" sign */
const BackWall: React.FC = () => (
  <g>
    {/* Stone base */}
    <rect x={0} y={0} width={ROOM_W} height={110} fill='#475569' shapeRendering='crispEdges' />
    {/* Stone pattern (irregular blocks) */}
    {Array.from({ length: 20 }).map((_, i) => {
      const row = Math.floor(i / 10);
      const col = i % 10;
      const offset = row % 2 === 0 ? 0 : 60;
      const x = col * 120 - offset;
      const y = row * 35 + 10;
      return (
        <g key={`st-${i}`}>
          <rect x={x} y={y} width={120} height={30} fill='none' stroke='#334155' strokeWidth={1} shapeRendering='crispEdges' />
          <rect x={x + 4} y={y + 4} width={2} height={2} fill='#64748b' shapeRendering='crispEdges' />
          <rect x={x + 30} y={y + 16} width={3} height={2} fill='#64748b' shapeRendering='crispEdges' />
          <rect x={x + 80} y={y + 8} width={2} height={3} fill='#334155' shapeRendering='crispEdges' />
        </g>
      );
    })}
    {/* Bottom trim (wooden) */}
    <rect x={0} y={104} width={ROOM_W} height={6} fill='#6b4423' shapeRendering='crispEdges' />
    <rect x={0} y={104} width={ROOM_W} height={2} fill='#8b5a2b' shapeRendering='crispEdges' />

    {/* Window left */}
    <g transform='translate(160, 18)'>
      <rect x={0} y={0} width={100} height={72} fill='#6b4423' shapeRendering='crispEdges' />
      <rect x={4} y={4} width={92} height={64} fill='#87ceeb' shapeRendering='crispEdges' />
      {/* Snowy mountain view */}
      <rect x={4} y={36} width={92} height={32} fill='#b7d4e8' shapeRendering='crispEdges' />
      <polygon points='4,40 28,16 52,36' fill='#e2e8f0' shapeRendering='crispEdges' />
      <polygon points='40,40 64,12 92,36' fill='#f1f5f9' shapeRendering='crispEdges' />
      <polygon points='60,40 80,24 96,36' fill='#cbd5e1' shapeRendering='crispEdges' />
      {/* Snow caps */}
      <polygon points='24,20 28,16 32,20' fill='#ffffff' shapeRendering='crispEdges' />
      <polygon points='60,16 64,12 68,16' fill='#ffffff' shapeRendering='crispEdges' />
      {/* Window panes */}
      <line x1={50} y1={4} x2={50} y2={68} stroke='#6b4423' strokeWidth={3} />
      <line x1={4} y1={36} x2={96} y2={36} stroke='#6b4423' strokeWidth={3} />
      {/* Window sill */}
      <rect x={-4} y={72} width={108} height={4} fill='#5a3a17' shapeRendering='crispEdges' />
      <rect x={-4} y={70} width={108} height={2} fill='#78350f' shapeRendering='crispEdges' />
    </g>

    {/* Window right */}
    <g transform='translate(940, 18)'>
      <rect x={0} y={0} width={100} height={72} fill='#6b4423' shapeRendering='crispEdges' />
      <rect x={4} y={4} width={92} height={64} fill='#87ceeb' shapeRendering='crispEdges' />
      <rect x={4} y={36} width={92} height={32} fill='#b7d4e8' shapeRendering='crispEdges' />
      <polygon points='4,40 24,18 48,36' fill='#e2e8f0' shapeRendering='crispEdges' />
      <polygon points='36,40 64,8 92,36' fill='#f1f5f9' shapeRendering='crispEdges' />
      <polygon points='20,18 24,14 28,18' fill='#ffffff' shapeRendering='crispEdges' />
      <polygon points='60,12 64,8 68,12' fill='#ffffff' shapeRendering='crispEdges' />
      {/* Pine tree in snow */}
      <rect x={75} y={30} width={2} height={6} fill='#78350f' shapeRendering='crispEdges' />
      <polygon points='72,30 76,20 80,30' fill='#14532d' shapeRendering='crispEdges' />
      <polygon points='73,26 76,18 79,26' fill='#166534' shapeRendering='crispEdges' />
      <line x1={50} y1={4} x2={50} y2={68} stroke='#6b4423' strokeWidth={3} />
      <line x1={4} y1={36} x2={96} y2={36} stroke='#6b4423' strokeWidth={3} />
      <rect x={-4} y={72} width={108} height={4} fill='#5a3a17' shapeRendering='crispEdges' />
      <rect x={-4} y={70} width={108} height={2} fill='#78350f' shapeRendering='crispEdges' />
    </g>

    {/* Framed photo 1 (between window left and center) */}
    <g transform='translate(300, 30)'>
      <rect x={0} y={0} width={50} height={60} fill='#3a2410' shapeRendering='crispEdges' />
      <rect x={3} y={3} width={44} height={54} fill='#0f0f0f' shapeRendering='crispEdges' />
      {/* "Gods Eye" stylized logo */}
      <circle cx={25} cy={22} r={12} fill='#4f8cff' />
      <circle cx={25} cy={22} r={6} fill='#1e3a8a' />
      <circle cx={25} cy={22} r={2} fill='#ffffff' />
      <rect x={8} y={40} width={34} height={12} fill='#1a1a2a' shapeRendering='crispEdges' />
      <text x={25} y={49} textAnchor='middle' fontFamily='monospace' fontSize={6} fontWeight='bold' fill='#4f8cff'>
        OUR VISION
      </text>
    </g>

    {/* Framed photo 2 */}
    <g transform='translate(850, 30)'>
      <rect x={0} y={0} width={50} height={50} fill='#8b5a2b' shapeRendering='crispEdges' />
      <rect x={3} y={3} width={44} height={44} fill='#1f2937' shapeRendering='crispEdges' />
      {/* Team photo silhouettes */}
      <circle cx={15} cy={18} r={5} fill='#f5c38a' />
      <circle cx={25} cy={16} r={5} fill='#f5c38a' />
      <circle cx={35} cy={18} r={5} fill='#f5c38a' />
      <rect x={8} y={22} width={34} height={16} fill='#4f46e5' shapeRendering='crispEdges' />
      <text x={25} y={44} textAnchor='middle' fontFamily='monospace' fontSize={5} fill='#cbd5e1'>
        THE TEAM
      </text>
    </g>

    {/* Wall clock (center-right) */}
    <g transform='translate(720, 40)'>
      <circle cx={0} cy={0} r={18} fill='#f1f5f9' stroke='#3a2410' strokeWidth={3} />
      <circle cx={0} cy={0} r={14} fill='none' stroke='#cbd5e1' strokeWidth={1} />
      {/* Hour marks */}
      <rect x={-1} y={-14} width={2} height={3} fill='#0f0f0f' shapeRendering='crispEdges' />
      <rect x={-1} y={11} width={2} height={3} fill='#0f0f0f' shapeRendering='crispEdges' />
      <rect x={-14} y={-1} width={3} height={2} fill='#0f0f0f' shapeRendering='crispEdges' />
      <rect x={11} y={-1} width={3} height={2} fill='#0f0f0f' shapeRendering='crispEdges' />
      {/* Hands */}
      <line x1={0} y1={0} x2={0} y2={-10} stroke='#0f0f0f' strokeWidth={2} strokeLinecap='round' />
      <line x1={0} y1={0} x2={7} y2={4} stroke='#0f0f0f' strokeWidth={1.5} strokeLinecap='round' />
      <circle cx={0} cy={0} r={1.5} fill='#0f0f0f' />
    </g>
  </g>
);

/** Central fireplace with GODS EYE SERVER sign above — click to stoke the fire */
const Fireplace: React.FC<{ stoked: boolean; onStoke: () => void }> = ({ stoked, onStoke }) => (
  <g transform={`translate(${ROOM_W / 2 - 90}, 110)`} style={{ cursor: 'pointer' }} onClick={onStoke}>
    {/* Stone fireplace surround */}
    <rect x={0} y={50} width={180} height={140} fill='#64748b' shapeRendering='crispEdges' />
    {/* Stone pattern */}
    {[0, 1, 2, 3, 4].map((r) => (
      <g key={`fs-${r}`}>
        {[0, 1, 2].map((c) => {
          const x = c * 60 + (r % 2 === 0 ? 0 : 30);
          const y = 50 + r * 28;
          return (
            <g key={`fs-${r}-${c}`}>
              <rect x={x} y={y} width={60} height={26} fill='none' stroke='#334155' strokeWidth={1.5} shapeRendering='crispEdges' />
              <rect x={x + 6} y={y + 6} width={3} height={2} fill='#475569' shapeRendering='crispEdges' />
              <rect x={x + 40} y={y + 12} width={3} height={3} fill='#475569' shapeRendering='crispEdges' />
            </g>
          );
        })}
      </g>
    ))}
    {/* Fireplace opening (arch) */}
    <rect x={50} y={110} width={80} height={70} fill='#0a0a0a' shapeRendering='crispEdges' />
    <rect x={50} y={110} width={80} height={4} fill='#000' shapeRendering='crispEdges' />
    {/* Logs */}
    <rect x={58} y={160} width={64} height={8} fill='#6b4423' shapeRendering='crispEdges' />
    <rect x={58} y={160} width={64} height={2} fill='#8b5a2b' shapeRendering='crispEdges' />
    <rect x={56} y={164} width={4} height={4} fill='#3a2410' shapeRendering='crispEdges' />
    <rect x={120} y={164} width={4} height={4} fill='#3a2410' shapeRendering='crispEdges' />
    <rect x={64} y={152} width={52} height={8} fill='#5a3a17' shapeRendering='crispEdges' />
    <rect x={64} y={152} width={52} height={2} fill='#78350f' shapeRendering='crispEdges' />
    {/* Fire glow */}
    <ellipse cx={90} cy={160} rx={stoked ? 56 : 40} ry={stoked ? 18 : 12} fill='#f59e0b' opacity={stoked ? 0.8 : 0.5}>
      <animate attributeName='opacity' values='0.4;0.7;0.4' dur='1.8s' repeatCount='indefinite' />
    </ellipse>
    {/* Flames */}
    <g
      style={{ animation: 'pixel-flame 0.4s steps(2) infinite' }}
      transform={stoked ? 'translate(0, -8) scale(1, 1.4)' : undefined}
    >
      {/* Main flame */}
      <polygon points='80,158 86,140 90,150 94,138 98,152 104,158' fill='#f97316' shapeRendering='crispEdges' />
      <polygon points='84,156 88,146 92,152 96,144 100,156' fill='#facc15' shapeRendering='crispEdges' />
      <polygon points='86,154 90,148 94,154' fill='#fde047' shapeRendering='crispEdges' />
      {/* Smaller flames */}
      <polygon points='68,158 72,148 76,158' fill='#f97316' shapeRendering='crispEdges' />
      <polygon points='108,158 112,148 116,158' fill='#f97316' shapeRendering='crispEdges' />
      {/* Extra sparks when stoked */}
      {stoked && (
        <>
          <rect x={74} y={130} width={2} height={2} fill='#fde047' shapeRendering='crispEdges' />
          <rect x={108} y={132} width={2} height={2} fill='#fde047' shapeRendering='crispEdges' />
          <rect x={90} y={124} width={2} height={2} fill='#fbbf24' shapeRendering='crispEdges' />
        </>
      )}
    </g>
    {/* Mantle */}
    <rect x={-10} y={100} width={200} height={10} fill='#8b5a2b' shapeRendering='crispEdges' />
    <rect x={-10} y={100} width={200} height={2} fill='#b07a46' shapeRendering='crispEdges' />
    <rect x={-10} y={108} width={200} height={2} fill='#4a2e17' shapeRendering='crispEdges' />
    {/* Mantle decorations: candle */}
    <g transform='translate(12, 84)'>
      <rect x={0} y={6} width={6} height={10} fill='#f1f5f9' shapeRendering='crispEdges' />
      <rect x={2} y={0} width={2} height={6} fill='#fde047' shapeRendering='crispEdges' />
      <rect x={2} y={-3} width={2} height={3} fill='#f97316' shapeRendering='crispEdges'>
        <animate attributeName='fill' values='#f97316;#fbbf24;#f97316' dur='0.6s' repeatCount='indefinite' />
      </rect>
    </g>
    {/* Mantle: book */}
    <g transform='translate(152, 88)'>
      <rect x={0} y={0} width={20} height={12} fill='#7f1d1d' shapeRendering='crispEdges' />
      <rect x={0} y={0} width={20} height={2} fill='#b91c1c' shapeRendering='crispEdges' />
      <rect x={0} y={10} width={20} height={2} fill='#450a0a' shapeRendering='crispEdges' />
      <rect x={4} y={4} width={12} height={4} fill='#fde047' shapeRendering='crispEdges' />
    </g>
    {/* Mantle: small plant */}
    <g transform='translate(128, 78)'>
      <rect x={0} y={14} width={12} height={8} fill='#78350f' shapeRendering='crispEdges' />
      <rect x={0} y={14} width={12} height={1} fill='#92400e' shapeRendering='crispEdges' />
      <rect x={1} y={6} width={10} height={8} fill='#15803d' shapeRendering='crispEdges' />
      <rect x={3} y={2} width={6} height={6} fill='#22c55e' shapeRendering='crispEdges' />
      <rect x={4} y={0} width={4} height={3} fill='#4ade80' shapeRendering='crispEdges' />
    </g>

    {/* GODS EYE SERVER wooden sign above the mantle */}
    <g transform='translate(-16, -8)'>
      {/* Rope */}
      <line x1={20} y1={-8} x2={30} y2={6} stroke='#3a2410' strokeWidth={2} />
      <line x1={192} y1={-8} x2={182} y2={6} stroke='#3a2410' strokeWidth={2} />
      {/* Wooden plank */}
      <rect x={6} y={4} width={200} height={46} fill='#8b5a2b' shapeRendering='crispEdges' />
      <rect x={6} y={4} width={200} height={3} fill='#b07a46' shapeRendering='crispEdges' />
      <rect x={6} y={47} width={200} height={3} fill='#4a2e17' shapeRendering='crispEdges' />
      <rect x={6} y={4} width={3} height={46} fill='#6b4423' shapeRendering='crispEdges' />
      <rect x={203} y={4} width={3} height={46} fill='#6b4423' shapeRendering='crispEdges' />
      {/* Wood grain */}
      <rect x={12} y={16} width={188} height={1} fill='#6b4423' shapeRendering='crispEdges' />
      <rect x={20} y={38} width={180} height={1} fill='#6b4423' shapeRendering='crispEdges' />
      {/* Nails */}
      <rect x={10} y={8} width={3} height={3} fill='#27272a' shapeRendering='crispEdges' />
      <rect x={199} y={8} width={3} height={3} fill='#27272a' shapeRendering='crispEdges' />
      <rect x={10} y={42} width={3} height={3} fill='#27272a' shapeRendering='crispEdges' />
      <rect x={199} y={42} width={3} height={3} fill='#27272a' shapeRendering='crispEdges' />
      {/* Burnt-in text */}
      <text
        x={106}
        y={33}
        textAnchor='middle'
        fontFamily='ui-monospace, "Courier New", monospace'
        fontSize={20}
        fontWeight='900'
        fill='#3a2410'
        letterSpacing='2'
      >
        GODS EYE SERVER
      </text>
    </g>
  </g>
);

/** Cozy armchair */
const Armchair: React.FC<{ x: number; y: number }> = ({ x, y }) => (
  <g transform={`translate(${x}, ${y})`}>
    {/* Back cushion */}
    <rect x={4} y={0} width={56} height={36} fill='#d4c5a0' shapeRendering='crispEdges' />
    <rect x={4} y={0} width={56} height={4} fill='#e8dbb8' shapeRendering='crispEdges' />
    <rect x={4} y={32} width={56} height={4} fill='#a89775' shapeRendering='crispEdges' />
    {/* Arms */}
    <rect x={0} y={8} width={8} height={36} fill='#c9b68e' shapeRendering='crispEdges' />
    <rect x={56} y={8} width={8} height={36} fill='#c9b68e' shapeRendering='crispEdges' />
    <rect x={0} y={8} width={8} height={2} fill='#e8dbb8' shapeRendering='crispEdges' />
    <rect x={56} y={8} width={8} height={2} fill='#e8dbb8' shapeRendering='crispEdges' />
    {/* Seat cushion */}
    <rect x={8} y={26} width={48} height={24} fill='#d4c5a0' shapeRendering='crispEdges' />
    <rect x={8} y={26} width={48} height={3} fill='#e8dbb8' shapeRendering='crispEdges' />
    <rect x={8} y={47} width={48} height={3} fill='#a89775' shapeRendering='crispEdges' />
    {/* Cushion detail (X stitching) */}
    <line x1={22} y1={34} x2={32} y2={44} stroke='#a89775' strokeWidth={1} />
    <line x1={32} y1={34} x2={22} y2={44} stroke='#a89775' strokeWidth={1} />
    {/* Throw pillow */}
    <rect x={14} y={28} width={14} height={12} fill='#b91c1c' shapeRendering='crispEdges' />
    <rect x={14} y={28} width={14} height={2} fill='#dc2626' shapeRendering='crispEdges' />
    <rect x={14} y={38} width={14} height={2} fill='#7f1d1d' shapeRendering='crispEdges' />
    {/* Feet */}
    <rect x={2} y={48} width={4} height={4} fill='#4a2e17' shapeRendering='crispEdges' />
    <rect x={58} y={48} width={4} height={4} fill='#4a2e17' shapeRendering='crispEdges' />
  </g>
);

/** Coffee table with decorations */
const CoffeeTable: React.FC<{ x: number; y: number }> = ({ x, y }) => (
  <g transform={`translate(${x}, ${y})`}>
    {/* Table top */}
    <rect x={0} y={0} width={80} height={40} fill='#6b4423' shapeRendering='crispEdges' />
    <rect x={0} y={0} width={80} height={3} fill='#8b5a2b' shapeRendering='crispEdges' />
    <rect x={0} y={37} width={80} height={3} fill='#3a2410' shapeRendering='crispEdges' />
    {/* Table legs */}
    <rect x={0} y={40} width={4} height={6} fill='#3a2410' shapeRendering='crispEdges' />
    <rect x={76} y={40} width={4} height={6} fill='#3a2410' shapeRendering='crispEdges' />
    {/* Espresso machine */}
    <g transform='translate(6, 4)'>
      <rect x={0} y={0} width={20} height={22} fill='#334155' shapeRendering='crispEdges' />
      <rect x={0} y={0} width={20} height={3} fill='#475569' shapeRendering='crispEdges' />
      <rect x={0} y={20} width={20} height={2} fill='#1e293b' shapeRendering='crispEdges' />
      {/* Portafilter */}
      <rect x={6} y={10} width={8} height={6} fill='#1a1a1a' shapeRendering='crispEdges' />
      <rect x={7} y={16} width={6} height={4} fill='#6b4423' shapeRendering='crispEdges' />
      {/* Steam */}
      <rect x={4} y={-3} width={1} height={3} fill='#cbd5e1' opacity={0.4} shapeRendering='crispEdges' />
      <rect x={14} y={-3} width={1} height={3} fill='#cbd5e1' opacity={0.4} shapeRendering='crispEdges' />
      {/* Lights */}
      <rect x={16} y={4} width={2} height={2} fill='#22c55e' shapeRendering='crispEdges' />
      <rect x={16} y={8} width={2} height={2} fill='#f59e0b' shapeRendering='crispEdges' />
    </g>
    {/* Coffee mug with FRIENDS label */}
    <g transform='translate(34, 12)'>
      <rect x={0} y={2} width={14} height={16} fill='#f1f5f9' shapeRendering='crispEdges' />
      <rect x={0} y={2} width={14} height={2} fill='#e2e8f0' shapeRendering='crispEdges' />
      <rect x={14} y={6} width={2} height={8} fill='#f1f5f9' shapeRendering='crispEdges' />
      <rect x={2} y={4} width={10} height={3} fill='#78350f' shapeRendering='crispEdges' />
      <rect x={2} y={10} width={10} height={4} fill='#7f1d1d' shapeRendering='crispEdges' />
      <text x={7} y={13.5} textAnchor='middle' fontFamily='monospace' fontSize={5} fontWeight='bold' fill='#fde047'>
        G E
      </text>
    </g>
    {/* Tiny plant */}
    <g transform='translate(56, 8)'>
      <rect x={0} y={10} width={10} height={8} fill='#78350f' shapeRendering='crispEdges' />
      <rect x={0} y={10} width={10} height={1} fill='#92400e' shapeRendering='crispEdges' />
      <rect x={1} y={4} width={8} height={6} fill='#15803d' shapeRendering='crispEdges' />
      <rect x={2} y={0} width={6} height={4} fill='#22c55e' shapeRendering='crispEdges' />
    </g>
  </g>
);

/** Large potted plant (floor) */
const FloorPlant: React.FC<{ x: number; y: number; variant?: 'tall' | 'bushy' }> = ({ x, y, variant = 'tall' }) => (
  <g transform={`translate(${x}, ${y})`}>
    {/* Pot */}
    <polygon points='0,30 4,52 32,52 36,30' fill='#a0522d' shapeRendering='crispEdges' />
    <rect x={0} y={28} width={36} height={4} fill='#78350f' shapeRendering='crispEdges' />
    <rect x={0} y={28} width={36} height={1} fill='#92400e' shapeRendering='crispEdges' />
    {/* Dirt */}
    <rect x={2} y={28} width={32} height={2} fill='#3a2410' shapeRendering='crispEdges' />
    {/* Foliage */}
    {variant === 'tall' ? (
      <>
        {/* Thick tall plant like monstera */}
        <rect x={10} y={-20} width={3} height={48} fill='#166534' shapeRendering='crispEdges' />
        <rect x={22} y={-10} width={3} height={38} fill='#166534' shapeRendering='crispEdges' />
        {/* Leaves */}
        <polygon points='4,-10 18,-20 24,-8' fill='#15803d' shapeRendering='crispEdges' />
        <polygon points='12,-20 20,-28 26,-18' fill='#16a34a' shapeRendering='crispEdges' />
        <polygon points='20,-4 32,-12 34,2' fill='#15803d' shapeRendering='crispEdges' />
        <polygon points='-2,6 14,0 10,16' fill='#16a34a' shapeRendering='crispEdges' />
        <polygon points='24,14 38,8 34,24' fill='#15803d' shapeRendering='crispEdges' />
        <polygon points='2,-20 8,-26 14,-18' fill='#22c55e' shapeRendering='crispEdges' />
      </>
    ) : (
      <>
        {/* Bushy round plant */}
        <rect x={4} y={8} width={28} height={24} fill='#166534' shapeRendering='crispEdges' />
        <rect x={2} y={14} width={32} height={16} fill='#15803d' shapeRendering='crispEdges' />
        <rect x={6} y={2} width={24} height={14} fill='#16a34a' shapeRendering='crispEdges' />
        <rect x={10} y={-2} width={16} height={10} fill='#22c55e' shapeRendering='crispEdges' />
        <rect x={12} y={-6} width={12} height={6} fill='#4ade80' shapeRendering='crispEdges' />
        {/* Leaf highlights */}
        <rect x={6} y={4} width={2} height={2} fill='#4ade80' shapeRendering='crispEdges' />
        <rect x={20} y={10} width={2} height={2} fill='#4ade80' shapeRendering='crispEdges' />
        <rect x={26} y={18} width={2} height={2} fill='#22c55e' shapeRendering='crispEdges' />
      </>
    )}
  </g>
);

/** Tall bookshelf */
const Bookshelf: React.FC<{ x: number; y: number }> = ({ x, y }) => {
  const shelfColors = ['#7f1d1d', '#1e3a8a', '#14532d', '#78350f', '#581c87', '#064e3b', '#b45309', '#be123c', '#365314'];
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Cabinet frame */}
      <rect x={0} y={0} width={90} height={140} fill='#6b4423' shapeRendering='crispEdges' />
      <rect x={0} y={0} width={90} height={4} fill='#8b5a2b' shapeRendering='crispEdges' />
      <rect x={0} y={136} width={90} height={4} fill='#3a2410' shapeRendering='crispEdges' />
      <rect x={0} y={0} width={4} height={140} fill='#8b5a2b' shapeRendering='crispEdges' />
      <rect x={86} y={0} width={4} height={140} fill='#3a2410' shapeRendering='crispEdges' />
      {/* Interior */}
      <rect x={4} y={4} width={82} height={132} fill='#3a2410' shapeRendering='crispEdges' />
      {/* Shelf dividers */}
      <rect x={4} y={38} width={82} height={2} fill='#5a3a17' shapeRendering='crispEdges' />
      <rect x={4} y={72} width={82} height={2} fill='#5a3a17' shapeRendering='crispEdges' />
      <rect x={4} y={106} width={82} height={2} fill='#5a3a17' shapeRendering='crispEdges' />
      {/* Books per shelf */}
      {[6, 40, 74, 108].map((shelfY, shelfIdx) => (
        <g key={`sh-${shelfIdx}`}>
          {Array.from({ length: 9 }).map((_, bi) => {
            const color = shelfColors[(shelfIdx * 3 + bi) % shelfColors.length];
            const h = 26 + ((bi + shelfIdx) % 3) * 2;
            return (
              <g key={`b-${shelfIdx}-${bi}`}>
                <rect x={6 + bi * 9} y={shelfY + (30 - h)} width={8} height={h} fill={color} shapeRendering='crispEdges' />
                <rect x={6 + bi * 9} y={shelfY + (30 - h)} width={8} height={2} fill='#fde047' shapeRendering='crispEdges' opacity={0.4} />
                <rect x={6 + bi * 9} y={shelfY + 28} width={8} height={2} fill='#fde047' shapeRendering='crispEdges' opacity={0.4} />
              </g>
            );
          })}
        </g>
      ))}
      {/* Top decor: small plant */}
      <rect x={66} y={-12} width={16} height={12} fill='#78350f' shapeRendering='crispEdges' />
      <rect x={68} y={-20} width={12} height={10} fill='#15803d' shapeRendering='crispEdges' />
      <rect x={70} y={-24} width={8} height={6} fill='#22c55e' shapeRendering='crispEdges' />
    </g>
  );
};

/** Sleeping (clickable!) cat mascot — click it to make it meow */
const SleepingCat: React.FC<{ x: number; y: number; meowing: boolean; onClick: () => void }> = ({
  x,
  y,
  meowing,
  onClick,
}) => (
  <g transform={`translate(${x}, ${y})`} style={{ cursor: 'pointer' }} onClick={onClick}>
    {/* Basket */}
    <ellipse cx={20} cy={18} rx={22} ry={6} fill='#78350f' />
    <ellipse cx={20} cy={16} rx={22} ry={6} fill='#92400e' />
    <ellipse cx={20} cy={14} rx={20} ry={5} fill='#6b4423' />
    {/* Cat curled */}
    <ellipse cx={20} cy={10} rx={18} ry={8} fill='#f59e0b'>
      {meowing && <animate attributeName='ry' values='8;9;8' dur='0.3s' repeatCount='6' />}
    </ellipse>
    <ellipse cx={20} cy={10} rx={18} ry={8} fill='none' stroke='#d97706' strokeWidth={1} />
    {/* Stripes */}
    <rect x={8} y={6} width={8} height={2} fill='#b45309' shapeRendering='crispEdges' />
    <rect x={20} y={4} width={8} height={2} fill='#b45309' shapeRendering='crispEdges' />
    <rect x={30} y={10} width={6} height={2} fill='#b45309' shapeRendering='crispEdges' />
    {/* Head */}
    <circle cx={36} cy={10} r={5} fill='#f59e0b' />
    <polygon points='33,6 34,2 36,6' fill='#f59e0b' />
    <polygon points='38,6 40,2 41,6' fill='#f59e0b' />
    {/* Eyes — open when meowing, closed when sleeping */}
    {meowing ? (
      <>
        <circle cx={35} cy={10} r={1} fill='#0a0a0a' />
        <circle cx={38} cy={10} r={1} fill='#0a0a0a' />
      </>
    ) : (
      <>
        <path d='M 34 10 Q 35 11 36 10' stroke='#3a2410' strokeWidth={1} fill='none' />
        <path d='M 37 10 Q 38 11 39 10' stroke='#3a2410' strokeWidth={1} fill='none' />
      </>
    )}
    {/* Nose */}
    <circle cx={36.5} cy={12} r={0.6} fill='#7f1d1d' />
    {/* Z's or MEOW */}
    {meowing ? (
      <g style={{ animation: 'pixel-bubble-float 0.4s ease-in-out infinite' }}>
        <rect x={44} y={-10} width={34} height={14} rx={2} fill='#fef3c7' stroke='#b45309' strokeWidth={1} shapeRendering='crispEdges' />
        <text x={61} y={0} textAnchor='middle' fontFamily='monospace' fontSize={9} fontWeight='bold' fill='#b45309'>
          MEOW!
        </text>
        <polygon points='46,4 48,0 50,2' fill='#fef3c7' stroke='#b45309' strokeWidth={1} />
      </g>
    ) : (
      <g style={{ animation: 'pixel-bubble-float 2.5s ease-in-out infinite' }}>
        <text x={44} y={4} fontFamily='monospace' fontSize={8} fontWeight='bold' fill='#cbd5e1'>z</text>
        <text x={48} y={-2} fontFamily='monospace' fontSize={10} fontWeight='bold' fill='#cbd5e1'>Z</text>
      </g>
    )}
  </g>
);

/** Floor lamp */
const FloorLamp: React.FC<{ x: number; y: number }> = ({ x, y }) => (
  <g transform={`translate(${x}, ${y})`}>
    {/* Base */}
    <rect x={0} y={50} width={12} height={4} fill='#27272a' shapeRendering='crispEdges' />
    <rect x={1} y={49} width={10} height={1} fill='#52525b' shapeRendering='crispEdges' />
    {/* Pole */}
    <rect x={5} y={16} width={2} height={34} fill='#52525b' shapeRendering='crispEdges' />
    {/* Shade */}
    <polygon points='-4,16 6,0 16,16' fill='#d97706' shapeRendering='crispEdges' />
    <polygon points='-4,16 16,16 14,18 -2,18' fill='#b45309' shapeRendering='crispEdges' />
    {/* Glow */}
    <ellipse cx={6} cy={24} rx={14} ry={8} fill='#fbbf24' opacity={0.25} />
    <ellipse cx={6} cy={24} rx={8} ry={5} fill='#fde047' opacity={0.2} />
  </g>
);

/* ───────────── Main component ───────────── */

const PixelOfficeView: React.FC<Props> = ({ agents, statusMap, onAgentClick }) => {
  const activeCount = useMemo(
    () => agents.filter((a) => (statusMap.get(a.slotId)?.status ?? a.status) === 'active').length,
    [agents, statusMap]
  );
  const pendingCount = useMemo(
    () => agents.filter((a) => (statusMap.get(a.slotId)?.status ?? a.status) === 'pending').length,
    [agents, statusMap]
  );

  // ── Gamification state ─────────────────────────────────────────────
  /** Per-agent XP (accrued while status === 'active'). Persisted across re-renders via ref. */
  const [xpMap, setXpMap] = useState<Record<string, number>>({});
  /** Cat meow animation (transient) */
  const [catMeowing, setCatMeowing] = useState(false);
  /** Fireplace stoke boost (transient) */
  const [fireStoked, setFireStoked] = useState(false);
  /** +XP flyout animations */
  const [xpFlyouts, setXpFlyouts] = useState<Array<{ id: number; slotId: string; amount: number }>>([]);
  const xpFlyoutIdRef = useRef(0);

  // Tick XP every second for each active agent
  const statusMapRef = useRef(statusMap);
  statusMapRef.current = statusMap;
  const fireStokedRef = useRef(fireStoked);
  fireStokedRef.current = fireStoked;

  useEffect(() => {
    const interval = setInterval(() => {
      setXpMap((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const agent of agents) {
          const s = statusMapRef.current.get(agent.slotId)?.status ?? agent.status;
          if (s === 'active') {
            const boost = fireStokedRef.current ? 3 : 1;
            next[agent.slotId] = (prev[agent.slotId] ?? 0) + boost;
            changed = true;
          } else if (s === 'completed' && !(agent.slotId in prev)) {
            // Completed agents that never accrued XP get a one-time 50 bonus
            next[agent.slotId] = 50;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [agents]);

  // Burst XP flyouts on completion
  const prevStatusRef = useRef<Record<string, TeammateStatus>>({});
  useEffect(() => {
    for (const agent of agents) {
      const s = statusMap.get(agent.slotId)?.status ?? agent.status;
      const prev = prevStatusRef.current[agent.slotId];
      if (s === 'completed' && prev && prev !== 'completed') {
        const bonus = 25;
        setXpMap((m) => ({ ...m, [agent.slotId]: (m[agent.slotId] ?? 0) + bonus }));
        const id = ++xpFlyoutIdRef.current;
        setXpFlyouts((f) => [...f, { id, slotId: agent.slotId, amount: bonus }]);
        window.setTimeout(() => {
          setXpFlyouts((f) => f.filter((x) => x.id !== id));
        }, 1400);
      }
      prevStatusRef.current[agent.slotId] = s;
    }
  }, [agents, statusMap]);

  const handleCatMeow = useCallback(() => {
    setCatMeowing(true);
    window.setTimeout(() => setCatMeowing(false), 1800);
  }, []);

  const handleStokeFire = useCallback(() => {
    setFireStoked(true);
    window.setTimeout(() => setFireStoked(false), 4000);
  }, []);

  // Team-level stats
  const totalXp = useMemo(
    () => Object.values(xpMap).reduce((a, b) => a + b, 0),
    [xpMap]
  );
  const teamLevel = Math.floor(totalXp / 500) + 1;
  const teamXpIntoLevel = totalXp % 500;

  const stationsToShow = Math.max(agents.length, Math.min(6, DESK_POSITIONS.length));

  return (
    <div className='flex flex-col h-full overflow-hidden' style={{ background: '#0b0e18' }}>
      {/* Header */}
      <div
        className='flex items-center justify-between px-16px py-10px border-b border-[var(--color-border)]'
        style={{ background: '#1a1f2e' }}
      >
        <div className='flex items-center gap-12px'>
          <span
            className='text-14px font-semibold'
            style={{ color: '#fde68a', fontFamily: 'ui-monospace, "Cascadia Code", monospace' }}
          >
            ▸ GODS EYE SERVER
          </span>
          <span className='text-12px' style={{ color: '#94a3b8', fontFamily: 'ui-monospace, monospace' }}>
            [{agents.length} agent{agents.length !== 1 ? 's' : ''} in the lodge]
          </span>
        </div>
        <div className='flex items-center gap-16px text-12px' style={{ fontFamily: 'ui-monospace, monospace' }}>
          {/* Team level + XP bar */}
          <div className='flex items-center gap-6px'>
            <span
              className='px-6px py-2px text-11px font-bold'
              style={{ background: '#fbbf24', color: '#0a0a0a' }}
            >
              LVL {teamLevel}
            </span>
            <div className='relative' style={{ width: 80, height: 8, background: '#0f172a' }}>
              <div
                style={{
                  width: `${(teamXpIntoLevel / 500) * 100}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #4ade80, #fbbf24)',
                  transition: 'width 300ms ease',
                }}
              />
            </div>
            <span style={{ color: '#fde68a' }}>{totalXp} XP</span>
          </div>
          {fireStoked && (
            <span style={{ color: '#f97316', animation: 'pixel-blink 0.5s steps(2) infinite' }}>
              🔥 x3 XP BOOST
            </span>
          )}
          {activeCount > 0 && (
            <div className='flex items-center gap-4px'>
              <span className='w-8px h-8px' style={{ background: '#22c55e', animation: 'pixel-blink 0.8s steps(2) infinite' }} />
              <span style={{ color: '#4ade80' }}>{activeCount} WORKING</span>
            </div>
          )}
          {pendingCount > 0 && (
            <div className='flex items-center gap-4px'>
              <span className='w-8px h-8px' style={{ background: '#f59e0b', animation: 'pixel-blink 0.8s steps(2) infinite' }} />
              <span style={{ color: '#fbbf24' }}>{pendingCount} BOOTING</span>
            </div>
          )}
        </div>
      </div>

      {/* Scene */}
      <div className='relative flex-1 min-h-0 overflow-auto p-8px flex items-center justify-center'>
        <svg
          viewBox={`0 0 ${ROOM_W} ${ROOM_H}`}
          preserveAspectRatio='xMidYMid meet'
          style={{
            imageRendering: 'pixelated',
            width: '100%',
            height: '100%',
            maxHeight: '100%',
            display: 'block',
          }}
        >
          <defs>
            <clipPath id='room-clip'>
              <rect x={0} y={0} width={ROOM_W} height={ROOM_H} />
            </clipPath>
          </defs>

          {/* Floor */}
          <WoodenFloor />

          {/* Back wall with windows/frames/clock */}
          <BackWall />

          {/* Central fireplace + GODS EYE SERVER sign (click to stoke!) */}
          <Fireplace stoked={fireStoked} onStoke={handleStokeFire} />

          {/* Center cozy zone (below fireplace) — armchair + coffee table */}
          <Armchair x={ROOM_W / 2 - 32} y={320} />
          <CoffeeTable x={ROOM_W / 2 - 40} y={400} />

          {/* Sleeping cat — click it to meow */}
          <SleepingCat x={ROOM_W / 2 + 90} y={340} meowing={catMeowing} onClick={handleCatMeow} />

          {/* Floor lamps — flanking the armchair */}
          <FloorLamp x={ROOM_W / 2 - 100} y={328} />
          <FloorLamp x={ROOM_W / 2 + 74} y={328} />

          {/* Bookshelves — BELOW the cozy zone, inside the center column */}
          <Bookshelf x={ROOM_W / 2 - 100} y={470} />
          <Bookshelf x={ROOM_W / 2 + 10} y={470} />

          {/* Floor plants — flanking the bookshelves inside the center column */}
          <FloorPlant x={ROOM_W / 2 - 140} y={650} variant='tall' />
          <FloorPlant x={ROOM_W / 2 + 100} y={650} variant='bushy' />

          {/* Agent workstations */}
          {DESK_POSITIONS.slice(0, stationsToShow).map((pos, idx) => {
            const agent = agents[idx];
            if (agent) {
              const status = statusMap.get(agent.slotId)?.status ?? agent.status;
              const xp = xpMap[agent.slotId] ?? 0;
              const level = Math.floor(xp / 100) + 1;
              return (
                <AgentWorkstation
                  key={agent.slotId}
                  agent={agent}
                  status={status}
                  position={pos}
                  xp={xp}
                  level={level}
                  onClick={() => onAgentClick?.(agent.slotId)}
                />
              );
            }
            return <EmptyWorkstation key={`empty-${idx}`} position={pos} />;
          })}

          {/* XP +N flyouts on completion */}
          {xpFlyouts.map((fly) => {
            const idx = agents.findIndex((a) => a.slotId === fly.slotId);
            if (idx < 0 || idx >= DESK_POSITIONS.length) return null;
            const pos = DESK_POSITIONS[idx];
            return (
              <g key={fly.id} transform={`translate(${pos.x + DESK_W / 2}, ${pos.y + 60})`} style={{ pointerEvents: 'none' }}>
                <g style={{ animation: 'pixel-xp-flyout 1.4s ease-out forwards' }}>
                  <rect x={-22} y={-10} width={44} height={16} rx={2} fill='#22c55e' shapeRendering='crispEdges' />
                  <text
                    x={0}
                    y={2}
                    textAnchor='middle'
                    fontFamily='ui-monospace, monospace'
                    fontSize={11}
                    fontWeight='bold'
                    fill='#062d17'
                  >
                    +{fly.amount} XP
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Status bar */}
      <div
        className='flex items-center justify-between px-16px py-6px border-t border-[var(--color-border)]'
        style={{ background: '#1a1f2e', fontFamily: 'ui-monospace, monospace' }}
      >
        <span className='text-11px' style={{ color: '#78716c' }}>
          CLICK AN AGENT · CLICK THE CAT FOR MEOW · CLICK THE FIREPLACE TO STOKE FOR 3× XP
        </span>
        <span className='text-11px' style={{ color: '#78716c' }}>
          ♛ GODS EYE SERVER · COZY LODGE EDITION
        </span>
      </div>

      <style>{`
        @keyframes pixel-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }
        @keyframes pixel-bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-2px); }
        }
        @keyframes pixel-type {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-1px); }
        }
        @keyframes pixel-screen-flicker {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }
        @keyframes pixel-bubble-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-2px); }
        }
        @keyframes pixel-flame {
          0%, 100% { transform: translateY(0) scaleY(1); }
          50% { transform: translateY(-1px) scaleY(1.08); }
        }
        @keyframes pixel-steam {
          0% { transform: translateY(0); opacity: 0.6; }
          100% { transform: translateY(-10px); opacity: 0; }
        }
        @keyframes pixel-xp-flyout {
          0%   { transform: translateY(0); opacity: 0; }
          15%  { opacity: 1; }
          100% { transform: translateY(-40px); opacity: 0; }
        }
        .ws-hover { transition: stroke 140ms ease; }
        g[style*="cursor: pointer"]:hover .ws-hover {
          stroke: rgba(251,191,36,0.85);
        }
      `}</style>
    </div>
  );
};

export default PixelOfficeView;
