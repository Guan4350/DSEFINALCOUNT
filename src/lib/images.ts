import type { AppData, ImageNote } from '../types';
import { formatDate, todayISO } from './date';
import { uid } from './id';

export const MAX_IMAGES_PER_DAY = 8;
export const MAX_IMAGE_BYTES = 720_000;
export const MAX_LOCAL_IMAGE_BYTES = 3_800_000;

export interface CompressedImage {
  dataUrl: string;
  bytes: number;
  width: number;
  height: number;
}

export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] || '';
  return Math.round((base64.length * 3) / 4);
}

function loadBitmap(file: File): Promise<{ width: number; height: number; source: CanvasImageSource; cleanup: () => void }> {
  if ('createImageBitmap' in window) {
    return createImageBitmap(file).then((bitmap) => ({
      width: bitmap.width,
      height: bitmap.height,
      source: bitmap,
      cleanup: () => bitmap.close(),
    }));
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
        source: image,
        cleanup: () => URL.revokeObjectURL(url),
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('無法讀取圖片。'));
    };
    image.src = url;
  });
}

export async function compressImage(file: File, maxDimension = 1280, quality = 0.72): Promise<CompressedImage> {
  if (!file.type.startsWith('image/')) throw new Error('只支援圖片檔案。');
  if (file.size > 15 * 1024 * 1024) throw new Error('圖片太大，請先壓縮至 15MB 以下。');
  const bitmap = await loadBitmap(file);
  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('瀏覽器不支援圖片壓縮。');
    context.fillStyle = '#0B1622';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap.source, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/webp', quality);
    const bytes = dataUrlBytes(dataUrl);
    return { dataUrl, bytes, width, height };
  } finally {
    bitmap.cleanup();
  }
}

export function canAddImage(data: AppData, date: string, bytes: number): string | null {
  const images = data.images.filter((image) => image.date === date);
  if (images.length >= MAX_IMAGES_PER_DAY) return `每日最多 ${MAX_IMAGES_PER_DAY} 張圖片。`;
  const total = data.images.reduce((sum, image) => sum + (image.bytes || dataUrlBytes(image.dataUrl)), 0);
  if (total + bytes > MAX_LOCAL_IMAGE_BYTES) {
    return '本機圖片儲存接近上限。請先匯出備份，再刪除部分舊相片。';
  }
  return null;
}

export function createImageNote(
  data: AppData,
  compressed: CompressedImage,
  date: string,
  subjectId: string | undefined,
  caption: string,
): ImageNote | string {
  const error = canAddImage(data, date, compressed.bytes);
  if (error) return error;
  return {
    id: uid('img'),
    date,
    subjectId,
    caption: caption.trim().slice(0, 120) || `${formatDate(date)} 筆記`,
    dataUrl: compressed.dataUrl,
    createdAt: new Date().toISOString(),
    bytes: compressed.bytes,
  };
}

export function localImageUsage(data: AppData): { bytes: number; count: number; percent: number } {
  const bytes = data.images.reduce((sum, image) => sum + (image.bytes || dataUrlBytes(image.dataUrl)), 0);
  return {
    bytes,
    count: data.images.length,
    percent: Math.min(100, Math.round((bytes / MAX_LOCAL_IMAGE_BYTES) * 100)),
  };
}

export function defaultImageDate(): string {
  return todayISO();
}
