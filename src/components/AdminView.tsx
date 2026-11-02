import { useEffect, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import {
  approveWinnerCard,
  deleteWinnerCard,
  deleteWinnerSubmission,
  fetchWinnerCards,
  fetchWinnerSubmission,
  rejectWinnerCard,
  winnerWeekLabel,
  type WinnerCard,
} from '../lib/winner';
import { Icon } from './Icons';

function AdminWinnerRow({ card, onChanged }: { card: WinnerCard; onChanged: () => void }) {
  const [image, setImage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (card.imageStatus === 'approved' && card.imageData) {
      setImage(card.imageData);
      return () => { cancelled = true; };
    }
    void fetchWinnerSubmission(card.weekKey, card.uid)
      .then((submission) => { if (!cancelled) setImage(submission?.imageData || ''); })
      .catch(() => { if (!cancelled) setImage(''); });
    return () => { cancelled = true; };
  }, [card.imageData, card.imageStatus, card.uid, card.weekKey]);

  const review = async (status: 'approved' | 'rejected') => {
    setBusy(true);
    setError('');
    try {
      if (status === 'approved') {
        if (!image) throw new Error('找不到待審圖片，請用戶重新上傳。');
        await approveWinnerCard(card.id, image);
      } else {
        await rejectWinnerCard(card.id);
      }
      onChanged();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`刪除 ${card.displayName} 的本週卡片？`)) return;
    setBusy(true);
    setError('');
    try {
      await deleteWinnerCard(card.id);
      await deleteWinnerSubmission(card.weekKey, card.uid).catch(() => undefined);
      onChanged();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card admin-review-card">
      <div className="admin-review-image">
        {image ? <img src={image} alt="待審核榜首圖片" /> : <span>圖片載入中 / 沒有圖片</span>}
      </div>
      <div className="admin-review-main">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>{card.displayName}</strong>
          <span className="chip">{card.imageStatus}</span>
        </div>
        <div className="tiny muted">
          {winnerWeekLabel(card.weekKey)} · {Math.round(card.durationSeconds / 60)} 分鐘
        </div>
        <div className="admin-review-quote">{card.quote || '（未填格言）'}</div>
        {error ? <div className="notice exam">{error}</div> : null}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void review('approved')} disabled={busy}>
            通過
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => void review('rejected')} disabled={busy}>
            拒絕
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void remove()} disabled={busy}>
            <Icon name="trash" size={13} />
            刪除卡片
          </button>
        </div>
      </div>
    </section>
  );
}

export function AdminView() {
  const { isAdmin, user } = useApp();
  const [cards, setCards] = useState<WinnerCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!isAdmin || !user) {
      setCards([]);
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    void fetchWinnerCards()
      .then((next) => {
        if (!cancelled) {
          setCards(next);
          setError('');
        }
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : String(nextError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [isAdmin, nonce, user]);

  if (!isAdmin) {
    return (
      <div className="stack" style={{ gap: 16 }}>
        <div className="page-head">
          <div>
            <div className="eyebrow">Admin / moderation</div>
            <h1 className="page-title">管理後台</h1>
            <p className="page-subtitle">只有 admins/{'{uid}'} 且 active: true 的帳戶可以審核榜首圖片。</p>
          </div>
        </div>
        <div className="notice exam">
          <Icon name="lock" size={15} />
          <span>你沒有管理員權限。</span>
        </div>
      </div>
    );
  }

  const pending = cards.filter((card) => card.imageStatus === 'pending');
  const reviewed = cards.filter((card) => card.imageStatus === 'approved' || card.imageStatus === 'rejected');

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Admin / moderation</div>
          <h1 className="page-title">榜首卡片審核</h1>
          <p className="page-subtitle">待審圖片不會公開展示；只有 approved 的圖片會渲染於排行榜卡片及海報。</p>
        </div>
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={() => setNonce((value) => value + 1)}>重新整理</button>
          <span className="chip">{pending.length} 待審</span>
        </div>
      </div>

      {error ? <div className="notice exam"><Icon name="info" size={15} /><span>{error}</span></div> : null}

      <section className="card">
        <div className="card-head">
          <div>
            <div className="eyebrow">Pending / image review</div>
            <div className="card-title" style={{ marginTop: 5 }}>待審核圖片</div>
          </div>
          <span className="chip chip-gold">{pending.length}</span>
        </div>
        {loading ? (
          <div className="empty" style={{ minHeight: 120 }}><div className="empty-copy">載入中…</div></div>
        ) : pending.length ? (
          <div className="admin-review-list">
            {pending.map((card) => <AdminWinnerRow key={card.id} card={card} onChanged={() => setNonce((value) => value + 1)} />)}
          </div>
        ) : (
          <div className="empty" style={{ minHeight: 120 }}><div className="empty-copy">目前沒有待審圖片。</div></div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="eyebrow">Reviewed / latest</div>
            <div className="card-title" style={{ marginTop: 5 }}>已審核卡片</div>
          </div>
          <span className="tiny muted">{reviewed.length} 張</span>
        </div>
        {reviewed.length ? (
          <div className="admin-review-list">
            {reviewed.slice(0, 12).map((card) => (
              <AdminWinnerRow key={card.id} card={card} onChanged={() => setNonce((value) => value + 1)} />
            ))}
          </div>
        ) : (
          <div className="empty" style={{ minHeight: 100 }}><div className="empty-copy">暫無已審核卡片。</div></div>
        )}
      </section>
    </div>
  );
}
