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
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, requireStorage } from './firebase';
import { weekEnd, weekLabel } from './week';

export type WinnerImageStatus = 'none' | 'pending' | 'approved' | 'rejected';

export interface WinnerCard {
  id: string;
  weekKey: string;
  uid: string;
  displayName: string;
  durationSeconds: number;
  quote: string;
  imagePath: string;
  imageStatus: WinnerImageStatus;
  settlementDate: string;
  archived: boolean;
  updatedAt?: string;
}

export const WINNER_QUOTE_LIMIT = 80;
export const WINNER_IMAGE_LIMIT_BYTES = 5 * 1024 * 1024;

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
    imagePath: '',
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
    imagePath: typeof data.imagePath === 'string' ? data.imagePath : '',
    imageStatus,
    settlementDate: typeof data.settlementDate === 'string' ? data.settlementDate : weekKey,
    archived: data.archived === true,
    updatedAt: data.updatedAt && typeof data.updatedAt === 'object' && 'toDate' in data.updatedAt
      ? (data.updatedAt as { toDate: () => Date }).toDate().toISOString()
      : undefined,
  };
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
    imagePath: card.imagePath,
    imageStatus: card.imageStatus,
    settlementDate: card.settlementDate,
    archived: card.archived,
    updatedAt: serverTimestamp(),
  });
}

export async function uploadWinnerImage(file: File, uid: string, weekKey: string): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('只接受圖片檔案。');
  if (file.size > WINNER_IMAGE_LIMIT_BYTES) throw new Error('圖片不可超過 5 MB。');
  const storage = requireStorage();
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80) || 'card-image';
  const path = `winnerCards/${uid}/${weekKey}/${Date.now()}-${safeName}`;
  const imageRef = ref(storage, path);
  await uploadBytes(imageRef, file, { contentType: file.type });
  return path;
}

export async function winnerImageUrl(path: string): Promise<string> {
  if (!path) return '';
  return getDownloadURL(ref(requireStorage(), path));
}

export async function setWinnerImageStatus(cardId: string, status: WinnerImageStatus): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  await updateDoc(doc(db, 'leaderboardWinner', cardId), {
    imageStatus: status,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteWinnerCard(cardId: string): Promise<void> {
  if (!db) throw new Error('Firestore 尚未設定。');
  await deleteDoc(doc(db, 'leaderboardWinner', cardId));
}
