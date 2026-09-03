/**
 * @file third-party-modules.d.ts
 * @description 为没有内置类型声明的第三方 markdown-it 插件补齐最小类型。
 *
 * 背景：
 * - 我们在 `stream-markdown-parser` 中直接 import 这些插件；
 * - 其中部分包不自带 `.d.ts`，在严格 TS/tsserver 下会报 TS7016；
 * - 这里用“最小但正确”的声明，保证类型检查通过，同时避免引入 any。
 */

type MarkdownItPlugin = import('markdown-it-ts').MarkdownItPlugin

declare module 'markdown-it-container' {
  const plugin: MarkdownItPlugin
  export default plugin
}

declare module 'markdown-it-footnote' {
  const plugin: MarkdownItPlugin
  export default plugin
}

declare module 'markdown-it-ins' {
  const plugin: MarkdownItPlugin
  export default plugin
}

declare module 'markdown-it-mark' {
  const plugin: MarkdownItPlugin
  export default plugin
}

declare module 'markdown-it-sub' {
  const plugin: MarkdownItPlugin
  export default plugin
}

declare module 'markdown-it-sup' {
  const plugin: MarkdownItPlugin
  export default plugin
}

declare module 'markdown-it-task-checkbox' {
  const plugin: MarkdownItPlugin
  export default plugin
}


