import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FOCUS_NODES, type PublicFocusNode } from '../data/chemistryTree';
import { useFocusProgress, type NodeStatus } from '../hooks/useFocusProgress';
import { Modal } from './Modal';

const NODE_W = 190;
const NODE_H = 90;
const BUS_X = 270;
const CANVAS_W = 1430;
const CANVAS_H = 980;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.6;

const POSITIONS: Record<string, { x: number; y: number }> = {
  'CHEM-P1': { x: 30, y: 150 },
  'CHEM-P2': { x: 30, y: 560 },
  'CHEM-SBA': { x: 30, y: 760 },
  'CHEM-ROOT': { x: 1180, y: 400 },
};

const topics = FOCUS_NODES.filter(node => node.category === 'topic');
topics.forEach((node, index) => {
  POSITIONS[node.id] = {
    x: 300 + (index % 3) * 240,
    y: 40 + Math.floor(index / 3) * 185,
  };
});

FOCUS_NODES.filter(node => node.category === 'elective').forEach((node, index) => {
  POSITIONS[node.id] = { x: 300 + index * 240, y: 720 };
});

POSITIONS['CHEM-SBA-01'] = { x: 300, y: 850 };

const STATUS_LABEL: Record<NodeStatus, string> = {
  not_started: '未開始',
  in_progress: '進行中',
  completed: '已完成',
};

