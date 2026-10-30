import type { Task } from '../types';
import { isISODate, todayISO } from './date';

export interface RolloverResult {
  tasks: Task[];
  moved: Task[];
}

/**
 * Moves incomplete study tasks whose due date has passed to today. It is
 * idempotent: run it on boot, on focus, and after midnight; a task can only
 * move once per calendar day because after the first run its dueDate is today.
 */
export function rolloverTasks(tasks: Task[], today = todayISO()): RolloverResult {
  const moved: Task[] = [];
  const now = new Date().toISOString();
  const next = tasks.map((task) => {
    if (task.completed) return task;
    if (!isISODate(task.dueDate)) return task;
    if (task.dueDate >= today) return task;
    const nextTask: Task = {
      ...task,
      dueDate: today,
      rolledFrom: task.rolledFrom || task.dueDate,
      rolloverCount: (task.rolloverCount || 0) + 1,
      updatedAt: now,
    };
    moved.push(nextTask);
    return nextTask;
  });
  return { tasks: next, moved };
}
