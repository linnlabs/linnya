import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
  ProcessMemoryObservationMarker,
  ProcessMemoryObservationSample,
  ProcessMemoryObservationStatus,
} from '../definitions/processMemoryObservation';
import { summarizeProcessMemoryObservation } from '../functions/summarizeProcessMemoryObservation';

export const useProcessMemoryObservationStore = defineStore(
  'system-process-memory-observation',
  () => {
    const status = ref<ProcessMemoryObservationStatus>('idle');
    const sessionId = ref('');
    const startedAt = ref(0);
    const stoppedAt = ref<number | null>(null);
    const intervalMs = ref(1000);
    const samples = ref<ProcessMemoryObservationSample[]>([]);
    const markers = ref<ProcessMemoryObservationMarker[]>([]);
    const errorMessage = ref('');
    const summary = computed(() => summarizeProcessMemoryObservation(samples.value));
    const latestSample = computed(() => samples.value[samples.value.length - 1] ?? null);

    function begin(input: {
      readonly id: string;
      readonly timestamp: number;
      readonly sampleIntervalMs: number;
    }): void {
      status.value = 'recording';
      sessionId.value = input.id;
      startedAt.value = input.timestamp;
      stoppedAt.value = null;
      intervalMs.value = input.sampleIntervalMs;
      samples.value = [];
      markers.value = [];
      errorMessage.value = '';
    }

    function appendSample(sample: ProcessMemoryObservationSample): void {
      samples.value.push(sample);
      errorMessage.value = '';
    }

    function addMarker(marker: ProcessMemoryObservationMarker): void {
      markers.value.push(marker);
    }

    function recordFailure(message: string): void {
      errorMessage.value = message;
    }

    function finish(timestamp: number): void {
      status.value = 'stopped';
      stoppedAt.value = timestamp;
    }

    function clear(): void {
      if (status.value === 'recording') return;
      status.value = 'idle';
      sessionId.value = '';
      startedAt.value = 0;
      stoppedAt.value = null;
      samples.value = [];
      markers.value = [];
      errorMessage.value = '';
    }

    return {
      status,
      sessionId,
      startedAt,
      stoppedAt,
      intervalMs,
      samples,
      markers,
      errorMessage,
      summary,
      latestSample,
      begin,
      appendSample,
      addMarker,
      recordFailure,
      finish,
      clear,
    };
  }
);
