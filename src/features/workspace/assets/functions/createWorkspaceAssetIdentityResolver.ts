import { randomUUID } from 'node:crypto';
import type { WorkspaceAssetIdentityPort } from '../definitions/workspaceAssetIdentity';

export interface WorkspaceAssetIdentityStatement {
  get(...params: readonly unknown[]): unknown;
}

export interface WorkspaceAssetIdentityDatabase {
  prepare(sql: string): WorkspaceAssetIdentityStatement;
}

function readAssetId(row: unknown): string | null {
  if (!row || typeof row !== 'object') return null;
  const id = Reflect.get(row, 'id');
  return typeof id === 'string' && id.trim().length > 0 && id === id.trim()
    ? id
    : null;
}

/**
 * 为尚未登记的内容 URI 分配进程内稳定 UUID。
 *
 * 中文说明：文件 commit 与 SQLite event 事务之间存在异步窗口；同一进程中的并发
 * 请求可能同时看到 DB 尚无该 URI。候选表保证它们仍使用同一个 UUID，后续由
 * `appendEventToRun()` 的 URI 唯一约束和短事务完成最终登记。
 */
export function createWorkspaceAssetIdentityResolver(params: {
  readonly db: WorkspaceAssetIdentityDatabase;
  readonly createAssetId?: () => string;
}): WorkspaceAssetIdentityPort {
  const selectByUri = params.db.prepare('SELECT id FROM assets WHERE uri = ?');
  const candidatesByUri = new Map<string, string>();
  const createAssetId = params.createAssetId ?? randomUUID;

  return {
    resolveCanonicalAssetId(uri: string): string {
      if (!uri || uri !== uri.trim()) {
        throw new Error('[WorkspaceAssetIdentity] asset URI 必须非空且不包含首尾空白');
      }

      const persistedId = readAssetId(selectByUri.get(uri));
      if (persistedId) {
        candidatesByUri.set(uri, persistedId);
        return persistedId;
      }

      const existingCandidate = candidatesByUri.get(uri);
      if (existingCandidate) return existingCandidate;

      const candidate = createAssetId();
      if (!candidate || candidate !== candidate.trim()) {
        throw new Error('[WorkspaceAssetIdentity] asset ID 生成器返回了非法身份');
      }
      candidatesByUri.set(uri, candidate);
      return candidate;
    },
  };
}
