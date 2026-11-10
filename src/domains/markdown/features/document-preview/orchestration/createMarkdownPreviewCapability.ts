import { createHash } from 'node:crypto';
import { JsonValueSchema, type WorkspaceMarkdownPreview } from '@app/schemas';
import type { PluginSqliteDatabaseLike } from '@linnya/plugin-host-contract/backend/workspaceRuntime';
import type { DocumentPreviewCapability } from '@linnya/plugin-host-contract/backend/documentPreview';
import { createMarkdownReadDatabase } from '../../../infrastructure/sqlite/markdownReadDatabaseAdapter';
import { createMarkdownFileWriteSourceKey } from '../../../shared/markdownDocumentSourceKey';
import { MarkdownDocumentVersionReader } from '../../document-storage';
import {
  collectMarkdownDocumentReferences,
  pendingDocumentReferenceBindings,
  hydratePendingDocumentReferences,
} from '../../document-references';
import { collectMarkdownImages } from '../../image-content';
import { parseMarkdownDocJson, validateMarkdownDocJson } from '../../normalization/runtime';
import {
  MarkdownPendingRevisionReader,
  preparePendingReplacements,
  applyAcceptedPendingsToDocument,
} from '../../pending-revisions';
import type { MarkdownPreviewResources } from '../definitions/markdownPreviewResources';
import { markdownPreviewSummary } from '../functions/markdownPreviewSummary';

/** 读取编辑器正式正文并复用修订准备规则；不写版本、不接受 Pending，也不创建第二个可写文档。 */
export function createMarkdownPreviewCapability(
  db: PluginSqliteDatabaseLike,
  resources: MarkdownPreviewResources
): DocumentPreviewCapability {
  function load(documentId: string) {
    // Reader 可能先于编辑器/工具写入入口建立；引用 port 按本次读取取得，不能冻结尚未装配的状态。
    const readDb = createMarkdownReadDatabase(db);
    const version = new MarkdownDocumentVersionReader(readDb).getLatest(documentId);
    if (!version) throw new Error('Markdown preview source not found');
    const document = validateMarkdownDocJson(
      parseMarkdownDocJson(JSON.parse(version.content_json))
    );
    const pendings = new MarkdownPendingRevisionReader(readDb).getPendingRevisions(documentId);
    const targets = new Set([
      ...collectMarkdownDocumentReferences(document).map(reference => reference.targetDocumentId),
      ...pendingDocumentReferenceBindings(pendings).map(binding => binding.targetDocumentId),
    ]);
    const references: WorkspaceMarkdownPreview['references'] = {};
    for (const targetDocumentId of targets)
      references[targetDocumentId] = resources.readReference({
        sourceDocumentId: documentId,
        targetDocumentId,
      });
    const sourceKey = createMarkdownFileWriteSourceKey({
      content: document,
      pendings,
      versionNumber: version.version_number,
    });
    // 包含渲染合同版本和引用呈现；旧 Agent 文本缓存以及改名/越界前的标题不能命中。
    const revisionKey = `workspace-markdown-v1:${createHash('sha256')
      .update(JSON.stringify([sourceKey, references]))
      .digest('hex')}`;
    return { document, pendings, references, revisionKey, referencePort: readDb.references };
  }
  return {
    getRevision: input => {
      input.signal?.throwIfAborted();
      return load(input.documentId).revisionKey;
    },
    async render(input) {
      input.signal?.throwIfAborted();
      const snapshot = load(input.documentId);
      const prepared = await preparePendingReplacements({
        document: snapshot.document,
        pendings: snapshot.pendings,
        signal: input.signal,
        hydrateReferences: (document, metadata) =>
          hydratePendingDocumentReferences(snapshot.referencePort, document, metadata),
      });
      const document = applyAcceptedPendingsToDocument({
        docJson: snapshot.document,
        pendings: snapshot.pendings,
        prepared,
      });
      const assets: WorkspaceMarkdownPreview['assets'] = {};
      const images = new Map(
        collectMarkdownImages(document).map(image => [image.assetId ?? image.id, image])
      );
      // 顺序读取限制解码峰值；同一受管资产在同一文档中仅读取一次。
      for (const [key, image] of images) {
        input.signal?.throwIfAborted();
        const dataUri = await resources.readImage({
          documentId: input.documentId,
          image,
          signal: input.signal,
        });
        input.signal?.throwIfAborted();
        if (dataUri !== null) assets[key] = dataUri;
      }
      return {
        revisionKey: snapshot.revisionKey,
        summary: markdownPreviewSummary(document, snapshot.references),
        detail: {
          format: 'workspace-markdown',
          document: JsonValueSchema.parse(document),
          assets,
          references: snapshot.references,
        },
      };
    },
  };
}
