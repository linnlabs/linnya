import { Extension, findParentNode } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { VueRenderer } from '@tiptap/vue-3'
import tippy from 'tippy.js'
import { TextSelection, NodeSelection } from 'prosemirror-state'
import { generateBlockId, generateRootBlockId } from '../../../../../shared/utils/idUtils'
import { useUIStore } from '../../../../../shared/stores/ui'
import { PositionUtils } from '../../../extensions/position/PositionUtils'
import { createSlashMenuKeepAliveController } from './slashMenuVirtualizationKeepAlive'
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage'
import { pickEmbedAndInsertImage } from '../../../blocks/ImageBlock/orchestration/embedAndInsertImage'

// 导入Vue相关，如果需要在render中使用
// import { ref } from 'vue'; 

// 临时导入菜单视图组件（后续需要创建）
import SlashMenuView from '../ui/SlashMenuView.vue'; 

// 导入建议的菜单项定义 (后续需要创建)
// import { getItems } from './items'; 

// 导入推荐的插件 (后续需要创建)
// import SlashMenuPlugin from './SlashMenuPlugin'; 

export const SlashMenuExtension = Extension.create({
  name: 'slashMenu',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        startOfLine: false, // 允许在行内触发（支持 /c 等快速插入）
        // 允许在空的基础块中触发
        allowedPrefixes: [' '], // 允许前面有空格，覆盖默认的 null
        // 定义命令，当选择一个项目时执行
        // command 现在移到 Suggestion 调用中，因为它需要 props
        // --- 移除 items 和 render --- 
      },
    }
  },

  addProseMirrorPlugins() {
    // --- 在这里定义 items 和 render --- 
    const items = ({ query }) => {
      const editorMessage = resolveCurrentEditorMessage;
      const convertToGroup = editorMessage('editor.slash.group.convertTo');
      const insertGroup = editorMessage('editor.slash.group.insert');
      const aiGroup = editorMessage('editor.slash.group.ai');

      // 1. 定义所有可能的菜单项及其分组和命令
      const allItems = [
        // --- 转换为 --- 
        { title: editorMessage('editor.slash.item.heading1'), aliases: ['一级标题', 'h1'], group: convertToGroup, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('headingBlock', { level: 1 }).run() },
        { title: editorMessage('editor.slash.item.heading2'), aliases: ['二级标题', 'h2'], group: convertToGroup, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('headingBlock', { level: 2 }).run() },
        // { title: '三级标题', group: '转换为', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('headingBlock', { level: 3 }).run() }, // 更多标题
        { title: editorMessage('editor.slash.item.bulletList'), aliases: ['无序列表', 'bullet'], group: convertToGroup, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).convertToListItem('bullet').run() },
        // 参考 MenuBar：有序列表也是一个“块级结构”，这里用 convertToListItem('ordered') 进行转换
        { title: editorMessage('editor.slash.item.orderedList'), aliases: ['有序列表', 'ordered'], group: convertToGroup, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).convertToListItem('ordered').run() },
        // { title: '有序列表', group: '转换为', command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
        { title: editorMessage('editor.slash.item.quoteBlock'), aliases: ['引用块', 'quote'], group: convertToGroup, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).convertToQuoteBlock().run() },
        {
          title: editorMessage('editor.slash.item.audioBlock'),
          aliases: ['录音块', 'audio'],
          group: convertToGroup,
          command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).convertToAudioBlock().run();
          }
        },
        { title: editorMessage('editor.slash.item.codeBlock'), aliases: ['代码块', 'code'], group: convertToGroup, command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCodeBlock().run() },
        {
          title: editorMessage('editor.slash.item.latexBlock'),
          aliases: ['LaTeX 公式', 'latex'],
          group: convertToGroup,
          command: ({ editor, range }) => {
            // 1. Delete the trigger character
            // 2. Call the conversion command
            editor.chain().focus().deleteRange(range).convertToLatexBlock().run();
          }
        },
        {
          title: editorMessage('editor.slash.item.horizontalRule'),
          aliases: ['水平分割线', 'divider', 'hr'],
          group: convertToGroup,
          command: ({ editor, range }) => {
            editor.chain().focus().executeInsertHorizontalRuleBeforeAndConvertNext({ range }).run();
          }
        },
        // --- 插入 ---（参考 MenuBar 的“Insertions”）
        {
          title: editorMessage('editor.slash.item.tableBlock'),
          aliases: ['表格块', 'table'],
          group: insertGroup,
          command: ({ editor, range }) => {
            // SlashMenu 场景下没有表格尺寸选择器：先给一个合理默认值（3x3，带表头）
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run();
          }
        },
        {
          title: editorMessage('editor.slash.item.imageBlock'),
          aliases: ['图片块', 'image'],
          group: insertGroup,
          command: async ({ editor, range }) => {
            // 先删除触发符与 query，再打开系统图片选择对话框
            editor.chain().focus().deleteRange(range).run();

            await pickEmbedAndInsertImage({
              editor,
              dialogTitle: editorMessage('editor.slash.imageDialog.title'),
              imageFilterName: editorMessage('editor.slash.imageDialog.filterName'),
              insertedMessageKey: 'editor.slash.toast.imageInserted',
              unavailableMessageKey: 'editor.slash.toast.imageDialogUnavailable',
              failedMessageKey: 'editor.slash.toast.imageFlowFailed',
            });
          }
        },

        // AI 类
        { 
          title: editorMessage('editor.slash.item.aiWriting'),
          aliases: ['AI 写作', 'ai'],
          group: aiGroup,
          command: ({ editor, range }) => {
            // 删除斜杠触发符
            editor.chain().focus().deleteRange(range).run();
            
            // 获取 UI Store
            const uiStore = useUIStore();
            
            // 获取当前光标位置（删除斜杠后）
            const { from } = editor.state.selection;
            
            // 获取位置工具并获取块信息（参考 AiInteraction.js 实现）
            const posUtils = new PositionUtils(editor);
            const blockInfo = posUtils.getBlockInfoFromPos(from);
            
            // 获取 rootBlock ID
            const rootBlockId = blockInfo?.rootBlock?.node.attrs.id;
            
            if (!rootBlockId) {
              console.error('[SlashMenu AI写作] 无法获取 RootBlock ID');
              return;
            }
            
            // 获取块元素并计算位置
            const blockElement = document.querySelector(`.root-block-outer[data-id="${rootBlockId}"]`);
            if (!blockElement) {
              console.error(`[SlashMenu AI写作] 无法找到 ID 为 ${rootBlockId} 的块元素`);
              return;
            }
            
            const blockRect = blockElement.getBoundingClientRect();
            const position = {
              top: blockRect.bottom + 5,
            };
            
            // 显示 AI 写作输入框
            uiStore.showAiPrompt({
              position,
              targetBlockId: rootBlockId,
              triggerPos: from,
            });
          }
        },

        // 插入引用（Phase 2 新增）
        {
          title: editorMessage('editor.slash.item.citation'),
          aliases: ['cite', 'citation', '引用', 'yinyong'],  // 支持多种匹配关键词
          group: insertGroup,
          command: async ({ editor, range }) => {
            // 删除斜杠触发符
            editor.chain().focus().deleteRange(range).run();
            
            // 动态导入 Citation 面板 store，避免循环依赖
            const { useCitationPanelStore } = await import('../../citation/store/useCitationPanelStore');
            const citationStore = useCitationPanelStore();
            
            // 打开 Citation 面板
            citationStore.open('kb');
          }
        },
      ];

      // 2. 根据查询过滤项目（支持 title + aliases 匹配）
      const queryLower = query.toLowerCase();
      const filteredItems = allItems.filter(item => {
        // 标题匹配
        if (item.title.toLowerCase().includes(queryLower)) {
          return true;
        }
        // aliases 匹配（Phase 2 新增：支持 /cite 等关键词匹配）
        if (Array.isArray(item.aliases)) {
          return item.aliases.some(alias => 
            alias.toLowerCase().includes(queryLower)
          );
        }
        return false;
      });

      // 3. 定义分组顺序
      const groupOrder = [convertToGroup, insertGroup, aiGroup];

      // 4. 按分组排序
      filteredItems.sort((a, b) => {
        return groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group);
      });

      // 5. 插入分组标题、项目和分隔符
      const itemsWithSeparators = [];
      
      // 按分组处理项目
      let currentGroupItems = {};
      filteredItems.forEach(item => {
        if (!currentGroupItems[item.group]) {
          currentGroupItems[item.group] = [];
        }
        currentGroupItems[item.group].push(item);
      });
      
      // 按固定顺序添加分组和项目
      groupOrder.forEach((group, groupIndex) => {
        if (currentGroupItems[group] && currentGroupItems[group].length > 0) {
          // 1. 添加分组标题项
          itemsWithSeparators.push({ 
            isGroupTitle: true, // 标记为组标题
            id: `title-${group}`,
            groupName: group
          });
          
          // 2. 添加该组的所有项目
          currentGroupItems[group].forEach(item => {
            itemsWithSeparators.push(item);
          });

          // 3. 如果不是最后一个分组，在项目后添加分隔符
          if (groupIndex < groupOrder.length - 1) {
            // 检查下一个分组是否有项目
            let nextGroupHasItems = false;
            for (let i = groupIndex + 1; i < groupOrder.length; i++) {
              if (currentGroupItems[groupOrder[i]] && currentGroupItems[groupOrder[i]].length > 0) {
                nextGroupHasItems = true;
                break;
              }
            }
            if (nextGroupHasItems) {
              itemsWithSeparators.push({ 
                isSeparator: true, 
                id: `sep-after-${group}`
              });
            }
          }
        }
      });
      
      return itemsWithSeparators;
    };

    const render = () => {
      let component;
      let popup;
      let keepAliveController;
      
      return {
        onStart: props => {
          keepAliveController = createSlashMenuKeepAliveController(props.editor);
          keepAliveController.pinForRange(props.range);

          component = new VueRenderer(SlashMenuView, {
            props: props, 
            editor: props.editor, // Suggestion 会提供 editor
          });
          
          if (!props.clientRect) { 
            return; 
          }
          popup = tippy('body', {
            getReferenceClientRect: props.clientRect, 
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: 'manual',
            placement: 'bottom-start',
            duration: 150, // 过渡时间，配合 CSS animation
          });
        },
        onUpdate(props) {
          keepAliveController?.pinForRange(props.range);
          component?.updateProps(props);
          
          if (!props.clientRect) { 
             return; 
          }
          popup?.[0]?.setProps({
            getReferenceClientRect: props.clientRect,
          });
        },
        onKeyDown(props) {
          if (props.event.key === 'Escape') {
            popup?.[0]?.hide();
            return true;
          }
          const handledByComponent = component?.ref?.onKeyDown(props);
          return handledByComponent;
        },
        onExit() {
          keepAliveController?.release();
          popup?.[0]?.destroy();
          component?.destroy();
          popup = null;
          component = null;
          keepAliveController = null;
        },
      }
    };

    // --- 将 items 和 render 直接传递给 Suggestion --- 
    return [
      Suggestion({
        editor: this.editor, 
        ...this.options.suggestion, // 获取 char, startOfLine 等选项
        // +++ 添加 items, render 和 command +++
        items: items,
        render: render,
        command: ({ editor, range, props }) => {
          // props 来自于 items 返回的那个对象
          props.command({ editor, range });
        },
      })
    ];
  },
});

// 默认导出方便使用
export default SlashMenuExtension;
