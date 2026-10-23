import { Fragment, Slice, type Node } from '@tiptap/pm/model';
import { generateBlockId, generateRootBlockId } from '../../../../../shared/utils/idUtils';

function remap(node: Node): Node {
  if (node.type.name === 'imageBlock') {
    return node.type.create({ ...node.attrs, id: generateBlockId() }, null, node.marks);
  }
  if (node.isLeaf) return node;
  const children = Fragment.fromArray(node.content.content.map(remap));
  if (node.type.name === 'rootBlock' && node.firstChild?.type.name === 'imageBlock') {
    return node.type.create({ ...node.attrs, id: generateRootBlockId() }, children, node.marks);
  }
  return node.copy(children);
}

/** 在插入前更新副本身份，避免粘到原图之前时由全局去重反而改掉原图身份。 */
export function remapPastedImageIdentities(slice: Slice): Slice {
  return new Slice(
    Fragment.fromArray(slice.content.content.map(remap)),
    slice.openStart,
    slice.openEnd
  );
}
