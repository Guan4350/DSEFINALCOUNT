import { useMemo, useState } from 'react';
import type { CalendarEvent, EventType } from '../types';
import { EVENT_TYPE_LABEL } from '../types';
import { useApp } from '../contexts/AppContext';
import { addDays, isISODate, todayISO } from '../lib/date';
import { stableUid, uid } from '../lib/id';
import { Modal } from './Modal';

interface EventEditorProps {
  event?: CalendarEvent;
  defaultDate?: string;
  defaultType?: EventType;
  onClose: () => void;
}

const TYPES: EventType[] = ['dse', 'mock', 'school', 'sba', 'study', 'custom'];

type RepeatFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY';

const REPEAT_OPTIONS: { value: RepeatFreq; label: string }[] = [
  { value: 'DAILY', label: '每日' },
  { value: 'WEEKLY', label: '每週' },
  { value: 'MONTHLY', label: '每月' },
];

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function timePart(value: string | undefined): string {
  if (!value || value.length < 16) return '09:00';
  return value.slice(11, 16);
}

function repeatFrequency(rrule: string): RepeatFreq | null {
  const match = /FREQ=(DAILY|WEEKLY|MONTHLY)/i.exec(rrule);
  return match ? (match[1].toUpperCase() as RepeatFreq) : null;
}

function isSimpleRule(rrule: string): boolean {
  return /^FREQ=(DAILY|WEEKLY|MONTHLY)$/i.test(rrule);
}

