import { describe, expect, it } from 'vitest';
import { formatAgentTimestamp, formatHistoryDateTime, formatHistoryTime } from '../src/history-time';

const SH = 'Asia/Shanghai';
const NOW = Date.parse('2026-11-11T14:30:00+08:00');
const at = (iso: string) => Date.parse(iso);
const zh = (iso: string | number) => formatHistoryTime(typeof iso === 'number' ? iso : at(iso), { locale: 'zh-CN', now: NOW, timeZone: SH });
const en = (iso: string | number) => formatHistoryTime(typeof iso === 'number' ? iso : at(iso), { locale: 'en-US', now: NOW, timeZone: SH });

describe('formatHistoryTime 短写法', () => {
  it('一分钟内是刚刚，一小时内是几分钟前', () => {
    expect(zh(NOW - 30_000)).toBe('刚刚');
    expect(en(NOW - 30_000)).toBe('Just now');
    expect(zh(NOW - 12 * 60_000)).toBe('12 分钟前');
    expect(en(NOW - 59 * 60_000)).toBe('59 min ago');
  });

  it('今天只写时刻，昨天带时刻，24 小时制', () => {
    expect(zh('2026-11-11T09:05:00+08:00')).toBe('09:05');
    expect(zh('2026-11-11T00:00:00+08:00')).toBe('00:00');
    expect(zh('2026-11-10T21:40:00+08:00')).toBe('昨天 21:40');
    expect(en('2026-11-10T21:40:00+08:00')).toBe('Yesterday 21:40');
  });

  it('今年写月日，往年带年份', () => {
    expect(zh('2026-11-09T10:00:00+08:00')).toBe('11月9日');
    expect(en('2026-11-09T10:00:00+08:00')).toBe('Nov 9');
    expect(zh('2025-12-31T10:00:00+08:00')).toBe('2025年12月31日');
    expect(en('2025-12-31T10:00:00+08:00')).toBe('Dec 31, 2025');
  });

  it('按给定时区判断今天昨天，不按 UTC', () => {
    // UTC 是 11-10 17:00，上海已是 11-11 01:00。
    expect(zh('2026-11-10T17:00:00Z')).toBe('01:00');
    const lateNow = { locale: 'zh-CN', now: at('2026-01-01T00:30:00+08:00'), timeZone: SH } as const;
    expect(formatHistoryTime(at('2025-12-31T23:00:00+08:00'), lateNow)).toBe('昨天 23:00');
  });

  it('时钟略快的未来时间算刚刚，远未来按日期；空值为空', () => {
    expect(zh(NOW + 2 * 60_000)).toBe('刚刚');
    expect(zh('2026-11-20T10:00:00+08:00')).toBe('11月20日');
    expect(formatHistoryTime(null, { locale: 'zh-CN' })).toBe('');
    expect(formatHistoryTime(0, { locale: 'zh-CN' })).toBe('');
    expect(formatHistoryTime('不是时间', { locale: 'zh-CN' })).toBe('');
  });

  it('接受 ISO 字符串与 Date', () => {
    expect(formatHistoryTime('2026-11-11T09:05:00+08:00', { locale: 'zh-CN', now: NOW, timeZone: SH })).toBe('09:05');
    expect(formatHistoryTime(new Date(at('2026-11-11T09:05:00+08:00')), { locale: 'zh-CN', now: new Date(NOW), timeZone: SH })).toBe('09:05');
  });
});

describe('formatHistoryDateTime 完整写法', () => {
  it('年月日加时刻', () => {
    expect(formatHistoryDateTime(at('2026-11-09T14:32:05+08:00'), { locale: 'zh-CN', timeZone: SH })).toBe('2026年11月9日 14:32');
    expect(formatHistoryDateTime(at('2026-11-09T14:32:05+08:00'), { locale: 'en-US', timeZone: SH })).toBe('Nov 9, 2026, 14:32');
  });
});

describe('formatAgentTimestamp 给 Agent', () => {
  it('本地时间带偏移，不用 Z', () => {
    expect(formatAgentTimestamp(at('2026-11-09T06:32:05Z'), { timeZone: SH })).toBe('2026-11-09T14:32:05+08:00');
    expect(formatAgentTimestamp(at('2026-11-09T06:32:05Z'), { timeZone: 'UTC' })).toBe('2026-11-09T06:32:05+00:00');
    expect(formatAgentTimestamp(at('2026-07-01T12:00:00Z'), { timeZone: 'America/New_York' })).toBe('2026-07-01T08:00:00-04:00');
    expect(formatAgentTimestamp(at('2026-01-01T12:00:00Z'), { timeZone: 'Asia/Kolkata' })).toBe('2026-01-01T17:30:00+05:30');
  });

  it('结果仍是可解析的 ISO 8601，指向同一时刻', () => {
    const ms = at('2026-11-09T06:32:05Z');
    expect(Date.parse(formatAgentTimestamp(ms))).toBe(ms);
    expect(formatAgentTimestamp(undefined)).toBe('');
  });
});
