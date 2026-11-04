export type CanvasPerformanceContextArm = 'A' | 'B';
export type CanvasPerformanceContextControl =
  | { readonly kind: 'staging'; readonly arm: CanvasPerformanceContextArm }
  | { readonly kind: 'tile'; readonly arm: CanvasPerformanceContextArm }
  | { readonly kind: 'staging-and-tile'; readonly arm: CanvasPerformanceContextArm };

/** 只有固定正文诊断允许改变context hint；不同控制模式不能混在同一臂。 */
export function readCanvasPerformanceContextControl(input: {
  readonly staging: string | undefined; readonly tile: string | undefined; readonly combined: string | undefined; readonly bodyTrace: boolean;
}): CanvasPerformanceContextControl | null {
  if ([input.staging, input.tile, input.combined].filter(arm => arm !== undefined).length > 1) throw new Error('context_control_conflicting_arms');
  const arm = input.staging ?? input.tile ?? input.combined;
  if (arm === undefined) return null;
  if (arm !== 'A' && arm !== 'B') throw new Error('context_control_arm');
  if (!input.bodyTrace) throw new Error('context_control_requires_body_trace');
  if (input.combined !== undefined) return { kind: 'staging-and-tile', arm };
  return input.staging === undefined ? { kind: 'tile', arm } : { kind: 'staging', arm };
}
