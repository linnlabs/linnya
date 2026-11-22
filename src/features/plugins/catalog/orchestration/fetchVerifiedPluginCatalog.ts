import type { PluginCatalogChannel } from '@app/schemas';

import { PluginOperationError } from '../../install/definitions/pluginOperationError';
import {
  PluginCatalogRejectedError,
  type PluginCatalogRejectionCode,
  type TrustedPluginCatalogKeys,
  type VerifiedPluginCatalog,
} from '../definitions/pluginCatalog';
import { verifyPluginCatalog } from '../functions/verifyPluginCatalog';
import type { PluginCatalogStateStore } from '../infrastructure/pluginCatalogStateStore';

/** catalog 只是索引，远小于此上限；超限视为异常响应，不读进内存。 */
export const MAX_PLUGIN_CATALOG_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;

/** 过期、尚未生效、通道不符多为发布或时钟问题，稍后可恢复；其余是不可信内容。 */
const TRANSIENT_REJECTIONS: ReadonlySet<PluginCatalogRejectionCode> = new Set(['expired', 'not-yet-valid', 'wrong-channel']);

async function readBoundedText(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    throw new PluginOperationError('artifact-integrity', `Plugin catalog 超过大小上限: ${declared} bytes`);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new PluginOperationError('artifact-integrity', `Plugin catalog 超过大小上限: >${limit} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * 拉取 → 验签 → 前进本机高水位。任何失败都以 PluginOperationError 失败关闭，不改变已有安装与高水位。
 */
export async function fetchVerifiedPluginCatalog(input: {
  readonly catalogUrl: string;
  readonly channel: PluginCatalogChannel;
  readonly trustedKeys: TrustedPluginCatalogKeys;
  readonly stateStore: PluginCatalogStateStore;
  readonly now?: () => Date;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly allowLoopbackHttp?: boolean;
}): Promise<VerifiedPluginCatalog> {
  const fetcher = input.fetch ?? globalThis.fetch;
  const now = input.now ?? (() => new Date());
  const timeout = AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  let catalogText: string;
  try {
    const response = await fetcher(input.catalogUrl, { signal, redirect: 'error', headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new PluginOperationError('source-unavailable', `请求插件 catalog 失败: ${response.status} ${response.statusText}`);
    }
    catalogText = await readBoundedText(response, MAX_PLUGIN_CATALOG_BYTES);
  } catch (error) {
    if (error instanceof PluginOperationError) throw error;
    if (input.signal?.aborted) throw error;
    // 连接失败与超时是本机网络问题；服务端返回错误状态（上面）才是插件服务不可用。
    throw new PluginOperationError('network', `连接插件 catalog 失败: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }

  let catalog: VerifiedPluginCatalog;
  try {
    catalog = verifyPluginCatalog({
      catalogText,
      trustedKeys: input.trustedKeys,
      expectedChannel: input.channel,
      now: now(),
      highWaterMark: input.stateStore.readHighWaterMark(input.channel),
      allowLoopbackHttp: input.allowLoopbackHttp,
    });
  } catch (error) {
    if (error instanceof PluginCatalogRejectedError) {
      throw new PluginOperationError(TRANSIENT_REJECTIONS.has(error.code) ? 'source-unavailable' : 'artifact-integrity',
        error.message, { cause: error });
    }
    throw error;
  }
  input.stateStore.recordAccepted(catalog, now());
  return catalog;
}
