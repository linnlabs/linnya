import type { AppUpdateState } from '../../../../../src/shared/update/definitions/updateMessage';
import type { UpdateMessageKey } from '../definitions/updateMessages';

export type UpdateEntryShape = 'icon' | 'pill';
export type UpdateEntryTone = 'accent' | 'warning';

export interface UpdateEntryPresentation {
  readonly shape: UpdateEntryShape;
  readonly tone: UpdateEntryTone;
  /** 传给 UpdateIcon 的进度；null 表示静态圆环。 */
  readonly progress: number | null;
  readonly labelKey: UpdateMessageKey;
  readonly labelParams: Readonly<Record<string, string>>;
  /** 点击是打开详情面板，而不是直接执行动作。 */
  readonly opensPanel: boolean;
}

export function formatUpdateBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes >= 100 ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB`;
}

export function formatUpdatePercent(fraction: number): string {
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

/** 入口外观完全由 Main 快照决定；idle 或非官方发行版返回 null，入口不占位置。 */
export function resolveUpdateEntryPresentation(state: AppUpdateState | null): UpdateEntryPresentation | null {
  if (!state?.enabled) return null;
  const version = state.version ?? '';
  switch (state.status) {
    case 'available':
      return { shape: 'icon', tone: 'accent', progress: null, labelKey: 'update.entry.available', labelParams: { version }, opensPanel: false };
    case 'downloading': {
      const fraction = state.progress?.fraction ?? null;
      return {
        shape: 'icon',
        tone: 'accent',
        progress: fraction ?? 0,
        labelKey: fraction === null ? 'update.entry.downloadingUnknown' : 'update.entry.downloading',
        labelParams: { percent: fraction === null ? '' : formatUpdatePercent(fraction) },
        opensPanel: true,
      };
    }
    case 'paused':
      return { shape: 'icon', tone: 'warning', progress: state.progress?.fraction ?? 0, labelKey: 'update.entry.paused', labelParams: {}, opensPanel: true };
    case 'failed':
      return { shape: 'icon', tone: 'warning', progress: null, labelKey: 'update.entry.failed', labelParams: {}, opensPanel: true };
    case 'ready':
      return { shape: 'pill', tone: 'accent', progress: null, labelKey: 'update.entry.ready', labelParams: { version }, opensPanel: false };
    case 'installing':
      return { shape: 'pill', tone: 'accent', progress: null, labelKey: 'update.entry.installing', labelParams: {}, opensPanel: false };
    default:
      return null;
  }
}
