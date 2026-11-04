import { afterEach, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { CanvasCardSchema, type CanvasCamera, type CanvasCard } from '../../../../../shared';
import { CanvasSceneMotion, type CanvasMotionView } from '../CanvasSceneMotion';
import { resolveCanvasDisplayCard } from '../../../motion';

const source = { kind: 'agent', conversationId: 'conversation', runId: 'run' };
const card = (x = 0) => CanvasCardSchema.parse({ id: 'c1', type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white',
  createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0, x, y: 20, width: 200, height: 140, parentId: null,
  data: { contentVersion: 1, content: { type: 'doc', content: [] } } });
function setup(initial: CanvasCard) {
  const view: CanvasMotionView = { card: { ...initial }, container: new Container(), lodAlpha: 1 };
  const removed = vi.fn(), complete = vi.fn(), project = vi.fn(), appeared = vi.fn(); let camera: CanvasCamera = { x: 0, y: 0, zoom: 1 };
  const scene = new CanvasSceneMotion({ removed, complete, project, appeared, camera: next => { camera = next; } }); scene.apply(view);
  return { view, scene, removed, complete, project, appeared, camera: () => camera };
}
afterEach(() => { vi.useRealTimers(); });
it('移动以当前显示接续，finish同步到目标，拖动冻结当前视觉而不修改提交事实', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const initial = card(), target = { ...initial, revision: 2, x: 300 }, state = setup(initial);
  state.scene.start({ id: initial.id, kind: 'move', durationMs: 220 }, state.view, target, performance.now());
  vi.advanceTimersByTime(80); const midway = state.view.container.x;
  expect(midway).toBeGreaterThan(0); expect(midway).toBeLessThan(300); expect(initial.x).toBe(0); expect(target.x).toBe(300);
  const projected = resolveCanvasDisplayCard({ card: target, previous: state.view.card, target, motion: true, editing: false });
  expect(projected.keepMotion).toBe(true); expect(projected.display.x).toBe(midway);
  state.scene.freeze([initial.id]); const origin = state.view.card;
  expect(state.scene.has(initial.id)).toBe(false); expect(state.view.container.x).toBe(midway);
  const unrelatedDelta = resolveCanvasDisplayCard({ card: { ...target, revision: 3, color: 'green' }, previous: { ...origin, x: origin.x + 25 }, target, origin, motion: false, editing: false });
  expect(unrelatedDelta.display.x).toBe(midway + 25); expect(unrelatedDelta.origin?.x).toBe(midway); expect(unrelatedDelta.origin?.color).toBe('green');
  state.scene.start({ id: initial.id, kind: 'move', durationMs: 220 }, state.view, target, performance.now()); state.scene.finish([initial.id]);
  expect(state.view.container.x).toBe(300); expect(state.view.container.scale.x).toBe(1); expect(vi.getTimerCount()).toBe(0); expect(state.project).toHaveBeenCalled();
});
it('新增160ms从96%淡入，删除120ms保留姿态后释放，减少动效立即完成真实过渡', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const initial = card(), state = setup(initial);
  state.scene.start({ id: initial.id, kind: 'add', durationMs: 160 }, state.view, initial, performance.now());
  expect(state.view.container.scale.x).toBe(0.96); expect(state.view.container.alpha).toBe(0); expect(state.appeared).not.toHaveBeenCalled(); expect(state.scene.opaque(initial.id)).toBe(false);
  vi.advanceTimersByTime(80); expect(state.view.container.scale.x).toBeGreaterThan(0.96); expect(state.view.container.alpha).toBe(0.5); expect(state.appeared).toHaveBeenCalledExactlyOnceWith(initial.id);
  state.scene.setEnabled(false); expect(state.view.container.alpha).toBe(1); expect(state.view.container.scale.x).toBe(1); expect(state.scene.opaque(initial.id)).toBe(true);
  state.scene.setEnabled(true); state.scene.start({ id: initial.id, kind: 'remove', durationMs: 120 }, state.view, undefined, performance.now());
  vi.advanceTimersByTime(56); expect(state.removed).not.toHaveBeenCalled(); expect(state.view.container.alpha).toBeLessThan(1);
  state.scene.setEnabled(false); expect(state.removed).toHaveBeenCalledExactlyOnceWith(initial.id); expect(vi.getTimerCount()).toBe(0);
  const target = { ...initial, x: 800 }; state.scene.start({ id: initial.id, kind: 'move', durationMs: 220 }, state.view, target, performance.now());
  expect(state.view.container.x).toBe(800); expect(state.scene.readStats().sceneTransitions).toBe(0);
});
it('相机飞行被用户取消后留在当前视口，dispose终止未完成卡片与相机任务', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const state = setup(card()), target = { x: 400, y: 200, zoom: 2 };
  state.scene.fly(state.camera(), target, 320); vi.advanceTimersByTime(80);
  const camera = state.camera(); expect(camera.x).toBeGreaterThan(0); expect(camera.x).toBeLessThan(400);
  state.scene.cancelCamera(); vi.advanceTimersByTime(400); expect(state.camera()).toBe(camera);
  state.scene.fly(camera, target, 320); state.scene.finish(); expect(state.camera()).toEqual(target); expect(vi.getTimerCount()).toBe(0);
  state.scene.start({ id: state.view.card.id, kind: 'batch', durationMs: 200 }, state.view, state.view.card, performance.now());
  state.scene.fly(target, { ...target, zoom: 1 }, 320); state.scene.dispose();
  expect(state.scene.readStats()).toEqual({ sceneTransitions: 0, cameraTransition: false }); expect(vi.getTimerCount()).toBe(0);
});
