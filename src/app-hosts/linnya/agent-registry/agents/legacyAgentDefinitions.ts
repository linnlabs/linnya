import researchAgentV1 from './research_v1';
import defaultAgent from './default';
import { scheduledDefaultAgent, scheduledResearchAgent } from './scheduled';
import deepWebSearchAgent from './deep_web_search';
import researchAuthorV1 from './research_author_v1';
import researchInvestigationReviewV1 from './research_investigation_review_v1';
import researchArgumentReviewV1 from './research_argument_review_v1';
import researchSourceReviewV1 from './research_source_review_v1';
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
  researchAgentV1,
  defaultAgent,
  scheduledDefaultAgent,
  scheduledResearchAgent,
  deepWebSearchAgent,
  researchAuthorV1,
  researchInvestigationReviewV1,
  researchArgumentReviewV1,
  researchSourceReviewV1,
  projectPlanningAgent,
  reviewAgent,
  systemBatchSummarizerAgent,
  tableAiFillAgent,
  ...singleTurnAgentDefinitions,
  generalSubagent,
  documentEditorSubagent,
] as const;
