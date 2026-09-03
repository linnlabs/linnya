import path from 'node:path';
import os from 'node:os';
import { promises as fsp } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function createTempWorkspaceRoot(prefix: string): Promise<string> {
  return await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function resetWorkspaceRootAfterEnvChange(): Promise<void> {
  const pathManager = await import('src/shared/utils/pathManager');
  pathManager.resetWorkspaceRootToDefault();
}

async function loadAfterAuditFile(baseDir: string): Promise<Record<string, unknown>> {
  const auditRoot = path.join(baseDir, 'Documents', 'LLMRunAudit');
  const conversationDirs = await fsp.readdir(auditRoot);
  expect(conversationDirs.length).toBe(1);
  const runDir = path.join(auditRoot, conversationDirs[0]!);
  const files = await fsp.readdir(runDir);
  const afterFile = files.find((name) => name.endsWith('.after_context_manager.json'));
  expect(afterFile).toBeTruthy();
  const raw = await fsp.readFile(path.join(runDir, afterFile!), 'utf8');
  return parseJsonRecord(raw, 'after audit');
}

async function loadToolProtocolErrorsAuditFile(baseDir: string): Promise<Record<string, unknown>> {
  const auditRoot = path.join(baseDir, 'Documents', 'LLMRunAudit');
  const conversationDirs = await fsp.readdir(auditRoot);
  expect(conversationDirs.length).toBe(1);
  const runDir = path.join(auditRoot, conversationDirs[0]!);
  const files = await fsp.readdir(runDir);
  const protocolFile = files.find((name) => name.endsWith('.tool_protocol_errors.json'));
  expect(protocolFile).toBeTruthy();
  const raw = await fsp.readFile(path.join(runDir, protocolFile!), 'utf8');
  return parseJsonRecord(raw, 'tool protocol errors audit');
}

async function loadRunAuditDirectory(baseDir: string): Promise<{ runDir: string; files: string[] }> {
  const auditRoot = path.join(baseDir, 'Documents', 'LLMRunAudit');
  const conversationDirs = await fsp.readdir(auditRoot);
  expect(conversationDirs).toHaveLength(1);
  const runDir = path.join(auditRoot, conversationDirs[0]!);
  return { runDir, files: await fsp.readdir(runDir) };
}

describe('LLM run audit', () => {
  afterEach(async () => {
    delete process.env.LINNYA_DEV_MODE;
    delete process.env.LINNYA_LLM_RUN_AUDIT;
    delete process.env.LINNYA_LLM_RUN_AUDIT_REMINDER_MAX_ENTRIES_PER_RUNKEY;
    delete process.env.LINNYA_LLM_RUN_AUDIT_PROTOCOL_ERROR_MAX_ENTRIES_PER_RUNKEY;
    delete process.env.LINNYA_WORKSPACE_DIR;
    vi.resetModules();
  });

  it('creates and incrementally updates an atomic checkpoint, then removes it after final flush', async () => {
    const workspaceRoot = await createTempWorkspaceRoot('llm-audit-checkpoint-');
    process.env.LINNYA_DEV_MODE = 'true';
    process.env.LINNYA_LLM_RUN_AUDIT = '1';
    process.env.LINNYA_WORKSPACE_DIR = workspaceRoot;
    vi.resetModules();
    await resetWorkspaceRootAfterEnvChange();

    const audit = await import('../index');

    await audit.runWithLLMAuditContext(
      {
        conversationId: 'conv_checkpoint',
        runId: 'turn_checkpoint',
      },
      async () => {
        const initial = await loadRunAuditDirectory(workspaceRoot);
        const checkpointName = initial.files.find((name) => name.endsWith('.in_progress.json'));
        expect(checkpointName).toBeTruthy();
        expect(JSON.parse(await fsp.readFile(path.join(initial.runDir, checkpointName!), 'utf8'))).toMatchObject({
          stage: 'in_progress',
          seq: 0,
        });

        audit.recordAfterContextManager({
          llmMessages: [{ role: 'user', content: 'checkpoint this request' }],
          toolNames: ['read_file'],
        });
        await new Promise((resolve) => setTimeout(resolve, 650));

        const updated = parseJsonRecord(
          await fsp.readFile(path.join(initial.runDir, checkpointName!), 'utf8'),
          'checkpoint audit',
        );
        expect(readNumberAtPath(updated, ['seq'])).toBeGreaterThan(0);
        expect(readAtPath(updated, ['byRunKey', 'root', 'after', 'payload', 'llmMessages'])).toEqual([
          { role: 'user', content: 'checkpoint this request' },
        ]);

        await audit.flushRunContextManagerAuditToDisk();
        const finalizedFiles = await fsp.readdir(initial.runDir);
        expect(finalizedFiles.some((name) => name.endsWith('.in_progress.json'))).toBe(false);
        expect(finalizedFiles.filter((name) => name.includes('.tmp-'))).toEqual([]);
      },
    );
  });

  it('preserves opaque provider continuations without interpreting payload fields', async () => {
    const workspaceRoot = await createTempWorkspaceRoot('llm-audit-opaque-continuation-');
    process.env.LINNYA_DEV_MODE = 'true';
    process.env.LINNYA_LLM_RUN_AUDIT = '1';
    process.env.LINNYA_WORKSPACE_DIR = workspaceRoot;
    vi.resetModules();
    await resetWorkspaceRootAfterEnvChange();

    const audit = await import('../index');

    await audit.runWithLLMAuditContext(
      {
        conversationId: 'conv_opaque_continuation',
        runId: 'turn_opaque_continuation',
        traceId: 'trace_opaque_continuation',
      },
      async () => {
        audit.recordAfterContextManager({
          llmMessages: [
            {
              role: 'assistant',
              content: null,
              provider_continuations: ['first', 'second'].map(value => ({
                schema_version: 2,
                producer: {
                  model_id: 'reasoner',
                  endpoint_id: 'example-reasoner',
                  api_surface: 'openai_chat_completions',
                  capability_id: 'test:reasoning-codec',
                  endpoint_model_id: 'reasoner-upstream',
                },
                kind: 'test:opaque-state',
                payload: { value },
              })),
              tool_calls: [
                { id: 'call_read', type: 'function', function: { name: 'read_file', arguments: '{}' } },
              ],
            },
          ],
          toolNames: ['read_file'],
        });
        await audit.flushRunContextManagerAuditToDisk();
      }
    );

    const after = await loadAfterAuditFile(workspaceRoot);
    expect(readAtPath(after, ['root', 'payload', 'llmMessages', '0', 'provider_continuations'])).toEqual([
      {
        schema_version: 2,
        producer: {
          model_id: 'reasoner',
          endpoint_id: 'example-reasoner',
          api_surface: 'openai_chat_completions',
          capability_id: 'test:reasoning-codec',
          endpoint_model_id: 'reasoner-upstream',
        },
        kind: 'test:opaque-state',
        payload: { value: 'first' },
      },
      {
        schema_version: 2,
        producer: {
          model_id: 'reasoner',
          endpoint_id: 'example-reasoner',
          api_surface: 'openai_chat_completions',
          capability_id: 'test:reasoning-codec',
          endpoint_model_id: 'reasoner-upstream',
        },
        kind: 'test:opaque-state',
        payload: { value: 'second' },
      },
    ]);
  });

  it('persists both context-manager messages and materialized LLM messages in after audit', async () => {
    const workspaceRoot = await createTempWorkspaceRoot('llm-audit-context-and-llm-');
    process.env.LINNYA_DEV_MODE = 'true';
    process.env.LINNYA_LLM_RUN_AUDIT = '1';
    process.env.LINNYA_WORKSPACE_DIR = workspaceRoot;
    vi.resetModules();
    await resetWorkspaceRootAfterEnvChange();

    const audit = await import('../index');

    await audit.runWithLLMAuditContext(
      {
        conversationId: 'conv_context_and_llm',
        runId: 'turn_context_and_llm',
        traceId: 'trace_context_and_llm',
      },
      async () => {
        audit.recordAfterContextManager({
          contextMessages: [
            {
              id: 'msg_tool_call',
              role: 'assistant',
              type: 'tool_calls',
              content: '',
              timestamp: 1,
              metadata: {
                tool_calls: [
                  { id: 'call_1', type: 'function', function: { name: 'write_file', arguments: '{}' } },
                ],
              },
            },
          ],
          llmMessages: [
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call_1', type: 'function', function: { name: 'write_file', arguments: '{}' } },
              ],
            },
          ],
          toolNames: ['write_file'],
        });
        await audit.flushRunContextManagerAuditToDisk();
      }
    );

    const after = await loadAfterAuditFile(workspaceRoot);
    expect(readAtPath(after, ['root', 'payload', 'contextMessages', '0', 'id'])).toBe('msg_tool_call');
    expect(readAtPath(after, ['root', 'payload', 'llmMessages', '0', 'role'])).toBe('assistant');
    expect(readAtPath(after, ['root', 'payload', 'tool_names'])).toEqual(['write_file']);
  });

  it('持久化 durable 图片引用和物化证据，并拒绝 resolved bytes 覆盖安全快照', async () => {
    const workspaceRoot = await createTempWorkspaceRoot('llm-audit-image-refs-');
    process.env.LINNYA_DEV_MODE = 'true';
    process.env.LINNYA_LLM_RUN_AUDIT = '1';
    process.env.LINNYA_WORKSPACE_DIR = workspaceRoot;
    vi.resetModules();
    await resetWorkspaceRootAfterEnvChange();

    const audit = await import('../index');
    const attachment = {
      id: 'attachment-audit',
      kind: 'image',
      resourceId: 'asset-audit',
      mediaType: 'image/png',
      byteLength: 128,
      width: 16,
      height: 8,
      sha256: 'a'.repeat(64),
      fileName: 'audit.png',
    };

    await audit.runWithLLMAuditContext(
      {
        conversationId: 'conv_audit_image_refs',
        runId: 'turn_audit_image_refs',
      },
      async () => {
        audit.recordAfterContextManager({
          contextMessages: [{
            id: 'event-audit-image',
            role: 'user',
            type: 'user_input',
            content: '',
            timestamp: 1,
            attachments: [attachment],
          }],
          llmMessages: [{ role: 'user', content: '', attachments: [attachment] }],
          toolNames: [],
        });
        audit.recordAfterContextManager({
          llmMessages: [{
            role: 'user',
            content: '',
            attachments: [{
              id: attachment.id,
              kind: 'image',
              resourceId: attachment.resourceId,
              mediaType: attachment.mediaType,
              byteLength: attachment.byteLength,
              width: attachment.width,
              height: attachment.height,
              placement: 'user_image',
              bytes: new Uint8Array([1, 2, 3]),
            }],
          }],
        });
        audit.recordLlmInputMaterializationEvidence({
          activeModelId: 'model-audit',
          profileId: 'chat-profile-v1',
          estimatorVersion: 'image-estimator-v1',
          apiSurface: 'openai_chat_completions',
          inputBudget: 1_000,
          nonImageEstimatedTokens: 100,
          attachmentEvidence: [{
            messageIndex: 0,
            attachmentIndex: 0,
            id: attachment.id,
            resourceId: attachment.resourceId,
            placement: 'user_image',
            mediaType: attachment.mediaType,
            byteLength: attachment.byteLength,
            width: attachment.width,
            height: attachment.height,
          }],
        });
        await audit.flushRunContextManagerAuditToDisk();
      },
    );

    const after = await loadAfterAuditFile(workspaceRoot);
    expect(readAtPath(after, ['root', 'payload', 'contextMessages', '0', 'attachments']))
      .toEqual([attachment]);
    expect(readAtPath(after, ['root', 'payload', 'llmMessages', '0', 'attachments']))
      .toEqual([attachment]);
    expect(readAtPath(after, ['root_materialization_attempts', '0', 'payload'])).toMatchObject({
      active_model_id: 'model-audit',
      profile_id: 'chat-profile-v1',
      api_surface: 'openai_chat_completions',
      attachment_evidence: [{
        id: attachment.id,
        resourceId: attachment.resourceId,
        mediaType: attachment.mediaType,
      }],
    });
    const serialized = JSON.stringify(after);
    expect(serialized).not.toContain('draftId');
    expect(serialized).not.toContain('localPath');
    expect(serialized).not.toContain('data:image');
    expect(serialized).not.toContain(';base64,');
    expect(serialized).not.toContain('providerFileId');
    expect(serialized).not.toContain('"bytes"');
  });

  it('persists tool protocol error snapshots with the exact llm messages at that moment', async () => {
    const workspaceRoot = await createTempWorkspaceRoot('llm-audit-tool-protocol-');
    process.env.LINNYA_DEV_MODE = 'true';
    process.env.LINNYA_LLM_RUN_AUDIT = '1';
    process.env.LINNYA_WORKSPACE_DIR = workspaceRoot;
    vi.resetModules();
    await resetWorkspaceRootAfterEnvChange();

    const audit = await import('../index');

    await audit.runWithLLMAuditContext(
      {
        conversationId: 'conv_tool_protocol',
        runId: 'turn_tool_protocol',
        traceId: 'trace_tool_protocol',
      },
      async () => {
        audit.recordAfterContextManager({
          llmMessages: [
            { role: 'system', content: 'Use tools carefully.' },
            { role: 'user', content: 'Write the report to shared memory.' },
          ],
          toolNames: ['sharedmemory_write'],
        });
        audit.recordToolProtocolError({
          toolName: 'sharedmemory_write',
          toolCallId: 'call_sharedmemory_write_1',
          rawArguments: '{"doc_name":"hydrogen_fuel_cell_research"}',
          parsedArguments: { doc_name: 'hydrogen_fuel_cell_research' },
          error: 'Missing required parameter: content',
        });
        audit.recordAfterContextManager({
          llmMessages: [{ role: 'assistant', content: 'This later snapshot should not overwrite the frozen error case.' }],
          toolNames: ['other_tool'],
        });
        await audit.flushRunContextManagerAuditToDisk();
      }
    );

    const protocolErrors = await loadToolProtocolErrorsAuditFile(workspaceRoot);
    const rootErrors = readArrayAtPath(protocolErrors, ['root']);
    expect(rootErrors).toHaveLength(1);
    expect(readAtPath(rootErrors[0], ['payload', 'tool_call', 'toolName'])).toBe('sharedmemory_write');
    expect(readAtPath(rootErrors[0], ['payload', 'protocol_error', 'message']))
      .toBe('Missing required parameter: content');
    expect(readAtPath(rootErrors[0], ['payload', 'llm_request', 'tool_names'])).toEqual(['sharedmemory_write']);
    expect(readAtPath(rootErrors[0], ['payload', 'tool_call', 'rawArgumentsSummary'])).toEqual({
      length: '{"doc_name":"hydrogen_fuel_cell_research"}'.length,
      head: '{"doc_name":"hydrogen_fuel_cell_research"}',
      tail: '{"doc_name":"hydrogen_fuel_cell_research"}',
    });
    expect(readAtPath(rootErrors[0], ['payload', 'llm_request', 'llmMessages'])).toEqual([
      { role: 'system', content: 'Use tools carefully.' },
      { role: 'user', content: 'Write the report to shared memory.' },
    ]);
    expect(readAtPath(protocolErrors, ['replay_input'])).toEqual([
      {
        fixtureId: 'turn_tool_protocol:sharedmemory_write:call_sharedmemory_write_1',
        audit_context: {
          conversationId: 'conv_tool_protocol',
          runId: 'turn_tool_protocol',
          traceId: 'trace_tool_protocol',
          subrunId: undefined,
          parentToolCallId: undefined,
          source: undefined,
        },
        toolName: 'sharedmemory_write',
        toolCallId: 'call_sharedmemory_write_1',
        messages: [
          { role: 'system', content: 'Use tools carefully.' },
          { role: 'user', content: 'Write the report to shared memory.' },
        ],
        tool_names: ['sharedmemory_write'],
        expected_error: 'Missing required parameter: content',
        original_tool_call: {
          rawArguments: '{"doc_name":"hydrogen_fuel_cell_research"}',
          rawArgumentsSummary: {
            length: '{"doc_name":"hydrogen_fuel_cell_research"}'.length,
            head: '{"doc_name":"hydrogen_fuel_cell_research"}',
            tail: '{"doc_name":"hydrogen_fuel_cell_research"}',
          },
          parsedArguments: { doc_name: 'hydrogen_fuel_cell_research' },
        },
      },
    ]);

    const after = await loadAfterAuditFile(workspaceRoot);
    expect(readAtPath(after, ['root_tool_protocol_errors'])).toBeUndefined();
  });

  it('child 审计只输出真实 LLM 观测，不伪装成 subrun lifecycle 汇总', async () => {
    const workspaceRoot = await createTempWorkspaceRoot('llm-audit-child-observation-');
    process.env.LINNYA_DEV_MODE = 'true';
    process.env.LINNYA_LLM_RUN_AUDIT = '1';
    process.env.LINNYA_WORKSPACE_DIR = workspaceRoot;
    vi.resetModules();
    await resetWorkspaceRootAfterEnvChange();

    const audit = await import('../index');
    await audit.runWithLLMAuditContext(
      { conversationId: 'conv_child_audit', runId: 'parent_run' },
      async () => {
        audit.recordAfterContextManager({
          llmMessages: [{ role: 'user', content: 'parent request' }],
        });
        await audit.runWithLLMAuditContext(
          { runId: 'child_run', subrunId: 'subrun_child', parentToolCallId: 'call_delegate' },
          async () => {
            audit.recordBeforeContextManager({ payload: { messages: ['child input'] } });
            audit.recordAfterContextManager({
              llmMessages: [{ role: 'user', content: 'child request' }],
              toolNames: ['read_file'],
            });
            audit.recordAfterContextManagerOnSystemReminderHit({
              llmMessages: [{ role: 'system', content: 'child reminder' }],
              systemReminder: { ruleIds: ['child_rule'] },
            });
            audit.recordRunTranscript({
              transcriptMessages: [{ role: 'assistant', content: 'child transcript' }],
            });
            audit.recordToolProtocolError({
              toolName: 'read_file',
              toolCallId: 'child_call_1',
              error: 'child protocol error',
            });
          },
        );
        await audit.flushRunContextManagerAuditToDisk();
      },
    );

    const after = await loadAfterAuditFile(workspaceRoot);
    expect(readAtPath(after, ['subruns'])).toBeUndefined();
    expect(readAtPath(after, ['subrun_system_reminder_hits'])).toBeUndefined();
    expect(readAtPath(after, ['subrun_transcripts', '0', 'audit_context', 'subrunId']))
      .toBe('subrun_child');
    const protocolErrors = await loadToolProtocolErrorsAuditFile(workspaceRoot);
    expect(readAtPath(protocolErrors, ['subruns'])).toBeUndefined();
    expect(readAtPath(protocolErrors, ['subrun_errors', '0', 'payload', 'protocol_error', 'message']))
      .toBe('child protocol error');
  });

  it('caps reminder and tool protocol error snapshots while reporting dropped entries', async () => {
    const workspaceRoot = await createTempWorkspaceRoot('llm-audit-bounded-snapshots-');
    process.env.LINNYA_DEV_MODE = 'true';
    process.env.LINNYA_LLM_RUN_AUDIT = '1';
    process.env.LINNYA_LLM_RUN_AUDIT_REMINDER_MAX_ENTRIES_PER_RUNKEY = '2';
    process.env.LINNYA_LLM_RUN_AUDIT_PROTOCOL_ERROR_MAX_ENTRIES_PER_RUNKEY = '2';
    process.env.LINNYA_WORKSPACE_DIR = workspaceRoot;
    vi.resetModules();
    await resetWorkspaceRootAfterEnvChange();

    const audit = await import('../index');
    await audit.runWithLLMAuditContext(
      { conversationId: 'conv_bounded', runId: 'turn_bounded' },
      async () => {
        audit.recordAfterContextManager({
          llmMessages: [{ role: 'user', content: 'Run bounded audit checks.' }],
          toolNames: ['write_file'],
        });
        for (const index of [1, 2, 3]) {
          audit.recordAfterContextManagerOnSystemReminderHit({
            llmMessages: [{ role: 'system', content: `reminder ${index}` }],
            systemReminder: { ruleIds: [`rule_${index}`] },
          });
          audit.recordToolProtocolError({
            toolName: 'write_file',
            toolCallId: `call_${index}`,
            error: `protocol error ${index}`,
          });
        }
        await audit.flushRunContextManagerAuditToDisk();
      },
    );

    const after = await loadAfterAuditFile(workspaceRoot);
    const reminderHits = readArrayAtPath(after, ['root_system_reminder_hits']);
    expect(reminderHits).toHaveLength(2);
    expect(reminderHits.map((entry) => readAtPath(entry, ['payload', 'system_reminder', 'rule_ids', '0'])))
      .toEqual(['rule_2', 'rule_3']);
    expect(readAtPath(after, ['root_system_reminder_hits_dropped_count'])).toBe(1);

    const protocolErrors = await loadToolProtocolErrorsAuditFile(workspaceRoot);
    const rootErrors = readArrayAtPath(protocolErrors, ['root']);
    expect(rootErrors).toHaveLength(2);
    expect(rootErrors.map((entry) => readAtPath(entry, ['payload', 'tool_call', 'toolCallId'])))
      .toEqual(['call_2', 'call_3']);
    expect(readAtPath(protocolErrors, ['root_dropped_count'])).toBe(1);
    expect(readArrayAtPath(protocolErrors, ['replay_input'])).toHaveLength(2);
  });
});

function parseJsonRecord(raw: string, label: string): Record<string, unknown> {
  const parseJson: (value: string) => unknown = JSON.parse;
  const value = parseJson(raw);
  if (!isRecord(value)) throw new Error(`Expected ${label} to be an object.`);
  return value;
}

function readAtPath(value: unknown, pathSegments: readonly string[]): unknown {
  let current = value;
  for (const segment of pathSegments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function readArrayAtPath(value: unknown, pathSegments: readonly string[]): unknown[] {
  const result = readAtPath(value, pathSegments);
  if (!Array.isArray(result)) throw new Error(`Expected ${pathSegments.join('.')} to be an array.`);
  return result;
}

function readNumberAtPath(value: unknown, pathSegments: readonly string[]): number {
  const result = readAtPath(value, pathSegments);
  if (typeof result !== 'number') throw new Error(`Expected ${pathSegments.join('.')} to be a number.`);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
