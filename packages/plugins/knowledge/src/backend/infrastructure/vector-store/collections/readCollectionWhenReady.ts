import { setTimeout as delay } from 'node:timers/promises';
import type { QdrantClient } from '@qdrant/js-client-rest';
import { isObjectLike } from '@linnya/foundation';
import { extractHttpStatusCode } from '../errors';

const READY_POLL_INTERVAL_MS = 25;
const READY_TIMEOUT_MS = 10_000;

/**
 * 集合正在创建、还没有可用副本：Qdrant 先登记名称（此后再创建得到 409），副本就绪前读写都返回 500。
 * 只认这一条固定报错，其他 500 照常立即失败。
 */
export function isCollectionInitializingError(error: unknown): boolean {
  if (extractHttpStatusCode(error) !== 500 || !isObjectLike(error)) return false;
  const data = error['data'];
  const status = isObjectLike(data) ? data['status'] : undefined;
  const message = isObjectLike(status) ? status['error'] : undefined;
  return typeof message === 'string' && message.includes('0 of 0 read operations failed');
}

/**
 * 读取集合信息；集合正在被并发创建时等到它就绪。读取成功即表示副本可用，随后的写入与检索也可用。
 * 超过期限仍未就绪（例如副本损坏）时抛出 Qdrant 的原错误。
 */
export async function readCollectionWhenReady(
  client: Pick<QdrantClient, 'getCollection'>,
  collectionName: string,
  timeoutMs: number = READY_TIMEOUT_MS
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await client.getCollection(collectionName);
    } catch (error) {
      if (!isCollectionInitializingError(error) || Date.now() >= deadline) throw error;
      await delay(READY_POLL_INTERVAL_MS);
    }
  }
}
