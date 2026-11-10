import { contentTracing } from 'electron';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { startCanvasZoomTrace } from '../performanceZoomTrace';
import { startCanvasPhaseTrace } from '../canvasPhaseTrace';

vi.mock('electron', () => ({ contentTracing: { getCategories: vi.fn(), startRecording: vi.fn(), stopRecording: vi.fn(), getTraceBufferUsage: vi.fn() } }));

it.each(['start', 'finish'])('Renderer在%s拒绝时仍结束录制并保留原始trace和失败事实', async phase => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'canvas-zoom-trace-'));
  const failure = new Error(`renderer_${phase}_failed`);
  vi.mocked(contentTracing.getCategories).mockResolvedValue([]);
  vi.mocked(contentTracing.startRecording).mockResolvedValue(undefined);
  vi.mocked(contentTracing.stopRecording).mockImplementation(async file => {
    if (!file) throw new Error('missing_test_trace_path');
    await writeFile(file, 'raw-captured-trace'); return file;
  });
  const window = { webContents: { executeJavaScript: async (code: string): Promise<unknown> => {
    if (code.includes(phase === 'start' ? 'startCanvas' : 'finishCanvas')) throw failure;
    return null;
  } } };
  try {
    const execution = async () => { const stop = await startCanvasZoomTrace(window, output, 'image-2500-uniform'); await stop(); };
    await expect(execution()).rejects.toThrow(failure);
    expect(contentTracing.stopRecording).toHaveBeenCalledOnce();
    expect(await readFile(path.join(output, 'image-2500-uniform-zoom.trace.json'), 'utf8')).toBe('raw-captured-trace');
    const facts = z.object({ failure: z.object({ stage: z.string(), message: z.string() }) })
      .parse(JSON.parse(await readFile(path.join(output, 'image-2500-uniform-zoom-timeline.json'), 'utf8')));
    expect(facts.failure).toEqual({ stage: phase === 'start' ? 'renderer_start' : 'renderer_finish_or_buffer', message: failure.message });
  } finally { vi.resetAllMocks(); await rm(output, { recursive: true, force: true }); }
});

it('固定body阶段的超时事实与原始trace独立保存，不覆盖其它阶段原件', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'canvas-body-trace-'));
  const order: string[] = [];
  vi.mocked(contentTracing.getCategories).mockResolvedValue([]);
  vi.mocked(contentTracing.startRecording).mockImplementation(async () => { order.push('record'); });
  vi.mocked(contentTracing.getTraceBufferUsage).mockResolvedValue({ percentage: 0.1, value: 23 });
  vi.mocked(contentTracing.stopRecording).mockImplementation(async file => {
    if (!file) throw new Error('missing_test_trace_path');
    order.push('stop'); await writeFile(file, 'raw-body-trace'); return file;
  });
  try {
    const previous = path.join(output, 'text-12000-cluster-zoom.trace.json'); await writeFile(previous, 'previous-zoom');
    const stop = await startCanvasPhaseTrace({ output, stem: 'text-12000-cluster', phase: 'body',
      start: async () => { order.push('start'); return null; },
      finish: async () => { order.push('finish'); return { phaseReturned: true, bodySettled: { settled: false, ms: 6083 } }; } });
    order.push('original-body-actions'); await stop();
    expect(order).toEqual(['record', 'start', 'original-body-actions', 'finish', 'stop']);
    const facts = z.object({ timeline: z.object({ phaseReturned: z.boolean(), bodySettled: z.object({ settled: z.boolean(), ms: z.number() }) }) })
      .parse(JSON.parse(await readFile(path.join(output, 'text-12000-cluster-body-timeline.json'), 'utf8')));
    expect(facts.timeline).toEqual({ phaseReturned: true, bodySettled: { settled: false, ms: 6083 } });
    expect(await readFile(path.join(output, 'text-12000-cluster-body.trace.json'), 'utf8')).toBe('raw-body-trace');
    expect(await readFile(previous, 'utf8')).toBe('previous-zoom');
  } finally { vi.resetAllMocks(); await rm(output, { recursive: true, force: true }); }
});
