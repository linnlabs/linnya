import {
  MarkdownImageAttrsSchema,
  MarkdownImageInvalidError,
  hydrateMarkdownImage,
  readMarkdownImageReference,
  readPendingMarkdownImage,
  type MarkdownImageAttrs,
} from '@app/schemas';
import type { MarkdownDocJson, ProseMirrorJsonNode } from '../../normalization/types';

export interface MarkdownImagePendingSnapshot {
  readonly meta_json: string | null;
  readonly target_block_id: string;
}

export function collectMarkdownImages(document: ProseMirrorJsonNode): MarkdownImageAttrs[] {
  const result: MarkdownImageAttrs[] = [];
  const visit = (node: ProseMirrorJsonNode) => {
    if (node.type === 'imageBlock') result.push(MarkdownImageAttrsSchema.parse(node.attrs));
    node.content?.forEach(visit);
  };
  visit(document);
  return result;
}

/** 同一文档的基线与 Pending 来源；Pending 必须独立可恢复，不依赖基线图片仍存在。 */
export function collectMarkdownImageSources(
  document: MarkdownDocJson,
  pendings: readonly MarkdownImagePendingSnapshot[]
): ReadonlyMap<string, MarkdownImageAttrs> {
  const sources = new Map(collectMarkdownImages(document).map(image => [image.id, image]));
  for (const pending of pendings) {
    const image = readPendingMarkdownImage(
      pending.meta_json ? JSON.parse(pending.meta_json) : null
    );
    if (image) sources.set(image.id, image);
  }
  return sources;
}

export function hydrateMarkdownDocumentImages(
  document: MarkdownDocJson,
  sources: ReadonlyMap<string, MarkdownImageAttrs>
): MarkdownDocJson {
  const visit = (node: ProseMirrorJsonNode): ProseMirrorJsonNode => {
    if (node.type === 'imageBlock') {
      const input = MarkdownImageAttrsSchema.parse(node.attrs);
      const id = readMarkdownImageReference(input.src);
      return { ...node, attrs: hydrateMarkdownImage(input, id ? (sources.get(id) ?? null) : null) };
    }
    return node.content ? { ...node, content: node.content.map(visit) } : node;
  };
  return { ...document, content: document.content.map(visit) };
}

/** 临时引用可以参与编译与规划，但永远不能进入正文版本。 */
export function assertMarkdownImagesMaterialized(document: MarkdownDocJson): void {
  const ids = new Set<string>();
  for (const image of collectMarkdownImages(document)) {
    if (/^(?:linnya-image:|conversation:)/u.test(image.src)) {
      throw new MarkdownImageInvalidError('图片来源未接纳，不能保存正文。');
    }
    if (ids.has(image.id))
      throw new MarkdownImageInvalidError('一个文档中的图片出现位置 id 不能重复。');
    ids.add(image.id);
  }
}
