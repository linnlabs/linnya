import type { ScheduledTaskNotification, ScheduledTaskSettings, ScheduledTaskSettingsSetRequest } from '@app/schemas/scheduled-tasks';
import type { ScheduledRunRecord, ScheduledTaskRecord, ScheduledTaskStore } from './scheduledTaskStore';

export type ScheduledExecutionState = 'running' | 'awaiting_approval' | 'awaiting_answer' | 'completed' | 'failed' | 'interrupted' | 'missing';

export interface ScheduledExecutionFact {
  readonly state: ScheduledExecutionState;
  readonly runId: string | null;
}

export interface ScheduledTaskExecutionPort {
  start(task: ScheduledTaskRecord, run: ScheduledRunRecord, modelId: string, prepared: (conversationId: string) => void): Promise<string>;
  read(runs: readonly ScheduledRunRecord[]): Promise<ReadonlyMap<string, ScheduledExecutionFact>>;
  stop(conversationId: string, runId: string, reason: string): Promise<void>;
}

export interface ScheduledTaskSchedulerLifecycle {
  start(): void;
  stop(): Promise<void>;
  activeCount(): Promise<number>;
}

export interface ScheduledTaskPorts {
  readonly store: ScheduledTaskStore;
  readonly schedulerEnabled: boolean;
  readonly now: () => number;
  readonly timezone: () => string;
  readonly refreshTimezone?: () => Promise<void>;
  readonly buildTime?: number;
  readonly projectExists: (projectId: string) => boolean;
  readonly defaultModel: () => string | null;
  readonly modelAvailable: (id: string) => boolean;
  readonly execution: ScheduledTaskExecutionPort;
  readonly settings: {
    read(): ScheduledTaskSettings;
    write(settings: ScheduledTaskSettingsSetRequest): void;
  };
  readonly usage: (run: ScheduledRunRecord) => number | null;
  readonly storage: (taskId: string) => number | null;
  readonly measureStorage?: (projectId: string, conversationId: string) => Promise<void>;
  readonly publish: () => void;
  readonly notify: (notification: ScheduledTaskNotification) => Promise<void>;
  readonly logError: (message: string, error: unknown) => void;
}
