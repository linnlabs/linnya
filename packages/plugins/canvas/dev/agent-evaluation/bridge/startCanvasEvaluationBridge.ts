import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { CanvasEvaluationCommandSchema, CanvasEvaluationResultSchema, type CanvasEvaluationCommand, type CanvasEvaluationResult } from './definitions/canvasEvaluationBridge';

interface BridgeOptions {
  readonly projectId: string; readonly origin: string; readonly indexHtmlPath: string; readonly descriptorPath: string;
}
interface Invocation {
  readonly command: CanvasEvaluationCommand; readonly payload: string;
  readonly responses: Set<ServerResponse>; dispatched: boolean; result?: CanvasEvaluationResult;
}
function respond(response: ServerResponse, value: unknown, status = 200) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let bytes = 0;
    request.on('data', (value: unknown) => {
      if (!Buffer.isBuffer(value)) { reject(new Error('Expected request bytes')); return; }
      bytes += value.byteLength;
      if (bytes > 8 * 1024 * 1024) { reject(new Error('Evaluation request exceeds 8 MiB')); request.destroy(); return; }
      chunks.push(value);
    });
    request.on('error', reject);
    request.on('end', () => { try { const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(value); } catch (error) { reject(error); } });
  });
}

/** 只服务本机验收的固定动作；无SQL、eval或生产开关，实际用户提交由Renderer窄port完成。 */
export async function startCanvasEvaluationBridge(options: BridgeOptions) {
  const allowedOrigin = new URL(options.origin).origin;
  if (!['127.0.0.1', 'localhost'].includes(new URL(allowedOrigin).hostname)) throw new Error('Evaluation origin must be local');
  const nonce = randomBytes(32).toString('hex'), marker = randomUUID();
  const jobs = new Map<string, Invocation>();
  const polls = new Map<ServerResponse, ReturnType<typeof setTimeout>>();
  let closed = false;
  function dispatch(response: ServerResponse): boolean {
    const job = [...jobs.values()].find(value => !value.dispatched && !value.result);
    if (!job) return false;
    job.dispatched = true; respond(response, job.command); return true;
  }
  function wake() {
    for (const [response, timer] of polls) {
      if (!dispatch(response)) break;
      clearTimeout(timer); polls.delete(response);
    }
  }
  function next(response: ServerResponse) {
    if (dispatch(response)) return;
    const timer = setTimeout(() => { polls.delete(response); respond(response, null); }, 5000);
    polls.set(response, timer);
    response.once('close', () => { clearTimeout(timer); polls.delete(response); });
  }
  function invoke(value: unknown, response: ServerResponse) {
    const command = CanvasEvaluationCommandSchema.parse(value);
    if (command.kind === 'mount' && command.payload.projectId !== options.projectId) { respond(response, { error: 'project_mismatch' }, 403); return; }
    const payload = JSON.stringify(command), existing = jobs.get(command.id);
    if (existing && existing.payload !== payload) { respond(response, { error: 'request_id_payload_mismatch' }, 409); return; }
    if (existing?.result) { respond(response, existing.result); return; }
    if ([...jobs.values()].filter(job => !job.result).length >= 32 && !existing) { respond(response, { error: 'evaluation_queue_full' }, 429); return; }
    const job: Invocation = existing ?? { command, payload, dispatched: false, responses: new Set() };
    job.responses.add(response); jobs.set(command.id, job);
    response.once('close', () => job.responses.delete(response));
    wake();
  }
  function complete(value: unknown, response: ServerResponse) {
    const result = CanvasEvaluationResultSchema.parse(value), job = jobs.get(result.id);
    if (!job || !job.dispatched) { respond(response, { error: 'invocation_missing' }, 404); return; }
    if (job.result && JSON.stringify(job.result) !== JSON.stringify(result)) { respond(response, { error: 'result_mismatch' }, 409); return; }
    job.result = result;
    for (const waiting of job.responses) respond(waiting, result);
    job.responses.clear(); respond(response, { accepted: true });
    // 成功回执有界保留；投递后未知结果不会被自动重排成第二次用户提交。
    for (const [id, candidate] of jobs) if (jobs.size > 256 && candidate.result) jobs.delete(id);
  }
  async function route(request: IncomingMessage, response: ServerResponse) {
    const origin = request.headers.origin;
    if (origin && origin !== allowedOrigin) { respond(response, { error: 'origin_rejected' }, 403); return; }
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-canvas-evaluation-token');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (request.headers['x-canvas-evaluation-token'] !== nonce) { respond(response, { error: 'unauthorized' }, 401); return; }
    if (closed) { respond(response, { error: 'bridge_closed' }, 503); return; }
    if (request.method === 'GET' && request.url === '/next') { next(response); return; }
    if (request.method === 'POST' && request.url === '/invoke') { invoke(await readJson(request), response); return; }
    if (request.method === 'POST' && request.url === '/result') { complete(await readJson(request), response); return; }
    respond(response, { error: 'route_missing' }, 404);
  }
  const server = createServer((request, response) => { void route(request, response).catch(error => respond(response, { error: error instanceof Error ? error.message : 'invalid_request' }, 400)); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing evaluation server address');
  const connection = { protocol: 1, host: '127.0.0.1', port: address.port, nonce, projectId: options.projectId } as const;
  const parameters = new URLSearchParams({ port: String(address.port), nonce, projectId: options.projectId });
  const script = `<script type="module" data-canvas-evaluation-bridge="${marker}" src="/packages/plugins/canvas/dev/agent-evaluation/rendererEntry.ts?${parameters}"></script>\n`;
  let injected = false, descriptorWritten = false;
  async function close() {
    if (closed) return; closed = true;
    for (const [response, timer] of polls) { clearTimeout(timer); respond(response, null); } polls.clear();
    for (const job of jobs.values()) for (const response of job.responses) respond(response, { id: job.command.id, ok: false, error: 'bridge_closed' });
    jobs.clear();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    if (injected) { const current = await readFile(options.indexHtmlPath, 'utf8'); await writeFile(options.indexHtmlPath, current.replace(script, '')); }
    if (descriptorWritten) await rm(options.descriptorPath);
  }
  try {
    const html = await readFile(options.indexHtmlPath, 'utf8');
    if (html.includes('data-canvas-evaluation-bridge=') || !html.includes('</body>')) throw new Error('HTML has an active evaluation bridge or no body');
    await mkdir(path.dirname(options.descriptorPath), { recursive: true });
    await writeFile(options.descriptorPath, JSON.stringify(connection) + '\n', { flag: 'wx', mode: 0o600 }); descriptorWritten = true;
    await writeFile(options.indexHtmlPath, html.replace('</body>', script + '</body>')); injected = true;
  } catch (error) { await close(); throw error; }
  return { connection, close };
}
