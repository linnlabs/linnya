import defaultAgent from './default';
import deepSearchAgent from './deep_search';
import deepResearchLeaderAgent from './deep_research/leader';
import deepResearchReasoner1Agent from './deep_research/reasoner_1';
import deepResearchReasoner2Agent from './deep_research/reasoner_2';
import deepResearchScoutAgent from './deep_research/scout';
import deepResearchChallengerAgent from './deep_research/challenger';
import projectPlanningAgent from './project_planning';
import reviewAgent from './review';
import systemBatchSummarizerAgent from './system_batch_summarizer';
import tableAiFillAgent from './table_ai_fill';
import generalSubagent from './subagent_general';
import documentEditorSubagent from './subagent_document_editor';
import { singleTurnAgentDefinitions } from './single_turn';

/**
 * 内置 AgentDefinition raw list。
 *
 * 中文说明：这个文件只承载 platform 插件的内置 agent 原始清单。
 * 具体插件专属 agent 由各自 contribution 引用，避免禁用插件后仍进入运行期解析。
 * 运行时解析 promptKey 时应走 AgentDefinitionResolver / BackendPluginRegistry。
 */
export const legacyBuiltinAgentDefinitions = [
  defaultAgent,
  deepSearchAgent,
  deepResearchLeaderAgent,
  deepResearchReasoner1Agent,
  deepResearchReasoner2Agent,
  deepResearchScoutAgent,
  deepResearchChallengerAgent,
  projectPlanningAgent,
  reviewAgent,
  systemBatchSummarizerAgent,
  tableAiFillAgent,
  ...singleTurnAgentDefinitions,
  generalSubagent,
  documentEditorSubagent,
] as const;
