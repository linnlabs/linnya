import type { Node } from '@tiptap/pm/model';

/** 首次挂载前的估高包含题注；挂载后的真实高度仍由虚拟化测量接管。 */
export function estimateImageBlockHeight(node: Node): number {
  const height: unknown = node.attrs['height'];
  const caption: unknown = node.attrs['caption'];
  return (
    (typeof height === 'number' && height > 0 ? height : 320) +
    (typeof caption === 'string' && caption.length > 0
      ? Math.ceil(caption.length / 36) * 22 + 8
      : 0)
  );
}
