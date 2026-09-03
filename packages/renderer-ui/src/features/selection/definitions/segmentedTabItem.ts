export interface SegmentedTabItem {
  readonly id: string;
  readonly label: string;
  readonly count?: number;
  readonly disabled?: boolean;
}
