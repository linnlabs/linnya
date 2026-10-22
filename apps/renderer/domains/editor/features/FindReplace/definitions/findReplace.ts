import type { DecorationSet } from 'prosemirror-view'

export interface SearchOptions {
  matchCase?: boolean
  wholeWord?: boolean
  useRegex?: boolean
}

export interface FindMatch {
  from: number
  to: number
  text: string
  editorType: 'main'
  /** 原子块只定位；不能对属性内容执行行内替换。 */
  replaceable?: false
}

export interface FindReplacePluginState {
  decorations: DecorationSet
  matches: FindMatch[]
  activeIndex: number
}
