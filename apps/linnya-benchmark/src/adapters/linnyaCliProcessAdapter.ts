import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  ConversationControlAuditResponseSchema,
  ConversationControlErrorResponseSchema,
  ConversationControlMessagesResponseSchema,
  ConversationControlProgressFrameSchema,
  ConversationControlRespondResponseSchema,
  ConversationControlResultResponseSchema,
  ConversationControlSendResponseSchema,
  ConversationControlStopResponseSchema,
} from '@app/schemas';
import type { ZodType } from 'zod';
import {
  BenchmarkConversationCliError,
  type BenchmarkConversationCliPort,
} from '../definitions/conversationCliPort';

interface ProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

interface LinnyaCliProcessAdapterOptions {
  readonly repoRoot: string;
  readonly environment?: NodeJS.ProcessEnv;
}

function parseJson<T>(text: string, schema: ZodType<T>): T {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new BenchmarkConversationCliError(
      'protocol_incompatible',
      'Linnya CLI returned invalid JSON',
      false,
    );
  }
  const parsed = schema.safeParse(decoded);
  if (!parsed.success) {
    throw new BenchmarkConversationCliError(
      'protocol_incompatible',
      'Linnya CLI response does not match the conversation-control contract',
      false,
    );
  }
  return parsed.data;
}

function throwProcessFailure(result: ProcessResult): never {
  const parsed = ConversationControlErrorResponseSchema.safeParse(
    (() => {
      try {
        return JSON.parse(result.stderr.trim());
      } catch {
        return undefined;
      }
    })(),
  );
  if (parsed.success) {
    throw new BenchmarkConversationCliError(
      parsed.data.error.code,
      parsed.data.error.message,
      parsed.data.error.retryable,
      parsed.data.command,
    );
  }
  throw new BenchmarkConversationCliError(
    'transport_failure',
    `Linnya CLI exited with code ${result.exitCode ?? 'signal'}`,
    true,
  );
}

function parseProgressFrames(stdout: string) {
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => parseJson(line, ConversationControlProgressFrameSchema));
}

export function createLinnyaCliProcessAdapter(
  options: LinnyaCliProcessAdapterOptions,
): BenchmarkConversationCliPort {
  const entry = path.join(options.repoRoot, 'apps/linnya-cli/src/main.ts');

  function execute(args: readonly string[], timeoutMs?: number): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', entry, ...args], {
        cwd: options.repoRoot,
        env: options.environment ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
          }, timeoutMs);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', exitCode => {
        if (timer) clearTimeout(timer);
        resolve({ exitCode, stdout, stderr, timedOut });
      });
    });
  }

  async function executeSingle<T>(args: readonly string[], schema: ZodType<T>): Promise<T> {
    const result = await execute(args);
    if (result.exitCode !== 0) throwProcessFailure(result);
    return parseJson(result.stdout.trim(), schema);
  }

  return {
    async send(request) {
      const args = [
        'send',
        request.message,
        '--project', request.projectId,
        '--agent', request.agentId,
        '--reasoning', request.reasoningEffort,
      ];
      if (request.modelId) args.push('--model', request.modelId);
      const response = await executeSingle(args, ConversationControlSendResponseSchema);
      return response.receipt;
    },

    async watchStatus(request) {
      const runnerTimeoutMs = Math.max(1, request.timeoutMs);
      const cliTimeoutMs = runnerTimeoutMs + 5_000;
      const result = await execute([
        'status', request.conversationId,
        '--run', request.runId,
        '--watch',
        '--interval', '1000',
        '--timeout', String(cliTimeoutMs),
      ], runnerTimeoutMs);
      const frames = parseProgressFrames(result.stdout);
      if (result.timedOut) return { frames, timedOut: true };
      if (result.exitCode !== 0) throwProcessFailure(result);
      return { frames, timedOut: false };
    },

    approve(request) {
      return executeSingle([
        'respond', request.conversationId,
        '--interaction', request.interactionId,
        '--approve',
        '--project', request.projectId,
      ], ConversationControlRespondResponseSchema);
    },

    stop(request) {
      return executeSingle([
        'stop', request.conversationId,
        '--run', request.runId,
        '--reason', request.reason,
      ], ConversationControlStopResponseSchema);
    },

    result(conversationId, runId) {
      return executeSingle([
        'result', conversationId,
        '--run', runId,
      ], ConversationControlResultResponseSchema).then(response => {
        if (response.result_status === 'available') {
          if (response.message.message_type !== 'final_answer') {
            throw new BenchmarkConversationCliError(
              'protocol_incompatible',
              'Linnya CLI result did not contain a final answer',
              false,
            );
          }
          return {
            outcome: response.outcome,
            completedAt: response.completed_at,
            resultStatus: 'available' as const,
            finalAnswer: response.message.content,
          };
        }
        if (response.result_status !== 'unavailable') {
          throw new BenchmarkConversationCliError(
            'protocol_incompatible',
            'Linnya CLI result command returned an invalid status',
            false,
          );
        }
        return {
          outcome: response.outcome,
          completedAt: response.completed_at,
          resultStatus: 'unavailable' as const,
          reason: response.reason,
        };
      });
    },

    messages(conversationId) {
      return executeSingle([
        'messages', conversationId,
        '--limit', '200',
      ], ConversationControlMessagesResponseSchema);
    },

    audit(conversationId, runId) {
      return executeSingle([
        'audit', conversationId,
        '--run', runId,
      ], ConversationControlAuditResponseSchema);
    },
  };
}
