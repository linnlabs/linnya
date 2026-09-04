// @ts-nocheck - 暂时禁用类型检查，因为 Tiptap 扩展的类型定义过于严格
// 未来可以逐步添加更精确的类型定义

/**
 * Tiptap 扩展注册中心
 * 集中管理和配置所有编辑器扩展
 */
import type { Ref } from 'vue'
import type { Extensions } from '@tiptap/core'

// --- Tiptap 核心扩展 ---
import CharacterCount from '@tiptap/extension-character-count'
import Dropcursor from '@tiptap/extension-dropcursor'
import TableRow from '@tiptap/extension-table-row'
import Text from '@tiptap/extension-text'
import StarterKit from '@tiptap/starter-kit'

// --- 特性模块导入 ---
import AiWritingExtension from '../features/AiWriting'
import {
  AnnoLayoutPlugin,
  AnnotationKeyboardExtension,
} from '../features/Annotation'
import createAutocompleteExtension from '../features/AutoComplete/Autocomplete'
import { CodeBlock, CodeBlockExtension, CodeBlockMarkdownInputRules } from '../blocks/CodeBlock'
import { ImageBlock, imageDropPlugin } from '../blocks/ImageBlock'
import { InlineLatexNode, LatexBlock } from '../blocks/LatexBlock'
import { SlashMenuExtension } from '../features/SlashMenu'
import {
  TableBlock,
  TableCellContentBlock,
  TableCellInteractionExtension,
  TableKeyboardExtension,
  TablePasteExtension,
  TableSelectionDecoratorExtension,
  TableVerticalNavigationStateExtension,
  CustomTableCell,
  CustomTableHeader
} from '../blocks/TableBlock'
import { createFindReplaceExtension } from '../features/FindReplace'
import RenderVirtualizationExtension from '../features/RenderVirtualization/RenderVirtualizationExtension'

// --- Schema ---
import CustomDocument from './schema/CustomDocument'
import { RootBlock } from './schema/RootBlock'

// --- 核心应用扩展 ---
import coreAppExtensions from '../extensions/core'

// --- 共享模块导入 ---
import { BaseBlock, HeadingBlock, HorizontalRuleBlock, ListItemBlock, QuoteBlock } from '../blocks'
import { CustomDropCursorExtension } from '../extensions/interaction/drag/DropCursorPlugin'
import { CoreShortcutExtension, DebugKeyboardExtension, KeyboardListener } from '../extensions/keyboard'
import { EnterHandlerExtension } from '../extensions/keyboard/EnterHandlerExtension'
import { CommonMarkdownInputRules, InlineMarkdownInputRules, StreamingMarkdown } from '../extensions/clipboard/markdown'
import PlaceholderPlugin from '../extensions/plugins/PlaceholderPlugin'
import { ColumnReferenceNode } from '../blocks/TableBlock/ColumnReferenceNode'
import { ClipboardListener } from '../extensions/clipboard/ClipboardListener'
import { ClipboardCopyExtension } from '../extensions/clipboard/ClipboardCopyExtension'
// 行内文字颜色 Mark，用于局部文字着色（不影响块级颜色）
import TextColorMark from '../marks/TextColor'
// 行内文字高亮 Mark，用于局部文字高亮背景（荧光笔效果）
import TextHighlightMark from '../marks/TextHighlight'
// 行内 code Mark：允许与 revisionMark 共存，避免 code+revisionMark 校验失败
import InlineCodeMark from '../marks/InlineCode'
// Workspace Markdown 正式 link mark；同时提供 setLink/toggleLink/unsetLink 命令
import LinkMark from '../marks/Link'
// AI 修订 Mark，用于标记 AI 修订的插入/删除
import { RevisionMark } from '../extensions/revision/RevisionMark'

// --- 新的浮动工具栏 ---
import { FloatingToolbarExtension } from '../features/floating-toolbar/FloatingToolbarExtension';

// --- Citation 引用系统 ---
import {
  CitationNode,
  BibliographyBlock,
  CitationFeatureExtension,
  CitationInteractionExtension,
  CitationInlineTriggerExtension,
} from '../features/citation';

// --- Lowlight 单例 ---
import { getLowlight } from './lowlight'

// --- 类型定义 ---
import type { ExtensionDependencies } from './types'
export type { ExtensionDependencies } from './types'

/**
 * 聚合所有 Tiptap 扩展
 * @param dependencies - 扩展所需的依赖
 * @returns 配置好的扩展数组
 */
