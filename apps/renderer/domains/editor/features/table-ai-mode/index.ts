export type * from './definitions/tableAiMode';
export { runAndWaitForTableDocumentChange } from './functions/waitForTableDocumentChange';
export {
  activateTableAiMode,
  deactivateTableAiMode,
  type ActivateTableAiModeInput,
  type DeactivateTableAiModeDependencies,
  type DeactivateTableAiModeInput,
} from './orchestration/tableAiModeLifecycle';
export {
  activateTableAiColumnReference,
  readActiveTableAiColumnReferences,
  updateTableAiColumnReferencesFromText,
  validateAndActivateTableAiColumnReference,
} from './orchestration/tableAiColumnReferenceRuntime';
export { tableAiHighlightRuntime } from './orchestration/tableAiHighlightRuntime';
export { useTableAiModeStore } from './store/tableAiModeStore';
export { useTableAiComposerState } from './store/useTableAiComposerState';
export { default as TableAiComposerContext } from './ui/TableAiComposerContext.vue';
export { ColumnReferenceNode as TableAiColumnReferenceExtension } from '../../blocks/TableBlock/ColumnReferenceNode';