export function EventEditor({ event, defaultDate = todayISO(), defaultType = 'dse', onClose }: EventEditorProps) {
  const { data, allEvents, addEvent, updateEvent, deleteEvent, showToast } = useApp();
  const initial = useMemo(() => event || null, [event]);
  const initialRule = initial?.rrule || '';
  const initialAllDay = initial?.allDay ?? false;
  const initialDate = (initial?.start || defaultDate).slice(0, 10);
  const [title, setTitle] = useState(initial?.title || '');
  const [type, setType] = useState<EventType>(initial?.type || defaultType);
  const [subjectId, setSubjectId] = useState(initial?.subjectId || '');
  const [paper, setPaper] = useState(initial?.paper || '');
  const [allDay, setAllDay] = useState(initialAllDay);
  const [startDate, setStartDate] = useState(initialDate);
  const [endDate, setEndDate] = useState(
    initial?.end ? initial.end.slice(0, 10) : initialAllDay ? addDays(initialDate, 1) : initialDate,
  );
  const [startTime, setStartTime] = useState(timePart(initial?.start));
  const [endTime, setEndTime] = useState(initial?.end ? timePart(initial.end) : '10:00');
  const [location, setLocation] = useState(initial?.location || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [repeat, setRepeat] = useState(Boolean(initialRule));
  const [repeatFreq, setRepeatFreq] = useState<RepeatFreq>(repeatFrequency(initialRule) || 'WEEKLY');
  const [customRule, setCustomRule] = useState(Boolean(initialRule) && !isSimpleRule(initialRule));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      setError('請輸入事件名稱。');
      return;
    }
    if (!isISODate(startDate)) {
      setError('請選擇有效的開始日期。');
      return;
    }
    if (!isISODate(endDate)) {
      setError('請選擇有效的結束日期。');
      return;
    }
    if (allDay) {
      if (endDate <= startDate) {
        setError('全日事件的結束日期必須晚於開始日期。');
        return;
      }
    } else {
      if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) {
        setError('時間格式必須為 HH:MM（例：08:30）。');
        return;
      }
      if (endDate < startDate || (endDate === startDate && endTime <= startTime)) {
        setError('結束時間必須晚於開始時間。');
        return;
      }
    }

    const start = allDay ? startDate : `${startDate}T${startTime}:00`;
    const end = allDay ? endDate : `${endDate}T${endTime}:00`;

    // Local duplicate guard: same title, type, subject and exact start.
    const duplicate = allEvents.find(
      (item) =>
        !item.deleted &&
        item.id !== initial?.id &&
        item.start === start &&
        item.type === type &&
        (item.subjectId || '') === (subjectId || '') &&
        item.title.trim().toLowerCase() === title.trim().toLowerCase(),
    );
    if (duplicate) {
      setError('日曆已有相同名稱、類型、科目及時間的事件。請修改其中一項，或先編輯現有事件。');
      return;
    }

    const rrule = repeat
      ? customRule && initialRule
        ? initialRule
        : `FREQ=${repeatFreq}`
      : undefined;

    setSaving(true);
    setError('');
    const next: CalendarEvent = {
      id: initial?.id || uid('evt'),
      uid: initial?.uid || stableUid('dse-event'),
      title: title.trim().slice(0, 180),
      start,
      end,
      allDay,
      type,
      subjectId: subjectId || undefined,
      paper: paper.trim().slice(0, 40) || undefined,
      description: description.trim().slice(0, 4000) || undefined,
      location: location.trim().slice(0, 200) || undefined,
      rrule,
      source: 'local',
      externalId: initial?.externalId,
      etag: initial?.etag,
      updatedAt: new Date().toISOString(),
    };
    try {
      if (initial) await updateEvent(next);
      else await addEvent(next);
      showToast(initial ? '日曆事件已更新。' : '日曆事件已加入。', 'success');
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!initial) return;
    if (!window.confirm(`刪除「${initial.title}」？`)) return;
    await deleteEvent(initial.id);
    onClose();
  };

  return (
    <Modal
      title={initial ? '編輯考試或事件' : '新增考試或事件'}
      eyebrow={initial ? 'Calendar / edit' : 'Calendar / new'}
      onClose={onClose}
      footer={
        <>
          {initial ? (
            <button type="button" className="btn btn-danger btn-sm" onClick={remove} style={{ marginRight: 'auto' }}>
              刪除
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? '儲存中…' : '儲存事件'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          <span className="label">事件名稱</span>
          <input
            className="input"
            value={title}
            onChange={(input) => setTitle(input.target.value)}
            placeholder="例：DSE 數學 Paper 1"
            maxLength={180}
            autoFocus
          />
        </label>

        <div className="form-grid two">
          <label className="field">
            <span className="label">類型</span>
            <select className="select" value={type} onChange={(input) => setType(input.target.value as EventType)}>
              {TYPES.map((item) => (
                <option key={item} value={item}>
                  {EVENT_TYPE_LABEL[item]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">科目（可選）</span>
            <select className="select" value={subjectId} onChange={(input) => setSubjectId(input.target.value)}>
              <option value="">不綁定科目</option>
              {data.subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="row" style={{ gap: 8, color: 'var(--muted)', fontSize: 11 }}>
          <input
            type="checkbox"
            checked={allDay}
            onChange={(input) => {
              const nextAllDay = input.target.checked;
              setAllDay(nextAllDay);
              if (nextAllDay && endDate <= startDate) setEndDate(addDays(startDate, 1));
              if (!nextAllDay && endDate !== startDate) setEndDate(startDate);
            }}
          />
          全日事件（不設時間）
        </label>

        <div className="form-grid two">
          <label className="field">
            <span className="label">開始日期</span>
            <input
              className="input"
              type="date"
              value={startDate}
              onChange={(input) => {
                const next = input.target.value;
                setStartDate(next);
                if (!allDay && (endDate < next || endDate === startDate)) setEndDate(next);
              }}
            />
          </label>
          <label className="field">
            <span className="label">{allDay ? '結束日期（exclusive）' : '結束日期'}</span>
            <input className="input" type="date" value={endDate} onChange={(input) => setEndDate(input.target.value)} />
          </label>
        </div>

        {!allDay ? (
          <div className="form-grid two">
            <label className="field">
              <span className="label">開始時間（時:分）</span>
              <input className="input" type="time" value={startTime} onChange={(input) => setStartTime(input.target.value)} />
            </label>
            <label className="field">
              <span className="label">結束時間（時:分）</span>
              <input className="input" type="time" value={endTime} onChange={(input) => setEndTime(input.target.value)} />
            </label>
          </div>
        ) : null}

        <div className="setting-row" style={{ padding: '2px 0', borderBottom: 0 }}>
          <label className="row" style={{ gap: 8, color: 'var(--muted)', fontSize: 11 }}>
            <input type="checkbox" checked={repeat} onChange={(input) => setRepeat(input.target.checked)} />
            重複此事件
          </label>
          {repeat ? (
            <div className="row" style={{ gap: 8 }}>
              <select
                className="select"
                value={repeatFreq}
                onChange={(input) => {
                  setRepeatFreq(input.target.value as RepeatFreq);
                  setCustomRule(false);
                }}
                disabled={customRule}
                aria-label="重複頻率"
              >
                {REPEAT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {customRule ? (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCustomRule(false)}>
                  改用簡單頻率
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="form-grid two">
          <label className="field">
            <span className="label">卷別 / Paper（可選）</span>
            <input className="input" value={paper} onChange={(input) => setPaper(input.target.value)} placeholder="Paper 1" maxLength={40} />
          </label>
          <label className="field">
            <span className="label">地點（可選）</span>
            <input className="input" value={location} onChange={(input) => setLocation(input.target.value)} maxLength={200} />
          </label>
        </div>

        <label className="field">
          <span className="label">備註</span>
          <textarea
            className="textarea"
            value={description}
            onChange={(input) => setDescription(input.target.value)}
            placeholder="考試範圍、注意事項、SBA 要求…"
            maxLength={4000}
          />
        </label>

        <div className="notice">
          DSE 每科可能有多卷／多日；建議逐卷建立事件。勾選「重複此事件」後，日曆與 .ics 匯出會按規則展開；相同名稱、科目及時間的事件會被視為重複並阻止儲存。
        </div>

        {error ? <div className="notice exam">{error}</div> : null}
      </div>
    </Modal>
  );
}
