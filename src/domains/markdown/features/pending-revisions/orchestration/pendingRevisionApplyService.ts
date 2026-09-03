/**
 * @file pendingRevisionApplyService.ts
 * @description 文档级 Pending Revision 一次性应用服务。
 *
 * 设计目标：
 * - Accept/Reject All 不再让前端逐块触发 ProseMirror transaction；
 * - 后端在 docJson 层一次性合并 pending，并在同一个 SQLite 事务里保存正文与清理 pending；
 * - 异步 Markdown 解析放在事务外，事务内只做同步校验与落库。
 */

import {
  attachCitationNodesToDocJson,
  importMarkdownToDocJson,
  type CitationNodeHydrationData,
  type MarkdownDocJson,
  type ProseMirrorJsonNode,
  validateMarkdownDocJson,
} from '../../normalization/runtime';
import { generateEditorBlockId } from 'src/shared/utils/idUtils';
import type { MarkdownDocumentService } from '../../document-storage';
import type { PendingRevision, PendingRevisionMetadata } from '../definitions/pendingRevision';
import type {
  ApplyAllPendingResult,
  ApplyMode,
  ApplyPendingError,
  ApplySinglePendingResult,
  MarkdownImporter,
  MarkdownRootBlockJson,
  PreparedPendingReplacement,
} from '../definitions/pendingRevisionApply';
import {
  applyAcceptedPendingsToDocument,
  applyRejectedPendingsToDocument,
  applySinglePendingToDocument,
  buildRootBlockIndex,
  isMarkdownDocJson,
  isRecord,
  isRootBlock,
  mergeRootBlockAttrs,
  parsePendingMetadata,
  resolvePendingOperation,
  snapshotPendings,
} from '../functions/pendingRevisionApplyRules';

function extractCitationHydration(
  metadata: PendingRevisionMetadata | null,
  blockId: string
): Record<string, CitationNodeHydrationData> | null {
  const raw = metadata?.citation_hydration;
  if (!isRecord(raw)) return null;

  const hydration: Record<string, CitationNodeHydrationData> = {};
  const invalidRefs: string[] = [];

  for (const [ref, value] of Object.entries(raw)) {
    if (isCitationHydrationData(value)) {
      hydration[ref] = value;
    } else {
      invalidRefs.push(ref);
    }
  }

  if (invalidRefs.length > 0) {
    throw new Error(
      `[PendingRevisionApplyService] citation_hydration 存在非法条目: blockId=${blockId}, refs=${invalidRefs.join(',')}`
    );
  }

  return Object.keys(hydration).length > 0 ? hydration : null;
}

function isCitationHydrationData(value: unknown): value is CitationNodeHydrationData {
  if (!isRecord(value)) return false;
  if (typeof value.title !== 'string') return false;
  if (typeof value.snippet !== 'string') return false;
  if (value.docId !== undefined && typeof value.docId !== 'string') return false;
  if (value.blockId !== undefined && typeof value.blockId !== 'string') return false;
  if (value.kbId !== undefined && typeof value.kbId !== 'string') return false;
  if (
    value.sourceType !== undefined &&
    value.sourceType !== 'knowledge_base' &&
    value.sourceType !== 'web' &&
    value.sourceType !== 'manual'
  ) {
    return false;
  }
  if (value.url !== undefined && typeof value.url !== 'string') return false;
  if (value.date !== undefined && typeof value.date !== 'string') return false;
  if (value.containerTitle !== undefined && typeof value.containerTitle !== 'string') return false;
  if (
    value.authors !== undefined &&
    (!Array.isArray(value.authors) || value.authors.some(author => typeof author !== 'string'))
  ) {
    return false;
  }
  return true;
}

function createEmptyRootBlock(
  preserveId: string,
  oldRoot?: ProseMirrorJsonNode
): MarkdownRootBlockJson {
  const oldAttrs = isRecord(oldRoot?.attrs) ? oldRoot.attrs : {};
  const oldInner = Array.isArray(oldRoot?.content) ? oldRoot.content[0] : undefined;
  const oldInnerId =
    isRecord(oldInner?.attrs) && typeof oldInner.attrs.id === 'string'
      ? oldInner.attrs.id
      : generateEditorBlockId();

  return {
    type: 'rootBlock',
    attrs: {
      ...oldAttrs,
      id: preserveId,
    },
    content: [
      {
        type: 'baseBlock',
        attrs: { id: oldInnerId },
        content: [],
      },
    ],
  };
}

export class PendingRevisionApplyService {
  constructor(
    private readonly markdownService: MarkdownDocumentService,
    private readonly importer: MarkdownImporter = importMarkdownToDocJson
  ) {}

