import { useEffect, useState } from 'react';
import type { CalendarEvent, CalendarSyncConfig, Subject } from '../types';
import { useApp } from '../contexts/AppContext';
import { importIcalInput, loadCalendarSyncConfig, sanitizeIcalUrl, saveCalendarConfig, syncGoogleNow } from '../lib/calendarSync';
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
  const [busy, setBusy] = useState<'connect' | 'sync' | 'ical' | 'auto' | 'disconnect' | null>(null);
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
        setIcalInput(next.icalAutoUrl || next.icalUrls[next.icalUrls.length - 1] || '');
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

  const enableAutoSync = async () => {
    if (!uid) {
      showToast('請先登入再啟用自動同步。', 'error');
      return;
    }
    setBusy('auto');
    setError('');
    try {
      const url = sanitizeIcalUrl(icalInput);
      const next = await saveCalendarConfig(uid, {
        icalAutoUrl: url,
        icalAutoEnabled: true,
        icalLastStatus: 'pending',
        icalLastError: '',
        icalUrls: Array.from(new Set([...(config?.icalUrls || []), url])).slice(-10),
      });
      setConfig(next);
      setIcalInput(url);
      showToast('已啟用 iCloud/iCal 自動同步；Functions 會每 60 分鐘更新，毋須再手動匯入。', 'success');
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      showToast(`啟用失敗：${message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const refreshStatus = async () => {
    if (!uid) return;
    try {
      const next = await loadCalendarSyncConfig(uid);
      setConfig(next);
      setIcalInput(next.icalAutoUrl || next.icalUrls[next.icalUrls.length - 1] || icalInput);
      showToast('已重新讀取自動同步狀態。', 'success');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
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
            Google Calendar 雙向同步由你手動觸發；Apple iCal 由 Functions 每 60 分鐘單向自動同步。
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
            <span className="tiny muted">每 60 分鐘 · 只讀</span>
          </div>
          <div className="help">
            貼上 iCloud / iCal <strong>公開 .ics 網址</strong>。儲存後由 Firebase Functions + Cloud Scheduler 每 60 分鐘自動同步，唔需要再手動匯入。
            啟用後會以該 feed 為準：feed 已刪除的事件會從網站移除。
            亦可在下面貼完整原始碼，使用「只匯入一次」作即時測試。
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
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void enableAutoSync()} disabled={!uid || busy !== null}>
              {busy === 'auto' ? '儲存中…' : '儲存並啟用自動同步'}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void importIcal()} disabled={!uid || busy !== null}>
              {busy === 'ical' ? '匯入中…' : '只匯入一次'}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void refreshStatus()} disabled={!uid}>
              重新整理狀態
            </button>
          </div>
          {config?.icalAutoUrl ? (
            <div className={`notice${config.icalLastStatus === 'error' ? ' exam' : ''}`} style={{ marginTop: 4 }}>
              <Icon name="sync" size={14} />
              <span>
                自動同步已啟用 · {config.icalAutoUrl}
                <br />
                {config.icalLastStatus === 'ok'
                  ? `上次成功：${config.icalLastSyncAt ? new Date(config.icalLastSyncAt).toLocaleString('zh-HK') : '剛剛'} · ${config.icalLastEventCount || 0} 個事件`
                  : config.icalLastStatus === 'error'
                    ? `上次失敗：${config.icalLastError || '未知錯誤'}`
                    : '等待下一次排程（每 60 分鐘）'}
              </span>
            </div>
          ) : (
            <div className="help">未啟用自動同步。儲存 URL 後，排程會每 60 分鐘抓取一次。</div>
          )}
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
