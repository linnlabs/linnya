import type { Topic } from '../domain/types/dom'
import type { MindMapInstance } from '../domain/types/index'
import { isTopic, on } from '../shared/utils'
import { createClickHandler } from './handlers/click'
import { createDblClickHandler, createTouchDblClickHandler } from './handlers/dblclick'
import { createKeyDownHandler, createKeyUpHandler } from './handlers/keyboard'
import { createPointerPanHandlers } from './handlers/pointerPan'
import { createContextMenuHandler } from './handlers/contextmenu'
import { createWheelHandler } from './handlers/wheel'

export default function (mind: MindMapInstance) {
  // 初始化空格键状态到实例中
  mind.spacePressed = false

  const handleClick = createClickHandler(mind)
  const handleDblClick = createDblClickHandler(mind)
  const handleTouchDblClick = createTouchDblClickHandler(handleDblClick)
  const handleKeyDown = createKeyDownHandler(mind)
  const handleKeyUp = createKeyUpHandler(mind)
  const pan = createPointerPanHandlers(mind)
  const handleContextMenu = createContextMenuHandler(mind)
  const handleWheel = createWheelHandler(mind)

  const { container } = mind
  const off = on([
    { dom: container, evt: 'pointerdown', func: pan.onPointerDown },
    { dom: container, evt: 'pointermove', func: pan.onPointerMove },
    { dom: container, evt: 'pointerup', func: pan.onPointerUp },
    { dom: container, evt: 'pointerup', func: handleTouchDblClick },
    { dom: container, evt: 'click', func: handleClick },
    { dom: container, evt: 'dblclick', func: handleDblClick },
    { dom: container, evt: 'contextmenu', func: handleContextMenu },
    { dom: container, evt: 'wheel', func: typeof mind.handleWheel === 'function' ? mind.handleWheel : handleWheel },
    { dom: container, evt: 'blur', func: pan.onBlur },
    { dom: container, evt: 'keydown', func: handleKeyDown },
    { dom: container, evt: 'keyup', func: handleKeyUp },
  ])
  return off
}
