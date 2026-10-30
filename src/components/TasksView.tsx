import { useMemo, useState } from 'react';
import type { Task } from '../types';
import { TASK_KIND_LABEL } from '../types';
import { useApp } from '../contexts/AppContext';
import { addDays, formatDate, todayISO } from '../lib/date';
import { SubjectBadge } from './SubjectBadge';
import { TaskEditor } from './TaskEditor';
import { Icon } from './Icons';

type StatusFilter = 'open' | 'done' | 'all';

function taskGroup(task: Task, today: string): string {
  if (task.completed) return '已完成';
  if (task.dueDate < today) return '已逾期';
  if (task.dueDate === today) return '今日';
  if (task.dueDate === addDays(today, 1)) return '明日';
  return '稍後';
}

export function TasksView() {
  const { data, toggleTask } = useApp();
  const today = todayISO();
  const [status, setStatus] = useState<StatusFilter>('open');
  const [subjectId, setSubjectId] = useState('all');
  const [query, setQuery] = useState('');
  const [editingTask, setEditingTask] = useState<Task | undefined>();
  const [editorOpen, setEditorOpen] = useState(false);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return data.tasks
      .filter((task) => {
        if (status === 'open' && task.completed) return false;
        if (status === 'done' && !task.completed) return false;
        if (subjectId !== 'all' && task.subjectId !== subjectId) return false;
        if (normalizedQuery && !`${task.title} ${task.notes || ''}`.toLowerCase().includes(normalizedQuery)) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.completed !== b.completed) return Number(a.completed) - Number(b.completed);
        if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        return a.createdAt.localeCompare(b.createdAt);
      });
  }, [data.tasks, query, status, subjectId]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Task[]>();
    for (const task of filtered) {
      const group = taskGroup(task, today);
      const list = groups.get(group) || [];
      list.push(task);
      groups.set(group, list);
    }
    return ['今日', '已逾期', '明日', '稍後', '已完成']
      .filter((group) => groups.has(group))
      .map((group) => [group, groups.get(group) || []] as const);
  }, [filtered, today]);

  const openTasks = data.tasks.filter((task) => !task.completed);
  const completed = data.tasks.filter((task) => task.completed);
  const overdue = openTasks.filter((task) => task.dueDate < today).length;

  const openNew = () => {
    setEditingTask(undefined);
    setEditorOpen(true);
  };

  const openTask = (task: Task) => {
    setEditingTask(task);
    setEditorOpen(true);
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Execution / one next action</div>
          <h1 className="page-title">任務</h1>
          <p className="page-subtitle">
            未完成的任務會在跨日後自动顺延到今日，並保留顺延次數。考試與 SBA deadline 不會被顺延。
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openNew}>
          <Icon name="plus" size={14} />
          新增任務
        </button>
      </div>

      <div className="tasks-layout">
        <section className="card">
          <div className="card-head">
            <div className="toolbar">
              <div className="filters">
                {([
                  ['open', '未完成'],
                  ['done', '已完成'],
                  ['all', '全部'],
                ] as const).map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={`chip${status === value ? ' chip-active' : ''}`}
                    onClick={() => setStatus(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <select className="select" style={{ width: 130, height: 30 }} value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                <option value="all">所有科目</option>
                {data.subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>{subject.name}</option>
                ))}
              </select>
              <input
                className="input"
                style={{ width: 170, height: 30 }}
                placeholder="搜尋任務…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <span className="tiny muted">{filtered.length} 個</span>
          </div>

          {grouped.length ? (
            <div>
              {grouped.map(([group, tasks]) => (
                <div key={group}>
                  <div className="task-group-head">
                    <span>{group}</span>
                    <span>{tasks.length}</span>
                  </div>
                  <div className="task-list">
                    {tasks.map((task) => {
                      const subject = data.subjects.find((item) => item.id === task.subjectId);
                      return (
                        <div className={`task-item${task.completed ? ' done' : ''}`} key={task.id}>
                          <button
                            type="button"
                            className={`task-check${task.completed ? ' done' : ''}`}
                            onClick={() => void toggleTask(task.id)}
                            aria-label={task.completed ? '標記未完成' : '標記完成'}
                          >
                            {task.completed ? <Icon name="check" size={11} /> : null}
                          </button>
                          <button
                            type="button"
                            onClick={() => openTask(task)}
                            style={{ border: 0, background: 'transparent', padding: 0, textAlign: 'left', color: 'inherit', minWidth: 0 }}
                          >
                            <div className="task-title">{task.title}</div>
                            <div className="task-meta">
                              <SubjectBadge subject={subject} />
                              <span>{TASK_KIND_LABEL[task.kind]}</span>
                              <span>{formatDate(task.dueDate, { month: 'short', day: 'numeric', weekday: 'short' })}</span>
                              {task.rolloverCount > 0 ? <span className="rollover-flag">顺延 {task.rolloverCount} 次</span> : null}
                            </div>
                            {task.notes ? <div className="task-notes">{task.notes}</div> : null}
                          </button>
                          <div className="task-actions">
                            <button type="button" className="icon-btn" onClick={() => openTask(task)} aria-label="編輯任務">
                              <Icon name="edit" size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">
              <div className="empty-icon"><Icon name="check-square" /></div>
              <div className="empty-title">沒有符合條件的任務</div>
              <div className="empty-copy">試下切換篩選，或者新增一個 30 分鐘內可開始的任務。</div>
              <button type="button" className="btn btn-sm btn-primary" onClick={openNew}>新增任務</button>
            </div>
          )}
        </section>

        <aside className="task-side">
          <section className="card">
            <div className="card-head">
              <div>
                <div className="eyebrow">Queue</div>
                <div className="card-title"><Icon name="chart" size={15} />任務概況</div>
              </div>
            </div>
            <div className="card-body" style={{ paddingTop: 5, paddingBottom: 5 }}>
              <div className="mini-stat">
                <span className="mini-stat-label">未完成</span>
                <span className="mini-stat-value">{openTasks.length}</span>
              </div>
              <div className="mini-stat">
                <span className="mini-stat-label">今日到期</span>
                <span className="mini-stat-value">{openTasks.filter((task) => task.dueDate === today).length}</span>
              </div>
              <div className="mini-stat">
                <span className="mini-stat-label">已逾期（待顺延）</span>
                <span className="mini-stat-value">{overdue}</span>
              </div>
              <div className="mini-stat">
                <span className="mini-stat-label">累計完成</span>
                <span className="mini-stat-value" style={{ color: 'var(--accent)' }}>{completed.length}</span>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <div className="eyebrow">By subject</div>
                <div className="card-title">科目分佈</div>
              </div>
            </div>
            <div className="card-body" style={{ paddingTop: 6 }}>
              {data.subjects.map((subject) => {
                const subjectTasks = data.tasks.filter((task) => task.subjectId === subject.id);
                const done = subjectTasks.filter((task) => task.completed).length;
                const percent = subjectTasks.length ? Math.round((done / subjectTasks.length) * 100) : 0;
                return (
                  <div key={subject.id} style={{ marginBottom: 11 }}>
                    <div className="between" style={{ marginBottom: 4 }}>
                      <span className="tiny muted">{subject.name}</span>
                      <span className="tiny mono muted">{done}/{subjectTasks.length}</span>
                    </div>
                    <div className="progress">
                      <div className="progress-bar" style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="notice">
            <Icon name="info" size={15} />
            <span>任务顺延在 app 開啟、回到前景或跨日時執行；不需要保持頁面開著。</span>
          </div>
        </aside>
      </div>

      {editorOpen ? (
        <TaskEditor
          task={editingTask}
          defaultDate={today}
          onClose={() => {
            setEditorOpen(false);
            setEditingTask(undefined);
          }}
        />
      ) : null}
    </div>
  );
}
