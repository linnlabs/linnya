import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  CONVERSATION_CONTROL_CONNECTION_FILE_ENV,
  CONVERSATION_CONTROL_TOKEN_HEADER,
  ConversationControlCommandRequestSchema,
  ConversationControlConnectionDescriptorSchema,
  type ConversationControlCommandRequest,
} from '@app/schemas';

const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
const bundleMode = process.env.LINNYA_CLI_TEST_ENTRY === 'bundle';
const cliEntry = path.join(repoRoot, bundleMode ? 'apps/linnya-cli/bin/linnya.cjs' : 'apps/linnya-cli/src/main.ts');
const servers: Server[] = [];
const temporaryRoots: string[] = [];

export async function cleanupCliBridges() {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  })));
  await Promise.all(
    temporaryRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })),
  );
}

async function readJsonRequest(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const decoded: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return decoded;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

export async function createScriptedBridge(
  execute: (request: ConversationControlCommandRequest, response: ServerResponse) => unknown,
  capabilities: readonly unknown[] = ['send', 'models', 'projects', 'list', 'messages', 'status', 'resume', 'respond', 'stop', 'result', 'audit', 'tools', 'command_approvals', 'future_additive_capability'],
): Promise<{
  readonly connectionFile: string;
  readonly receivedCommands: ConversationControlCommandRequest[];
}> {
  const sessionToken = 'd'.repeat(64);
  const receivedCommands: ConversationControlCommandRequest[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      if (request.headers[CONVERSATION_CONTROL_TOKEN_HEADER] !== sessionToken) {
        sendJson(response, 401, { error: 'unauthorized' });
        return;
      }
      if (request.url?.endsWith('/handshake')) {
        await readJsonRequest(request);
        sendJson(response, 200, {
          schema_version: 1,
          protocol_version: 7,
          app_instance_id: 'app-process-test',
          app_version: '0.0.38',
          capabilities,
          limits: {
            max_request_bytes: 1024 * 1024,
            max_message_chars: 200_000,
            max_page_size: 200,
            min_watch_interval_ms: 1,
            max_watch_timeout_ms: 10_000,
          },
        });
        return;
      }
      if (request.url?.endsWith('/commands')) {
        const command = ConversationControlCommandRequestSchema.parse(await readJsonRequest(request));
        receivedCommands.push(command);
        const result = await execute(command, response);
        if (!response.destroyed) sendJson(response, 200, result);
        return;
      }
      sendJson(response, 404, { error: 'not_found' });
    })().catch(error => {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'scripted_bridge_failure',
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Scripted bridge address unavailable');

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-cli-process-'));
  temporaryRoots.push(temporaryRoot);
  const connectionFile = path.join(temporaryRoot, 'connection.json');
  const descriptor = ConversationControlConnectionDescriptorSchema.parse({
    protocol_version: 7,
    app_instance_id: 'app-process-test',
    pid: process.pid,
    host: '127.0.0.1',
    port: address.port,
    session_token: sessionToken,
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  await fs.writeFile(connectionFile, JSON.stringify(descriptor), { mode: 0o600 });
  return { connectionFile, receivedCommands };
}

export function runCliProcess(
  args: readonly string[],
  connectionFile: string,
): Promise<{ readonly exitCode: number | null; readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...(bundleMode ? [] : ['--import', 'tsx']), cliEntry, ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        [CONVERSATION_CONTROL_CONNECTION_FILE_ENV]: connectionFile,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', exitCode => resolve({ exitCode, stdout, stderr }));
  });
}
