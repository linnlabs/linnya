import { readCanvasVisualSampling, assertSoftwareVisualSampling } from './visualSampling';
import { CanvasCardSchema, readCanvasCardPalette, type CanvasCard } from '../../src/shared';
import { createPixiCanvasKernel, type CanvasKernel } from '../../src/renderer/kernel';
import { createSceneVisualClock, type SceneVisualClock } from './sceneVisualClock';

const source = { kind: 'agent', conversationId: 'visual', runId: 'motion' };
function card(id: string, x: number, y = 30): CanvasCard {
  return CanvasCardSchema.parse({ id, type: 'text', schemaVersion: 1, revision: 1, order: id === 'c1' ? 'a0' : 'b0', locked: false, color: 'white',
    createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0, x, y, width: 200, height: 140, parentId: null,
    data: { contentVersion: 1, content: { type: 'doc', content: [] } } });
}
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const drawn = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
function bitmap(color: string): ImageBitmap {
  const canvas = new OffscreenCanvas(200, 140), context = canvas.getContext('2d'); if (!context) throw new Error('scene_bitmap_context_missing');
  context.fillStyle = color; context.fillRect(0, 0, 200, 140); return canvas.transferToImageBitmap();
}
let current: CanvasKernel | undefined;
let reducedClock: SceneVisualClock | undefined;
function disposeScene() {
  try { current?.destroy(); current = undefined; }
  finally { reducedClock?.restore(); reducedClock = undefined; }
}
async function atSceneTime<T>(probe: (clock: SceneVisualClock) => Promise<T>): Promise<T> {
  disposeScene(); const clock = createSceneVisualClock();
  try { return await probe(clock); }
  finally { try { current?.destroy(); current = undefined; } finally { clock.restore(); } }
}
async function setup() {
  current?.destroy(); document.body.replaceChildren();
  const host = document.createElement('div'); host.style.cssText = 'width:700px;height:300px'; document.body.append(host);
  current = await createPixiCanvasKernel({ host, width: 700, height: 300, resolution: devicePixelRatio });
  const initial = current.readStats();
  if (initial.renders || initial.cards || initial.bitmaps) throw new Error('startup_warm_counted_as_visible_scene_or_body_draw');
  return current;
}
async function sceneVisual(clock: SceneVisualClock) {
  const kernel = await setup(), initial = card('c1', 20), target = { ...initial, x: 330, revision: 2 };
  kernel.setElements([initial]); kernel.setBitmap(initial.id, 1, 'red', bitmap('#e02020')); await drawn();
  const before = await kernel.captureImage('png'); kernel.setElements([target], { animateIds: [initial.id] });
  const start = kernel.readDisplayPosition(initial.id);
  if (start?.x !== 20 || kernel.readStats().sceneTransitions !== 1 || kernel.readRasterReceipt(initial.id, 'red')?.rendered) throw new Error('scene_move_did_not_begin_at_visual_origin');
  const moveDraw = kernel.readStats().renders; clock.advance(56);
  await clock.until(() => kernel.readStats().renders > moveDraw && (kernel.readDisplayPosition(initial.id)?.x ?? 20) > 20, 'scene_move_pulse_or_draw_missing');
  const middlePosition = kernel.readDisplayPosition(initial.id), middle = await kernel.captureImage('png');
  if (!middlePosition || middlePosition.x <= 20 || middlePosition.x >= 330 || initial.x !== 20 || target.x !== 330) throw new Error('scene_move_midpoint_or_immutable_snapshot_mismatch');
  // 拖动开始只冻结此卡当前视觉位置，后来的无关增量仍保持手势起点。
  kernel.setDragPreview([initial.id], 0, 0); const frozen = kernel.readDisplayPosition(initial.id); if (!frozen) throw new Error('scene_drag_missing');
  kernel.setDragPreview([initial.id], 15, 0); kernel.setElements([target, card('c2', 600)]);
  if (Math.abs((kernel.readDisplayPosition(initial.id)?.x ?? -1) - frozen.x - 15) > 0.01) throw new Error('scene_drag_delta_reset_by_unrelated_commit');
  kernel.clearDragPreview(); if (kernel.readDisplayPosition(initial.id)?.x !== 330) throw new Error('scene_drag_cancel_did_not_use_latest_target');
  kernel.setElements([{ ...target, revision: 3, x: 100 }], { animateIds: [initial.id] }); kernel.setEditingCard(initial.id);
  if (kernel.readDisplayPosition(initial.id)?.x !== 100 || kernel.readStats().sceneTransitions) throw new Error('scene_editor_did_not_finish_transition');
  kernel.setElements([{ ...target, revision: 4, x: 200 }], { animateIds: [initial.id] });
  if (kernel.readStats().sceneTransitions || kernel.readDisplayPosition(initial.id)?.x !== 200) throw new Error('scene_live_editor_was_animated');
  kernel.setEditingCard(null); kernel.setElements([initial]);
  kernel.animateCamera({ x: 200, y: 100, zoom: 1.5 }, 320); clock.advance(56);
  await clock.until(() => kernel.readCamera().x > 0, 'scene_camera_pulse_missing');
  const camera = kernel.readCamera(); kernel.setCamera(camera);
  clock.advance(340); await drawn(); if (JSON.stringify(kernel.readCamera()) !== JSON.stringify(camera)) throw new Error('scene_camera_cancel_flew_back');
  kernel.animateCamera({ x: 0, y: 0, zoom: 1 }, 320); kernel.finishTransitions();
  if (kernel.readCamera().x || kernel.readCamera().y || kernel.readCamera().zoom !== 1 || kernel.readStats().cameraTransition) throw new Error('scene_finish_camera_not_synchronous');
  kernel.setElements([{ ...initial, revision: 5, x: 330 }], { animateIds: [initial.id] }); kernel.finishTransitions([initial.id]); await drawn();
  if (!kernel.readRasterReceipt(initial.id, 'red')?.rendered) throw new Error('scene_final_actual_draw_receipt_missing');
  return { before, middle, after: await kernel.captureImage('png'), start, middlePosition, frozen, camera, dpr: kernel.readResolution(), sampling: readCanvasVisualSampling(kernel, 'interactive'), stats: kernel.readStats() };
}
async function sceneOpacityVisual(clock: SceneVisualClock) {
  const kernel = await setup(), bottom = card('c1', 20), top = { ...card('c2', 10, 20), width: 230, height: 170 };
  kernel.setElements([bottom]); kernel.setBitmap(bottom.id, 1, 'magenta', bitmap('#e000dd')); await drawn();
  kernel.setElements([bottom, top], { animateIds: [top.id] });
  if (!kernel.readVisibleCardRegions(bottom.id).length || kernel.hitTest({ x: 50, y: 60 })?.id !== bottom.id) throw new Error('scene_translucent_card_occluded_underlying_body');
  const initial = await kernel.captureImage('png');
  const addDraw = kernel.readStats().renders; clock.advance(64);
  // 活跃过渡每次脉冲都会请求draw；两次真实draw排除仅setElements留下的首个alpha0帧。
  await clock.until(() => kernel.readStats().renders >= addDraw + 2, 'scene_add_pulse_draw_missing');
  if (kernel.readStats().sceneTransitions !== 1) throw new Error('scene_midpoint_completed_before_logical_duration');
  const middle = await kernel.captureImage('png'); clock.advance(96);
  await clock.until(() => !kernel.readStats().sceneTransitions && kernel.readStats().renders > addDraw + 2, 'scene_add_completion_draw_missing');
  const opaque = await kernel.captureImage('png');
  if (kernel.readVisibleCardRegions(bottom.id).length) throw new Error('scene_opaque_card_kept_hidden_underlying_body');
  const old = bitmap('#20c060'); kernel.setBitmap(top.id, 1, 'green', old); await drawn();
  kernel.setElements([bottom], { animateIds: [top.id] }); const removed = await kernel.captureImage('png');
  if (kernel.readCard(top.id) || kernel.readStats().sceneTransitions !== 1 || old.width !== 200) throw new Error('scene_removed_card_was_not_retained_only_for_visual_fade');
  const removeDraw = kernel.readStats().renders; clock.advance(120);
  await clock.until(() => !kernel.readStats().sceneTransitions && kernel.readStats().renders > removeDraw, 'scene_remove_completion_draw_missing');
  const revealed = await kernel.captureImage('png');
  if (old.width || kernel.readStats().sceneTransitions || kernel.readStats().bitmaps !== 1) throw new Error('scene_retired_bitmap_not_released');
  return { initial, middle, opaque, removed, revealed, dpr: kernel.readResolution(), sampling: readCanvasVisualSampling(kernel, 'interactive'), stats: kernel.readStats(),
    logicalTimes: { initial: 0, middle: 64, opaque: 160, removed: 160, revealed: 280 } };
}
async function sceneMapVisual(clock: SceneVisualClock) {
  const kernel = await setup(), initial = CanvasCardSchema.parse({ ...card('c1', 0), width: 1000, height: 300,
    data: { contentVersion: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'RetiringMapTitle' }] }] } } });
  kernel.setElements([initial]); kernel.setCamera({ x: 100, y: 100, zoom: 0.1 }); await drawn();
  const before = await kernel.captureImage('png'); kernel.setElements([], { animateIds: [initial.id] });
  const retiringDraw = kernel.readStats().renders; clock.advance(48);
  await clock.until(() => kernel.readStats().renders >= retiringDraw + 2, 'scene_map_midpoint_draw_missing');
  const middle = await kernel.captureImage('png'); clock.advance(72);
  await clock.until(() => !kernel.readStats().sceneTransitions && kernel.readStats().renders > retiringDraw + 2, 'scene_map_completion_draw_missing');
  const after = await kernel.captureImage('png');
  if (kernel.readStats().sceneTransitions || kernel.readStats().cards) throw new Error('scene_map_retirement_not_finished');
  return { before, middle, after, dpr: kernel.readResolution(), sampling: readCanvasVisualSampling(kernel, 'interactive') };
}
async function identityInkVisual() {
  const kernel = await setup(), initial = CanvasCardSchema.parse({ ...card('c1', 20), width: 500,
    data: { contentVersion: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'IDENTITY 中文纯色' }] }] } } });
  const samples = [];
  for (const dark of [false, true]) for (const color of ['white', 'green', 'purple'] as const) {
    kernel.setElements([{ ...initial, color }]); kernel.setAppearance({ dark, material: 'paper', overview: 'titles' });
    samples.push({ dark, color, title: readCanvasCardPalette(color, dark).title, image: await kernel.captureImage('png'), dpr: kernel.readResolution(), sampling: readCanvasVisualSampling(kernel, 'interactive') });
  }
  return samples;
}
async function identityBoundsVisual() {
  const kernel = await setup(), initial = CanvasCardSchema.parse({ ...card('c1', 20), width: 80, height: 32,
    data: { contentVersion: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '😀中文'.repeat(1000) }] }] } } });
  kernel.setElements([initial]); return { image: await kernel.captureImage('png'), dpr: kernel.readResolution(), sampling: readCanvasVisualSampling(kernel, 'interactive') };
}
async function bitmapAppendVisual() {
  const kernel = await setup(), initial = card('c1', 20); kernel.setElements([initial]);
  const left = bitmap('#e02020'), right = bitmap('#20c060'); let leftClosed = 0, rightClosed = 0;
  const closeLeft = left.close.bind(left), closeRight = right.close.bind(right);
  left.close = () => { leftClosed++; closeLeft(); }; right.close = () => { rightClosed++; closeRight(); };
  kernel.setRasterTiles(initial.id, 1, 'same-content', [{ bitmap: left, x: 0, y: 0, width: 100, height: 140, scale: 1 }]); await drawn();
  const before = await kernel.captureImage('png');
  kernel.setRasterTiles(initial.id, 1, 'same-content', [{ bitmap: right, x: 100, y: 0, width: 100, height: 140, scale: 1 }]);
  const appended = kernel.readStats(); if (appended.fadingCards || appended.rasterTiles !== 2 || leftClosed || rightClosed) throw new Error('same_content_append_rebuilt_or_faded_existing_regions');
  await sleep(48); const after = await kernel.captureImage('png'); kernel.invalidateBitmaps();
  if (leftClosed !== 1 || rightClosed !== 1 || kernel.readStats().bitmapBytes || kernel.readStats().fadingCards) throw new Error('append_bitmap_ownership_not_closed_once');
  return { before, after, appended, leftClosed, rightClosed, dpr: kernel.readResolution(), sampling: readCanvasVisualSampling(kernel, 'interactive') };
}
async function beginReducedScene() {
  disposeScene(); reducedClock = createSceneVisualClock();
  const kernel = await setup(), initial = card('c1', 20); kernel.setElements([initial]); await drawn();
  kernel.setElements([{ ...initial, revision: 2, x: 330 }], { animateIds: [initial.id] }); kernel.animateCamera({ x: 100, y: 60, zoom: 1.2 }, 320);
  return { started: kernel.readStats().sceneTransitions, cameraTransition: kernel.readStats().cameraTransition, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, sampling: readCanvasVisualSampling(kernel, 'interactive') };
}
async function firstBodyVisual(clock: SceneVisualClock) {
  const kernel = await setup(), initial = card('c1', 20); kernel.setElements([initial]);
  const previousRenders = kernel.readStats().renders;
  kernel.setBitmap(initial.id, 1, 'old', bitmap('#e02020'));
  // 未实际显示过的旧纹理按生产合同直接替换；两次RAF不能建立淡入测试的前提。
  await clock.until(() => kernel.readStats().renders > previousRenders && kernel.readRasterReceipt(initial.id, 'old')?.rendered === true,
    'old_visible_bitmap_actual_draw_missing');
  const oldBaseline = { previousRenders, renders: kernel.readStats().renders, receipt: kernel.readRasterReceipt(initial.id, 'old') };
  const requestedAt = performance.now();
  kernel.setBitmap(initial.id, 1, 'current', bitmap('#20c060'));
  const uploaded = kernel.readRasterReceipt(initial.id, 'current');
  if (!uploaded || uploaded.firstPresented || uploaded.rendered || kernel.readRasterReceipt(initial.id, 'old')) throw new Error('uploaded_or_old_bitmap_claimed_current_body_draw');
  clock.advance(64);
  let waitFailure: string | null = null;
  try { await clock.until(() => kernel.readRasterReceipt(initial.id, 'current')?.firstPresented === true, 'new_visible_bitmap_draw_missing_first_receipt'); }
  catch (error) { waitFailure = error instanceof Error ? error.message : String(error); }
  const observedAt = performance.now(), first = kernel.readRasterReceipt(initial.id, 'current'), firstStats = kernel.readStats();
  const fadeImage = await kernel.captureImage('png');
  if (waitFailure || !first?.firstPresented || first.rendered || firstStats.fadingCards !== 1) return {
    failure: 'new_visible_bitmap_draw_missing_first_receipt', fadeImage, dpr: kernel.readResolution(), sampling: readCanvasVisualSampling(kernel, 'interactive'),
    facts: { oldBaseline, requestedAt, observedAt, elapsedMs: observedAt - requestedAt, waitFailure, uploaded, first, firstStats,
      afterCaptureAt: performance.now(), afterCaptureReceipt: kernel.readRasterReceipt(initial.id, 'current'), afterCaptureStats: kernel.readStats() },
  };
  const fadeDraw = kernel.readStats().renders; clock.advance(56);
  await clock.until(() => kernel.readStats().renders > fadeDraw && kernel.readRasterReceipt(initial.id, 'current')?.rendered === true, 'settled_bitmap_draw_missing_receipt');
  const complete = kernel.readRasterReceipt(initial.id, 'current');
  if (!complete?.rendered || !complete.firstPresented) throw new Error('settled_bitmap_draw_missing_receipt');
  const target = { ...initial, revision: 2 };
  kernel.setElements([target], { animateIds: [initial.id], batch: true });
  const sceneStart = kernel.readRasterReceipt(initial.id, 'current');
  if (sceneStart?.firstPresented || sceneStart?.rendered) throw new Error('alpha_zero_scene_claimed_body_visible');
  clock.advance(64);
  await clock.until(() => kernel.readRasterReceipt(initial.id, 'current')?.firstPresented === true, 'visible_scene_draw_missing_first_receipt');
  const sceneFirst = kernel.readRasterReceipt(initial.id, 'current');
  if (!sceneFirst?.firstPresented || sceneFirst.rendered || kernel.readStats().sceneTransitions !== 1) throw new Error('visible_scene_midpoint_receipt_mismatch');
  const sceneImage = await kernel.captureImage('png'), sceneDraw = kernel.readStats().renders; clock.advance(136);
  await clock.until(() => kernel.readStats().renders > sceneDraw && kernel.readRasterReceipt(initial.id, 'current')?.rendered === true, 'scene_settled_bitmap_draw_missing_receipt');
  return { oldBaseline, uploaded, first, complete, sceneStart, sceneFirst, sceneComplete: kernel.readRasterReceipt(initial.id, 'current'), fadeImage, sceneImage, dpr: kernel.readResolution(), sampling: readCanvasVisualSampling(kernel, 'interactive'),
    logicalTimes: { fadeFirst: 64, fadeComplete: 120, sceneFirst: 64, sceneComplete: 200 } };
}
async function documentMetadataVisual() {
  const kernel = await setup(), documentCard = CanvasCardSchema.parse({ ...card('c1', 20), type: 'document', data: { documentId: 'authorized' } });
  kernel.setElements([documentCard]); kernel.setBitmap(documentCard.id, 1, 'cover', bitmap('#20c060'));
  kernel.setCamera({ x: 20, y: 20, zoom: 0.1 }); kernel.setDocumentTitles(new Map([['authorized', 'A']])); await drawn();
  const before = await kernel.captureImage('png'); kernel.setDocumentTitles(new Map([['authorized', 'MMMMMMMM']])); await drawn();
  const renamed = await kernel.captureImage('png'), renders = kernel.readStats().renders;
  kernel.setDocumentTitles(new Map([['authorized', 'MMMMMMMM']])); await drawn();
  if (kernel.readStats().renders !== renders) throw new Error('unchanged_authorized_titles_scheduled_another_draw');
  const cells = kernel.readStats().spatialCellBuilds;
  kernel.setThumbnailCards(new Set([documentCard.id])); await drawn(); const thumbnail = await kernel.captureImage('png');
  kernel.setThumbnailCards(new Set()); await drawn(); const identity = await kernel.captureImage('png');
  if (kernel.readStats().spatialCellBuilds !== cells) throw new Error('preview_preference_rebuilt_unchanged_geometry');
  return { before, renamed, thumbnail, identity, dpr: kernel.readResolution(), sampling: readCanvasVisualSampling(kernel, 'interactive') };
}
async function coldProjectionVisual() {
  const kernel = await setup(), first = card('c1', 250), second = card('c2', 480);
  kernel.setElements([first, second]);
  const initial = kernel.readStats();
  if (initial.viewportCards !== 2 || initial.renderableCards !== 2 || initial.rasterCards !== 2) throw new Error('cold_cards_culled_before_initial_display_positions');
  kernel.setBitmap(first.id, first.revision, 'green', bitmap('#20c060')); await drawn(); const before = await kernel.captureImage('png');
  const moved = { ...first, revision: 2, x: 40 }; kernel.setElements([moved, second]); await drawn();
  const after = kernel.captureImage('png'), current = kernel.readStats();
  if (current.renderableCards !== 2 || current.rasterCards !== 2 || kernel.readDisplayPosition(first.id)?.x !== 40) throw new Error('direct_move_culled_against_previous_display_position');
  return { before, after: await after, initial, current, dpr: kernel.readResolution(), sampling: readCanvasVisualSampling(kernel, 'interactive') };
}
/** 软件交互的合同是即时终态；真实draw和资源归属仍须成立，不能把禁动画当跳过动画门。 */
async function softwareSceneVisual(clock: SceneVisualClock) {
  const kernel = await setup(), sampling = readCanvasVisualSampling(kernel, 'interactive');
  assertSoftwareVisualSampling(sampling);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) throw new Error('software_scene_fixture_requires_no_preference');
  const initial = card('c1', 20), red = bitmap('#e02020'), green = bitmap('#20c060'), cover = bitmap('#2030e0');
  const ownerCloses = [red, green, cover].map(image => {
    const close = image.close.bind(image); let count = 0;
    image.close = () => { count++; close(); }; return () => count;
  });
  kernel.setElements([initial]); kernel.setBitmap(initial.id, 1, 'old', red);
  await clock.until(() => kernel.readRasterReceipt(initial.id, 'old')?.rendered === true, 'software_old_body_actual_draw_missing');
  const before = await kernel.captureImage('png'), beforeDraw = kernel.readStats().renders;
  kernel.setBitmap(initial.id, 1, 'current', green);
  const uploaded = kernel.readRasterReceipt(initial.id, 'current');
  if (!uploaded || uploaded.firstPresented || uploaded.rendered || red.width || kernel.readStats().fadingCards || kernel.readStats().retiringBytes)
    throw new Error('software_new_bitmap_not_immediate_or_upload_claimed_draw');
  await clock.until(() => kernel.readStats().renders > beforeDraw && kernel.readRasterReceipt(initial.id, 'current')?.rendered === true,
    'software_new_body_actual_draw_missing');
  const first = kernel.readRasterReceipt(initial.id, 'current'), firstImage = await kernel.captureImage('png');
  if (!first?.firstPresented || !first.rendered) throw new Error('software_actual_draw_did_not_finish_both_receipts');
  const target = { ...initial, revision: 2, x: 330 }, moveDraw = kernel.readStats().renders;
  kernel.setElements([target], { animateIds: [initial.id], batch: true });
  if (kernel.readDisplayPosition(initial.id)?.x !== 330 || kernel.readStats().sceneTransitions) throw new Error('software_move_not_immediate');
  await clock.until(() => kernel.readStats().renders > moveDraw, 'software_move_actual_draw_missing');
  const moved = await kernel.captureImage('png');
  kernel.setSelection([initial.id]); kernel.setDragPreview([initial.id], 15, 0); kernel.setElements([target, card('c2', 600)]);
  const dragTarget = kernel.readDisplayPosition(initial.id)?.x;
  if (dragTarget !== 345 || kernel.hitTest({ x: 360, y: 80 })?.id !== initial.id) throw new Error('software_drag_or_hit_test_failed');
  kernel.clearDragPreview();
  const finalTarget = kernel.readDisplayPosition(initial.id)?.x;
  if (finalTarget !== 330) throw new Error('software_drag_cancel_ignored_current_target');
  kernel.animateCamera({ x: 100, y: 60, zoom: 1.2 }, 320);
  if (kernel.readCamera().x !== 100 || kernel.readStats().cameraTransition) throw new Error('software_camera_not_immediate');
  kernel.setCamera({ x: 0, y: 0, zoom: 1 }); kernel.setSelection([]);
  const top = { ...card('c3', 320, 20), order: 'c0', width: 230, height: 170 }, addDraw = kernel.readStats().renders;
  kernel.setElements([target, top], { animateIds: [top.id] });
  if (kernel.readStats().sceneTransitions || kernel.readVisibleCardRegions(initial.id).length || kernel.hitTest({ x: 360, y: 80 })?.id !== top.id)
    throw new Error('software_added_card_not_immediately_opaque');
  await clock.until(() => kernel.readStats().renders > addDraw, 'software_added_card_actual_draw_missing');
  const opaque = await kernel.captureImage('png'); kernel.setBitmap(top.id, top.revision, 'cover', cover);
  await clock.until(() => kernel.readRasterReceipt(top.id, 'cover')?.rendered === true, 'software_cover_actual_draw_missing');
  const covered = await kernel.captureImage('png'), removeDraw = kernel.readStats().renders;
  kernel.setElements([target], { animateIds: [top.id] });
  if (kernel.readCard(top.id) || cover.width || kernel.readStats().sceneTransitions || kernel.readStats().bitmaps !== 1
    || !kernel.readVisibleCardRegions(initial.id).length || kernel.hitTest({ x: 360, y: 80 })?.id !== initial.id) throw new Error('software_delete_retained_visual_or_owner');
  await clock.until(() => kernel.readStats().renders > removeDraw, 'software_deleted_card_actual_draw_missing');
  const revealed = await kernel.captureImage('png');
  const map = CanvasCardSchema.parse({ ...initial, x: 0, width: 1000, height: 300,
    data: { contentVersion: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'RetiringMapTitle' }] }] } } });
  kernel.setElements([map]); kernel.setCamera({ x: 100, y: 100, zoom: 0.1 }); await drawn();
  const mapBefore = await kernel.captureImage('png'), mapDraw = kernel.readStats().renders;
  kernel.setElements([], { animateIds: [map.id] });
  if (kernel.readStats().sceneTransitions || kernel.readStats().cards || kernel.readStats().bitmaps) throw new Error('software_map_retirement_not_immediate');
  await clock.until(() => kernel.readStats().renders > mapDraw, 'software_map_removal_actual_draw_missing');
  const mapAfter = await kernel.captureImage('png');
  if ([red, green, cover].some(image => image.width) || ownerCloses.some(readCount => readCount() !== 1)) throw new Error('software_body_owners_not_closed_exactly_once');
  return { sampling, dpr: sampling.resolution, before, firstImage, moved, opaque, covered, revealed, mapBefore, mapAfter, uploaded, first,
    ownerCloses: ownerCloses.map(readCount => readCount()), stats: kernel.readStats(), dragTarget, finalTarget };
}
async function finishReducedScene() {
  const kernel = current, clock = reducedClock; if (!kernel || !clock) throw new Error('scene_fixture_missing');
  await clock.until(() => matchMedia('(prefers-reduced-motion: reduce)').matches && !kernel.readStats().sceneTransitions && !kernel.readStats().cameraTransition, 'scene_reduced_motion_event_missing');
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches || kernel.readStats().sceneTransitions || kernel.readStats().cameraTransition
    || kernel.readDisplayPosition(card('c1', 20).id)?.x !== 330 || kernel.readCamera().x !== 100) throw new Error('scene_reduced_motion_did_not_finish_actual_animation');
  const next = { ...card('c1', 20), x: 500, revision: 3 }; kernel.setElements([next], { animateIds: [next.id] });
  if (kernel.readDisplayPosition(next.id)?.x !== 500 || kernel.readStats().sceneTransitions) throw new Error('scene_reduced_motion_next_update_not_immediate');
  const stats = { ...kernel.readStats(), sampling: readCanvasVisualSampling(kernel, 'interactive') }; disposeScene(); return stats;
}
Object.defineProperties(window, { prepareCanvasSceneVisualProbe: { value: () => atSceneTime(sceneVisual) }, prepareCanvasSceneOpacityVisualProbe: { value: () => atSceneTime(sceneOpacityVisual) }, prepareCanvasSceneMapVisualProbe: { value: () => atSceneTime(sceneMapVisual) },
  prepareCanvasSoftwareSceneProbe: { value: () => atSceneTime(softwareSceneVisual) },
  prepareCanvasIdentityInkProbe: { value: identityInkVisual }, prepareCanvasIdentityBoundsProbe: { value: identityBoundsVisual }, prepareCanvasBitmapAppendProbe: { value: bitmapAppendVisual }, prepareCanvasFirstBodyProbe: { value: () => atSceneTime(firstBodyVisual) }, prepareCanvasDocumentMetadataProbe: { value: documentMetadataVisual }, prepareCanvasColdProjectionProbe: { value: coldProjectionVisual }, beginCanvasReducedSceneProbe: { value: beginReducedScene }, finishCanvasReducedSceneProbe: { value: finishReducedScene }, disposeCanvasSceneProbe: { value: disposeScene } });
