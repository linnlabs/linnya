import { NodeSelection } from 'prosemirror-state';

export function selectImageNodeAt(tr, pos) {
  const node = tr.doc.nodeAt(pos);
  if (node?.type.name !== 'imageBlock') return false;

  tr.setSelection(NodeSelection.create(tr.doc, pos));
  return true;
}

export function selectInsertedImageNode(tr, insertFrom) {
  const imagePos = tr.mapping.map(insertFrom, -1);
  return selectImageNodeAt(tr, imagePos);
}
