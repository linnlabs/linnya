# Find & Replace Feature

一个优雅、现代的查找替换功能，为编辑器提供类似 Word 的查找替换体验。

## 架构设计

```
FindReplace/
├── store/                    # 状态管理
│   └── useFindReplaceStore.js
├── plugin/                   # ProseMirror 插件
│   └── findReplacePlugin.js
├── extension/                # TipTap 扩展
│   └── FindReplaceExtension.js
├── ui/                       # UI 组件
│   ├── FindReplacePanel.vue
│   └── styles/
│       └── findReplace.css
├── composables/              # 组合式 API
│   └── useFindReplace.js
├── keyboard/                   # 键盘处理
│   └── FindReplaceKeys.js
└── index.js                  # 导出入口
```

## 使用方法

### 重要说明

本功能遵循项目的 **KeyboardRegistry 标准**（见 `apps/renderer/docs/KEYBOARD_HANDLING_GUIDE.md`），所有快捷键通过 `KeyboardRegistry` 注册，实现了高度解耦的键盘事件处理。

### 1. 在编辑器中注册扩展

**前置条件**: 确保编辑器已经配置了 `KeyboardListener` 扩展，并且 `editor.storage.keyboardRegistry` 可用。

```javascript
import { Editor } from '@tiptap/vue-3'
import { createFindReplaceExtension, useFindReplaceStore } from '@/features/FindReplace'

// 创建 store
const findReplaceStore = useFindReplaceStore()

// 创建编辑器时添加扩展
const editor = new Editor({
  extensions: [
    // ... 其他扩展（包括 KeyboardListener）
    createFindReplaceExtension(findReplaceStore)
  ]
})
```

### 2. 在 EditorContent 中添加面板

```vue
<template>
  <div class="editor-container">
    <EditorContent :editor="editor" />
    <FindReplacePanel :editor="editor" />
  </div>
</template>

<script setup>
import { FindReplacePanel } from '@/features/FindReplace'
import '@/features/FindReplace/ui/styles/findReplace.css'
</script>
```

### 3. 使用 EditorContext 提供全局访问（推荐）

```vue
<!-- EditorContext.vue -->
<script setup>
import { provide } from 'vue'
import { useFindReplaceStore } from '@/features/FindReplace'

const findReplaceStore = useFindReplaceStore()

provide('findReplaceStore', findReplaceStore)
provide('editor', editor)
</script>
```

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl/Cmd + F` | 打开查找面板 |
| `Enter` | 下一个匹配 |
| `Shift + Enter` | 上一个匹配 |
| `Ctrl/Cmd + G` | 下一个匹配（面板打开时）|
| `Shift + Ctrl/Cmd + G` | 上一个匹配（面板打开时）|
| `Escape` | 关闭面板并清除搜索 |

## API

### Store (useFindReplaceStore)

#### 状态
- `searchTerm`: 搜索词
- `replaceTerm`: 替换词
- `matchCase`: 是否大小写匹配
- `wholeWord`: 是否全词匹配
- `useRegex`: 是否使用正则表达式
- `matches`: 匹配结果数组
- `activeMatchIndex`: 当前激活的匹配索引
- `isPanelVisible`: 面板是否可见

#### 计算属性
- `hasMatches`: 是否有匹配
- `currentMatch`: 当前匹配对象
- `matchCount`: 匹配总数
- `displayPosition`: 显示位置 (如 "3 / 12")

#### 方法
- `showPanel()`: 显示面板
- `hidePanel()`: 隐藏面板
- `togglePanel()`: 切换面板显示
- `setSearchTerm(term)`: 设置搜索词
- `setReplaceTerm(term)`: 设置替换词
- `nextMatch()`: 下一个匹配
- `prevMatch()`: 上一个匹配
- `reset()`: 重置搜索状态
- `resetAll()`: 重置所有状态

### Editor Commands

```javascript
// 搜索
editor.commands.search('搜索词', { matchCase: true, wholeWord: false })

// 导航
editor.commands.findNext()
editor.commands.findPrev()

// 替换
editor.commands.replaceCurrent('替换词')
editor.commands.replaceAll('替换词')

// 清除
editor.commands.clearSearch()
```

### Composables

```javascript
import { useFindReplace } from '@/features/FindReplace'

const { performSearch, findNext, findPrev, replaceCurrent, replaceAll } = useFindReplace(
  editor,
  store
)
```

## 样式定制

可以通过 CSS 变量自定义样式：

```css
:root {
  --color-background-elevated: #ffffff;
  --color-border: #e0e0e0;
  --color-text-primary: #1a1a1a;
  --color-text-secondary: #666666;
  --color-primary: #007aff;
  --color-primary-alpha: rgba(0, 122, 255, 0.1);
}
```

## 技术特点

1. **高内聚低耦**: 功能独立封装，通过清晰的接口与编辑器交互
2. **遵循项目标准**: 完全遵循 KeyboardRegistry 标准，键盘处理器在 `onCreate` 注册，`onDestroy` 卸载
3. **状态管理**: 使用 Pinia 统一管理查找替换状态
4. **插件化设计**: ProseMirror 插件处理底层逻辑，TipTap 扩展提供高层 API
5. **键盘处理分层**:
   - `Mod+F`: `pre` phase, priority 100（高优先级，阻止浏览器默认行为）
   - `Escape`: `normal` phase, priority 60（仅在面板打开时处理）
   - `Mod+G` / `Shift+Mod+G`: `normal` phase, priority 50
6. **性能优化**:
   - 使用 DecorationSet 高效管理高亮
   - 搜索输入去抖 (150ms)
   - 文档变化时智能更新匹配位置
7. **用户体验**:
   - 即时反馈，显示匹配数量和位置
   - 平滑过渡动画
   - 焦点管理和键盘导航
   - 自动选中搜索框文本

## 注意事项

- 正则表达式搜索时，无效的正则会被静默忽略
- 替换全部操作会创建单个事务，支持撤销
- 切换文档时建议调用 `resetAll()` 清除状态
- 匹配高亮不会与编辑器选区冲突

## 未来扩展

- [ ] 支持多文件搜索
- [ ] 搜索历史记录
- [ ] 高级正则表达式辅助 UI
- [ ] 国际化支持
- [ ] 无障碍增强（屏幕阅读器通知）

