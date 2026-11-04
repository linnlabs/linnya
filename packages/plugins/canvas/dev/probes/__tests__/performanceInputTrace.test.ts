import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { WebContents } from 'electron';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { startCanvasPerformanceInputTrace } from '../performanceInputTraceElectron';

class Contents extends EventEmitter {
  readonly sent: Parameters<WebContents['sendInputEvent']>[0][] = [];
  finishFailure: Error | null = null;
  startFailure: Error | null = null;
  isFocused() { return true; }
  sendInputEvent(input: Parameters<WebContents['sendInputEvent']>[0]) { this.sent.push(input); }
  async executeJavaScript(expression: string): Promise<unknown> {
    if (expression.includes('finish')) {
      if (this.finishFailure) throw this.finishFailure;
      return { events: [{ kind: 'pointercancel' }], overflow: 0 };
    }
    if (this.startFailure) throw this.startFailure;
  }
}
const evidenceSchema = z.object({ events: z.array(z.object({ kind: z.string() }).passthrough()), overflow: z.number(), validHardwareRun: z.boolean(),
  profiling: z.boolean(), renderer: z.object({ overflow: z.number() }).optional(), rendererFailure: z.string().nullable() });
class Window extends EventEmitter {
  readonly webContents = new Contents();
  focused = true;
  isFocused() { return this.focused; }
}

it('按原输入/this转发并有界保留焦点、sent和overflow，结束卸载两端监听', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'canvas-input-trace-')), window = new Window();
  try {
    const trace = await startCanvasPerformanceInputTrace(window, output, false);
    window.focused = false; window.emit('blur'); window.webContents.emit('focus');
    const input = { type: 'mouseDown', x: 20, y: 30, button: 'left', clickCount: 1 } satisfies Parameters<WebContents['sendInputEvent']>[0];
    for (let i = 0; i < 520; i++) trace.send(input);
    await trace.finish();
    const evidence = evidenceSchema.parse(JSON.parse(await readFile(path.join(output, 'input-trace.json'), 'utf8')));
    expect(window.webContents.sent).toHaveLength(520); expect(window.webContents.sent.every(value => value === input)).toBe(true);
    expect(evidence.events).toHaveLength(512); expect(evidence.overflow).toBeGreaterThan(0);
    expect(evidence.events[3]).toMatchObject({ kind: 'native-sent', input, beforeFocus: { window: false, webContents: true } });
    expect(evidence.validHardwareRun).toBe(false); expect(evidence.profiling).toBe(false); expect(evidence.renderer?.overflow).toBe(0);
    expect(window.listenerCount('blur')).toBe(0); expect(window.webContents.listenerCount('focus')).toBe(0);
  } finally { await rm(output, { recursive: true, force: true }); }
});

it('Renderer观察结束失败也保存已发生的Node输入与错误事实，不遗留focus监听', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'canvas-input-failure-')), window = new Window(), failure = new Error('renderer_disconnected');
  try {
    const trace = await startCanvasPerformanceInputTrace(window, output, false);
    trace.send({ type: 'mouseUp', x: 10, y: 20, button: 'left', clickCount: 1 }); window.webContents.finishFailure = failure;
    await expect(trace.finish()).rejects.toBe(failure);
    const evidence = evidenceSchema.parse(JSON.parse(await readFile(path.join(output, 'input-trace.json'), 'utf8')));
    expect(evidence.rendererFailure).toBe('renderer_disconnected'); expect(evidence.events.some(event => event.kind === 'native-sent')).toBe(true);
    expect(window.listenerCount('focus')).toBe(0); expect(window.webContents.listenerCount('blur')).toBe(0);
  } finally { await rm(output, { recursive: true, force: true }); }
});

it('Renderer观察启动失败也保留已有focus事实并卸载Node监听', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'canvas-input-start-')), window = new Window(), failure = new Error('renderer_start_failed');
  try {
    window.webContents.startFailure = failure;
    await expect(startCanvasPerformanceInputTrace(window, output, true)).rejects.toBe(failure);
    const evidence = evidenceSchema.parse(JSON.parse(await readFile(path.join(output, 'input-trace.json'), 'utf8')));
    expect(evidence.events[0].kind).toBe('start'); expect(evidence.rendererFailure).toBe(failure.message); expect(evidence.profiling).toBe(true);
    expect(window.listenerCount('focus')).toBe(0); expect(window.webContents.listenerCount('blur')).toBe(0);
  } finally { await rm(output, { recursive: true, force: true }); }
});
