import { useEffect, useState } from 'react';
import type { CalendarEvent, CalendarSyncConfig, Subject } from '../types';
import { useApp } from '../contexts/AppContext';
import { importIcalInput, loadCalendarSyncConfig, saveCalendarConfig, syncGoogleNow } from '../lib/calendarSync';
import { clearGoogleToken, connectCalendar, hasGoogleCalendarToken } from '../lib/googleCalendar';
import { Icon } from './Icons';

interface CalendarSyncPanelProps {
  uid: string | null;
  subjects: Subject[];
  syncedEvents: CalendarEvent[];
  onRefresh: () => Promise<void>;
  onGoogleAvailability: (available: boolean) => void;
}

export function CalendarSyncPanel({
  uid,
  subjects,
  syncedEvents,
  onRefresh,
  onGoogleAvailability,
}: CalendarSyncPanelProps) {
  const { showToast } = useApp();
  const [config, setConfig] = useState<CalendarSyncConfig | null>(null);
  const [busy, setBusy] = useState<'connect' | 'sync' | 'ical' | 'disconnect' | null>(null);
  const [icalInput, setIcalInput] = useState('');
  const [icalProxy, setIcalProxy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!uid) {
      setConfig(null);
      onGoogleAvailability(false);
      return () => { cancelled = true; };
    }
    void loadCalendarSyncConfig(uid)
      .then((next) => {
        if (cancelled) return;
        setConfig(next);
        setIcalProxy(next.icalProxyUrl || '');
        onGoogleAvailability(next.googleConnected && hasGoogleCalendarToken());
      })
      .catch(() => {
        if (!cancelled) setConfig(null);
      });
    return () => { cancelled = true; };
  }, [onGoogleAvailability, uid]);

  const connect = async () => {
    if (!uid) {
      showToast('請先登入再連接 Google Calendar。', 'error');
      return;
    }
    setBusy('connect');
    setError('');
    try {
      await connectCalendar();
      const next = await saveCalendarConfig(uid, {
        googleConnected: true,
        lastError: '',
      });
      setConfig(next);
      onGoogleAvailability(true);
      showToast('Google Calendar 已授權；請按「立即同步」。', 'success');
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      showToast(`連接失敗：${message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    if (!uid) return;
    if (config?.lastSyncAt && Date.now() - new Date(config.lastSyncAt).getTime() < 60_000) {
      showToast('為避免 API 超限，請最少相隔 60 秒再手動同步。', 'info');
      return;
    }
    setBusy('sync');
    setError('');
    try {
      const result = await syncGoogleNow(uid, subjects, syncedEvents);
      await onRefresh();
      const next = await loadCalendarSyncConfig(uid);
      setConfig(next);
      onGoogleAvailability(next.googleConnected && hasGoogleCalendarToken());
      showToast(
        `同步完成：拉取 ${result.pulled}、推送 ${result.pushed}、移除 ${result.removed}。`,
        'success',
      );
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      await saveCalendarConfig(uid, { lastError: message }).catch(() => undefined);
      showToast(`同步失敗：${message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const importIcal = async () => {
    if (!uid) {
      showToast('請先登入再匯入 iCal。', 'error');
      return;
    }
    if (!icalInput.trim()) {
      setError('請貼上 .ics 網址或完整 iCalendar 內容。');
      return;
    }
    setBusy('ical');
    setError('');
    try {
      const result = await importIcalInput(icalInput, uid, subjects, icalProxy);
      await onRefresh();
      const next = await loadCalendarSyncConfig(uid);
      setConfig(next);
      showToast(
        `${result.imported} 個 iCal 事件已匯入（只讀，不會寫回 Apple）。${result.warnings[0] || ''}`,
        'success',
      );
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      showToast(`iCal 匯入失敗：${message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!uid) return;
    setBusy('disconnect');
    try {
      clearGoogleToken();
      const next = await saveCalendarConfig(uid, { googleConnected: false, lastError: '' });
      setConfig(next);
      onGoogleAvailability(false);
      showToast('已中斷 Google Calendar 授權；已匯入的事件仍保留。', 'info');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(null);
    }
  };

  const connected = Boolean(config?.googleConnected && hasGoogleCalendarToken());
  const syncedCount = syncedEvents.length;

  return (
    <section className="card calendar-sync-panel">
      <div className="calendar-sync-head">
        <div>
          <div className="eyebrow">Calendar sync / manual</div>
          <h2>外部日曆</h2>
          <p className="help">
            Google Calendar 雙向同步；Apple iCal 只單向匯入。每次同步由你手動觸發，避免 API 超限。
          </p>
        </div>
        <span className={`chip ${connected ? 'chip-gold' : ''}`}>
          <Icon name={connected ? 'check' : 'sync'} size={12} />
          {connected ? 'Google 已連接' : 'Google 未連接'}
        </span>
      </div>

      <div className="calendar-sync-grid">
        <div className="calendar-sync-block">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>Google Calendar</strong>
            <span className="tiny muted">OAuth · 雙向</span>
          </div>
          <div className="help">
            {config?.lastSyncAt ? `上次同步：${new Date(config.lastSyncAt).toLocaleString('zh-HK')}` : '尚未同步。'}
            {' '}已匯入 {syncedCount} 個外部事件。
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void connect()} disabled={!uid || busy !== null}>
              {busy === 'connect' ? '授權中…' : connected ? '重新授權' : '連接 Google Calendar'}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => void sync()} disabled={!uid || !connected || busy !== null}>
              {busy === 'sync' ? '同步中…' : '立即同步'}
            </button>
            {connected ? (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => void disconnect()} disabled={busy !== null}>
                中斷
              </button>
            ) : null}
          </div>
        </div>

        <div className="calendar-sync-block">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>Apple iCal</strong>
            <span className="tiny muted">只讀匯入</span>
          </div>
          <div className="help">
            支援兩種輸入：<strong>公開 .ics 網址</strong>，或直接貼上由 <code>BEGIN:VCALENDAR</code> 開始的完整原始碼。
            只會單向匯入；網站修改／刪除不會寫回 Apple。
          </div>
          <textarea
            className="textarea"
            value={icalInput}
            onChange={(input) => setIcalInput(input.target.value)}
            placeholder={'https://…/calendar.ics\n\n或\n\nBEGIN:VCALENDAR\nVERSION:2.0\n…\nEND:VCALENDAR'}
            aria-label="iCal 網址或原始內容"
            rows={5}
            spellCheck={false}
            style={{ width: '100%', minHeight: 110, fontFamily: 'var(--font-mono)', fontSize: 11 }}
          />
          <label className="field" style={{ margin: 0 }}>
            <span className="label">CORS proxy（可選，Apple iCloud 用）</span>
            <input
              className="input"
              value={icalProxy}
              onChange={(input) => setIcalProxy(input.target.value)}
              placeholder="https://your-proxy.example/?url={url}"
              spellCheck={false}
            />
          </label>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm" onClick={() => void importIcal()} disabled={!uid || busy !== null}>
              {busy === 'ical' ? '匯入中…' : '匯入 iCal'}
            </button>
            <span className="tiny muted">自動清理 BOM、多餘空白、webcal://、追蹤參數</span>
          </div>
          {config?.icalUrls?.length ? (
            <div className="help" style={{ wordBreak: 'break-all' }}>
              已記錄 {config.icalUrls.length} 個訂閱 URL；重新匯入會以相同 UID 更新。
            </div>
          ) : null}
        </div>
      </div>

      {error || config?.lastError ? (
        <div className="notice exam" style={{ marginTop: 12 }}>
          <Icon name="info" size={14} />
          <span>{error || config?.lastError}</span>
        </div>
      ) : null}

      <div className="help" style={{ marginTop: 12 }}>
        日曆事件的分類標籤：<strong>DSE 考試</strong>（dse / mock / school / sba）、<strong>溫書</strong>（study）、<strong>雜事</strong>（custom）。
        Google 事件可在編輯器勾選同步；iCal 事件為唯讀鏡像。
      </div>
    </section>
  );
}
