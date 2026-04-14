import React, { useMemo } from 'react';
import type { TeamAgent, TeammateStatus } from '@/common/types/teamTypes';
import { getAgentLogo } from '@renderer/utils/model/agentLogo';
import type { AgentStatusInfo } from '../hooks/useTeamSession';

type Props = {
  agents: TeamAgent[];
  statusMap: Map<string, AgentStatusInfo>;
  onAgentClick?: (slotId: string) => void;
};

const STATUS_LABELS: Record<TeammateStatus, string> = {
  pending: 'Starting up...',
  idle: 'Idle',
  active: 'Working',
  completed: 'Done',
  failed: 'Offline',
};

const STATUS_GLOW: Record<TeammateStatus, string> = {
  pending: 'rgba(255,165,0,0.3)',
  idle: 'rgba(130,130,130,0.15)',
  active: 'rgba(34,197,94,0.4)',
  completed: 'rgba(130,130,130,0.15)',
  failed: 'rgba(239,68,68,0.3)',
};

/** Desk positions in a virtual office grid (max 12 positions) */
const DESK_POSITIONS = [
  // Row 1 — left side
  { x: 12, y: 18, rotation: 0 },
  { x: 38, y: 18, rotation: 0 },
  { x: 64, y: 18, rotation: 0 },
  // Row 1 — right side
  { x: 88, y: 18, rotation: 0 },
  // Row 2
  { x: 12, y: 50, rotation: 0 },
  { x: 38, y: 50, rotation: 0 },
  { x: 64, y: 50, rotation: 0 },
  { x: 88, y: 50, rotation: 0 },
  // Row 3
  { x: 12, y: 82, rotation: 0 },
  { x: 38, y: 82, rotation: 0 },
  { x: 64, y: 82, rotation: 0 },
  { x: 88, y: 82, rotation: 0 },
];