  async applyAllPendingForDocument(params: {
    documentId: string;
    mode: ApplyMode;
  }): Promise<ApplyAllPendingResult> {
    const initialDoc = this.readMarkdownDoc(params.documentId);
    const initialVersion = this.markdownService.getLatestVersion(params.documentId);
    const initialPendings = this.markdownService.getPendingRevisions(params.documentId);

    if (initialPendings.length === 0) {
      return {
        status: 'ok',
        documentId: params.documentId,
        appliedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        docJson: initialDoc,
      };
    }

    const initialSnapshot = JSON.stringify(snapshotPendings(initialPendings));
    const initialVersionId = initialVersion?.id ?? null;

    try {
      const prepared =
        params.mode === 'accept'
          ? await this.prepareAcceptReplacements(initialDoc, initialPendings)
          : new Map<string, PreparedPendingReplacement>();

      return this.markdownService.runInTransaction(() => {
        const latestVersion = this.markdownService.getLatestVersion(params.documentId);
        const latestPendings = this.markdownService.getPendingRevisions(params.documentId);
        const latestSnapshot = JSON.stringify(snapshotPendings(latestPendings));

        if (
          (latestVersion?.id ?? null) !== initialVersionId ||
          latestSnapshot !== initialSnapshot
        ) {
          const latestDoc = this.readMarkdownDoc(params.documentId);
          return this.failedResult(params.documentId, latestDoc, [
            {
              blockId: '__document__',
              reason: 'pending 或文档内容在 Apply All 准备期间发生变化，请重新加载后再试',
            },
          ]);
        }

        const currentDoc = this.readMarkdownDoc(params.documentId);
        const applyResult =
          params.mode === 'accept'
            ? applyAcceptedPendingsToDocument({
                docJson: currentDoc,
                pendings: latestPendings,
                prepared,
              })
            : applyRejectedPendingsToDocument({
                docJson: currentDoc,
                pendings: latestPendings,
              });

        // 必须在正文版本和 pending 清理进入同一事务之前验证最终合并结果。
        // 单条 replacement 合法不代表组合后的完整文档仍满足 rootBlock/content/mark 合同。
        validateMarkdownDocJson(applyResult.docJson);
        if (applyResult.changed) {
          this.markdownService.updateDocument(params.documentId, applyResult.docJson);
        }
        this.markdownService.clearAllPendingRevisions(params.documentId);

        const docJson = applyResult.changed
          ? this.readMarkdownDoc(params.documentId)
          : applyResult.docJson;
        return {
          status: 'ok',
          documentId: params.documentId,
          appliedCount: applyResult.appliedCount,
          skippedCount: applyResult.skippedCount,
          failedCount: 0,
          docJson,
          ...(applyResult.errors.length > 0 ? { errors: applyResult.errors } : {}),
        };
      });
    } catch (error) {
      const currentDoc = this.readMarkdownDoc(params.documentId);
      const reason = error instanceof Error ? error.message : String(error);
      return this.failedResult(params.documentId, currentDoc, [
        {
          blockId: '__document__',
          reason,
        },
      ]);
    }
  }

