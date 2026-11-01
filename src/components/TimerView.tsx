import { useEffect, useMemo, useRef, useState } from 'react';
import type { TimerMode, TimerSession } from '../types';
import { useApp } from '../contexts/AppContext';
import { hkDateISO, toHKDateTime } from '../lib/clock';
import { uid } from '../lib/id';
import { primeBell, ringBell } from '../lib/bell';
import { formatMinutes, formatTimer, modeLabel, paperPresets } from '../lib/timer';
import { TimerStats } from './TimerStats';
import { Icon } from './Icons';

interface ActiveTimer {
  mode: TimerMode;
  subjectId: string;
  subjectName: string;
  paper: string;
  notes: string;
  plannedSeconds: number;
  startedAtMs: number;
  runningSince: number | null;
  accumulatedMs: number;
}

export function TimerView() {
  const { data, saveTimerSession, deleteTimerSession, showToast } = useApp();
  const presets = useMemo(() => paperPresets(data.subjects), [data.subjects]);
  const [mode, setMode] = useState<TimerMode>('countdown');
  const [subjectId, setSubjectId] = useState(data.subjects[0]?.id || '');
  const [paperKey, setPaperKey] = useState('custom');
  const [customMinutes, setCustomMinutes] = useState('30');
  const [notes, setNotes] = useState('');
  const [active, setActive] = useState<ActiveTimer | null>(null);
  const [now, setNow] = useState(Date.now());
  const [lastSession, setLastSession] = useState<TimerSession | null>(null);
  const finishingRef = useRef(false);

  const subject = data.subjects.find((item) => item.id === subjectId);
  const subjectPresets = useMemo(
    () => presets.filter((preset) => preset.subjectId === subjectId),
    [presets, subjectId],
  );
  const selectedPreset = subjectPresets.find((preset) => preset.key === paperKey);
  const plannedSeconds = mode === 'countdown'
    ? (selectedPreset ? selectedPreset.minutes * 60 : Math.max(0, Math.round(Number(customMinutes) || 0) * 60))
    : 0;

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

  useEffect(() => {
    if (!active || active.runningSince === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [active?.runningSince]);

  const elapsedMs = active
    ? active.accumulatedMs + (active.runningSince !== null ? Math.max(0, now - active.runningSince) : 0)
    : 0;
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

  const finish = (auto: boolean) => {
    if (!active) return;
    const endedAtMs = Date.now();
    const elapsed = Math.max(0, active.accumulatedMs + (active.runningSince !== null ? endedAtMs - active.runningSince : 0));
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
      endedAt: toHKDateTime(endedAtMs),
      durationSeconds,
      plannedSeconds: active.plannedSeconds,
      notes: active.notes.trim() || undefined,
      completed: true,
    };
    setActive(null);
    setLastSession(session);
    setNow(Date.now());
    finishingRef.current = false;
    if (auto) ringBell();
    showToast(auto ? '倒數完成，已自動記錄。' : '計時完成，已記錄。', 'success');
    void saveTimerSession(session);
  };

  useEffect(() => {
    if (!active || active.mode !== 'countdown' || active.runningSince === null) return;
    if (elapsedMs < active.plannedSeconds * 1000 || finishingRef.current) return;
    finishingRef.current = true;
    finish(true);
  }, [active, elapsedMs]);

  const start = () => {
    if (!subject) {
      showToast('請先選擇科目。', 'error');
      return;
    }
    const planned = mode === 'countdown' ? plannedSeconds : 0;
    if (mode === 'countdown' && (planned < 60 || planned > 600 * 60)) {
      showToast('倒數時長必須介乎 1 至 600 分鐘。', 'error');
      return;
    }
    primeBell();
    finishingRef.current = false;
    setLastSession(null);
    const startMs = Date.now();
    setNow(startMs);
    setActive({
      mode,
      subjectId: subject.id,
      subjectName: selectedPreset?.subjectName || subject.name,
      paper: selectedPreset?.paper || '自訂',
      notes,
      plannedSeconds: planned,
      startedAtMs: startMs,
      runningSince: startMs,
      accumulatedMs: 0,
    });
  };

  const pause = () => {
    const pausedAt = Date.now();
    setNow(pausedAt);
    setActive((current) =>
      current && current.runningSince !== null
        ? {
            ...current,
            accumulatedMs: current.accumulatedMs + Math.max(0, pausedAt - current.runningSince),
            runningSince: null,
          }
        : current,
    );
  };

  const resume = () => {
    primeBell();
    setNow(Date.now());
    setActive((current) => (current ? { ...current, runningSince: Date.now() } : current));
  };

  const abandon = () => {
    if (!active) return;
    if (!window.confirm('放棄這次計時？今次不會寫入紀錄。')) return;
    setActive(null);
    finishingRef.current = false;
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Focus timer / private study log</div>
          <h1 className="page-title">分科計時</h1>
          <p className="page-subtitle">
            用官方 Paper 時長模擬考試，或用正計時記錄溫書時間。完成後只會存入你自己的私人紀錄（Mode A 本機、Mode B Firestore）。
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
              {active ? `${modeLabel(active.mode)}進行中` : '準備計時'}
            </div>
          </div>
          <div className="metric-tabs" role="tablist" aria-label="計時模式">
            <button type="button" role="tab" aria-selected={mode === 'countdown'} className={`metric-tab${mode === 'countdown' ? ' active' : ''}`} onClick={() => { if (!active) setMode('countdown'); }} disabled={Boolean(active)}>倒數</button>
            <button type="button" role="tab" aria-selected={mode === 'stopwatch'} className={`metric-tab${mode === 'stopwatch' ? ' active' : ''}`} onClick={() => { if (!active) setMode('stopwatch'); }} disabled={Boolean(active)}>正計時</button>
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
            <div className={`timer-clock${active?.mode === 'countdown' && remainingSeconds <= 60 ? ' warning' : ''}`} role="timer" aria-label="計時器">
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
                <button type="button" className="btn btn-primary timer-start" onClick={start}>
                  <Icon name="clock" size={15} />
                  {mode === 'countdown' ? '開始倒數' : '開始計時'}
                </button>
              ) : (
                <>
                  {active.runningSince !== null ? (
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
                ? '倒數到 00:00:00 會自動響鈴並記錄；可提前標記完成。'
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
                  <option key={preset.key} value={preset.key}>{preset.subjectName} · {preset.paper}（{preset.minutes} 分）</option>
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
                2025 HKEAA 時間表時長：{selectedPreset.minutes} 分鐘
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
    </div>
  );
}
