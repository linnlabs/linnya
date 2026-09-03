export interface SteppedZoomLevelInput {
  currentZoom: number;
  direction: 'in' | 'out';
  step: number;
  minZoom: number;
  maxZoom: number;
}

export interface WheelZoomLevelInput {
  currentZoom: number;
  deltaY: number;
  minZoom: number;
  maxZoom: number;
  sensitivity: number;
}

function clampZoomLevel(value: number, minZoom: number, maxZoom: number): number {
  return Math.min(Math.max(value, minZoom), maxZoom);
}

export function computeSteppedZoomLevel(input: SteppedZoomLevelInput): number {
  const nextZoom = input.direction === 'in'
    ? input.currentZoom + input.step
    : input.currentZoom - input.step;
  return clampZoomLevel(nextZoom, input.minZoom, input.maxZoom);
}

export function computeWheelZoomLevel(input: WheelZoomLevelInput): number {
  const zoomFactor = Math.exp(-input.deltaY * input.sensitivity);
  return clampZoomLevel(input.currentZoom * zoomFactor, input.minZoom, input.maxZoom);
}
