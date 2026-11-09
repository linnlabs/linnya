import katex from 'katex';
import { markdownMathOptions } from '../../../definitions/markdownMathOptions';

/** 正式公式 NodeView 与预览共用排版和信任策略，不从源码生成占位壳。 */
export function renderWorkspaceLatex(source: string, displayMode: boolean): string {
  return katex.renderToString(source, { ...markdownMathOptions, displayMode, output: 'html' });
}
