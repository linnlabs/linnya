/**
 * Evidence domain 的生产装配入口。
 *
 * 具体文件系统 adapter 只在这里与领域用例绑定。内部 orchestration 仅依赖窄 port，
 * 从而不会理解路径、文件名或存储后端；对外函数签名保持不变。
 */
import { fileSystemEvidenceBundleRepository } from './features/bundle-store/adapters/fileSystemEvidenceBundleRepository';
import { fileSystemEvidenceBundleWriter } from './features/bundle-store/adapters/fileSystemEvidenceBundleWriter';
import type {
  SaveEvidenceBundleCommand,
  SavedEvidenceBundle,
} from './features/bundle-store/definitions/evidenceBundleWrite';
import { saveEvidenceBundleWithWriter } from './features/bundle-store/orchestration/saveEvidenceBundle';
import {
  listEvidenceRefsWithRepository,
  type ListEvidenceRefsParams,
  type ListEvidenceRefsResult,
} from './features/ref-resolution/orchestration/listEvidenceRefs';
import {
  resolveEvidenceFromBundlesWithRepository,
  type ResolveEvidenceFromBundlesParams,
} from './features/ref-resolution/orchestration/resolveEvidenceFromBundles';
import type { ResolveEvidenceResult } from './features/ref-resolution/definitions/evidenceResolution';

/** Evidence live writer 入口；历史 bundle 不允许通过此命令重新生产。 */
export function saveEvidenceBundle(
  command: SaveEvidenceBundleCommand,
): Promise<SavedEvidenceBundle> {
  return saveEvidenceBundleWithWriter(command, fileSystemEvidenceBundleWriter);
}

export function resolveEvidenceFromBundles(
  params: ResolveEvidenceFromBundlesParams,
): Promise<ResolveEvidenceResult> {
  return resolveEvidenceFromBundlesWithRepository(params, fileSystemEvidenceBundleRepository);
}

export function listEvidenceRefs(
  params: ListEvidenceRefsParams,
): Promise<ListEvidenceRefsResult> {
  return listEvidenceRefsWithRepository(params, fileSystemEvidenceBundleRepository);
}
