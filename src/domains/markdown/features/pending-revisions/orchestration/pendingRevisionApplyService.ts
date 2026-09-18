import { createDefaultMarkdownDocument } from '../../document-lifecycle';
import { prepareEditorRevisionCommit, remainingRevisionMetadata, finalizeResolvedRevisionBaseline, promotePendingInserts } from '../functions/prepareEditorRevisionCommit';
import type { MarkdownRevisionCommit, MarkdownRevisionSnapshot } from '@app/schemas';
import { projectMarkdownEditorPendingRevisions } from '../functions/projectMarkdownEditorPendingRevisions';
import { assertMarkdownRevisionExpectation } from '../functions/assertMarkdownRevisionExpectation';
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
  type CitationLinkHydrationData,
  type CitationNodeHydrationData,
  type MarkdownDocJson,
  type ProseMirrorJsonNode,
  validateMarkdownDocJson,
} from '../../normalization/runtime';
import { generateEditorBlockId } from 'src/shared/utils/idUtils';
import type { MarkdownDocumentService } from '../../document-storage';
import type { PendingRevision, PendingRevisionMetadata } from '../definitions/pendingRevision';
import type {
  MarkdownImporter,
  MarkdownRootBlockJson,
  PreparedPendingReplacement,
} from '../definitions/pendingRevisionApply';
import {
  applyAcceptedPendingsToDocument,
  applyRejectedPendingsToDocument,
  buildRootBlockIndex,
  isMarkdownDocJson,
  isRecord,
  isRootBlock,
  mergeRootBlockAttrs,
  parsePendingMetadata,
  resolvePendingOperation,
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

function extractCitationLinkHydration(
  metadata: PendingRevisionMetadata | null,
  blockId: string
): Record<string, CitationLinkHydrationData> | null {
  const raw = metadata?.citation_link_hydration;
  if (!isRecord(raw)) return null;

  const hydration: Record<string, CitationLinkHydrationData> = {};
  const invalidUrls: string[] = [];
  for (const [url, value] of Object.entries(raw)) {
    if (isCitationLinkHydrationData(value)) hydration[url] = value;
    else invalidUrls.push(url);
  }

  if (invalidUrls.length > 0) {
    throw new Error(
      `[PendingRevisionApplyService] citation_link_hydration 存在非法条目: blockId=${blockId}, urls=${invalidUrls.join(',')}`
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

function isCitationLinkHydrationData(value: unknown): value is CitationLinkHydrationData {
  if (!isRecord(value) || typeof value.ref !== 'string' || value.ref.trim().length === 0) {
    return false;
  }
  return isCitationHydrationData(value.data);
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

  /** Editor 保存、块决策和文档决策共用一个带版本校验的提交入口。 */
  async commitEditorRevision(request: MarkdownRevisionCommit): Promise<MarkdownRevisionSnapshot & { content: MarkdownDocJson }> {
    const initialPendings = this.markdownService.getPendingRevisions(request.documentId);
    const initialVersion = this.markdownService.getLatestVersion(request.documentId);
    if (!initialVersion) throw new Error('Document version missing');
    assertMarkdownRevisionExpectation(request, initialVersion.version_number, initialPendings);
    const { baseline, selected, decision } = prepareEditorRevisionCommit(
      request, this.readMarkdownDoc(request.documentId), initialPendings);
    const prepared = decision?.mode === 'accept'
      ? await this.prepareAcceptReplacements(baseline, selected)
      : new Map<string, PreparedPendingReplacement>();

    return this.markdownService.runInTransaction(() => {
      const version = this.markdownService.getLatestVersion(request.documentId);
      if (!version) throw new Error('Document version missing');
      const pendings = this.markdownService.getPendingRevisions(request.documentId);
      assertMarkdownRevisionExpectation(request, version.version_number, pendings);
      const merged = decision?.mode === 'accept'
        ? applyAcceptedPendingsToDocument({ docJson: baseline, pendings: selected, prepared })
        : decision?.mode === 'reject'
          ? applyRejectedPendingsToDocument({ docJson: baseline, pendings: selected })
          : finalizeResolvedRevisionBaseline(baseline, selected, decision);
      // Markdown 必须保留一个可编辑空块；最后一块被删除时生成新的正文身份。
      const applied = merged.content.length > 0 ? merged : createDefaultMarkdownDocument();
      validateMarkdownDocJson(applied);
      if (JSON.stringify(applied) !== JSON.stringify(this.readMarkdownDoc(request.documentId))) {
        this.markdownService.updateDocument(request.documentId, applied);
      }
      for (const pending of selected) {
        if (decision?.mode === 'resolve' && decision.remainingMarkdown !== null) {
          this.markdownService.setPendingRevision(request.documentId, pending.target_block_id,
            decision.remainingMarkdown, pending.source, remainingRevisionMetadata(pending, baseline, decision.remainingMarkdown));
        } else {
          this.markdownService.clearPendingRevision(request.documentId, pending.target_block_id);
        }
      }
      for (const { pending, metadata } of promotePendingInserts(applied, this.markdownService.getPendingRevisions(request.documentId))) {
        this.markdownService.setPendingRevision(request.documentId, pending.target_block_id,
          pending.new_markdown, pending.source, metadata);
      }
      const latestVersion = this.markdownService.getLatestVersion(request.documentId);
      if (!latestVersion) throw new Error('Document version missing after commit');
      return {
        content: this.readMarkdownDoc(request.documentId),
        pendingRevisions: projectMarkdownEditorPendingRevisions(this.markdownService.getPendingRevisions(request.documentId)),
        versionNumber: latestVersion.version_number,
      };
    });
  }

  private readMarkdownDoc(documentId: string): MarkdownDocJson {
    const docUnknown: unknown = this.markdownService.getDocument(documentId);
    if (!isMarkdownDocJson(docUnknown)) {
      throw new Error(`[PendingRevisionApplyService] 文档结构异常: documentId=${documentId}`);
    }
    return docUnknown;
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
        citationLinkHydration: extractCitationLinkHydration(metadata, pending.target_block_id),
      });

      prepared.set(pending.id, {
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
    citationLinkHydration?: Record<string, CitationLinkHydrationData> | null;
  }): Promise<MarkdownRootBlockJson> {
    if (!params.markdown.trim()) {
      return createEmptyRootBlock(params.preserveId, params.oldRoot);
    }

    const imported = await this.importer(params.markdown);
    let docJson = imported.docJson;
    if (!docJson) throw new Error(`Pending Markdown 解析未返回正文: blockId=${params.preserveId}`);

    if (params.citationHydration || params.citationLinkHydration) {
      docJson = attachCitationNodesToDocJson(
        docJson,
        params.citationHydration ?? {},
        params.citationLinkHydration ?? {},
      );
    }

    const blocks = docJson.content.filter((node): node is MarkdownRootBlockJson =>
      isRootBlock(node)
    );
    if (blocks.length !== 1) {
      throw new Error(`Pending 必须对应一个 rootBlock，实际为 ${blocks.length}: blockId=${params.preserveId}`);
    }

    return mergeRootBlockAttrs(params.oldRoot ?? blocks[0], blocks[0], params.preserveId);
  }
}