export function getAllExtensions(dependencies: ExtensionDependencies): Extensions {
  const { layoutManagerInstance, findReplaceStore } = dependencies
  const lowlight = getLowlight()

  return [
    // 基础文档和文本
    CustomDocument,
    Text,
    
    // 自定义块扩展
    RootBlock,
    BaseBlock,
    HeadingBlock,
    HorizontalRuleBlock, 
    ListItemBlock,
    QuoteBlock,
    // 参考文献容器块（系统块，由 citation 功能自动维护）
    BibliographyBlock,
    CodeBlock.configure({
      lowlight,
    }),
    LatexBlock,
    InlineLatexNode,
    ImageBlock,
    TableBlock.configure({
      resizable: true,
      HTMLAttributes: {
        class: 'table-block'
      },
      cellContent: 'tableCellContentBlock',
      lastColumnResizable: true,
      firstColumnResizable: false,
      cellMinWidth: 50,
    }),
    TableRow,
    CustomTableHeader.configure({
      content: 'tableCellContentBlock+',
    }),
    CustomTableCell.configure({
      content: 'tableCellContentBlock+',
    }),
    
    // 功能插件
    PlaceholderPlugin,
    RenderVirtualizationExtension,
    Dropcursor.configure({
      color: '#4a9eff',
      width: 2,
    }),
    CustomDropCursorExtension,
    CharacterCount.configure({}),
    AnnoLayoutPlugin.configure({
      layoutManager: {
        recalculateAllPositions: (...args: any[]) => {
          if (layoutManagerInstance.value) {
            return layoutManagerInstance.value.recalculateAllPositions(...args)
          }
          return false
        }
      },
      throttleDelay: 200
    }),
    
    // 精选 StarterKit 插件
    StarterKit.configure({
      document: false,
      paragraph: false,
      heading: false,
      text: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      taskList: false,
      taskItem: false,
      codeBlock: false,
      horizontalRule: false,
      bold: true,
      // 禁用 StarterKit 内置 code mark，改用自定义 InlineCodeMark（允许与 revisionMark 共存）
      code: false,
      italic: true,
      strike: true,
      dropcursor: false,
      history: {
        depth: 100,
        newGroupDelay: 500,
      },
    }),
    
    // 交互扩展
    ClipboardListener, // 必须最先加载，确保 PasteRegistry 先初始化
    ClipboardCopyExtension, // 块级复制时输出语义化 HTML，提升外部应用（如 Notion）富文本粘贴兼容性
    TablePasteExtension, // 必须在 ClipboardListener 之后加载，以便注册到 PasteRegistry（Table 相关粘贴处理）
    imageDropPlugin, // 必须在 ClipboardListener 之后加载，以便注册到 PasteRegistry
    KeyboardListener,
    CodeBlockExtension,
    TableKeyboardExtension,
    // TableToolbarExtension, // 🔴 DEPRECATED: Replaced by the new FloatingToolbarExtension
    CoreShortcutExtension,
    EnterHandlerExtension,
    ...(import.meta.env.DEV ? [DebugKeyboardExtension] : []),
    SlashMenuExtension,
    TableCellInteractionExtension,
    
    // ✨ NEW: Generic Floating Toolbar
    FloatingToolbarExtension,
    
    // Markdown 支持
    CommonMarkdownInputRules,
    InlineMarkdownInputRules,
    CodeBlockMarkdownInputRules,
    StreamingMarkdown,

    // 行内文字颜色 Mark（在 StarterKit 之后注册，保证与内置 marks 协同工作）
    TextColorMark,
    // 行内文字高亮 Mark（荧光笔效果，与 textColor 并存）
    TextHighlightMark,
    // 行内 code Mark（自定义 excludes，允许 revisionMark 共存）
    InlineCodeMark,
    // 链接 Mark（href/title 与 Markdown 持久化合同一致）
    LinkMark,
    // AI 修订 Mark（标记 AI 修订的插入/删除）
    RevisionMark,
    // 引用原子节点（正文引用，存储快照数据；编号仅做视图派生）
    CitationNode,
    // 使用包装后的 Extension
    createAutocompleteExtension(),
    ...coreAppExtensions,
    AiWritingExtension,
    AnnotationKeyboardExtension,
    TableCellContentBlock,
    TableSelectionDecoratorExtension,
    ColumnReferenceNode,
    TableVerticalNavigationStateExtension,
    
    // 查找替换扩展 - 必须在 KeyboardListener 之后加载
    ...(findReplaceStore ? [createFindReplaceExtension(findReplaceStore)] : []),
    
    // Citation 引用功能扩展（自动维护 bibliography）
    CitationFeatureExtension,
    // Citation 交互扩展（Phase 3：渲染 Decorations + 事件监听）
    CitationInteractionExtension,
    // Citation 内联语法触发扩展（\\cite / [@ / [^）
    CitationInlineTriggerExtension,
  ]
}
