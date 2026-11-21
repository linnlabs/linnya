import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { WebContents } from 'electron';

type ConsoleLevel = 'info' | 'warn' | 'error';

interface ConsoleMessageEvent {
  readonly level?: string;
  readonly message?: string;
}

function normalizeLevel(level: string | undefined): ConsoleLevel {
  if (level === 'error') return 'error';
  if (level === 'warning' || level === 'warn') return 'warn';
  return 'info';
}

function dayStamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * 开发模式下把主窗口 Renderer 控制台按天写进 `<_dev_data>/logs/renderer-YYYY-MM-DD.jsonl`。
 *
 * 中文说明：格式与 Desktop 探针的 renderer.jsonl 相同（每行 seq/time/level/text），
 * 探针 `logs --attach` 直接读取；只在源码开发会话启用，生产不落盘 Renderer 控制台。
 */
export function recordDevelopmentRendererConsole(contents: WebContents, logDirectory: string): void {
  let currentFile = '';
  let sequence = 0;
  const fileFor = (now: Date) => path.join(logDirectory, `renderer-${dayStamp(now)}.jsonl`);
  contents.on('console-message', (event: ConsoleMessageEvent) => {
    try {
      const now = new Date();
      const file = fileFor(now);
      if (file !== currentFile) {
        mkdirSync(logDirectory, { recursive: true });
        let existing = '';
        try { existing = readFileSync(file, 'utf8'); } catch { existing = ''; }
        sequence = existing.split('\n').filter(Boolean).length;
        currentFile = file;
      }
      sequence += 1;
      appendFileSync(file, `${JSON.stringify({
        seq: sequence, time: now.getTime(), level: normalizeLevel(event.level), text: String(event.message ?? '').slice(0, 4000),
      })}\n`, { mode: 0o600 });
    } catch {
      // 开发日志写失败不能影响窗口；现场仍可用 DevTools 查看。
    }
  });
}
