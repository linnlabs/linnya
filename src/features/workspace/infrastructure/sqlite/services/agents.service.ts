/**
 * @file agents.service.ts
 * @description AgentsService - 通用 Agent 配置服务。
 *
 * 职责：
 * - 管理用户自定义的 Agent 配置（如 Review 审阅角色）
 * - 提供 CRUD 操作（list/get/create/update/delete）
 * - Agent 配置为全局级别，不绑定特定项目
 *
 * 注意：
 * - 系统内置角色（如 logicCheck、structure、polish）不由此服务管理
 * - 内置角色提示词由 `src/app-hosts/linnya/agent-registry/agents/review/builtinAgents.ts` 维护
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

/**
 * Agent 记录的数据库行类型
 */
export interface AgentRow {
  id: string;
  type: string;
  name: string;
  system_prompt: string;
  knowledge: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Agent 配置的应用层类型
 */
export interface Agent {
  id: string;
  type: string;
  name: string;
  systemPrompt: string;
  knowledge: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 创建 Agent 的参数
 */
export interface CreateAgentParams {
  type: string;
  name: string;
  systemPrompt: string;
  knowledge?: string;
}

/**
 * 更新 Agent 的参数
 */
export interface UpdateAgentParams {
  name?: string;
  systemPrompt?: string;
  knowledge?: string;
}

/**
 * 将数据库行转换为应用层类型
 */
function rowToAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    systemPrompt: row.system_prompt,
    knowledge: row.knowledge ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class AgentsService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * 获取所有 Agent 配置
   *
   * @param type - 可选，按类型过滤（如 'review'）
   * @returns Agent 配置列表
   */
  listAgents(type?: string): Agent[] {
    let sql = 'SELECT * FROM agents';
    const params: string[] = [];

    if (type) {
      sql += ' WHERE type = ?';
      params.push(type);
    }

    sql += ' ORDER BY created_at DESC';

    const stmt = this.db.prepare(sql);
    const rows = (params.length > 0 ? stmt.all(...params) : stmt.all()) as AgentRow[];

    return rows.map(rowToAgent);
  }

  /**
   * 根据 ID 获取单个 Agent 配置
   *
   * @param id - Agent ID
   * @returns Agent 配置，如果不存在则返回 null
   */
  getAgentById(id: string): Agent | null {
    const stmt = this.db.prepare('SELECT * FROM agents WHERE id = ?');
    const row = stmt.get(id) as AgentRow | undefined;

    if (!row) {
      return null;
    }

    return rowToAgent(row);
  }

  /**
   * 根据类型和名称获取 Agent 配置
   *
   * @param type - Agent 类型
   * @param name - Agent 名称
   * @returns Agent 配置，如果不存在则返回 null
   */
  getAgentByTypeAndName(type: string, name: string): Agent | null {
    const stmt = this.db.prepare('SELECT * FROM agents WHERE type = ? AND name = ?');
    const row = stmt.get(type, name) as AgentRow | undefined;

    if (!row) {
      return null;
    }

    return rowToAgent(row);
  }

  /**
   * 创建新的 Agent 配置
   *
   * @param params - 创建参数
   * @returns 新创建的 Agent
   * @throws Error 如果同类型下已存在同名 Agent
   */
  createAgent(params: CreateAgentParams): Agent {
    const { type, name, systemPrompt, knowledge = '' } = params;

    // 检查是否已存在同名 Agent
    const existing = this.getAgentByTypeAndName(type, name);
    if (existing) {
      throw new Error(`Agent with type '${type}' and name '${name}' already exists`);
    }

    const id = uuidv4();
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO agents (id, type, name, system_prompt, knowledge, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, type, name, systemPrompt, knowledge, now, now);

    return this.getAgentById(id)!;
  }

  /**
   * 更新 Agent 配置
   *
   * @param id - Agent ID
   * @param params - 更新参数
   * @returns 更新后的 Agent
   * @throws Error 如果 Agent 不存在，或更新后名称与其他 Agent 冲突
   */
  updateAgent(id: string, params: UpdateAgentParams): Agent {
    const existing = this.getAgentById(id);
    if (!existing) {
      throw new Error(`Agent with id '${id}' not found`);
    }

    // 如果要更新名称，检查是否会冲突
    if (params.name && params.name !== existing.name) {
      const conflict = this.getAgentByTypeAndName(existing.type, params.name);
      if (conflict) {
        throw new Error(`Agent with type '${existing.type}' and name '${params.name}' already exists`);
      }
    }

    const now = Date.now();
    const updates: string[] = ['updated_at = ?'];
    const values: (string | number)[] = [now];

    if (params.name !== undefined) {
      updates.push('name = ?');
      values.push(params.name);
    }
    if (params.systemPrompt !== undefined) {
      updates.push('system_prompt = ?');
      values.push(params.systemPrompt);
    }
    if (params.knowledge !== undefined) {
      updates.push('knowledge = ?');
      values.push(params.knowledge);
    }

    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE agents SET ${updates.join(', ')} WHERE id = ?
    `);

    stmt.run(...values);

    return this.getAgentById(id)!;
  }

  /**
   * 删除 Agent 配置
   *
   * @param id - Agent ID
   * @returns 是否删除成功
   */
  deleteAgent(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM agents WHERE id = ?');
    const result = stmt.run(id);

    return result.changes > 0;
  }
}
