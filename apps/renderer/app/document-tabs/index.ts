export type {
  DocumentTab,
  DocumentTabIdentity,
  DocumentTabsCloseResult,
  DocumentTabsState,
} from './definitions/documentTabs';
export {
  DOCUMENT_TABS_CLOSED_LIMIT,
  closeDocumentTabs,
  closeDocumentTabsToRight,
  closeOtherDocumentTabs,
  createDocumentTabsState,
  cycleRecentDocumentTab,
  openDocumentTab,
  popClosedDocumentTab,
  removeDocumentTabs,
} from './functions/documentTabsState';
export { useDocumentTabsStore } from './store/documentTabsStore';
