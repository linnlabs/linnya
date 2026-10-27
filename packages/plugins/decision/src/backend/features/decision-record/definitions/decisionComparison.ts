export interface DecisionItemChanges<T> {
  readonly added: readonly T[];
  readonly removed: readonly T[];
  readonly changed: readonly { readonly id: string; readonly before: T; readonly after: T }[];
}

export interface DecisionRecommendationSummary {
  readonly status: 'missing' | 'current' | 'needs_review';
  readonly basedOnInputRevision: number | null;
  readonly optionIds: readonly string[];
}
