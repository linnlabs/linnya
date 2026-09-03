import type { MindMapInstance, KeypressOptions } from '../../domain/types/index'
import keypressInit from '../../shared/plugin/keypress'
import setupMindMapSelection from '../../interaction/selection/adapters/MindMapSelectionAdapter'
import nodeDraggable from '../../interaction/nodeDraggable'
import operationHistory from '../../domain/operations/operationHistory'

type Dispose = () => void

const collect = (disposables: Dispose[], dispose?: Dispose) => {
  if (dispose) disposables.push(dispose)
}

const setupKeypress = (mind: MindMapInstance, options: boolean | KeypressOptions) => {
  if (!options) return
  return keypressInit(mind, options)
}

const setupSelection = (mind: MindMapInstance) => {
  if (!mind.editable) return
  return setupMindMapSelection(mind)
}

const setupDraggable = (mind: MindMapInstance) => {
  if (!mind.draggable) return
  return nodeDraggable(mind)
}

const setupUndo = (mind: MindMapInstance) => {
  if (!mind.allowUndo) return
  return operationHistory(mind)
}

export const initRuntimePlugins = (mind: MindMapInstance) => {
  if (import.meta.env.MODE === 'lite') return []
  const disposables: Dispose[] = []
  collect(disposables, setupKeypress(mind, mind.keypress))
  collect(disposables, setupSelection(mind))
  collect(disposables, setupDraggable(mind))
  collect(disposables, setupUndo(mind))
  return disposables
}
