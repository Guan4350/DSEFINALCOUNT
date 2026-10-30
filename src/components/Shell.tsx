import { useEffect, useMemo, useState } from 'react';
import type { View } from '../contexts/AppContext';
import { useApp } from '../contexts/AppContext';
import { SPARK_READ_LIMIT, SPARK_WRITE_LIMIT, usagePercent } from '../lib/usage';
import { Dashboard } from './Dashboard';
import { CalendarView } from './CalendarView';
import { TasksView } from './TasksView';
import { GalleryView } from './GalleryView';
import { AnalyticsView } from './AnalyticsView';
import { LeaderboardView } from './LeaderboardView';
import { SettingsView } from './SettingsView';
import { Icon, type IconName } from './Icons';

const NAV: { section: string; items: { view: View; label: string; icon: IconName }[] }[] = [
  {
    section: 'Study',
    items: [
      { view: 'dashboard', label: '總覽', icon: 'grid' },
      { view: 'calendar', label: '日曆', icon: 'calendar' },
      { view: 'tasks', label: '任務', icon: 'check-square' },
    ],
  },
  {
    section: 'Reflect',
    items: [
      { view: 'gallery', label: '錯題相簿', icon: 'image' },
      { view: 'analytics', label: '學習分析', icon: 'chart' },
      { view: 'leaderboard', label: '排行榜', icon: 'trophy' },
    ],
  },
  {
    section: 'System',
    items: [{ view: 'settings', label: '設定', icon: 'settings' }],
  },
];

const TITLES: Record<View, string> = {
  dashboard: '總覽',
  calendar: '日曆',
  tasks: '任務',
  gallery: '錯題相簿',
  analytics: '學習分析',
  leaderboard: '排行榜',
  settings: '設定',
};

