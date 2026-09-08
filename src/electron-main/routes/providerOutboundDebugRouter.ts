import { Router, type Request, type Response } from 'express';
import {
  defaultProviderOutboundDiagnostics,
  type ProviderOutboundDiagnosticsSnapshotPort,
} from 'src/domains/provider-diagnostics/features/provider-outbound';

/**
 * 开发态 Provider outbound 调试路由。
 * 路由只持有只读 snapshot port，不能接触 Provider payload、凭据或 transport。
 */
export function createProviderOutboundDebugRouter(
  snapshots: ProviderOutboundDiagnosticsSnapshotPort = defaultProviderOutboundDiagnostics
): Router {
  const router = Router();

  router.get('/latest-attempt', (_req: Request, res: Response) => {
    const snapshot = snapshots.readLatest();
    if (!snapshot) {
      return res.status(404).json({ message: '当前进程尚未发起 Provider 请求' });
    }
    return res.json(snapshot);
  });

  return router;
}
