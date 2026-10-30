export const SELECTION_ARRANGEMENTS = ['left', 'center', 'right', 'top', 'middle', 'bottom', 'distributeX', 'distributeY'] as const;
export type SelectionArrangement = typeof SELECTION_ARRANGEMENTS[number];
