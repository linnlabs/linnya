import { nextTick } from 'vue';
import type {
  DocumentPreviewDetailContent,
  DocumentPreviewMarkdownRuntime,
} from '../definitions/documentPreviewDetail';
import { createDocumentPreviewDetailState } from '../store/documentPreviewDetailState';

/** DOM与模块加载独立于正文读取；Scope变化时不把迟到转换结果写进新预览。 */
export function createReadonlyMarkdownDetail(input: {
  readonly element: () => HTMLElement | null;
  readonly load: () => Promise<DocumentPreviewMarkdownRuntime>;
  readonly report: (error: unknown) => void;
}) {
  const state = createDocumentPreviewDetailState();
  let generation = 0,
    element: HTMLElement | null = null;
  const clear = () => {
    generation++;
    element?.replaceChildren();
    element = null;
    state.set('idle');
  };
  async function builder(
    content: DocumentPreviewDetailContent
  ): Promise<(document: Document) => Node> {
    if (content.format === 'text') return document => document.createTextNode(content.text);
    const markdown = await input.load();
    return document =>
      markdown.createMarkdownDocumentFragment(
        markdown.parseMarkdownDocument(content.text),
        document
      );
  }
  return {
    phase: state.phase,
    clear,
    async render(content: DocumentPreviewDetailContent, isCurrent: () => boolean): Promise<void> {
      clear();
      const ticket = generation;
      state.set('loading');
      try {
        const build = await builder(content);
        await nextTick();
        if (ticket !== generation) return;
        if (!isCurrent()) { state.set('idle'); return; }
        const target = input.element();
        if (!target) throw new Error('Document preview detail container is not mounted');
        target.replaceChildren(build(target.ownerDocument));
        element = target;
        state.set('ready');
      } catch (failure) {
        if (ticket === generation && isCurrent()) {
          state.set('failed');
          input.report(failure);
        }
      }
    },
  };
}
