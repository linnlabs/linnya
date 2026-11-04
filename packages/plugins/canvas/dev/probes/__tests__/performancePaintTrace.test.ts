import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { startCanvasPaintTrace } from '../performancePaintTraceElectron';

describe('paint diagnostic evidence lifecycle', () => {
  it('retains the actual returned event sequence without interpreting completion as success', async () => {
    const output = await mkdtemp(path.join(os.tmpdir(), 'canvas-paint-evidence-'));
    const events = { diagnostic: 'paint-lifecycle-real-calls', events: [{ kind: 'paint-timeout', atMs: 2012, timeout: { connected: true, timeoutMs: 2000 } }] };
    const calls: string[] = [];
    try {
      const stop = await startCanvasPaintTrace({ async executeJavaScript(expression) { calls.push(expression); return expression.includes('finish') ? events : undefined; } }, output, 'text-12000-cluster');
      await stop();
      expect(JSON.parse(await readFile(path.join(output, 'text-12000-cluster-paint-events.json'), 'utf8'))).toEqual(events);
      expect(calls).toEqual(['window.beginCanvasPerformancePaintTrace()', 'window.finishCanvasPerformancePaintTrace()']);
    } finally { await rm(output, { recursive: true, force: true }); }
  });

  it('preserves existing timeout facts when the observed body case fails and finally stops observation', async () => {
    const output = await mkdtemp(path.join(os.tmpdir(), 'canvas-paint-failure-'));
    const events = { events: [{ kind: 'request-paint', atMs: 10 }, { kind: 'paint-timeout', atMs: 2010 }], overflow: 0 };
    const failure = new Error('original_body_gate_failed');
    try {
      const operation = async () => {
        const stop = await startCanvasPaintTrace({ async executeJavaScript(expression) { return expression.includes('finish') ? events : undefined; } }, output, 'failed');
        try { throw failure; } finally { await stop(); }
      };
      await expect(operation()).rejects.toBe(failure);
      expect(JSON.parse(await readFile(path.join(output, 'failed-paint-events.json'), 'utf8'))).toEqual(events);
    } finally { await rm(output, { recursive: true, force: true }); }
  });
});
