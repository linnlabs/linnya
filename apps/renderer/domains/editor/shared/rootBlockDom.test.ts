// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  findClosestRootBlockOuter,
  readRootBlockIdFromElement,
  readRootBlockIdFromEventTarget,
} from './rootBlockDom'

describe('rootBlockDom', () => {
  it('reads the closest root block id from nested elements', () => {
    const rootBlock = document.createElement('div')
    rootBlock.className = 'root-block-outer'
    rootBlock.dataset.id = 'root-a'
    const child = document.createElement('span')
    rootBlock.appendChild(child)
    document.body.appendChild(rootBlock)

    expect(findClosestRootBlockOuter(child)).toBe(rootBlock)
    expect(readRootBlockIdFromElement(child)).toBe('root-a')
    expect(readRootBlockIdFromEventTarget(child)).toBe('root-a')

    rootBlock.remove()
  })

  it('ignores empty or missing root block ids', () => {
    const rootBlock = document.createElement('div')
    rootBlock.className = 'root-block-outer'
    rootBlock.dataset.id = '   '
    const child = document.createElement('span')
    rootBlock.appendChild(child)

    expect(readRootBlockIdFromElement(child)).toBeNull()
    expect(readRootBlockIdFromEventTarget({} as EventTarget)).toBeNull()
  })
})
