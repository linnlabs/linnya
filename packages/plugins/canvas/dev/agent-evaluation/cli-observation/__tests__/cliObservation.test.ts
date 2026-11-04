import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BackendPluginCliContribution, BackendPluginCliExecutionContext, BackendPluginCliPlan, BackendPluginCliResult } from '@plugin/backend/pluginCli';
import type { PluginBackendContribution } from '@plugin/backend/pluginContribution';
import { z } from 'zod';
import { createCanvasCliObservation } from '../createCanvasCliObservation';
import { observeCanvasPluginCli } from '../observeCanvasPluginCli';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'canvas-cli-observation-')); directories.push(root);
  const directory = path.join(root, 'evidence');
  const observation = createCanvasCliObservation({ evidenceDirectory: directory, observationSourceRevision: 'a'.repeat(40), productionSourceRevision: 'b'.repeat(40), originalBackendSha256: 'c'.repeat(64), payloadManifestSha256: 'd'.repeat(64) });
  const event = z.object({ id: z.number(), kind: z.string(), facts: z.record(z.string(), z.unknown()) });
  const seal = z.object({ status: z.enum(['complete', 'partial']), writeFailed: z.boolean(), pending: z.array(z.object({ id: z.number(), stage: z.string() })) });
  const records = () => readdirSync(directory).filter(name => /^\d/.test(name)).map(name => event.parse(JSON.parse(readFileSync(path.join(directory, name), 'utf8'))));
  return { root, directory, observation, records, seal: () => seal.parse(JSON.parse(readFileSync(path.join(directory, 'seal.json'), 'utf8'))) };
}
function plugin(cli: BackendPluginCliContribution): PluginBackendContribution {
  return { meta: { id: 'canvas', name: 'Canvas', version: '0.1.0', description: 'fixture', developer: 'Linnya', builtin: true }, pluginCli: cli,
    runtimeEffects: [{ id: 'original-lifecycle', activate: vi.fn(), deactivate: vi.fn() }], ownedTables: ['fixture'], rendererPush: { channels: ['fixture'] }, hiddenWorkers: [] };
}
const input = { argv: ['apply', 'workspace:/fixture.canvas', '--ops-file', 'batch.json'], invocationId: 'invocation-1', conversationRoot: '/conversation' };
const access: BackendPluginCliPlan['access'] = { internalDataAccess: 'required', conversationFiles: 'write', externalFiles: 'denied', network: 'denied', guiControl: 'denied', localIpcControl: 'denied' };

it('封装一次正式execute，保this/参数/权限/原始响应/其余贡献引用，不读取hostContext', async () => {
  const f = fixture(), response = { exitCode: 8, stdout: '{"error":"失败"}\r\n\u0000', stderr: '原样 stderr\n' };
  const context = { conversationId: 'actual-conversation', agentRunId: 'actual-run', projectId: 'actual-project', signal: new AbortController().signal,
    get hostContext(): unknown { throw new Error('host_context_must_not_be_read'); } };
  const originalPromise = Promise.resolve(response);
  const execute = vi.fn(function (this: BackendPluginCliPlan, value: BackendPluginCliExecutionContext) { expect(this).toBe(plan); expect(value).toBe(context); return originalPromise; });
  const plan: BackendPluginCliPlan = { access, execute };
  const cli: BackendPluginCliContribution = { prepare(value) { expect(this).toBe(cli); expect(value).toBe(input); return { status: 'ready', plan }; } };
  const prepare = vi.spyOn(cli, 'prepare'), original = plugin(cli), observed = observeCanvasPluginCli(original, f.observation);
  for (const [key, value] of Object.entries(original)) if (key !== 'pluginCli') expect(Reflect.get(observed, key)).toBe(value);
  const prepared = observed.pluginCli?.prepare(input); expect(prepared?.status).toBe('ready');
  if (prepared?.status !== 'ready') throw new Error('expected_ready');
  expect(prepared.plan.access).toBe(access); const execution = prepared.plan.execute(context);
  expect(execution).toBe(originalPromise); expect(await execution).toBe(response);
  expect(prepare).toHaveBeenCalledTimes(1); expect(execute).toHaveBeenCalledTimes(1);
  f.observation.seal();
  expect(f.records().find(event => event.kind === 'execute-start')?.facts.identity).toEqual({ conversationId: 'actual-conversation', agentRunId: 'actual-run', projectId: 'actual-project' });
  expect(f.records().find(event => event.kind === 'execute-result')?.facts.result).toEqual(response);
  expect(f.seal().status).toBe('complete'); expect(statSync(path.join(f.directory, 'session.json')).mode & 0o777).toBe(0o600);
});

it('prepare completed原对象直接返回，未冻结身份不推断run，不保存搜索词或外部ops路径', () => {
  const f = fixture(), result: BackendPluginCliResult = { exitCode: 8, stdout: 'invalid\n', stderr: '' };
  const completed = { status: 'completed', result } satisfies ReturnType<BackendPluginCliContribution['prepare']>;
  const observed = observeCanvasPluginCli(plugin({ prepare: () => completed }), f.observation);
  expect(observed.pluginCli?.prepare({ ...input, argv: ['find', 'workspace:/fixture.canvas', 'private-search-term', '--ops-file', '../../outside'] })).toBe(completed);
  f.observation.seal(); const text = JSON.stringify(f.records());
  expect(text).not.toContain('private-search-term'); expect(text).not.toContain('../../outside');
  expect(f.records()[0].facts.input).toMatchObject({ command: 'find', managedOpsPath: null, opsPathOutsideConversation: true });
  expect(f.records()[1].facts.attribution).toBe('unattributed-no-execution-context'); expect(f.seal().status).toBe('complete');
});

