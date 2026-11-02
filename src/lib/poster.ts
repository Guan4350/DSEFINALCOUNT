import type { WinnerCard } from './winner';
import { formatMinutes } from './timer';
import { winnerWeekLabel } from './winner';

function loadImage(url: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => resolve(null), 8000);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    image.src = url;
  });
}

/**
 * A deterministic 1080×1350 share poster drawn on canvas; no external canvas
 * library is added. If approved image data is missing/invalid, the poster still
 * renders with the Octavarium gradient and quote.
 */
export async function downloadWinnerPoster(card: WinnerCard, imageData: string): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('瀏覽器不支援 Canvas。');

  const sky = '#b8d2e8';
  const grass = '#89a878';
  const ink = '#2a2e33';
  const muted = '#66707a';

  const background = context.createLinearGradient(0, 0, 1080, 1350);
  background.addColorStop(0, '#f7fbf9');
  background.addColorStop(0.55, '#eef5f8');
  background.addColorStop(1, '#e8f0e4');
  context.fillStyle = background;
  context.fillRect(0, 0, 1080, 1350);

  context.globalAlpha = 0.36;
  context.fillStyle = sky;
  context.beginPath();
  context.arc(120, 120, 380, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = grass;
  context.beginPath();
  context.arc(980, 1230, 430, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;

  context.fillStyle = ink;
  context.font = '600 30px "Noto Sans TC", "PingFang HK", sans-serif';
  context.fillText('DSE CANDIDATE · WEEKLY FOCUS', 80, 130);
  context.font = '400 58px "Noto Serif TC", "Songti TC", serif';
  context.fillText('本週榜首', 80, 215);

  const image = await loadImage(imageData);
  const imageX = 80;
  const imageY = 270;
  const imageW = 920;
  const imageH = 560;
  context.save();
  context.beginPath();
  context.roundRect(imageX, imageY, imageW, imageH, 28);
  context.clip();
  if (image) {
    const scale = Math.max(imageW / image.width, imageH / image.height);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    context.drawImage(image, imageX + (imageW - drawW) / 2, imageY + (imageH - drawH) / 2, drawW, drawH);
  } else {
    const placeholder = context.createLinearGradient(imageX, imageY, imageX + imageW, imageY + imageH);
    placeholder.addColorStop(0, sky);
    placeholder.addColorStop(1, grass);
    context.fillStyle = placeholder;
    context.fillRect(imageX, imageY, imageW, imageH);
    context.fillStyle = 'rgba(42,46,51,.55)';
    context.font = '400 42px "Noto Serif TC", "Songti TC", serif';
    context.textAlign = 'center';
    context.fillText(card.displayName.slice(0, 18), imageX + imageW / 2, imageY + imageH / 2);
    context.textAlign = 'left';
  }
  context.restore();

  context.fillStyle = ink;
  context.font = '600 52px "Noto Serif TC", "Songti TC", serif';
  context.fillText(card.displayName.slice(0, 20), 80, 910);
  context.fillStyle = grass;
  context.font = '600 34px "Noto Sans TC", "PingFang HK", sans-serif';
  context.fillText(`${formatMinutes(card.durationSeconds)} · ${winnerWeekLabel(card.weekKey)}`, 80, 965);

  context.fillStyle = ink;
  context.font = '400 36px "Noto Serif TC", "Songti TC", serif';
  const quote = card.quote.trim() || '把努力留在今日，把平靜帶進考場。';
  const lines: string[] = [];
  let current = '';
  for (const character of quote.slice(0, 80)) {
    current += character;
    if (context.measureText(current).width > 900) {
      lines.push(current);
      current = '';
    }
  }
  if (current) lines.push(current);
  lines.slice(0, 3).forEach((line, index) => {
    context.fillText(line, 80, 1080 + index * 58);
  });

  context.fillStyle = muted;
  context.font = '400 24px "Noto Sans TC", "PingFang HK", sans-serif';
  context.fillText('累積不是奇蹟，是每天的回聲。', 80, 1300);

  const link = document.createElement('a');
  link.download = `dse-weekly-winner-${card.weekKey}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
