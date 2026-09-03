import type { SelectionOptions, SelectionStore } from './types'
import { selectionGeometry, selectionHelpers } from '../utils'

const { intersects } = selectionGeometry
const { selectAll } = selectionHelpers

type Ctx = {
  getOptions: () => SelectionOptions
  getSelectionStore: () => SelectionStore
  getSelectables: () => Element[]
  getLatestElement: () => Element | undefined
  setLatestElement: (el?: Element) => void
}

/**
 * 选择状态与集合操作的专职管理者，避免 SelectionEngine 本体过重。
 * 负责：select/deselect/keepSelection 以及基于区域的选中计算。
 */
export default class SelectionStoreManager {
  private readonly ctx: Ctx

  constructor(ctx: Ctx) {
    this.ctx = ctx
  }

  updateElementSelection(areaRect: DOMRect): void {
    const selection = this.ctx.getSelectionStore()
    const { stored, selected, touched } = selection
    const selectables = this.ctx.getSelectables()
    const { intersect, overlap } = this.ctx.getOptions().behaviour

    const invert = overlap === 'invert'
    const newlyTouched: Element[] = []
    const added: Element[] = []
    const removed: Element[] = []

    for (let i = 0; i < selectables.length; i++) {
      const node = selectables[i]

      if (intersects(areaRect, node.getBoundingClientRect(), intersect)) {
        if (!selected.includes(node)) {
          if (invert && stored.includes(node)) {
            removed.push(node)
            continue
          } else {
            added.push(node)
          }
        } else if (stored.includes(node) && !touched.includes(node)) {
          touched.push(node)
        }

        newlyTouched.push(node)
      }
    }

    if (invert) {
      added.push(...stored.filter(v => !selected.includes(v)))
    }

    const keep = overlap === 'keep'
    for (let i = 0; i < selected.length; i++) {
      const node = selected[i]

      if (!newlyTouched.includes(node) && !(keep && stored.includes(node))) {
        removed.push(node)
      }
    }

    selection.selected = newlyTouched
    selection.changed = { added, removed }

    // 防止 range 选择依赖的 latestElement 残留
    this.ctx.setLatestElement(undefined)
  }

  keepSelection(): void {
    const selection = this.ctx.getSelectionStore()
    const { selected, changed, touched, stored } = selection
    const { overlap } = this.ctx.getOptions().behaviour
    const addedElements = selected.filter(el => !stored.includes(el))

    switch (overlap) {
      case 'drop': {
        selection.stored = [
          ...addedElements,
          ...stored.filter(el => !touched.includes(el)),
        ]
        break
      }
      case 'invert': {
        selection.stored = [
          ...addedElements,
          ...stored.filter(el => !changed.removed.includes(el)),
        ]
        break
      }
      case 'keep': {
        selection.stored = [
          ...stored,
          ...selected.filter(el => !stored.includes(el)),
        ]
        break
      }
    }
  }

  select(
    query: Parameters<typeof selectAll>[0],
    document: Document,
    quiet = false,
    emit: (name: 'move' | 'stop', evt: MouseEvent | TouchEvent | null) => void
  ): Element[] {
    const selection = this.ctx.getSelectionStore()
    const { changed, selected, stored } = selection
    const elements = selectAll(query, document).filter(el => !selected.includes(el) && !stored.includes(el))

    stored.push(...elements)
    selected.push(...elements)
    changed.added.push(...elements)
    changed.removed = []

    this.ctx.setLatestElement(undefined)

    if (!quiet) {
      emit('move', null)
      emit('stop', null)
    }

    return elements
  }

  deselect(
    query: Parameters<typeof selectAll>[0],
    document: Document,
    quiet = false,
    emit: (name: 'move' | 'stop', evt: MouseEvent | TouchEvent | null) => void
  ): void {
    const selection = this.ctx.getSelectionStore()
    const { selected, stored, changed } = selection

    const elements = selectAll(query, document).filter(el => selected.includes(el) || stored.includes(el))

    selection.stored = stored.filter(el => !elements.includes(el))
    selection.selected = selected.filter(el => !elements.includes(el))
    selection.changed.added = []
    selection.changed.removed.push(...elements.filter(el => !changed.removed.includes(el)))

    this.ctx.setLatestElement(undefined)

    if (!quiet) {
      emit('move', null)
      emit('stop', null)
    }
  }
}
