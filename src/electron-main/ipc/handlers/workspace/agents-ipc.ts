/**
 * @file src/electron-main/ipc/handlers/workspace/agents-ipc.ts
 * @description Agents（通用 Agent 配置）的 IPC 通道处理器
 *
 * 提供的 IPC 通道：
 * - workspace:list-agents    - 获取 Agent 列表（支持按 type 过滤）
 * - workspace:get-agent      - 根据 ID 获取单个 Agent
 * - workspace:create-agent   - 创建新 Agent
 * - workspace:update-agent   - 更新 Agent
 * - workspace:delete-agent   - 删除 Agent
 */

import { AgentsService, CreateAgentParams, UpdateAgentParams } from '../../../../features/workspace/infrastructure/sqlite/services/agents.service';
import { Logger } from '../../../../shared/logger';
import type { BackendRuntimeOwner } from '../../../../app-hosts/linnya/backend-runtime/orchestration/backendRuntimeOwner';
import type { BackendRendererIpcStyleRegistrarPort } from '../../../../app-hosts/linnya/adapters/backend-renderer-requests';

const logger = new Logger('AgentsIPC');

/**
 * IPC 参数类型定义
 */
interface ListAgentsArgs {
  type?: string;
}

interface GetAgentArgs {
  id: string;
}

interface CreateAgentArgs {
  type: string;
  name: string;
  systemPrompt: string;
  knowledge?: string;
}

interface UpdateAgentArgs {
  id: string;
  name?: string;
  systemPrompt?: string;
  knowledge?: string;
}

interface DeleteAgentArgs {
  id: string;
}

/**
 * 注册 Agents 相关的 IPC 处理器
 * @param runtimeOwner - App Server Backend 服务协调器
 */
export function registerAgentsHandlers(
  runtimeOwner: BackendRuntimeOwner,
  ipcMain: BackendRendererIpcStyleRegistrarPort,
): void {
  logger.info('🔌 [IPC-LIFECYCLE] REGISTER | Registering Agents IPC handlers...');

  const services = runtimeOwner.getServices();
  const databaseService = services.databaseService;

  if (!databaseService) {
    logger.error('🔌 [IPC-LIFECYCLE] REGISTER | ❌ DatabaseService not available!');
    throw new Error('DatabaseService not available for Agents handlers');
  }

  // ============================================================================
  // Agent 配置操作
  // ============================================================================

  /**
   * 获取 Agent 列表
   * @param type - 可选，按类型过滤（如 'review'）
   */
  ipcMain.handle('workspace:list-agents', async (_event, args: ListAgentsArgs) => {
    try {
      const db = databaseService.getDb();
      const agentsService = new AgentsService(db);
      const agents = agentsService.listAgents(args?.type);

      return { success: true, data: { agents } };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[workspace:list-agents] Error:', error);
      return { success: false, error: message };
    }
  });

  /**
   * 根据 ID 获取单个 Agent
   */
  ipcMain.handle('workspace:get-agent', async (_event, args: GetAgentArgs) => {
    try {
      if (!args?.id) {
        return { success: false, error: 'id is required' };
      }

      const db = databaseService.getDb();
      const agentsService = new AgentsService(db);
      const agent = agentsService.getAgentById(args.id);

      if (!agent) {
        return { success: false, error: `Agent with id '${args.id}' not found` };
      }

      return { success: true, data: { agent } };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[workspace:get-agent] Error:', error);
      return { success: false, error: message };
    }
  });

  /**
   * 创建新 Agent
   */
  ipcMain.handle('workspace:create-agent', async (_event, args: CreateAgentArgs) => {
    try {
      // 参数验证
      if (!args?.type || !args?.name || !args?.systemPrompt) {
        return { success: false, error: 'type, name, and systemPrompt are required' };
      }

      const db = databaseService.getDb();
      const agentsService = new AgentsService(db);

      const params: CreateAgentParams = {
        type: args.type,
        name: args.name,
        systemPrompt: args.systemPrompt,
        knowledge: args.knowledge
      };

      const agent = agentsService.createAgent(params);
      logger.info(`[workspace:create-agent] Agent created: ${agent.id} (${agent.name})`);

      return { success: true, data: { agent } };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[workspace:create-agent] Error:', error);
      return { success: false, error: message };
    }
  });

  /**
   * 更新 Agent
   */
  ipcMain.handle('workspace:update-agent', async (_event, args: UpdateAgentArgs) => {
    try {
      if (!args?.id) {
        return { success: false, error: 'id is required' };
      }

      const db = databaseService.getDb();
      const agentsService = new AgentsService(db);

      const params: UpdateAgentParams = {};
      if (args.name !== undefined) params.name = args.name;
      if (args.systemPrompt !== undefined) params.systemPrompt = args.systemPrompt;
      if (args.knowledge !== undefined) params.knowledge = args.knowledge;

      const agent = agentsService.updateAgent(args.id, params);
      logger.info(`[workspace:update-agent] Agent updated: ${agent.id}`);

      return { success: true, data: { agent } };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[workspace:update-agent] Error:', error);
      return { success: false, error: message };
    }
  });

  /**
   * 删除 Agent
   */
  ipcMain.handle('workspace:delete-agent', async (_event, args: DeleteAgentArgs) => {
    try {
      if (!args?.id) {
        return { success: false, error: 'id is required' };
      }

      const db = databaseService.getDb();
      const agentsService = new AgentsService(db);

      const deleted = agentsService.deleteAgent(args.id);

      if (!deleted) {
        return { success: false, error: `Agent with id '${args.id}' not found` };
      }

      logger.info(`[workspace:delete-agent] Agent deleted: ${args.id}`);
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[workspace:delete-agent] Error:', error);
      return { success: false, error: message };
    }
  });

  logger.info('✅ [IPC-LIFECYCLE] REGISTER | Agents IPC handlers registered.');
}
