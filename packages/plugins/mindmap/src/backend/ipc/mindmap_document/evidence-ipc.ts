import { MindMapEvidenceService } from '../../persistence/mindmap_document/services/blocks/evidence.service';
import { Logger } from '@plugin/backend/workspaceRuntime';
import { isUsingNewDatabase } from '@plugin/backend/workspaceRuntime';
import type { BackendPluginIpcHandlerRegistrar } from '@plugin/backend/pluginContribution';
import { assertPluginRuntimeEnabled } from '@plugin/backend/pluginRuntime';
import { MINDMAP_PLUGIN_ID, MINDMAP_PLUGIN_META } from '@plugin/mindmap/shared';
import {
  parseCreateEvidencePayload,
  parseEvidenceIdPayload,
  parseEvidenceListPayload,
  parseEvidenceMovePayload,
  parseEvidenceNodeIdsPayload,
  parseUpdateEvidencePayload,
  readErrorMessage,
} from './ipc-payloads';
import { readMindMapTsServiceManager } from './ts-service-manager';

const logger = new Logger('MindMapEvidenceIPC');

function assertMindmapRuntimeEnabled(action: string): void {
  assertPluginRuntimeEnabled({
    pluginId: MINDMAP_PLUGIN_ID,
    pluginName: MINDMAP_PLUGIN_META.name,
    action,
  });
}

export function registerMindMapEvidenceHandlers(
  tsServiceManager: unknown,
  registerBackendPluginIpcHandler: BackendPluginIpcHandlerRegistrar,
): void {
  const services = readMindMapTsServiceManager(tsServiceManager).getServices();
  const databaseService = services.databaseService;

  if (!databaseService) {
    logger.error('DatabaseService not available');
    return;
  }

  const db = databaseService.getDb();
  const evidenceService = new MindMapEvidenceService(db);

  // Helper to check DB status
  const checkDb = (action: string): void => {
    if (!isUsingNewDatabase()) {
      throw new Error('New database not enabled');
    }
    assertMindmapRuntimeEnabled(action);
  };

  // 1. Add Evidence
  registerBackendPluginIpcHandler('mindmap', 'mindmap-evidence:add', async (_event, payload) => {
    try {
      checkDb('添加 Mindmap 证据');
      const params = parseCreateEvidencePayload(payload);
      const result = evidenceService.addEvidence(params);
      return { success: true, data: result };
    } catch (error) {
      logger.error('[add] Error:', error);
      return { success: false, error: readErrorMessage(error) };
    }
  });

  // 2. Update Evidence
  registerBackendPluginIpcHandler('mindmap', 'mindmap-evidence:update', async (_event, payload) => {
    try {
      checkDb('更新 Mindmap 证据');
      const params = parseUpdateEvidencePayload(payload);
      evidenceService.updateEvidence(params);
      return { success: true };
    } catch (error) {
      logger.error('[update] Error:', error);
      return { success: false, error: readErrorMessage(error) };
    }
  });

  // 3. Remove Evidence
  registerBackendPluginIpcHandler('mindmap', 'mindmap-evidence:remove', async (_event, payload) => {
    try {
      checkDb('删除 Mindmap 证据');
      const { id } = parseEvidenceIdPayload(payload);
      evidenceService.removeEvidence(id);
      return { success: true };
    } catch (error) {
      logger.error('[remove] Error:', error);
      return { success: false, error: readErrorMessage(error) };
    }
  });

  // 4. List Evidences
  registerBackendPluginIpcHandler('mindmap', 'mindmap-evidence:list', async (_event, payload) => {
    try {
      checkDb('读取 Mindmap 证据');
      const { documentId, nodeId } = parseEvidenceListPayload(payload);
      const list = evidenceService.listEvidences(documentId, nodeId);
      return { success: true, data: list };
    } catch (error) {
      logger.error('[list] Error:', error);
      return { success: false, error: readErrorMessage(error) };
    }
  });

  // 5. Batch Remove (for node deletion)
  registerBackendPluginIpcHandler('mindmap', 'mindmap-evidence:batch-remove', async (_event, payload) => {
    try {
      checkDb('批量删除 Mindmap 证据');
      const { documentId, nodeIds } = parseEvidenceNodeIdsPayload(payload, 'mindmap-evidence:batch-remove');
      evidenceService.batchRemoveByNodeIds(documentId, nodeIds);
      return { success: true };
    } catch (error) {
      logger.error('[batch-remove] Error:', error);
      return { success: false, error: readErrorMessage(error) };
    }
  });

  // 6. Clone Evidence (for node copy)
  registerBackendPluginIpcHandler('mindmap', 'mindmap-evidence:clone', async (_event, payload) => {
    try {
      checkDb('克隆 Mindmap 证据');
      const { documentId, sourceNodeId, targetNodeId } = parseEvidenceMovePayload(payload, 'mindmap-evidence:clone');
      evidenceService.cloneEvidence(documentId, sourceNodeId, targetNodeId);
      return { success: true };
    } catch (error) {
      logger.error('[clone] Error:', error);
      return { success: false, error: readErrorMessage(error) };
    }
  });

  // 7. Count Evidences (for badges)
  registerBackendPluginIpcHandler('mindmap', 'mindmap-evidence:count', async (_event, payload) => {
    try {
      checkDb('读取 Mindmap 证据数量');
      const { documentId, nodeIds } = parseEvidenceNodeIdsPayload(payload, 'mindmap-evidence:count');
      const counts = evidenceService.countEvidences(documentId, nodeIds);
      return { success: true, data: counts };
    } catch (error) {
      logger.error('[count] Error:', error);
      return { success: false, error: readErrorMessage(error) };
    }
  });

  // 8. Soft Delete (for undo/redo support)
  registerBackendPluginIpcHandler('mindmap', 'mindmap-evidence:soft-delete', async (_event, payload) => {
    try {
      checkDb('软删除 Mindmap 证据');
      const { documentId, nodeIds } = parseEvidenceNodeIdsPayload(payload, 'mindmap-evidence:soft-delete');
      evidenceService.softDeleteByNodeIds(documentId, nodeIds);
      return { success: true };
    } catch (error) {
      logger.error('[soft-delete] Error:', error);
      return { success: false, error: readErrorMessage(error) };
    }
  });

  // 9. Restore Soft Deleted (for undo)
  registerBackendPluginIpcHandler('mindmap', 'mindmap-evidence:restore', async (_event, payload) => {
    try {
      checkDb('恢复 Mindmap 证据');
      const { documentId, nodeIds } = parseEvidenceNodeIdsPayload(payload, 'mindmap-evidence:restore');
      evidenceService.restoreSoftDeleted(documentId, nodeIds);
      return { success: true };
    } catch (error) {
      logger.error('[restore] Error:', error);
      return { success: false, error: readErrorMessage(error) };
    }
  });

  // 10. Move Evidences (for cut/paste)
  registerBackendPluginIpcHandler('mindmap', 'mindmap-evidence:move', async (_event, payload) => {
    try {
      checkDb('移动 Mindmap 证据');
      const { documentId, sourceNodeId, targetNodeId } = parseEvidenceMovePayload(payload, 'mindmap-evidence:move');
      evidenceService.moveEvidences(documentId, sourceNodeId, targetNodeId);
      return { success: true };
    } catch (error) {
      logger.error('[move] Error:', error);
      return { success: false, error: readErrorMessage(error) };
    }
  });
}
