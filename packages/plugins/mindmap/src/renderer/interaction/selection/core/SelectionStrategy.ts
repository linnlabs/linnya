import type { SelectAllSelectors } from '../utils'

export interface StrategyContext {
  selection: Element[]
  selectables: Element[]
  latestElement?: Element
}

export interface StrategyResult {
  toSelect: Element[]
  toDeselect: Element[]
  newLatest?: Element
}

export class SelectionStrategy {
  static resolveClick(
    target: Element,
    evt: MouseEvent | TouchEvent,
    context: StrategyContext,
    options: { range: boolean }
  ): StrategyResult {
    const { selection, selectables, latestElement } = context
    const { range } = options
    
    const result: StrategyResult = {
      toSelect: [],
      toDeselect: [],
      newLatest: undefined
    }

    // Shift + Click (Range Selection)
    if (evt.shiftKey && range && latestElement) {
      const reference = latestElement
      
      // Resolve the correct range
      // Use bitwise comparison to check order
      const [preceding, following] = reference.compareDocumentPosition(target) & 4 
        ? [target, reference] 
        : [reference, target]

      const rangeItems = [
        ...selectables.filter(el => 
          el.compareDocumentPosition(preceding) & 4 && 
          el.compareDocumentPosition(following) & 2
        ),
        preceding,
        following,
      ]

      result.toSelect = rangeItems
      result.newLatest = reference // Keep reference or update? 
      // In original code: this._latestElement = reference (line 289)
    } 
    // Ctrl/Cmd + Click (Multi Selection) or existing selection toggle
    else if (
        selection.includes(target) && 
        (selection.length === 1 || evt.ctrlKey || evt.metaKey || selection.every(v => selection.includes(v)))
    ) {
       result.toDeselect = [target]
    } 
    // Single Click (Replace Selection)
    else {
      result.toSelect = [target]
      result.newLatest = target
    }

    return result
  }
  
  static getSelectableFromTarget(
      target: Element, 
      selectables: Element[]
  ): Element | undefined {
      let current: Element | null = target
      while (current && !selectables.includes(current)) {
          current = current.parentElement
      }
      return current || undefined
  }
}

