import type { Node } from 'prosemirror-model'
import type { Command, EditorState, Plugin, PluginKey } from 'prosemirror-state'
import type { FindMatch, FindReplacePluginState, SearchOptions } from '../definitions/findReplace'

export const findReplacePluginKey: PluginKey<FindReplacePluginState>
export function findMatchesInDoc(doc: Node, searchTerm: string, options?: SearchOptions): FindMatch[]
export function createFindReplacePlugin(store: SearchOptions & { searchTerm: string }): Plugin<FindReplacePluginState>
export function searchCommand(searchTerm: string, options?: SearchOptions): Command
export function setActiveMatchCommand(index: number): Command
export function replaceCurrentCommand(replaceTerm: string): Command
export function replaceAllCommand(replaceTerm: string): Command
export function clearSearchCommand(): Command
export function getPluginState(state: EditorState): FindReplacePluginState | undefined
