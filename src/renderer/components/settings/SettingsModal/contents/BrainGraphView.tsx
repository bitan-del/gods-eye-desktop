/**
 * @license
 * Copyright 2025 Gods Eye (gods-eye.org)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BrainGraphView — Obsidian-style force-directed graph of the vault.
 *
 * Renders one node per note and one edge per resolved `[[wiki-link]]` or
 * relative markdown link. Uses a plain-canvas layout with a home-grown physics
 * loop (repulsion + spring edges + centering), no extra npm deps.
 *
 * Interactions: drag nodes, drag empty space to pan, wheel to zoom, hover to
 * reveal labels, click a node to reveal its file in the OS file manager.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Empty, Spin } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import { brain, shell } from '@/common/adapter/ipcBridge';
import type { BrainGraph, BrainGraphNode } from '@/common/types/brain';

// ── Physics tuning ──────────────────────────────────────────────
const REPULSION = 1400; // how hard nodes push each other
const SPRING = 0.02; // edge stiffness
const SPRING_LENGTH = 80; // target edge length
const CENTER_PULL = 0.01; // pull toward centre (keeps graph from drifting)
const VELOCITY_DECAY = 0.85; // per-tick velocity damping
const MIN_ALPHA = 0.005; // stop simulating below this
const ALPHA_DECAY = 0.004;

// ── Visual tuning ──────────────────────────────────────────────
/** Folder → accent colour. Keys match `BrainGraphNode.folder`. */
const FOLDER_COLORS: Record<string, string> = {
  agents: '#f87171', // red-400 — matches Obsidian screenshot accent
  conversations: '#60a5fa', // blue-400
  tasks: '#fbbf24', // amber-400
  people: '#c084fc', // purple-400
  daily: '#34d399', // emerald-400
};
const DEFAULT_NODE_COLOR = '#94a3b8'; // slate-400 (orphan / other folders)
const EDGE_COLOR = 'rgba(148, 163, 184, 0.25)';
const EDGE_HIGHLIGHT = 'rgba(248, 113, 113, 0.9)';
const LABEL_COLOR = 'rgba(226, 232, 240, 0.95)';

interface SimNode extends BrainGraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Pinned by the user? Skips physics until released. */
  pinned: boolean;
}

interface SimEdge {
  source: SimNode;
  target: SimNode;
}

/** Seed a deterministic-ish starting position so the layout converges consistently. */
const seedPosition = (id: string, radius: number): [number, number] => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const angle = ((h & 0xffff) / 0xffff) * Math.PI * 2;
  const r = radius * (0.3 + ((h >>> 16) & 0xff) / 0xff) * 0.7;
  return [Math.cos(angle) * r, Math.sin(angle) * r];
};

const nodeRadius = (n: SimNode): number => Math.max(3, Math.min(14, 3 + Math.sqrt(n.degree) * 2.2));

const colorFor = (n: SimNode): string => FOLDER_COLORS[n.folder] ?? DEFAULT_NODE_COLOR;

interface Transform {
  x: number;
  y: number;
  scale: number;
}

