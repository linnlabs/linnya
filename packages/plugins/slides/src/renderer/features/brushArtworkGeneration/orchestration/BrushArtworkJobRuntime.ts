import {
  parseBrushArtworkRenderResult,
  type BrushArtworkRenderRequest,
  type BrushArtworkRenderResult,
} from '@plugin/slides/shared/brushArtwork';

interface PendingJob {
  readonly request: BrushArtworkRenderRequest;
  readonly resolve: (result: BrushArtworkRenderResult) => void;
  readonly reject: (error: Error) => void;
}

interface ActiveJob extends PendingJob {
  readonly worker: Worker;
}

export class BrushArtworkJobRuntime {
  private activeJob: ActiveJob | null = null;
  private readonly pendingJobs: PendingJob[] = [];

  render(request: BrushArtworkRenderRequest): Promise<BrushArtworkRenderResult> {
    if (this.activeJob?.request.requestId === request.requestId
      || this.pendingJobs.some((job) => job.request.requestId === request.requestId)) {
      return Promise.reject(new Error(`Duplicate Brush request: ${request.requestId}`));
    }
    return new Promise((resolve, reject) => {
      this.pendingJobs.push({ request, resolve, reject });
      this.startNext();
    });
  }

  cancel(requestId: string): void {
    if (this.activeJob?.request.requestId === requestId) {
      const active = this.activeJob;
      active.worker.terminate();
      this.activeJob = null;
      active.reject(new Error(`Brush request cancelled: ${requestId}`));
      this.startNext();
      return;
    }
    const index = this.pendingJobs.findIndex((job) => job.request.requestId === requestId);
    if (index < 0) return;
    const [pending] = this.pendingJobs.splice(index, 1);
    pending.reject(new Error(`Brush request cancelled: ${requestId}`));
  }

  private startNext(): void {
    if (this.activeJob) return;
    const pending = this.pendingJobs.shift();
    if (!pending) return;
    const worker = new Worker(new URL('../worker/brushArtworkJobWorker.ts', import.meta.url), {
      type: 'module',
    });
    const active: ActiveJob = { ...pending, worker };
    this.activeJob = active;
    const finish = (): void => {
      worker.terminate();
      if (this.activeJob === active) this.activeJob = null;
      this.startNext();
    };
    worker.onmessage = (event: MessageEvent<unknown>): void => {
      try {
        active.resolve(parseBrushArtworkRenderResult(event.data));
      } catch (error) {
        active.reject(error instanceof Error ? error : new Error(String(error)));
      } finally {
        finish();
      }
    };
    worker.onerror = (event): void => {
      active.reject(new Error(event.message));
      finish();
    };
    worker.postMessage(pending.request);
  }
}
