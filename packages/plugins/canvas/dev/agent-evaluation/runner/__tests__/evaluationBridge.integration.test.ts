import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { expect, it } from 'vitest';
import { startCanvasEvaluationBridge } from '../../bridge/startCanvasEvaluationBridge';
import { executeEvaluationBridge } from '../adapters/evaluationBridge';
it('uses the real typed HTTP bridge and preserves request evidence without persisting the nonce', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'canvas-runner-bridge-')),
    html = path.join(directory, 'index.html'),
    connectionFile = path.join(directory, 'connection.json');
  await writeFile(html, '<body></body>');
  const bridge = await startCanvasEvaluationBridge({
    projectId: 'project',
    origin: 'http://localhost:5174',
    indexHtmlPath: html,
    descriptorPath: connectionFile,
  });
  const base = `http://127.0.0.1:${bridge.connection.port}`,
    headers = {
      'content-type': 'application/json',
      'x-canvas-evaluation-token': bridge.connection.nonce,
    };
  try {
    const command = { id: randomUUID(), kind: 'read', payload: {} } as const;
    await expect(
      executeEvaluationBridge({
        connectionFile,
        projectId: 'other',
        directory,
        label: 'foreign',
        command,
      })
    ).rejects.toThrow('another');
    const pending = executeEvaluationBridge({
      connectionFile,
      projectId: 'project',
      directory,
      label: 'read',
      command,
    });
    const delivered: unknown = await (await fetch(base + '/next', { headers })).json();
    expect(delivered).toEqual(command);
    await fetch(base + '/result', {
      method: 'POST',
      headers,
      body: JSON.stringify({ id: command.id, ok: true, value: { snapshot: { sequence: 1 } } }),
    });
    expect(await pending).toEqual({ snapshot: { sequence: 1 } });
    expect(await readFile(path.join(directory, 'read.request.json'), 'utf8')).not.toContain(
      bridge.connection.nonce
    );
  } finally {
    await bridge.close();
    await rm(directory, { recursive: true, force: true });
  }
});
