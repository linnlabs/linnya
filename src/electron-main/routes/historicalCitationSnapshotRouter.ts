import { Router } from 'express';
import { readHistoricalCitationSnapshotBundle } from '../../domains/citation';
import { Logger } from '../../shared/logger';

const logger = new Logger('HistoricalCitationSnapshotRouter');

/**
 * 历史引用属于会话事实，知识库停用或向量服务故障不应撤掉已保存的证据。
 * 保留历史 URL，独立挂在已认证的 App Server 下，不依赖活知识库服务。
 */
export function createHistoricalCitationSnapshotRouter(): Router {
  const router = Router();
  router.get('/citation-snapshots/bundles/:bundleId', async (req, res) => {
    const bundleId = req.params.bundleId.trim();
    const conversationId = typeof req.query.conversation_id === 'string'
      ? req.query.conversation_id.trim()
      : '';
    if (!bundleId || !conversationId) {
      res.status(400).json({ error: !bundleId ? 'bundleId 不能为空' : 'conversation_id 不能为空' });
      return;
    }
    const instanceId = typeof req.query.instance_id === 'string'
      ? req.query.instance_id.trim()
      : undefined;
    try {
      const record = await readHistoricalCitationSnapshotBundle({ conversationId, instanceId, bundleId });
      if (req.query.download === '1' || req.query.download === 'true') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="citation_snapshot_${bundleId}.json"`);
        res.status(200).send(JSON.stringify(record));
        return;
      }
      res.json(record);
    } catch (error: unknown) {
      logger.error('读取历史 Citation Snapshot Bundle 失败', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : '未知错误',
        context: '读取 Citation Snapshot Bundle',
        timestamp: new Date().toISOString(),
      });
    }
  });
  return router;
}
