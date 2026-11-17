/** 图谱抽取是 Worker 内部 prompt；只有深度检索注册为可执行子 Agent。 */

import { DEEP_SEARCH_AGENT_DEFINITION } from './deep-search';

export const knowledgeAgentDefinitions = [DEEP_SEARCH_AGENT_DEFINITION];
