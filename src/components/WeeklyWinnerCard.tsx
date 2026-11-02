import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type { LeaderboardEntry } from '../types';
import { downloadWinnerPoster } from '../lib/poster';
import { formatMinutes } from '../lib/timer';
import { winnerWeekLabel } from '../lib/winner';
import {
  containsSensitiveWords,
  fetchWinnerCard,
  fetchWinnerCards,
  saveWinnerCard,
  uploadWinnerImage,
  winnerImageUrl,
  WINNER_QUOTE_LIMIT,
  emptyWinnerCard,
  type WinnerCard,
} from '../lib/winner';
import { Icon } from './Icons';

interface WeeklyWinnerCardProps {
  entries: LeaderboardEntry[];
  currentUser: User | null;
  weekKey: string;
  refreshKey?: number;
}

export function WeeklyWinnerCard({ entries, currentUser, weekKey, refreshKey = 0 }: WeeklyWinnerCardProps) {
  const weekly = useMemo(
    () =>
      entries
        .filter((entry) => entry.weekKey === weekKey && (entry.weeklySeconds || 0) > 0)
        .sort((a, b) => (b.weeklySeconds || 0) - (a.weeklySeconds || 0)),
    [entries, weekKey],
  );
  const top = weekly[0];
  const [card, setCard] = useState<WinnerCard | null>(null);
  const [history, setHistory] = useState<WinnerCard[]>([]);
  const [quote, setQuote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lastTopRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const sameTop = lastTopRef.current === (top?.uid || null);
    if (!sameTop) {
      setFile(null);
      setError('');
    }
    if (!top) {
      setCard(null);
      setQuote('');
      setImageUrl('');
      lastTopRef.current = null;
      return () => { cancelled = true; };
    }
    void fetchWinnerCard(weekKey, top.uid)
      .then((next) => {
        if (cancelled) return;
        setCard(next);
        if (!sameTop) setQuote(next?.quote || '');
      })
      .catch(() => {
        if (cancelled) return;
        setCard(null);
        if (!sameTop) setQuote('');
      });
    lastTopRef.current = top.uid;
    return () => { cancelled = true; };
  }, [top?.uid, weekKey, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    void fetchWinnerCards()
      .then((cards) => {
        if (cancelled) return;
        setHistory(cards.filter((item) => item.weekKey !== weekKey || item.uid !== top?.uid).slice(0, 5));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [top?.uid, weekKey]);

  useEffect(() => {
    let cancelled = false;
    if (!card?.imagePath || card.imageStatus !== 'approved') {
      setImageUrl('');
      return () => { cancelled = true; };
    }
    void winnerImageUrl(card.imagePath)
      .then((url) => {
        if (!cancelled) setImageUrl(url);
      })
      .catch(() => {
        if (!cancelled) setImageUrl('');
      });
    return () => { cancelled = true; };
  }, [card?.imagePath, card?.imageStatus]);

  if (!top) {
    return (
      <section className="card winner-card winner-card-empty">
        <div className="winner-hero">
          <div>
            <div className="eyebrow">Weekly focus / encouragement</div>
            <div className="winner-title">本週榜首勵志卡</div>
            <div className="winner-copy">
              本週暫未有人公開溫書時間。週榜沿用排行榜的自願公開設定；完成計時後可自願出現在這裡。
            </div>
          </div>
          <div className="winner-orbit" aria-hidden="true"><i /><i /><i /></div>
        </div>
      </section>
    );
  }

  const isTop = currentUser?.uid === top.uid;
  const displayCard = card || emptyWinnerCard(weekKey, top.uid, top.displayName, top.weeklySeconds || 0);
  const status = displayCard.imageStatus;
  const canEdit = isTop && Boolean(currentUser);

  const save = async () => {
    if (!canEdit) return;
    const cleanQuote = quote.trim();
    if (cleanQuote.length > WINNER_QUOTE_LIMIT) {
      setError(`格言上限 ${WINNER_QUOTE_LIMIT} 字。`);
      return;
    }
    if (containsSensitiveWords(cleanQuote)) {
      setError('格言包含不適合公開的字眼，請修改。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      let imagePath = displayCard.imagePath;
      let imageStatus = displayCard.imageStatus;
      if (file) {
        imagePath = await uploadWinnerImage(file, top.uid, weekKey);
        imageStatus = 'pending';
      }
      const next: WinnerCard = {
        ...displayCard,
        weekKey,
        uid: top.uid,
        displayName: top.displayName,
        durationSeconds: top.weeklySeconds || 0,
        quote: cleanQuote,
        imagePath,
        imageStatus,
        settlementDate: weekKey,
        archived: false,
      };
      await saveWinnerCard(next);
      setCard(next);
      setFile(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const poster = async () => {
    try {
      await downloadWinnerPoster(
        {
          ...displayCard,
          displayName: top.displayName,
          durationSeconds: top.weeklySeconds || displayCard.durationSeconds,
        },
        imageUrl,
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  };

  return (
    <section className="card winner-card">
      <div className="winner-topline">
        <span className="chip chip-gold">WEEKLY FOCUS</span>
        <span className="tiny muted">{winnerWeekLabel(weekKey)}</span>
      </div>
      <div className="winner-layout">
        <div className="winner-visual">
          {status === 'approved' && imageUrl ? (
            <img src={imageUrl} alt={`${top.displayName} 的榜首圖片`} />
          ) : (
            <div className={`winner-placeholder ${status}`}>
              <div className="winner-orbit" aria-hidden="true"><i /><i /><i /><i /><i /></div>
              <span>
                {status === 'pending'
                  ? '圖片待管理員審核'
                  : status === 'rejected'
                    ? isTop
                      ? '圖片待管理員審核不通過，請重新上傳'
                      : '圖片未通過審核'
                    : '尚未上傳榜首圖片'}
              </span>
            </div>
          )}
        </div>
        <div className="winner-main">
          <div className="winner-rank">本週第 1 名</div>
          <div className="winner-name">{top.displayName}</div>
          <div className="winner-time">{formatMinutes(top.weeklySeconds || 0)} 溫書時間</div>
          <blockquote className="winner-quote">
            {displayCard.quote || '把努力留在今日，把平靜帶進考場。'}
          </blockquote>
          <div className="winner-actions">
            <button type="button" className="btn btn-sm" onClick={() => void poster()}>
              <Icon name="download" size={13} />
              下載海報
            </button>
            {isTop ? <span className="chip chip-gold">你是本週榜首，可編輯卡片</span> : null}
          </div>

          {canEdit ? (
            <div className="winner-editor">
              <label className="field">
                <span className="label">格言（上限 {WINNER_QUOTE_LIMIT} 字）</span>
                <input
                  className="input"
                  value={quote}
                  onChange={(event) => setQuote(event.target.value)}
                  maxLength={WINNER_QUOTE_LIMIT}
                  placeholder="一句提醒自己保持平靜的話"
                />
              </label>
              <label className="field">
                <span className="label">榜首圖片（JPG / PNG / WebP，上限 5MB）</span>
                <input
                  className="input"
                  type="file"
                  accept="image/*"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                />
              </label>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => void save()} disabled={busy}>
                  {busy ? '儲存中…' : '儲存卡片'}
                </button>
                <span className="tiny muted">
                  {status === 'approved'
                    ? '圖片已通過審核；修改格言不會重新送審。'
                    : status === 'pending'
                      ? '圖片待管理員審核，通過前不會公開展示。'
                      : status === 'rejected'
                        ? '圖片未通過審核，可重新上傳。'
                        : '未有圖片；格言會即時公開。'}
                </span>
              </div>
              {error ? <div className="notice exam">{error}</div> : null}
            </div>
          ) : error ? (
            <div className="notice exam">{error}</div>
          ) : null}
        </div>
      </div>

      {history.length ? (
        <details className="winner-history">
          <summary>歷史榜首牆（最近 {history.length} 週）</summary>
          <div className="winner-history-list">
            {history.map((item) => (
              <div className="winner-history-row" key={item.id}>
                <span className="mono">{winnerWeekLabel(item.weekKey)}</span>
                <span>{item.displayName}</span>
                <span className="tiny muted">{formatMinutes(item.durationSeconds)}</span>
                <span className="winner-history-quote">{item.quote || '—'}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
