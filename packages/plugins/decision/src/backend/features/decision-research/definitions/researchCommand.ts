import type { ResearchRunArgs } from '@app/schemas';
import type { PluginChildRunStatus } from '@plugin/backend/childRunDelivery';
import type { ResearchJob } from './researchJob';

export type ResearchCommand =
  | { kind: 'research_prepare'; id: string; expectedRevision: number; scope: ResearchRunArgs }
  | { kind: 'research_read' | 'research_receive' | 'research_list'; id: string };

export type ResearchCommandResult =
  | { requests: ResearchJob[] }
  | { request: ResearchJob; subagent_type: 'decision_research'; prompt: string; status: 'prepared' }
  | {
      request: ResearchJob;
      status: 'awaiting_delivery' | 'not_delivered' | 'paused' | 'failed' | 'cancelled' | 'partial' | 'needs_review' | 'received';
      lifecycle: PluginChildRunStatus | null;
      reviewsComplete: boolean; changedInputs: boolean; changedDocuments: string[]; unobservedDocuments: string[]; note: string;
    };
