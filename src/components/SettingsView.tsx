import { useRef, useState } from 'react';
import type { SemesterMode, SubjectCategory } from '../types';
import { SUBJECT_CATEGORY_LABEL } from '../types';
import { useApp } from '../contexts/AppContext';
import { DSE_2025_EVENTS, type SystemExamEvent } from '../data/dse2025';
import { clampOffset, formatHKClock, formatOffset, offsetFromReference, useSecondTick } from '../lib/clock';
import { UsagePanel } from './UsagePanel';
import { Icon } from './Icons';

const SEMESTER_OPTIONS: { value: SemesterMode; label: string }[] = [
  { value: 'auto', label: '自動判斷' },
  { value: 's1', label: '學期一' },
  { value: 's2', label: '學期二' },
  { value: 'mock', label: 'Mock 衝刺期' },
  { value: 'dse', label: 'DSE 衝刺期' },
  { value: 'holiday', label: '長假期' },
];

const YEARS = [2025, 2026, 2027, 2028, 2029, 2030];

/** Names must match `SystemExamEvent.subject` so the timetable maps exactly. */
const ELECTIVE_PRESETS = [
  '物理', '化學', '生物', '經濟', '地理', '歷史', '中國歷史',
  '企業、會計與財務概論', '資訊及通訊科技', '視覺藝術', '音樂', '體育',
  '倫理與宗教', '中國文學', '英語文學', '科技與生活',
  '健康管理與社會關懷', '旅遊與款待', '設計與應用科技',
];

