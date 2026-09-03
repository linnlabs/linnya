import { setAttributes, selectText } from '../dom'
import type { Arrow } from '../../../presentation/render/arrow'
import type { Summary } from '../../../presentation/render/summary'
import type { MindMapInstance } from '../../../domain/types/index'
import type { CustomSvg } from '../../../domain/types/dom'
import { MINDMAP_RENDER_COLORS } from '../../../domain/constants'

const $d = document
export const svgNS = 'http://www.w3.org/2000/svg'

export interface SvgTextOptions {
  anchor?: 'start' | 'middle' | 'end'
  color?: string
  dataType: string
  svgId: string // Associated SVG element ID
}

/**
 * Create a div label for SVG elements with positioning
 */
// Helper function to calculate precise position based on actual DOM dimensions
export const calculatePrecisePosition = function (element: HTMLElement): void {
  // Get actual dimensions
  const actualWidth = element.clientWidth
  const actualHeight = element.clientHeight
  const data = element.dataset
  const x = Number(data.x)
  const y = Number(data.y)
  const anchor = data.anchor

  // Calculate position based on anchor and actual dimensions
  let adjustedX = x
  if (anchor === 'middle') {
    adjustedX = x - actualWidth / 2
  } else if (anchor === 'end') {
    adjustedX = x - actualWidth
  }

  // Set final position with actual dimensions
  element.style.left = `${adjustedX}px`
  element.style.top = `${y - actualHeight / 2}px`
  element.style.visibility = 'visible'
}

export const createLabel = function (text: string, x: number, y: number, options: SvgTextOptions): HTMLDivElement {
  const { anchor = 'middle', color, dataType, svgId } = options

  // Create label div element
  const labelDiv = document.createElement('div')
  labelDiv.className = 'svg-label'
  labelDiv.style.color = color || MINDMAP_RENDER_COLORS.svgLabel

  // Generate unique ID for the label
  const labelId = 'label-' + svgId
  labelDiv.id = labelId
  labelDiv.innerHTML = text

  labelDiv.dataset.type = dataType
  labelDiv.dataset.svgId = svgId
  labelDiv.dataset.x = x.toString()
  labelDiv.dataset.y = y.toString()
  labelDiv.dataset.anchor = anchor

  return labelDiv
}

/**
 * Find SVG element by label ID
 */
export const findSvgByLabelId = function (labelId: string): SVGElement | null {
  const labelEl = document.getElementById(labelId) as HTMLElement
  if (!labelEl || !labelEl.dataset.svgId) {
    return null
  }
  const svgElement = document.getElementById(labelEl.dataset.svgId)
  return svgElement as unknown as SVGElement
}

/**
 * Find label element by SVG ID
 */
export const findLabelBySvgId = function (svgId: string): HTMLDivElement | null {
  const labelEl = document.querySelector(`[data-svg-id="${svgId}"]`) as HTMLDivElement
  return labelEl
}

export const createPath = function (d: string, color: string, width: string) {
  const path = $d.createElementNS(svgNS, 'path')
  setAttributes(path, {
    d,
    stroke: color || MINDMAP_RENDER_COLORS.svgPathStroke,
    fill: 'none',
    'stroke-width': width,
  })
  return path
}

export const createLinkSvg = function (klass: string) {
  const svg = $d.createElementNS(svgNS, 'svg')
  svg.setAttribute('class', klass)
  svg.setAttribute('overflow', 'visible')
  return svg
}

export const createLine = function () {
  const line = $d.createElementNS(svgNS, 'line')
  line.setAttribute('stroke', MINDMAP_RENDER_COLORS.linkControllerStroke)
  line.setAttribute('fill', 'none')
  line.setAttribute('stroke-width', '2')
  line.setAttribute('opacity', '0.45')
  return line
}

