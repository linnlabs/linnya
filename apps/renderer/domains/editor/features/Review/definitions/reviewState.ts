import type { ReviewAgent } from './reviewAgent';
import type { ReviewProgressState } from './reviewProgress';
export interface ReviewState {
  status: 'idle' | 'creating_agent' | 'processing' | 'results';
  availableAgents: ReviewAgent[];
  activeAgentIds: string[];
  currentReviewRunId: string | null;
  editingAgentId: string | null;
  reviewBackground: string;
  reviewGoal: string;
  progress: number;
  progressState: ReviewProgressState;
  activeAgentFilter: string;
}
