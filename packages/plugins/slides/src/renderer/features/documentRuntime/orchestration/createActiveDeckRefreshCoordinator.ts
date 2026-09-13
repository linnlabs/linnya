export interface ActiveDeckRefreshRequest {
  readonly documentId: string;
  readonly expectedVersion?: number;
}

export interface ActiveDeckRefreshCoordinatorPorts {
  readonly isActiveDocument: (documentId: string) => boolean;
  readonly hasLoadedRevision: (documentId: string, expectedVersion: number) => boolean;
  readonly readDocument: (documentId: string) => Promise<void>;
}

export interface ActiveDeckRefreshCoordinator {
  readonly refresh: (request: ActiveDeckRefreshRequest) => Promise<void>;
}

/**
 * 合并写命令响应与 mutation event 触发的同文稿刷新。
 * active document 与目标 revision 判断通过 port 读取，协调器不持有 Vue/store 状态。
 */
export function createActiveDeckRefreshCoordinator(
  ports: ActiveDeckRefreshCoordinatorPorts,
): ActiveDeckRefreshCoordinator {
  let activeRefresh: { readonly documentId: string; readonly promise: Promise<void> } | null = null;

  async function refresh(request: ActiveDeckRefreshRequest): Promise<void> {
    if (!ports.isActiveDocument(request.documentId) || isLoaded(request)) return;

    const running = activeRefresh;
    if (running?.documentId === request.documentId) {
      await running.promise;
      if (!ports.isActiveDocument(request.documentId) || isLoaded(request)) return;
      if (request.expectedVersion === undefined) return;

      // 已加入的请求可能早于目标 revision；多个等待者继续合并到同一个补读。
      if (activeRefresh?.documentId === request.documentId) {
        await activeRefresh.promise;
        return;
      }
    }

    if (!ports.isActiveDocument(request.documentId) || isLoaded(request)) return;
    const promise = ports.readDocument(request.documentId);
    activeRefresh = { documentId: request.documentId, promise };
    try {
      await promise;
    } finally {
      if (activeRefresh?.promise === promise) activeRefresh = null;
    }
  }

  function isLoaded(request: ActiveDeckRefreshRequest): boolean {
    return request.expectedVersion !== undefined
      && ports.hasLoadedRevision(request.documentId, request.expectedVersion);
  }

  return { refresh };
}
