import { createHash } from 'node:crypto';
import fs from 'node:fs';

import { PluginOperationError, toPluginOperationError } from '../definitions/pluginOperationError';

/** 开发用 latest.json 没有声明大小，仍要有上限，避免异常响应写满磁盘。 */
export const DEFAULT_MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const PROGRESS_INTERVAL_MS = 100;

export interface VerifiedArtifactDownload {
  readonly sha512: string;
  readonly size: number;
}

function cancelledError(label: string, cause?: unknown): PluginOperationError {
  return new PluginOperationError('cancelled', `已取消下载${label}`, { cause });
}

/** 传输层失败：取消优先；磁盘写满单独归类；其余连接错误都是网络问题。 */
function classifyTransferError(error: unknown, label: string, signal: AbortSignal | undefined): PluginOperationError {
  if (signal?.aborted) return cancelledError(label, error);
  if (error instanceof PluginOperationError) return error;
  const converted = toPluginOperationError(error);
  if (converted.code === 'disk-space') return converted;
  const detail = error instanceof Error ? error.message : String(error);
  return new PluginOperationError('network', `下载${label}时网络连接失败: ${detail}`, { cause: error });
}

function parseContentLength(value: string | null): number | null {
  if (value === null || !/^\d+$/u.test(value.trim())) return null;
  return Number(value.trim());
}

/**
 * 流式下载并边下边算 sha512，写入 destinationPath。声明了 expectedSize 时字节数必须完全一致，
 * 超出立即中止；最终摘要不符则删除文件并报 artifact-integrity。任何失败都不会留下部分文件。
 */
export async function downloadVerifiedArtifact(input: {
  readonly fetch: typeof fetch;
  readonly url: string;
  readonly destinationPath: string;
  /** 用于错误信息，例如“插件包”“运行时组件”。 */
  readonly label: string;
  readonly expectedSha512: string;
  readonly expectedSize?: number;
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (receivedBytes: number) => void;
  readonly now?: () => number;
}): Promise<VerifiedArtifactDownload> {
  const { label, signal } = input;
  const now = input.now ?? Date.now;
  const limit = input.expectedSize ?? input.maxBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
  if (signal?.aborted) throw cancelledError(label);

  let response: Response;
  try {
    response = await input.fetch(input.url, { redirect: 'error', signal });
  } catch (error) {
    throw classifyTransferError(error, label, signal);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new PluginOperationError('source-unavailable', `下载${label}失败: ${response.status} ${response.statusText}`);
  }
  const declared = parseContentLength(response.headers.get('content-length'));
  if (declared !== null && (declared > limit || (input.expectedSize !== undefined && declared !== input.expectedSize))) {
    await response.body?.cancel().catch(() => undefined);
    throw new PluginOperationError(
      'artifact-integrity',
      `${label}大小与预期不一致: expected=${input.expectedSize ?? `<=${limit}`} declared=${declared}`,
    );
  }
  if (!response.body) {
    throw new PluginOperationError('source-unavailable', `下载${label}失败: 响应没有内容`);
  }

  const hash = createHash('sha512');
  const reader = response.body.getReader();
  let received = 0;
  let lastReportAt = Number.NEGATIVE_INFINITY;
  let completed = false;
  const file = await fs.promises.open(input.destinationPath, 'w').catch((error: unknown) => {
    void reader.cancel().catch(() => undefined);
    throw toPluginOperationError(error);
  });
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        throw classifyTransferError(error, label, signal);
      }
      if (chunk.done) break;
      // 有些实现在 abort 后仍会交付已缓冲的数据块，这里主动检查。
      if (signal?.aborted) throw cancelledError(label);
      received += chunk.value.byteLength;
      if (received > limit) {
        throw new PluginOperationError(
          'artifact-integrity',
          `${label}超过预期大小: expected=${input.expectedSize ?? `<=${limit}`} received>${limit}`,
        );
      }
      hash.update(chunk.value);
      try {
        await file.write(chunk.value);
      } catch (error) {
        throw classifyTransferError(error, label, signal);
      }
      const at = now();
      if (input.onProgress && at - lastReportAt >= PROGRESS_INTERVAL_MS) {
        lastReportAt = at;
        input.onProgress(received);
      }
    }
    // 连接中途断开时 fetch 会在 read() 抛错（上面归为 network）；能正常读完却与声明不符，说明服务端文件本身不对。
    if (declared !== null && received !== declared) {
      throw new PluginOperationError('network', `下载${label}不完整: declared=${declared} received=${received}`);
    }
    if (input.expectedSize !== undefined && received !== input.expectedSize) {
      throw new PluginOperationError('artifact-integrity', `${label}大小与预期不一致: expected=${input.expectedSize} received=${received}`);
    }
    const sha512 = hash.digest('hex');
    if (sha512 !== input.expectedSha512.toLowerCase()) {
      throw new PluginOperationError('artifact-integrity', `${label} sha512 不匹配: expected=${input.expectedSha512} actual=${sha512}`);
    }
    input.onProgress?.(received);
    completed = true;
    return { sha512, size: received };
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    await file.close().catch(() => undefined);
    if (!completed) await fs.promises.rm(input.destinationPath, { force: true }).catch(() => undefined);
  }
}
