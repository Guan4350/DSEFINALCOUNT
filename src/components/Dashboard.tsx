import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, Task } from '../types';
import { EVENT_TYPE_LABEL, TASK_KIND_LABEL } from '../types';
import { useApp } from '../contexts/AppContext';
import {
  daysUntil,
  formatDate,
  formatFullDate,
  todayISO,
} from '../lib/date';
import { nextDse, upcomingEvents } from '../lib/analytics';
import { SubjectBadge } from './SubjectBadge';
import { Heatmap } from './Heatmap';
import { TaskEditor } from './TaskEditor';
import { Icon } from './Icons';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return '夜深了';
  if (hour < 12) return '早晨';
  if (hour < 18) return '午後';
  return '晚上';
}

function eventTone(event: CalendarEvent): string {
  return event.type === 'dse' || event.type === 'mock' || event.type === 'school' || event.type === 'sba' ? 'exam' : 'custom';
}

export function Dashboard() {
  const {
    data,
    stats,
    semester,
    allEvents,
    systemTimetable,
    setView,
    setSelectedDate,
    toggleTask,
    checkIn,
    saveReflection,
  } = useApp();
  const today = todayISO();
  const [taskEditorOpen, setTaskEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | undefined>();
  const [reflection, setReflection] = useState(data.reflections[today]?.text || '');

  const todayTasks = useMemo(
    () =>
      data.tasks
        .filter((task) => task.dueDate === today || (task.completed && (task.completedAt || '').slice(0, 10) === today))
        .sort((a, b) => Number(a.completed) - Number(b.completed)),
    [data.tasks, today],
  );
  const completedToday = todayTasks.filter((task) => task.completed).length;
  const checkedIn = Boolean(data.checkins[today]);
  const dse = nextDse(allEvents, data.settings.dseStartDate, today);
  const dseDays = dse ? daysUntil(dse.start, today) : null;
  const upcoming = upcomingEvents(allEvents, today, 4);
  const subjectCountdowns = data.subjects
    .map((subject) => {
      const next = allEvents
        .filter(
          (event) =>
            !event.deleted &&
            event.subjectId === subject.id &&
            ['dse', 'mock', 'school', 'sba'].includes(event.type) &&
            event.start.slice(0, 10) >= today,
        )
        .sort((a, b) => a.start.localeCompare(b.start))[0];
      return { subject, event: next };
    })
    .filter((item) => item.event);
  const weekCompleted = data.tasks.filter((task) => {
    const date = (task.completedAt || '').slice(0, 10);
    return task.completed && date >= addDaysLocal(today, -6) && date <= today;
  }).length;

  const storedReflection = data.reflections[today]?.text || '';
  useEffect(() => {
    setReflection(storedReflection);
  }, [today, storedReflection]);

  useEffect(() => {
    if (reflection === storedReflection) return;
    const timer = window.setTimeout(() => saveReflection(today, reflection), 800);
    return () => window.clearTimeout(timer);
  }, [reflection, saveReflection, storedReflection, today]);

  const openNewTask = () => {
    setEditingTask(undefined);
    setTaskEditorOpen(true);
  };

  const openTask = (task: Task) => {
    setEditingTask(task);
    setTaskEditorOpen(true);
  };

  const goToDate = (date: string) => {
    setSelectedDate(date);
    setView('calendar');
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Personal learning dashboard / {semester.shortLabel}</div>
          <h1 className="page-title">{greeting()}，{data.profile.displayName}。</h1>
          <p className="page-subtitle">
            {formatFullDate(today)} · 將注意力放回下一個小時。今天只需要完成一件真正重要的事。
          </p>
        </div>
        <div className="row">
          <span className="chip">{semester.label}</span>
          <button type="button" className="btn btn-primary" onClick={openNewTask}>
            <Icon name="plus" size={15} />
            新增任務
          </button>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="stack">
          <section className="card hero-card">
            <div className="hero-main">
              <div>
                <div className="hero-kicker">DSE countdown / first paper</div>
                {dse ? (
                  <>
                    <div className="countdown">
                      <span className={`countdown-number${dseDays !== null && dseDays <= 30 ? ' accent' : ''}`}>
                        {dseDays !== null && dseDays >= 0 ? dseDays : '—'}
                      </span>
                      <span className="countdown-unit">days</span>
                    </div>
                    <p className="countdown-caption">
                      直到 <strong>{dse.title}</strong> · {formatFullDate(dse.start)}
                      <br />
                      {dse.source === 'system'
                        ? systemTimetable.source === 'estimated'
                          ? '預估日期，一切以 HKEAA 正式公告為準。'
                          : `${systemTimetable.label}；用戶只可隱藏，不可修改。`
                        : '自訂 DSE 日期；可在日曆或設定修改。'}
                      <br />
                      唔需要一次過處理整個考試；今日只處理下一個最清晰的步驟。
                    </p>
                  </>
                ) : (
                  <>
                    <div className="countdown">
                      <span className="countdown-number" style={{ opacity: 0.28 }}>—</span>
                      <span className="countdown-unit">date</span>
                    </div>
                    <p className="countdown-caption">
                      尚未設定 DSE 開考日期。加入日期後，總倒數、各科倒數和 .ics 都會自動建立。
                    </p>
                  </>
                )}
              </div>
              <div className="hero-footer">
                <div className="semester-mark">
                  <Icon name="book" size={14} />
                  <span>
                    {semester.label} · <strong>{semester.progress}%</strong>
                  </span>
                </div>
                {!dse ? (
                  <button type="button" className="btn btn-sm" onClick={() => setView('settings')}>
                    設定 DSE 日期
                  </button>
                ) : (
                  <button type="button" className="btn btn-sm" onClick={() => goToDate(dse.start)}>
                    查看日曆
                    <Icon name="arrow-up-right" size={13} />
                  </button>
                )}
              </div>
            </div>
            <aside className="hero-aside">
              <div>
                <div className="hero-side-label">Next on the horizon</div>
                <div className="hero-next">
                  {upcoming.length ? (
                    upcoming.slice(0, 3).map((event) => {
                      const days = daysUntil(event.start, today);
                      return (
                        <button
                          type="button"
                          className="hero-next-item"
                          key={event.id}
                          onClick={() => goToDate(event.start)}
                          style={{ borderWidth: 0, borderBottom: '1px solid var(--line)', padding: '0 0 10px', background: 'transparent', textAlign: 'left', color: 'inherit' }}
                        >
                          <span className="hero-next-title">{event.title}</span>
                          <span className="hero-next-days">{days >= 0 ? days : '—'}</span>
                          <span className="hero-next-meta">
                            {EVENT_TYPE_LABEL[event.type]} · {formatDate(event.start)}
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="help">尚未加入 Mock、校內考試或 SBA。把它們寫進日曆，倒數才有意義。</div>
                  )}
                </div>
              </div>
              <div className="hero-side-label" style={{ marginTop: 20 }}>
                {completedToday} / {todayTasks.length || 0} tasks closed today
              </div>
            </aside>
          </section>

          <div className="stat-strip">
            <div className="stat">
              <div className="stat-value">{completedToday}</div>
              <div className="stat-label">今日完成</div>
            </div>
            <div className="stat">
              <div className="stat-value gold">{stats.currentStreak}</div>
              <div className="stat-label">連續打卡</div>
            </div>
            <div className="stat">
              <div className="stat-value">{weekCompleted}</div>
              <div className="stat-label">本週完成</div>
            </div>
          </div>

          <section className="card today-card">
            <div className="card-head">
              <div>
                <div className="eyebrow">Today / {formatDate(today, { month: 'short', day: 'numeric', weekday: 'short' })}</div>
                <div className="card-title" style={{ marginTop: 5 }}>
                  <Icon name="check-square" size={15} />
                  今日任務
                  <span className="chip" style={{ marginLeft: 4 }}>{todayTasks.length}</span>
                </div>
              </div>
              <button type="button" className="btn btn-sm" onClick={openNewTask}>
                <Icon name="plus" size={13} />
                加入
              </button>
            </div>
            {todayTasks.length ? (
              <div className="today-list">
                {todayTasks.map((task) => {
                  const subject = data.subjects.find((item) => item.id === task.subjectId);
                  return (
                    <div className={`today-row${task.completed ? ' done' : ''}`} key={task.id}>
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
                        <div className="today-task-title">{task.title}</div>
                        <div className="today-task-meta">
                          <SubjectBadge subject={subject} />
                          <span>{TASK_KIND_LABEL[task.kind]}</span>
                          {task.rolloverCount > 0 ? <span className="rollover-flag">顺延 {task.rolloverCount} 次</span> : null}
                        </div>
                      </button>
                      <div className="today-row-actions">
                        <button type="button" className="icon-btn" onClick={() => openTask(task)} aria-label="編輯任務">
                          <Icon name="edit" size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty">
                <div className="empty-icon"><Icon name="check-square" /></div>
                <div className="empty-title">今日未有任務</div>
                <div className="empty-copy">先寫下一件 30–60 分鐘內可以開始的事。唔需要把整科溫完。</div>
                <button type="button" className="btn btn-sm btn-primary" onClick={openNewTask} style={{ marginTop: 4 }}>
                  新增第一個任務
                </button>
              </div>
            )}
            <div className="today-foot">
              <span>{checkedIn ? '今日已打卡' : completedToday > 0 ? '完成任務後可以打卡' : '打卡條件：至少完成一個今日任務'}</span>
              <button type="button" className={`btn btn-sm${checkedIn ? '' : ' btn-primary'}`} onClick={() => void checkIn(today)} disabled={checkedIn}>
                {checkedIn ? '已打卡' : '打卡'}
              </button>
            </div>
          </section>

          <section className="card reflection-card">
            <div className="card-head no-border">
              <div>
                <div className="eyebrow">Evening review</div>
                <div className="card-title" style={{ marginTop: 5 }}>
                  <Icon name="edit" size={15} />
                  每日文字复盘
                </div>
              </div>
              <span className="tiny muted">自動儲存</span>
            </div>
            <div style={{ padding: '0 19px 13px' }}>
              <textarea
                className="textarea"
                value={reflection}
                onChange={(event) => setReflection(event.target.value)}
                placeholder="今日學到什麼？邊一度仍然卡住？明日第一個動作是什麼？"
                maxLength={5000}
              />
              <div className="reflection-meta">
                <span>只寫三句也可以。</span>
                <span className="mono">{reflection.length} / 5000</span>
              </div>
            </div>
          </section>
        </div>

        <aside className="dashboard-side">
          <section className="card streak-card">
            <div className="between">
              <div>
                <div className="eyebrow">Personal streak</div>
                <div className="card-title" style={{ marginTop: 5 }}>
                  <Icon name="flame" size={15} />
                  連續打卡
                </div>
              </div>
              <span className={`chip${checkedIn ? ' chip-gold' : ''}`}>{checkedIn ? '今日完成' : '未打卡'}</span>
            </div>
            <div className="streak-number">
              <strong>{stats.currentStreak}</strong>
              <span>days</span>
            </div>
            <div className="streak-meta">
              <div>
                最長
                <strong>{stats.longestStreak} 日</strong>
              </div>
              <div>
                總計
                <strong>{stats.totalDays} 日</strong>
              </div>
              <div>
                狀態
                <strong>{stats.currentStreak > 0 ? '保持' : '重新開始'}</strong>
              </div>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => void checkIn(today)} disabled={checkedIn} style={{ width: '100%', marginTop: 15 }}>
              {checkedIn ? '今日已記錄' : '完成今日打卡'}
            </button>
          </section>

          <Heatmap checkins={data.checkins} stats={stats} onSelectDate={goToDate} />

          <section className="card">
            <div className="card-head">
              <div>
                <div className="eyebrow">Per-subject countdown</div>
                <div className="card-title" style={{ marginTop: 5 }}>
                  <Icon name="clock" size={15} />
                  各科倒數
                </div>
              </div>
              <span className="tiny muted">{subjectCountdowns.length} / {data.subjects.length}</span>
            </div>
            {subjectCountdowns.length ? (
              <div className="subject-countdown-list">
                {subjectCountdowns.map(({ subject, event }) => {
                  if (!event) return null;
                  const days = daysUntil(event.start, today);
                  return (
                    <button
                      type="button"
                      className="subject-countdown-row"
                      key={subject.id}
                      onClick={() => goToDate(event.start)}
                    >
                      <SubjectBadge subject={subject} />
                      <span className="subject-countdown-main">
                        <span className="subject-countdown-name">{subject.name}</span>
                        <span className="subject-countdown-meta">{event.title} · {formatDate(event.start)}</span>
                      </span>
                      <span className={`subject-countdown-days${eventTone(event) === 'exam' ? ' exam' : ''}`}>{days}d</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="empty" style={{ minHeight: 110, padding: 18 }}>
                <div className="empty-copy">為每個科目加入 DSE / Mock / 校內考試事件，這裡會自動顯示各科最近倒數。</div>
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <div className="eyebrow">Upcoming</div>
                <div className="card-title" style={{ marginTop: 5 }}>
                  <Icon name="calendar" size={15} />
                  考試與截止日
                </div>
              </div>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setView('calendar')}>
                全部
              </button>
            </div>
            {upcoming.length ? (
              <div className="upcoming-list">
                {upcoming.map((event) => {
                  const days = daysUntil(event.start, today);
                  return (
                    <button
                      type="button"
                      className="upcoming-item"
                      key={event.id}
                      onClick={() => goToDate(event.start)}
                      style={{ borderWidth: 0, borderBottom: '1px solid var(--line)', background: 'transparent', color: 'inherit', textAlign: 'left' }}
                    >
                      <span className={`upcoming-date ${eventTone(event)}`}>
                        <strong>{event.start.slice(8, 10)}</strong>
                        {formatDate(event.start, { month: 'short' })}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className="upcoming-title">{event.title}</span>
                        <span className="upcoming-meta">
                          {EVENT_TYPE_LABEL[event.type]}
                          {event.subjectId ? ` · ${data.subjects.find((subject) => subject.id === event.subjectId)?.name || ''}` : ''}
                        </span>
                      </span>
                      <span className={`upcoming-days${eventTone(event) === 'exam' ? ' exam' : ''}`}>{days >= 0 ? `${days}d` : '—'}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="empty" style={{ minHeight: 130 }}>
                <div className="empty-copy">加入 DSE、Mock、校內考試或 SBA deadline，這裡會自動排序。</div>
              </div>
            )}
          </section>
        </aside>
      </div>

      {taskEditorOpen ? (
        <TaskEditor
          task={editingTask}
          defaultDate={today}
          onClose={() => {
            setTaskEditorOpen(false);
            setEditingTask(undefined);
          }}
        />
      ) : null}
    </div>
  );
}

function addDaysLocal(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
