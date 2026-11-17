import type Database from 'better-sqlite3';

/** 官方随包插件只借用现有连接；不拥有连接、迁移或其他业务表。 */
export type KnowledgeDatabase = Pick<Database.Database, 'prepare' | 'transaction'>;
