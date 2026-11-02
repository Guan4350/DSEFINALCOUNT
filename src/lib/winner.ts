import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { weekEnd, weekLabel } from './week';

export type WinnerImageStatus = 'none' | 'pending' | 'approved' | 'rejected';

export interface WinnerCard {
  id: string;
  weekKey: string;
  uid: string;
  displayName: string;
  durationSeconds: number;
  quote: string;
  /** Approved image data URL. Empty while pending/rejected. */
  imageData: string;
  imageStatus: WinnerImageStatus;
  settlementDate: string;
  archived: boolean;
  updatedAt?: string;
}

/** Private pending/rejected submission. Never rendered publicly. */
export interface WinnerSubmission {
  id: string;
  weekKey: string;
  uid: string;
  imageData: string;
  updatedAt?: string;
}

export const WINNER_QUOTE_LIMIT = 80;
export const WINNER_IMAGE_MAX_CHARS = 700_000;
export const WINNER_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/** Deliberately small, local-only filter; quotes do not need human review. */
const SENSITIVE_WORDS = [
  '白痴', '智障', '去死', '垃圾', '廢物', '賤人', '低能', '仆街',
  'fuck', 'shit', 'bitch', 'idiot', 'retard',
];

export function containsSensitiveWords(text: string): boolean {
  const lower = text.toLowerCase();
  return SENSITIVE_WORDS.some((word) => lower.includes(word));
}

export function winnerCardId(weekKey: string, uid: string): string {
  return `${weekKey}__${uid}`.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function winnerWeekLabel(weekKey: string): string {
  return weekLabel(weekKey);
}

export function winnerWeekRange(weekKey: string): { start: string; end: string } {
  return { start: weekKey, end: weekEnd(weekKey) };
}

export function emptyWinnerCard(weekKey: string, uid: string, displayName: string, durationSeconds: number): WinnerCard {
  return {
    id: winnerCardId(weekKey, uid),
    weekKey,
    uid,
    displayName,
    durationSeconds,
    quote: '',
    imageData: '',
    imageStatus: 'none',
    settlementDate: weekKey,
    archived: false,
  };
}

function winnerFromData(id: string, data: Record<string, unknown>): WinnerCard | null {
  const weekKey = typeof data.weekKey === 'string' ? data.weekKey : '';
  const uid = typeof data.uid === 'string' ? data.uid : '';
  if (!weekKey || !uid) return null;
  const imageStatus = ['none', 'pending', 'approved', 'rejected'].includes(String(data.imageStatus))
    ? (data.imageStatus as WinnerImageStatus)
    : 'none';
  return {
    id,
    weekKey,
    uid,
    displayName: typeof data.displayName === 'string' ? data.displayName : 'Candidate',
    durationSeconds: typeof data.durationSeconds === 'number' ? data.durationSeconds : 0,
    quote: typeof data.quote === 'string' ? data.quote : '',
    imageData: typeof data.imageData === 'string' ? data.imageData : '',
    imageStatus,
    settlementDate: typeof data.settlementDate === 'string' ? data.settlementDate : weekKey,
    archived: data.archived === true,
    updatedAt: data.updatedAt && typeof data.updatedAt === 'object' && 'toDate' in data.updatedAt
      ? (data.updatedAt as { toDate: () => Date }).toDate().toISOString()
      : undefined,
  };
}

function submissionFromData(id: string, data: Record<string, unknown>): WinnerSubmission | null {
  const weekKey = typeof data.weekKey === 'string' ? data.weekKey : '';
  const uid = typeof data.uid === 'string' ? data.uid : '';
  const imageData = typeof data.imageData === 'string' ? data.imageData : '';
  if (!weekKey || !uid || !imageData) return null;
  return { id, weekKey, uid, imageData };
}

export async function fetchWinnerCard(weekKey: string, uid: string): Promise<WinnerCard | null> {
  if (!db) return null;
  const snapshot = await getDoc(doc(db, 'leaderboardWinner', winnerCardId(weekKey, uid)));
  return snapshot.exists() ? winnerFromData(snapshot.id, snapshot.data()) : null;
}

export async function fetchWinnerCards(): Promise<WinnerCard[]> {
  if (!db) return [];
  const snapshot = await getDocs(query(
    collection(db, 'leaderboardWinner'),
    orderBy('weekKey', 'desc'),
    limit(50),
  ));
  return snapshot.docs
    .map((item) => winnerFromData(item.id, item.data()))
    .filter((card): card is WinnerCard => Boolean(card));
}

export async function saveWinnerCard(card: WinnerCard): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  await setDoc(doc(db, 'leaderboardWinner', card.id), {
    weekKey: card.weekKey,
    uid: card.uid,
    displayName: card.displayName.slice(0, 40),
    durationSeconds: Math.max(0, Math.round(card.durationSeconds)),
    quote: card.quote.slice(0, WINNER_QUOTE_LIMIT),
    imageData: card.imageData,
    imageStatus: card.imageStatus,
    settlementDate: card.settlementDate,
    archived: card.archived,
    updatedAt: serverTimestamp(),
  });
}

