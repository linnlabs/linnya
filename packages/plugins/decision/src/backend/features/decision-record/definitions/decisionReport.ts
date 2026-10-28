export interface DecisionReport {
  readonly kind: 'decision_report';
  readonly decisionId: string;
  readonly revision: number;
  readonly inputRevision: number;
  readonly markdown: string;
}
