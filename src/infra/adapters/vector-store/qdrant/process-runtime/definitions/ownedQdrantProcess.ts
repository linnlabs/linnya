import type {
  OwnedProcessResourceReleaseResult,
  OwnedProcessRootExit,
  OwnedProcessTreeStopResult,
} from '../../../../../../shared/process-runtime';

export class QdrantProcessCleanupError extends Error {
  constructor(
    readonly treeCleanup: OwnedProcessTreeStopResult,
    readonly resourceRelease: OwnedProcessResourceReleaseResult,
  ) {
    super('Qdrant process tree 或 owner 资源未能完整收口');
    this.name = 'QdrantProcessCleanupError';
  }
}

export interface OwnedQdrantProcess {
  /** 固定 Qdrant/Actix 制品确认绑定后，从当前 child 输出读取的真实 HTTP 端口。 */
  readonly httpPort: Promise<number>;
  /** 只有 root、整棵树、平台资源和日志流都完成后才结算。 */
  readonly terminal: Promise<OwnedProcessRootExit>;
  stopAndWait(): Promise<void>;
}
