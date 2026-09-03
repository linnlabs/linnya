import { Extension } from '@tiptap/core';

export const CodeBlockMarkdownInputRules = Extension.create({
  name: 'codeBlockMarkdownInputRules',

  addInputRules() {
    return [
      // 代码块规则 - 当输入 ``` 或 ```language 后换行
      {
        find: /^```(\S*)\n$/,
        handler: ({ state, range, match, chain }) => {
          const { from, to } = range;
          const language = match[1] || null;
          return chain()
            .deleteRange({ from, to })
            .setCodeBlock({ language })
            .run();
        }
      },
      
      // 备用代码块规则 - 当输入 ``` 或 ```language 后空格也匹配
      {
        find: /^```(\S*)\s$/,
        handler: ({ state, range, match, chain }) => {
          const { from, to } = range;
          const language = match[1] || null;
          return chain()
            .deleteRange({ from, to })
            .setCodeBlock({ language })
            .run();
        }
      }
    ];
  }
}); 