import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { User } from 'firebase/auth';
import type {
  AppData,
  CalendarEvent,
  Checkin,
  LeaderboardMetric,
  Profile,
  Reflection,
  Settings,
  Stats,
  Subject,
  SubjectCategory,
  Task,
  UsageSnapshot,
} from '../types';
import { addDays, getSemester, todayISO } from '../lib/date';
import { computeStats } from '../lib/analytics';
import { createDefaultData, createDemoData } from '../lib/defaults';
import {
  ensureProfile,
  fetchCloudSnapshot,
  migrateLocalData,
  removeEvent,
  removeTask,
  saveEvent,
  saveEventsBulk,
  saveProfile,
  saveReflection as saveReflectionCloud,
  saveSettings,
  saveTask,
  saveTasksBulk,
} from '../lib/cloud';
import {
  fetchOfficialTimetable,
  isAdminUser,
  recordCloudCheckin,
  saveOfficialTimetable,
  syncLeaderboardDoc,
} from '../lib/cloudModeB';
import { firebaseConfigured, observeAuth, signInWithGoogle, signOutOfGoogle } from '../lib/firebase';
import { applyTheme, getStoredTheme, type Theme } from '../lib/theme';
import { buildIcs, downloadIcs, parseIcs } from '../lib/ics';
import { compressImage, createImageNote, localImageUsage } from '../lib/images';
import { uid } from '../lib/id';
import { rolloverTasks } from '../lib/rollover';
import {
  downloadJson,
  exportBackup,
  importBackup,
  loadData,
  saveData,
} from '../lib/storage';
import {
  getUsage,
  resetUsage as resetUsageCounter,
  USAGE_EVENT,
} from '../lib/usage';
import type { SystemExamEvent } from '../data/dse2025';
import { timetableForYear, toCalendarEvents, type OfficialTimetable } from '../lib/systemExams';

export type View = 'dashboard' | 'calendar' | 'tasks' | 'gallery' | 'analytics' | 'leaderboard' | 'settings';

export interface Toast {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'error';
}

