/**
 * @file src/domains/evidence/features/ref-resolution/orchestration/resolveEvidenceFromBundles.ts
 * @description
 * 权威证据解析器（Ref Resolver）：从 conversation-root EvidenceStore bundles 中按 ref 解析全文快照。
 *
 * 领域边界：
 * - Evidence 以 conversation scope 为生命周期，不属于 KnowledgeBase 或 Deep Research。
 * - 调用方只通过 Evidence public contract 解析 ref，不理解 bundle 目录布局。
 *
 * 中文备注（设计目标）：
 * - 高内聚：把"如何从 bundles 扫描/解析 ref → evidence 快照"的细节收口到一个模块；
 * - 低耦合：不依赖任何具体 agent/feature（Deep Research 只是使用者之一）；
 * - 可调试：返回统计信息（扫描了多少 bundle、命中/缺失多少 ref），并在发现 ref 冲突时打日志。
 *
 * 重要约束（Phase 1 统一规格）：
 * - 内部 ref 统一使用裸 token（6 位字符，如 "ABC123"），不带 [@] 包装；
 * - [@XXXXXX] 只是展示层外观，数据层必须归一为裸 ref；
 * - 这是全仓 ref 口径一致性的硬约束，否则兜底扫描会"扫到了但永远不命中"。
 *
 * 约束：
 * - 不做任何 legacy/兼容迁移（你明确不需要兼容）。
 * - 不使用 any / 类型断言；严格 unknown → Record 收窄。
 */

import { Logger } from '../../../../../shared/logger';
import { normalizeCitationRef } from '../../../../citation';
import type { EvidenceBundleRepositoryPort } from '../../bundle-store/ports/evidenceBundleRepository';
import type {
  IncompleteRefIssue,
  RefConflict,
  ResolvedEvidenceItem,
  ResolveEvidenceResult,
} from '../definitions/evidenceResolution';
import { materializeResolvedEvidenceItem } from '../functions/materializeResolvedEvidenceItem';
import { parseEvidenceBundleItems } from '../functions/parseEvidenceBundleItems';
import { selectEvidenceCandidate } from '../functions/selectEvidenceCandidate';

/**
 * 权威证据解析器：从 EvidenceStore bundles 中按 ref 解析证据快照
 *
 * 中文备注（Phase 2 升级语义）：
 * - 这是全仓唯一的"ref→指针/全文"解析入口；
 * - 任何工具/阶段需要校验 ref 存在性或获取证据内容，都必须走这个函数；
 * - 通过 max_units/max_chars 控制输出体积：
 *   - 校验存在性：max_units=0, max_chars=0（只要指针）
 *   - 写作注入：按需截断
 *   - 工具组装：只要指针（不需要 text）
 */
export interface ResolveEvidenceFromBundlesParams {
  conversationId: string;
  instanceId: string;
  /** 默认只读当前 instance；跨 agent 协作必须显式选择 conversation。 */
  scope?: 'instance' | 'conversation';
  /** 待解析的 ref 列表（接受 [@X]/@X/X 任意格式，内部统一归一为裸 ref） */
  refs: string[];
  /**
   * 输出大小控制：
   * - max_units：中文按汉字/英文按词计数，和 ToolOutputReadTool 的单位模型一致
   * - max_chars：最终字符硬上限（兜底）
   * - 若 max_units=0 且 max_chars=0，则 text 为空字符串（仅校验存在性）
   */
  max_units: number;
  max_chars: number;
  /**
   * 是否在发生截断时同时返回全文（text_full）
   *
   * 中文备注：
   * - 典型用法：Writer evidence_snapshot.md 只写预览，但把全文落到 ToolOutputStore 供 tool_output_read(blob_id=...) 续读；
   * - 默认 false（更安全，避免意外把超长字符串带到上游）。
   */
  include_full_text_when_truncated?: boolean;
}

