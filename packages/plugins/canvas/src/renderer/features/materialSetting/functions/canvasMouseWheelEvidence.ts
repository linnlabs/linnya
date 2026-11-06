export interface CanvasMouseWheelEvidence {
  readonly distance: number;
  readonly time: number;
  readonly count: number;
}
/** 浏览器不暴露设备类型；只识别连续离散刻度用于询问，绝不据此自动切换行为。 */
export function canvasMouseWheelEvidence(
  previous: CanvasMouseWheelEvidence | null,
  event: Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY' | 'ctrlKey' | 'metaKey' | 'timeStamp'>
): CanvasMouseWheelEvidence | null {
  const distance = Math.abs(event.deltaY);
  if (event.ctrlKey || event.metaKey || event.deltaX !== 0 || distance === 0) return null;
  const discrete =
    event.deltaMode === 1 ||
    (event.deltaMode === 0 && distance >= 40 && Number.isInteger(distance));
  if (!discrete) return null;
  const continuous =
    previous !== null && event.timeStamp - previous.time < 600 && previous.distance === distance;
  return { distance, time: event.timeStamp, count: continuous ? previous.count + 1 : 1 };
}