it('prepare与execute抛出原异常对象，观测写冲突既不覆盖业务结果也不覆写已有证据', async () => {
  const f = fixture(), prepareError = new Error('original-prepare'), executeError = new Error('original-execute');
  const first = observeCanvasPluginCli(plugin({ prepare() { throw prepareError; } }), f.observation);
  try { first.pluginCli?.prepare(input); throw new Error('expected_prepare_error'); } catch (error) { expect(error).toBe(prepareError); }
  const second = observeCanvasPluginCli(plugin({ prepare: () => ({ status: 'ready', plan: { access, execute: () => Promise.reject(executeError) } }) }), f.observation);
  const prepared = second.pluginCli?.prepare(input); if (prepared?.status !== 'ready') throw new Error('expected_ready');
  await expect(prepared.plan.execute({ hostContext: null, signal: new AbortController().signal })).rejects.toBe(executeError);
  const synchronous = observeCanvasPluginCli(plugin({ prepare: () => ({ status: 'ready', plan: { access, execute() { throw executeError; } } }) }), f.observation).pluginCli?.prepare(input);
  if (synchronous?.status !== 'ready') throw new Error('expected_ready');
  try { synchronous.plan.execute({ hostContext: null, signal: new AbortController().signal }); throw new Error('expected_sync_error'); } catch (error) { expect(error).toBe(executeError); }
  f.observation.seal(); expect(f.seal().status).toBe('complete');
  const failed = fixture(); writeFileSync(path.join(failed.directory, '000001.json'), 'do not overwrite');
  const response = { exitCode: 0, stdout: 'success\n', stderr: '' }; const completed = { status: 'completed', result: response } satisfies ReturnType<BackendPluginCliContribution['prepare']>;
  expect(observeCanvasPluginCli(plugin({ prepare: () => completed }), failed.observation).pluginCli?.prepare(input)).toBe(completed);
  failed.observation.seal(); expect(failed.seal()).toMatchObject({ status: 'partial', writeFailed: true });
  expect(readFileSync(path.join(failed.directory, '000001.json'), 'utf8')).toBe('do not overwrite');
});

it('原Promise拒绝时落证I/O失败只置partial，不替换原rejection或制造额外未处理拒绝', async () => {
  const f = fixture(), error = new Error('original-rejection');
  let reject: ((error: Error) => void) | undefined;
  const originalPromise = new Promise<BackendPluginCliResult>((_resolve, fail) => { reject = fail; });
  const prepared = observeCanvasPluginCli(plugin({ prepare: () => ({ status: 'ready', plan: { access, execute: () => originalPromise } }) }), f.observation).pluginCli?.prepare(input);
  if (prepared?.status !== 'ready' || !reject) throw new Error('expected_ready');
  const returned = prepared.plan.execute({ hostContext: null, signal: new AbortController().signal }); expect(returned).toBe(originalPromise);
  rmSync(f.directory, { recursive: true }); reject(error);
  await expect(returned).rejects.toBe(error);
  // 让Node经过未处理拒绝检查；writer的I/O错误不可泄漏成另一个Promise rejection。
  await new Promise<void>(resolve => setImmediate(resolve));
  mkdirSync(f.directory); f.observation.seal(); expect(f.seal()).toMatchObject({ status: 'partial', writeFailed: true });
});

it('未执行plan、在途execute均partial；没有正常进程seal不能宣完整，不覆写已有session', async () => {
  const f = fixture(); let finish: ((result: BackendPluginCliResult) => void) | undefined;
  const original = plugin({ prepare: () => ({ status: 'ready', plan: { access, execute: () => new Promise(resolve => { finish = resolve; }) } }) });
  const observed = observeCanvasPluginCli(original, f.observation), prepared = observed.pluginCli?.prepare(input);
  if (prepared?.status !== 'ready') throw new Error('expected_ready');
  expect(readdirSync(f.directory)).not.toContain('seal.json');
  const promise = prepared.plan.execute({ hostContext: null, signal: new AbortController().signal });
  f.observation.seal(); expect(f.seal()).toMatchObject({ status: 'partial', pending: [{ id: 1, stage: 'execute' }] });
  if (!finish) throw new Error('expected_pending_execute'); finish({ exitCode: 0, stdout: '', stderr: '' }); await promise;
  const awaiting = fixture(); observeCanvasPluginCli(original, awaiting.observation).pluginCli?.prepare(input); awaiting.observation.seal();
  expect(awaiting.seal()).toMatchObject({ status: 'partial', pending: [{ id: 1, stage: 'awaiting-execute' }] });
  const previous = readFileSync(path.join(f.directory, 'session.json'));
  const duplicate = createCanvasCliObservation({ evidenceDirectory: f.directory, observationSourceRevision: 'new', productionSourceRevision: 'new', originalBackendSha256: 'new', payloadManifestSha256: 'new' });
  duplicate.start(input); duplicate.seal(); expect(readFileSync(path.join(f.directory, 'session.json'))).toEqual(previous);
});
