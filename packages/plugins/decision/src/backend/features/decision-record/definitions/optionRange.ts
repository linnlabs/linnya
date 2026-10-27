import type { CheckBoundaryResult } from './checkBoundary';

export type OptionCheckStatus = 'pass' | 'fail' | 'undetermined';
export interface NumericRegion {
  readonly lower: number | null;
  readonly upper: number | null;
  readonly lowerInclusive: boolean;
  readonly upperInclusive: boolean;
}
export interface OptionState {
  readonly optionId: string;
  readonly status: OptionCheckStatus;
}
export interface OptionRangeRow extends NumericRegion {
  readonly options: readonly OptionState[];
}
export interface OptionBoundaries {
  readonly optionId: string;
  readonly checks: readonly { readonly checkId: string; readonly result: CheckBoundaryResult }[];
}
