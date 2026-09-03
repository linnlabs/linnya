import {
  buildBlockMenuContextFromRootBlockId,
  type BlockMenuContextResolveFailureReason,
} from '../functions/buildBlockMenuContextFromRootBlockId';
import { blockActionMenuService } from '../service';
import type { BlockMenuContext } from '../types';

export type OpenBlockActionMenuMode = 'open' | 'toggle';

export type OpenBlockActionMenuFailureReason =
  | BlockMenuContextResolveFailureReason
  | 'open-failed';

export interface OpenBlockActionMenuForRootBlockIdInput {
  editor: BlockMenuContext['editor'];
  rootBlockId: string | null | undefined;
  anchorElement: HTMLElement;
  mode: OpenBlockActionMenuMode;
  hasAnnotations?: boolean;
}

export type OpenBlockActionMenuForRootBlockIdResult =
  | {
    ok: true;
    action: 'opened' | 'closed' | 'skipped';
    context?: BlockMenuContext;
  }
  | {
    ok: false;
    reason: OpenBlockActionMenuFailureReason;
    rootBlockId?: string;
    rootBlockPos?: number;
    nodeType?: string;
    error?: unknown;
  };

/**
 * 按 rootBlockId 打开或切换块操作菜单。
 *
 * 中文说明：这是 left-handle 菜单入口的 feature 编排层。UI 只提供
 * `blockId / anchorElement / mode`，这里负责从当前 doc 重建上下文并调用菜单服务。
 * 后续 BlockChromeHost 接管菜单入口时应复用这个函数，而不是重新拼 `BlockMenuContext`。
 */
export async function openBlockActionMenuForRootBlockId(
  input: OpenBlockActionMenuForRootBlockIdInput
): Promise<OpenBlockActionMenuForRootBlockIdResult> {
  const contextResult = buildBlockMenuContextFromRootBlockId({
    editor: input.editor,
    rootBlockId: input.rootBlockId,
    hasAnnotations: input.hasAnnotations,
  });

  if (!contextResult.ok) {
    return contextResult;
  }

  if (
    input.mode === 'toggle' &&
    blockActionMenuService.state.isOpen &&
    blockActionMenuService.state.anchorElement === input.anchorElement
  ) {
    blockActionMenuService.close();
    return {
      ok: true,
      action: 'closed',
      context: contextResult.context,
    };
  }

  try {
    await blockActionMenuService.open(contextResult.context, input.anchorElement);
  } catch (error) {
    return {
      ok: false,
      reason: 'open-failed',
      error,
    };
  }

  if (
    blockActionMenuService.state.isOpen &&
    blockActionMenuService.state.anchorElement === input.anchorElement
  ) {
    return {
      ok: true,
      action: 'opened',
      context: contextResult.context,
    };
  }

  return {
    ok: true,
    action: 'skipped',
    context: contextResult.context,
  };
}
