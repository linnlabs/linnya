export { default as ElementPropertyToolbar } from './ui/ElementPropertyToolbar.vue';
export { hasElementPropertyControls } from './functions/hasElementPropertyControls';
export { projectElementPropertyTarget } from './functions/projectElementPropertyTarget';
export { ELEMENT_PROPERTY_MESSAGE_CATALOG } from './definitions/elementPropertyMessageCatalog';
export type { ElementPropertyOperation } from './definitions/elementPropertyTypes';
export {
  createDeleteFrameOperation,
  createFillColorOperation,
  createTextStyleOperation,
  createVisualSizeOperation,
} from './functions/elementPropertyOperations';

export { useElementPropertyAnchor } from './orchestration/useElementPropertyAnchor';
export type { ElementPropertyAnchor } from './definitions/elementPropertyToolbar';
