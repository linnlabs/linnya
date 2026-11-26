export {
  DEFAULT_WORKSPACE_TABLE_STYLE,
  WORKSPACE_TABLE_CLASS,
  WORKSPACE_TABLE_COMPACT_CELL_CLASS,
  WORKSPACE_TABLE_STYLE_ATTRIBUTE,
  WORKSPACE_TABLE_STYLES,
} from './definitions/workspaceTable';
export type { WorkspaceTableStyle } from './definitions/workspaceTable';
export {
  applyWorkspaceTableStyle,
  isWorkspaceTableStyle,
  readWorkspaceTableStyle,
  workspaceTableStyleAttributes,
} from './functions/workspaceTableStyle';
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
