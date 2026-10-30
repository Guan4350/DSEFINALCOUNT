import { useMemo, useState } from 'react';
import type { CalendarEvent, EventType } from '../types';
import { EVENT_TYPE_LABEL } from '../types';
import { useApp } from '../contexts/AppContext';
import { addDays, todayISO } from '../lib/date';
import { stableUid, uid } from '../lib/id';
import { Modal } from './Modal';

interface EventEditorProps {
  event?: CalendarEvent;
  defaultDate?: string;
  onClose: () => void;
}

const TYPES: EventType[] = ['dse', 'mock', 'school', 'sba', 'study', 'custom'];

function timePart(value: string | undefined): string {
  if (!value || value.length < 16) return '09:00';
  return value.slice(11, 16);
}

export function EventEditor({ event, defaultDate = todayISO(), onClose }: EventEditorProps) {
  const { data, addEvent, updateEvent, deleteEvent } = useApp();
  const initial = useMemo(() => event || null, [event]);
  const [title, setTitle] = useState(initial?.title || '');
  const [type, setType] = useState<EventType>(initial?.type || 'dse');
  const [subjectId, setSubjectId] = useState(initial?.subjectId || '');
  const [paper, setPaper] = useState(initial?.paper || '');
  const [allDay, setAllDay] = useState(initial?.allDay ?? true);
  const [startDate, setStartDate] = useState((initial?.start || defaultDate).slice(0, 10));
  const [endDate, setEndDate] = useState((initial?.end || addDays(defaultDate, 1)).slice(0, 10));
  const [startTime, setStartTime] = useState(timePart(initial?.start));
  const [endTime, setEndTime] = useState(timePart(initial?.end) === '09:00' ? '10:00' : timePart(initial?.end));
  const [location, setLocation] = useState(initial?.location || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      setError('請輸入事件名稱。');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      setError('請選擇有效日期。');
      return;
    }
    setSaving(true);
    const start = allDay ? startDate : `${startDate}T${startTime}:00`;
    const end = allDay ? endDate || addDays(startDate, 1) : `${startDate}T${endTime}:00`;
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
      rrule: initial?.rrule,
      source: 'local',
      externalId: initial?.externalId,
      etag: initial?.etag,
      updatedAt: new Date().toISOString(),
    };
    try {
      if (initial) await updateEvent(next);
      else await addEvent(next);
      onClose();
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
      title={initial ? '編輯日曆事件' : '新增日曆事件'}
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
          <input type="checkbox" checked={allDay} onChange={(input) => setAllDay(input.target.checked)} />
          全日事件
        </label>

        <div className="form-grid two">
          <label className="field">
            <span className="label">開始日期</span>
            <input className="input" type="date" value={startDate} onChange={(input) => setStartDate(input.target.value)} />
          </label>
          <label className="field">
            <span className="label">{allDay ? '結束日期（exclusive）' : '結束日期'}</span>
            <input className="input" type="date" value={endDate} onChange={(input) => setEndDate(input.target.value)} />
          </label>
        </div>

        {!allDay ? (
          <div className="form-grid two">
            <label className="field">
              <span className="label">開始時間</span>
              <input className="input" type="time" value={startTime} onChange={(input) => setStartTime(input.target.value)} />
            </label>
            <label className="field">
              <span className="label">結束時間</span>
              <input className="input" type="time" value={endTime} onChange={(input) => setEndTime(input.target.value)} />
            </label>
          </div>
        ) : null}

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
          DSE 每科可能有多卷／多日；建議逐卷建立事件，總倒數會自動取最近一個 DSE 事件。所有事件都會寫入 .ics 匯出。
        </div>

        {error ? <div className="notice exam">{error}</div> : null}
      </div>
    </Modal>
  );
}
