import type { PresentationPptxArtifactSourceRecord } from '../../../persistence/index.js';
import type {
  PresentationPptxArtifactPort,
  PresentationPptxArtifactSnapshot,
} from '../definitions/presentationPptxArtifact.js';

export interface PresentationPptxArtifactRuntimeDeps {
  readonly repository: {
    getPresentationPptxArtifactSource(
      nodeId: string,
    ): Promise<PresentationPptxArtifactSourceRecord | null>;
    savePresentationPptxArtifact(
      nodeId: string,
      revisionId: string,
      pptxBuffer: Buffer,
    ): Promise<boolean>;
  };
  materialize(source: PresentationPptxArtifactSourceRecord): Promise<Buffer>;
}

/** PPTX 是 revision 的派生 artifact；读取侧负责按需物化并以 current revision CAS 缓存。 */
export class PresentationPptxArtifactRuntime implements PresentationPptxArtifactPort {
  private readonly inFlight = new Map<string, Promise<PresentationPptxArtifactSnapshot>>();

  constructor(private readonly deps: PresentationPptxArtifactRuntimeDeps) {}

  async loadCurrent(nodeId: string): Promise<PresentationPptxArtifactSnapshot> {
    const source = await this.deps.repository.getPresentationPptxArtifactSource(nodeId);
    if (!source) {
      throw new Error(`Presentation not found: ${nodeId}`);
    }
    if (source.artifact.state === 'ready') {
      return this.toSnapshot(source, source.artifact.buffer);
    }

    const key = `${source.nodeId}:${source.currentRevisionId}`;
    const active = this.inFlight.get(key);
    if (active) return active;

    const materialization = this.materializeAndCache(source).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, materialization);
    return materialization;
  }

  private async materializeAndCache(
    source: PresentationPptxArtifactSourceRecord,
  ): Promise<PresentationPptxArtifactSnapshot> {
    const pptxBuffer = await this.deps.materialize(source);
    await this.deps.repository.savePresentationPptxArtifact(
      source.nodeId,
      source.currentRevisionId,
      pptxBuffer,
    );
    // CAS 失败表示 current 已前进；本次调用仍返回其开始时读取到的自洽 revision 快照。
    return this.toSnapshot(source, pptxBuffer);
  }

  private toSnapshot(
    source: PresentationPptxArtifactSourceRecord,
    pptxBuffer: Buffer,
  ): PresentationPptxArtifactSnapshot {
    return {
      nodeId: source.nodeId,
      revisionId: source.currentRevisionId,
      revision: source.currentRevision,
      deckSource: source.deckSource,
      deckSpec: source.deckSpec,
      title: source.title,
      pptxBuffer,
    };
  }
}
