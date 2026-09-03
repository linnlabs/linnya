/**
 * @file src/tools/deep_research/index.ts
 *
 * @description
 * Deep Research 子 Agent Tools 聚合入口（Milestone 3）。
 */

import { WriteReportTool } from './writeReport';

export { WriteReportTool } from './writeReport';

export const deepResearchToolClasses = [
  WriteReportTool,
] as const;
