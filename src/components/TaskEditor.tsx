import { useState } from 'react';
import type { Task } from '../types';
import { TASK_KIND_LABEL } from '../types';
import { useApp } from '../contexts/AppContext';
import { todayISO } from '../lib/date';
import { uid } from '../lib/id';
import { Modal } from './Modal';

interface TaskEditorProps {
  task?: Task;
  defaultDate?: string;
  onClose: () => void;
}

export function TaskEditor({ task, defaultDate = todayISO(), onClose }: TaskEditorProps) {
  const { data, addTask, updateTask, deleteTask } = useApp();
  const [title, setTitle] = useState(task?.title || '');
  const [subjectId, setSubjectId] = useState(task?.subjectId || data.subjects[0]?.id || '');
  const [dueDate, setDueDate] = useState(task?.dueDate || defaultDate);
  const [dueTime, setDueTime] = useState(task?.dueTime || '');
  const [kind, setKind] = useState<Task['kind']>(task?.kind || 'study');
  const [notes, setNotes] = useState(task?.notes || '');
  const [completed, setCompleted] = useState(task?.completed || false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!title.trim()) {
      setError('請輸入任務名稱。');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      setError('請選擇有效日期。');
      return;
    }
    setSaving(true);
    const next: Task = {
      id: task?.id || uid('task'),
      title: title.trim().slice(0, 180),
      subjectId,
      dueDate,
      dueTime: dueTime || undefined,
      completed,
      completedAt: completed ? task?.completedAt || new Date().toISOString() : undefined,
      notes: notes.trim().slice(0, 2000) || undefined,
      kind,
      createdAt: task?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rolledFrom: task?.rolledFrom,
      rolloverCount: task?.rolloverCount || 0,
      source: task?.source || 'local',
    };
    try {
      if (task) await updateTask(next);
      else await addTask(next);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!task) return;
    if (!window.confirm(`刪除「${task.title}」？`)) return;
    await deleteTask(task.id);
    onClose();
  };

  return (
    <Modal
      title={task ? '編輯任務' : '新增任務'}
      eyebrow={task ? 'Task / edit' : 'Task / new'}
      onClose={onClose}
      footer={
        <>
          {task ? (
            <button type="button" className="btn btn-danger btn-sm" onClick={remove} style={{ marginRight: 'auto' }}>
              刪除
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? '儲存中…' : '儲存任務'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          <span className="label">任務名稱</span>
          <input
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例：數學 Paper 1 Q14–Q18 重做"
            maxLength={180}
            autoFocus
          />
        </label>

        <div className="form-grid two">
          <label className="field">
            <span className="label">科目</span>
            <select className="select" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
              {data.subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">類型</span>
            <select className="select" value={kind} onChange={(event) => setKind(event.target.value as Task['kind'])}>
              {Object.entries(TASK_KIND_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="form-grid two">
          <label className="field">
            <span className="label">日期</span>
            <input className="input" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </label>
          <label className="field">
            <span className="label">時間（可選）</span>
            <input className="input" type="time" value={dueTime} onChange={(event) => setDueTime(event.target.value)} />
          </label>
        </div>

        <label className="field">
          <span className="label">備註</span>
          <textarea
            className="textarea"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="只寫下一步，不要寫一整份計劃。"
            maxLength={2000}
          />
        </label>

        <label className="row" style={{ gap: 8, color: 'var(--muted)', fontSize: 11 }}>
          <input type="checkbox" checked={completed} onChange={(event) => setCompleted(event.target.checked)} />
          標記為已完成
        </label>

        {task?.rolledFrom ? (
          <div className="notice gold">
            此任務由 {task.rolledFrom} 顺延，已累計 {task.rolloverCount} 次。完成後再勾選，會計入今日打卡條件。
          </div>
        ) : null}

        {error ? <div className="notice exam">{error}</div> : null}
      </div>
    </Modal>
  );
}
