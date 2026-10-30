import { useMemo } from 'react';
import type { Checkin, Stats } from '../types';
import { addDays, startOfWeek, todayISO } from '../lib/date';
import { Icon } from './Icons';

interface HeatmapProps {
  checkins: Record<string, Checkin>;
  stats: Stats;
  onSelectDate?: (date: string) => void;
  compact?: boolean;
}

export function Heatmap({ checkins, stats, onSelectDate, compact = false }: HeatmapProps) {
  const today = todayISO();
  const cells = useMemo(() => {
    const firstMonday = addDays(startOfWeek(today), -52 * 7);
    return Array.from({ length: 53 * 7 }, (_, index) => {
      const date = addDays(firstMonday, index);
      const checkin = checkins[date];
      const count = checkin ? Math.max(1, checkin.completedTaskCount || 1) : 0;
      const level = count >= 4 ? 4 : count === 3 ? 3 : count === 2 ? 2 : count === 1 ? 1 : 0;
      return { date, count, level, future: date > today };
    });
  }, [checkins, today]);

  const activeDays = cells.filter((cell) => cell.count > 0).length;

  return (
    <section className={`card heatmap-card${compact ? ' compact' : ''}`}>
      <div className="between">
        <div>
          <div className="eyebrow">Consistency / 365 days</div>
          <div className="card-title" style={{ marginTop: 5 }}>
            <Icon name="flame" size={15} />
            學習熱力圖
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="display" style={{ fontSize: 25, lineHeight: 1 }}>
            {activeDays}
          </div>
          <div className="tiny muted">活躍日</div>
        </div>
      </div>

      <div className="heatmap-wrap" aria-label="過去一年每日打卡熱力圖">
        <div className="heatmap-grid">
          {cells.map((cell) => (
            <button
              key={cell.date}
              type="button"
              className={`heatmap-cell level-${cell.level}${cell.future ? ' future' : ''}`}
              title={`${cell.date}${cell.count ? ` · ${cell.count} 個完成任務` : ' · 未打卡'}`}
              aria-label={`${cell.date}${cell.count ? `，${cell.count} 個完成任務` : '，未打卡'}`}
              onClick={() => !cell.future && onSelectDate?.(cell.date)}
              style={cell.future ? { opacity: 0.25 } : undefined}
            />
          ))}
        </div>
      </div>

      <div className="heatmap-legend">
        <span>{stats.totalDays} 日總計</span>
        <span style={{ marginLeft: 'auto' }}>少</span>
        <span className="heatmap-cell level-0" />
        <span className="heatmap-cell level-1" />
        <span className="heatmap-cell level-2" />
        <span className="heatmap-cell level-3" />
        <span className="heatmap-cell level-4" />
        <span>多</span>
      </div>
    </section>
  );
}
