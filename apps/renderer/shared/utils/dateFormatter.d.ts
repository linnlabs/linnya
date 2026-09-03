export interface FormatTimeOptions {
  readonly relativeLabels: {
    readonly yesterday: string;
  };
}

export function formatTime(timestamp: number | string, options: FormatTimeOptions): string;

export function formatDuration(seconds: number): string;

export function formatDueDateLabel(dateStr: string, timeStr?: string): string;
