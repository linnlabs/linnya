import type { Node } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';
import type { EmbeddedMarkdownSpaceInput } from '../definitions/embeddedMarkdownSpaceInput';
import { revertEmbeddedMarkdownSpaceInput } from '../functions/revertEmbeddedMarkdownSpaceInput';
import { appendEmbeddedMarkdownMapping } from '../functions/appendEmbeddedMarkdownMapping';

export function createEmbeddedMarkdownSpaceInput() {
  let held = false, awaiting: Node | null = null;
  const inputs: EmbeddedMarkdownSpaceInput[] = [];
  const reset = () => { held = false; awaiting = null; inputs.length = 0; };
  return {
    get held() { return held; },
    hold() { held = true; }, reset,
    capture(view: EditorView, text: string) { awaiting = held && !view.composing && text === ' ' ? view.state.doc : null; return false; },
    record(transaction: Transaction) {
      if (!transaction.docChanged) return;
      for (const input of inputs) appendEmbeddedMarkdownMapping(input.following, transaction.mapping);
      if (awaiting === transaction.before) inputs.push({ steps: [...transaction.steps], documents: [...transaction.docs], mapping: transaction.mapping, following: new Mapping() });
      awaiting = null;
    },
    revert(view: EditorView) {
      const transaction = revertEmbeddedMarkdownSpaceInput(view.state, inputs); awaiting = null; inputs.length = 0;
      if (transaction) view.dispatch(transaction);
    },
  };
}
