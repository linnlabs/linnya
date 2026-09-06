
import StarterKit from '@tiptap/starter-kit'
import Text from '@tiptap/extension-text'
import CustomDocument from '../../../core/schema/CustomDocument'

// 导入已有的块扩展
import { BaseBlock } from '../../../blocks/BaseBlock'
import { HeadingBlock } from '../../../blocks/HeadingBlock'
import { ListItemBlock } from '../../../blocks/ListItemBlock'
import { QuoteBlock } from '../../../blocks/QuoteBlock'
import { CodeBlock } from '../../../blocks/CodeBlock'

// 导入 Marks
import TextColorMark from '../../../marks/TextColor'
import TextHighlightMark from '../../../marks/TextHighlight'
import InlineCodeMark from '../../../marks/InlineCode'
// AI 修订 Mark：历史版本内容可能包含 revisionMark，必须注册以保证 Schema 闭合
import { RevisionMark } from '../../../extensions/revision/RevisionMark'

// 低亮语法高亮单例，与主编辑器保持一致
import { getLowlight } from '../../../core/lowlight'

// 导入我们新建的 RootBlockHistory
import { RootBlockHistory } from './RootBlockHistory'

// 复⽤主编辑器的 lowlight 实例，避免重复初始化
const lowlight = getLowlight()

export const historyExtensions = [
  // 基础文档结构
  CustomDocument,
  Text,

  // 核心容器：RootBlockHistory (无交互版)
  RootBlockHistory,

  // 各种内容块 (复用主编辑器扩展，它们大多依靠 renderHTML)
  BaseBlock,
  HeadingBlock,
  ListItemBlock,
  QuoteBlock,
  // CodeBlock 使用 lowlight 进行语法高亮，必须显式传入实例
  CodeBlock.configure({
    lowlight,
  }),

  // Marks & 基础格式 (StarterKit)
  StarterKit.configure({
    document: false, // 使用 CustomDocument
    paragraph: false, // 使用 BaseBlock
    heading: false, // 使用 HeadingBlock
    text: false, // 单独引入
    blockquote: false, // 使用 QuoteBlock
    bulletList: false, // 列表项暂不支持，或需额外配置
    orderedList: false,
    listItem: false, // 使用 ListItemBlock
    codeBlock: false, // 使用 CodeBlock
    horizontalRule: false, // 使用 HorizontalRuleBlock
    
    // 禁用不需要的功能
    dropcursor: false,
    undoRedo: false, // 历史编辑器不需要 undo/redo
    gapcursor: false,
    // 与 Workspace 正式 schema 保持一致；Tiptap 3 StarterKit 默认新增了这些扩展。
    link: false,
    underline: false,
    listKeymap: false,
    // 禁用 StarterKit 内置 code mark，改用自定义 InlineCodeMark（允许与 revisionMark 共存）
    code: false,
  }),

  // 额外的 Marks
  TextColorMark,
  TextHighlightMark,
  InlineCodeMark,
  // 修订标记：用于渲染 insert/delete 的差异样式（只读，不涉及交互命令）
  RevisionMark,
]
