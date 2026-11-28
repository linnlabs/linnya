import { createHash } from 'node:crypto';
import { JsonValueSchema, type WorkspaceMarkdownPreview } from '@app/schemas';
import type { PluginSqliteDatabaseLike } from '@linnya/plugin-host-contract/backend/workspaceRuntime';
import type { DocumentPreviewCapability } from '@linnya/plugin-host-contract/backend/documentPreview';
import { createMarkdownReadDatabase } from '../../../infrastructure/sqlite/markdownReadDatabaseAdapter';
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
  /**
   * 判断版本是每次读取（包括命中缓存的读取）都要做的事，不能每次都把整篇正文解析、校验、再序列化一遍：
   * 几百 KB 的长文一次要二十毫秒，画布上每张文档卡在每次工作区变更后都会问一遍。
   * 这里按文档记住最近一次正文原文对应的指纹和它引用的文档；原文逐字相同才复用，所以与版本号是否原地改写无关。
   * 只记不可变的事实，不缓存解析出的正文对象（渲染会在其上应用 Pending）。
   */
  const sources = new Map<
    string,
    { readonly contentJson: string; readonly contentKey: string; readonly targets: readonly string[] }
  >();
  const parse = (contentJson: string) =>
    validateMarkdownDocJson(parseMarkdownDocJson(JSON.parse(contentJson)));
  function readSource(documentId: string, contentJson: string) {
    let source = sources.get(documentId);
    if (source?.contentJson !== contentJson)
      source = {
        contentJson,
        contentKey: createHash('sha256').update(contentJson).digest('hex'),
        targets: collectMarkdownDocumentReferences(parse(contentJson)).map(
          reference => reference.targetDocumentId
        ),
      };
    // 重新放到末尾，超出上限时淘汰最久没读的一篇。
    sources.delete(documentId);
    sources.set(documentId, source);
    const oldest = sources.keys().next();
    if (sources.size > 64 && !oldest.done) sources.delete(oldest.value);
    return source;
  }
  function load(documentId: string) {
    // Reader 可能先于编辑器/工具写入入口建立；引用 port 按本次读取取得，不能冻结尚未装配的状态。
    const readDb = createMarkdownReadDatabase(db);
    const version = new MarkdownDocumentVersionReader(readDb).getLatest(documentId);
    if (!version) throw new Error('Markdown preview source not found');
    const source = readSource(documentId, version.content_json);
    const pendings = new MarkdownPendingRevisionReader(readDb).getPendingRevisions(documentId);
    const targets = new Set([
      ...source.targets,
      ...pendingDocumentReferenceBindings(pendings).map(binding => binding.targetDocumentId),
    ]);
    const references: WorkspaceMarkdownPreview['references'] = {};
    for (const targetDocumentId of targets)
      references[targetDocumentId] = resources.readReference({
        sourceDocumentId: documentId,
        targetDocumentId,
      });
    // 包含渲染合同版本、正文、版本号、Pending 和引用呈现；
    // 旧 Agent 文本缓存、未接受的修订以及改名/越界前的标题都不能命中。
    const revisionKey = `workspace-markdown-v2:${createHash('sha256')
      .update(JSON.stringify([source.contentKey, version.version_number, pendings, references]))
      .digest('hex')}`;
    return {
      contentJson: version.content_json,
      pendings,
      references,
      revisionKey,
      referencePort: readDb.references,
    };
  }
  return {
    // 正文结构、图片清单和引用呈现都与请求的宽度、像素比无关。
    sizeIndependent: true,
    readImage: input =>
      resources.readImageVariant({
        documentId: input.documentId,
        source: input.source,
        maxEdgePx: input.maxEdgePx,
        signal: input.signal,
      }),
    getRevision: input => {
      input.signal?.throwIfAborted();
      return load(input.documentId).revisionKey;
    },
    async render(input) {
      input.signal?.throwIfAborted();
      const snapshot = load(input.documentId),
        source = parse(snapshot.contentJson);
      const prepared = await preparePendingReplacements({
        document: source,
        pendings: snapshot.pendings,
        signal: input.signal,
        hydrateReferences: (document, metadata) =>
          hydratePendingDocumentReferences(snapshot.referencePort, document, metadata),
      });
      const document = applyAcceptedPendingsToDocument({
        docJson: source,
        pendings: snapshot.pendings,
        prepared,
      });
      const sources = [
        ...new Map(collectMarkdownImages(document).map(image => [image.assetId ?? image.id, image])),
      ];
      // 只列清单：每张图只取尺寸，不为预览缩放任何图片。字节由呈现方按显示尺寸另取，
      // 首屏用不到的图片不再拖慢整篇预览。同一受管资产在同一文档中只读一次。
      // 第一次遇到的受管图片要整张校验，几路并行；路数与图片解码线程数相当，也限制同时读进内存的原图数。
      const sizes = new Map<string, WorkspaceMarkdownPreview['images'][string]>();
      const queue = sources.values();
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          for (const [key, image] of queue) {
            input.signal?.throwIfAborted();
            const size = await resources.readImageSize({
              documentId: input.documentId,
              image,
              signal: input.signal,
            });
            // 有尺寸就说明来源正式：受管资产，或文档媒体目录里的文件。
            if (size !== null)
              sizes.set(key, {
                source: image.assetId ? { assetId: image.assetId } : { src: image.src },
                ...size,
              });
          }
        })
      );
      // 清单按图片在正文里的顺序写出，同一版本的结果逐字节相同。
      const images: WorkspaceMarkdownPreview['images'] = {};
      for (const [key] of sources) {
        const size = sizes.get(key);
        if (size) images[key] = size;
      }
      input.signal?.throwIfAborted();
      return {
        revisionKey: snapshot.revisionKey,
        summary: markdownPreviewSummary(document, snapshot.references),
        detail: {
          format: 'workspace-markdown',
          document: JsonValueSchema.parse(document),
          images,
          references: snapshot.references,
        },
      };
    },
  };
}
