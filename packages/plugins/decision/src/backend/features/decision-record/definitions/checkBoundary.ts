export type CheckBoundaryResult =
  | { readonly status: 'available'; readonly operator: 'lte' | 'gte' | 'eq'; readonly value: number }
  | { readonly status: 'independent'; readonly passes: boolean }
  | { readonly status: 'unavailable'; readonly reason: string };

export type AffineResult =
  | { readonly status: 'available'; readonly coefficient: number; readonly constant: number }
  | { readonly status: 'unavailable'; readonly reason: string };
