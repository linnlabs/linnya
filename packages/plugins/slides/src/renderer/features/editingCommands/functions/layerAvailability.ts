import type { RenderNode } from '../../../types/render';
import type { ManualEditableTarget } from '../../manualEditing';

/**
 * 与后端 changeManualLayer 同一规则：同一页、同一作者祖先链的对象按文稿顺序排列。
 * 只用于禁用不会产生变化的图层动作，写入仍由后端校验。
 */
export function resolveLayerAvailability(nodes: readonly RenderNode[], target: Pick<ManualEditableTarget, 'authoringRef' | 'authoringAncestorRefs'>) {
  const ancestry = JSON.stringify(target.authoringAncestorRefs.map(ref => [ref.slideKey, ref.editKey]));
  const peers: string[] = [];
  function visit(node: RenderNode): void {
    const ref = node.authoringRef;
    if (ref?.slideKey === target.authoringRef.slideKey
      && JSON.stringify((node.authoringAncestorRefs ?? []).map(parent => [parent.slideKey, parent.editKey])) === ancestry) peers.push(ref.editKey);
    if (node.kind === 'group') node.children.forEach(visit);
  }
  nodes.forEach(visit);
  const keys = [...new Set(peers)];
  const index = keys.indexOf(target.authoringRef.editKey);
  const top = index === keys.length - 1;
  const bottom = index <= 0;
  return { front: !top, forward: !top, backward: !bottom, back: !bottom };
}
