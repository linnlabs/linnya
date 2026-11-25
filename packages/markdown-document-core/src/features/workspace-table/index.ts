export { WORKSPACE_TABLE_CLASS, WORKSPACE_TABLE_COMPACT_CELL_CLASS } from './definitions/workspaceTable';
export {
  COMPACT_TABLE_CELL_MAX_EM,
  estimateTableTextWidthEm,
  isCompactTableCellElement,
  isCompactTableCellNode,
  isCompactTableCellText,
} from './functions/tableCellCompactness';
export {
  fitStaticWorkspaceTable,
  fitWorkspaceTable,
  observeWorkspaceTableFit,
  syncWorkspaceTableScroll,
} from './functions/fitWorkspaceTable';
export type { WorkspaceTableFit, WorkspaceTableFitOptions } from './functions/fitWorkspaceTable';
