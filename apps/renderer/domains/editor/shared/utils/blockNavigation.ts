/**
 * @file blockNavigation.ts
 * @description 编辑器块导航（按 blockId 定位、滚动、选中、高亮）
 *
 * 设计目标：
 * - 高内聚：只关心“如何在 editor 中定位一个 rootBlock”
 * - 低耦合：不依赖 workspace / conversation / 工具协议，只依赖 editor 的 doc 与 view
 *
 * 说明：
 * - 我们的文档结构：doc -> rootBlock -> blockContent
 * - rootBlock.attrs.id 即后端与前端共享的 blockId（稳定）
 */

import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import {
  scrollEditorToBlock,
  type ScrollToBlockOptions,
} from '../../features/RenderVirtualization/controller/scrollHandshake';

export interface RootBlockLocateResult {
  /** rootBlock 在 ProseMirror 文档中的起始位置（用于 setNodeSelection / nodeDOM） */
  pos: number;
  /** rootBlock 的 1-based 序号（用于“第N段”展示） */
  index: number;
  /** blockId（回传方便调用方链路对齐） */
  blockId: string;
}

/**
 * 遍历当前 editor 文档，按 blockId 查找对应 rootBlock 的位置与序号。
 *
 * @param editor - Tiptap Editor
 * @param blockId - rootBlock.attrs.id（稳定 UUID/前缀ID）
 */
export function locateRootBlockById(editor: Editor, blockId: string): RootBlockLocateResult | null {
  if (!blockId) return null;

  let currentIndex = 0;
  let found: RootBlockLocateResult | null = null;

  editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
    if (node.type.name !== 'rootBlock') {
      return true;
    }

    currentIndex += 1;
    const id = node.attrs && typeof node.attrs.id === 'string' ? node.attrs.id : '';
    if (id === blockId) {
      found = { pos, index: currentIndex, blockId };
      return false;
    }
    return true;
  });

  return found;
}

/**
 * 构建 blockId -> 1-based 序号 的映射表，用于把 ref 渲染成“第N段”。
 *
 * @param editor - Tiptap Editor
 */
export function buildRootBlockIndexMap(editor: Editor): Map<string, number> {
  const map = new Map<string, number>();
  let currentIndex = 0;

  editor.state.doc.descendants((node: ProseMirrorNode) => {
    if (node.type.name !== 'rootBlock') {
      return true;
    }

    currentIndex += 1;
    const id = node.attrs && typeof node.attrs.id === 'string' ? node.attrs.id : '';
    if (id) {
      map.set(id, currentIndex);
    }
    return true;
  });

  return map;
}

export interface NavigateToRootBlockOptions
  extends Pick<ScrollToBlockOptions, 'scrollBehavior' | 'scrollBlock' | 'timeoutMs'> {
  /**
   * 滚动行为：
   * - auto：瞬移（更确定，避免“远近不一致”让用户误判）
   * - smooth：平滑滚动（体验更柔和，但远距离可能更慢）
   */
  scrollBehavior?: ScrollBehavior;
  /**
   * 滚动对齐方式：默认 start（把目标段落顶到视口顶部）
   */
  scrollBlock?: ScrollLogicalPosition;
}

/**
 * 按 blockId 跳转到 rootBlock：
 * - 触发 rootBlock 的块级选中（NodeSelection），使编辑器自身高亮可见
 * - 滚动到目标块顶部（尽量与目录点击的体验一致）
 *
 * @returns 是否成功定位并执行跳转
 */
export async function navigateToRootBlockById(
  editor: Editor,
  blockId: string,
  options: NavigateToRootBlockOptions = {}
): Promise<boolean> {
  // 中文说明：统一委托给 RenderVirtualization 的跳转协议。普通文档会走 hydrated 快路径；
  // placeholder 大文档会先 hydrate 目标块，再滚动和选中，避免二次跳动或 selection 落入不可编辑占位块。
  const result = await scrollEditorToBlock(editor, blockId, {
    scrollBehavior: options.scrollBehavior ?? 'auto',
    scrollBlock: options.scrollBlock ?? 'start',
    timeoutMs: options.timeoutMs,
    select: 'node',
  });

  return result.ok;
}

/**
 * 在 DOM 层对指定块做“闪烁高亮”，强化用户的定位感知。
 *
 * 说明：
 * - 我们复用批注的实现方式：通过 .root-block-outer[data-id="..."] 添加 class
 * - 视觉样式由 Block.css 中的 .ai-ref-highlight-block 统一控制
 */
export function flashHighlightRootBlockOuter(
  blockId: string,
  options: { className?: string; durationMs?: number } = {}
): void {
  const { className = 'ai-ref-highlight-block', durationMs = 650 } = options;
  if (!blockId) return;

  const el = document.querySelector(`.root-block-outer[data-id="${blockId}"]`);
  if (!(el instanceof HTMLElement)) return;

  el.classList.add(className);
  window.setTimeout(() => {
    el.classList.remove(className);
  }, durationMs);
}

