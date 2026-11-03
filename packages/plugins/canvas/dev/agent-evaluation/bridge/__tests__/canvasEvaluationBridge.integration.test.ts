import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { startCanvasEvaluationBridge } from '../startCanvasEvaluationBridge';
import { CanvasEvaluationCommandSchema, CanvasEvaluationResultSchema } from '../definitions/canvasEvaluationBridge';

it('routes only frozen-project typed operations, confirms retries once, and removes only its own HTML injection', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'canvas-evaluation-bridge-'));
  const html = path.join(directory, 'index.html'), descriptor = path.join(directory, 'connection.json');
  const original = '<html><body><main>App</main></body></html>';
  await writeFile(html, original);
  const bridge = await startCanvasEvaluationBridge({ projectId: 'project', origin: 'http://127.0.0.1:5174', indexHtmlPath: html, descriptorPath: descriptor });
  const base = `http://127.0.0.1:${bridge.connection.port}`;
  const headers = { 'Content-Type': 'application/json', 'x-canvas-evaluation-token': bridge.connection.nonce };
  const post = (route: string, value: unknown) => fetch(base + route, { method: 'POST', headers, body: JSON.stringify(value) });
  try {
    expect((await stat(descriptor)).mode & 0o777).toBe(0o600);
    expect((await fetch(base + '/next')).status).toBe(401);
    expect((await fetch(base + '/next', { headers: { ...headers, Origin: 'https://example.com' } })).status).toBe(403);
    expect((await post('/invoke', { id: randomUUID(), kind: 'mount', payload: { projectId: 'other', documentId: 'doc' } })).status).toBe(403);
    const command = CanvasEvaluationCommandSchema.parse({ id: randomUUID(), kind: 'mount', payload: { projectId: 'project', documentId: 'doc' } });
    const pending = post('/invoke', command);
    const next: unknown = await (await fetch(base + '/next', { headers })).json();
    expect(CanvasEvaluationCommandSchema.parse(next)).toEqual(command);
    const result = { id: command.id, ok: true, value: { documentId: 'doc', sequence: 0 } };
    expect((await post('/result', result)).status).toBe(200);
    expect(CanvasEvaluationResultSchema.parse(await (await pending).json())).toEqual(result);
    expect(CanvasEvaluationResultSchema.parse(await (await post('/invoke', command)).json())).toEqual(result);
    expect((await post('/invoke', { ...command, kind: 'read', payload: {} })).status).toBe(409);
    const following = { id: randomUUID(), kind: 'read', payload: {} };
    const read = post('/invoke', following);
    const delivered: unknown = await (await fetch(base + '/next', { headers })).json();
    expect(CanvasEvaluationCommandSchema.parse(delivered)).toEqual(following);
    await post('/result', { id: following.id, ok: true, value: null }); await read;
    const current = await readFile(html, 'utf8');
    await writeFile(html, current.replace('</body>', '<aside>User change</aside></body>'));
  } finally {
    await bridge.close();
    expect(await readFile(html, 'utf8')).toBe(original.replace('</body>', '<aside>User change</aside></body>'));
    await expect(stat(descriptor)).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(directory, { recursive: true, force: true });
  }
});
