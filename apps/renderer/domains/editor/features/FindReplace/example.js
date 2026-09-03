/**
 * Find & Replace Feature - Integration Example
 *
 * 本示例展示如何在项目中集成查找替换功能
 */

import { Editor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'

// 导入 FindReplace 功能
import {
  createFindReplaceExtension,
  useFindReplaceStore,
  FindReplacePanel
} from '@/domains/editor/features/FindReplace'

// 样式由 domains/editor/styles/index.css 统一聚合加载。

// 假设 KeyboardListener 已经配置在项目中
import { KeyboardListener } from '@/shared/extensions/keyboard/KeyboardListener'

export function setupEditor() {
  // 1. 创建 FindReplace store
  const findReplaceStore = useFindReplaceStore()

  // 2. 创建编辑器，包含 FindReplace 扩展
  const editor = new Editor({
    element: document.querySelector('#editor'),
    extensions: [
      StarterKit,
      // KeyboardListener 必须在 FindReplace 之前加载
      KeyboardListener,
      // 添加 FindReplace 扩展
      createFindReplaceExtension(findReplaceStore)
    ],
    content: '<p>Hello World!</p>'
  })

  return {
    editor,
    findReplaceStore
  }
}

/**
 * Vue 组件使用示例
 */

// EditorComponent.vue
/*
<template>
  <div class="editor-wrapper">
    <EditorContent :editor="editor" />
    <FindReplacePanel :editor="editor" />
  </div>
</template>

<script setup>
import { onBeforeUnmount } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { KeyboardListener } from '@/shared/extensions/keyboard/KeyboardListener'
import {
  createFindReplaceExtension,
  useFindReplaceStore,
  FindReplacePanel
} from '@/domains/editor/features/FindReplace'

const findReplaceStore = useFindReplaceStore()

const editor = useEditor({
  extensions: [
    StarterKit,
    KeyboardListener,
    createFindReplaceExtension(findReplaceStore)
  ],
  content: '<p>Start typing...</p>'
})

onBeforeUnmount(() => {
  editor.value?.destroy()
})
</script>

<!-- 编辑器壳层样式应进入 domains/editor/styles/，不要在 SFC 示例中新增 style 块。 -->
*/

/**
 * 编程式使用 FindReplace API
 */

export function programmaticUsage(editor, store) {
  // 打开面板
  store.showPanel()

  // 执行搜索
  editor.commands.search('hello', {
    matchCase: true,
    wholeWord: false
  })

  // 导航到下一个匹配
  editor.commands.findNext()

  // 导航到上一个匹配
  editor.commands.findPrev()

  // 替换当前匹配
  editor.commands.replaceCurrent('hi')

  // 替换所有匹配
  editor.commands.replaceAll('hi')

  // 清除搜索
  editor.commands.clearSearch()

  // 关闭面板
  store.hidePanel()
}

/**
 * 快捷键说明
 */

/*
用户可用的快捷键：

1. Cmd/Ctrl + F - 打开查找面板（会阻止浏览器默认行为）
2. Enter - 在搜索框中按 Enter 跳到下一个匹配
3. Shift + Enter - 在搜索框中按 Shift+Enter 跳到上一个匹配
4. Cmd/Ctrl + G - 跳到下一个匹配（面板打开且有匹配时）
5. Shift + Cmd/Ctrl + G - 跳到上一个匹配（面板打开且有匹配时）
6. Escape - 关闭面板并清除搜索（仅在面板打开时触发）

所有快捷键都通过 KeyboardRegistry 注册，遵循项目标准：
- Mod+F 在 'pre' phase 注册，priority 100
- Escape 在 'normal' phase 注册，priority 60
- 其他快捷键在 'normal' phase 注册，priority 50
*/
