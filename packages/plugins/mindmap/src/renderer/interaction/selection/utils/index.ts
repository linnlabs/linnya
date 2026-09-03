import { on, off, simplifyEvent } from './events'
import {
  arrayify,
  css,
  domRect,
  frames,
  intersects,
  isSafariBrowser,
  isTouchDevice,
  matchesTrigger,
  selectAll,
  type Frames,
  type SelectAllSelectors,
  type Intersection,
  type Trigger,
} from './helpers'

export type { Frames, SelectAllSelectors, Intersection, Trigger }
export const selectionEvents = { on, off, simplifyEvent }
export const selectionBrowser = { isSafariBrowser, isTouchDevice }
export const selectionGeometry = { domRect, intersects }
export const selectionHelpers = { selectAll, matchesTrigger, css, frames, arrayify }