const BrainGraphView: React.FC = () => {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [graph, setGraph] = useState<BrainGraph | null>(null);

  // Mutable simulation state lives in refs — React re-renders don't restart physics.
  const nodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<SimEdge[]>([]);
  const transformRef = useRef<Transform>({ x: 0, y: 0, scale: 1 });
  const alphaRef = useRef(1);
  const hoverIdRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    try {
      const g = await brain.getGraph.invoke();
      setGraph(g);
    } catch (err) {
      console.error('[BrainGraphView] fetch failed', err);
      setGraph({ nodes: [], edges: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchGraph();
  }, [fetchGraph]);

  // Build sim state whenever the graph payload changes.
  useEffect(() => {
    if (!graph) return;
    const radius = 200;
    const simNodes: SimNode[] = graph.nodes.map((n) => {
      const [x, y] = seedPosition(n.id, radius);
      return { ...n, x, y, vx: 0, vy: 0, pinned: false };
    });
    const byId = new Map(simNodes.map((n) => [n.id, n]));
    const simEdges: SimEdge[] = [];
    for (const e of graph.edges) {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (a && b) simEdges.push({ source: a, target: b });
    }
    nodesRef.current = simNodes;
    edgesRef.current = simEdges;
    alphaRef.current = 1;
    // Centre the view on mount: pick zoom that fits initial radius in the viewport.
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      transformRef.current = { x: rect.width / 2, y: rect.height / 2, scale: 1 };
    }
  }, [graph]);

  // Main physics + render loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const step = () => {
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const alpha = alphaRef.current;

      if (alpha > MIN_ALPHA && nodes.length > 0) {
        // 1. Pairwise repulsion — O(n²); fine up to a few hundred nodes.
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          if (a.pinned) continue;
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const distSq = dx * dx + dy * dy + 0.01;
            const force = (REPULSION * alpha) / distSq;
            const dist = Math.sqrt(distSq);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            a.vx += fx;
            a.vy += fy;
            if (!b.pinned) {
              b.vx -= fx;
              b.vy -= fy;
            }
          }
        }
        // 2. Springs along edges.
        for (const e of edges) {
          const dx = e.target.x - e.source.x;
          const dy = e.target.y - e.source.y;
          const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
          const diff = (dist - SPRING_LENGTH) * SPRING * alpha;
          const fx = (dx / dist) * diff;
          const fy = (dy / dist) * diff;
          if (!e.source.pinned) {
            e.source.vx += fx;
            e.source.vy += fy;
          }
          if (!e.target.pinned) {
            e.target.vx -= fx;
            e.target.vy -= fy;
          }
        }
        // 3. Centre gravity + integration.
        for (const n of nodes) {
          if (n.pinned) continue;
          n.vx -= n.x * CENTER_PULL * alpha;
          n.vy -= n.y * CENTER_PULL * alpha;
          n.vx *= VELOCITY_DECAY;
          n.vy *= VELOCITY_DECAY;
          n.x += n.vx;
          n.y += n.vy;
        }
        alphaRef.current = Math.max(0, alpha - ALPHA_DECAY);
      }

      // ── Draw ──
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const { x: tx, y: ty, scale } = transformRef.current;
      ctx.translate(tx, ty);
      ctx.scale(scale, scale);

      const hoverId = hoverIdRef.current;
      // Edges first (so nodes paint on top).
      ctx.lineWidth = 1 / scale;
      for (const e of edges) {
        const highlight = hoverId === e.source.id || hoverId === e.target.id;
        ctx.strokeStyle = highlight ? EDGE_HIGHLIGHT : EDGE_COLOR;
        ctx.beginPath();
        ctx.moveTo(e.source.x, e.source.y);
        ctx.lineTo(e.target.x, e.target.y);
        ctx.stroke();
      }

      // Nodes.
      for (const n of nodes) {
        const r = nodeRadius(n);
        const isHover = hoverId === n.id;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = isHover ? '#fafafa' : colorFor(n);
        ctx.fill();
        if (isHover) {
          ctx.strokeStyle = colorFor(n);
          ctx.lineWidth = 2 / scale;
          ctx.stroke();
        }
      }

      // Hover label — only for the hovered node, to avoid clutter.
      if (hoverId) {
        const n = nodes.find((x) => x.id === hoverId);
        if (n) {
          ctx.font = `${12 / scale}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
          ctx.fillStyle = LABEL_COLOR;
          ctx.textBaseline = 'middle';
          ctx.fillText(n.name, n.x + nodeRadius(n) + 6 / scale, n.y);
        }
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // ── Interaction ──────────────────────────────────────────────
  const dragRef = useRef<
    | { kind: 'node'; node: SimNode; offsetX: number; offsetY: number }
    | { kind: 'pan'; startX: number; startY: number; origTx: number; origTy: number }
    | null
  >(null);

  const screenToWorld = (sx: number, sy: number): [number, number] => {
    const { x, y, scale } = transformRef.current;
    return [(sx - x) / scale, (sy - y) / scale];
  };

  const pickNode = (wx: number, wy: number): SimNode | null => {
    const { scale } = transformRef.current;
    let best: SimNode | null = null;
    let bestDist = Infinity;
    for (const n of nodesRef.current) {
      const r = nodeRadius(n) + 6 / scale; // generous hover target
      const dx = n.x - wx;
      const dy = n.y - wy;
      const d = dx * dx + dy * dy;
      if (d < r * r && d < bestDist) {
        best = n;
        bestDist = d;
      }
    }
    return best;
  };

  const handlePointerDown = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(ev.pointerId);
    const rect = canvas.getBoundingClientRect();
    const [wx, wy] = screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
    const n = pickNode(wx, wy);
    if (n) {
      n.pinned = true;
      dragRef.current = { kind: 'node', node: n, offsetX: n.x - wx, offsetY: n.y - wy };
      alphaRef.current = Math.max(alphaRef.current, 0.3); // wake simulation
    } else {
      const t = transformRef.current;
      dragRef.current = {
        kind: 'pan',
        startX: ev.clientX,
        startY: ev.clientY,
        origTx: t.x,
        origTy: t.y,
      };
    }
  };

  const handlePointerMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const drag = dragRef.current;
    if (drag?.kind === 'node') {
      const [wx, wy] = screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
      drag.node.x = wx + drag.offsetX;
      drag.node.y = wy + drag.offsetY;
      drag.node.vx = 0;
      drag.node.vy = 0;
      alphaRef.current = Math.max(alphaRef.current, 0.3);
      return;
    }
    if (drag?.kind === 'pan') {
      transformRef.current = {
        ...transformRef.current,
        x: drag.origTx + (ev.clientX - drag.startX),
        y: drag.origTy + (ev.clientY - drag.startY),
      };
      return;
    }
    // Hover only — update label target.
    const [wx, wy] = screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
    const hovered = pickNode(wx, wy);
    const id = hovered?.id ?? null;
    if (id !== hoverIdRef.current) {
      hoverIdRef.current = id;
      canvas.style.cursor = id ? 'pointer' : 'grab';
    }
  };

  const handlePointerUp = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.kind === 'node') {
      drag.node.pinned = false; // release so physics can keep settling
    }
    canvas.releasePointerCapture(ev.pointerId);
  };

  const handleWheel = (ev: React.WheelEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left;
    const sy = ev.clientY - rect.top;
    const t = transformRef.current;
    const factor = Math.exp(-ev.deltaY * 0.0015);
    const newScale = Math.max(0.2, Math.min(4, t.scale * factor));
    // Keep the cursor's world position fixed under the pointer while zooming.
    const [wx, wy] = screenToWorld(sx, sy);
    transformRef.current = {
      x: sx - wx * newScale,
      y: sy - wy * newScale,
      scale: newScale,
    };
  };

  const handleDoubleClick = async (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const [wx, wy] = screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top);
    const n = pickNode(wx, wy);
    if (!n) return;
    try {
      const vaultPath = await brain.getVaultPath.invoke();
      if (!vaultPath) return;
      const sep = vaultPath.includes('\\') && !vaultPath.includes('/') ? '\\' : '/';
      await shell.showItemInFolder.invoke(`${vaultPath}${sep}${n.id.split('/').join(sep)}`);
    } catch (err) {
      console.error('[BrainGraphView] reveal failed', err);
    }
  };

  const nodeCount = graph?.nodes.length ?? 0;
  const edgeCount = graph?.edges.length ?? 0;
  const legend = useMemo(
    () =>
      Object.entries(FOLDER_COLORS).map(([folder, color]) => ({
        folder,
        color,
        label: t(`brain.folders.${folder}`, { defaultValue: folder }),
      })),
    [t]
  );

  return (
    <div className='flex flex-col gap-8px'>
      <div className='flex items-center justify-between'>
        <div className='text-14px text-t-primary font-500'>{t('brain.graphTitle')}</div>
        <div className='flex items-center gap-8px'>
          <span className='text-12px text-t-tertiary'>
            {t('brain.graphStats', { nodes: nodeCount, edges: edgeCount })}
          </span>
          <Button
            size='mini'
            icon={<Refresh theme='outline' size='12' />}
            onClick={() => void fetchGraph()}
            loading={loading}
          >
            {t('brain.graphRefresh')}
          </Button>
        </div>
      </div>

      <div
        ref={containerRef}
        className='relative overflow-hidden border-rd-8px'
        style={{
          height: 360,
          background: 'radial-gradient(ellipse at center, #151820 0%, #0b0d12 100%)',
          border: '1px solid var(--color-border-2, rgba(148,163,184,0.18))',
        }}
      >
        {loading && (
          <div className='absolute inset-0 flex items-center justify-center'>
            <Spin />
          </div>
        )}
        {!loading && nodeCount === 0 && (
          <div className='absolute inset-0 flex items-center justify-center'>
            <Empty description={t('brain.graphEmpty')} />
          </div>
        )}
        <canvas
          ref={canvasRef}
          className='w-full h-full block'
          style={{ cursor: 'grab', display: loading || nodeCount === 0 ? 'none' : 'block' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          onDoubleClick={handleDoubleClick}
        />
        {nodeCount > 0 && !loading && (
          <div className='absolute bottom-8px left-8px flex flex-wrap gap-8px text-11px text-t-tertiary'>
            {legend.map((l) => (
              <div key={l.folder} className='flex items-center gap-4px'>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: l.color,
                    display: 'inline-block',
                  }}
                />
                <span>{l.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className='text-11px text-t-tertiary'>{t('brain.graphHint')}</div>
    </div>
  );
};

export default BrainGraphView;