  async applyPendingForBlock(params: {
    documentId: string;
    blockId: string;
    mode: ApplyMode;
  }): Promise<ApplySinglePendingResult> {
    const initialDoc = this.readMarkdownDoc(params.documentId);
    const initialVersion = this.markdownService.getLatestVersion(params.documentId);
    const initialPending = this.markdownService.getPendingRevisionForBlock(
      params.documentId,
      params.blockId
    );

    if (!initialPending) {
      return {
        status: 'ok',
        documentId: params.documentId,
        blockId: params.blockId,
        appliedCount: 0,
        skippedCount: 1,
        failedCount: 0,
      };
    }

    const initialSnapshot = JSON.stringify(snapshotPendings([initialPending]));
    const initialVersionId = initialVersion?.id ?? null;

    try {
      const metadata = parsePendingMetadata(initialPending.meta_json);
      const operation = resolvePendingOperation(initialPending, metadata);
      const rootIndex = buildRootBlockIndex(initialDoc.content);
      const oldRoot = initialDoc.content[rootIndex.get(initialPending.target_block_id) ?? -1];
      const prepared =
        params.mode === 'accept' && operation !== 'delete'
          ? await this.parseMarkdownToSingleRootBlock({
              markdown: initialPending.new_markdown,
              preserveId: initialPending.target_block_id,
              oldRoot,
              citationHydration: extractCitationHydration(metadata, initialPending.target_block_id),
            })
          : null;

      return this.markdownService.runInTransaction(() => {
        const latestVersion = this.markdownService.getLatestVersion(params.documentId);
        const latestPending = this.markdownService.getPendingRevisionForBlock(
          params.documentId,
          params.blockId
        );
        const latestSnapshot = JSON.stringify(
          snapshotPendings(latestPending ? [latestPending] : [])
        );

        if (
          (latestVersion?.id ?? null) !== initialVersionId ||
          latestSnapshot !== initialSnapshot
        ) {
          return this.failedSingleResult(params.documentId, params.blockId, [
            {
              blockId: params.blockId,
              reason: 'pending 或文档内容在单块 Apply 准备期间发生变化，请重新加载后再试',
            },
          ]);
        }

        const currentDoc = this.readMarkdownDoc(params.documentId);
        const applyResult = applySinglePendingToDocument({
          docJson: currentDoc,
          pending: initialPending,
          mode: params.mode,
          prepared,
        });

        validateMarkdownDocJson(applyResult.docJson);
        if (applyResult.changed) {
          this.markdownService.updateDocument(params.documentId, applyResult.docJson);
        }
        this.markdownService.clearPendingRevision(params.documentId, params.blockId);

        return {
          status: 'ok',
          documentId: params.documentId,
          blockId: params.blockId,
          appliedCount: applyResult.appliedCount,
          skippedCount: applyResult.skippedCount,
          failedCount: 0,
          ...(applyResult.errors.length > 0 ? { errors: applyResult.errors } : {}),
        };
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return this.failedSingleResult(params.documentId, params.blockId, [
        {
          blockId: params.blockId,
          reason,
        },
      ]);
    }
  }

  private readMarkdownDoc(documentId: string): MarkdownDocJson {
    const docUnknown: unknown = this.markdownService.getDocument(documentId);
    if (!isMarkdownDocJson(docUnknown)) {
      throw new Error(`[PendingRevisionApplyService] 文档结构异常: documentId=${documentId}`);
    }
    return docUnknown;
  }

  private failedResult(
    documentId: string,
    docJson: MarkdownDocJson,
    errors: ApplyPendingError[]
  ): ApplyAllPendingResult {
    return {
      status: 'failed',
      documentId,
      appliedCount: 0,
      skippedCount: 0,
      failedCount: errors.length,
      docJson,
      errors,
    };
  }

  private failedSingleResult(
    documentId: string,
    blockId: string,
    errors: ApplyPendingError[]
  ): ApplySinglePendingResult {
    return {
      status: 'failed',
      documentId,
      blockId,
      appliedCount: 0,
      skippedCount: 0,
      failedCount: errors.length,
      errors,
    };
  }

  private async prepareAcceptReplacements(
    docJson: MarkdownDocJson,
    pendings: PendingRevision[]
  ): Promise<Map<string, PreparedPendingReplacement>> {
    const rootIndex = buildRootBlockIndex(docJson.content);
    const prepared = new Map<string, PreparedPendingReplacement>();

    for (const pending of pendings) {
      const metadata = parsePendingMetadata(pending.meta_json);
      const operation = resolvePendingOperation(pending, metadata);
      if (operation === 'delete') continue;

      const oldRoot = docJson.content[rootIndex.get(pending.target_block_id) ?? -1];
      const replacement = await this.parseMarkdownToSingleRootBlock({
        markdown: pending.new_markdown,
        preserveId: pending.target_block_id,
        oldRoot,
        citationHydration: extractCitationHydration(metadata, pending.target_block_id),
      });

      prepared.set(pending.id, {
        pendingId: pending.id,
        blockId: pending.target_block_id,
        rootBlock: replacement,
      });
    }

    return prepared;
  }

  private async parseMarkdownToSingleRootBlock(params: {
    markdown: string;
    preserveId: string;
    oldRoot?: ProseMirrorJsonNode;
    citationHydration?: Record<string, CitationNodeHydrationData> | null;
  }): Promise<MarkdownRootBlockJson> {
    if (!params.markdown.trim()) {
      return createEmptyRootBlock(params.preserveId, params.oldRoot);
    }

    const imported = await this.importer(params.markdown);
    let docJson = imported.docJson;
    if (!docJson) {
      return createEmptyRootBlock(params.preserveId, params.oldRoot);
    }

    if (params.citationHydration) {
      docJson = attachCitationNodesToDocJson(docJson, params.citationHydration);
    }

    const blocks = docJson.content.filter((node): node is MarkdownRootBlockJson =>
      isRootBlock(node)
    );
    if (blocks.length === 0) {
      throw new Error(
        `[PendingRevisionApplyService] pending new_markdown 解析为 0 个 rootBlock: ${params.markdown.slice(0, 80)}`
      );
    }
    if (blocks.length > 1) {
      console.warn(
        `[PendingRevisionApplyService] pending new_markdown 解析为 ${blocks.length} 个 rootBlock，仅取第一个: blockId=${params.preserveId}`
      );
    }

    return mergeRootBlockAttrs(params.oldRoot ?? blocks[0], blocks[0], params.preserveId);
  }
}
