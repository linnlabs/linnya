export type UnavailableResult = { readonly status: 'unavailable'; readonly reason: string };
export type ExpressionResult = { readonly status: 'available'; readonly value: number } | UnavailableResult;
export type CheckValueResult = { readonly status: 'available'; readonly value: number | boolean | string } | UnavailableResult;

export interface DecisionCheckEvaluation {
  readonly id: string;
  readonly optionId: string;
  readonly label: string;
  readonly left: CheckValueResult;
  readonly right: CheckValueResult;
  readonly passes: boolean | null;
}
