import type { CustomSignSlots } from '../shared/types.ts';

export const DEFAULT_SIGN_LOCATIONS: { progress: number; side: -1 | 1; label: string }[] = [
  { progress: 0.045, side: -1, label: 'JPG Sign 1' },
  { progress: 0.32, side: 1, label: 'JPG Sign 2' },
  { progress: 0.64, side: -1, label: 'JPG Sign 3' },
];

const cachedDefaultJpgs: (string | null)[] = [null, null, null];

export function getDefaultSignJpgDataUrl(slotIndex: 0 | 1 | 2): string {
  const existing = cachedDefaultJpgs[slotIndex];
  if (existing) return existing;

  if (typeof document === 'undefined') {
    return '';
  }

  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const configs = [
    {
      bgTop: '#241409',
      bgBot: '#4a230c',
      accent: '#f59e0b',
      stripe: '#dc2626',
      eyebrow: 'HOUSE ATREIDES · ARRAKIS GP',
      title: 'FOR THE DUKE',
      subtitle: 'DUNE CIRCUIT CHAMPIONSHIP',
    },
    {
      bgTop: '#18181b',
      bgBot: '#27272a',
      accent: '#f4f4f5',
      stripe: '#dc2626',
      eyebrow: 'SPECIAL STAGE · DEEP DESERT',
      title: 'ESCORT RS',
      subtitle: 'RALLY HERITAGE · STAGE 02',
    },
    {
      bgTop: '#2b1306',
      bgBot: '#5c280a',
      accent: '#fb923c',
      stripe: '#38bdf8',
      eyebrow: 'MAKER TERRITORY · SECTOR 03',
      title: 'SHAI-HULUD',
      subtitle: 'BLESS THE MAKER & HIS WATER',
    },
  ];

  const cfg = configs[slotIndex];

  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, cfg.bgTop);
  grad.addColorStop(1, cfg.bgBot);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Diagonal rally/dune accent stripe
  ctx.fillStyle = cfg.stripe;
  ctx.beginPath();
  ctx.moveTo(0, 290);
  ctx.lineTo(canvas.width, 220);
  ctx.lineTo(canvas.width, 256);
  ctx.lineTo(0, 326);
  ctx.closePath();
  ctx.fill();

  // Rising twin desert sun disc
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = cfg.accent;
  ctx.beginPath();
  ctx.arc(canvas.width - 140, 150, 110, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Crisp outer border
  ctx.strokeStyle = cfg.accent;
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, canvas.width - 28, canvas.height - 28);

  // Typography
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = cfg.accent;
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText(cfg.eyebrow, canvas.width / 2, 84);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 74px sans-serif';
  ctx.fillText(cfg.title, canvas.width / 2, 174);

  ctx.fillStyle = '#e4e4e7';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(cfg.subtitle, canvas.width / 2, 316);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  cachedDefaultJpgs[slotIndex] = dataUrl;
  return dataUrl;
}

export interface ResolvedSignSlot {
  slotIndex: 0 | 1 | 2;
  dataUrl: string | null;
  isDefault: boolean;
  isCleared: boolean;
}

export function resolveSignSlots(slots?: CustomSignSlots | null): ResolvedSignSlot[] {
  return ([0, 1, 2] as const).map((idx) => {
    const val = slots ? slots[idx] : undefined;
    if (val === null) {
      return { slotIndex: idx, dataUrl: null, isDefault: false, isCleared: true };
    }
    if (val && val.dataUrl) {
      return { slotIndex: idx, dataUrl: val.dataUrl, isDefault: false, isCleared: false };
    }
    return {
      slotIndex: idx,
      dataUrl: getDefaultSignJpgDataUrl(idx),
      isDefault: true,
      isCleared: false,
    };
  });
}
