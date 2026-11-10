export const CANVAS_DETERMINISTIC_COUNTS = {
  kind: 'deterministic-counts', bodyWaitBudgetMs: 30000, referenceBodyWindowMs: 5000,
} as const;

/** 共享CI只核完成事实和工作量；显式模式不能混入真机计时、录制或不完整夹具。 */
export function readCanvasDeterministicCounts(environment: Readonly<NodeJS.ProcessEnv>) {
  if (environment.CANVAS_PERFORMANCE_DETERMINISTIC === undefined) return null;
  if (environment.CANVAS_PERFORMANCE_DETERMINISTIC !== '1') throw new Error('deterministic_counts_flag');
  if (environment.CANVAS_PERFORMANCE_OFFSCREEN !== '1' && environment.CANVAS_PERFORMANCE_SOFTWARE !== '1') throw new Error('deterministic_counts_requires_offscreen_profile');
  const conflicting = ['COUNTS', 'KINDS', 'DISTRIBUTIONS', 'MEDIA', 'DRAG', 'INTERNAL_120', 'COMPARISON', 'INPUT_TRACE',
    'CPU_PROFILE', 'BODY_PROFILE', 'RESOURCE_PROFILE', 'ZOOM_TRACE', 'ZOOM_PAINT_TRACE', 'PAINT_TRACE', 'BODY_TRACE',
    'STAGING_CONTEXT_CONTROL', 'TILE_CONTEXT_CONTROL', 'COMBINED_CONTEXT_CONTROL', 'OUTPUT_CONTROL'];
  if (conflicting.some(flag => environment[`CANVAS_PERFORMANCE_${flag}`] !== undefined)) throw new Error('deterministic_counts_conflicting_mode');
  return CANVAS_DETERMINISTIC_COUNTS;
}