const CATEGORY_LABEL: Record<PublicFocusNode['category'], string> = {
  root: '總目標',
  module: '評核模塊',
  topic: '必修課題',
  elective: '選修單元',
  sba: 'SBA 子項',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function glyph(node: PublicFocusNode): string {
  if (node.id === 'CHEM-ROOT') return '★';
  if (node.id === 'CHEM-P1') return 'P1';
  if (node.id === 'CHEM-P2') return 'P2';
  if (node.id === 'CHEM-SBA') return 'SBA';
  if (node.id === 'CHEM-SBA-01') return 'SBA';
  const roman = node.title.match(/Topic ([IVX]+)/)?.[1];
  return roman ?? '·';
}

function groupPath(parent: PublicFocusNode, child: PublicFocusNode): string {
  const p = POSITIONS[parent.id];
  const c = POSITIONS[child.id];
  const py = p.y + NODE_H / 2;
  const cy = c.y + NODE_H / 2;
  return `M ${p.x + NODE_W} ${py} H ${BUS_X} V ${cy} H ${c.x}`;
}

function linkPath(from: PublicFocusNode, to: PublicFocusNode): string {
  const a = POSITIONS[from.id];
  const b = POSITIONS[to.id];
  const x1 = a.x + NODE_W;
  const y1 = a.y + NODE_H / 2;
  const x2 = b.x;
  const y2 = b.y + NODE_H / 2;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

export function FocusView() {
  const { statuses, ready, setStatus } = useFocusProgress();
  const [active, setActive] = useState<PublicFocusNode | null>(null);
  const [zoom, setZoom] = useState(0.8);
  const [pan, setPan] = useState({ x: 40, y: 20 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const stageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const base = import.meta.env.BASE_URL;
  const byId = useMemo(() => new Map(FOCUS_NODES.map(node => [node.id, node])), []);

  const unlocked = (node: PublicFocusNode): boolean =>
    node.prerequisites.every(id => statuses[id] === 'completed');

  const statusOf = (node: PublicFocusNode): NodeStatus => statuses[node.id] ?? 'not_started';

  const modules = useMemo(() => FOCUS_NODES.filter(node => node.category === 'module'), []);

  const weighted = useMemo(() => {
    const total = modules.reduce((sum, node) => sum + (node.weight ?? 0), 0);
    if (total <= 0) return 0;
    const earned = modules.reduce((sum, node) => {
      const status = statuses[node.id];
      const coefficient = status === 'completed' ? 1 : status === 'in_progress' ? 0.5 : 0;
      return sum + (node.weight ?? 0) * coefficient;
    }, 0);
    return Math.round((earned / total) * 1000) / 10;
  }, [modules, statuses]);

  const counts = useMemo(() => {
    const bucket = (category: PublicFocusNode['category']) => {
      const list = FOCUS_NODES.filter(node => node.category === category);
      return {
        done: list.filter(node => statuses[node.id] === 'completed').length,
        total: list.length,
      };
    };
    return {
      topics: bucket('topic'),
      electives: bucket('elective'),
      sba: bucket('sba'),
      modules: bucket('module'),
    };
  }, [statuses]);

  const groupEdges = useMemo(
    () =>
      FOCUS_NODES.flatMap(child => {
        if (child.category === 'topic') return [{ parent: 'CHEM-P1', child }];
        if (child.category === 'elective') return [{ parent: 'CHEM-P2', child }];
        if (child.category === 'sba') return [{ parent: 'CHEM-SBA', child }];
        return [];
      }),
    [],
  );

  const linkEdges = useMemo(
    () =>
      FOCUS_NODES.flatMap(to =>
        to.prerequisites
          .map(fromId => byId.get(fromId))
          .filter((from): from is PublicFocusNode => Boolean(from))
          .map(from => ({ from, to })),
      ),
    [byId],
  );

  const fitToView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 80) return;
    const scale = clamp(Math.min((rect.width - 72) / CANVAS_W, (rect.height - 104) / CANVAS_H), MIN_ZOOM, 1.05);
    setZoom(scale);
    setPan({
      x: (rect.width - CANVAS_W * scale) / 2,
      y: (rect.height - CANVAS_H * scale) / 2 + 16,
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(fitToView, 80);
    return () => window.clearTimeout(timer);
  }, [fitToView, isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !active) setIsFullscreen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen, active]);

  const zoomStep = (delta: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    changeZoom(zoom + delta, { x: rect.width / 2, y: rect.height / 2 });
  };

  const changeZoom = useCallback((next: number, anchor?: { x: number; y: number }) => {
    const target = clamp(next, MIN_ZOOM, MAX_ZOOM);
    if (anchor) {
      const ratio = target / zoomRef.current;
      setPan(current => ({
        x: anchor.x - (anchor.x - current.x) * ratio,
        y: anchor.y - (anchor.y - current.y) * ratio,
      }));
    }
    setZoom(target);
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      changeZoom(zoomRef.current * factor, anchor);
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [changeZoom]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('.tree-node')) return;
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setPan({
      x: drag.panX + (event.clientX - drag.x),
      y: drag.panY + (event.clientY - drag.y),
    });
  };

  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
  };

  function toggleFullscreen() {
    setIsFullscreen(value => !value);
  }

  const edgeClass = (to: PublicFocusNode): string => {
    const status = statusOf(to);
    if (status === 'completed') return 'done';
    if (status === 'in_progress') return 'active';
    return unlocked(to) ? 'open' : 'locked';
  };

  useEffect(() => {
    if (!isFullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isFullscreen]);

  const activeStatus = active ? statusOf(active) : 'not_started';
  const activeUnlocked = active ? unlocked(active) : false;

  async function applyStatus(status: NodeStatus) {
    if (!active) return;
    await setStatus(active.id, status);
  }

  return (
    <div className="page focus-page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Chemistry / National Focus</div>
          <h1 className="page-title">國策</h1>
          <p className="page-subtitle">
            HoI4 式國策樹：實線是定稿 JSON 的前置，虛線是章節分組（顯示層）。完成前置才會解鎖下一節點。
          </p>
        </div>
        <div className="focus-overview">
          <strong>{weighted.toFixed(1)}%</strong>
          <span>官方模塊加權</span>
          <small>{ready ? '已同步' : '同步中…'}</small>
        </div>
      </header>

      <div className="focus-stats">
        <div><span>必修課題</span><b>{counts.topics.done}/{counts.topics.total}</b></div>
        <div><span>選修單元</span><b>{counts.electives.done}/{counts.electives.total}</b></div>
        <div><span>SBA 子項</span><b>{counts.sba.done}/{counts.sba.total}</b></div>
        <div><span>評核模塊</span><b>{counts.modules.done}/{counts.modules.total}</b></div>
        <div className="focus-legend">
          <span><i className="line solid" />前置</span>
          <span><i className="line dotted" />章節分組</span>
          <span><i className="dot completed" />已完成</span>
          <span><i className="dot progress" />進行中</span>
        </div>
      </div>

      <div className={`tree-stage${isFullscreen ? ' is-fullscreen' : ''}`} ref={stageRef}>
        <div className="tree-hud">
          <div className="tree-hud-title">
            <strong>國策</strong>
            <span>{weighted.toFixed(1)}% · 必修 {counts.topics.done}/{counts.topics.total} · 選修 {counts.electives.done}/{counts.electives.total}</span>
          </div>
          <div className="tree-hud-actions">
            <button type="button" onClick={() => zoomStep(-0.1)} aria-label="縮小">−</button>
            <span className="tree-zoom-label">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => zoomStep(0.1)} aria-label="放大">＋</button>
            <button type="button" onClick={fitToView}>FIT</button>
            <button type="button" onClick={toggleFullscreen}>
              {isFullscreen ? '退出全屏' : '全屏'}
            </button>
          </div>
        </div>

        <div
          className={`tree-viewport${dragging ? ' is-dragging' : ''}`}
          ref={viewportRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={event => {
            if (!(event.target as HTMLElement).closest('.tree-node')) fitToView();
          }}
        >
          <div
            className="tree-canvas"
            style={{
              width: CANVAS_W,
              height: CANVAS_H,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
            }}
          >
            <svg className="tree-links" width={CANVAS_W} height={CANVAS_H} aria-hidden="true">
              {groupEdges.map(edge => {
                const parent = byId.get(edge.parent);
                if (!parent) return null;
                return (
                  <path
                    key={`g-${edge.parent}-${edge.child.id}`}
                    className={`tree-group-line${hovered && (edge.parent === hovered || edge.child.id === hovered) ? ' is-related' : hovered ? ' is-muted' : ''}`}
                    d={groupPath(parent, edge.child)}
                  />
                );
              })}
              {linkEdges.map(edge => (
                <path
                  key={`l-${edge.from.id}-${edge.to.id}`}
                  className={`tree-link ${edgeClass(edge.to)}${hovered && (edge.from.id === hovered || edge.to.id === hovered) ? ' is-related' : hovered ? ' is-muted' : ''}`}
                  d={linkPath(edge.from, edge.to)}
                />
              ))}
            </svg>

            {FOCUS_NODES.map(node => {
              const position = POSITIONS[node.id];
              if (!position) return null;
              const status = statusOf(node);
              const isUnlocked = unlocked(node);
              return (
                <button
                  key={node.id}
                  type="button"
                  className={`tree-node ${node.category} ${status} ${isUnlocked || status === 'completed' ? 'unlocked' : 'locked'}`}
                  style={{ left: position.x, top: position.y, width: NODE_W, height: NODE_H }}
                  onClick={() => setActive(node)}
                  onMouseEnter={() => setHovered(node.id)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span className="tree-icon">
                    {node.icon ? (
                      <img src={`${base}icons/topics/${node.icon}`} alt="" loading="lazy" />
                    ) : (
                      <span className="tree-glyph">{glyph(node)}</span>
                    )}
                  </span>
                  <span className="tree-text">
                    <strong>{node.title}</strong>
                    <em>{STATUS_LABEL[status]}{node.weight !== null ? ` · ${node.weight}%` : ''}</em>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="tree-hint">拖曳平移 · 滾輪縮放 · 點節點查看</div>
      </div>

      <p className="focus-note">
        目前公開頁只載入 20 個學生可見節點，不含 CHEM-MS 機密節點。章節分組依 ID 前綴顯示，不代表官方前置；官方前置以定稿 JSON 為準。
      </p>

      {active ? (
        <Modal
          title={active.title}
          eyebrow={CATEGORY_LABEL[active.category]}
          onClose={() => setActive(null)}
          footer={
            <button type="button" className="btn btn-sm" onClick={() => setActive(null)}>
              關閉
            </button>
          }
        >
          <div className="tree-modal">
            <div className="tree-modal-head">
              {active.icon ? (
                <img src={`${base}icons/topics/${active.icon}`} alt="" />
              ) : (
                <span className="tree-glyph large">{glyph(active)}</span>
              )}
              <div>
                <p className="tree-modal-status">
                  目前：<strong>{STATUS_LABEL[activeStatus]}</strong>
                  {!activeUnlocked && activeStatus !== 'completed' ? ' · 前置未完成' : ''}
                </p>
                <p className="tree-modal-weight">
                  權重：{active.weight === null ? '官方未公佈' : `${active.weight}%`}
                </p>
              </div>
            </div>

            <div className="tree-modal-section">
              <h3>前置</h3>
              {active.prerequisites.length ? (
                <ul>
                  {active.prerequisites.map(id => {
                    const prerequisite = byId.get(id);
                    const done = statuses[id] === 'completed';
                    return (
                      <li key={id} className={done ? 'done' : ''}>
                        {prerequisite?.title ?? id} {done ? '✓' : '✗'}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="muted">無（root 節點）</p>
              )}
            </div>

            <div className="tree-modal-section">
              <h3>更新狀態</h3>
              <div className="tree-status-row">
                {(['not_started', 'in_progress', 'completed'] as NodeStatus[]).map(status => (
                  <button
                    key={status}
                    type="button"
                    className={`btn btn-sm${activeStatus === status ? ' btn-primary' : ''}`}
                    disabled={status !== 'not_started' && !activeUnlocked && activeStatus !== 'completed'}
                    onClick={() => void applyStatus(status)}
                  >
                    {STATUS_LABEL[status]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
