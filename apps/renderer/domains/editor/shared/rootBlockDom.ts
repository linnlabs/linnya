import { ROOT_BLOCK_OUTER_SELECTOR } from './rootBlockDomContract'

export function findClosestRootBlockOuter(target: Element | null): HTMLElement | null {
  if (!target) return null
  const rootBlock = target.closest(ROOT_BLOCK_OUTER_SELECTOR)
  return rootBlock instanceof HTMLElement ? rootBlock : null
}

export function readRootBlockIdFromElement(target: Element | null): string | null {
  const rootBlock = findClosestRootBlockOuter(target)
  const blockId = rootBlock?.dataset.id?.trim()
  return blockId ? blockId : null
}

export function readRootBlockIdFromEventTarget(target: EventTarget | null): string | null {
  return target instanceof Element ? readRootBlockIdFromElement(target) : null
}
