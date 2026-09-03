// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  ROOT_BLOCK_DOM_ATTRS,
  ROOT_BLOCK_DOM_CLASSES,
  ROOT_BLOCK_DOM_NODE_TYPES,
  ROOT_BLOCK_OUTER_SELECTOR,
  ROOT_BLOCK_PLACEHOLDER_SELECTOR,
  applyRootBlockColorStyle,
  clearRootBlockContentClasses,
  createHydratedRootBlockDomShellElements,
  getRootBlockContentClass,
  resolveRootBlockColorStyle,
} from './rootBlockDomContract'

describe('rootBlockDomContract', () => {
  it('defines the canonical rootBlock selectors', () => {
    expect(ROOT_BLOCK_OUTER_SELECTOR).toBe('.root-block-outer[data-id]')
    expect(ROOT_BLOCK_PLACEHOLDER_SELECTOR).toBe(
      '.root-block-outer.root-block-virtual-placeholder[data-id]'
    )
  })

  it('creates the hydrated rootBlock DOM shell used by native NodeViews', () => {
    const shell = createHydratedRootBlockDomShellElements()

    expect(shell.dom.className).toBe(ROOT_BLOCK_DOM_CLASSES.outer)
    expect(shell.rootBlockEl.className).toBe(ROOT_BLOCK_DOM_CLASSES.body)
    expect(shell.rootBlockEl.getAttribute(ROOT_BLOCK_DOM_ATTRS.nodeType)).toBe(
      ROOT_BLOCK_DOM_NODE_TYPES.body
    )
    expect(shell.chromeAnchorEl.className).toBe(ROOT_BLOCK_DOM_CLASSES.chromeAnchor)
    expect(shell.chromeAnchorEl.getAttribute(ROOT_BLOCK_DOM_ATTRS.chromeAnchor)).toBe('true')
    expect(shell.revisionHeaderEl.className).toBe(ROOT_BLOCK_DOM_CLASSES.revisionHeader)
    expect(shell.revisionHeaderEl.getAttribute(ROOT_BLOCK_DOM_ATTRS.revisionHeaderMount)).toBe('true')
    expect(shell.contentDOM.className).toBe(ROOT_BLOCK_DOM_CLASSES.content)
    expect(shell.historyMountEl.getAttribute(ROOT_BLOCK_DOM_ATTRS.historyMount)).toBe('true')
    expect(shell.dom.firstElementChild).toBe(shell.rootBlockEl)
    expect(Array.from(shell.rootBlockEl.children)).toEqual([
      shell.chromeAnchorEl,
      shell.revisionHeaderEl,
      shell.contentDOM,
      shell.historyMountEl,
    ])
  })

  it('maps rootBlock color attrs to CSS variables', () => {
    expect(resolveRootBlockColorStyle({
      backgroundColor: 'yellow_bg',
      textColor: 'green_text',
    })).toEqual({
      backgroundColor: 'var(--block-bg-yellow)',
      color: 'var(--block-text-green)',
    })

    const el = document.createElement('div')
    applyRootBlockColorStyle(el, {
      backgroundColor: 'blue_bg',
      textColor: 'red_text',
    })
    expect(el.style.getPropertyValue('background-color')).toBe('var(--block-bg-blue)')
    expect(el.style.getPropertyValue('color')).toBe('var(--block-text-red)')

    applyRootBlockColorStyle(el, {})
    expect(el.style.getPropertyValue('background-color')).toBe('')
    expect(el.style.getPropertyValue('color')).toBe('')
  })

  it('normalizes content type classes', () => {
    const el = document.createElement('div')
    el.classList.add('root-block-outer', 'contains-baseBlock', 'contains-headingBlock')

    expect(getRootBlockContentClass('tableBlock')).toBe('contains-tableBlock')
    expect(getRootBlockContentClass(null)).toBe('')

    clearRootBlockContentClasses(el)
    expect(Array.from(el.classList)).toEqual(['root-block-outer'])
  })
})
