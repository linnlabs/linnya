import type { RepeatingTimer } from '@linnya/renderer-ui';
import type { ProcessMemoryObservationGateway } from '../infrastructure/processMemoryObservationGateway';
import type { ProcessMemoryObservationSample } from '../definitions/processMemoryObservation';

export interface ProcessMemoryObservationRuntimeCallbacks {
  readonly onSample: (sample: ProcessMemoryObservationSample) => void;
  readonly onFailure: (message: string) => void;
}

export class ProcessMemoryObservationRuntime {
  private active = false;
  private pendingSample: Promise<void> | null = null;
  private callbacks: ProcessMemoryObservationRuntimeCallbacks | null = null;

  constructor(
    private readonly gateway: ProcessMemoryObservationGateway,
    private readonly intervalTimer: Pick<RepeatingTimer, 'start' | 'stop'>,
  ) {}

  get isRecording(): boolean {
    return this.active;
  }

  async start(
    intervalMs: number,
    callbacks: ProcessMemoryObservationRuntimeCallbacks,
  ): Promise<void> {
    if (this.isRecording) return;
    this.active = true;
    this.callbacks = callbacks;
    await this.capture('recording-start');
    this.intervalTimer.start(() => {
      void this.capture('interval');
    }, intervalMs);
  }

  async sample(label = 'manual'): Promise<void> {
    await this.capture(label);
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    this.intervalTimer.stop();
    await this.pendingSample;
    await this.capture('recording-stop');
    this.callbacks = null;
    this.active = false;
  }

  private async capture(label: string): Promise<void> {
    if (!this.callbacks || this.pendingSample) return;
    const pending = this.gateway.readSample(label)
      .then(
        sample => this.callbacks?.onSample(sample),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.callbacks?.onFailure(message);
        },
      )
      .finally(() => {
        if (this.pendingSample === pending) this.pendingSample = null;
      });
    this.pendingSample = pending;
    await pending;
  }
}
