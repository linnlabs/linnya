import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BackendPluginCliExecutionContext } from '@plugin/backend/pluginCli';
import type { CanvasCliExecutionIdentity, CanvasCliObservation, CanvasCliObservationBuild, CliPreparationInput } from './definitions';

const commands = new Set(['read', 'show', 'find', 'neighbors', 'region', 'check', 'groups', 'receipt', 'apply', 'arrange', 'render', 'help', '--help', '-h']);

function inputIdentity(input: CliPreparationInput) {
  const command = input.argv[0] ?? 'help';
  const opsIndex = input.argv.indexOf('--ops-file');
  const rawOpsPath = opsIndex < 0 ? undefined : input.argv[opsIndex + 1];
  const opsPath = rawOpsPath === undefined ? null : path.relative(input.conversationRoot, path.resolve(input.conversationRoot, rawOpsPath));
  const managedOpsPath = opsPath !== null && opsPath !== '' && opsPath !== '..' && !opsPath.startsWith('..' + path.sep) && !path.isAbsolute(opsPath) ? opsPath : null;
  return {
    invocationId: input.invocationId,
    command: commands.has(command) ? command : null,
    locator: input.argv[1]?.startsWith('workspace:') ? input.argv[1] : null,
    // 不保存搜索词、未知参数、外部路径或ops正文，也不调用领域parser第二次。
    managedOpsPath,
    opsPathOutsideConversation: rawOpsPath !== undefined && managedOpsPath === null,
  };
}

function executionIdentity(context: BackendPluginCliExecutionContext): CanvasCliExecutionIdentity {
  return { conversationId: context.conversationId ?? null, agentRunId: context.agentRunId ?? null, projectId: context.projectId ?? null };
}

/**
 * 同步独占写避免新增队列或改runtimeEffects。I/O失败只使证据无效，不能覆盖业务return/throw。
 * 这会占用AppServer线程，所以带此外壳的时延不能冒充无观测Native性能基线。
 */
export function createCanvasCliObservation(build: CanvasCliObservationBuild): CanvasCliObservation {
  const files: { readonly name: string; readonly sha256: string; readonly bytes: number }[] = [];
  const pending = new Map<number, 'prepare' | 'awaiting-execute' | 'execute'>();
  let created = false, failed = false, sealed = false, sequence = 0, invocation = 0;
  function write(name: string, value: unknown) {
    if (!created) return;
    try {
      const bytes = JSON.stringify(value) + '\n';
      writeFileSync(path.join(build.evidenceDirectory, name), bytes, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      files.push({ name, bytes: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex') });
    } catch { failed = true; }
  }
  function event(id: number, kind: string, facts: unknown) {
    write(`${String(++sequence).padStart(6, '0')}.json`, { id, kind, observedAt: Date.now(), facts });
  }
  try { mkdirSync(build.evidenceDirectory, { mode: 0o700 }); created = true; }
  catch { failed = true; }
  write('session.json', {
    schemaVersion: 1, kind: 'canvas-cli-observation-shell', ...build,
    pid: process.pid, startedAt: Date.now(), synchronousIo: true,
    performanceQualification: 'observed-task-conservative-latency-only',
  });
  return {
    start(input) {
      const id = ++invocation;
      pending.set(id, 'prepare');
      event(id, 'prepare-start', { input: inputIdentity(input), attribution: 'unattributed-no-execution-context' });
      return id;
    },
    ready(id) { pending.set(id, 'awaiting-execute'); event(id, 'prepare-ready', {}); },
    execute(id, context) { pending.set(id, 'execute'); event(id, 'execute-start', { identity: executionIdentity(context) }); },
    result(id, stage, result) {
      event(id, `${stage}-result`, { result, attribution: stage === 'prepare' ? 'unattributed-no-execution-context' : 'execution-context-recorded' });
      pending.delete(id);
    },
    threw(id, stage) { event(id, `${stage}-threw`, { threw: true }); pending.delete(id); },
    seal(exitCode = 0) {
      if (sealed) return;
      sealed = true;
      // 缺seal、未执行plan、在途调用或任一写失败均不能声明完整，绝不猜权限门禁结果。
      write('seal.json', { schemaVersion: 1, finishedAt: Date.now(), exitCode, status: !failed && pending.size === 0 && exitCode === 0 ? 'complete' : 'partial',
        writeFailed: failed, pending: [...pending].map(([id, stage]) => ({ id, stage })), invocations: invocation, files: [...files] });
    },
  };
}
