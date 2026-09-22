import { defineAsyncComponent } from 'vue';
import type { ToolUiConfig } from '../types';
import { judgeRecordTitle, projectJudgeRecordPresentation } from './projectJudgeRecordPresentation';
export const judgeToolCards: Readonly<Record<string, ToolUiConfig>> = {
  judge_record: {
    component: defineAsyncComponent(() => import('./JudgeRecordCard.vue')),
    presentation: projectJudgeRecordPresentation,
    compactStep: () => ({ title: judgeRecordTitle }),
    layout: { fullWidth: true, defaultCollapsed: true },
  },
};
