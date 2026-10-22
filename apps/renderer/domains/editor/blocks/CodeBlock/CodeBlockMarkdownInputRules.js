import { Extension } from '@tiptap/core';
import { isMarkdownChartFenceLanguage } from '@app/schemas';
import { normalizeCodeBlockLanguage } from './functions/codeBlockLanguage';

/**
 * 输入 ``` / ```language 后换行或空格：转换为代码块。
 * 图表专属语言不产生代码块——它开始一张示例图表（与 Slash 菜单同一入口），避免出现“专属语言的普通代码”。
 */
function convertFence({ range, match, chain, editor }) {
  const { from, to } = range;
  const fenceLanguage = match[1] || null;
  if (isMarkdownChartFenceLanguage(fenceLanguage) && typeof editor.commands.convertToSampleChart === 'function') {
    return chain().deleteRange({ from, to }).convertToSampleChart('bar').run();
  }
  return chain()
    .deleteRange({ from, to })
    .setCodeBlock({ language: normalizeCodeBlockLanguage(fenceLanguage) })
    .run();
}

export const CodeBlockMarkdownInputRules = Extension.create({
  name: 'codeBlockMarkdownInputRules',

  addInputRules() {
    return [
      // 代码块规则 - 当输入 ``` 或 ```language 后换行
      { find: /^```(\S*)\n$/, handler: ({ range, match, chain }) => convertFence({ range, match, chain, editor: this.editor }) },
      // 备用代码块规则 - 当输入 ``` 或 ```language 后空格也匹配
      { find: /^```(\S*)\s$/, handler: ({ range, match, chain }) => convertFence({ range, match, chain, editor: this.editor }) },
    ];
  }
});
