import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { getDocumentsPath } from 'src/shared/utils/pathManager';
import { sanitizePathSegment } from 'src/shared/utils/pathSanitizer';
import type { LLMAuditContext, RunAuditPaths, RunAuditState } from '../definitions/llmRunAudit';
import { formatBeijingTimePrefixForPath, formatLocalTimePrefixForPath } from '../functions/auditTime';

export async function resolveRunAuditPaths(
  runAudit: RunAuditState,
  context: LLMAuditContext,
): Promise<RunAuditPaths> {
  if (!runAudit.checkpoint.pathsPromise) {
    runAudit.checkpoint.pathsPromise = createRunAuditPaths(runAudit, context);
  }
  return await runAudit.checkpoint.pathsPromise;
}

export async function writeJsonAtomically(filePath: string, serialized: string): Promise<void> {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let handle: Awaited<ReturnType<typeof fsp.open>> | undefined;
  try {
    handle = await fsp.open(tempPath, 'wx');
    await handle.writeFile(serialized, { encoding: 'utf8' });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fsp.rename(tempPath, filePath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fsp.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function removeRunAuditCheckpoint(paths: RunAuditPaths): Promise<void> {
  await fsp.rm(paths.checkpointPath, { force: true });
}

async function createRunAuditPaths(
  runAudit: RunAuditState,
  context: LLMAuditContext,
): Promise<RunAuditPaths> {
  const conversationIdSafe = sanitizePathSegment(context.conversationId);
  const runIdSafe = sanitizePathSegment(context.runId);
  const auditRootDir = path.join(getDocumentsPath(), 'LLMRunAudit');
  await fsp.mkdir(auditRootDir, { recursive: true });
  const baseDir = await resolveConversationAuditDir({ auditRootDir, conversationIdSafe });
  await fsp.mkdir(baseDir, { recursive: true });

  const filePrefix = `${formatLocalTimePrefixForPath(new Date(runAudit.startedAtIso))}__${runIdSafe}`;
  return {
    baseDir,
    beforePath: path.join(baseDir, `${filePrefix}.before_context_manager.json`),
    afterPath: path.join(baseDir, `${filePrefix}.after_context_manager.json`),
    toolProtocolErrorsPath: path.join(baseDir, `${filePrefix}.tool_protocol_errors.json`),
    checkpointPath: path.join(baseDir, `${filePrefix}.in_progress.json`),
  };
}

/** 同一会话的多轮 run 复用一个目录；已有旧命名目录时保持原路径。 */
async function resolveConversationAuditDir(params: {
  auditRootDir: string;
  conversationIdSafe: string;
}): Promise<string> {
  const suffix = `__${params.conversationIdSafe}`;
  try {
    const entries = await fsp.readdir(params.auditRootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith(suffix)) {
        return path.join(params.auditRootDir, entry.name);
      }
    }
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name === params.conversationIdSafe) {
        return path.join(params.auditRootDir, entry.name);
      }
    }
  } catch {
    // 审计根目录首次使用时尚不存在，由调用方统一创建。
  }

  const prefix = formatBeijingTimePrefixForPath(new Date());
  return path.join(params.auditRootDir, `${prefix}__${params.conversationIdSafe}`);
}
