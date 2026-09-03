import type { Expander } from '../../../domain/types/dom'
import type { ExpanderRenderer } from '../../../domain/types'
import { mountExpanderIcon, updateExpanderIcon, unmountExpanderIcon } from '../../vue/expanderIconRenderer'

const EXPANDER_HOST_SYMBOL = Symbol('mindmap-expander-host')

type ExpanderWithHost = Expander & {
  [EXPANDER_HOST_SYMBOL]?: HTMLElement
}

export const defaultExpanderRenderer: ExpanderRenderer = ({ expanded }) => {
  const expander = document.createElement('mm-expander') as ExpanderWithHost
  const host = document.createElement('span')
  host.className = 'expander-host'
  host.setAttribute('data-mm-expander-host', 'true')

  mountExpanderIcon(host, { expanded })

  expander.appendChild(host)
  expander[EXPANDER_HOST_SYMBOL] = host

  applyExpanderState(expander, expanded)
  return expander
}

export const applyExpanderState = (expander: Expander, expanded: boolean) => {
  expander.expanded = expanded
  expander.dataset.expanded = expanded ? 'true' : 'false'
  expander.setAttribute('aria-expanded', expanded ? 'true' : 'false')
  const host = (expander as ExpanderWithHost)[EXPANDER_HOST_SYMBOL]
  if (host) {
    updateExpanderIcon(host, { expanded })
  }
}

export const disposeExpander = (expander: Expander) => {
  const host = (expander as ExpanderWithHost)[EXPANDER_HOST_SYMBOL]
  if (host) {
    unmountExpanderIcon(host)
  }
}
