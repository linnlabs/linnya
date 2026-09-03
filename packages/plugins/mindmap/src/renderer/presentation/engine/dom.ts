import type { MindMapInstance, Theme } from '../../domain/types/index'
import { createLinkSvg, createLine } from '../../shared/utils/svg/index'
import { resolveMindMapTheme } from '../../shared/utils/theme'

const $d = document

const isHTMLElement = (target: unknown): target is HTMLElement => target instanceof HTMLElement

export const resolveElement = (target: string | HTMLElement, message: string) => {
  if (isHTMLElement(target)) return target
  const element = document.querySelector(target)
  if (element && isHTMLElement(element)) return element
  throw new Error(message)
}

export const resolveOptionalElement = (
  target: string | HTMLElement | undefined,
  message: string
): HTMLElement | null => {
  if (!target) return null
  return resolveElement(target, message)
}

export const resolveTheme = (theme?: Theme) => {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  return resolveMindMapTheme(theme, mediaQuery.matches)
}

export const createDomStructure = (mind: MindMapInstance, selectionContainer?: HTMLElement | null) => {
  const container = $d.createElement('div')
  container.className = 'map-container'
  container.setAttribute('tabindex', '0')

  const map = $d.createElement('div')
  map.className = 'map-canvas'
  container.appendChild(map)
  mind.el.appendChild(container)

  const nodes = $d.createElement('me-nodes')
  const lines = createLinkSvg('lines')
  const summarySvg = createLinkSvg('summary')
  const linkController = createLinkSvg('linkcontroller')
  const linkSvgGroup = createLinkSvg('topiclinks')

  const P2 = $d.createElement('div')
  const P3 = $d.createElement('div')
  P2.className = P3.className = 'circle'
  P2.style.display = P3.style.display = 'none'

  const line1 = createLine()
  const line2 = createLine()
  linkController.appendChild(line1)
  linkController.appendChild(line2)

  const labelContainer = $d.createElement('div')
  labelContainer.className = 'label-container'

  mind.container = container
  mind.map = map
  mind.nodes = nodes
  mind.lines = lines
  mind.summarySvg = summarySvg
  mind.linkController = linkController
  mind.linkSvgGroup = linkSvgGroup
  mind.P2 = P2
  mind.P3 = P3
  mind.line1 = line1
  mind.line2 = line2
  mind.labelContainer = labelContainer
  mind.selectionContainer = selectionContainer ?? container

  mind.map.appendChild(mind.nodes)
}