export async function saveWinnerSubmission(weekKey: string, uid: string, imageData: string): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  if (!imageData || imageData.length > WINNER_IMAGE_MAX_CHARS) throw new Error('圖片資料過大。');
  await setDoc(doc(db, 'winnerCardSubmissions', winnerCardId(weekKey, uid)), {
    weekKey,
    uid,
    imageData,
    updatedAt: serverTimestamp(),
  });
}

export async function fetchWinnerSubmission(weekKey: string, uid: string): Promise<WinnerSubmission | null> {
  if (!db) return null;
  const snapshot = await getDoc(doc(db, 'winnerCardSubmissions', winnerCardId(weekKey, uid)));
  return snapshot.exists() ? submissionFromData(snapshot.id, snapshot.data()) : null;
}

export async function deleteWinnerSubmission(weekKey: string, uid: string): Promise<void> {
  if (!db) return;
  await deleteDoc(doc(db, 'winnerCardSubmissions', winnerCardId(weekKey, uid)));
}

export async function approveWinnerCard(cardId: string, imageData: string): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  if (!imageData || imageData.length > WINNER_IMAGE_MAX_CHARS) throw new Error('圖片資料無效或過大。');
  await updateDoc(doc(db, 'leaderboardWinner', cardId), {
    imageData,
    imageStatus: 'approved',
    updatedAt: serverTimestamp(),
  });
}

export async function rejectWinnerCard(cardId: string): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  await updateDoc(doc(db, 'leaderboardWinner', cardId), {
    imageData: '',
    imageStatus: 'rejected',
    updatedAt: serverTimestamp(),
  });
}

export async function deleteWinnerCard(cardId: string): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  await deleteDoc(doc(db, 'leaderboardWinner', cardId));
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('無法讀取圖片。'));
    };
    image.src = url;
  });
}

/**
 * Compresses a card image to a Firestore-safe data URL. Spark has no Storage
 * requirement here; a 1 MiB document limit is the hard ceiling, so the target
 * is deliberately ≤700k characters including base64 overhead.
 */
export async function compressWinnerImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('只接受圖片檔案。');
  if (file.size > WINNER_IMAGE_MAX_BYTES) throw new Error('圖片不可超過 8 MB。');
  const image = await loadImage(file);
  const scale = Math.min(1, 960 / Math.max(image.width, image.height));
  let width = Math.max(1, Math.round(image.width * scale));
  let height = Math.max(1, Math.round(image.height * scale));

  for (let resize = 0; resize < 4; resize += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('瀏覽器不支援 Canvas。');
    context.fillStyle = '#f7fbf9';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42]) {
      const data = canvas.toDataURL('image/webp', quality);
      if (data.length <= WINNER_IMAGE_MAX_CHARS) return data;
    }
    width = Math.max(1, Math.round(width * 0.75));
    height = Math.max(1, Math.round(height * 0.75));
  }
  throw new Error('圖片壓縮後仍然過大，請換一張較簡單的圖片。');
}
