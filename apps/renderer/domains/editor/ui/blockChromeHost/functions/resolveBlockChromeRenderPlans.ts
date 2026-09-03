import type { ActiveChromeBlock } from '../definitions/activeChromeBlocks';
import type { BlockChromeRenderPlan, BlockChromeSurface } from '../definitions/blockChromeRenderPlan';

function hasSource(block: ActiveChromeBlock, source: string): boolean {
  return block.sources.some((candidate) => candidate === source);
}

function resolveSurfaces(block: ActiveChromeBlock): BlockChromeSurface[] {
  const surfaces: BlockChromeSurface[] = [
    'left-handle',
    'annotation-handle',
  ];

  if (hasSource(block, 'revision-toolbar')) {
    surfaces.push('revision-toolbar');
  }

  if (hasSource(block, 'history-mode')) {
    surfaces.push('history-panel');
  }

  return surfaces;
}

/**
 * 将 active chrome block 转为 Host 当前可渲染的块级 chrome 计划。
 *
 * 中文说明：
 * - 这里仍然不读取 editor / node / DOM / feature store；
 * - 业务是否“真的有批注、修订、历史版本”由每个 surface 的 selector 决定；
 * - 当前计划只回答 Host 需要为哪些 block 准备哪些 UI 插槽，避免迁移时把旧 BlockChrome 大组件原样搬过来。
 */
export function resolveBlockChromeRenderPlans(params: {
  activeBlocks: readonly ActiveChromeBlock[];
  targetReadyBlockIds: ReadonlySet<string>;
}): BlockChromeRenderPlan[] {
  return params.activeBlocks.map((block) => ({
    blockId: block.blockId,
    sources: [...block.sources],
    surfaces: resolveSurfaces(block),
    targetReady: params.targetReadyBlockIds.has(block.blockId),
  }));
}
