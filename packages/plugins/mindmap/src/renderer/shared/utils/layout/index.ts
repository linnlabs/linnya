import { LEFT, RIGHT, SIDE } from '../../../domain/constants'
import type { Children } from '../../../domain/types/dom'
import { DirectionClass, type MindMapInstance, type NodeObj } from '../../../domain/types/index'
import { shapeTpc } from '../dom'

const $d = document

// Set main nodes' direction and invoke layoutChildren()
export const layout = function (this: MindMapInstance) {
  this.nodes.innerHTML = ''

  const tpc = this.createTopic(this.nodeData)
  shapeTpc.call(this, tpc, this.nodeData) // shape root tpc
  tpc.draggable = false
  const root = $d.createElement('mm-root')
  root.appendChild(tpc)

  const mainNodes = this.nodeData.children || []
  if (this.direction === SIDE) {
    // initiate direction of main nodes
    let lcount = 0
    let rcount = 0
    mainNodes.map(node => {
      if (node.direction === LEFT) {
        lcount += 1
      } else if (node.direction === RIGHT) {
        rcount += 1
      } else {
        if (lcount <= rcount) {
          node.direction = LEFT
          lcount += 1
        } else {
          node.direction = RIGHT
          rcount += 1
        }
      }
    })
  }
  layoutMainNode(this, mainNodes, root)
}

const layoutMainNode = function (mind: MindMapInstance, data: NodeObj[], root: HTMLElement) {
  const leftPart = $d.createElement('mm-main')
  leftPart.className = DirectionClass.LEFT
  const rightPart = $d.createElement('mm-main')
  rightPart.className = DirectionClass.RIGHT
  for (let i = 0; i < data.length; i++) {
    const nodeObj = data[i]
    const { grp: w } = mind.createWrapper(nodeObj)
    if (mind.direction === SIDE) {
      if (nodeObj.direction === LEFT) {
        leftPart.appendChild(w)
      } else {
        rightPart.appendChild(w)
      }
    } else if (mind.direction === LEFT) {
      leftPart.appendChild(w)
    } else {
      rightPart.appendChild(w)
    }
  }

  mind.nodes.appendChild(leftPart)
  mind.nodes.appendChild(root)
  mind.nodes.appendChild(rightPart)

  mind.nodes.appendChild(mind.lines)
  mind.nodes.appendChild(mind.labelContainer)
}

export const layoutChildren = function (mind: MindMapInstance, data: NodeObj[]) {
  const chldr = $d.createElement('mm-children') as Children
  for (let i = 0; i < data.length; i++) {
    const nodeObj = data[i]
    const { grp } = mind.createWrapper(nodeObj)
    chldr.appendChild(grp)
  }
  return chldr
}

