import { useMemo } from 'react';
import { useApp } from '../contexts/AppContext';
import { completionTrend, nextDse, subjectStats } from '../lib/analytics';
import { daysUntil, todayISO } from '../lib/date';
import { SubjectBadge } from './SubjectBadge';
import { Icon } from './Icons';

function TrendSvg({ points }: { points: { label: string; value: number }[] }) {
  const width = 640;
  const height = 180;
  const padX = 22;
  const padY = 16;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const coords = points.map((point, index) => {
    const x = padX + (index / Math.max(1, points.length - 1)) * innerW;
    const y = padY + (1 - point.value / 100) * innerH;
    return { x, y, ...point };
  });
  const line = coords.map((coord, index) => `${index === 0 ? 'M' : 'L'}${coord.x},${coord.y}`).join(' ');
  const area = `${line} L${coords[coords.length - 1]?.x ?? padX},${padY + innerH} L${coords[0]?.x ?? padX},${padY + innerH} Z`;

  return (
    <svg className="trend-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="八週任務完成率趨勢">
      {[0, 25, 50, 75, 100].map((value) => {
        const y = padY + (1 - value / 100) * innerH;
        return (
          <g key={value}>
            <line className="trend-grid" x1={padX} x2={width - padX} y1={y} y2={y} />
            <text className="trend-label" x={4} y={y + 3}>{value}%</text>
          </g>
        );
      })}
      {coords.length > 1 ? <path className="trend-area" d={area} /> : null}
      <path className="trend-line" d={line} />
      {coords.map((coord) => (
        <g key={coord.label}>
          <circle className="trend-dot" cx={coord.x} cy={coord.y} r="2.5" />
          <text className="trend-label" x={coord.x} y={height - 2} textAnchor="middle">{coord.label}</text>
        </g>
      ))}
    </svg>
  );
}

export function AnalyticsView() {
  const { data, stats, allEvents } = useApp();
  const today = todayISO();
  const statsBySubject = useMemo(() => subjectStats(data.tasks, data.subjects, today), [data.subjects, data.tasks, today]);
  const trend = useMemo(() => completionTrend(data.tasks, today), [data.tasks, today]);
  const total = data.tasks.length;
  const completed = data.tasks.filter((task) => task.completed).length;
  const completionRate = total ? Math.round((completed / total) * 100) : 0;
  const maxCompleted = Math.max(1, ...statsBySubject.map((stat) => stat.completed));
  const dse = nextDse(allEvents, data.settings.dseStartDate, today);
  const dseDays = dse ? daysUntil(dse.start, today) : null;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Private analytics / no comparison</div>
          <h1 className="page-title">學習分析</h1>
          <p className="page-subtitle">
            只給你一個人看的數據。重點不是每日做得多，而是每個科目都有穩定的接觸頻率。
          </p>
        </div>
        <span className="chip chip-gold">{stats.currentStreak} day streak</span>
      </div>

      <div className="stat-strip">
        <div className="stat">
          <div className="stat-value">{completionRate}%</div>
          <div className="stat-label">整體任務完成率</div>
        </div>
        <div className="stat">
          <div className="stat-value gold">{completed}</div>
          <div className="stat-label">累計完成任務</div>
        </div>
        <div className="stat">
          <div className="stat-value">{dseDays !== null && dseDays >= 0 ? dseDays : '—'}</div>
          <div className="stat-label">距離 DSE 開考</div>
        </div>
      </div>

      <div className="analytics-grid">
        <section className="card">
          <div className="card-head">
            <div>
              <div className="eyebrow">Frequency / completed tasks</div>
              <div className="card-title" style={{ marginTop: 5 }}>
                <Icon name="chart" size={15} />
                各科完成任務
              </div>
            </div>
            <span className="tiny muted">累計</span>
          </div>
          <div className="chart-wrap">
            <div className="bar-chart">
              {statsBySubject.map((stat) => (
                <div className="bar-column" key={stat.subject.id}>
                  <span className="bar-value">{stat.completed}</span>
                  <div className="bar-track">
                    <div
                      className={`bar${stat.subject.category === 'ELECTIVE' ? ' gold' : ''}`}
                      style={{ height: `${Math.max(2, (stat.completed / maxCompleted) * 100)}%` }}
                      title={`${stat.subject.name} · ${stat.completed} 個完成`}
                    />
                  </div>
                  <span className="bar-label">{stat.subject.name}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <div className="eyebrow">Eight-week trend</div>
              <div className="card-title" style={{ marginTop: 5 }}>
                <Icon name="chart" size={15} />
                任務完成率趨勢
              </div>
            </div>
            <span className="tiny muted">按 due date</span>
          </div>
          <div className="chart-wrap">
            <TrendSvg points={trend} />
          </div>
        </section>

        <section className="card analytics-wide">
          <div className="card-head">
            <div>
              <div className="eyebrow">Exam readiness / task-based</div>
              <div className="card-title" style={{ marginTop: 5 }}>
                <Icon name="book" size={15} />
                各科備考進度
              </div>
            </div>
            <span className="tiny muted">完成任務 / 總任務，不是官方考試進度</span>
          </div>
          <div className="subject-table">
            <div className="subject-row head">
              <span>科目</span>
              <span>完成</span>
              <span>總數</span>
              <span>進度</span>
              <span>%</span>
            </div>
            {statsBySubject.map((stat) => (
              <div className="subject-row" key={stat.subject.id}>
                <span className="subject-name">
                  <SubjectBadge subject={stat.subject} />
                  <span>{stat.subject.name}</span>
                </span>
                <span className="subject-number">{stat.completed}</span>
                <span className="subject-number">{stat.total}</span>
                <span className="subject-bar-wrap">
                  <span className="progress">
                    <span className="progress-bar" style={{ width: `${stat.completionRate}%` }} />
                  </span>
                </span>
                <span className="subject-percent">{stat.completionRate}%</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="notice">
        <Icon name="info" size={15} />
        <span>
          如果想令「考試進度」更準確，下一步可以加入 syllabus topic 清單（每個 topic 的狀態）；目前進度條只反映任務完成率，不會假裝是官方 DSE 進度。
        </span>
      </div>
    </div>
  );
}
