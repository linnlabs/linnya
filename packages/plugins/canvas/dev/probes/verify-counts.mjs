import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { CANVAS_DETERMINISTIC_COUNTS } from './performanceDeterministicCounts.ts';

const file = path.resolve(process.argv[2] ?? '_dev_data/canvas-counts-probe/results.json');
const deterministic = process.argv[3] === '--deterministic';
assert(process.argv[3] === undefined || deterministic, 'unknown counts verification mode');
const integer = z.number().int().nonnegative();
const sceneSchema = z.object({ cards: integer, edges: integer, viewportCards: integer, renderableCards: integer, rasterCards: integer,
  bitmaps: integer, rasterTiles: integer, bitmapBytes: integer, bitmapBudgetBytes: integer,
  identityPages: integer, identityEntries: integer, identityBytes: integer, identityCanvasBytes: integer,
  estimatedTextureBytes: integer, textureBudgetBytes: integer,
  spatialCards: integer, spatialCandidateCards: integer, spatialQueryCards: integer, spatialHitCandidates: integer,
  spatialCachedCells: integer, spatialCellCapacity: integer });
const queueSchema = z.object({ pending: integer, running: z.boolean(), failed: integer, peakPending: integer,
  peakBatchSize: integer, capacity: integer, batchSize: integer, requestedTiles: integer, requestedPixels: integer });
const cameraSchema = z.object({ x: z.number().finite(), y: z.number().finite(), zoom: z.number().finite().positive() });
const settledSchema = z.object({ settled: z.literal(true), ms: z.number().finite().nonnegative(), stats: queueSchema, camera: cameraSchema });
const countsSchema = z.object({ expectedVisibleIds: z.array(z.string()), actualVisibleIds: z.array(z.string()),
  hits: z.array(z.object({ expected: z.string().nullable(), actual: z.string().nullable(), candidates: integer })),
  invalidRegions: integer, visibleRegions: integer, scene: sceneSchema, queue: queueSchema });
const reportSchema = z.object({ fixtureVersion: z.literal('production-dom-v5-body-baseline'), source: z.object({ commit: z.string(), dirty: z.boolean() }),
  renderingProfile: z.enum(['offscreen-counts', 'offscreen-swiftshader', 'visible-hardware']),
  validHardwareRun: z.boolean(),
  verificationProfile: z.object({ kind: z.literal(CANVAS_DETERMINISTIC_COUNTS.kind),
    bodyWaitBudgetMs: z.literal(CANVAS_DETERMINISTIC_COUNTS.bodyWaitBudgetMs),
    referenceBodyWindowMs: z.literal(CANVAS_DETERMINISTIC_COUNTS.referenceBodyWindowMs) }).strict().optional(),
  reports: z.array(z.object({ count: z.number().int().positive(), clustered: z.boolean(), counts: countsSchema, close: z.object({ camera: cameraSchema }),
    bodySettled: settledSchema, zoomSettled: settledSchema,
    pan: z.object({ failures: z.array(z.string()), scene: sceneSchema, queue: queueSchema }),
    zoom: z.object({ failures: z.array(z.string()), scene: sceneSchema, queue: queueSchema }) })) });
