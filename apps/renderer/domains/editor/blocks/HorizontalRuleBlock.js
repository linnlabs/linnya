import { Node, mergeAttributes } from '@tiptap/core';
import { generateBlockId } from '../../../shared/utils/idUtils'; // Re-add generateBlockId import

/**
 * HorizontalRuleBlock 扩展
 * 实现水平分割线功能，对应 Markdown 的 '---' 语法
 */
export const HorizontalRuleBlock = Node.create({
  name: 'horizontalRuleBlock',

  // 定义为原子节点，意味着它不能有子内容，并且像一个单独的字符一样被处理
  atom: true,
  selectable: true, // 允许像普通节点一样选中
  draggable: false, // 暂时不允许拖拽

  // 添加选项，定义默认 HTML 属性
  addOptions() {
    return {
      HTMLAttributes: {
        class: 'horizontal-rule-block editor-block', // 添加 editor-block 类以保持一致性
      },
    };
  },

  // 添加节点属性
  addAttributes() {
    return {
      // 块的唯一 ID
      id: {
        default: () => generateBlockId(),
        parseHTML: (element) => element.getAttribute('data-block-id') || generateBlockId(),
        renderHTML: (attributes) => ({
          'data-block-id': attributes.id,
        }),
      },
      // 块的类型标识
      blockType: {
        default: 'horizontalRule', // 明确类型
        parseHTML: (element) => element.getAttribute('data-block-type') || 'horizontalRule',
        renderHTML: (attributes) => ({
          'data-block-type': attributes.blockType,
        }),
      },
    };
  },

  // 定义节点的 HTML 渲染结构
  renderHTML({ HTMLAttributes, node }) {
    // 创建外层容器
    const outer = document.createElement('div');
    // **修正：只应用外层 class**
    outer.className = 'horizontal-rule-block-outer'; 
    outer.setAttribute('data-node-type', 'horizontalRuleBlockOuter');
    // 将 ProseMirror 自动处理的属性合并到外层 div (除了 class)
    Object.entries(this.options.HTMLAttributes).forEach(([key, value]) => {
       if (key !== 'class') { // 避免覆盖我们手动设置的 class
         outer.setAttribute(key, value);
       }
    });
    outer.setAttribute('data-block-id', node.attrs.id); // ID 放在外层
    outer.setAttribute('data-block-type', node.attrs.blockType || 'horizontalRule'); // 类型放在外层
    // **新增：为原子节点添加 contenteditable=false**
    outer.setAttribute('contenteditable', 'false');


    // 创建内层容器，用于放置 <hr>
    const inner = document.createElement('div');
    // **修正：只应用内层 class**
    inner.className = 'horizontal-rule-block editor-block'; // 应用基础块样式和特定样式
    inner.setAttribute('data-node-type', 'horizontalRuleBlock');

    // *** 关键：创建并添加 <hr> 元素 ***
    const hr = document.createElement('hr');
    inner.appendChild(hr); // 将 <hr> 放入内层容器

    outer.appendChild(inner); // 将内层容器放入外层

    // 对于原子节点，通常返回 dom 指向最外层元素
    // contentDOM 应为 null 或 undefined，因为它没有可编辑内容
    return {
      dom: outer,
      contentDOM: undefined // 明确表示没有内容DOM
    };
  },

  // 定义如何从 HTML 解析此节点
  parseHTML() {
    return [
      {
        tag: 'hr', // 直接解析 <hr> 标签
        // getAttrs 可以用来从解析的元素中提取属性，这里 <hr> 通常没有额外属性需要提取给 ProseMirror
        getAttrs: (dom) => ({ blockType: 'horizontalRule' }), // 确保类型正确
      },
      {
        // 同时支持从我们自己渲染的结构中解析回来
        tag: 'div[data-node-type="horizontalRuleBlockOuter"]', 
        getAttrs: (dom) => ({ // dom is now the outer div
            id: dom.getAttribute('data-block-id'),
            blockType: dom.getAttribute('data-block-type') || 'horizontalRule',
        })
      }
    ];
  },
});

export default HorizontalRuleBlock;
