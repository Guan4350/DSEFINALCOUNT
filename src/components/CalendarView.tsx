import { useMemo, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import rrulePlugin from '@fullcalendar/rrule';
import zhTwLocale from '@fullcalendar/core/locales/zh-tw';
import type { DateClickArg } from '@fullcalendar/interaction';
import type { EventClickArg, EventDropArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import type { CalendarEvent, Task } from '../types';
import { EVENT_TYPE_LABEL, TASK_KIND_LABEL } from '../types';
import { useApp } from '../contexts/AppContext';
import { formatFullDate, formatTime, toISODate, todayISO } from '../lib/date';
import { SubjectBadge } from './SubjectBadge';
import { TaskEditor } from './TaskEditor';
import { EventEditor } from './EventEditor';
import { Modal } from './Modal';
import { Icon } from './Icons';

interface CalendarInput {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay: boolean;
  classNames: string[];
  extendedProps:
    | { kind: 'event'; event: CalendarEvent }
    | { kind: 'task'; task: Task }
    | { kind: 'system'; event: CalendarEvent };
  rrule?: string;
  editable?: boolean;
}

function isExamType(type: CalendarEvent['type']): boolean {
  return type === 'dse' || type === 'mock' || type === 'school' || type === 'sba';
}

/**
 * FullCalendar's RRule plugin needs DTSTART inside the string. Without it,
 * rrule falls back to "now", which makes imported recurring events appear on
 * the current day. Supply the event's own start in UTC (or DATE).
 */
function normalizeLocalDateTime(value: string): string {
  if (!value) return value;
  if (value.length <= 10) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (item: number) => String(item).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function rruleWithStart(event: CalendarEvent): string | undefined {
  if (!event.rrule) return undefined;
  if (event.allDay) {
    return `DTSTART;VALUE=DATE:${event.start.slice(0, 10).replace(/-/g, '')}\nRRULE:${event.rrule}`;
  }
  const start = new Date(event.start);
  if (Number.isNaN(start.getTime())) return undefined;
  const stamp = start.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `DTSTART:${stamp}\nRRULE:${event.rrule}`;
}

export function CalendarView() {
  const {
    data,
    allEvents,
    systemTimetable,
    selectedDate,
    setSelectedDate,
    updateTask,
    updateEvent,
    toggleSystemExamHidden,
  } = useApp();
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | undefined>();
  const [editingTask, setEditingTask] = useState<Task | undefined>();
  const [eventEditorOpen, setEventEditorOpen] = useState(false);
  const [taskEditorOpen, setTaskEditorOpen] = useState(false);
  const [systemPreview, setSystemPreview] = useState<CalendarEvent | undefined>();

  const inputs = useMemo<CalendarInput[]>(() => {
    const eventInputs: CalendarInput[] = allEvents
      .filter((event) => !event.deleted)
      .map((event) => ({
        id: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        classNames: [
          isExamType(event.type) ? 'event-exam' : event.type === 'study' ? 'event-task' : 'event-custom',
          event.start.slice(0, 10) < todayISO() ? 'event-past' : '',
        ].filter(Boolean),
        rrule: rruleWithStart(event),
        editable: event.source !== 'system',
        extendedProps: { kind: event.source === 'system' ? ('system' as const) : ('event' as const), event },
      }));
    const taskInputs: CalendarInput[] = data.tasks
      .filter((task) => task.dueDate)
      .map((task) => ({
        id: `task-${task.id}`,
        title: `${task.completed ? '✓ ' : ''}${task.title}`,
        start: task.dueDate,
        allDay: true,
        classNames: ['event-task', task.completed ? 'event-past' : ''],
        extendedProps: { kind: 'task' as const, task },
      }));
    return [...eventInputs, ...taskInputs];
  }, [allEvents, data.tasks]);

  const selectedEvents = useMemo(
    () =>
      allEvents
        .filter((event) => !event.deleted && event.start.slice(0, 10) === selectedDate)
        .sort((a, b) => a.start.localeCompare(b.start)),
    [allEvents, selectedDate],
  );
  const selectedTasks = useMemo(
    () => data.tasks.filter((task) => task.dueDate === selectedDate),
    [data.tasks, selectedDate],
  );

  const openNewEvent = (date = selectedDate) => {
    setSelectedDate(date);
    setEditingEvent(undefined);
    setEventEditorOpen(true);
  };

  const openNewTask = () => {
    setEditingTask(undefined);
    setTaskEditorOpen(true);
  };

  const handleEventClick = (info: EventClickArg) => {
    const kind = info.event.extendedProps.kind as 'event' | 'task' | 'system';
    setSelectedDate(info.event.startStr.slice(0, 10));
    if (kind === 'task') {
      setEditingTask(info.event.extendedProps.task as Task);
      setTaskEditorOpen(true);
    } else if (kind === 'system') {
      setSystemPreview(info.event.extendedProps.event as CalendarEvent);
    } else {
      setEditingEvent(info.event.extendedProps.event as CalendarEvent);
      setEventEditorOpen(true);
    }
  };

  const handleDateClick = (info: DateClickArg) => {
    setSelectedDate(info.dateStr.slice(0, 10));
  };

  const handleDrop = async (info: EventDropArg) => {
    if (info.event.extendedProps.kind === 'system') {
      info.revert();
      return;
    }
    const start = normalizeLocalDateTime(info.event.startStr);
    const end = info.event.endStr ? normalizeLocalDateTime(info.event.endStr) : undefined;
    if (info.event.extendedProps.kind === 'task') {
      const task = info.event.extendedProps.task as Task;
      await updateTask({ ...task, dueDate: start.slice(0, 10), updatedAt: new Date().toISOString() });
      return;
    }
    const event = info.event.extendedProps.event as CalendarEvent;
    await updateEvent({ ...event, start, end, allDay: info.event.allDay, updatedAt: new Date().toISOString() });
  };

  const handleResize = async (info: EventResizeDoneArg) => {
    if (info.event.extendedProps.kind !== 'event') {
      info.revert();
      return;
    }
    const event = info.event.extendedProps.event as CalendarEvent;
    await updateEvent({
      ...event,
      start: normalizeLocalDateTime(info.event.startStr),
      end: info.event.endStr ? normalizeLocalDateTime(info.event.endStr) : undefined,
      allDay: info.event.allDay,
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Month / week / day</div>
          <h1 className="page-title">日曆</h1>
          <p className="page-subtitle">
            DSE、Mock、校內考試、SBA 與溫習任務放在同一個時間軸。紅線只留給考試與截止日。
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => openNewTask()}>
            <Icon name="plus" size={14} />
            任務
          </button>
          <button type="button" className="btn btn-primary" onClick={() => openNewEvent()}>
            <Icon name="plus" size={14} />
            事件
          </button>
        </div>
      </div>

      <div className="calendar-layout">
        <section className="card calendar-card">
          <FullCalendar
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin, rrulePlugin]}
            initialView="dayGridMonth"
            locale={zhTwLocale}
            firstDay={1}
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
            }}
            buttonText={{ today: '今日', month: '月', week: '週', day: '日', list: '清單' }}
            height="auto"
            contentHeight="auto"
            expandRows
            dayMaxEvents={3}
            nowIndicator
            selectable
            selectMirror
            editable
            eventDurationEditable
            eventResizableFromStart
            events={inputs}
            eventClick={handleEventClick}
            dateClick={handleDateClick}
            datesSet={(arg) => {
              const next = toISODate(arg.view.currentStart);
              if (next.slice(0, 7) !== selectedDate.slice(0, 7)) setSelectedDate(next);
            }}
            select={(info) => openNewEvent(info.startStr.slice(0, 10))}
            eventDrop={(info) => void handleDrop(info)}
            eventResize={(info) => void handleResize(info)}
            eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            slotMinTime="06:00:00"
            slotMaxTime="24:00:00"
            allDayText="全日"
            noEventsText="這一日沒有事件"
          />
          <div className="calendar-legend">
            <span className="legend-item"><span className="legend-swatch exam" /> 考試 / 截止</span>
            <span className="legend-item"><span className="legend-swatch task" /> 任務 / 溫習</span>
            <span className="legend-item"><span className="legend-swatch custom" /> 自訂事件</span>
            <span className="legend-item" style={{ marginLeft: 'auto' }}>
              {systemTimetable.source === 'official' ? '官方 DSE 時間表' : '預估 DSE 時間表'}
            </span>
          </div>
        </section>

        <aside className="card day-panel">
          <div className="day-panel-head">
            <div className="eyebrow">Selected day</div>
            <div className="day-panel-date">{formatFullDate(selectedDate)}</div>
            <div className="day-panel-weekday">
              {selectedEvents.length} 個事件 · {selectedTasks.length} 個任務
            </div>
          </div>

          <div className="day-events">
            {selectedEvents.length ? (
              selectedEvents.map((event) => (
                <button
                  type="button"
                  className={`day-event${isExamType(event.type) ? ' exam' : event.type === 'custom' ? ' custom' : ''}`}
                  key={event.id}
                  onClick={() => {
                    if (event.source === 'system') {
                      setSystemPreview(event);
                    } else {
                      setEditingEvent(event);
                      setEventEditorOpen(true);
                    }
                  }}
                >
                  <span className="day-event-bar" />
                  <span style={{ minWidth: 0 }}>
                    <span className="day-event-title">{event.title}</span>
                    <span className="day-event-meta">
                      {EVENT_TYPE_LABEL[event.type]} · {event.allDay ? '全日' : formatTime(event.start)}
                      {event.paper ? ` · ${event.paper}` : ''}
                    </span>
                  </span>
                  <Icon name="chevron-right" size={13} />
                </button>
              ))
            ) : (
              <div className="empty" style={{ minHeight: 100, padding: 18 }}>
                <div className="empty-copy">這一日沒有考試或事件。</div>
              </div>
            )}
          </div>

          {selectedTasks.length ? (
            <div className="divider" />
          ) : null}
          {selectedTasks.length ? (
            <div className="day-events" style={{ maxHeight: 230 }}>
              {selectedTasks.map((task) => {
                const subject = data.subjects.find((item) => item.id === task.subjectId);
                return (
                  <div className="day-event" key={task.id} style={{ gridTemplateColumns: '3px minmax(0, 1fr) auto' }}>
                    <span className="day-event-bar" style={{ background: task.completed ? 'var(--accent)' : 'var(--primary-hover)' }} />
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTask(task);
                        setTaskEditorOpen(true);
                      }}
                      style={{ border: 0, background: 'transparent', padding: 0, textAlign: 'left', color: 'inherit' }}
                    >
                      <span className="day-event-title" style={{ textDecoration: task.completed ? 'line-through' : undefined }}>{task.title}</span>
                      <span className="day-event-meta">
                        <SubjectBadge subject={subject} /> {TASK_KIND_LABEL[task.kind]} · {task.completed ? '完成' : '未完成'}
                      </span>
                    </button>
                    <button type="button" className="icon-btn" onClick={() => void updateTask({ ...task, completed: !task.completed, completedAt: task.completed ? undefined : new Date().toISOString() })} aria-label="切換完成">
                      <Icon name={task.completed ? 'check' : 'check-square'} size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="day-panel-foot">
            <button type="button" className="btn btn-primary" onClick={() => openNewEvent(selectedDate)}>
              <Icon name="plus" size={13} />
              在這日加入事件
            </button>
            <button type="button" className="btn" onClick={openNewTask}>
              <Icon name="plus" size={13} />
              加入任務
            </button>
          </div>
        </aside>
      </div>

      {eventEditorOpen ? (
        <EventEditor
          event={editingEvent}
          defaultDate={selectedDate}
          onClose={() => {
            setEventEditorOpen(false);
            setEditingEvent(undefined);
          }}
        />
      ) : null}
      {taskEditorOpen ? (
        <TaskEditor
          task={editingTask}
          defaultDate={selectedDate}
          onClose={() => {
            setTaskEditorOpen(false);
            setEditingTask(undefined);
          }}
        />
      ) : null}
      {systemPreview ? (
        <Modal
          title={systemPreview.title}
          eyebrow={`${systemTimetable.label} · 唯讀`}
          onClose={() => setSystemPreview(undefined)}
          footer={
            <>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => {
                  toggleSystemExamHidden(systemPreview.id);
                  setSystemPreview(undefined);
                }}
              >
                隱藏此官方事件
              </button>
              <button type="button" className="btn" onClick={() => setSystemPreview(undefined)}>關閉</button>
            </>
          }
        >
          <div className="stack-sm">
            <div className="row">
              <span className="chip chip-exam">DSE 官方</span>
              <span className="tiny muted">{formatFullDate(systemPreview.start.slice(0, 10))}</span>
              {!systemPreview.allDay ? <span className="tiny muted">{formatTime(systemPreview.start)}–{systemPreview.end ? formatTime(systemPreview.end) : ''}</span> : null}
            </div>
            <div className="setting-copy" style={{ whiteSpace: 'pre-wrap' }}>
              {systemPreview.description}
            </div>
            <div className="notice exam">
              <Icon name="lock" size={15} />
              <span>系統 DSE 時間表為唯讀基底資料。普通用戶只可隱藏；只有管理員可更新官方時間。</span>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
