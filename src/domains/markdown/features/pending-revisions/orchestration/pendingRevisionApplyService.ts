import { createDefaultMarkdownDocument } from '../../document-lifecycle';
import { importPendingMarkdownRootBlock } from './importPendingMarkdownRootBlock';
import { preparePendingReplacements } from './preparePendingReplacements';
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
  importMarkdownToDocJson,
  type MarkdownDocJson,
  validateMarkdownDocJson,
} from '../../normalization/runtime';
import type { MarkdownDocumentService } from '../../document-storage';
import type { PendingRevisionMetadata } from '../definitions/pendingRevision';
import type {
  MarkdownImporter,
  PreparedPendingReplacement,
} from '../definitions/pendingRevisionApply';
import {
  applyAcceptedPendingsToDocument,
  applyRejectedPendingsToDocument,
  isMarkdownDocJson,
} from '../functions/pendingRevisionApplyRules';

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
      ? await preparePendingReplacements({
        document: baseline, pendings: selected, importer: this.importer,
        hydrateReferences: (content, metadata) => this.markdownService.hydratePendingDocumentReferences(content, metadata),
      })
      : new Map<string, PreparedPendingReplacement>();

    const remaining = new Map<string, { readonly markdown: string; readonly metadata: PendingRevisionMetadata }>();
    if (decision?.mode === 'resolve' && decision.remainingMarkdown !== null) {
      const imported = await importPendingMarkdownRootBlock(decision.remainingMarkdown, this.importer);
      for (const pending of selected) remaining.set(pending.id, this.markdownService.prepareRemainingReferenceRevision(request.documentId, baseline, pending, { type: 'doc', content: imported ? [imported] : [] }, decision.remainingMarkdown));
    }

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
          const preparedRemaining = remaining.get(pending.id);
          if (!preparedRemaining) throw new Error('Remaining revision was not prepared.');
          this.markdownService.setPendingRevision(request.documentId, pending.target_block_id,
            preparedRemaining.markdown, pending.source, { ...preparedRemaining.metadata, operation: remainingRevisionMetadata(pending, baseline, preparedRemaining.markdown).operation });
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
}
