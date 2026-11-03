import type { CanvasContentNode, CanvasTextDocument } from '../../../../shared';
import { CanvasWriteFailure } from '../definitions/canvasWriteFailure';

/** 正文只保留受管身份；原字节由资产owner持有，DOM来源在渲染时临时补齐。 */
export async function normalizeCanvasInlineImages(content: CanvasTextDocument, prepare: (source: string) => Promise<{ readonly assetId: string }>): Promise<CanvasTextDocument> {
  async function visit(node: CanvasContentNode): Promise<CanvasContentNode> {
    if (node.type === 'image') {
      const src = node.attrs?.src;
      if (typeof src !== 'string') throw new CanvasWriteFailure('invalid_content', '行内图片缺少有效来源。', undefined, 'text');
      const image = await prepare(src);
      return { ...node, attrs: { ...node.attrs, src: `asset:${image.assetId}`, assetId: image.assetId } };
    }
    if (!node.content) return node;
    const children: CanvasContentNode[] = [];
    for (const child of node.content) children.push(await visit(child));
    return { ...node, content: children };
  }
  const nodes: CanvasContentNode[] = [];
  for (const child of content.content) nodes.push(await visit(child));
  return { type: 'doc', content: nodes };
}