/** Single agent desk in the office */
const AgentDesk: React.FC<{
  agent: TeamAgent;
  status: TeammateStatus;
  position: { x: number; y: number };
  onClick?: () => void;
}> = ({ agent, status, position, onClick }) => {
  const logo = getAgentLogo(agent.agentType);
  const isActive = status === 'active';
  const isPending = status === 'pending';
  const isFailed = status === 'failed';
  const isLead = agent.role === 'lead';
  const glowColor = STATUS_GLOW[status];

  return (
    <div
      className='absolute flex flex-col items-center cursor-pointer transition-all duration-300 hover:scale-105 group'
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        transform: 'translate(-50%, -50%)',
        zIndex: isActive ? 3 : 1,
      }}
      onClick={onClick}
    >
      {/* Desk surface */}
      <div
        className='relative flex flex-col items-center gap-4px'
        style={{
          filter: isFailed ? 'grayscale(0.7) opacity(0.5)' : undefined,
        }}
      >
        {/* Agent avatar with status ring */}
        <div
          className='relative w-48px h-48px rd-full flex items-center justify-center transition-all duration-500'
          style={{
            background: 'var(--color-bg-2)',
            border: `2.5px solid ${isActive ? 'var(--color-success-6)' : isFailed ? 'var(--color-danger-6)' : isPending ? 'var(--warning)' : 'var(--color-border-2)'}`,
            boxShadow: `0 0 ${isActive ? '16px' : '6px'} ${glowColor}`,
            animation: isActive ? 'office-pulse 2s ease-in-out infinite' : isPending ? 'office-pending 1.5s ease-in-out infinite' : undefined,
          }}
        >
          {logo ? (
            <img src={logo} alt={agent.agentType} className='w-24px h-24px object-contain rd-4px' />
          ) : (
            <span className='text-16px font-bold text-[var(--color-text-2)]'>
              {agent.agentName.charAt(0).toUpperCase()}
            </span>
          )}
          {/* Lead crown */}
          {isLead && (
            <div className='absolute -top-8px -right-4px'>
              <svg width='16' height='16' viewBox='0 0 16 16' fill='none'>
                <path
                  d='M2.3 13L1.2 4.7L4.8 6.5L8 2.1L11.2 6.5L14.8 4.7L13.7 13H2.3Z'
                  strokeWidth='1.25'
                  strokeLinejoin='round'
                  style={{ fill: 'var(--warning)', stroke: 'var(--text-primary)' }}
                />
              </svg>
            </div>
          )}
          {/* Typing animation for active agents */}
          {isActive && (
            <div className='absolute -bottom-2px left-1/2 -translate-x-1/2 flex gap-2px'>
              <span className='w-4px h-4px rd-full bg-[var(--color-success-6)]' style={{ animation: 'office-typing 1s ease-in-out infinite' }} />
              <span className='w-4px h-4px rd-full bg-[var(--color-success-6)]' style={{ animation: 'office-typing 1s ease-in-out 0.2s infinite' }} />
              <span className='w-4px h-4px rd-full bg-[var(--color-success-6)]' style={{ animation: 'office-typing 1s ease-in-out 0.4s infinite' }} />
            </div>
          )}
        </div>

        {/* Desk / Monitor */}
        <div
          className='relative w-56px h-32px rd-4px flex items-center justify-center overflow-hidden'
          style={{
            background: isActive
              ? 'linear-gradient(135deg, var(--color-primary-1), var(--color-primary-2))'
              : isFailed
                ? 'var(--color-fill-1)'
                : 'var(--color-fill-2)',
            border: '1px solid var(--color-border-2)',
          }}
        >
          {/* Screen content indicator */}
          {isActive ? (
            <div className='flex flex-col gap-2px w-full px-6px'>
              <div className='h-2px rd-1px bg-[var(--color-primary-5)] w-full' style={{ animation: 'office-line 2s ease-in-out infinite' }} />
              <div className='h-2px rd-1px bg-[var(--color-primary-4)] w-75%' style={{ animation: 'office-line 2s ease-in-out 0.3s infinite' }} />
              <div className='h-2px rd-1px bg-[var(--color-primary-3)] w-50%' style={{ animation: 'office-line 2s ease-in-out 0.6s infinite' }} />
            </div>
          ) : isPending ? (
            <div className='w-12px h-12px rd-full border-2 border-[var(--warning)] border-t-transparent' style={{ animation: 'spin 1s linear infinite' }} />
          ) : isFailed ? (
            <span className='text-10px text-[var(--color-danger-6)]'>x</span>
          ) : (
            <div className='w-6px h-6px rd-full bg-[var(--color-border-3)]' />
          )}
        </div>

        {/* Desk stand */}
        <div className='w-4px h-6px bg-[var(--color-border-2)]' />
        <div className='w-20px h-2px rd-1px bg-[var(--color-border-2)]' />

        {/* Agent name */}
        <span
          className='text-11px font-medium text-center max-w-80px truncate mt-2px transition-colors'
          style={{ color: isActive ? 'var(--color-text-1)' : 'var(--color-text-3)' }}
        >
          {agent.agentName}
        </span>

        {/* Status label */}
        <span
          className='text-9px px-6px py-1px rd-full'
          style={{
            background: isActive
              ? 'rgba(34,197,94,0.15)'
              : isFailed
                ? 'rgba(239,68,68,0.12)'
                : isPending
                  ? 'rgba(255,165,0,0.12)'
                  : 'var(--color-fill-2)',
            color: isActive
              ? 'var(--color-success-6)'
              : isFailed
                ? 'var(--color-danger-6)'
                : isPending
                  ? 'var(--warning)'
                  : 'var(--color-text-4)',
          }}
        >
          {STATUS_LABELS[status]}
        </span>

        {/* Skills tags (visible on hover) */}
        {agent.skills && agent.skills.length > 0 && (
          <div className='absolute -bottom-18px left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap flex gap-2px'>
            {agent.skills.slice(0, 2).map((s) => (
              <span key={s} className='text-8px px-4px py-1px rd-2px bg-[var(--color-primary-1)] text-[var(--color-primary-6)]'>
                {s}
              </span>
            ))}
            {agent.skills.length > 2 && (
              <span className='text-8px text-[var(--color-text-4)]'>+{agent.skills.length - 2}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/** Decorative office floor grid */
const OfficeFloor: React.FC = () => (
  <svg className='absolute inset-0 w-full h-full' preserveAspectRatio='none'>
    <defs>
      <pattern id='office-grid' width='60' height='60' patternUnits='userSpaceOnUse'>
        <path d='M 60 0 L 0 0 0 60' fill='none' stroke='var(--color-border-1)' strokeWidth='0.5' strokeDasharray='4 4' />
      </pattern>
    </defs>
    <rect width='100%' height='100%' fill='url(#office-grid)' />
  </svg>
);

const AgentOfficeView: React.FC<Props> = ({ agents, statusMap, onAgentClick }) => {
  const activeCount = useMemo(
    () => agents.filter((a) => (statusMap.get(a.slotId)?.status ?? a.status) === 'active').length,
    [agents, statusMap]
  );
  const idleCount = useMemo(
    () => agents.filter((a) => {
      const s = statusMap.get(a.slotId)?.status ?? a.status;
      return s === 'idle' || s === 'completed';
    }).length,
    [agents, statusMap]
  );

  return (
    <div className='flex flex-col h-full bg-[var(--color-bg-1)] overflow-hidden'>
      {/* Office header bar */}
      <div className='flex items-center justify-between px-16px py-10px border-b border-[var(--color-border)] bg-[var(--color-bg-2)]'>
        <div className='flex items-center gap-12px'>
          <span className='text-14px font-semibold text-[var(--color-text-1)]'>Agent Office</span>
          <span className='text-12px text-[var(--color-text-3)]'>
            {agents.length} agent{agents.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className='flex items-center gap-16px text-12px'>
          {activeCount > 0 && (
            <div className='flex items-center gap-4px'>
              <span className='w-6px h-6px rd-full bg-[var(--color-success-6)] animate-pulse' />
              <span className='text-[var(--color-success-6)]'>{activeCount} working</span>
            </div>
          )}
          {idleCount > 0 && (
            <div className='flex items-center gap-4px'>
              <span className='w-6px h-6px rd-full bg-gray-400' />
              <span className='text-[var(--color-text-4)]'>{idleCount} idle</span>
            </div>
          )}
        </div>
      </div>

      {/* Office floor */}
      <div className='relative flex-1 min-h-300px p-20px'>
        <OfficeFloor />

        {/* Connection lines between leader and teammates */}
        <svg className='absolute inset-0 w-full h-full pointer-events-none z-0'>
          {(() => {
            const leadIdx = agents.findIndex((a) => a.role === 'lead');
            if (leadIdx < 0) return null;
            const leadPos = DESK_POSITIONS[leadIdx];
            return agents.map((agent, idx) => {
              if (agent.role === 'lead' || idx >= DESK_POSITIONS.length) return null;
              const pos = DESK_POSITIONS[idx];
              const status = statusMap.get(agent.slotId)?.status ?? agent.status;
              const isActive = status === 'active';
              return (
                <line
                  key={agent.slotId}
                  x1={`${leadPos.x}%`}
                  y1={`${leadPos.y}%`}
                  x2={`${pos.x}%`}
                  y2={`${pos.y}%`}
                  stroke={isActive ? 'var(--color-primary-5)' : 'var(--color-border-2)'}
                  strokeWidth={isActive ? '1.5' : '0.5'}
                  strokeDasharray={isActive ? '6 3' : '4 4'}
                  opacity={isActive ? 0.6 : 0.25}
                >
                  {isActive && (
                    <animate attributeName='stroke-dashoffset' from='0' to='-18' dur='1s' repeatCount='indefinite' />
                  )}
                </line>
              );
            });
          })()}
        </svg>

        {/* Agent desks */}
        {agents.map((agent, idx) => {
          if (idx >= DESK_POSITIONS.length) return null;
          const status = statusMap.get(agent.slotId)?.status ?? agent.status;
          return (
            <AgentDesk
              key={agent.slotId}
              agent={agent}
              status={status}
              position={DESK_POSITIONS[idx]}
              onClick={() => onAgentClick?.(agent.slotId)}
            />
          );
        })}
      </div>

      {/* CSS Keyframes */}
      <style>{`
        @keyframes office-pulse {
          0%, 100% { box-shadow: 0 0 8px rgba(34,197,94,0.3); }
          50% { box-shadow: 0 0 20px rgba(34,197,94,0.5); }
        }
        @keyframes office-pending {
          0%, 100% { box-shadow: 0 0 6px rgba(255,165,0,0.2); }
          50% { box-shadow: 0 0 14px rgba(255,165,0,0.4); }
        }
        @keyframes office-typing {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-3px); opacity: 1; }
        }
        @keyframes office-line {
          0% { opacity: 0.3; transform: scaleX(0.6); transform-origin: left; }
          50% { opacity: 1; transform: scaleX(1); }
          100% { opacity: 0.3; transform: scaleX(0.6); transform-origin: left; }
        }
      `}</style>
    </div>
  );
};

export default AgentOfficeView;
