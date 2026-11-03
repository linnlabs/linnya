export type CanvasQuery = { readonly kind: 'read' }
  | { readonly kind: 'show' | 'find' | 'neighbors' | 'region'; readonly value: string; readonly depth: number };
