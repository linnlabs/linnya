export { default as ElementPropertyPanel } from './ui/ElementPropertyPanel.vue';
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
