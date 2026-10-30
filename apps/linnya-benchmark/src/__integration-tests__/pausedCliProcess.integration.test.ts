import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  CONVERSATION_CONTROL_CONNECTION_FILE_ENV,
  CONVERSATION_CONTROL_TOKEN_HEADER,
  ConversationControlCommandRequestSchema,
  ConversationControlConnectionDescriptorSchema,
} from '@app/schemas';
import { describe, expect, it } from 'vitest';
import { createFileBenchmarkReportWriter } from '../adapters/fileBenchmarkReportWriter';
import { createLinnyaCliProcessAdapter } from '../adapters/linnyaCliProcessAdapter';
import { slidesConsultingReferenceCase } from '../cases/slidesConsultingReference';
import { runBenchmarkCli } from '../orchestration/runBenchmarkCli';
import { createBenchmarkRegistry } from '../registry/createBenchmarkRegistry';

describe('Benchmark -> real Linnya CLI -> scripted bridge', () => {
  it.each(['pause', 'command_approval'] as const)('真实 watch 在 %s 可操作等待时退出，保留报告且没有观察风暴', async waiting => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'linnya-benchmark-pause-'));
    const commands: string[] = [];
    const token = 'e'.repeat(64);
    const server = createServer((request, response) => {
      void (async () => {
        if (request.headers[CONVERSATION_CONTROL_TOKEN_HEADER] !== token) {
          response.writeHead(401).end();
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        let result: unknown;
        if (request.url?.endsWith('/handshake')) {
          result = {
            schema_version: 1, protocol_version: 7,
            app_instance_id: 'app-benchmark-pause', app_version: '0.0.38',
            capabilities: ['send', 'status', 'messages'],
            limits: { max_request_bytes: 1_048_576, max_message_chars: 200_000,
              max_page_size: 200, min_watch_interval_ms: 1, max_watch_timeout_ms: 60_000 },
          };
        } else {
          const command = ConversationControlCommandRequestSchema.parse(body);
          commands.push(command.command);
          const base = { schema_version: 1, ok: true, command: command.command };
          switch (command.command) {
            case 'send':
              result = { ...base, receipt: { conversation_id: 'conversation-pause',
                user_message_id: 'message-1', turn_id: 'turn-1', run_id: 'run-pause',
                execution_id: 'execution-1', agent_id: 'slides_agent', accepted_at: Date.now() } };
              break;
            case 'status':
              result = { ...base, conversation_id: 'conversation-pause', run: {
                conversation_id: 'conversation-pause', run_id: 'run-pause', turn_id: 'turn-1',
                execution_id: 'execution-1', agent_id: 'slides_agent',
                status: waiting === 'pause' ? 'paused' : 'running',
                started_at: 100, updated_at: 110, result_available: false,
                command_approvals: waiting === 'pause' ? [] : [{
                  protocol_version: 1, kind: 'command_approval_pending_projection',
                  approval_request_id: 'command_approval_11111111-1111-4111-8111-111111111111',
                  command_execution_id: 'command_execution_22222222-2222-4222-8222-222222222222',
                  conversation_id: 'conversation-pause', agent_run_id: 'child-1', origin_tool_call_id: 'tool-1',
                  command: 'rm scratch.txt', cwd: '/workspace',
                  reasons: [{ type: 'fixed_risk_rule', rule_id: 'macos.delete.rm', category: 'delete' }],
                  available_choices: ['allow_once', 'deny'], requested_at_ms: 10,
                  status: commands.filter(value => value === 'status').length > 1 ? 'awaiting_reply' : 'processing',
                }],
                ...(waiting === 'pause' ? { pause: {
                  settled: commands.filter(value => value === 'status').length > 1,
                  reason: 'execution_interrupted',
                } } : {}),
              } };
              break;
            case 'messages':
              result = { ...base, conversation_id: 'conversation-pause', status: 'preparing' };
              break;
            default: throw new Error(`Unexpected command: ${command.command}`);
          }
        }
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
      })().catch(error => {
        response.writeHead(500).end(error instanceof Error ? error.message : 'scripted bridge failed');
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing bridge address');
      const connectionFile = path.join(temporaryRoot, 'connection.json');
      await writeFile(connectionFile, JSON.stringify(ConversationControlConnectionDescriptorSchema.parse({
        protocol_version: 7, app_instance_id: 'app-benchmark-pause', pid: process.pid,
        host: '127.0.0.1', port: address.port, session_token: token,
        created_at: Date.now(), updated_at: Date.now(),
      })), { mode: 0o600 });
      const output: string[] = [];
      const errors: string[] = [];
      const exitCode = await runBenchmarkCli(['run', 'paused_case', '--project', 'project-1'], {
        registry: createBenchmarkRegistry([{ ...slidesConsultingReferenceCase,
          id: 'paused_case', timeoutMs: 15_000, inputs: [], promptTemplate: 'Test paused observation' }]),
        conversationCli: createLinnyaCliProcessAdapter({
          repoRoot: path.resolve(import.meta.dirname, '../../../..'),
          environment: { ...process.env, [CONVERSATION_CONTROL_CONNECTION_FILE_ENV]: connectionFile },
        }),
        reports: createFileBenchmarkReportWriter(path.join(temporaryRoot, 'reports')),
        io: { write: value => output.push(value), writeError: value => errors.push(value) },
      });
      expect(exitCode).toBe(3);
      expect(errors).toEqual([]);
      expect(commands).toEqual(['send', 'status', 'status', 'messages']);
      const result: unknown = JSON.parse(output.join(''));
      const outcome = waiting === 'pause' ? 'requires_recovery' : 'requires_command_approval';
      expect(result).toMatchObject({ ok: false, outcome });
      if (typeof result !== 'object' || result === null || !('report_file' in result)
        || typeof result.report_file !== 'string' || !('facts_file' in result)
        || typeof result.facts_file !== 'string') throw new Error('Missing report location');
      const savedFacts: unknown = JSON.parse(await readFile(result.facts_file, 'utf8'));
      expect(savedFacts).toMatchObject({ outcome, errors: [],
        audit: { status: 'unavailable', code: 'capability_unavailable' } });
      const report = await readFile(result.report_file, 'utf8');
      if (waiting === 'pause') expect(report).toContain('本轮未自动恢复或取消');
      else {
        expect(report).toContain('未批准、恢复或取消原运行');
        expect(report).toContain('command_approval_11111111-1111-4111-8111-111111111111');
        expect(report).toContain('child-1');
        expect(report).toContain('Shell 审批（尚未启动命令）');
      }
      expect(report).not.toContain(`终态 ${outcome}`);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 25_000);
});
