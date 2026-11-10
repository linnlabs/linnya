import katex from 'katex';
import { markdownMathOptions } from '../definitions/portableMathematics';

/** 官方 NodeView 渲染公式，schema 的 renderHTML 只存属性；只读 DOM 也必须产生相同墨迹。 */
export function renderMarkdownMathematics(fragment: DocumentFragment): void {
  for (const element of Array.from(fragment.querySelectorAll('[data-type="inline-math"], [data-type="block-math"]'))) {
    const source = element.getAttribute('data-latex');
    if (source === null) throw new Error('markdown_math_source_missing');
    element.classList.add('tiptap-mathematics-render');
    element.innerHTML = katex.renderToString(source, { ...markdownMathOptions, displayMode: element.getAttribute('data-type') === 'block-math' });
  }
}
