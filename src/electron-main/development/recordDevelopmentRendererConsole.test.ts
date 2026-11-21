import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WebContents } from 'electron';
import { afterEach, describe, expect, it } from 'vitest';
import { recordDevelopmentRendererConsole } from './recordDevelopmentRendererConsole';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fakeContents(): EventEmitter & WebContents {
  return Object.assign(new EventEmitter(), {}) as unknown as EventEmitter & WebContents;
}

describe('recordDevelopmentRendererConsole', () => {
  it('按天写入与探针 renderer.jsonl 相同格式的控制台记录，级别归一，序号续接已有文件', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'renderer-console-'));
    roots.push(root);
    const contents = fakeContents();
    recordDevelopmentRendererConsole(contents, root);
    contents.emit('console-message', { level: 'info', message: 'hello' });
    contents.emit('console-message', { level: 'warning', message: 'careful' });
    contents.emit('console-message', { level: 'error', message: 'x'.repeat(5000) });

    const second = fakeContents();
    recordDevelopmentRendererConsole(second, root);
    second.emit('console-message', { level: 'debug', message: 'after restart' });

    const [file] = readdirSync(root);
    expect(file).toMatch(/^renderer-\d{4}-\d{2}-\d{2}\.jsonl$/);
    const entries = readFileSync(path.join(root, file), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(entries.map(entry => [entry.seq, entry.level])).toEqual([[1, 'info'], [2, 'warn'], [3, 'error'], [4, 'info']]);
    expect(entries[2].text).toHaveLength(4000);
    expect(typeof entries[0].time).toBe('number');
  });
});
