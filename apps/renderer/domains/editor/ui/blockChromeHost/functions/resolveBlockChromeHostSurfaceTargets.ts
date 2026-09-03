import type { RootBlockRuntimeHandle } from '../../../features/RenderVirtualization';
import type {
  BlockChromeRenderPlan,
  BlockChromeSurface,
} from '../definitions/blockChromeRenderPlan';
import { resolveBlockChromeRenderTargets } from './resolveBlockChromeRenderTargets';
import { ROOT_BLOCK_DOM_CLASSES } from '../../../shared/rootBlockDomContract';

export type BlockChromeHostSurfaceTarget =
  | {
    kind: 'left-handle';
    key: string;
    blockId: string;
    mountElement: HTMLElement;
  }
  | {
    kind: 'annotation-handle';
    key: string;
    blockId: string;
    mountElement: HTMLElement;
    rootBlockOuterElement: HTMLElement | null;
  }
  | {
    kind: 'revision-indicator';
    key: string;
    blockId: string;
    mountElement: HTMLElement;
  }
  | {
    kind: 'revision-toolbar';
    key: string;
    blockId: string;
    mountElement: HTMLElement;
  }
  | {
    kind: 'history-panel';
    key: string;
    blockId: string;
    mountElement: HTMLElement;
    rootBlockElement: HTMLElement;
    getRootBlockPos: () => number | null;
  };

export interface ResolveBlockChromeHostSurfaceTargetsInput {
  shouldRender: boolean;
  renderPlans: readonly BlockChromeRenderPlan[];
  hydratedRevisionIndicatorBlockIds: readonly string[];
  getRuntimeHandle: (blockId: string) => RootBlockRuntimeHandle | null;
}

const mountElementIds = new WeakMap<HTMLElement, number>();
let nextMountElementId = 1;

function filterPlansBySurface(
  plans: readonly BlockChromeRenderPlan[],
  surface: BlockChromeSurface
): BlockChromeRenderPlan[] {
  return plans.filter((plan) => plan.surfaces.includes(surface));
}

function readMountElementId(element: HTMLElement): number {
  const existingId = mountElementIds.get(element);
  if (existingId !== undefined) return existingId;

  const nextId = nextMountElementId;
  nextMountElementId += 1;
  mountElementIds.set(element, nextId);
  return nextId;
}

function createSurfaceKey(
  kind: BlockChromeHostSurfaceTarget['kind'],
  blockId: string,
  mountElement: HTMLElement
): string {
  return `${kind}:${blockId}:mount-${readMountElementId(mountElement)}`;
}

function resolveRootBlockElement(anchorElement: HTMLElement): HTMLElement | null {
  const rootBlockElement = anchorElement.closest(`.${ROOT_BLOCK_DOM_CLASSES.body}`);
  return rootBlockElement instanceof HTMLElement ? rootBlockElement : null;
}

function resolveRootBlockOuterElement(rootBlockElement: HTMLElement): HTMLElement | null {
  const rootBlockOuterElement = rootBlockElement.closest(`.${ROOT_BLOCK_DOM_CLASSES.outer}`);
  return rootBlockOuterElement instanceof HTMLElement ? rootBlockOuterElement : null;
}

/**
 * 把 Host 的 render plan 与 runtime handle 合成为可渲染 surface。
 *
 * 中文说明：
 * - Host 组件只负责订阅响应式来源和渲染分发；
 * - surface 级 DOM 定位规则集中在这里，避免每新增一个 surface 就在 Vue 组件里复制一套 computed；
 * - 修订状态行是 pending header 语义，不属于 active chrome plan，因此独立接收 hydrated blockIds。
 */
export function resolveBlockChromeHostSurfaceTargets(
  input: ResolveBlockChromeHostSurfaceTargetsInput
): BlockChromeHostSurfaceTarget[] {
  if (!input.shouldRender) return [];

  const leftHandleTargets = resolveBlockChromeRenderTargets({
    plans: filterPlansBySurface(input.renderPlans, 'left-handle'),
    getRuntimeHandle: input.getRuntimeHandle,
  }).flatMap((target): BlockChromeHostSurfaceTarget[] => {
    return [{
      kind: 'left-handle',
      key: createSurfaceKey('left-handle', target.plan.blockId, target.anchorElement),
      blockId: target.plan.blockId,
      mountElement: target.anchorElement,
    }];
  });

  const annotationHandleTargets = resolveBlockChromeRenderTargets({
    plans: filterPlansBySurface(input.renderPlans, 'annotation-handle'),
    getRuntimeHandle: input.getRuntimeHandle,
  }).flatMap((target): BlockChromeHostSurfaceTarget[] => {
    const mountElement = resolveRootBlockElement(target.anchorElement);
    if (!mountElement) return [];

    return [{
      kind: 'annotation-handle',
      key: createSurfaceKey('annotation-handle', target.plan.blockId, mountElement),
      blockId: target.plan.blockId,
      mountElement,
      rootBlockOuterElement: resolveRootBlockOuterElement(mountElement),
    }];
  });

  const revisionIndicatorTargets = input.hydratedRevisionIndicatorBlockIds
    .flatMap((blockId): BlockChromeHostSurfaceTarget[] => {
      const mountElement = input.getRuntimeHandle(blockId)?.getRevisionHeaderMount?.() ?? null;
      if (!mountElement) return [];

      return [{
        kind: 'revision-indicator',
        key: createSurfaceKey('revision-indicator', blockId, mountElement),
        blockId,
        mountElement,
      }];
    });

  const revisionToolbarTargets = resolveBlockChromeRenderTargets({
    plans: filterPlansBySurface(input.renderPlans, 'revision-toolbar'),
    getRuntimeHandle: input.getRuntimeHandle,
  }).flatMap((target): BlockChromeHostSurfaceTarget[] => {
    const mountElement = resolveRootBlockElement(target.anchorElement);
    if (!mountElement) return [];

    return [{
      kind: 'revision-toolbar',
      key: createSurfaceKey('revision-toolbar', target.plan.blockId, mountElement),
      blockId: target.plan.blockId,
      mountElement,
    }];
  });

  const historyPanelTargets = resolveBlockChromeRenderTargets({
    plans: filterPlansBySurface(input.renderPlans, 'history-panel'),
    getRuntimeHandle: input.getRuntimeHandle,
  }).flatMap((target): BlockChromeHostSurfaceTarget[] => {
    const rootBlockElement = resolveRootBlockElement(target.anchorElement);
    const runtimeHandle = input.getRuntimeHandle(target.plan.blockId);
    if (!rootBlockElement || !runtimeHandle) return [];

    return [{
      kind: 'history-panel',
      key: createSurfaceKey('history-panel', target.plan.blockId, rootBlockElement),
      blockId: target.plan.blockId,
      mountElement: rootBlockElement,
      rootBlockElement,
      getRootBlockPos: runtimeHandle.getPos,
    }];
  });

  return [
    ...leftHandleTargets,
    ...annotationHandleTargets,
    ...revisionIndicatorTargets,
    ...revisionToolbarTargets,
    ...historyPanelTargets,
  ];
}