export async function resolveEvidenceFromBundlesWithRepository(
  params: ResolveEvidenceFromBundlesParams,
  repository: EvidenceBundleRepositoryPort,
): Promise<ResolveEvidenceResult> {
  const logger = new Logger('EvidenceResolver');

  // 归一化输入 refs 为裸 ref
  const normalizedRefs = Array.from(
    new Set(
      params.refs
        .map(ref => normalizeCitationRef(ref))
        .filter((ref): ref is string => typeof ref === 'string')
    )
  ).sort((a, b) => a.localeCompare(b));

  const resolved: Record<string, ResolvedEvidenceItem> = {};
  const needed = new Set<string>(normalizedRefs);
  const hitSources: Record<string, string> = {};
  const conflicts: RefConflict[] = [];
  const incompleteRefs: IncompleteRefIssue[] = [];

  const bundleFiles = await repository.listBundleSnapshots({
    conversationId: params.conversationId,
    preferredInstanceId: params.instanceId,
    scope: params.scope ?? 'instance',
  });

  if (bundleFiles.length === 0) {
    return {
      resolved,
      missing_refs: normalizedRefs,
      incomplete_refs: [],
      scanned_bundle_count: 0,
      scanned_bundle_files: [],
      hit_sources: hitSources,
      conflicts,
    };
  }

  const scannedBundleFiles: string[] = [];
  // 用于追踪冲突：ref → 已忽略的 bundle_id 列表
  const conflictIgnored = new Map<string, Array<{ bundleId: string; instanceId: string }>>();

  const requestedRefSet = new Set<string>(normalizedRefs);

  for (const location of bundleFiles) {
    if (location.storageIdentity.kind !== 'canonical_bundle') continue;
    const bundleId = location.storageIdentity.bundleId;
    scannedBundleFiles.push(location.displayName);
    if (location.status === 'unreadable') {
      logger.warn('[EvidenceResolver] bundle 文件读取/解析失败（跳过）', {
        file: location.displayName,
      });
      continue;
    }

    // ------------------------------------------------------------
    // Phase 5：同时解析“完整项”与“可观测的不完整项”
    // ------------------------------------------------------------
    const entries = parseEvidenceBundleItems(location.content);
    if (entries.length === 0) continue;

    for (const entry of entries) {
      const ref = entry.status === 'complete' ? entry.item.ref : entry.ref;
      // 仅对“被请求的 refs”输出不完整问题，避免噪声与输出膨胀
      if (!requestedRefSet.has(ref)) continue;

      if (entry.status === 'incomplete') {
        incompleteRefs.push({
          ref,
          bundle_id: bundleId,
          instance_id: location.instanceId,
          reason: entry.reason,
        });
        continue;
      }

      const evidence = entry.item;

      /**
       * 冲突判定（根因级口径修正）：
       * - “同一 ref 出现在多个 bundle”在真实工作流中是常态（重复物化/重试/自动物化），不应一概 fail-fast；
       * - 只有当同一 ref 映射到不同 (doc_id, block_id) 时，才是数据层歧义（真正冲突），必须 fail-fast；
       * - 对于“同一 ref → 同一 doc_id/block_id”的重复项：保持 determinism（按文件名排序保留第一个），其余静默忽略。
       * - Knowledge 同一 block 从搜索/预览升级为 full chunk 时，必须选用 full chunk；
       * - Web 的 ref 以 canonical URL 为身份；同 URL 从搜索摘要升级为页面正文时，必须保留 ref 并选用 web_page，
       *   否则完整正文虽已物化却永远无法通过该 ref 回放。升级是单向的，后续摘要不能覆盖页面正文。
       */
      if (
        resolved[ref] &&
        (resolved[ref].bundle_id !== bundleId || resolved[ref].instance_id !== location.instanceId)
      ) {
        const decision = selectEvidenceCandidate({ existing: resolved[ref], incoming: evidence });
        if (decision === 'keep_existing') {
          // 同指针同质量重复，或已是高质量正文：保持首次选择的确定性结果。
          continue;
        }
        if (decision === 'replace_existing') {
          needed.add(ref);
        }
        if (decision === 'conflict') {
          const ignored = conflictIgnored.get(ref) ?? [];
          ignored.push({ bundleId, instanceId: location.instanceId });
          conflictIgnored.set(ref, ignored);
          continue;
        }
      }

      // 不需要：本轮没有请求该 ref 或已解析完成
      if (!needed.has(ref)) continue;

      const item = materializeResolvedEvidenceItem({
        candidate: evidence,
        bundleId,
        instanceId: location.instanceId,
        maxUnits: params.max_units,
        maxChars: params.max_chars,
        includeFullTextWhenTruncated: params.include_full_text_when_truncated,
      });

      resolved[ref] = item;
      hitSources[ref] = bundleId;
      needed.delete(ref);
    }
  }

  // 构建冲突列表
  for (const [ref, ignoredSources] of conflictIgnored.entries()) {
    if (ignoredSources.length > 0 && resolved[ref]) {
      conflicts.push({
        ref,
        kept_bundle_id: resolved[ref].bundle_id,
        kept_instance_id: resolved[ref].instance_id,
        ignored_bundle_ids: ignoredSources.map(source => source.bundleId),
        ignored_instance_ids: ignoredSources.map(source => source.instanceId),
      });
    }
  }

  return {
    resolved,
    missing_refs: Array.from(needed).sort((a, b) => a.localeCompare(b)),
    incomplete_refs: incompleteRefs,
    scanned_bundle_count: scannedBundleFiles.length,
    scanned_bundle_files: scannedBundleFiles.sort((a, b) => a.localeCompare(b)),
    hit_sources: hitSources,
    conflicts,
  };
}