interface AppContextValue {
  data: AppData;
  setData: (next: AppData) => boolean;
  stats: Stats;
  semester: ReturnType<typeof getSemester>;
  selectedDate: string;
  setSelectedDate: (date: string) => void;
  view: View;
  setView: (view: View) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toasts: Toast[];
  showToast: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: string) => void;
  user: User | null;
  authLoading: boolean;
  cloudBusy: boolean;
  cloudReady: boolean;
  cloudEnabled: boolean;
  needsImport: boolean;
  isAdmin: boolean;
  systemTimetable: OfficialTimetable;
  systemEvents: CalendarEvent[];
  allEvents: CalendarEvent[];
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshCloud: () => Promise<void>;
  importLocalData: () => Promise<void>;
  addTask: (task: Task) => Promise<void>;
  updateTask: (task: Task) => Promise<void>;
  toggleTask: (taskId: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  addEvent: (event: CalendarEvent) => Promise<void>;
  updateEvent: (event: CalendarEvent) => Promise<void>;
  deleteEvent: (eventId: string) => Promise<void>;
  toggleSystemExamHidden: (eventId: string) => void;
  saveOfficialData: (events: SystemExamEvent[], year?: number) => Promise<void>;
  saveReflection: (date: string, text: string) => void;
  addImages: (date: string, files: File[], subjectId: string | undefined, caption: string) => Promise<{ added: number; error?: string }>;
  deleteImage: (imageId: string) => void;
  addSubject: (name: string, category: SubjectCategory) => void;
  deleteSubject: (subjectId: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
  checkIn: (date?: string) => Promise<void>;
  importIcsText: (text: string) => Promise<{ events: number; tasks: number; warnings: string[] }>;
  exportIcsFile: () => void;
  exportBackupFile: () => void;
  importBackupFile: (text: string) => void;
  resetAll: () => void;
  loadDemo: () => void;
  leaderboardMetric: LeaderboardMetric;
  setLeaderboardMetric: (metric: LeaderboardMetric) => void;
  usage: UsageSnapshot;
  resetUsage: () => void;
  imageUsage: ReturnType<typeof localImageUsage>;
}

const AppContext = createContext<AppContextValue | null>(null);

function messageFor(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function completedDateOf(task: Task): string | undefined {
  return task.completedDate || (task.completedAt || '').slice(0, 10) || undefined;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setDataState] = useState<AppData>(() => loadData());
  const dataRef = useRef(data);
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [view, setView] = useState<View>('dashboard');
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(firebaseConfigured);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [needsImport, setNeedsImport] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [officialTimetable, setOfficialTimetable] = useState<OfficialTimetable | null>(null);
  const [leaderboardMetric, setLeaderboardMetric] = useState<LeaderboardMetric>('currentStreak');
  const [usage, setUsage] = useState<UsageSnapshot>(() => getUsage());

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);

  const showToast = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = uid('toast');
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const persist = useCallback(
    (next: AppData): boolean => {
      const result = saveData(next);
      if (!result.ok) {
        showToast(result.error || '本機儲存失敗。', 'error');
        return false;
      }
      dataRef.current = next;
      setDataState(next);
      return true;
    },
    [showToast],
  );

  const setData = useCallback((next: AppData) => persist(next), [persist]);

  const stats = useMemo(() => computeStats(data.checkins), [data.checkins]);
  const semester = useMemo(() => getSemester(data.settings), [data.settings]);
  const imageUsage = useMemo(() => localImageUsage(data), [data]);
  const systemTimetable = useMemo(
    () => timetableForYear(data.settings.dseYear, officialTimetable || undefined),
    [data.settings.dseYear, officialTimetable],
  );
  const systemEvents = useMemo(
    () => toCalendarEvents(systemTimetable, data.subjects, data.settings.hiddenSystemExamIds),
    [data.settings.hiddenSystemExamIds, data.subjects, systemTimetable],
  );
  const allEvents = useMemo(() => [...data.events, ...systemEvents], [data.events, systemEvents]);

  const loadCloud = useCallback(
    async (authUser: User) => {
      setCloudBusy(true);
      setOfficialTimetable(null);
      setIsAdmin(false);
      try {
        const profile = await ensureProfile(authUser, dataRef.current.profile);
        const snapshot = await fetchCloudSnapshot(authUser.uid, profile);
        const local = dataRef.current;
        const cloudTaskIds = new Set(snapshot.tasks.map((task) => task.id));
        const cloudEventIds = new Set(snapshot.events.map((event) => event.id));
        const localOnlyTasks = local.tasks.filter((task) => !cloudTaskIds.has(task.id));
        const localOnlyEvents = local.events.filter((event) => !cloudEventIds.has(event.id));
        const localOnlyCheckins = Object.keys(local.checkins).filter((date) => !snapshot.checkins[date]);
        const localOnlyReflections = Object.keys(local.reflections).filter((date) => !snapshot.reflections[date]);
        const hasLocalOnly =
          localOnlyTasks.length > 0 ||
          localOnlyEvents.length > 0 ||
          localOnlyCheckins.length > 0 ||
          localOnlyReflections.length > 0;

        const next: AppData = {
          ...local,
          profile: snapshot.profile,
          settings: snapshot.settings
            ? {
                ...local.settings,
                ...snapshot.settings,
                hiddenSystemExamIds: Array.from(new Set([
                  ...local.settings.hiddenSystemExamIds,
                  ...(Array.isArray(snapshot.settings.hiddenSystemExamIds) ? snapshot.settings.hiddenSystemExamIds : []),
                ])),
              }
            : local.settings,
          tasks: [...snapshot.tasks, ...localOnlyTasks],
          events: [...snapshot.events, ...localOnlyEvents],
          checkins: { ...local.checkins, ...snapshot.checkins },
          reflections: { ...local.reflections, ...snapshot.reflections },
        };
        if (persist(next)) {
          setCloudReady(true);
          setNeedsImport(hasLocalOnly);
          setIsAdmin(await isAdminUser(authUser.uid));
        }
      } catch (error) {
        setCloudReady(false);
        showToast(`雲端載入失敗：${messageFor(error)}`, 'error');
      } finally {
        setCloudBusy(false);
      }
    },
    [persist, showToast],
  );

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = observeAuth((nextUser) => {
      if (cancelled) return;
      setUser(nextUser);
      setAuthLoading(false);
      if (nextUser) {
        void loadCloud(nextUser);
      } else {
        setCloudReady(false);
        setNeedsImport(false);
        setIsAdmin(false);
        setOfficialTimetable(null);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [loadCloud]);

  useEffect(() => {
    if (!user || !cloudReady) return;
    void fetchOfficialTimetable(data.settings.dseYear).then((official) => {
      setOfficialTimetable(official);
    });
  }, [cloudReady, data.settings.dseYear, user]);

  const signIn = useCallback(async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      showToast(messageFor(error), 'error');
    }
  }, [showToast]);

  const signOut = useCallback(async () => {
    try {
      await signOutOfGoogle();
      setCloudReady(false);
      setNeedsImport(false);
      setIsAdmin(false);
      setOfficialTimetable(null);
      showToast('已登出；本機資料仍保留。', 'info');
    } catch (error) {
      showToast(messageFor(error), 'error');
    }
  }, [showToast]);

  const refreshCloud = useCallback(async () => {
    if (!user) return;
    await loadCloud(user);
  }, [loadCloud, user]);

  const importLocalData = useCallback(async () => {
    if (!user) throw new Error('請先登入。');
    const current = dataRef.current;
    const importData: AppData = {
      ...current,
      tasks: current.tasks.map((task) => ({
        ...task,
        completedDate: task.completed ? completedDateOf(task) : undefined,
      })),
    };
    setCloudBusy(true);
    try {
      await migrateLocalData(user.uid, importData);
      let importedCheckins = 0;
      let skippedCheckins = 0;
      const checkins = Object.values(current.checkins).sort((a, b) => a.date.localeCompare(b.date)).slice(-90);
      for (const checkin of checkins) {
        const task = importData.tasks.find(
          (item) => item.completed && completedDateOf(item) === checkin.date,
        );
        if (!task) {
          skippedCheckins += 1;
          continue;
        }
        try {
          await recordCloudCheckin(user, {
            date: checkin.date,
            taskId: task.id,
            completedTaskCount: checkin.completedTaskCount,
          });
          importedCheckins += 1;
        } catch {
          skippedCheckins += 1;
        }
      }
      // One board sync for the whole import: importing 90 historical check-ins
      // must not spend 90 leaderboard rate-limit slots.
      try {
        await syncLeaderboardDoc(user, current.profile.displayName, current.profile.leaderboardOptIn);
      } catch {
        // A throttled board sync must not fail the data import.
      }
      setNeedsImport(false);
      await loadCloud(user);
      showToast(
        `已上傳任務、事件、反思${importedCheckins ? `及 ${importedCheckins} 日打卡` : ''}${skippedCheckins ? `；${skippedCheckins} 日打卡因缺少對應完成任務而略過` : ''}。`,
        'success',
      );
    } catch (error) {
      showToast(`匯入失敗：${messageFor(error)}`, 'error');
      throw error;
    } finally {
      setCloudBusy(false);
    }
  }, [loadCloud, showToast, user]);

  const addTask = useCallback(
    async (task: Task) => {
      const normalized: Task = {
        ...task,
        completedDate: task.completed ? task.completedDate || completionDate(task) : undefined,
        updatedAt: new Date().toISOString(),
        rolloverCount: task.rolloverCount || 0,
      };
      const current = dataRef.current;
      const next = {
        ...current,
        tasks: [normalized, ...current.tasks.filter((item) => item.id !== normalized.id)],
      };
      if (!persist(next)) return;
      if (user && cloudReady) {
        try {
          await saveTask(user.uid, normalized);
        } catch (error) {
          showToast(`任務已存本機，雲端寫入失敗：${messageFor(error)}`, 'error');
        }
      }
    },
    [cloudReady, persist, showToast, user],
  );

  const updateTask = addTask;

  const toggleTask = useCallback(
    async (taskId: string) => {
      const task = dataRef.current.tasks.find((item) => item.id === taskId);
      if (!task) return;
      const completed = !task.completed;
      await addTask({
        ...task,
        completed,
        completedAt: completed ? new Date().toISOString() : undefined,
        completedDate: completed ? todayISO() : undefined,
      });
    },
    [addTask],
  );

  const deleteTask = useCallback(
    async (taskId: string) => {
      const current = dataRef.current;
      if (!persist({ ...current, tasks: current.tasks.filter((task) => task.id !== taskId) })) return;
      if (user && cloudReady) {
        try {
          await removeTask(user.uid, taskId);
        } catch (error) {
          showToast(`本機已刪除，雲端刪除失敗：${messageFor(error)}`, 'error');
        }
      }
    },
    [cloudReady, persist, showToast, user],
  );

  const addEvent = useCallback(
    async (event: CalendarEvent) => {
      const normalized = { ...event, updatedAt: new Date().toISOString() };
      const current = dataRef.current;
      if (!persist({ ...current, events: [...current.events.filter((item) => item.id !== normalized.id), normalized] })) return;
      if (user && cloudReady) {
        try {
          await saveEvent(user.uid, normalized);
        } catch (error) {
          showToast(`事件已存本機，雲端寫入失敗：${messageFor(error)}`, 'error');
        }
      }
    },
    [cloudReady, persist, showToast, user],
  );

  const deleteEvent = useCallback(
    async (eventId: string) => {
      const current = dataRef.current;
      if (!persist({ ...current, events: current.events.filter((event) => event.id !== eventId) })) return;
      if (user && cloudReady) {
        try {
          await removeEvent(user.uid, eventId);
        } catch (error) {
          showToast(`本機已刪除，雲端刪除失敗：${messageFor(error)}`, 'error');
        }
      }
    },
    [cloudReady, persist, showToast, user],
  );

  const toggleSystemExamHidden = useCallback(
    (eventId: string) => {
      const current = dataRef.current;
      const hidden = current.settings.hiddenSystemExamIds;
      const nextHidden = hidden.includes(eventId)
        ? hidden.filter((id) => id !== eventId)
        : [...hidden, eventId];
      const next = { ...current, settings: { ...current.settings, hiddenSystemExamIds: nextHidden } };
      if (!persist(next)) return;
      if (user && cloudReady) {
        void saveSettings(user.uid, next.settings).catch((error) => {
          showToast(`隱藏設定已存本機，雲端寫入失敗：${messageFor(error)}`, 'error');
        });
      }
    },
    [cloudReady, persist, showToast, user],
  );

  const saveOfficialData = useCallback(
    async (events: SystemExamEvent[], year = data.settings.dseYear) => {
      if (!user || !isAdmin) throw new Error('只有管理員可以更新官方時間表。');
      await saveOfficialTimetable(year, events);
      if (year === data.settings.dseYear) {
        setOfficialTimetable({
          year,
          source: 'official',
          label: `${year} HKEAA 官方時間表`,
          events,
        });
      }
      showToast('官方時間表已更新。', 'success');
    },
    [data.settings.dseYear, isAdmin, showToast, user],
  );

  const saveReflection = useCallback(
    (date: string, text: string) => {
      const reflection: Reflection = { date, text, updatedAt: new Date().toISOString() };
      const current = dataRef.current;
      const next = { ...current, reflections: { ...current.reflections, [date]: reflection } };
      if (!persist(next)) return;
      if (user && cloudReady) {
        void saveReflectionCloud(user.uid, reflection).catch((error) => {
          showToast(`反思已存本機，雲端寫入失敗：${messageFor(error)}`, 'error');
        });
      }
    },
    [cloudReady, persist, showToast, user],
  );

  const addImages = useCallback(
    async (date: string, files: File[], subjectId: string | undefined, caption: string) => {
      let current = dataRef.current;
      let added = 0;
      for (const file of files) {
        try {
          const compressed = await compressImage(file);
          const image = createImageNote(current, compressed, date, subjectId, caption);
          if (typeof image === 'string') return { added, error: image };
          current = { ...current, images: [image, ...current.images] };
          if (!persist(current)) return { added, error: '本機儲存空間不足。' };
          added += 1;
        } catch (error) {
          return { added, error: messageFor(error) };
        }
      }
      if (added > 0) showToast(`已加入 ${added} 張筆記圖片（只存此裝置）。`, 'success');
      return { added };
    },
    [persist, showToast],
  );

  const deleteImage = useCallback(
    (imageId: string) => {
      const current = dataRef.current;
      persist({ ...current, images: current.images.filter((image) => image.id !== imageId) });
    },
    [persist],
  );

  const addSubject = useCallback(
    (name: string, category: SubjectCategory) => {
      const trimmed = name.trim().slice(0, 32);
      if (!trimmed) return;
      const subject: Subject = { id: uid('sub'), name: trimmed, category, custom: true };
      persist({ ...dataRef.current, subjects: [...dataRef.current.subjects, subject] });
    },
    [persist],
  );

  const deleteSubject = useCallback(
    (subjectId: string) => {
      const current = dataRef.current;
      const subject = current.subjects.find((item) => item.id === subjectId);
      if (!subject?.custom) return;
      persist({
        ...current,
        subjects: current.subjects.filter((item) => item.id !== subjectId),
        tasks: current.tasks.map((task) => (task.subjectId === subjectId ? { ...task, subjectId: '' } : task)),
        events: current.events.map((event) => (event.subjectId === subjectId ? { ...event, subjectId: undefined } : event)),
        images: current.images.map((image) => (image.subjectId === subjectId ? { ...image, subjectId: undefined } : image)),
      });
    },
    [persist],
  );

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      const current = dataRef.current;
      const next = { ...current, settings: { ...current.settings, ...patch } };
      if (!persist(next)) return;
      if (user && cloudReady) {
        void saveSettings(user.uid, next.settings).catch((error) => {
          showToast(`設定已存本機，雲端寫入失敗：${messageFor(error)}`, 'error');
        });
      }
    },
    [cloudReady, persist, showToast, user],
  );

  const updateProfile = useCallback(
    async (patch: Partial<Profile>) => {
      const current = dataRef.current;
      const nextProfile = { ...current.profile, ...patch };
      if (!persist({ ...current, profile: nextProfile })) return;
      if (user && cloudReady) {
        try {
          await saveProfile(user.uid, nextProfile);
          await syncLeaderboardDoc(user, nextProfile.displayName, nextProfile.leaderboardOptIn);
        } catch (error) {
          showToast(`個人資料雲端更新失敗：${messageFor(error)}`, 'error');
        }
      }
    },
    [cloudReady, persist, showToast, user],
  );

  const checkIn = useCallback(
    async (date = todayISO()) => {
      const current = dataRef.current;
      if (current.checkins[date]) {
        showToast('這一日已打卡。', 'info');
        return;
      }
      const allowed = new Set([todayISO(), addDays(todayISO(), -1)]);
      if (!allowed.has(date)) {
        showToast('只可打卡今日或過去 24 小時內的一日。', 'error');
        return;
      }
      const completedTasks = current.tasks.filter(
        (task) => task.completed && completedDateOf(task) === date,
      );
      if (completedTasks.length < 1) {
        showToast('打卡前請先完成至少一個當日任務。', 'error');
        return;
      }
      const task = completedTasks[0];

      if (user && cloudReady) {
        try {
          if (!task.completedDate) {
            await addTask({ ...task, completedDate: date, completedAt: task.completedAt || new Date().toISOString() });
          }
          const response = await recordCloudCheckin(user, {
            date,
            taskId: task.id,
            completedTaskCount: completedTasks.length,
          });
          persist({
            ...dataRef.current,
            checkins: { ...dataRef.current.checkins, [date]: response.checkin },
          });
          try {
            await syncLeaderboardDoc(user, current.profile.displayName, current.profile.leaderboardOptIn);
            showToast('打卡已同步；排行榜會於下次輪詢更新。', 'success');
          } catch (error) {
            showToast(`打卡已同步；排行榜暫未更新（${messageFor(error)}）。`, 'info');
          }
        } catch (error) {
          showToast(`打卡失敗：${messageFor(error)}`, 'error');
        }
        return;
      }

      const checkin: Checkin = {
        date,
        completedTaskCount: completedTasks.length,
        taskId: task.id,
        createdAt: new Date().toISOString(),
        source: 'local',
      };
      persist({ ...dataRef.current, checkins: { ...dataRef.current.checkins, [date]: checkin } });
      showToast('已本機打卡。', 'success');
    },
    [addTask, cloudReady, persist, showToast, user],
  );

  const importIcsText = useCallback(
    async (input: string) => {
      const current = dataRef.current;
      const result = parseIcs(input, current.subjects);
      if (result.events.length === 0 && result.tasks.length === 0) {
        return { events: 0, tasks: 0, warnings: result.warnings };
      }
      const next: AppData = {
        ...current,
        events: [...current.events, ...result.events],
        tasks: [...result.tasks, ...current.tasks],
      };
      if (!persist(next)) return { events: 0, tasks: 0, warnings: ['本機儲存失敗。'] };
      if (user && cloudReady) {
        try {
          await saveEventsBulk(user.uid, result.events);
          await saveTasksBulk(user.uid, result.tasks);
        } catch (error) {
          result.warnings.push(`雲端同步失敗：${messageFor(error)}`);
        }
      }
      showToast(`已匯入 ${result.events.length} 個事件、${result.tasks.length} 個任務。`, 'success');
      return { events: result.events.length, tasks: result.tasks.length, warnings: result.warnings };
    },
    [cloudReady, persist, showToast, user],
  );

  const exportIcsFile = useCallback(() => {
    const current = dataRef.current;
    const content = buildIcs([...current.events, ...systemEvents], current.tasks, current.subjects);
    downloadIcs(`dse-candidate-${current.settings.dseYear}-${todayISO()}.ics`, content);
  }, [systemEvents]);

  const exportBackupFile = useCallback(() => {
    downloadJson(`dse-candidate-backup-${todayISO()}.json`, exportBackup(dataRef.current));
  }, []);

  const importBackupFile = useCallback(
    (input: string) => {
      try {
        const next = importBackup(input);
        persist(next);
        showToast('備份已匯入本機。如已登入，請按「上傳本機資料」同步雲端。', 'success');
      } catch (error) {
        showToast(`備份格式錯誤：${messageFor(error)}`, 'error');
      }
    },
    [persist, showToast],
  );

  const resetAll = useCallback(() => {
    persist(createDefaultData());
    setSelectedDate(todayISO());
    showToast('已重設本機資料；雲端資料未刪除。', 'info');
  }, [persist, showToast]);

  const loadDemo = useCallback(() => {
    persist(createDemoData());
    showToast('已載入示範資料，可隨時重設。', 'success');
  }, [persist, showToast]);

  const resetUsage = useCallback(() => {
    resetUsageCounter();
    setUsage(getUsage());
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<UsageSnapshot>;
      setUsage(custom.detail || getUsage());
    };
    window.addEventListener(USAGE_EVENT, handler);
    setUsage(getUsage());
    return () => window.removeEventListener(USAGE_EVENT, handler);
  }, []);

  const runRollover = useCallback(() => {
    const current = dataRef.current;
    const today = todayISO();
    if (current.lastRollover === today) return;
    const result = rolloverTasks(current.tasks, today);
    const next = { ...current, tasks: result.tasks, lastRollover: today };
    if (!persist(next)) return;
    if (result.moved.length > 0) {
      if (user && cloudReady) {
        void saveTasksBulk(user.uid, result.moved).catch((error) => {
          showToast(`顺延任務雲端同步失敗：${messageFor(error)}`, 'error');
        });
      }
      showToast(`${result.moved.length} 個未完成任務已自动顺延到今日。`, 'info');
    }
  }, [cloudReady, persist, showToast, user]);

  useEffect(() => {
    runRollover();
    const timer = window.setInterval(runRollover, 60_000);
    const onVisible = () => {
      if (!document.hidden) runRollover();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [runRollover]);

  const value: AppContextValue = {
    data,
    setData,
    stats,
    semester,
    selectedDate,
    setSelectedDate,
    view,
    setView,
    theme,
    setTheme,
    toasts,
    showToast,
    dismissToast,
    user,
    authLoading,
    cloudBusy,
    cloudReady,
    cloudEnabled: firebaseConfigured,
    needsImport,
    isAdmin,
    systemTimetable,
    systemEvents,
    allEvents,
    signIn,
    signOut,
    refreshCloud,
    importLocalData,
    addTask,
    updateTask,
    toggleTask,
    deleteTask,
    addEvent,
    updateEvent: addEvent,
    deleteEvent,
    toggleSystemExamHidden,
    saveOfficialData,
    saveReflection,
    addImages,
    deleteImage,
    addSubject,
    deleteSubject,
    updateSettings,
    updateProfile,
    checkIn,
    importIcsText,
    exportIcsFile,
    exportBackupFile,
    importBackupFile,
    resetAll,
    loadDemo,
    leaderboardMetric,
    setLeaderboardMetric,
    usage,
    resetUsage,
    imageUsage,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

function completionDate(task: Task): string | undefined {
  return (task.completedAt || '').slice(0, 10) || task.dueDate;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
