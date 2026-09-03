// --- Array Helpers ----------------------------------------------------------

// Turns a value into an array if it's not already an array
export const arrayify = <T>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value])

export const isTouchDevice = (): boolean => matchMedia('(hover: none), (pointer: coarse)').matches

// Determines if the browser is Safari
export const isSafariBrowser = (): boolean => 'safari' in window

// --- CSS Helpers -------------------------------------------------------------

const unitify = (val: string | number, unit = 'px'): string => {
  return typeof val === 'number' ? `${val}${unit}` : val
}

/**
 * Add CSS to a DOM-Element or returns the current value of a property.
 * @param el The Element.
 * @param attr The attribute or an object which holds css key-properties.
 * @param val The value for a single attribute.
 */
export const css = (
  { style }: HTMLElement,
  attr: Partial<Record<keyof CSSStyleDeclaration, string | number>> | string,
  val?: string | number
): void => {
  if (typeof attr === 'object') {
    for (const [key, value] of Object.entries(attr)) {
      if (value !== undefined) {
        style.setProperty(key, unitify(value))
      }
    }
  } else if (val !== undefined) {
    style.setProperty(attr, unitify(val))
  }
}

// --- Geometry Helpers -------------------------------------------------------

// Polyfill for DOMRect as happy-dom and jsdom don't support it
export const domRect = (x = 0, y = 0, width = 0, height = 0): DOMRect => {
  if (typeof DOMRect === 'function') {
    return new DOMRect(x, y, width, height)
  }

  const rect = { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height }
  const toJSON = () => JSON.stringify(rect)
  return { ...rect, toJSON }
}

type AnyFunction = (...args: any[]) => void

export interface Frames<F extends AnyFunction = AnyFunction> {
  next(...args: Parameters<F>): void
  cancel(): void
}

export const frames = <F extends AnyFunction>(fn: F): Frames<F> => {
  let previousArgs: Parameters<F>
  let frameId = -1
  let lock = false

  return {
    next: (...args: Parameters<F>): void => {
      previousArgs = args

      if (!lock) {
        lock = true
        frameId = requestAnimationFrame(() => {
          fn(...previousArgs)
          lock = false
        })
      }
    },
    cancel: () => {
      cancelAnimationFrame(frameId)
      lock = false
    },
  }
}

export type Intersection = 'center' | 'cover' | 'touch'

/**
 * Check if two DOM-Elements intersect each other.
 */
export const intersects = (a: DOMRect, b: DOMRect, mode: Intersection = 'touch'): boolean => {
  switch (mode) {
    case 'center': {
      const bxc = b.left + b.width / 2
      const byc = b.top + b.height / 2

      return bxc >= a.left && bxc <= a.right && byc >= a.top && byc <= a.bottom
    }
    case 'cover':
      return b.left >= a.left && b.top >= a.top && b.right <= a.right && b.bottom <= a.bottom
    case 'touch':
    default:
      return a.right >= b.left && a.left <= b.right && a.bottom >= b.top && a.top <= b.bottom
  }
}

// --- Trigger Helpers --------------------------------------------------------

// https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/button#value
export type MouseButton =
  | 0 // Main
  | 1 // Auxiliary
  | 2 // Secondary
  | 3 // Fourth
  | 4 // Fifth

export type Modifier = 'ctrl' | 'alt' | 'shift'

export type MouseButtonWithModifiers = {
  button: MouseButton
  modifiers: Modifier[]
}

export type Trigger = MouseButton | MouseButtonWithModifiers

/**
 * Determines whether a MouseEvent should execute until completion depending on
 * which button and modifier(s) are active for the MouseEvent.
 * The Event will execute to completion if ANY of the triggers "matches"
 */
export const matchesTrigger = (event: MouseEvent, triggers: Trigger[]): boolean =>
  triggers.some(trigger => {
    // The trigger requires only a specific button to be pressed
    if (typeof trigger === 'number') {
      return event.button === trigger
    }

    // The trigger requires a specific button to be pressed AND some modifiers
    if (typeof trigger === 'object') {
      if (trigger.button !== event.button) {
        return false
      }

      return trigger.modifiers.every(modifier => {
        switch (modifier) {
          case 'alt':
            return event.altKey
          case 'ctrl':
            return event.ctrlKey || event.metaKey
          case 'shift':
            return event.shiftKey
        }
      })
    }

    return false
  })

// --- Selection Helpers ------------------------------------------------------

export type SelectAllSelectors = (string | Element)[] | string | Element

/**
 * Takes a selector (or array of selectors) and returns the matched nodes.
 * @param selector The selector or an Array of selectors.
 * @param doc
 * @returns {Array} Array of DOM-Nodes.
 */
export const selectAll = (selector: SelectAllSelectors, doc: Document = document): Element[] =>
  arrayify(selector)
    .map(item =>
      typeof item === 'string'
        ? Array.from(doc.querySelectorAll(item))
        : item instanceof Element
          ? item
          : null
    )
    .flat()
    .filter(Boolean) as Element[]

