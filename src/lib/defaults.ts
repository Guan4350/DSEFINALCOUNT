import type { AppData, Subject } from '../types';
import { addDays, todayISO } from './date';
import { defaultDseYear } from '../data/dse2025';
import { uid } from './id';

export const DEFAULT_SUBJECTS: Subject[] = [
  { id: 'sub-chi', name: '中文', category: 'CHI' },
  { id: 'sub-eng', name: '英文', category: 'ENG' },
  { id: 'sub-math', name: '數學', category: 'MATH' },
  { id: 'sub-csd', name: '公民與社會發展', category: 'CSD' },
  { id: 'sub-elective', name: '選修科', category: 'ELECTIVE' },
];

export function createDefaultData(): AppData {
  return {
    version: 1,
    profile: {
      displayName: 'Candidate',
      leaderboardOptIn: false,
    },
    settings: {
      dseYear: defaultDseYear(),
      dseStartDate: '',
      dseEndDate: '',
      studyStartDate: '',
      hiddenSystemExamIds: [],
      semesterMode: 'auto',
      timezone: 'Asia/Hong_Kong',
    },
    subjects: DEFAULT_SUBJECTS.map((subject) => ({ ...subject })),
    events: [],
    tasks: [],
    checkins: {},
    reflections: {},
    images: [],
    lastRollover: '',
  };
}

/** A deliberate, removable demo. It never loads by default. */
export function createDemoData(): AppData {
  const today = todayISO();
  const data = createDefaultData();
  data.profile.displayName = 'Demo Candidate';
  data.settings.dseStartDate = addDays(today, 120);
  data.settings.dseEndDate = addDays(today, 152);
  data.settings.studyStartDate = addDays(today, -45);
  data.events = [
    {
      id: uid('evt'),
      uid: uid('evt') + '@dse-candidate.local',
      title: 'DSE 開考',
      start: addDays(today, 120),
      end: addDays(today, 121),
      allDay: true,
      type: 'dse',
      description: '第一個 DSE 考試日。請在設定中改成官方日期。',
      source: 'local',
      updatedAt: new Date().toISOString(),
    },
    {
      id: uid('evt'),
      uid: uid('evt') + '@dse-candidate.local',
      title: 'DSE 完結',
      start: addDays(today, 152),
      end: addDays(today, 153),
      allDay: true,
      type: 'dse',
      description: '最後一個 DSE 考試日。',
      source: 'local',
      updatedAt: new Date().toISOString(),
    },
    {
      id: uid('evt'),
      uid: uid('evt') + '@dse-candidate.local',
      title: 'DSE 數學 Paper 1',
      start: addDays(today, 121),
      end: addDays(today, 122),
      allDay: true,
      type: 'dse',
      subjectId: 'sub-math',
      paper: 'Paper 1',
      source: 'local',
      updatedAt: new Date().toISOString(),
    },
    {
      id: uid('evt'),
      uid: uid('evt') + '@dse-candidate.local',
      title: 'DSE 英文 Paper 1',
      start: addDays(today, 122),
      end: addDays(today, 123),
      allDay: true,
      type: 'dse',
      subjectId: 'sub-eng',
      paper: 'Paper 1',
      source: 'local',
      updatedAt: new Date().toISOString(),
    },
    {
      id: uid('evt'),
      uid: uid('evt') + '@dse-candidate.local',
      title: '校內 Mock — 數學 Paper 1',
      start: addDays(today, 28),
      end: addDays(today, 29),
      allDay: true,
      type: 'mock',
      subjectId: 'sub-math',
      description: '兩小時，按考試時段。',
      source: 'local',
      updatedAt: new Date().toISOString(),
    },
    {
      id: uid('evt'),
      uid: uid('evt') + '@dse-candidate.local',
      title: 'SBA 遞交 — 中文',
      start: addDays(today, 42),
      end: addDays(today, 43),
      allDay: true,
      type: 'sba',
      subjectId: 'sub-chi',
      description: '最後校對及遞交。',
      source: 'local',
      updatedAt: new Date().toISOString(),
    },
  ];
  data.tasks = [
    {
      id: uid('task'),
      title: '數學：重做 2021 Paper 1 Q14–Q18',
      subjectId: 'sub-math',
      dueDate: today,
      completed: false,
      kind: 'revision',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rolloverCount: 0,
    },
    {
      id: uid('task'),
      title: '英文：整理 Paper 2 常用過渡句',
      subjectId: 'sub-eng',
      dueDate: today,
      completed: false,
      kind: 'study',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rolloverCount: 0,
    },
    {
      id: uid('task'),
      title: '中文：重讀範文《出師表》註釋',
      subjectId: 'sub-chi',
      dueDate: addDays(today, -1),
      completed: false,
      kind: 'revision',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rolledFrom: addDays(today, -1),
      rolloverCount: 1,
    },
    {
      id: uid('task'),
      title: '公民與社會發展：整理主題二概念圖',
      subjectId: 'sub-csd',
      dueDate: addDays(today, -1),
      completed: true,
      completedAt: new Date().toISOString(),
      completedDate: today,
      kind: 'study',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rolloverCount: 0,
    },
    {
      id: uid('task'),
      title: '選修科：完成一章 past paper',
      subjectId: 'sub-elective',
      dueDate: addDays(today, 2),
      completed: false,
      kind: 'revision',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rolloverCount: 0,
    },
  ];
  for (let i = 1; i <= 18; i += 1) {
    if (i === 4 || i === 11) continue;
    const date = addDays(today, -i);
    data.checkins[date] = {
      date,
      completedTaskCount: 1,
      createdAt: new Date().toISOString(),
      source: 'local',
    };
  }
  data.reflections[today] = {
    date: today,
    text: '今日先處理最弱的一科。唔追求做得多，追求錯題真正明白。',
    updatedAt: new Date().toISOString(),
  };
  return data;
}