const result = reportSchema.parse(JSON.parse(await readFile(file, 'utf8')));
if (deterministic) {
  assert.deepEqual(result.verificationProfile, CANVAS_DETERMINISTIC_COUNTS, 'CI requires its explicit deterministic profile');
  assert.equal(result.validHardwareRun, false, 'shared CI cannot provide hardware timing qualification');
  assert.notEqual(result.renderingProfile, 'visible-hardware');
}
const rows = [], seen = new Set();
for (const report of result.reports) {
  const key = `${report.count}:${report.clustered}`; assert(!seen.has(key), `duplicate fixture ${key}`); seen.add(key);
  if (deterministic) assert.deepEqual(report.bodySettled.camera, report.close.camera, `${key}: cold body readiness must belong to the original close camera`);
  assert.deepEqual(report.counts.actualVisibleIds, report.counts.expectedVisibleIds, `${key}: viewport oracle`);
  assert.equal(report.counts.invalidRegions, 0, `${key}: local visible regions outside card`);
  for (const hit of report.counts.hits) { assert.equal(hit.actual, hit.expected, `${key}: indexed hit differs from linear oracle`); assert(hit.candidates <= report.count); }
  for (const scene of [report.pan.scene, report.zoom.scene, report.counts.scene]) {
    assert.equal(scene.cards, report.count); assert.equal(scene.spatialCards, report.count); assert.equal(scene.edges, Math.ceil(report.count * 1.2));
    assert(scene.renderableCards <= scene.viewportCards); assert(scene.rasterCards <= scene.renderableCards);
    assert(scene.viewportCards <= scene.spatialCandidateCards); assert(scene.spatialCandidateCards <= scene.cards);
    assert(scene.spatialQueryCards <= scene.spatialCandidateCards); assert(scene.spatialCachedCells <= scene.spatialCellCapacity);
    assert(scene.bitmaps <= scene.cards); assert(scene.rasterTiles >= scene.bitmaps); assert(scene.bitmapBytes <= scene.bitmapBudgetBytes);
    assert.equal(scene.estimatedTextureBytes, scene.bitmapBytes + scene.identityBytes);
    assert(scene.estimatedTextureBytes <= scene.textureBudgetBytes); assert.equal(scene.identityCanvasBytes, scene.identityBytes);
  }
  for (const queue of [report.pan.queue, report.zoom.queue, report.counts.queue, report.bodySettled.stats, report.zoomSettled.stats]) {
    assert.equal(queue.failed, 0); assert(queue.peakPending <= queue.capacity); assert(queue.peakBatchSize <= queue.batchSize);
    assert(queue.pending <= queue.capacity); assert(queue.requestedPixels >= queue.requestedTiles);
  }
  assert.deepEqual(report.pan.failures, []); assert.deepEqual(report.zoom.failures, []);
  assert.equal(report.counts.queue.pending, 0); assert.equal(report.counts.queue.running, false);
  if (!report.clustered) {
    assert(report.counts.scene.viewportCards < report.count, `${key}: close viewport did not cull fixture`);
    assert(report.counts.hits.every(hit => hit.candidates < report.count), `${key}: hit index scanned whole scene`);
  }
  rows.push({ count: report.count, clustered: report.clustered, visible: report.counts.scene.viewportCards,
    exposed: report.counts.scene.renderableCards, candidates: report.counts.scene.spatialCandidateCards,
    hitCandidates: Math.max(...report.counts.hits.map(hit => hit.candidates)), tiles: report.counts.scene.rasterTiles,
    bitmapBytes: report.counts.scene.bitmapBytes, identityPages: report.counts.scene.identityPages,
    identityBytes: report.counts.scene.identityBytes, estimatedTextureBytes: report.counts.scene.estimatedTextureBytes,
    peakPending: report.counts.queue.peakPending, peakBatchSize: report.counts.queue.peakBatchSize,
    bodyWaitMs: report.bodySettled.ms, bodyExceededFiveSecondReference: report.bodySettled.ms > 5000, zoomWaitMs: report.zoomSettled.ms });
}
assert.deepEqual([...seen].sort(), [250, 2500, 12000].flatMap(count => [`${count}:false`, `${count}:true`]).sort(), 'CI requires all three scales and both distributions');
for (const count of new Set(result.reports.map(report => report.count))) assert(seen.has(`${count}:true`) && seen.has(`${count}:false`), `missing distribution ${count}`);
const summary = { source: result.source, renderingProfile: result.renderingProfile, ...(result.verificationProfile ? { verificationProfile: result.verificationProfile } : {}),
  passed: true, checkedRows: rows.length, rows };
await writeFile(path.join(path.dirname(file), 'counts-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
