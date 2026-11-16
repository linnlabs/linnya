import { createRepeatingTimer } from '@linnya/renderer-ui';
import { processMemoryObservationGateway } from '../infrastructure/processMemoryObservationGateway';
import { useProcessMemoryObservationStore } from '../store/processMemoryObservationStore';
import { ProcessMemoryObservationRuntime } from './ProcessMemoryObservationRuntime';

const SAMPLE_INTERVAL_MS = 1000;

// 模块级单例，录制由 stop 显式结束，不跟随任何组件卸载。
const runtime = new ProcessMemoryObservationRuntime(
  processMemoryObservationGateway,
  createRepeatingTimer(),
);

export async function startProcessMemoryObservation(): Promise<void> {
  if (runtime.isRecording) return;
  const store = useProcessMemoryObservationStore();
  store.begin({
    id: globalThis.crypto.randomUUID(),
    timestamp: Date.now(),
    sampleIntervalMs: SAMPLE_INTERVAL_MS,
  });
  await runtime.start(SAMPLE_INTERVAL_MS, {
    onSample: sample => store.appendSample(sample),
    onFailure: message => store.recordFailure(message),
  });
}

export async function stopProcessMemoryObservation(): Promise<void> {
  const store = useProcessMemoryObservationStore();
  await runtime.stop();
  if (store.status === 'recording') store.finish(Date.now());
}

export async function sampleProcessMemoryObservation(label = 'manual'): Promise<void> {
  if (!runtime.isRecording) return;
  await runtime.sample(label);
}

export function markProcessMemoryObservation(label: string): void {
  const normalized = label.trim();
  if (!normalized) return;
  const store = useProcessMemoryObservationStore();
  if (store.status !== 'recording') return;
  store.addMarker({ timestamp: Date.now(), label: normalized });
}

export function clearProcessMemoryObservation(): void {
  useProcessMemoryObservationStore().clear();
}
