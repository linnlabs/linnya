import { readPendingMarkdownImage } from '@app/schemas';
import { generateEditorBlockId } from 'src/shared/utils/idUtils';
import { hydrateMarkdownDocumentImages } from '../../image-content';
import {
  attachCitationNodesToDocJson,
  importMarkdownToDocJson,
  type MarkdownDocJson,
  type ProseMirrorJsonNode,
} from '../../normalization/runtime';
import type { PendingRevision } from '../definitions/pendingRevision';
import type {
  MarkdownImporter,
  MarkdownRootBlockJson,
  PreparedPendingReplacement,
} from '../definitions/pendingRevisionApply';
import {
  buildRootBlockIndex,
  isRecord,
  isRootBlock,
  mergeRootBlockAttrs,
  parsePendingMetadata,
  resolvePendingOperation,
  restorePendingListSpacing,
} from '../functions/pendingRevisionApplyRules';
import {
  extractPendingCitationHydration,
  extractPendingCitationLinkHydration,
} from '../functions/admitPendingCitationHydration';
import { importPendingMarkdownRootBlock } from './importPendingMarkdownRootBlock';

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

/** 接受修订和用户预览共用解析、图片/引用恢复与呈现保留；只准备结构，绝不提交或清理 Pending。 */
export async function preparePendingReplacements(input: {
  readonly document: MarkdownDocJson;
  readonly pendings: readonly PendingRevision[];
  readonly hydrateReferences: (content: MarkdownDocJson, metadata: unknown) => MarkdownDocJson;
  readonly importer?: MarkdownImporter;
  readonly signal?: AbortSignal;
}): Promise<Map<string, PreparedPendingReplacement>> {
  const rootIndex = buildRootBlockIndex(input.document.content);
  const prepared = new Map<string, PreparedPendingReplacement>();
  for (const pending of input.pendings) {
    input.signal?.throwIfAborted();
    const metadata = parsePendingMetadata(pending.meta_json);
    if (resolvePendingOperation(pending, metadata) === 'delete') continue;
    const oldRoot = input.document.content[rootIndex.get(pending.target_block_id) ?? -1];
    if (!pending.new_markdown.trim()) {
      prepared.set(pending.id, {
        rootBlock: createEmptyRootBlock(pending.target_block_id, oldRoot),
      });
      continue;
    }
    const imported = await importPendingMarkdownRootBlock(
      pending.new_markdown,
      input.importer ?? importMarkdownToDocJson
    );
    input.signal?.throwIfAborted();
    if (!imported)
      throw new Error(`Pending Markdown 解析未返回正文: blockId=${pending.target_block_id}`);
    let content = input.hydrateReferences({ type: 'doc', content: [imported] }, metadata);
    const image = readPendingMarkdownImage(metadata);
    content = hydrateMarkdownDocumentImages(content, new Map(image ? [[image.id, image]] : []));
    const citations = extractPendingCitationHydration(metadata, pending.target_block_id);
    const links = extractPendingCitationLinkHydration(metadata, pending.target_block_id);
    if (citations || links)
      content = attachCitationNodesToDocJson(content, citations ?? {}, links ?? {});
    const [root] = content.content.filter(isRootBlock);
    const replacement = restorePendingListSpacing(oldRoot, root, metadata?.listSeparatorBefore);
    prepared.set(pending.id, {
      rootBlock: mergeRootBlockAttrs(oldRoot ?? root, replacement, pending.target_block_id),
    });
  }
  return prepared;
}