export function Shell() {
  const {
    view,
    setView,
    theme,
    setTheme,
    data,
    semester,
    user,
    authLoading,
    cloudEnabled,
    cloudReady,
    cloudBusy,
    needsImport,
    importLocalData,
    signIn,
    refreshCloud,
    toasts,
    dismissToast,
    usage,
  } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setSidebarOpen(false);
  }, [view]);

  const readPercent = usagePercent(usage.reads, SPARK_READ_LIMIT);
  const writePercent = usagePercent(usage.writes, SPARK_WRITE_LIMIT);
  const usageTone = readPercent >= 85 || writePercent >= 85 ? 'danger' : readPercent >= 60 || writePercent >= 60 ? 'warn' : '';

  const title = useMemo(() => TITLES[view], [view]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">跳至主要內容</a>
      {sidebarOpen ? <button type="button" className="sidebar-scrim" aria-label="關閉選單" onClick={() => setSidebarOpen(false)} /> : null}
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`} aria-label="主要導覽">
        <div className="brand">
          <div className="brand-mark">D</div>
          <div className="brand-text">
            <span className="brand-name">DSE Candidate</span>
            <span className="brand-sub">Personal Learning</span>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((group) => (
            <div key={group.section}>
              <div className="nav-section">{group.section}</div>
              {group.items.map((item) => (
                <button
                  key={item.view}
                  type="button"
                  className={`nav-item${view === item.view ? ' active' : ''}`}
                  onClick={() => setView(item.view)}
                  aria-current={view === item.view ? 'page' : undefined}
                >
                  <Icon name={item.icon} size={17} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sync-mini">
            <div>
              <span className={`sync-dot ${cloudReady ? 'ok' : ''}`} />
              <strong>{cloudEnabled ? (cloudReady ? 'Cloud synced' : 'Cloud idle') : 'Local only'}</strong>
            </div>
            <div>{data.tasks.filter((task) => !task.completed).length} open tasks · {semester.shortLabel}</div>
            <div>{data.profile.displayName}</div>
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button type="button" className="icon-btn menu-toggle" onClick={() => setSidebarOpen(true)} aria-label="開啟選單">
              <Icon name="menu" />
            </button>
            <div>
              <div className="topbar-context">DSE Candidate / {semester.shortLabel}</div>
              <div className="topbar-title">{title}</div>
            </div>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="icon-btn theme-toggle"
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              title={theme === 'light' ? '切換深色模式' : '切換淺色模式'}
              aria-label={theme === 'light' ? '切換深色模式' : '切換淺色模式'}
            >
              <Icon name={theme === 'light' ? 'moon' : 'sun'} size={16} />
            </button>
            <span className={`usage-badge ${usageTone}`} title="今日 Firestore 用量估算（非官方帳單）">
              <span className="dot" />
              R {usage.reads.toLocaleString()} · W {usage.writes.toLocaleString()}
            </span>
            {authLoading ? (
              <span className="tiny muted">檢查登入…</span>
            ) : user ? (
              <button type="button" className="auth-button" onClick={() => setView('settings')} title="帳戶設定">
                <span className="avatar">
                  {user.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : (user.displayName || 'D').slice(0, 1)}
                </span>
                <span className="auth-name">{user.displayName || data.profile.displayName}</span>
                <Icon name="settings" size={13} />
              </button>
            ) : cloudEnabled ? (
              <button type="button" className="btn btn-sm" onClick={() => void signIn()}>
                <Icon name="user" size={13} />
                Google 登入
              </button>
            ) : (
              <span className="chip">本機模式</span>
            )}
          </div>
        </header>

        <main className="page" id="main">
          {!cloudReady ? (
            <div className="cloud-banner">
              <span>
                {!cloudEnabled ? (
                  <>
                    <strong>本機模式。</strong> 任務、日曆、圖片與分析正常運作；登入 Firebase 後可同步與使用排行榜。
                  </>
                ) : !user ? (
                  <>
                    <strong>尚未登入。</strong> 你現在可以使用本機模式；Google 登入後可手動把本機資料上傳到你的私人 Firestore。
                  </>
                ) : cloudBusy ? (
                  <><strong>正在載入雲端資料…</strong> 只會讀取你授權的文件。</>
                ) : (
                  <><strong>雲端未連接。</strong> 請檢查網路或重新載入；本機資料仍安全。</>
                )}
              </span>
              <div className="row">
                {cloudEnabled && !user ? (
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => void signIn()}>登入</button>
                ) : null}
                {user && !cloudReady && !cloudBusy ? (
                  <button type="button" className="btn btn-sm" onClick={() => void refreshCloud()}>重試</button>
                ) : null}
                {!cloudEnabled ? (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setView('settings')}>設定</button>
                ) : null}
              </div>
            </div>
          ) : needsImport ? (
            <div className="cloud-banner">
              <span><strong>本機有資料未上傳。</strong> 你已登入，但雲端仍有本機獨有的任務／事件／反思。上傳後才會跨裝置可見。</span>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void importLocalData()} disabled={cloudBusy}>{cloudBusy ? '上傳中…' : '上傳本機資料'}</button>
            </div>
          ) : null}

          {view === 'dashboard' ? <Dashboard /> : null}
          {view === 'calendar' ? <CalendarView /> : null}
          {view === 'tasks' ? <TasksView /> : null}
          {view === 'gallery' ? <GalleryView /> : null}
          {view === 'analytics' ? <AnalyticsView /> : null}
          {view === 'leaderboard' ? <LeaderboardView /> : null}
          {view === 'settings' ? <SettingsView /> : null}
        </main>
      </div>

      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div className={`toast ${toast.tone}`} key={toast.id} role="status">
            <Icon name={toast.tone === 'error' ? 'info' : toast.tone === 'success' ? 'check' : 'info'} size={14} />
            <span>{toast.message}</span>
            <button type="button" className="toast-close" onClick={() => dismissToast(toast.id)} aria-label="關閉提示">
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
