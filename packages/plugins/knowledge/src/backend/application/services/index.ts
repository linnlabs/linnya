/**
 * @file src/knowledge-base/application/services/index.ts
 * 
 * @brief 服务层统一导出文件
 * 
 * @description
 * 功能 (What): 统一导出所有业务服务类和依赖接口
 * 输入 (Input): 无
 * 输出 (Output): 导出的服务类和接口
 * 副作用 (Side-effects): 无
 */

// 导出所有服务类
export { DocumentService } from './DocumentService';
export { TaskService } from './TaskService';
export { IngestionService } from './IngestionService';
export { KnowledgeBaseMgmtService } from './KnowledgeBaseMgmtService';

// 导出依赖接口
export type { DocumentServiceDeps } from './DocumentService';
export type { IngestionServiceDeps } from './IngestionService';
export type { KnowledgeBaseMgmtServiceDeps } from './KnowledgeBaseMgmtService';
