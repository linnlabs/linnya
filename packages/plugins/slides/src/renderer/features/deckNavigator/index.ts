export { default as DeckNavigatorBar } from './ui/DeckNavigatorBar.vue';
export { default as SlideGridView } from './ui/SlideGridView.vue';
export { resolveBlankSlideInsertion } from './functions/blankSlideInsertion';
export { resolveSlideGridLayout } from './functions/slideGridLayout';
export { useSlideThumbnails } from './orchestration/useSlideThumbnails';
export type {
  BlankSlideInsertionAvailability,
  SlideGridLayout,
} from './definitions/deckNavigatorTypes';
