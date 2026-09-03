/**
 * @file agents.schema.ts
 * @description 定义通用 Agent 配置表结构。
 *
 * 设计说明：
 * - agents 表用于存储用户自定义的 Agent 配置（如 Review 审阅角色）
 * - 系统内置角色（如 logicCheck、structure、polish）不入表，由代码维护
 * - Agent 配置为全局级别，不绑定特定项目，支持跨项目复用
 * - 通过 type 字段区分不同类型的 Agent（如 'review'、'writing' 等）
 *
 * 约束：
 * - UNIQUE(type, name)：同一类型下不允许同名 Agent
 */

export const AGENTS_SCHEMAS = [
  // 通用 Agent 配置表
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    knowledge TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(type, name)
  )`,

  // 索引优化：按类型查询
  `CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(type)`,
];
