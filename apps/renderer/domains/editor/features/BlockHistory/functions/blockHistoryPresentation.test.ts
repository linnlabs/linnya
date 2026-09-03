import { describe, expect, it, vi } from 'vitest';
import type { EditorMessageResolver } from '../../../definitions/editorMessages';
import {
  formatBlockHistoryShortTime,
  readBlockHistoryOriginLabel,
} from './blockHistoryPresentation';

const message: EditorMessageResolver = (key, params) => {
  const messages: Partial<Record<Parameters<EditorMessageResolver>[0], string>> = {
    'editor.blockHistory.time.justNow': '刚刚',
    'editor.blockHistory.time.minutesAgo': `${params?.count} 分钟前`,
    'editor.blockHistory.origin.ai': 'AI 生成',
    'editor.blockHistory.origin.manual': '手动编辑',
    'editor.blockHistory.origin.restore': '版本恢复',
  };
  return messages[key] ?? key;
};

describe('blockHistoryPresentation', () => {
  it('格式化历史时间轴的相对时间', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-22T10:30:00+08:00'));

    expect(formatBlockHistoryShortTime(new Date('2026-06-22T10:29:30+08:00').getTime(), 'zh-CN', message)).toBe('刚刚');
    expect(formatBlockHistoryShortTime(new Date('2026-06-22T10:25:00+08:00').getTime(), 'zh-CN', message)).toBe('5 分钟前');

    vi.useRealTimers();
  });

  it('按当前语言格式化日期并解析来源标签', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-22T10:30:00+08:00'));

    const timestamp = new Date('2026-05-21T09:00:00+08:00').getTime();

    expect(formatBlockHistoryShortTime(timestamp, 'en-US', message)).toBe('5/21');
    expect(readBlockHistoryOriginLabel('restore', message)).toBe('版本恢复');

    vi.useRealTimers();
  });
});
