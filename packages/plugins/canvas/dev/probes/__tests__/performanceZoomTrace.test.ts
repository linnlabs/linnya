import { contentTracing } from 'electron';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import { startCanvasZoomTrace } from '../performanceZoomTrace';

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
