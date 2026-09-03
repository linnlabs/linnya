import { createVNode, render } from 'vue'
import { AddCircleIcon, SubtractCircleIcon } from '@linnya/renderer-ui/icons'

type IconProps = {
  expanded: boolean
  disabled?: boolean
}

const hostState = new WeakMap<HTMLElement, IconProps>()

const renderIcon = (host: HTMLElement, props: IconProps) => {
  const vnode = createVNode(props.expanded ? SubtractCircleIcon : AddCircleIcon, {
    'data-mm-expander-svg': 'true',
    'aria-hidden': 'true',
  })
  render(vnode, host)
}

export const mountExpanderIcon = (host: HTMLElement, props: IconProps) => {
  hostState.set(host, props)
  renderIcon(host, props)
}

export const updateExpanderIcon = (host: HTMLElement, next: IconProps) => {
  const prev = hostState.get(host)
  if (prev && prev.expanded === next.expanded && prev.disabled === next.disabled) {
    return
  }
  hostState.set(host, next)
  renderIcon(host, next)
}

export const unmountExpanderIcon = (host: HTMLElement) => {
  hostState.delete(host)
  render(null, host)
}
