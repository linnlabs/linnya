import type { KeypressOptions, MindMapInstance } from '../../domain/types/index'
import { createDefaultHotkeyMap, handleZoom } from '../hotkeys/defaultHotkeys'
export { handleZoom } from '../hotkeys/defaultHotkeys'

export default function (mind: MindMapInstance, options: boolean | KeypressOptions) {
  const key2func = createDefaultHotkeyMap(mind, options)
  const handleKeyDown = (e: KeyboardEvent) => {
    // it will prevent all input in children node, so we have to stop propagation in input element
    e.preventDefault()
    if (!mind.editable) return
    const keyHandler = key2func[e.key]
    keyHandler && keyHandler(e)
  }
  mind.container.addEventListener('keydown', handleKeyDown)
  return () => {
    mind.container.removeEventListener('keydown', handleKeyDown)
  }
}
