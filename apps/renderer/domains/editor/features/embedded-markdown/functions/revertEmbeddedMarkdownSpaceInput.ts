import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';
import type { EmbeddedMarkdownSpaceInput } from '../definitions/embeddedMarkdownSpaceInput';

/** 撤销自己对应的输入步骤，映射穿过其后的输入；不调用全局undo或替换整份正文。 */
export function revertEmbeddedMarkdownSpaceInput(state: EditorState, inputs: readonly EmbeddedMarkdownSpaceInput[]): Transaction | null {
  const transaction = state.tr;
  for (const input of [...inputs].reverse()) {
    const invertedMaps = new Map<number, number>();
    for (let index = input.steps.length - 1; index >= 0; index -= 1) {
      const mapping = new Mapping();
      for (const map of input.mapping.maps.slice(index + 1)) mapping.appendMap(map);
      mapping.appendMapping(input.following);
      // 原步骤和已映射逆步骤互为镜像，保留替换选区中的位置恢复信息。
      const mirrors = new Map([...invertedMaps].map(([original, inverse]) => [inverse, original - index - 1]));
      transaction.mapping.maps.forEach((map, inverse) => mapping.appendMap(map, mirrors.get(inverse)));
      const inverse = input.steps[index].invert(input.documents[index]).map(mapping);
      if (!inverse) continue; // 对应输入已被后来编辑删除，不恢复用户明确替换掉的文字。
      if (transaction.maybeStep(inverse).failed) return null;
      invertedMaps.set(index, transaction.mapping.maps.length - 1);
    }
  }
  return transaction.docChanged ? transaction : null;
}