export const createArrowGroup = function (
  d: string,
  arrowd1: string,
  arrowd2: string,
  style?: {
    stroke?: string
    strokeWidth?: string | number
    strokeDasharray?: string
    strokeLinecap?: 'butt' | 'round' | 'square'
    opacity?: string | number
  }
): CustomSvg {
  const g = $d.createElementNS(svgNS, 'g') as CustomSvg
  const svgs = [
    {
      name: 'line',
      d,
    },
    {
      name: 'arrow1',
      d: arrowd1,
    },
    {
      name: 'arrow2',
      d: arrowd2,
    },
  ] as const
  svgs.forEach((item, i) => {
    const d = item.d
    const path = $d.createElementNS(svgNS, 'path')
    const attrs: { [key: string]: string } = {
      d,
      stroke: style?.stroke || MINDMAP_RENDER_COLORS.arrowStroke,
      fill: 'none',
      'stroke-linecap': style?.strokeLinecap || 'cap',
      'stroke-width': String(style?.strokeWidth || '2'),
    }

    if (style?.opacity !== undefined) {
      attrs['opacity'] = String(style.opacity)
    }

    setAttributes(path, attrs)

    if (i === 0) {
      // Apply stroke-dasharray to the main line
      path.setAttribute('stroke-dasharray', style?.strokeDasharray || '8,2')
    }

    const hotzone = $d.createElementNS(svgNS, 'path')
    const hotzoneAttrs = {
      d,
      stroke: 'transparent',
      fill: 'none',
      'stroke-width': '15',
    }
    setAttributes(hotzone, hotzoneAttrs)
    g.appendChild(hotzone)

    g.appendChild(path)
    g[item.name] = path
  })
  return g
}

const SVG_LABEL_EDITOR_CLASS = 'svg-label-editor'

export const editSvgText = function (mind: MindMapInstance, textEl: HTMLDivElement, node: Summary | Arrow) {
  if (!textEl) return

  // textEl is now a div element directly
  const origin = node.label

  const div = textEl.cloneNode(true) as HTMLDivElement
  div.classList.add(SVG_LABEL_EDITOR_CLASS)
  mind.nodes.appendChild(div)
  div.textContent = origin
  div.contentEditable = 'plaintext-only'
  div.spellcheck = false

  div.style.cssText = `
    left:${textEl.style.left};
    top:${textEl.style.top}; 
    max-width: 200px;
  `
  selectText(div)
  mind.scrollIntoView(div)

  div.addEventListener('keydown', e => {
    e.stopPropagation()
    const key = e.key

    if (key === 'Enter' || key === 'Tab') {
      // keep wrap for shift enter
      if (e.shiftKey) return

      e.preventDefault()
      div.blur()
      mind.container.focus()
    }
  })

  div.addEventListener('blur', () => {
    if (!div) return
    const text = div.textContent?.trim() || ''
    if (text === '') node.label = origin
    else node.label = text
    div.remove()
    if (text === origin) return

    if (mind.markdown) {
      ;(textEl as HTMLDivElement).innerHTML = mind.markdown(node.label, node)
    } else {
      textEl.textContent = node.label
    }
    // Recalculate position with new content while preserving existing color
    calculatePrecisePosition(textEl)

    if ('parent' in node) {
      mind.bus.fire('operation', {
        name: 'finishEditSummary',
        obj: node,
      })
    } else {
      mind.bus.fire('operation', {
        name: 'finishEditArrowLabel',
        obj: node,
      })
    }
  })
}

export function getArrowPoints(p3x: number, p3y: number, p4x: number, p4y: number) {
  const deltay = p4y - p3y
  const deltax = p3x - p4x
  let angle = (Math.atan(Math.abs(deltay) / Math.abs(deltax)) / 3.14) * 180
  if (isNaN(angle)) return
  if (deltax < 0 && deltay > 0) {
    angle = 180 - angle
  }
  if (deltax < 0 && deltay < 0) {
    angle = 180 + angle
  }
  if (deltax > 0 && deltay < 0) {
    angle = 360 - angle
  }
  const arrowLength = 12
  const arrowAngle = 30
  const a1 = angle + arrowAngle
  const a2 = angle - arrowAngle
  return {
    x1: p4x + Math.cos((Math.PI * a1) / 180) * arrowLength,
    y1: p4y - Math.sin((Math.PI * a1) / 180) * arrowLength,
    x2: p4x + Math.cos((Math.PI * a2) / 180) * arrowLength,
    y2: p4y - Math.sin((Math.PI * a2) / 180) * arrowLength,
  }
}
