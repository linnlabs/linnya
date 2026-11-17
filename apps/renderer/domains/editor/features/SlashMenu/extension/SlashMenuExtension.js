import { Extension, findParentNode } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { VueRenderer } from '@tiptap/vue-3'
import tippy from 'tippy.js'
import { TextSelection, NodeSelection } from 'prosemirror-state'
import { generateBlockId, generateRootBlockId } from '../../../../../shared/utils/idUtils'
import { createSlashMenuKeepAliveController } from './slashMenuVirtualizationKeepAlive'
import { createSlashMenuItems } from '../definitions/slashMenuItems'
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage'

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
      const { items: allItems, groupOrder } = createSlashMenuItems(editorMessage);

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
