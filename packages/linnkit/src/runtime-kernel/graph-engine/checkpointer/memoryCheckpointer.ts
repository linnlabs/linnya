import { ENGINE_STATE_SCHEMA_VERSION, type EngineState } from '../types';
import { cloneEngineStateValue } from '../functions/engineStateSnapshot';
import {
  summarizeCheckpoint,
  type Checkpointer,
  type CheckpointListFilter,
  type CheckpointMeta,
  type CheckpointSummary,
} from './base';

export class MemoryCheckpointer implements Checkpointer {
  private store = new Map<string, { state: EngineState; savedAt: number }>();

  private cloneState(state: EngineState): EngineState {
    const cloned: EngineState = {
      ...state,
      schemaVersion: state.schemaVersion ?? ENGINE_STATE_SCHEMA_VERSION,
      local: cloneEngineStateValue(state.local),
    };
    return cloned;
  }

  async load(checkpointKey: string): Promise<EngineState | null> {
    const entry = this.store.get(checkpointKey);
    return entry ? this.cloneState(entry.state) : null;
  }

  async save(checkpointKey: string, state: EngineState): Promise<void> {
    this.store.set(checkpointKey, {
      state: this.cloneState(state),
      savedAt: Date.now(),
    });
  }

  async clear(checkpointKey: string): Promise<void> {
    this.store.delete(checkpointKey);
  }

  async peekMeta(checkpointKey: string): Promise<CheckpointMeta | null> {
    const entry = this.store.get(checkpointKey);
    return entry ? summarizeCheckpoint(checkpointKey, entry.state, entry.savedAt) : null;
  }

  async list(filter: CheckpointListFilter = {}): Promise<CheckpointSummary[]> {
    const summaries = Array.from(this.store.entries())
      .map(([checkpointKey, entry]) => summarizeCheckpoint(checkpointKey, entry.state, entry.savedAt))
      .filter((summary) => (filter.savedAfter === undefined ? true : summary.savedAt > filter.savedAfter))
      .sort((left, right) => right.savedAt - left.savedAt);

    if (filter.limit === undefined) {
      return summaries;
    }

    return summaries.slice(0, filter.limit);
  }
}
