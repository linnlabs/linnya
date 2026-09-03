import { describe, expect, it } from 'vitest';
import {
  getRootBlockDragStateSnapshot,
  publishRootBlockDragEnd,
  publishRootBlockDragStart,
  subscribeRootBlockDragState,
} from './rootBlockDragState';

describe('rootBlockDragState', () => {
  it('publishes the active dragging rootBlock id', () => {
    const snapshots: Array<string | null> = [];
    const unsubscribe = subscribeRootBlockDragState((snapshot) => {
      snapshots.push(snapshot.draggingRootBlockId);
    }, { replayCurrent: true });

    publishRootBlockDragStart('root-a');
    publishRootBlockDragEnd('root-a');
    unsubscribe();

    expect(snapshots).toEqual([null, 'root-a', null]);
    expect(getRootBlockDragStateSnapshot().draggingRootBlockId).toBeNull();
  });

  it('keeps minimal drag source info for drag end orchestration', () => {
    publishRootBlockDragStart('root-info', {
      type: 'rootBlock',
      pos: 12,
    });

    expect(getRootBlockDragStateSnapshot().draggingRootBlockInfo).toEqual({
      id: 'root-info',
      type: 'rootBlock',
      pos: 12,
    });

    publishRootBlockDragEnd('root-info');
  });

  it('ignores empty ids and stale drag end ids', () => {
    publishRootBlockDragStart('');
    expect(getRootBlockDragStateSnapshot().draggingRootBlockId).toBeNull();

    publishRootBlockDragStart('root-active');
    publishRootBlockDragEnd('root-stale');
    expect(getRootBlockDragStateSnapshot().draggingRootBlockId).toBe('root-active');

    publishRootBlockDragEnd('root-active');
    expect(getRootBlockDragStateSnapshot().draggingRootBlockId).toBeNull();
  });
});
