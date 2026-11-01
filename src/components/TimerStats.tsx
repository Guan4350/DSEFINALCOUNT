import { useMemo, useState } from 'react';
import type { Subject, TimerSession } from '../types';
import { lastNDays } from '../lib/date';
import { formatMinutes, modeLabel, todayInHongKong } from '../lib/timer';
import { Icon } from './Icons';

const COLORS = ['#f2c046', '#222222', '#8a6410', '#6b7f8f', '#c28d1c', '#a0522d', '#9a9a9a', '#4f6d5a'];

interface TimerStatsProps {
  sessions: TimerSession[];
  subjects: Subject[];
  onDelete: (id: string) => Promise<void>;
}

function csvCell(value: string | number | undefined): string {
  const text = value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(name: string, rows: (string | number | undefined)[][]): void {
  const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function TimerStats({ sessions, subjects, onDelete }: TimerStatsProps) {
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const today = todayInHongKong();
  const dayCount = period === 'week' ? 7 : 30;
  const dates = useMemo(() => lastNDays(dayCount, today), [dayCount, today]);

  const filtered = useMemo(
    () =>
      sessions
        .filter((session) => session.completed && session.date >= dates[0] && session.date <= today)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [dates, sessions, today],
  );

  const subjectTotals = useMemo(() => {
    const map = new Map<string, { name: string; seconds: number; sessions: number }>();
    for (const session of filtered) {
      const name = session.subjectName || subjects.find((subject) => subject.id === session.subjectId)?.name || '未命名科目';
      const current = map.get(name) || { name, seconds: 0, sessions: 0 };
      current.seconds += session.durationSeconds;
      current.sessions += 1;
      map.set(name, current);
    }
    return Array.from(map.values()).sort((a, b) => b.seconds - a.seconds);
  }, [filtered, subjects]);

  const totalSeconds = subjectTotals.reduce((sum, item) => sum + item.seconds, 0);
  const totalSessions = filtered.length;
  const averagePerDay = totalSeconds / dayCount;
  const topSubject = subjectTotals[0];

  const pieSegments = subjectTotals.map((item, index) => ({
    ...item,
    color: COLORS[index % COLORS.length],
    percent: totalSeconds ? (item.seconds / totalSeconds) * 100 : 0,
  }));

  const series = useMemo(() => {
    const daily = new Map<string, Map<string, number>>();
    for (const date of dates) daily.set(date, new Map());
    for (const session of filtered) {
      const name = session.subjectName || subjects.find((subject) => subject.id === session.subjectId)?.name || '未命名科目';
      const day = daily.get(session.date);
      if (day) day.set(name, (day.get(name) || 0) + session.durationSeconds);
    }
    return subjectTotals.map((subject, index) => ({
      name: subject.name,
      color: COLORS[index % COLORS.length],
      values: dates.map((date) => (daily.get(date)?.get(subject.name) || 0) / 60),
    }));
  }, [dates, filtered, subjectTotals, subjects]);

  const maxMinutes = Math.max(1, ...series.flatMap((item) => item.values));
  const width = 640;
  const height = 190;
  const padX = 28;
  const padY = 18;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const xAt = (index: number) => padX + (dates.length <= 1 ? 0 : (index / (dates.length - 1)) * innerW);
  const yAt = (minutes: number) => padY + (1 - minutes / maxMinutes) * innerH;

  const exportCsv = () => {
    downloadCsv(`dse-timer-${period}-${today}.csv`, [
      ['date', 'subject', 'paper', 'mode', 'startedAt', 'endedAt', 'durationMinutes', 'notes'],
      ...filtered.map((session) => [
        session.date,
        session.subjectName,
        session.paper,
        modeLabel(session.mode),
        session.startedAt,
        session.endedAt,
        Math.round(session.durationSeconds / 60),
        session.notes || '',
      ]),
    ]);
  };

  return (
    <div className="stack-sm timer-stats">
      <div className="between timer-stats-head">
        <div>
          <div className="eyebrow">Study time / private</div>
          <div className="card-title" style={{ marginTop: 5 }}>
            <Icon name="chart" size={15} />
            溫書時間統計
          </div>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="metric-tabs" role="tablist" aria-label="統計期間">
            <button type="button" role="tab" aria-selected={period === 'week'} className={`metric-tab${period === 'week' ? ' active' : ''}`} onClick={() => setPeriod('week')}>週</button>
            <button type="button" role="tab" aria-selected={period === 'month'} className={`metric-tab${period === 'month' ? ' active' : ''}`} onClick={() => setPeriod('month')}>月</button>
          </div>
          <button type="button" className="btn btn-sm" onClick={exportCsv} disabled={!filtered.length}>
            <Icon name="download" size={13} />
            匯出 CSV
          </button>
        </div>
      </div>

      <div className="stat-strip">
        <div className="stat">
          <div className="stat-value gold">{formatMinutes(totalSeconds)}</div>
          <div className="stat-label">近 {dayCount} 日總時長</div>
        </div>
        <div className="stat">
          <div className="stat-value">{totalSessions}</div>
          <div className="stat-label">完成節數</div>
        </div>
        <div className="stat">
          <div className="stat-value">{formatMinutes(averagePerDay)}</div>
          <div className="stat-label">每日平均</div>
        </div>
        <div className="stat">
          <div className="stat-value" style={{ fontSize: 22 }}>{topSubject?.name || '—'}</div>
          <div className="stat-label">最多時間科目</div>
        </div>
      </div>

      <div className="timer-charts">
        <section className="card">
          <div className="card-head">
            <div>
              <div className="eyebrow">Share / by subject</div>
              <div className="card-title" style={{ marginTop: 5 }}>科目佔比</div>
            </div>
            <span className="tiny muted">近 {dayCount} 日</span>
          </div>
          {totalSeconds ? (
            <div className="chart-wrap timer-pie-wrap">
              <svg className="timer-pie" viewBox="0 0 140 140" role="img" aria-label="各科溫書時間佔比">
                <circle cx="70" cy="70" r="50" pathLength="100" fill="none" stroke="var(--line)" strokeWidth="16" />
                {pieSegments.map((segment) => {
                  let offset = 0;
                  for (const item of pieSegments) {
                    if (item.name === segment.name) break;
                    offset += item.percent;
                  }
                  return (
                    <circle
                      key={segment.name}
                      cx="70"
                      cy="70"
                      r="50"
                      pathLength="100"
                      fill="none"
                      stroke={segment.color}
                      strokeWidth="16"
                      strokeDasharray={`${segment.percent} ${100 - segment.percent}`}
                      strokeDashoffset={-offset}
                      transform="rotate(-90 70 70)"
                    />
                  );
                })}
                <text x="70" y="67" textAnchor="middle" className="timer-pie-value">{(totalSeconds / 3600).toFixed(1)}h</text>
                <text x="70" y="82" textAnchor="middle" className="timer-pie-label">總時長</text>
              </svg>
              <div className="timer-legend">
                {pieSegments.map((segment) => (
                  <div className="timer-legend-item" key={segment.name}>
                    <span className="timer-legend-dot" style={{ background: segment.color }} />
                    <span>{segment.name}</span>
                    <span className="tiny muted">{formatMinutes(segment.seconds)} · {Math.round(segment.percent)}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty" style={{ minHeight: 150 }}><div className="empty-copy">這段期間未有完成紀錄。</div></div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <div className="eyebrow">Trend / minutes per day</div>
              <div className="card-title" style={{ marginTop: 5 }}>各科時長趨勢</div>
            </div>
            <span className="tiny muted">分鐘</span>
          </div>
          {totalSeconds ? (
            <div className="chart-wrap">
              <svg className="trend-svg timer-trend" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="各科每日溫書分鐘趨勢">
                {[0, 0.5, 1].map((ratio) => {
                  const y = padY + ratio * innerH;
                  return (
                    <g key={ratio}>
                      <line className="trend-grid" x1={padX} x2={width - padX} y1={y} y2={y} />
                      <text className="trend-label" x={2} y={y + 3}>{Math.round(maxMinutes * (1 - ratio))}</text>
                    </g>
                  );
                })}
                {series.map((item) => {
                  const path = item.values.map((value, index) => `${index === 0 ? 'M' : 'L'}${xAt(index)},${yAt(value)}`).join(' ');
                  return (
                    <g key={item.name}>
                      <path d={path} fill="none" stroke={item.color} strokeWidth="1.8" />
                      {item.values.map((value, index) => (
                        <circle key={`${item.name}-${dates[index]}`} cx={xAt(index)} cy={yAt(value)} r="2" fill={item.color} />
                      ))}
                    </g>
                  );
                })}
                {dates.map((date, index) => {
                  if (dayCount === 30 && index % 5 !== 0 && index !== dates.length - 1) return null;
                  return <text key={date} className="trend-label" x={xAt(index)} y={height - 2} textAnchor="middle">{date.slice(5)}</text>;
                })}
              </svg>
              <div className="timer-legend timer-legend-row">
                {series.map((item) => (
                  <span className="timer-legend-item" key={item.name}>
                    <span className="timer-legend-dot" style={{ background: item.color }} />
                    {item.name}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty" style={{ minHeight: 150 }}><div className="empty-copy">完成一次計時後，這裡會顯示各科每日趨勢。</div></div>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="eyebrow">Recent sessions</div>
            <div className="card-title" style={{ marginTop: 5 }}>最近紀錄</div>
          </div>
          <span className="tiny muted">{filtered.length} 節</span>
        </div>
        {filtered.length ? (
          <div className="timer-recent-list">
            {filtered.slice(0, 12).map((session) => (
              <div className="timer-recent-row" key={session.id}>
                <span className={`timer-mode-dot ${session.mode}`} />
                <span style={{ minWidth: 0 }}>
                  <span className="timer-recent-title">{session.subjectName} · {session.paper}</span>
                  <span className="timer-recent-meta">
                    {session.date} · {modeLabel(session.mode)} · {formatMinutes(session.durationSeconds)}
                    {session.notes ? ` · ${session.notes}` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="刪除計時紀錄"
                  onClick={() => {
                    if (window.confirm('刪除此計時紀錄？')) void onDelete(session.id);
                  }}
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty" style={{ minHeight: 110 }}><div className="empty-copy">尚未有完成紀錄。</div></div>
        )}
      </section>
    </div>
  );
}
