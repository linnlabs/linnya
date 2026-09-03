import { createPath, createLinkSvg } from '../../shared/utils/svg/index'
import { getOffsetLT } from '../../shared/utils/index'
import type { Wrapper, Topic, Parent } from '../../domain/types/dom'
import type { DirectionClass, MindMapInstance } from '../../domain/types/index'
import { flickerLog } from '../../shared/utils/debug/flickerDebug'

/**
 * Link nodes with svg,
 * only link specific node if `mainNode` is present
 *
 * procedure:
 * 1. generate main link
 * 2. generate links inside main node, if `mainNode` is presented, only generate the link of the specific main node
 * 3. generate custom link
 * 4. generate summary
 * @param mainNode regenerate sublink of the specific main node
 */
const linkDiv = function (this: MindMapInstance, mainNode?: Wrapper) {
  const root = this.map.querySelector('mm-root') as HTMLElement
  const rootTopic = root.querySelector('mm-topic') as Topic
  const { offsetLeft: pL, offsetTop: pT } = getOffsetLT(this.nodes, rootTopic)
  const pW = rootTopic.offsetWidth
  const pH = rootTopic.offsetHeight

  const mainNodeList = this.map.querySelectorAll('mm-main > mm-wrapper')
  flickerLog('linkDiv start', {
    t: performance.now(),
    structureRevision: this.structureRevision,
    mainNodes: mainNodeList.length,
    linesBefore: this.lines?.childElementCount ?? null,
    labelsBefore: this.labelContainer?.childElementCount ?? null,
  })
  this.lines.innerHTML = ''

  for (let i = 0; i < mainNodeList.length; i++) {
    const el = mainNodeList[i] as Wrapper
    const tpc = el.querySelector<Topic>('mm-topic') as Topic
    const { offsetLeft: cL, offsetTop: cT } = getOffsetLT(this.nodes, tpc)
    const cW = tpc.offsetWidth
    const cH = tpc.offsetHeight
    const direction = el.parentNode.className as DirectionClass

    const mainPath = this.generateMainBranch({ pT, pL, pW, pH, cT, cL, cW, cH, direction, containerHeight: this.nodes.offsetHeight })
    const palette = this.theme.palette
    const branchColor = tpc.nodeObj.branchColor || palette[i % palette.length]
    tpc.style.borderColor = branchColor
    tpc.style.setProperty('--branch-color', branchColor)
    const parentNode = tpc.parentElement as Parent | null
    parentNode?.style.setProperty('--branch-color', branchColor)
    this.lines.appendChild(createPath(mainPath, branchColor, '3'))

    // generate link inside main node
    if (mainNode && mainNode !== el) {
      continue
    }

    const svg = createLinkSvg('subLines')
    // svg tag name is lower case
    const svgLine = el.lastChild as SVGSVGElement
    if (svgLine.tagName === 'svg') svgLine.remove()
    el.appendChild(svg)

    traverseChildren(this, svg, branchColor, el, direction, el)
  }

  this.labelContainer.innerHTML = ''
  this.renderArrow()
  this.renderSummary()
  this.bus.fire('linkDiv')
  flickerLog('linkDiv end', {
    t: performance.now(),
    structureRevision: this.structureRevision,
    linesAfter: this.lines?.childElementCount ?? null,
    labelsAfter: this.labelContainer?.childElementCount ?? null,
  })
}

// core function of generate subLines

const traverseChildren = function (
  mind: MindMapInstance,
  svgContainer: SVGSVGElement,
  branchColor: string,
  wrapper: Wrapper,
  direction: DirectionClass,
  baseWrapper: HTMLElement
) {
  const parent = wrapper.firstChild
  const children = wrapper.children[1].children
  if (children.length === 0) return

  const parentTopic = parent.firstChild as Topic
  const baseOffset = getOffsetLT(mind.nodes, baseWrapper)
  const { offsetLeft: parentLeft, offsetTop: parentTop } = getOffsetLT(mind.nodes, parentTopic)
  const pL = parentLeft - baseOffset.offsetLeft
  const pT = parentTop - baseOffset.offsetTop
  const pW = parentTopic.offsetWidth
  const pH = parentTopic.offsetHeight
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    const childP = child.firstChild
    const childTopic = childP.firstChild as Topic
    const { offsetLeft: childLeft, offsetTop: childTop } = getOffsetLT(mind.nodes, childTopic)
    const cL = childLeft - baseOffset.offsetLeft
    const cT = childTop - baseOffset.offsetTop
    const cW = childTopic.offsetWidth
    const cH = childTopic.offsetHeight
    const bc = childTopic.nodeObj.branchColor || branchColor
    childTopic.style.setProperty('--branch-color', bc)
    childP.style.setProperty('--branch-color', bc)
    const path = mind.generateSubBranch(
      { pT, pL, pW, pH, cT, cL, cW, cH, direction }
    )
    svgContainer.appendChild(createPath(path, bc, '2'))

    const expander = childP.children[1]

    if (expander) {
      // this property is added in the layout phase
      if (!expander.expanded) continue
    } else {
      // expander not exist
      continue
    }

    traverseChildren(mind, svgContainer, bc, child, direction, baseWrapper)
  }
}

export default linkDiv
