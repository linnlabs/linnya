import { ElectronProcessMemoryResponseSchema } from '@app/schemas';
import type { ProcessMemoryObservationSample } from '../definitions/processMemoryObservation';
import { readRendererHeapMemory } from '../functions/readRendererHeapMemory';

export interface ProcessMemoryObservationGateway {
  readSample(label: string): Promise<ProcessMemoryObservationSample>;
}

export const processMemoryObservationGateway: ProcessMemoryObservationGateway = {
  async readSample(label) {
    const raw = await window.electronAPI.getElectronProcessMemory();
    const result = ElectronProcessMemoryResponseSchema.parse(raw);
    if (!result.success) throw new Error(result.error);
    return {
      label,
      snapshot: result,
      rendererHeap: readRendererHeapMemory(),
    };
  },
};
