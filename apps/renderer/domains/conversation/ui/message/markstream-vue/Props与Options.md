组件 Props 与选项
在集成 markstream-vue 时，常会需要微调流式行为、控制重节点渲染或避免 Tailwind/UnoCSS 样式冲突。本页提供对照表与排障提示。

MarkdownRender 核心 props
Prop	类型	默认值	说明
content	string	–	原始 Markdown 字符串（除非提供 nodes，否则必填）。
nodes	BaseNode[]	–	使用 parseMarkdownToStructure 预解析后的 AST。
custom-id	string	–	作用域键，可在 setCustomComponents 注册映射并用 [data-custom-id="docs"] 做样式覆盖。
parse-options	ParseOptions	–	Token/节点级钩子（preTransformTokens、postTransformTokens、postTransformNodes），仅在传入 content 时生效。
custom-html-tags	string[]	–	扩展流式内联 HTML 中间态白名单，并将这些标签直接输出为自定义节点（type: <tag>）以便 setCustomComponents 映射（会传给 getMarkdown，如 ['thinking']）。
typewriter	boolean	true	控制轻量进入动画。生成静态截图或 SSR 输出时可关闭。
流式与重节点开关
Flag	默认值	功能
render-code-blocks-as-pre	false	将所有 code_block 渲染为 <pre><code>，适合仅查看或排查 Monaco/Tailwind 样式问题。
code-block-stream	true	启用流式代码块更新；关闭后会保持加载态直到完整文本就绪，避免频繁初始化 Monaco。
viewport-priority	true	优先渲染视窗内的 Mermaid/Monaco 等重节点，延迟离屏渲染以提升交互体验。
代码块头部控制
可直接传给 CodeBlockNode / MarkdownCodeBlockNode，或通过插槽统一控制：

show-header
show-copy-button
show-expand-button
show-preview-button
show-font-size-buttons
更多细节请参考 /zh/guide/codeblock-header 及类型定义。

示例

<script setup lang="ts">
import MarkdownRender from 'markstream-vue'

const md = '# 标题\n\n演示 props 用法。'
</script>

<template>
  <MarkdownRender
    :content="md"
    custom-id="docs"
    :viewport-priority="true"
    :code-block-stream="true"
  />
</template>
样式与排障提示
先引入 reset（modern-css-reset、@tailwind base、@unocss/reset），再在 @layer components 中导入 markstream-vue/index.css，避免被 utilities 覆盖。详见 Tailwind 指南。
使用 custom-id 与 [data-custom-id="docs"] 限定覆盖范围。
检查同伴 CSS 是否导入（Mermaid、KaTeX、Monaco），缺失时会出现空白渲染。
查阅 样式排查清单，确保 reset、layer、Uno/Tailwind 配置正确。