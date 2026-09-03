/**
 * @file src/tools/index.ts
 *
 * @brief 工具模块索引文件
 *
 * @description
 * 导出所有可用的工具类和工具注册函数。
 * 包括知识库搜索工具、阅读工具和判别工具。
 */

// 导出知识库工具（统一归档到 knowledgebase/）
export * from './knowledgebase/search';
export * from './knowledgebase/reader';
export * from './knowledgebase/assemble';
export * from './evidence';
export * from './knowledgebase/scope/projectKnowledgeBaseScope';

// 导出图片生成工具
export * from './image_generation';

// 导出 Agent 运行控制工具
export * from './agent_control';

// 导出工作区工具
export * from './workspace';

// 导出宿主命令工具
export * from './commands';

export * from './todo';
export * from './tool_output';
export * from './deep_research';

// 导出 Skill 工具
export * from './skill';

// 导出联网搜索工具
export * from './web';

// 导出工具类型定义
export * from './types';

// compatibility re-export：Linnya 默认工具聚合已迁到 app-hosts
export { allToolClasses, getAllToolClasses } from '../app-hosts/linnya/adapters/tools/allToolClasses';
