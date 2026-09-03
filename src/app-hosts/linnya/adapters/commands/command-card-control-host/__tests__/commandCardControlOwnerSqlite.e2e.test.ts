import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  CommandExecutionIdentitySchema,
  CommandOwnerGenerationIdSchema,
  CommandProcessHandleSchema,
  parseCommandExecutionTerminal,
  type CommandCardControlPageSnapshotV1,
  type CommandExecutionTerminalV1,
} from '@app/schemas/commands';
import { createLocalCommandExecutionOwner } from 'src/app-hosts/linnya/adapters/commands/process-owner';
import {
  COMMAND_CARD_SETTLEMENT_SCHEMAS,
  SqliteCommandCardSettlementPort,
} from 'src/app-hosts/linnya/adapters/persistence/command-card-settlements';
import {
  CLOSED_COMMAND_EXECUTION_INTERACTION,
  createUnavailableCommandSettledTextOutput,
} from 'src/domains/commands';
import { createBoundedPipeCommandOutputObservation } from 'src/infra/adapters/command-runtime/output';
import { createCommandCardControlHost } from '../orchestration/createCommandCardControlHost';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

const unavailableSettledTextOutput = () => Promise.resolve(
  createUnavailableCommandSettledTextOutput('pipe'),
);

function firstControlTicket(snapshot: CommandCardControlPageSnapshotV1) {
  const capability = snapshot.capabilities[0];
  if (!capability) throw new Error('control capability unavailable');
  return capability.control_ticket;
}

describe('command card control owner + SQLite E2E', () => {
  it('reload 撤销旧票据，取消与自然退出竞态只持久化 owner 胜出的唯一终态', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE conversations (conversation_id TEXT PRIMARY KEY)');
    const conversationId = 'conversation-card-control-e2e';
    db.prepare('INSERT INTO conversations VALUES (?)').run(conversationId);
    for (const ddl of COMMAND_CARD_SETTLEMENT_SCHEMAS) db.exec(ddl);

    const generationId = CommandOwnerGenerationIdSchema.parse(
      'command_owner_718f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b',
    );
    const owner = createLocalCommandExecutionOwner({
      generationId,
      createProcessHandle: () => CommandProcessHandleSchema.parse(
        'command_process_718f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2c',
      ),
    });
    const settlements = new SqliteCommandCardSettlementPort(db);
    const host = createCommandCardControlHost({
      createUuid: (() => {
        let sequence = 1;
        return () => `718f47a8-7f3c-4cc7-8b8c-${String(sequence++).padStart(12, '0')}`;
      })(),
    });
    host.bindRuntime({
      control: owner,
      lifecycle: owner,
      settlements,
      audit: { async record() {} },
    });

    const identity = CommandExecutionIdentitySchema.parse({
      conversation_id: conversationId,
      agent_run_id: 'agent-run-card-control-e2e',
      origin_tool_call_id: 'origin-tool-card-control-e2e',
      command_execution_id: 'command_execution_718f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2d',
      owner_generation_id: generationId,
      created_at_ms: 100,
    });
    const reserved = owner.reserve({ identity, mode: 'pipe' });
    if (reserved.status !== 'reserved') throw new Error(`reservation rejected: ${reserved.code}`);
    const terminal = createDeferred<CommandExecutionTerminalV1>();
    const stopEntered = createDeferred<void>();
    const started = await owner.claimAndStart({
      binding: reserved.binding,
      prepareRuntime: () => ({
        interaction: CLOSED_COMMAND_EXECUTION_INTERACTION,
        outputObservation: createBoundedPipeCommandOutputObservation({
          maxEvents: 32,
          maxCharacters: 4_000,
        }),
        settledTextOutput: unavailableSettledTextOutput(),
        terminal: terminal.promise,
        async start() {
          return { status: 'running', startedAtMs: 200 };
        },
        async stopAndWait() {
          stopEntered.resolve();
          return terminal.promise;
        },
      }),
    });
    expect(started.status).toBe('running');
    expect(owner.publishHandle(reserved.binding).status).toBe('published');

    const originalPage = await host.openRendererPage(41, conversationId);
    if (!originalPage) throw new Error('original renderer page unavailable');
    const reloadedPage = await host.openRendererPage(41, conversationId);
    if (!reloadedPage) throw new Error('reloaded renderer page unavailable');

    await expect(host.cancel({
      ownerId: 41,
      submission: {
        page_ticket: originalPage.page_ticket,
        control_ticket: firstControlTicket(originalPage),
      },
    })).resolves.toEqual({ status: 'stale' });

    const cancelling = host.cancel({
      ownerId: 41,
      submission: {
        page_ticket: reloadedPage.page_ticket,
        control_ticket: firstControlTicket(reloadedPage),
      },
    });
    await stopEntered.promise;
    const naturalTerminal = parseCommandExecutionTerminal({
      protocol_version: 1,
      kind: 'command_execution_terminal',
      identity,
      settled_at_ms: 300,
      outcome: 'execution_ended',
      termination_cause: 'natural_exit',
      process_exit: { status: 'observed', exit_code: 0, signal: null },
      output_drain: { status: 'complete' },
      // 取消已进入平台 stop 流程，即使自然退出先成为唯一终态，也必须证明整树清理成功。
      tree_cleanup: { status: 'succeeded' },
      resource_release: { status: 'succeeded' },
    });
    terminal.resolve(naturalTerminal);

    await expect(cancelling).resolves.toMatchObject({
      status: 'settled',
      settlement: { terminal: { outcome: 'exited', exitCode: 0 } },
    });
    await expect(settlements.listForConversation(conversationId)).resolves.toMatchObject([
      {
        process_handle: reserved.binding.process_handle,
        terminal: { outcome: 'exited', exitCode: 0 },
      },
    ]);
    const replay = await host.readRendererPage({
      ownerId: 41,
      pageTicket: reloadedPage.page_ticket,
    });
    expect(replay?.capabilities).toEqual([]);
    expect(replay?.settlements).toHaveLength(1);
    await owner.endAndWait();
    await host.endAndDrain();
    db.close();
  });
});
