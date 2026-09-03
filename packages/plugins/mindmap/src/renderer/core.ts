import { LEFT, RIGHT, SIDE, DARK_THEME, THEME } from './domain/constants'
import { generateUUID } from './shared/utils/index'
import { findEle } from './shared/utils/dom/index'
import type { MindMapData, MindMapInstance, MindMapMethods, Options } from './domain/types/index'
import methods from './domain/core/methods'
import type { Topic } from './domain/types/dom'
import MindMapEngine from './presentation/engine/MindMapEngine'

// 在应用内嵌版本中不再从 package.json 读取版本号，避免路径解析问题
// 这里使用一个固定的占位符版本号即可
const MINDMAP_VERSION = 'local-dev'

function MindMap(this: MindMapInstance, options: Options): void {
  const engine = new MindMapEngine(this)
  engine.mount(options)
}

MindMap.prototype = methods

Object.defineProperty(MindMap.prototype, 'currentNode', {
  get() {
    return this.currentNodes[this.currentNodes.length - 1]
  },
  enumerable: true,
})

MindMap.LEFT = LEFT
MindMap.RIGHT = RIGHT
MindMap.SIDE = SIDE

MindMap.THEME = THEME
MindMap.DARK_THEME = DARK_THEME

/**
 * @memberof MindMap
 * @static
 */
MindMap.version = MINDMAP_VERSION
/**
 * @function
 * @memberof MindMap
 * @static
 * @name E
 * @param {string} id Node id.
 * @return {TargetElement} Target element.
 * @example
 * E('bd4313fbac40284b')
 */
MindMap.E = findEle

/**
 * @function new
 * @memberof MindMap
 * @static
 * @param {String} topic root topic
 */
if (import.meta.env.MODE !== 'lite') {
  MindMap.new = (topic: string): MindMapData => ({
    nodeData: {
      id: generateUUID(),
      topic: topic || 'new topic',
      children: [],
    },
  })
}

export interface MindMapCtor {
  new (options: Options): MindMapInstance
  E: (id: string, el?: HTMLElement) => Topic
  new: typeof MindMap.new
  version: string
  LEFT: typeof LEFT
  RIGHT: typeof RIGHT
  SIDE: typeof SIDE
  THEME: typeof THEME
  DARK_THEME: typeof DARK_THEME
  prototype: MindMapMethods
}

export default MindMap as unknown as MindMapCtor

// types
export type * from './shared/utils/events/eventBus'
export type * from './domain/types/index'
export type * from './domain/types/dom'
