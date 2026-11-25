import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ConfidenceStatus } from '../types/observatory';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function formatPeriodLabel(periodValue: string): string {
  if (/^\d{4}-\d{2}$/.test(periodValue)) {
    const [year, monthStr] = periodValue.split('-');
    const monthIndex = Number(monthStr) - 1;
    if (monthIndex >= 0 && monthIndex < 12) {
      return `${MONTH_ABBR[monthIndex]} ${year}`;
    }
  }
  return periodValue;
}

export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

export function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

export function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getStatusTextClass(status: ConfidenceStatus): string {
  switch (status) {
    case 'Verified':
      return 'text-[#15803D]';
    case 'Pending Review':
      return 'text-[#B45309]';
    case 'Disputed':
      return 'text-[#B91C1C]';
    case 'Superseded':
      return 'text-[#64748B] line-through decoration-[#94A3B8]';
    default:
      return 'text-[#475569]';
  }
}
