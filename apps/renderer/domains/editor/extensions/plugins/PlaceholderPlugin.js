// src/renderer/shared/extensions/plugins/PlaceholderPlugin.js
/**
 * PlaceholderPlugin.js
 * 
 * 使用 ProseMirror 的 decoration.widget 实现占位符功能
 * 当块为空时，显示统一的占位符文本
 * 为 baseBlock 和 headingBlock 类型的块提供占位符
 * 未来需要拆分，尤其是autocomplete 和 placeholder 的插件
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { PLACEHOLDER_VISIBILITY_PREDICATES_KEY } from '../../shared/constants/editorStorageKeys';
import { recordDecorationSetPerfSample } from '../../features/RenderVirtualization/debug/decorationSetRuntimePerf';
import { resolveCurrentEditorMessage } from '../../functions/resolveCurrentEditorMessage';

function resolveCustomPlaceholder(customPlaceholder, defaultPlaceholder) {
  return typeof customPlaceholder === 'string' && customPlaceholder.length > 0
    ? customPlaceholder
    : defaultPlaceholder;
}

function resolveHeadingPlaceholder(level) {
  switch (level) {
    case 1:
      return resolveCurrentEditorMessage('editor.placeholder.heading.level1');
    case 2:
      return resolveCurrentEditorMessage('editor.placeholder.heading.level2');
    case 3:
      return resolveCurrentEditorMessage('editor.placeholder.heading.level3');
    case 4:
      return resolveCurrentEditorMessage('editor.placeholder.heading.level4');
    case 5:
      return resolveCurrentEditorMessage('editor.placeholder.heading.level5');
    case 6:
      return resolveCurrentEditorMessage('editor.placeholder.heading.level6');
    default:
      return resolveCurrentEditorMessage('editor.placeholder.heading.empty', { level });
  }
}

export const PlaceholderPlugin = Extension.create({
  name: 'placeholderPlugin',

  addOptions() {
    return {
      emptyNodeClass: 'is-empty',
      // 基础块占位符文本
      baseBlockPlaceholder: '',
      // 列表项占位符文本
      listItemPlaceholder: '',
      // 标题占位符文本
      headingPlaceholders: {
        1: '',
        2: '',
        3: '',
        4: '',
        5: '',
        6: '',
      },
      showOnlyWhenFocused: true,
      includeChildren: true,
    };
  },

  onCreate() {
    this.editor.storage[PLACEHOLDER_VISIBILITY_PREDICATES_KEY] = 
      this.editor.storage[PLACEHOLDER_VISIBILITY_PREDICATES_KEY] || [];
  },

  addProseMirrorPlugins() {
    const { emptyNodeClass, baseBlockPlaceholder, listItemPlaceholder, headingPlaceholders, showOnlyWhenFocused, includeChildren } = this.options;
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey('placeholder'),
        props: {
          decorations(state) {
            const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
            const { doc, selection } = state;
            const decorations = [];
            const { from, to } = selection;
            let visitedNodeCount = 0;

            // 遍历所有块节点
            doc.descendants((node, pos) => {
              visitedNodeCount += 1;
              // 检查节点是否为空
              const isEmpty = node.content.size === 0;

              if (!isEmpty) {
                return includeChildren;
              }

              // 检查节点是否被选中
              const isFocused = from >= pos && to <= pos + node.nodeSize;
              if (showOnlyWhenFocused && !isFocused) {
                return includeChildren;
              }

              // 2c: Check registered predicates
              const predicates = editor.storage[PLACEHOLDER_VISIBILITY_PREDICATES_KEY];
              if (Array.isArray(predicates)) {
                for (const predicate of predicates) {
                  if (typeof predicate === 'function') {
                    // Pass state and editor to the predicate function
                    if (predicate(state, editor)) {
                      // If any predicate returns true, hide placeholder for this node
                  return includeChildren; 
                }
                  }
                }
              }

              let nodePlaceholder = '';

              // 根据节点类型设置占位符
              if (node.type.name === 'baseBlock') {
                // ++ 新增：检查父节点是否为 RootBlock ++
                const $pos = doc.resolve(pos); // 解析当前节点的位置
                // $pos.parent 在这里指的是 BaseBlock 所在的直接容器，例如 RootBlock 或 TableCell
                // $pos.node(-1) 可以获取到更外层的 RootBlock (如果 BaseBlock 在 TableCell 内，则 $pos.node(-2) 可能是 RootBlock)
                // 我们需要的是 BaseBlock 的直接父节点。
                // $pos.depth 是当前节点的深度，根文档是0。RootBlock 通常是深度1，其内容是深度2。
                // 如果 BaseBlock 直接在 RootBlock下，其深度通常是 2，其父节点 $pos.node($pos.depth -1) 即为 RootBlock
                // 更简单的方式是直接检查 $pos.parent.type.name

                const parentNode = $pos.parent; // 获取 BaseBlock 的直接父节点
                if (parentNode && parentNode.type.name === 'rootBlock') {
                  nodePlaceholder = resolveCustomPlaceholder(
                    baseBlockPlaceholder,
                    resolveCurrentEditorMessage('editor.placeholder.baseBlockAi'),
                  );
                } else {
                  // 如果父节点不是 RootBlock (例如在 TableCell 中)，则不显示 BaseBlock 的占位符
                  // 或者可以为其设置一个不同的、更通用的占位符，或者完全不设置
                  // 为保持与您需求一致，这里我们不设置占位符
                  return includeChildren; // 跳过对此 BaseBlock 的占位符处理
                }
                // ++ 结束新增检查 ++
              } else if (node.type.name === 'headingBlock') {
                // 根据标题级别设置占位符
                const level = node.attrs.level || 1;
                nodePlaceholder = resolveCustomPlaceholder(
                  headingPlaceholders[level],
                  resolveHeadingPlaceholder(level),
                );
              } else if (node.type.name === 'listItemBlock') {
                // 为列表项设置占位符
                nodePlaceholder = resolveCustomPlaceholder(
                  listItemPlaceholder,
                  resolveCurrentEditorMessage('editor.placeholder.listItem'),
                );
              } else {
                // 不处理其他类型的节点
                return includeChildren;
              }

              // 添加空节点类名和 data-placeholder 装饰
              const decorationClass = Decoration.node(pos, pos + node.nodeSize, {
                class: emptyNodeClass,
                'data-placeholder': nodePlaceholder
              });
              decorations.push(decorationClass);

              return includeChildren;
            });

            const decorationSet = DecorationSet.create(doc, decorations);
            recordDecorationSetPerfSample({
              source: 'placeholder',
              decorationCount: decorations.length,
              startedAt,
              visitedNodeCount,
              trigger: showOnlyWhenFocused ? 'focused-empty-node' : 'empty-nodes',
            });
            return decorationSet;
          },
        },
      }),
    ];
  },
});

export default PlaceholderPlugin; 
