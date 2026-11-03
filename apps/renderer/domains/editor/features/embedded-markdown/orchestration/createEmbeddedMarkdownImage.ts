import { MarkdownDocumentImage } from '@linnya/markdown-document-core';
import type { EmbeddedMarkdownEditorOptions } from '@linnya/plugin-host-contract/renderer/embeddedMarkdownEditor';

/** NodeView只投影临时图片地址，JSON/复制HTML继续使用schema中的稳定身份。 */
export function createEmbeddedMarkdownImage(options: EmbeddedMarkdownEditorOptions) {
  return MarkdownDocumentImage.extend({
    addNodeView() {
      return ({ node }) => {
        const image = document.createElement('img');
        let active = true, generation = 0;
        const display = (current: typeof node) => {
          const token = ++generation;
          const source = typeof current.attrs.src === 'string' ? current.attrs.src : '';
          image.alt = typeof current.attrs.alt === 'string' ? current.attrs.alt : '';
          image.title = typeof current.attrs.title === 'string' ? current.attrs.title : '';
          const pending = options.resolveImageSource ? options.resolveImageSource(source) : Promise.resolve(source);
          void pending.then(src => { if (active && token === generation) image.src = src; }).catch(error => {
            if (active && token === generation) { image.alt = '图片加载失败'; options.onError?.(error instanceof Error ? error.message : String(error)); }
          });
        };
        display(node);
        return { dom: image,
          update(current) { if (current.type !== node.type) return false; display(current); return true; },
          destroy() { active = false; generation += 1; },
        };
      };
    },
  });
}
