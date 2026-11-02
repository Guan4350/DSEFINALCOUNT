import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TimerMode, TimerSession } from '../types';
import { useApp } from '../contexts/AppContext';
import { formatHKClock, hkDateISO, toHKDateTime } from '../lib/clock';
import { uid } from '../lib/id';
import { primeBell, ringBell } from '../lib/bell';
import {
  activeTimerElapsedMs,
  getServerOffsetMs,
  loadActiveTimerLocal,
  saveActiveTimerLocal,
  setServerOffsetMs,
  type ActiveTimerState,
} from '../lib/activeTimer';
import {
  clearCloudActiveTimer,
  fetchCloudActiveTimer,
  saveCloudActiveTimer,
  startCloudActiveTimer,
} from '../lib/cloud';
import { formatMinutes, formatTimer, modeLabel, paperPresets } from '../lib/timer';
import { TimerStats } from './TimerStats';
import { Icon } from './Icons';

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

interface WakeLockNavigator {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
}

function clockHM(ms: number): string {
  return formatHKClock(ms).slice(0, 5);
}

export function TimerView() {
  const { data, user, cloudReady, saveTimerSession, deleteTimerSession, showToast } = useApp();
  const presets = useMemo(() => paperPresets(data.subjects), [data.subjects]);
  const [mode, setMode] = useState<TimerMode>('countdown');
  const [subjectId, setSubjectId] = useState(data.subjects[0]?.id || '');
  const [paperKey, setPaperKey] = useState('custom');
  const [customMinutes, setCustomMinutes] = useState('30');
  const [notes, setNotes] = useState('');
  const [active, setActive] = useState<ActiveTimerState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [serverOffset, setServerOffset] = useState(() => getServerOffsetMs());
  const [lastSession, setLastSession] = useState<TimerSession | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [starting, setStarting] = useState(false);
  const finishingRef = useRef(false);
  const focusRef = useRef<HTMLDivElement>(null);
  const nativeFullscreenRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const userActionRef = useRef(false);
  const syncSeqRef = useRef(0);
  const alert15Ref = useRef(false);
  const alert5Ref = useRef(false);
  const activeOwnerRef = useRef<string>(user?.uid || 'local');

  const subject = data.subjects.find((item) => item.id === subjectId);
  const subjectPresets = useMemo(
    () => presets.filter((preset) => preset.subjectId === subjectId),
    [presets, subjectId],
  );
  const selectedPreset = subjectPresets.find((preset) => preset.key === paperKey);
  const plannedSeconds = mode === 'countdown'
    ? (selectedPreset ? selectedPreset.minutes * 60 : Math.max(0, Math.round(Number(customMinutes) || 0) * 60))
    : 0;

  const hydrateSetup = (state: ActiveTimerState) => {
    setMode(state.mode);
    setSubjectId(state.subjectId);
    const preset = presets.find((item) => item.subjectId === state.subjectId && item.paper === state.paper);
    setPaperKey(preset?.key || 'custom');
    setCustomMinutes(String(Math.max(1, Math.round((state.plannedSeconds || state.referenceSeconds || 3600) / 60))));
    setNotes(state.notes);
  };

  useEffect(() => {
    const first = presets.find((preset) => preset.subjectId === subjectId);
    if (active) return;
    if (first) {
      setPaperKey(first.key);
      setCustomMinutes(String(first.minutes));
    } else {
      setPaperKey('custom');
    }
  }, [active, presets, subjectId]);

  // Restore locally first, then prefer the server copy when available.
  useEffect(() => {
    let cancelled = false;
    const local = loadActiveTimerLocal(user?.uid);
    if (local) {
      activeOwnerRef.current = user?.uid || 'local';
      setActive(local);
      hydrateSetup(local);
      setNow(Date.now());
      showToast('已復原上次未完成的計時。', 'info');
    }
    if (!user || !cloudReady) return () => { cancelled = true; };
    void fetchCloudActiveTimer(user.uid)
      .then((remote) => {
        if (cancelled || userActionRef.current || !remote) return;
        activeOwnerRef.current = user.uid;
        setActive(remote);
        hydrateSetup(remote);
        setNow(Date.now());
        saveActiveTimerLocal(remote, user.uid);
        setServerOffset(getServerOffsetMs());
        showToast('已從雲端復原計時狀態。', 'success');
      })
      .catch(() => {
        // Local state remains the fallback when the network is unavailable.
      });
    return () => { cancelled = true; };
  }, [cloudReady, showToast, user?.uid]);

  useEffect(() => {
    saveActiveTimerLocal(active, user?.uid);
  }, [active, user?.uid]);

  useEffect(() => {
    const owner = user?.uid || 'local';
    if (active && activeOwnerRef.current !== owner) {
      // Never carry one account's running timer into another account's view.
      setActive(null);
      setFocusMode(false);
      setStarting(false);
      finishingRef.current = false;
    }
    activeOwnerRef.current = owner;
  }, [user?.uid]);

  useEffect(() => {
    if (!active || active.runningSinceMs === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [active?.runningSinceMs]);

  const serverNowMs = now + serverOffset;
  const elapsedMs = active ? activeTimerElapsedMs(active, serverNowMs) : 0;
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const remainingSeconds = active && active.mode === 'countdown'
    ? Math.max(0, active.plannedSeconds - elapsedSeconds)
    : 0;
  const displaySeconds = active
    ? active.mode === 'countdown'
      ? remainingSeconds
      : elapsedSeconds
    : mode === 'countdown'
      ? plannedSeconds
      : 0;
  const alertClass = active && active.mode === 'countdown'
    ? remainingSeconds <= 300
      ? ' warning-5'
      : remainingSeconds <= 900
        ? ' warning-15'
        : ''
    : '';

  const releaseWakeLock = () => {
    const current = wakeLockRef.current;
    wakeLockRef.current = null;
    if (current) void current.release().catch(() => undefined);
  };

  const requestWakeLock = async () => {
    if (document.visibilityState !== 'visible') return;
    const wakeLock = (navigator as Navigator & WakeLockNavigator).wakeLock;
    if (!wakeLock || wakeLockRef.current) return;
    try {
      wakeLockRef.current = await wakeLock.request('screen');
    } catch {
      // Wake Lock is an enhancement; unsupported or denied is not fatal.
    }
  };

  useEffect(() => {
    if (!active || active.runningSinceMs === null) {
      releaseWakeLock();
      return;
    }
    void requestWakeLock();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void requestWakeLock();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      releaseWakeLock();
    };
  }, [active?.runningSinceMs]);

  useEffect(() => {
    if (!focusMode) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      return;
    }
    const element = focusRef.current;
    if (element?.requestFullscreen && !document.fullscreenElement) {
      void element.requestFullscreen().then(() => {
        nativeFullscreenRef.current = true;
      }).catch(() => {
        nativeFullscreenRef.current = false;
      });
    }
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && nativeFullscreenRef.current) {
        nativeFullscreenRef.current = false;
        setFocusMode(false);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [focusMode]);

  useEffect(() => {
    if (!focusMode) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFocusMode(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [focusMode]);

  useEffect(() => {
    if (!active || active.mode !== 'countdown' || active.runningSinceMs === null) return;
    if (remainingSeconds <= 900 && !alert15Ref.current) {
      alert15Ref.current = true;
      showToast('倒數剩 15 分鐘。', 'info');
    }
    if (remainingSeconds <= 300 && !alert5Ref.current) {
      alert5Ref.current = true;
      showToast('倒數剩 5 分鐘，準備收尾。', 'info');
    }
  }, [active, remainingSeconds, showToast]);

  const finish = (auto: boolean) => {
    if (!active) return;
    const targetEnd = active.mode === 'countdown' && auto
      ? active.startedAtMs + active.plannedSeconds * 1000
      : Date.now() + serverOffset;
    const elapsed = activeTimerElapsedMs(active, targetEnd);
    const durationSeconds = auto && active.mode === 'countdown'
      ? active.plannedSeconds
      : Math.max(1, Math.round(elapsed / 1000));
    const session: TimerSession = {
      id: uid('timer'),
      date: hkDateISO(new Date(active.startedAtMs)),
      subjectId: active.subjectId,
      subjectName: active.subjectName,
      paper: active.paper,
      mode: active.mode,
      startedAt: toHKDateTime(active.startedAtMs),
      endedAt: toHKDateTime(targetEnd),
      durationSeconds,
      plannedSeconds: active.plannedSeconds,
      notes: active.notes.trim() || undefined,
      completed: true,
    };
    setActive(null);
    saveActiveTimerLocal(null, user?.uid);
    setLastSession(session);
    setNow(Date.now());
    setFocusMode(false);
    finishingRef.current = false;
    releaseWakeLock();
    if (auto) ringBell();
    showToast(auto ? '倒數完成，已自動記錄。' : '計時完成，已記錄。', 'success');
    void saveTimerSession(session);
    if (user && cloudReady) void clearCloudActiveTimer(user.uid).catch(() => undefined);
    syncSeqRef.current += 1;
    userActionRef.current = false;
    setStarting(false);
  };

  useEffect(() => {
    if (!active || active.mode !== 'countdown' || active.runningSinceMs === null) return;
    if (elapsedMs < active.plannedSeconds * 1000 || finishingRef.current) return;
    finishingRef.current = true;
    finish(true);
  }, [active, elapsedMs]);

  const start = async () => {
    if (!subject) {
      showToast('請先選擇科目。', 'error');
      return;
    }
    const planned = mode === 'countdown' ? plannedSeconds : 0;
    if (mode === 'countdown' && (planned < 60 || planned > 600 * 60)) {
      showToast('倒數時長必須介乎 1 至 600 分鐘。', 'error');
      return;
    }
    setStarting(true);
    primeBell();
    finishingRef.current = false;
    alert15Ref.current = false;
    alert5Ref.current = false;
    userActionRef.current = true;
    activeOwnerRef.current = user?.uid || 'local';
    setLastSession(null);
    const startMs = Date.now();
    const base: ActiveTimerState = {
      mode,
      subjectId: subject.id,
      subjectName: selectedPreset?.subjectName || subject.name,
      paper: selectedPreset?.paper || '自訂',
      notes,
      plannedSeconds: planned,
      referenceSeconds: selectedPreset?.minutes ? selectedPreset.minutes * 60 : 3600,
      startedAtMs: startMs,
      runningSinceMs: startMs,
      accumulatedMs: 0,
      status: 'running',
    };
    setNow(startMs);
    setActive(base);
    setFocusMode(true);
    if (user && cloudReady) {
      const seq = ++syncSeqRef.current;
      try {
        const result = await startCloudActiveTimer(user.uid, base);
        if (seq === syncSeqRef.current) {
          setServerOffset(result.offsetMs);
          setServerOffsetMs(result.offsetMs);
          setActive(result.state);
          setNow(Date.now());
        }
      } catch (error) {
        showToast(`雲端計時同步失敗，會在本機繼續：${error instanceof Error ? error.message : String(error)}`, 'info');
      }
    }
    setStarting(false);
  };

  const pause = () => {
    if (!active) return;
    const pausedAt = Date.now() + serverOffset;
    const next: ActiveTimerState = {
      ...active,
      accumulatedMs: active.accumulatedMs + (active.runningSinceMs !== null ? Math.max(0, pausedAt - active.runningSinceMs) : 0),
      runningSinceMs: null,
      status: 'paused',
    };
    setActive(next);
    setNow(Date.now());
    releaseWakeLock();
    if (user && cloudReady) {
      const seq = ++syncSeqRef.current;
      void saveCloudActiveTimer(user.uid, next)
        .then((result) => {
          if (seq === syncSeqRef.current) {
            setServerOffset(result.offsetMs);
            setServerOffsetMs(result.offsetMs);
            setActive(result.state);
          }
        })
        .catch(() => undefined);
    }
  };

  const resume = () => {
    if (!active) return;
    const runningSinceMs = Date.now() + serverOffset;
    const next: ActiveTimerState = {
      ...active,
      runningSinceMs,
      status: 'running',
    };
    setActive(next);
    setNow(Date.now());
    primeBell();
    if (user && cloudReady) {
      const seq = ++syncSeqRef.current;
      void saveCloudActiveTimer(user.uid, next)
        .then((result) => {
          if (seq === syncSeqRef.current) {
            setServerOffset(result.offsetMs);
            setServerOffsetMs(result.offsetMs);
            setActive(result.state);
          }
        })
        .catch(() => undefined);
    }
  };

  const abandon = () => {
    if (!active) return;
    if (!window.confirm('放棄這次計時？今次不會寫入紀錄。')) return;
    setActive(null);
    saveActiveTimerLocal(null, user?.uid);
    setFocusMode(false);
    finishingRef.current = false;
    releaseWakeLock();
    syncSeqRef.current += 1;
    userActionRef.current = false;
    if (user && cloudReady) void clearCloudActiveTimer(user.uid).catch(() => undefined);
  };

  const focusTimer = active;
  const focusModeValue = focusTimer?.mode || mode;
  const focusSubject = focusTimer?.subjectName || selectedPreset?.subjectName || subject?.name || '未選擇科目';
  const focusPaper = focusTimer?.paper || selectedPreset?.paper || '自訂';
  const focusReference = focusTimer?.referenceSeconds || (selectedPreset?.minutes ? selectedPreset.minutes * 60 : 3600);
  const focusProgress = focusTimer
    ? focusTimer.mode === 'countdown'
      ? Math.min(1, Math.max(0, elapsedMs / Math.max(1, focusTimer.plannedSeconds * 1000)))
      : Math.min(1, Math.max(0, elapsedMs / Math.max(1, focusReference * 1000)))
    : 0;
  const focusStart = focusTimer ? clockHM(focusTimer.startedAtMs) : '--:--';
  const focusEnd = focusTimer && focusTimer.mode === 'countdown'
    ? clockHM(focusTimer.startedAtMs + focusTimer.plannedSeconds * 1000)
    : focusTimer
      ? '自由結束'
      : mode === 'countdown'
        ? clockHM(Date.now() + plannedSeconds * 1000)
        : '自由結束';
  const focusMiddle = focusTimer
    ? focusTimer.mode === 'countdown'
      ? `剩餘 ${formatTimer(remainingSeconds)}`
      : `已過 ${formatTimer(elapsedSeconds)}`
    : '準備開始';

  const fullscreen = focusMode ? createPortal(
    <div ref={focusRef} className="timer-focus" role="dialog" aria-modal="true" aria-label="全屏計時器">
      <div className="timer-focus-top">
        <div>
          <div className="timer-focus-eyebrow">
            {focusModeValue === 'countdown' ? 'MOCK EXAM / COUNTDOWN' : 'STUDY / STOPWATCH'}
          </div>
          <div className="timer-focus-title">
            {focusSubject}
            <span>·</span>
            {focusPaper}
          </div>
        </div>
        <button type="button" className="timer-focus-exit" onClick={() => setFocusMode(false)} aria-label="退出全屏">
          退出全屏
        </button>
      </div>

      <div className="timer-focus-center">
        <div className={`timer-focus-clock${alertClass}`}>
          {formatTimer(displaySeconds)}
        </div>
        <div className="timer-focus-sub">
          {focusTimer
            ? focusTimer.mode === 'countdown'
              ? `原定 ${formatMinutes(focusTimer.plannedSeconds)} · ${focusTimer.runningSinceMs === null ? '已暫停' : '進行中'}`
              : `已累積 ${formatMinutes(elapsedSeconds)} · ${focusTimer.runningSinceMs === null ? '已暫停' : '進行中'}`
            : mode === 'countdown'
              ? `預備 ${formatMinutes(plannedSeconds)}`
              : '按開始後累積溫書時間'}
        </div>

        <div className="timer-focus-progress">
          <div className="timer-focus-progress-labels">
            <span><em>開始</em>{focusStart}</span>
            <strong>{focusMiddle}</strong>
            <span><em>結束</em>{focusEnd}</span>
          </div>
          <div className="timer-focus-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(focusProgress * 100)}>
            <div
              className={`timer-focus-fill${alertClass ? ' danger' : ''}`}
              style={{ width: `${Math.max(0, Math.min(100, focusProgress * 100))}%` }}
            />
          </div>
          <div className="timer-focus-progress-foot">
            <span>{focusTimer?.mode === 'stopwatch' ? `參考時長 ${formatMinutes(focusReference)}` : '倒數進度'}</span>
            <span>{Math.round(focusProgress * 100)}%</span>
          </div>
          <div className="newton-cradle" aria-hidden="true">
            <i /><i /><i /><i /><i />
          </div>
        </div>
      </div>

      <div className="timer-focus-actions">
        {focusTimer ? (
          <>
            {focusTimer.runningSinceMs !== null ? (
              <button type="button" className="btn btn-primary" onClick={pause}>暫停</button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={resume}>繼續</button>
            )}
            <button type="button" className="btn" onClick={() => finish(false)}>標記完成</button>
            <button type="button" className="btn btn-ghost" onClick={abandon}>放棄</button>
          </>
        ) : (
          <button type="button" className="btn btn-primary timer-focus-start" onClick={() => void start()} disabled={starting}>
            {starting ? '同步中…' : `開始${mode === 'countdown' ? '倒數' : '計時'}`}
          </button>
        )}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Focus timer / private study log</div>
          <h1 className="page-title">分科計時</h1>
          <p className="page-subtitle">
            用官方 Paper 時長模擬考試，或用正計時記錄溫書時間。重新整理、切背景都會按伺服器時間戳復原。
          </p>
        </div>
        <span className="chip chip-gold">{data.timerSessions.length} 節紀錄</span>
      </div>

      <section className="card timer-card">
        <div className="card-head timer-card-head">
          <div>
            <div className="eyebrow">Mode / paper / duration</div>
            <div className="card-title" style={{ marginTop: 5 }}>
              <Icon name="clock" size={15} />
              {active ? `${modeLabel(active.mode)}進行中${active.runningSinceMs === null ? '（已暫停）' : ''}` : '準備計時'}
            </div>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <div className="metric-tabs" role="tablist" aria-label="計時模式">
              <button type="button" role="tab" aria-selected={mode === 'countdown'} className={`metric-tab${mode === 'countdown' ? ' active' : ''}`} onClick={() => { if (!active) setMode('countdown'); }} disabled={Boolean(active)}>倒數</button>
              <button type="button" role="tab" aria-selected={mode === 'stopwatch'} className={`metric-tab${mode === 'stopwatch' ? ' active' : ''}`} onClick={() => { if (!active) setMode('stopwatch'); }} disabled={Boolean(active)}>正計時</button>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => setFocusMode(true)}>全屏</button>
          </div>
        </div>

        <div className="timer-body">
          <div className="timer-display-panel">
            <div className="timer-kicker">
              {active ? (
                <>
                  <span>{active.subjectName}</span>
                  <span>·</span>
                  <span>{active.paper}</span>
                  <span>·</span>
                  <span>{active.mode === 'countdown' ? '模擬考試' : '溫書時長'}</span>
                </>
              ) : (
                <>
                  <span>{subject?.name || '未選擇科目'}</span>
                  <span>·</span>
                  <span>{selectedPreset?.paper || '自訂'}</span>
                  <span>·</span>
                  <span>{mode === 'countdown' ? '模擬考試' : '溫書時長'}</span>
                </>
              )}
            </div>
            <div className={`timer-clock${alertClass}`} role="timer" aria-label="計時器">
              {formatTimer(displaySeconds)}
            </div>
            <div className="timer-under">
              {active ? (
                active.mode === 'countdown'
                  ? `原定 ${formatMinutes(active.plannedSeconds)} · 剩餘 ${formatMinutes(remainingSeconds)}`
                  : `已記錄 ${formatMinutes(elapsedSeconds)}`
              ) : mode === 'countdown'
                ? `預備 ${formatMinutes(plannedSeconds)}`
                : '按開始後累積溫書時間'}
            </div>

            <div className="timer-controls">
              {!active ? (
                <button type="button" className="btn btn-primary timer-start" onClick={() => void start()} disabled={starting}>
                  <Icon name="clock" size={15} />
                  {starting ? '同步中…' : mode === 'countdown' ? '開始倒數' : '開始計時'}
                </button>
              ) : (
                <>
                  {active.runningSinceMs !== null ? (
                    <button type="button" className="btn btn-primary" onClick={pause}>暫停</button>
                  ) : (
                    <button type="button" className="btn btn-primary" onClick={resume}>繼續</button>
                  )}
                  <button type="button" className="btn" onClick={() => finish(false)}>標記完成</button>
                  <button type="button" className="btn btn-ghost" onClick={abandon}>放棄</button>
                </>
              )}
            </div>
            <div className="tiny muted timer-note">
              {mode === 'countdown'
                ? '倒數 15 分鐘及 5 分鐘會變色提醒；到 00:00:00 會響鈴並自動記錄。'
                : '正計時不會自動停止；完成後按「標記完成」儲存。'}
            </div>
          </div>

          <div className="timer-setup-panel">
            {lastSession && !active ? (
              <div className="timer-result">
                <div className="timer-result-head">
                  <span className="timer-result-icon"><Icon name="check" size={14} /></span>
                  <strong>已記錄本次計時</strong>
                </div>
                <div className="timer-result-body">
                  {lastSession.subjectName} · {lastSession.paper}
                  <br />
                  {modeLabel(lastSession.mode)} · {formatMinutes(lastSession.durationSeconds)}
                  <br />
                  {lastSession.startedAt.slice(11, 16)}–{lastSession.endedAt.slice(11, 16)}
                </div>
                <button type="button" className="btn btn-sm" onClick={() => setLastSession(null)}>再計一次</button>
              </div>
            ) : null}

            <label className="field">
              <span className="label">科目</span>
              <select className="select" value={subjectId} onChange={(event) => setSubjectId(event.target.value)} disabled={Boolean(active)}>
                {data.subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="label">Paper / 項目</span>
              <select className="select" value={paperKey} onChange={(event) => setPaperKey(event.target.value)} disabled={Boolean(active)}>
                <option value="custom">{mode === 'countdown' ? '自訂時長' : '不指定 Paper'}</option>
                {subjectPresets.map((preset) => (
                  <option key={preset.key} value={preset.key}>{preset.subjectName} · {preset.paper}（{preset.startTime} · {preset.minutes} 分）</option>
                ))}
              </select>
            </label>
            {mode === 'countdown' && !selectedPreset ? (
              <label className="field">
                <span className="label">自訂時長（分鐘）</span>
                <input className="input" type="number" min={1} max={600} value={customMinutes} onChange={(event) => setCustomMinutes(event.target.value)} disabled={Boolean(active)} />
              </label>
            ) : null}
            {selectedPreset ? (
              <div className="timer-official">
                <Icon name="info" size={13} />
                2025 HKEAA 時間表：{selectedPreset.startTime}–{selectedPreset.endTime}（{selectedPreset.minutes} 分鐘）
              </div>
            ) : null}
            <label className="field">
              <span className="label">備註（可選）</span>
              <textarea className="textarea" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="例：完成 Paper 1 Q1–Q20；錯題待重做" maxLength={1000} disabled={Boolean(active)} />
            </label>
          </div>
        </div>
      </section>

      <TimerStats sessions={data.timerSessions} subjects={data.subjects} onDelete={deleteTimerSession} />
      {fullscreen}
    </div>
  );
}
