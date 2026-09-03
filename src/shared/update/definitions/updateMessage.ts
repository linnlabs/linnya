export type UpdateMessageChannel =
  | 'checking-for-update'
  | 'update-available'
  | 'update-not-available'
  | 'download-progress'
  | 'update-downloaded'
  | 'installing'
  | 'error';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error';

export interface UpdateVersionInfo {
  readonly version?: string;
  readonly releaseName?: string;
  readonly releaseNotes?: string;
  readonly releaseDate?: string;
}

export interface UpdateProgressInfo {
  readonly percent?: number;
  readonly total?: number;
  readonly bytesPerSecond?: number;
  readonly transferred?: number;
  readonly instantSpeed?: number;
}

export interface UpdateInstallingInfo {
  readonly requestedAt: string;
  readonly platform: string;
}

export type UpdateMessagePayload =
  | UpdateVersionInfo
  | UpdateProgressInfo
  | UpdateInstallingInfo
  | string
  | null
  | undefined;

export interface UpdateStatusMessage {
  readonly channel: UpdateMessageChannel;
  readonly payload?: UpdateMessagePayload;
}

export function isUpdateStatusMessage(value: unknown): value is UpdateStatusMessage {
  if (typeof value !== 'object' || value === null) return false;
  if (!('channel' in value)) return false;
  return typeof value.channel === 'string';
}
