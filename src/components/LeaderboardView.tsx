import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LeaderboardEntry } from '../types';
import { LEADERBOARD_METRIC_LABEL } from '../types';
import { useApp } from '../contexts/AppContext';
import { fetchLeaderboardOnce, LEADERBOARD_POLL_MS } from '../lib/cloud';
import { Icon } from './Icons';

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'DS';
  const words = trimmed.split(/\s+/);
  if (words.length > 1) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

function timeLabel(value: Date): string {
  return value.toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function LeaderboardView() {
  const {
    user,
    cloudEnabled,
    cloudReady,
    data,
    signIn,
    updateProfile,
    leaderboardMetric,
    setLeaderboardMetric,
    showToast,
  } = useApp();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const requestRef = useRef(0);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  const loadEntries = useCallback(
    async (manual = false) => {
      if (!cloudEnabled || !user || !cloudReady) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const request = requestRef.current + 1;
      requestRef.current = request;
      if (manual) setRefreshing(true);
      try {
        const next = await fetchLeaderboardOnce();
        if (!mountedRef.current || request !== requestRef.current) return;
        setEntries(next);
        setError('');
        setLastUpdated(new Date());
      } catch (nextError) {
        if (!mountedRef.current || request !== requestRef.current) return;
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current && manual) setRefreshing(false);
      }
    },
    [cloudEnabled, cloudReady, user],
  );

  useEffect(() => {
    if (!cloudEnabled || !user || !cloudReady) {
      requestRef.current += 1;
      setEntries([]);
      setLastUpdated(null);
      setRefreshing(false);
      return;
    }

    let timer: number | null = null;
    let disposed = false;

    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    const start = () => {
      stop();
      if (disposed || document.hidden) return;
      void loadEntries();
      timer = window.setInterval(() => {
        if (!disposed && !document.hidden) void loadEntries();
      }, LEADERBOARD_POLL_MS);
    };

    const onVisibilityChange = () => {
      if (document.hidden) stop();
      else start();
    };

    start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      disposed = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [cloudEnabled, cloudReady, loadEntries, user]);

  const sorted = useMemo(
    () =>
      entries
        .slice()
        .sort((a, b) => {
          const diff = (b[leaderboardMetric] || 0) - (a[leaderboardMetric] || 0);
          return diff || b.totalDays - a.totalDays || a.displayName.localeCompare(b.displayName);
        }),
    [entries, leaderboardMetric],
  );

  const toggleVisibility = async () => {
    setBusy(true);
    const nextValue = !data.profile.leaderboardOptIn;
    try {
      await updateProfile({ leaderboardOptIn: nextValue });
      showToast(nextValue ? '已公開；只會顯示名稱與 streak 數字。' : '已隱藏；你的名字不會出現在排行榜。', 'success');
    } catch (nextError) {
      showToast(nextError instanceof Error ? nextError.message : String(nextError), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Community / gentle accountability</div>
          <h1 className="page-title">同學排行榜</h1>
          <p className="page-subtitle">
            只比較連續打卡 streak。唔會公開科目、任務、筆記、圖片或溫書時數；預設不公開，可以隨時退出。
          </p>
        </div>
        <div className="row">
          <span className="chip"><Icon name="lock" size={11} /> 只讀公開 streak</span>
          <span className="chip">{entries.length} 位</span>
        </div>
      </div>

      {!cloudEnabled ? (
        <>
          <div className="notice gold">
            <Icon name="cloud-off" size={15} />
            <span>排行榜需要 Firebase 登入與 Firestore。目前是本機模式；所有個人功能仍可正常使用。</span>
          </div>
          <div className="leaderboard-layout">
            <section className="card">
              <div className="card-head">
                <div>
                  <div className="eyebrow">Local preview</div>
                  <div className="card-title" style={{ marginTop: 5 }}><Icon name="flame" size={15} />你的本機節奏</div>
                </div>
                <span className="chip chip-gold">只在本機</span>
              </div>
              <div className="card-body">
                <div className="stat-strip" style={{ border: 0 }}>
                  <div className="stat">
                    <div className="stat-value gold">{Object.keys(data.checkins).length}</div>
                    <div className="stat-label">累計打卡日</div>
                  </div>
                  <div className="stat">
                    <div className="stat-value">{data.tasks.filter((task) => !task.completed).length}</div>
                    <div className="stat-label">待完成任務</div>
                  </div>
                  <div className="stat">
                    <div className="stat-value">{data.events.filter((event) => event.type === 'dse').length}</div>
                    <div className="stat-label">DSE 事件</div>
                  </div>
                </div>
                <p className="help" style={{ marginTop: 15 }}>
                  排行榜不是本機功能的替代品。未登入時，你的打卡、熱力圖、錯題庫和分析仍然完整運作，而且不會離開此裝置。
                </p>
              </div>
            </section>
            <section className="card privacy-card">
              <div className="eyebrow">To enable</div>
              <div className="card-title" style={{ marginTop: 6 }}><Icon name="lock" size={15} />開啟排行榜</div>
              <div className="setting-row" style={{ paddingLeft: 0, paddingRight: 0 }}>
                <div>
                  <div className="privacy-label">1. 填入 Firebase</div>
                  <div className="privacy-copy">在 .env.local 加入 VITE_FIREBASE_* 並部署 Firestore rules。</div>
                </div>
              </div>
              <div className="setting-row" style={{ paddingLeft: 0, paddingRight: 0 }}>
                <div>
                  <div className="privacy-label">2. 登入 Google</div>
                  <div className="privacy-copy">任務、打卡與反思會同步到你的私人 Firestore 文件。</div>
                </div>
              </div>
              <div className="setting-row" style={{ paddingLeft: 0, paddingRight: 0, borderBottom: 0 }}>
                <div>
                  <div className="privacy-label">3. 自願公開</div>
                  <div className="privacy-copy">預設隱藏；只公開名稱、streak 與累計天數。</div>
                </div>
              </div>
            </section>
          </div>
        </>
      ) : !user ? (
        <section className="card">
          <div className="empty">
            <div className="empty-icon"><Icon name="lock" /></div>
            <div className="empty-title">登入後才看到排行榜</div>
            <div className="empty-copy">排行榜只對已登入的同學開放；不需要公開個人資料。你亦可以選擇只使用本機模式。</div>
            <button type="button" className="btn btn-primary" onClick={() => void signIn()}>
              使用 Google 登入
            </button>
          </div>
        </section>
      ) : (
        <div className="leaderboard-layout">
          <section className="card">
            <div className="leaderboard-hero">
              <div>
                <div className="eyebrow">Polled / every 60s</div>
                <div className="leaderboard-title">{LEADERBOARD_METRIC_LABEL[leaderboardMetric]}榜</div>
                <div className="help" style={{ marginTop: 5 }}>
                  {leaderboardMetric === 'currentStreak'
                    ? '連續打卡愈長，排名愈前；同分以累計天數排序。'
                    : '累計有效打卡日數；同分以連續打卡排序。'}
                </div>
              </div>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void loadEntries(true)}
                  disabled={refreshing || !cloudReady}
                  aria-label="立即更新排行榜"
                >
                  <Icon name="sync" size={14} className={refreshing ? 'spinning' : undefined} />
                  {refreshing ? '更新中…' : '手動更新'}
                </button>
                <div className="metric-tabs" role="tablist" aria-label="排行榜指標">
                  {(['currentStreak', 'totalDays'] as const).map((metric) => (
                    <button
                      type="button"
                      key={metric}
                      className={`metric-tab${leaderboardMetric === metric ? ' active' : ''}`}
                      onClick={() => setLeaderboardMetric(metric)}
                    >
                      {LEADERBOARD_METRIC_LABEL[metric]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {error ? (
              <div className="notice exam" style={{ margin: 18 }}>
                <Icon name="info" size={15} />
                <span>排行榜讀取失敗：{error}。請確認 Firestore rules 與網路。</span>
              </div>
            ) : null}

            {sorted.length ? (
              <div className="leaderboard-list">
                {sorted.map((entry, index) => {
                  const isMe = entry.uid === user.uid;
                  return (
                    <div className={`leaderboard-row${isMe ? ' me' : ''}`} key={entry.uid}>
                      <span className={`rank${index < 3 ? ' top' : ''}`}>{index + 1}</span>
                      <span className="avatar">{initials(entry.displayName)}</span>
                      <span style={{ minWidth: 0 }}>
                        <span className="leaderboard-name">
                          {entry.displayName}
                          {isMe ? <span className="tiny muted"> · 你</span> : null}
                        </span>
                        <span className="leaderboard-sub">
                          {leaderboardMetric === 'currentStreak' ? `${entry.totalDays} 日累計` : `${entry.currentStreak} 日連續`}
                        </span>
                      </span>
                      <span className="leaderboard-value">
                        {entry[leaderboardMetric]}
                        <span>days</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : lastUpdated === null ? (
              <div className="empty">
                <div className="empty-icon"><Icon name="sync" className="spinning" /></div>
                <div className="empty-title">正在讀取排行榜…</div>
                <div className="empty-copy">只會讀取已公開的名稱、連續打卡與累計天數。</div>
              </div>
            ) : (
              <div className="empty">
                <div className="empty-icon"><Icon name="trophy" /></div>
                <div className="empty-title">暫時未有人公開</div>
                <div className="empty-copy">
                  排行榜預設關閉。你可以選擇公開，令同學之間有一個溫和的互相提醒；唔會顯示任何溫書細節。
                </div>
              </div>
            )}
            <div className="today-foot">
              <span>
                {cloudReady
                  ? lastUpdated
                    ? `最近更新 ${timeLabel(lastUpdated)} · 每 60 秒輪詢；唔會保持即時連線`
                    : '正在讀取已公開的排行榜…'
                  : '等待雲端連線…'}
              </span>
              <span className="mono">
                {refreshing ? 'refreshing' : error ? 'error' : cloudReady ? 'poll 60s' : 'offline'}
              </span>
            </div>
          </section>

          <aside className="stack">
            <section className="card privacy-card">
              <div className="eyebrow">Privacy / opt-in</div>
              <div className="card-title" style={{ marginTop: 6 }}>
                <Icon name="lock" size={15} />
                我的公開設定
              </div>
              <div className="privacy-row">
                <div>
                  <div className="privacy-label">顯示在排行榜</div>
                  <div className="privacy-copy">
                    只會公開你的名稱、連續打卡、累計天數。唔會公開電郵、科目、任務、筆記、圖片或溫書時數。
                  </div>
                </div>
                <button
                  type="button"
                  className={`toggle${data.profile.leaderboardOptIn ? ' on' : ''}`}
                  onClick={() => void toggleVisibility()}
                  disabled={busy || !cloudReady}
                  aria-label={data.profile.leaderboardOptIn ? '設為不公開' : '設為公開'}
                  aria-pressed={data.profile.leaderboardOptIn}
                />
              </div>
              <div className="privacy-row">
                <div>
                  <div className="privacy-label">預設狀態</div>
                  <div className="privacy-copy">預設不公開。每次打卡只更新兩個數字，不建立公開個人檔案。</div>
                </div>
                <span className={`chip${data.profile.leaderboardOptIn ? ' chip-gold' : ''}`}>
                  {data.profile.leaderboardOptIn ? '公開' : '私人'}
                </span>
              </div>
              <div className="privacy-row">
                <div>
                  <div className="privacy-label">防刷設計</div>
                  <div className="privacy-copy">
                    Firestore rules 只准你寫自己的 leaderboard 文件；打卡必須引用一項已完成任務，並以日期作文件 ID，同一日只可一筆。
                  </div>
                </div>
                <Icon name="check" size={16} />
              </div>
            </section>

            <div className="notice gold">
              <Icon name="flame" size={15} />
              <span>
                溫和導向：排行榜不是成績表。連續天數只代表你有回來照顧自己的學習節奏，不代表你比別人努力。
              </span>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
