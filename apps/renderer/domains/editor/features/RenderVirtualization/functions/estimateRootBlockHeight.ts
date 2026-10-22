import type { Node } from 'prosemirror-model'
import type {} from '../definitions/blockHeightEstimate'

export function estimateRootBlockHeight(root: Node): number | undefined {
  const content = root.firstChild
  return content?.type.spec.estimateBlockHeight?.(content)
}