export function SettingsView() {
  const {
    data,
    user,
    cloudEnabled,
    cloudReady,
    needsImport,
    isAdmin,
    systemTimetable,
    theme,
    setTheme,
    signIn,
    signOut,
    updateProfile,
    updateSettings,
    addSubject,
    deleteSubject,
    importLocalData,
    exportIcsFile,
    importIcsText,
    exportBackupFile,
    importBackupFile,
    resetAll,
    loadDemo,
    saveOfficialData,
    showToast,
  } = useApp();

  const [displayName, setDisplayName] = useState(data.profile.displayName);
  const [subjectName, setSubjectName] = useState('');
  const [subjectCategory, setSubjectCategory] = useState<SubjectCategory>('ELECTIVE');
  const [electiveToAdd, setElectiveToAdd] = useState(ELECTIVE_PRESETS[0]);
  const clockOffsetMs = data.settings.clockOffsetMs ?? 0;
  const nowMs = useSecondTick(clockOffsetMs);
  const [referenceTime, setReferenceTime] = useState(() => formatHKClock(Date.now() + clockOffsetMs));
  const selectedSubjectIds = data.settings.selectedSubjectIds ?? data.subjects.map((subject) => subject.id);
  const selectedSubjectSet = new Set(selectedSubjectIds);
  const [busy, setBusy] = useState(false);
  const [adminYear, setAdminYear] = useState(data.settings.dseYear);
  const [adminJson, setAdminJson] = useState('');
  const icsInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);

  const saveName = async () => {
    if (!displayName.trim()) return;
    await updateProfile({ displayName: displayName.trim().slice(0, 40) });
    showToast('名稱已更新。', 'success');
  };

  const submitSubject = () => {
    if (!subjectName.trim()) return;
    addSubject(subjectName, subjectCategory);
    setSubjectName('');
  };

  const applyClockOffset = (next: number) => {
    const clamped = clampOffset(next);
    updateSettings({ clockOffsetMs: clamped });
    setReferenceTime(formatHKClock(Date.now() + clamped));
    showToast(`時鐘校正已設為 ${formatOffset(clamped)}。`, 'success');
  };

  const calibrateClock = () => {
    const next = offsetFromReference(referenceTime);
    if (next === null) {
      showToast('請輸入有效的參考時間，格式為 HH:MM 或 HH:MM:SS。', 'error');
      return;
    }
    applyClockOffset(next);
  };

  const toggleSelectedSubject = (subjectId: string) => {
    const next = selectedSubjectSet.has(subjectId)
      ? selectedSubjectIds.filter((id) => id !== subjectId)
      : [...selectedSubjectIds, subjectId];
    updateSettings({ selectedSubjectIds: next });
  };

  const addElectivePreset = () => {
    const existing = data.subjects.find((subject) => subject.name === electiveToAdd);
    const subjectId = existing?.id ?? addSubject(electiveToAdd, 'ELECTIVE');
    if (!subjectId) {
      showToast('無法加入科目，請檢查本機儲存空間。', 'error');
      return;
    }
    if (!selectedSubjectSet.has(subjectId)) {
      updateSettings({ selectedSubjectIds: [...selectedSubjectIds, subjectId] });
    }
    showToast(existing ? `已勾選 ${electiveToAdd}。` : `已加入並勾選 ${electiveToAdd}。`, 'success');
  };

  const runImport = async () => {
    setBusy(true);
    try {
      await importLocalData();
    } catch {
      // importLocalData already surfaces the error toast.
    } finally {
      setBusy(false);
    }
  };

  const seedAdmin2025 = async () => {
    setBusy(true);
    try {
      await saveOfficialData(DSE_2025_EVENTS, 2025);
      showToast('已寫入 2025 HKEAA 官方時間表。', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const uploadAdminJson = async () => {
    try {
      const parsed: unknown = JSON.parse(adminJson);
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('JSON 必須是非空陣列。');
      const events = parsed as SystemExamEvent[];
      if (!events.every((event) => event && typeof event.id === 'string' && typeof event.date === 'string' && typeof event.title === 'string')) {
        throw new Error('每個事件最少要有 id、date、title。');
      }
      await saveOfficialData(events.map((event) => ({ ...event, year: adminYear, source: 'official' })), adminYear);
      setAdminJson('');
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Settings / mode A + B</div>
          <h1 className="page-title">設定</h1>
          <p className="page-subtitle">
            本機模式永遠可用；登入後可把任務、自訂倒數、打卡與反思同步到 Firebase。CalDAV／Google Calendar Worker 暫時不在本版範圍。
          </p>
        </div>
        <span className="chip">{cloudEnabled ? (cloudReady ? '模式 B · 已連接' : '模式 B · 待連接') : '模式 A · 本機'}</span>
      </div>

      <div className="settings-grid">
        <div className="stack">
          <section className="card settings-section">
            <div className="card-head">
              <div>
                <div className="eyebrow">Identity</div>
                <div className="card-title" style={{ marginTop: 5 }}>
                  <Icon name="user" size={15} />
                  個人資料
                </div>
              </div>
              {user ? <span className="chip chip-gold">Google 已登入</span> : <span className="chip">{cloudEnabled ? '未登入' : '模式 A'}</span>}
            </div>
            <div className="setting-row col">
              <div style={{ width: '100%' }}>
                <div className="setting-label">顯示名稱</div>
                <div className="setting-copy">排行榜只會顯示這個名稱，不會顯示電郵。</div>
              </div>
              <div className="row" style={{ width: '100%' }}>
                <input className="input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} />
                <button type="button" className="btn" onClick={() => void saveName()}>儲存</button>
              </div>
            </div>
            <div className="setting-row">
              <div>
                <div className="setting-label">排行榜公開</div>
                <div className="setting-copy">預設關閉。只公開名稱、連續打卡、累計天數；不公開任何學習內容。</div>
              </div>
              <button
                type="button"
                className={`toggle${data.profile.leaderboardOptIn ? ' on' : ''}`}
                onClick={() => void updateProfile({ leaderboardOptIn: !data.profile.leaderboardOptIn })}
                disabled={!user || !cloudReady}
                aria-label={data.profile.leaderboardOptIn ? '設為不公開' : '設為公開'}
                aria-pressed={data.profile.leaderboardOptIn}
              />
            </div>
            <div className="setting-row">
              <div>
                <div className="setting-label">登入狀態</div>
                <div className="setting-copy">{user ? user.email || user.displayName || '已登入' : '未登入；資料只存在此裝置。'}</div>
              </div>
              {user ? (
                <button type="button" className="btn btn-sm" onClick={() => void signOut()}>登出</button>
              ) : (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => void signIn()} disabled={!cloudEnabled}>
                  Google 登入
                </button>
              )}
            </div>
          </section>

          <section className="card settings-section">
            <div className="card-head">
              <div>
                <div className="eyebrow">Mode B / Firestore</div>
                <div className="card-title" style={{ marginTop: 5 }}>
                  <Icon name="cloud" size={15} />
                  跨裝置同步
                </div>
              </div>
              <span className={`chip${cloudReady ? ' chip-gold' : ''}`}>{cloudReady ? '同步中' : cloudEnabled ? '未連接' : '未設定'}</span>
            </div>
            {!cloudEnabled ? (
              <div className="setting-row col">
                <div className="notice gold" style={{ width: '100%' }}>
                  <Icon name="info" size={15} />
                  <span>未填入 Firebase 變數，系統自動回落模式 A。所有本機功能照常，沒有 Firebase 請求。</span>
                </div>
                <div className="help">在 `.env.local` 填入 6 個 `VITE_FIREBASE_*` 變數，重新啟動 `pnpm dev` 即會自動進入模式 B。</div>
              </div>
            ) : !user ? (
              <div className="setting-row col">
                <div className="setting-copy">Firebase 已設定但目前未登入。登入後才會讀寫你的私人 Firestore 文件。</div>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void signIn()}>Google 登入</button>
              </div>
            ) : (
              <div className="setting-row col">
                <div className="setting-copy">
                  任務、自訂倒數、打卡、反思與熱力圖設定會同步。圖片仍然只存此裝置 localStorage，不會上傳 Firebase Storage。
                </div>
                <div className="row" style={{ width: '100%', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-sm" onClick={() => void runImport()} disabled={busy || !cloudReady}>
                    {busy ? '上傳中…' : '上傳本機資料'}
                  </button>
                  <span className="tiny muted">
                    {needsImport ? '偵測到本機資料尚未上傳' : '沒有待上傳的本機資料'}
                  </span>
                </div>
                <div className="help">
                  「上傳本機資料」會把本機任務、事件、反思與可驗證的打卡寫入 Firestore；已存在的同一 ID 會覆蓋，不會重複建立。
                </div>
              </div>
            )}
          </section>

          <section className="card settings-section">
            <div className="card-head">
              <div>
                <div className="eyebrow">Appearance</div>
                <div className="card-title" style={{ marginTop: 5 }}>
                  <Icon name="sun" size={15} />
                  主題
                </div>
              </div>
              <span className="chip">{theme === 'light' ? '白金色' : '深海藍'}</span>
            </div>
            <div className="setting-row col">
              <div className="theme-choices" role="radiogroup" aria-label="主題">
                <button
                  type="button"
                  className={`theme-choice${theme === 'light' ? ' active' : ''}`}
                  onClick={() => setTheme('light')}
                  role="radio"
                  aria-checked={theme === 'light'}
                >
                  <span className="theme-swatch light"><i /><i /><i /></span>
                  <span>
                    <strong>白金淺色</strong>
                    <small>預設 · 白 / 淺灰 / 金色</small>
                  </span>
                </button>
                <button
                  type="button"
                  className={`theme-choice${theme === 'dark' ? ' active' : ''}`}
                  onClick={() => setTheme('dark')}
                  role="radio"
                  aria-checked={theme === 'dark'}
                >
                  <span className="theme-swatch dark"><i /><i /><i /></span>
                  <span>
                    <strong>深海藍</strong>
                    <small>可選 · 原有 Dream Theater 色盤</small>
                  </span>
                </button>
              </div>
              <div className="help">只會切換顏色變數；版面、字體、元件結構不變。選擇會保存在此裝置。</div>
            </div>
          </section>

          <section className="card settings-section">
            <div className="card-head">
              <div>
                <div className="eyebrow">Academic calendar</div>
                <div className="card-title" style={{ marginTop: 5 }}>
                  <Icon name="calendar" size={15} />
                  DSE 與學期
                </div>
              </div>
              <span className={`chip${systemTimetable.source === 'estimated' ? ' chip-gold' : ''}`}>
                {systemTimetable.source === 'official' ? '官方' : '預估'}
              </span>
            </div>
            <div className="setting-row col">
              <div className="form-grid two" style={{ width: '100%' }}>
                <label className="field">
                  <span className="label">DSE 年份</span>
                  <select className="select" value={data.settings.dseYear} onChange={(event) => updateSettings({ dseYear: Number(event.target.value) })}>
                    {YEARS.map((year) => <option key={year} value={year}>{year}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span className="label">學期模式</span>
                  <select className="select" value={data.settings.semesterMode} onChange={(event) => updateSettings({ semesterMode: event.target.value as SemesterMode })}>
                    {SEMESTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="label">DSE 開考（覆寫／顯示用）</span>
                  <input className="input" type="date" value={data.settings.dseStartDate} onChange={(event) => updateSettings({ dseStartDate: event.target.value })} />
                </label>
                <label className="field">
                  <span className="label">DSE 完結（覆寫／顯示用）</span>
                  <input className="input" type="date" value={data.settings.dseEndDate} onChange={(event) => updateSettings({ dseEndDate: event.target.value })} />
                </label>
              </div>
              <div className={`notice${systemTimetable.source === 'estimated' ? ' gold' : ''}`} style={{ width: '100%' }}>
                <Icon name="info" size={15} />
                <span>
                  {systemTimetable.label}。{systemTimetable.source === 'estimated'
                    ? '預估日期以 2025 HKEAA 官方時間表按年份推算，一切以 HKEAA 正式公告為準。'
                    : '系統基底資料，用戶只可隱藏，不可修改或刪除。'}
                </span>
              </div>
              <div className="row" style={{ width: '100%', flexWrap: 'wrap' }}>
                <span className="tiny muted">已隱藏 {data.settings.hiddenSystemExamIds.length} 個官方事件</span>
                {data.settings.hiddenSystemExamIds.length ? (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => updateSettings({ hiddenSystemExamIds: [] })}>全部恢復</button>
                ) : null}
              </div>
            </div>
          </section>

          <section className="card settings-section">
            <div className="card-head">
              <div>
                <div className="eyebrow">Precision clock</div>
                <div className="card-title" style={{ marginTop: 5 }}>
                  <Icon name="clock" size={15} />
                  高精度倒數時鐘
                </div>
              </div>
              <span className={`chip${clockOffsetMs !== 0 ? ' chip-gold' : ''}`}>
                {clockOffsetMs !== 0 ? `校正 ${formatOffset(clockOffsetMs)}` : '系統時間'}
              </span>
            </div>
            <div className="setting-row">
              <div>
                <div className="setting-label">目前香港時間</div>
                <div className="setting-copy">以系統時間為基準，每秒更新；DSE 考試時刻以 HKEAA 公布為準。</div>
              </div>
              <span className="mono" style={{ fontSize: 20, fontVariantNumeric: 'tabular-nums' }}>
                {formatHKClock(nowMs)}
              </span>
            </div>
            <div className="setting-row col">
              <div style={{ width: '100%' }}>
                <div className="setting-label">對照參考時間校準</div>
                <div className="setting-copy">
                  打開{' '}
                  <a href="https://time.is/Hong_Kong" target="_blank" rel="noreferrer">time.is 香港時間</a>
                  {' '}或{' '}
                  <a href="https://www.hkeaa.edu.hk/en/hkdse/event_timetable/" target="_blank" rel="noreferrer">HKEAA 考試時間表</a>
                  ，輸入目前時:分:秒，再按「校準」。
                </div>
              </div>
              <div className="row" style={{ width: '100%', flexWrap: 'wrap' }}>
                <input
                  className="input"
                  type="time"
                  step="1"
                  value={referenceTime}
                  onChange={(event) => setReferenceTime(event.target.value)}
                  aria-label="參考時間"
                  style={{ maxWidth: 150 }}
                />
                <button type="button" className="btn btn-sm btn-primary" onClick={calibrateClock}>校準</button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setReferenceTime(formatHKClock(Date.now() + clockOffsetMs))}
                >
                  現在
                </button>
                <button type="button" className="btn btn-sm" onClick={() => applyClockOffset(clockOffsetMs - 10_000)}>−10 秒</button>
                <button type="button" className="btn btn-sm" onClick={() => applyClockOffset(clockOffsetMs - 1_000)}>−1 秒</button>
                <button type="button" className="btn btn-sm" onClick={() => applyClockOffset(clockOffsetMs + 1_000)}>+1 秒</button>
                <button type="button" className="btn btn-sm" onClick={() => applyClockOffset(clockOffsetMs + 10_000)}>+10 秒</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => applyClockOffset(0)}>歸零</button>
              </div>
            </div>
            <div className="setting-row col">
              <div className="setting-copy">
                校正範圍限制為 ±5 分鐘，避免誤輸入造成倒數錯誤。校正值會跟設定同步到你的 Firestore 帳戶（Mode B）或 localStorage（Mode A）。
              </div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <span className="tiny muted">目前校正</span>
                <span className="mono">{formatOffset(clockOffsetMs)}</span>
              </div>
            </div>
          </section>

          <section className="card settings-section">
            <div className="card-head">
              <div>
                <div className="eyebrow">Exam focus</div>
                <div className="card-title" style={{ marginTop: 5 }}>
                  <Icon name="trophy" size={15} />
                  DSE 選科
                </div>
              </div>
              <span className="chip">{selectedSubjectIds.length} / {data.subjects.length}</span>
            </div>
            <div className="setting-row col">
              <div className="setting-copy">
                主頁頂部倒數只會顯示已勾選科目的最近考試。未登入時保存在 localStorage；登入後會同步到你的 Firestore 設定。
              </div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => updateSettings({ selectedSubjectIds: data.subjects.map((subject) => subject.id) })}
                >
                  全選
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => updateSettings({ selectedSubjectIds: [] })}
                >
                  全清
                </button>
              </div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <select
                  className="select"
                  value={electiveToAdd}
                  onChange={(event) => setElectiveToAdd(event.target.value)}
                  aria-label="快速加入選修科"
                  style={{ maxWidth: 220 }}
                >
                  {ELECTIVE_PRESETS.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <button type="button" className="btn btn-sm" onClick={addElectivePreset}>
                  <Icon name="plus" size={13} />
                  加入選修科
                </button>
              </div>
            </div>
            {data.subjects.map((subject) => (
              <label className="setting-row" key={subject.id} style={{ cursor: 'pointer' }}>
                <div>
                  <div className="setting-label">{subject.name}</div>
                  <div className="setting-copy">
                    {SUBJECT_CATEGORY_LABEL[subject.category]}{subject.custom ? ' · 自訂' : ''}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={selectedSubjectSet.has(subject.id)}
                  onChange={() => toggleSelectedSubject(subject.id)}
                  aria-label={`${subject.name} 是否納入主頁倒數`}
                />
              </label>
            ))}
            {selectedSubjectIds.length === 0 ? (
              <div className="notice exam" style={{ margin: '0 18px 16px' }}>
                <Icon name="info" size={15} />
                <span>未選擇任何科目，主頁倒數會顯示提示。系統選修科會按科目名稱對應；如要逐科倒數，可在下面「科目分類」新增同名科目（例：物理）。</span>
              </div>
            ) : (
              <div className="setting-row col">
                <div className="setting-copy">
                  系統選修科會按科目名稱對應；如要逐科倒數，可在下面「科目分類」新增同名科目（例：物理）。
                </div>
              </div>
            )}
          </section>

          <section className="card settings-section">
            <div className="card-head">
              <div>
                <div className="eyebrow">Subjects</div>
                <div className="card-title" style={{ marginTop: 5 }}>
                  <Icon name="book" size={15} />
                  科目分類
                </div>
              </div>
              <span className="tiny muted">{data.subjects.length} 個</span>
            </div>
            {data.subjects.map((subject) => (
              <div className="setting-row" key={subject.id}>
                <div>
                  <div className="setting-label">{subject.name}</div>
                  <div className="setting-copy">{SUBJECT_CATEGORY_LABEL[subject.category]}{subject.custom ? ' · 自訂' : ''}</div>
                </div>
                {subject.custom ? (
                  <button type="button" className="icon-btn" onClick={() => deleteSubject(subject.id)} aria-label="刪除科目">
                    <Icon name="trash" size={14} />
                  </button>
                ) : (
                  <span className="chip">預設</span>
                )}
              </div>
            ))}
            <div className="setting-row col">
              <div className="form-grid two" style={{ width: '100%' }}>
                <input className="input" value={subjectName} onChange={(event) => setSubjectName(event.target.value)} placeholder="新增科目，例：物理" maxLength={32} />
                <select className="select" value={subjectCategory} onChange={(event) => setSubjectCategory(event.target.value as SubjectCategory)}>
                  {Object.entries(SUBJECT_CATEGORY_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <button type="button" className="btn btn-sm" onClick={submitSubject} disabled={!subjectName.trim()}>
                <Icon name="plus" size={13} />
                新增科目
              </button>
            </div>
          </section>

          {isAdmin ? (
            <section className="card settings-section">
              <div className="card-head">
                <div>
                  <div className="eyebrow">Admin / HKEAA</div>
                  <div className="card-title" style={{ marginTop: 5 }}>
                    <Icon name="lock" size={15} />
                    官方時間表更新
                  </div>
                </div>
                <span className="chip chip-gold">管理員</span>
              </div>
              <div className="setting-row col">
                <div className="setting-copy">只有 `admins/{'{uid}'}` 存在的帳號可以寫入 `systemExams`。普通用戶只能讀取及隱藏。</div>
                <div className="row" style={{ width: '100%', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => void seedAdmin2025()} disabled={busy}>
                    寫入 2025 HKEAA 基底
                  </button>
                </div>
                <label className="field" style={{ width: '100%' }}>
                  <span className="label">進階：貼上 systemExams JSON（陣列）</span>
                  <textarea className="textarea" value={adminJson} onChange={(event) => setAdminJson(event.target.value)} placeholder='[{"id":"...","date":"2027-04-01","title":"DSE 中國語文 Paper 1","subject":"中國語文","subjectCategory":"CHI","startTime":"08:30","endTime":"10:00"}]' />
                </label>
                <div className="row">
                  <select className="select" style={{ width: 120 }} value={adminYear} onChange={(event) => setAdminYear(Number(event.target.value))}>
                    {YEARS.map((year) => <option key={year} value={year}>{year}</option>)}
                  </select>
                  <button type="button" className="btn btn-sm" onClick={() => void uploadAdminJson()} disabled={!adminJson.trim()}>
                    上傳 JSON
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          <section className="card settings-section">
            <div className="card-head">
              <div>
                <div className="eyebrow">Portability</div>
                <div className="card-title" style={{ marginTop: 5 }}>
                  <Icon name="download" size={15} />
                  匯入 / 匯出 / 備份
                </div>
              </div>
            </div>
            <div className="setting-row">
              <div>
                <div className="setting-label">匯出 .ics</div>
                <div className="setting-copy">事件、官方 DSE 事件與任務以 RFC5545 輸出；可手動匯入 Apple / Google Calendar。</div>
              </div>
              <button type="button" className="btn btn-sm" onClick={exportIcsFile}>下載 .ics</button>
            </div>
            <div className="setting-row">
              <div>
                <div className="setting-label">匯入 .ics</div>
                <div className="setting-copy">支援 VEVENT / VTODO；重複事件會保留 RRULE。</div>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => icsInput.current?.click()}>選擇檔案</button>
              <input
                ref={icsInput}
                type="file"
                accept=".ics,text/calendar"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void file.text().then((text) => importIcsText(text)).then((result) => {
                    if (result.warnings.length) showToast(result.warnings[0], 'info');
                  }).finally(() => { if (icsInput.current) icsInput.current.value = ''; });
                }}
              />
            </div>
            <div className="setting-row">
              <div>
                <div className="setting-label">完整 JSON 備份</div>
                <div className="setting-copy">包含任務、事件、打卡、反思、圖片 data URL。適合換機或清理瀏覽器前使用。</div>
              </div>
              <button type="button" className="btn btn-sm" onClick={exportBackupFile}>下載備份</button>
            </div>
            <div className="setting-row">
              <div>
                <div className="setting-label">還原 JSON</div>
                <div className="setting-copy">會覆蓋本機資料；雲端資料不會自動覆蓋。</div>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => jsonInput.current?.click()}>選擇備份</button>
              <input
                ref={jsonInput}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void file.text().then(importBackupFile).finally(() => { if (jsonInput.current) jsonInput.current.value = ''; });
                }}
              />
            </div>
          </section>

          <section className="card settings-section danger-zone">
            <div className="card-head">
              <div>
                <div className="eyebrow">Local data</div>
                <div className="card-title" style={{ marginTop: 5 }}>危險操作</div>
              </div>
            </div>
            <div className="setting-row">
              <div>
                <div className="setting-label">載入示範資料</div>
                <div className="setting-copy">用相對今日的日期建立 DSE / Mock / SBA 與任務，方便預覽。會覆蓋本機資料。</div>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => { if (window.confirm('載入示範資料會覆蓋本機資料，繼續？')) loadDemo(); }}>載入</button>
            </div>
            <div className="setting-row">
              <div>
                <div className="setting-label">重設本機資料</div>
                <div className="setting-copy">清空任務、事件、打卡、反思與圖片；不會刪除 Firebase 上的資料。</div>
              </div>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => { if (window.confirm('確定重設本機資料？此操作不可復原。')) resetAll(); }}>重設</button>
            </div>
          </section>
        </div>

        <aside className="stack">
          <UsagePanel />
          <section className="card">
            <div className="card-head">
              <div>
                <div className="eyebrow">Mode A / Mode B</div>
                <div className="card-title" style={{ marginTop: 5 }}>
                  <Icon name="cloud" size={15} />
                  部署邊界
                </div>
              </div>
            </div>
            <div className="card-body">
              <div className="mini-stat">
                <span className="mini-stat-label">模式 A</span>
                <span className="tiny mono">localStorage</span>
              </div>
              <div className="mini-stat">
                <span className="mini-stat-label">模式 B</span>
                <span className="tiny mono">Firestore Spark</span>
              </div>
              <div className="mini-stat">
                <span className="mini-stat-label">Database location</span>
                <span className="tiny mono">asia-east2</span>
              </div>
              <div className="mini-stat">
                <span className="mini-stat-label">Image storage</span>
                <span className="tiny mono">localStorage</span>
              </div>
              <div className="usage-foot" style={{ paddingTop: 0 }}>
                未填 Firebase 變數時自動回落模式 A；不會初始化 Firebase，也不會發出 Firestore 請求。
                本版沒有 CalDAV / Calendar Worker；方案 C 留待之後。
              </div>
            </div>
          </section>
          <div className="notice">
            <Icon name="lock" size={15} />
            <span>
              安全規則在 `firestore.rules`。打卡寫入只准引用自己的已完成任務；排行榜只准寫自己的公開 streak；systemExams 只有管理員可寫。
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}
