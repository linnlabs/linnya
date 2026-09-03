/**
 * @file apps/renderer/shared/extensions/ColumnReferenceNode.ts
 * 
 * @brief 列引用节点扩展 - Tiptap 编辑器中的自定义节点类型
 * 
 * @description
 * 这个文件定义了一个自定义的 Tiptap 节点类型，用于在编辑器中显示和管理列引用。
 * 主要功能包括：
 * - 将 {{refKey}} 格式的文本转换为可视化的引用节点
 * - 支持输入规则（InputRule）的实时转换
 * - 自定义粘贴处理，避免多引用粘贴时的位置冲突
 * - 提供颜色验证和样式渲染
 * 
 * 功能：在 Tiptap 编辑器中创建和管理列引用节点
 * 输入：文本内容、验证函数、HTML 属性
 * 输出：渲染后的 HTML 元素、文本内容
 * 副作用：修改编辑器状态、添加 DOM 事件监听器
 */

import { Node, mergeAttributes, InputRule } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';

/**
 * 列引用节点的配置选项接口
 * 
 * @description
 * 定义了创建列引用节点时可以配置的选项
 * 
 * @property HTMLAttributes - 要合并到节点上的 HTML 属性
 * @property validateRef - 可选的引用验证函数，返回颜色值或 null
 */
export interface ColumnReferenceNodeOptions {
  HTMLAttributes: Record<string, unknown>;
  validateRef?: (refKey: string) => string | null;
}

/**
 * 列引用节点的主要实现
 * 
 * @description
 * 使用 Tiptap 的 Node.create 方法创建自定义节点类型
 */
