import type { RendererHeapMemory } from '../definitions/processMemoryObservation';

interface PerformanceMemoryInfo {
  readonly usedJSHeapSize: number;
  readonly totalJSHeapSize: number;
  readonly jsHeapSizeLimit: number;
}

interface PerformanceWithOptionalMemory extends Performance {
  readonly memory?: PerformanceMemoryInfo;
}

function bytesToMB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

export function readRendererHeapMemory(): RendererHeapMemory | null {
  const memory = (performance as PerformanceWithOptionalMemory).memory;
  if (!memory) return null;
  return {
    usedMB: bytesToMB(memory.usedJSHeapSize),
    totalMB: bytesToMB(memory.totalJSHeapSize),
    limitMB: bytesToMB(memory.jsHeapSizeLimit),
  };
}
