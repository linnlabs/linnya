/**
 * RootBlockShellView
 *
 * 原生 DOM 版 rootBlock NodeView，只负责维持 ProseMirror 需要的稳定 DOM 壳。
 *
 * 中文说明：
 * - Vue 版 BlockView 已经把重型 BlockChrome 延迟水合，但 10000 个 rootBlock 仍会创建
 *   10000 个 Vue NodeView 实例，`setContent` 会被实例创建拖慢；
 * - 这个 Shell 用于 `rootBlockShellEnabled` 压测路径，验证“去 Vue NodeView”后
 *   `setContent` 的基线成本；
 * - 它只预留少量稳定挂载点。修订 header 是文档流内的轻量 slot，具体内容由
 *   Revision 的 shell 同步层写入，避免 overlay 一边测量一边改布局导致错位。
 */

import {
  readRootBlockRenderModeFromDecorations,
  ROOT_BLOCK_RENDER_MODE_DATA_ATTR,
} from '../../features/RenderVirtualization/view/rootBlockRenderMode';
import {
  publishRootBlockNodeViewMounted,
  publishRootBlockNodeViewUnmounted,
} from '../../features/RenderVirtualization/state/nodeViewLifecycle';

function setOptionalAttribute(el, name, value) {
  if (value === null || value === undefined || value === false || value === '') {
    el.removeAttribute(name);
    return;
  }
  el.setAttribute(name, String(value));
}

function setJsonAttribute(el, name, value) {
  if (value === null || value === undefined) {
    el.removeAttribute(name);
    return;
  }
  el.setAttribute(name, JSON.stringify(value));
}

function clearContainsClass(el) {
  for (const className of Array.from(el.classList)) {
    if (className.startsWith('contains-')) {
      el.classList.remove(className);
    }
  }
}

function getContentBlockClass(node) {
  const firstChild = node.firstChild;
  return firstChild ? `contains-${firstChild.type.name}` : '';
}

function applyBlockColorStyle(rootBlockEl, attrs) {
  const bgColor = typeof attrs.backgroundColor === 'string' ? attrs.backgroundColor : null;
  const textColor = typeof attrs.textColor === 'string' ? attrs.textColor : null;
  const blockBgTokenPrefix = '--block-bg-';
  const blockTextTokenPrefix = '--block-text-';

  if (bgColor) {
    rootBlockEl.style.backgroundColor = `var(${blockBgTokenPrefix}${bgColor.replace('_bg', '')})`;
  } else {
    rootBlockEl.style.removeProperty('background-color');
  }

  if (textColor) {
    rootBlockEl.style.color = `var(${blockTextTokenPrefix}${textColor.replace('_text', '')})`;
  } else {
    rootBlockEl.style.removeProperty('color');
  }
}

function isMutationInsideContentDom(mutation, contentDOM) {
  if (mutation.type === 'selection') return true;
  const target = mutation.target;
  return target === contentDOM || contentDOM.contains(target);
}

function syncShellDom(shell, node) {
  const attrs = node.attrs || {};
  const id = typeof attrs.id === 'string' ? attrs.id : '';

  shell.dom.setAttribute('data-node-type', 'rootBlockOuter');
  shell.dom.setAttribute(ROOT_BLOCK_RENDER_MODE_DATA_ATTR, 'hydrated');
  shell.dom.setAttribute('data-placeholder', 'false');
  setOptionalAttribute(shell.dom, 'data-id', id);
  setJsonAttribute(shell.dom, 'data-annotation-ids', attrs.annotationIds || []);
  setOptionalAttribute(shell.dom, 'data-position', attrs.position);
  setOptionalAttribute(shell.dom, 'data-dragging', attrs.isDragging ? 'true' : null);
  setOptionalAttribute(shell.dom, 'data-background-color', attrs.backgroundColor);
  setOptionalAttribute(shell.dom, 'data-text-color', attrs.textColor);

  clearContainsClass(shell.dom);
  shell.dom.classList.add('is-hydrated');
  shell.dom.classList.remove('is-placeholder', 'root-block-virtual-placeholder');
  const contentClass = getContentBlockClass(node);
  if (contentClass) shell.dom.classList.add(contentClass);

  shell.rootBlockEl.setAttribute('data-node-type', 'rootBlock');
  applyBlockColorStyle(shell.rootBlockEl, attrs);
}

function publishMounted(shell, node, owner) {
  publishRootBlockNodeViewMounted(
    {
      blockId: getBlockId(node),
      mode: 'hydrated',
      dom: shell.dom,
    },
    owner
  );
}

function publishUnmounted(shell, node, owner) {
  publishRootBlockNodeViewUnmounted(
    {
      blockId: getBlockId(node),
      mode: 'hydrated',
      dom: shell.dom,
    },
    owner
  );
}

export function createRootBlockShellView(node, options) {
  const lifecycleOwner = options.lifecycleOwner;
  const dom = document.createElement('div');
  dom.className = 'root-block-outer';

  const revisionHeaderEl = document.createElement('div');
  revisionHeaderEl.className = 'root-block-revision-header';
  revisionHeaderEl.hidden = true;
  revisionHeaderEl.setAttribute('data-root-block-shell-revision-header', 'true');

  const rootBlockEl = document.createElement('div');
  rootBlockEl.className = 'root-block';

  const contentDOM = document.createElement('div');
  contentDOM.className = 'content';

  const historyMountEl = document.createElement('div');
  historyMountEl.setAttribute('data-root-block-shell-history-mount', 'true');

  rootBlockEl.appendChild(contentDOM);
  rootBlockEl.appendChild(historyMountEl);
  dom.appendChild(revisionHeaderEl);
  dom.appendChild(rootBlockEl);

  const shell = {
    dom,
    contentDOM,
    revisionHeaderEl,
    rootBlockEl,
    update(nextNode, decorations) {
      if (nextNode.type !== node.type) return false;
      const mode = options.resolveMode
        ? options.resolveMode(nextNode, decorations)
        : readRootBlockRenderModeFromDecorations(decorations);
      if (mode !== 'hydrated') return false;
      node = nextNode;
      syncShellDom(shell, nextNode);
      publishMounted(shell, nextNode, lifecycleOwner);
      return true;
    },
    selectNode() {
      dom.classList.add('is-block-selected');
    },
    deselectNode() {
      dom.classList.remove('is-block-selected');
    },
    ignoreMutation(mutation) {
      // 中文说明：Shell NodeView 的 header/history mount 都是外部 chrome，不属于 ProseMirror
      // 可编辑内容。Revision header 会通过原生 DOM 写入 child 节点，如果不忽略这类
      // contentDOM 之外的 mutation，PM 的 DOMObserver 会把 chrome 变化误当成文档变化，
      // 后续 flush/rebuild 可能把刚渲染的 header 清掉。
      return !isMutationInsideContentDom(mutation, contentDOM);
    },
    destroy() {
      // 中文说明：
      // ProseMirror 会负责把 NodeView 的 DOM 从文档树中移除。
      // 这里不能主动清空 dom，否则在 editor.createNodeViews()/setProps 触发 NodeView 重绑时，
      // 旧 DOM 可能仍短暂位于页面中，被清空后就会表现为“大量块先出现又消失”。
      publishUnmounted(shell, node, lifecycleOwner);
    },
  };

  syncShellDom(shell, node);
  publishMounted(shell, node, lifecycleOwner);
  return shell;
}

function getBlockId(node) {
  const attrs = node.attrs || {};
  return typeof attrs.id === 'string' ? attrs.id : '';
}
