import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { generateBlockId } from '../../../../shared/utils/idUtils'
import { NODE_GROUPS } from '../../extensions/core/schema' // 确保路径正确
import { VueNodeViewRenderer } from '@tiptap/vue-3' // 导入 Vue NodeView 渲染器
import CodeBlockView from './ui/CodeBlockView.vue' // 导入 Vue 组件
import { DOMParser as PMDOMParser } from '@tiptap/pm/model'
import { normalizeCodeBlockLanguage } from './functions/codeBlockLanguage'

export const CodeBlock = CodeBlockLowlight.extend({
  name: 'codeBlock', // 保持或修改为你想要的名称
  group: NODE_GROUPS.BLOCK_CONTENT, // 加入你的块内容组
  /**
   * 中文说明：
   * - 默认的 codeBlock 通常会禁用 marks（marks: ''），以保证代码内容不被加粗/斜体等污染。
   * - 但我们的 AI 修订是通过 `revisionMark` 实现的，如果 codeBlock 不允许 marks，
   *   则“插入的代码块/代码内容”无法显示绿色修订样式，也无法走统一的 accept/reject 命令。
   * - 因此这里仅放行 `revisionMark`，仍然不允许 bold/italic/strike 等其它 marks。
   */
  marks: 'revisionMark',

  // 定义特性
  defining: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      ...this.parent?.(), // 继承父类的选项 (如 lowlight 实例)
      // 独立文件的语言来自文件名，不能像文档中的围栏块一样由菜单改写。
      allowLanguageSelection: true,
      // 文档围栏由块内滚动；独立文件把双轴滚动交给整个编辑视口。
      scrollMode: 'block',
      HTMLAttributes: {
        class: 'code-block', // 内层 <pre><code> 元素的 class，父类控制
      },
    }
  },

  addAttributes() {
    const inherited = this.parent?.() ?? {}
    return {
      ...inherited, // 继承父类的属性 (如 language)
      // 图表专属围栏语言不能作为普通代码保存：所有 HTML 解析路径统一在属性层规整。
      language: {
        ...inherited.language,
        parseHTML: element => normalizeCodeBlockLanguage(inherited.language?.parseHTML?.(element) ?? null),
      },
      // 添加你的标准块属性
      id: {
        default: () => generateBlockId(),
        parseHTML: (element) => element.closest('.code-block-outer')?.getAttribute('data-block-id') || element.closest('.code-block')?.getAttribute('data-block-id') || generateBlockId(),
        renderHTML: attributes => ({
          'data-block-id': attributes.id, // 这个属性会渲染在 <pre> 上，我们需要在外层渲染
        })
      },
      blockType: {
        default: 'code',
        parseHTML: element => element.closest('.code-block-outer')?.getAttribute('data-block-type') || element.closest('.code-block')?.getAttribute('data-block-type') || 'code',
        renderHTML: attributes => ({
          'data-block-type': attributes.blockType, // 同上
        })
      },
      isEmpty: {
        default: true,
        parseHTML: element => element.getAttribute('data-is-empty') === 'true',
        renderHTML: attributes => ({
          'data-is-empty': attributes.isEmpty ? 'true' : 'false', // 同上
        })
      }
    }
  },

  // 覆盖 parseHTML 以解析我们的结构和标准 <pre>
  parseHTML() {
    return [
      // 优先解析我们的自定义结构
      {
        tag: 'div[data-node-type="codeBlockOuter"]', 
        preserveWhitespace: 'full', // 关键：保留代码块中的空白符
        getContent: (dom, schema) => {
             // 内容在 pre > code 里面
             const codeElement = dom.querySelector('pre > code');
             return PMDOMParser.fromSchema(schema)
               .parseSlice(codeElement || dom, { preserveWhitespace: 'full' })
               .content;
         },
      },
       {
        tag: 'div[data-type="code-block"]', // 兼容旧的 data-type
        preserveWhitespace: 'full',
         getContent: (dom, schema) => {
             const codeElement = dom.querySelector('pre > code');
             return PMDOMParser.fromSchema(schema)
               .parseSlice(codeElement || dom, { preserveWhitespace: 'full' })
               .content;
         },
      },
      // 解析标准的 <pre> 标签
      {
        tag: 'pre',
        preserveWhitespace: 'full', // 关键：保留代码块中的空白符
         getContent: (dom, schema) => {
             // 标准 pre 可能直接包含 text 或包含 code
             const codeElement = dom.querySelector('code');
             return PMDOMParser.fromSchema(schema)
               .parseSlice(codeElement || dom, { preserveWhitespace: 'full' })
               .content; // 返回 code 或 pre 本身作为内容容器
         },
         getAttrs: dom => {
            // 尝试从 <code> 的 class 中提取语言
            const codeElement = dom.querySelector('code');
            const languageClass = codeElement?.className.match(/language-(\S+)/);
            return { language: languageClass ? languageClass[1] : null };
         }
      },
      // 调用父类的 parseHTML 规则（如果有用的话，可能重复）
      ...(this.parent?.() || []),
    ];
  },

  // 添加 NodeView 渲染方法
  addNodeView() {
    return VueNodeViewRenderer(CodeBlockView)
  },

  // 可以添加命令，但 setCodeBlock 通常由 CodeBlockLowlight 提供
  // addCommands() { ... }

  // 可以添加快捷键
  addKeyboardShortcuts() {
    return {
      // 添加 Tab 键插入缩进
      Tab: () => {
        if (this.editor.isActive(this.name)) {
          this.editor.commands.insertContent('  ') // 插入2个空格作为缩进
          return true
        }
        return false
      }
    }
  }
});

export default CodeBlock;
