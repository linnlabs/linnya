/**
 * @file apps/renderer/domains/editor/features/Review/services/reviewAgentsService.ts
 * @description Review（审阅）自定义角色的 IPC 访问层
 *
 * 说明：
 * - 系统内置角色（logicCheck/structure/polish）仍由前端内置，不入库
 * - 自定义角色持久化到后端 agents 表（type='review'）
 * - IPC 通道名来自 preload 白名单：'workspace:list-agents' / 'workspace:create-agent' / ...
 */

export interface ReviewAgentRecord {
  id: string;
  type: 'review' | string;
  name: string;
  systemPrompt: string;
  knowledge: string;
  createdAt: number;
  updatedAt: number;
}

export type OperationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getElectronAPI(): Record<string, unknown> {
  const w: unknown = window;
  if (!isRecord(w) || !('electronAPI' in w)) {
    throw new Error('[reviewAgentsService] window.electronAPI 不可用');
  }
  const api = (w as { electronAPI: unknown }).electronAPI;
  if (!isRecord(api)) {
    throw new Error('[reviewAgentsService] window.electronAPI 类型不合法');
  }
  return api;
}

async function invoke<T>(channel: string, args: unknown): Promise<OperationResult<T>> {
  const api = getElectronAPI();
  const fn = api[channel];
  if (typeof fn !== 'function') {
    return { success: false, error: `IPC channel "${channel}" 不存在或不可调用` };
  }

  try {
    const result = await (fn as (a: unknown) => Promise<unknown>)(args);
    if (!isRecord(result) || typeof result.success !== 'boolean') {
      return { success: false, error: `IPC channel "${channel}" 返回值不符合约定` };
    }
    return result as OperationResult<T>;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, error: message };
  }
}

export async function listReviewAgents(): Promise<OperationResult<{ agents: ReviewAgentRecord[] }>> {
  // 按约定：仅拉取 type='review'
  return invoke('workspace:list-agents', { type: 'review' });
}

export async function createReviewAgent(args: {
  name: string;
  systemPrompt: string;
  knowledge?: string;
}): Promise<OperationResult<{ agent: ReviewAgentRecord }>> {
  return invoke('workspace:create-agent', {
    type: 'review',
    name: args.name,
    systemPrompt: args.systemPrompt,
    knowledge: args.knowledge ?? '',
  });
}

export async function updateReviewAgent(args: {
  id: string;
  name?: string;
  systemPrompt?: string;
  knowledge?: string;
}): Promise<OperationResult<{ agent: ReviewAgentRecord }>> {
  return invoke('workspace:update-agent', {
    id: args.id,
    name: args.name,
    systemPrompt: args.systemPrompt,
    knowledge: args.knowledge,
  });
}

export async function deleteReviewAgent(args: { id: string }): Promise<OperationResult<void>> {
  return invoke('workspace:delete-agent', { id: args.id });
}