export const ColumnReferenceNode = Node.create<ColumnReferenceNodeOptions>({
  // 节点名称，用于在编辑器中识别此节点类型
  name: 'columnReference',
  
  // 节点分组，inline 表示这是一个内联节点
  group: 'inline',
  
  // 节点行为配置
  inline: true,      // 内联显示
  atom: true,        // 原子节点，不可分割
  selectable: true,  // 可选择
  draggable: false,  // 不可拖拽

  /**
   * 添加节点选项
   * 
   * @description
   * 设置节点的默认配置选项
   * 
   * @returns {Object} 包含默认 HTML 属性和验证函数的选项对象
   * 
   * 功能：初始化节点的默认配置
   * 输入：无
   * 输出：包含默认选项的对象
   * 副作用：无
   */
  addOptions() {
    return {
      HTMLAttributes: {},
      validateRef: () => null,
    };
  },

  /**
   * 定义节点的属性
   * 
   * @description
   * 配置节点支持的各种属性，包括引用键、标签和颜色
   * 
   * @returns {Object} 包含 refKey、label、color 属性的配置对象
   * 
   * 功能：定义节点的属性结构和解析/渲染规则
   * 输入：无
   * 输出：属性配置对象
   * 副作用：无
   */
  addAttributes() {
    return {
      // 引用键属性：存储列引用的标识符
      refKey: {
        default: '',
        parseHTML: element => element.getAttribute('data-ref-key'),
        renderHTML: attributes => ({ 'data-ref-key': attributes.refKey }),
      },
      
      // 标签属性：显示在节点上的文本
      label: {
        default: '',
        parseHTML: element => element.textContent,
      },
      
      // 颜色属性：节点的主题颜色
      color: {
        default: '#888888',
        parseHTML: element => element.getAttribute('data-color'),
        renderHTML: attributes => ({ 'data-color': attributes.color }),
      },
    };
  },

  /**
   * 定义 HTML 解析规则
   * 
   * @description
   * 指定哪些 HTML 元素可以被解析为列引用节点
   * 
   * @returns {Array} 包含解析规则的数组
   * 
   * 功能：定义从 HTML 解析节点的规则
   * 输入：无
   * 输出：解析规则数组
   * 副作用：无
   */
  parseHTML() {
    return [{ tag: 'span[data-ref-key][data-type="columnReference"]' }];
  },

  /**
   * 渲染节点为 HTML
   * 
   * @description
   * 将节点转换为 HTML 元素，应用样式和属性
   * 
   * @param {Object} params - 渲染参数
   * @param {Object} params.HTMLAttributes - 要合并的 HTML 属性
   * @param {Object} params.node - 当前节点实例
   * @returns {Array} 包含标签名、属性和内容的数组
   * 
   * 功能：将节点渲染为带样式的 HTML span 元素
   * 输入：HTML 属性和节点实例
   * 输出：HTML 渲染数组
   * 副作用：无
   */
  renderHTML({ HTMLAttributes, node }) {
    const color = node.attrs.color || '#888888';
    
    // 构建内联样式，创建引用节点的视觉效果
    const style = `
      background-color: ${color}20;
      border: 1px solid ${color}90;
      color: ${color};
      border-radius: 6px;
      padding: 0px 4px;
      margin: 1px 2px;
      font-size: 0.85em;
      white-space: nowrap;
      cursor: default;
      display: inline-block;
    `;

    // 合并默认 HTML 属性和自定义样式
    const finalAttrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { 
      style,
      'data-type': 'columnReference' 
    });
    return ['span', finalAttrs, node.attrs.label || ''];
  },

  /**
   * 渲染节点的纯文本内容
   * 
   * @description
   * 当需要获取节点的纯文本表示时使用
   * 
   * @param {Object} params - 渲染参数
   * @param {Object} params.node - 当前节点实例
   * @returns {string} 节点的标签文本
   * 
   * 功能：提取节点的纯文本内容
   * 输入：节点实例
   * 输出：文本字符串
   * 副作用：无
   */
  renderText({ node }) {
    return node.attrs.label || '';
  },

  /**
   * 添加输入规则
   * 
   * @description
   * 定义实时输入转换规则，当用户输入 {{refKey}} 格式时自动转换
   * 
   * @returns {Array} 包含 InputRule 实例的数组
   * 
   * 功能：在用户输入时实时将文本转换为列引用节点
   * 输入：无
   * 输出：输入规则数组
   * 副作用：无
   */
  addInputRules() {
    return [
      new InputRule({
        // 匹配 {{refKey}} 格式的文本，$ 确保在行尾匹配
        find: /\{\{([A-Za-z0-9]+(?::[A-Za-z0-9]+)?)\}\}$/,
        
        /**
         * 输入规则的处理函数
         * 
         * @description
         * 当检测到匹配的文本格式时，将其替换为列引用节点
         * 
         * @param {Object} params - 处理参数
         * @param {Object} params.state - 编辑器状态
         * @param {Object} params.range - 匹配文本的范围
         * @param {Array} params.match - 正则表达式匹配结果
         * @returns {Object|null} 事务对象或 null
         * 
         * 功能：处理匹配的输入文本，创建列引用节点
         * 输入：编辑器状态、文本范围、匹配结果
         * 输出：事务对象或 null
         * 副作用：修改编辑器状态，删除原文本并插入新节点
         */
        handler: ({ state, range, match }) => {
          const { from } = range;
          const refKey = match[1];

          // 验证引用并获取颜色
          if (refKey && this.options.validateRef) {
            const color = this.options.validateRef(refKey);

            if (color) {
              const { tr } = state;
              
              // 删除匹配的文本范围
              tr.deleteRange(range.from, range.to);
              
              // 在删除位置插入新的列引用节点
              tr.insert(from, this.type.create({
                refKey: refKey,
                label: `{{${refKey}}}`,
                color: color,
              }));
              
              // TipTap 会在 handler 返回后检查这份 transaction 的 steps 并统一 dispatch。
              return;
            }
          }
          return null;
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('columnReferencePasteHandler'),
        props: {
          handlePaste: (view, event, _slice) => {
            const text = event.clipboardData?.getData('text/plain');
            if (!text) {
              return false; // let default handler run
            }

            const regex = /\{\{([A-Za-z0-9]+(?::[A-Za-z0-9]+)?)\}\}/g;
            const matches = Array.from(text.matchAll(regex));

            if (matches.length === 0) {
              return false; // let default handler run
            }
            
            const { validateRef } = this.options;
            const editor = this.editor;
            
            const refMatches: {
              refKey: string;
              fullMatch: string;
              color: string;
              index: number;
              length: number;
            }[] = [];
            matches.forEach(match => {
              const refKey = match[1];
              const fullMatch = match[0];
              
              if (refKey && validateRef) {
                const color = validateRef(refKey);
                
                if (color) {
                  refMatches.push({
                    refKey,
                    fullMatch,
                    color,
                    index: match.index,
                    length: fullMatch.length
                  });
                }
              }
            });

            if (refMatches.length === 0) {
              return false;
            }

            event.preventDefault();

            refMatches.sort((a, b) => a.index - b.index);
            
            const contentToInsert = [];
            let lastIndex = 0;

            for (const match of refMatches) {
              if (match.index > lastIndex) {
                contentToInsert.push({
                  type: 'text',
                  text: text.substring(lastIndex, match.index),
                });
              }
              
              contentToInsert.push({
                type: this.name,
                attrs: {
                  refKey: match.refKey,
                  label: `{{${match.refKey}}}`,
                  color: match.color,
                },
              });
              
              lastIndex = match.index + match.length;
            }

            if (lastIndex < text.length) {
              contentToInsert.push({
                type: 'text',
                text: text.substring(lastIndex),
              });
            }
            
            if (contentToInsert.length > 0) {
              editor.commands.insertContent(contentToInsert);
              return true; // We handled it
            }
            
            return false;
          },
        },
      }),
    ];
  }
});

export default ColumnReferenceNode;
