export type CanvasPerformanceContextArm = 'A' | 'B';
export type CanvasPerformanceContextControl =
  | { readonly kind: 'staging'; readonly arm: CanvasPerformanceContextArm }
  | { readonly kind: 'tile'; readonly arm: CanvasPerformanceContextArm };

/** 只有固定正文诊断允许改变context hint；两种变量不能混在同一臂。 */
export function readCanvasPerformanceContextControl(input: {
  readonly staging: string | undefined; readonly tile: string | undefined; readonly bodyTrace: boolean;
}): CanvasPerformanceContextControl | null {
  if (input.staging !== undefined && input.tile !== undefined) throw new Error('context_control_conflicting_arms');
  const arm = input.staging ?? input.tile;
  if (arm === undefined) return null;
  if (arm !== 'A' && arm !== 'B') throw new Error('context_control_arm');
  if (!input.bodyTrace) throw new Error('context_control_requires_body_trace');
  return input.staging === undefined ? { kind: 'tile', arm } : { kind: 'staging', arm };
}
