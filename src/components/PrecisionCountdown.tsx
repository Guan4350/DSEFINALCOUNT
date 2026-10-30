import { countdownParts, formatCountdown } from '../lib/clock';
import { pad } from '../lib/date';

interface PrecisionCountdownProps {
  targetMs: number;
  nowMs: number;
}

/**
 * Days keep the large gold display; hours / minutes / seconds sit beside it as
 * a quieter clock so the one-second refresh does not overwhelm the page.
 */
export function PrecisionCountdown({ targetMs, nowMs }: PrecisionCountdownProps) {
  const parts = countdownParts(targetMs, nowMs);

  return (
    <div className="precision-countdown" aria-label={`距離目標時間 ${formatCountdown(parts)}`}>
      <div className="countdown">
        <span className={`countdown-number${parts.days <= 30 ? ' accent' : ''}`}>{parts.days}</span>
        <span className="countdown-unit">days</span>
      </div>
      <div className="precision-clock" aria-hidden="true">
        <span className="precision-unit">
          <strong>{pad(parts.hours)}</strong>
          <em>時</em>
        </span>
        <span className="precision-separator">:</span>
        <span className="precision-unit">
          <strong>{pad(parts.minutes)}</strong>
          <em>分</em>
        </span>
        <span className="precision-separator">:</span>
        <span className="precision-unit">
          <strong>{pad(parts.seconds)}</strong>
          <em>秒</em>
        </span>
      </div>
    </div>
  );
}
