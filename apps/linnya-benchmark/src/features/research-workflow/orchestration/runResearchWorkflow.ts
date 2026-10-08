import path from 'node:path';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import {
  sourcePacketPolicyVersion,
  type ResearchToolMessage,
  type ResearchWorkflowCliPort,
  type StageId,
  type WorkflowState,
  type Projection,
} from '../definitions/researchWorkflow';
import {
  loadManifest,
  loadWorkflowState,
  lockWorkflow,
  writeJson,
} from '../adapters/workflowFiles';
import {
  hashText,
  stagePrompt,
  invalidateStages,
  stageRank,
  workflowWaves,
} from '../functions/workflowFacts';
import { readProjection } from './readProjection';
import { collectStage } from './collectStage';

export interface RunResearchWorkflowOptions {
  manifestFile: string;
  output: string;
  cli: ResearchWorkflowCliPort;
  resumeStage?: StageId;
  /** 只在该阶段所属波次完成后退出；不修改冻结manifest或取消run。 */
  stopAfterStage?: StageId;
  /** 一次CLI观察窗口，不是后端执行预算。超时不会stop。 */
  observationMs?: number;
}

export async function runResearchWorkflow(
  options: RunResearchWorkflowOptions
): Promise<WorkflowState> {
  const loaded = await loadManifest(options.manifestFile);
  if (options.stopAfterStage && !loaded.stages.some(stage => stage.id === options.stopAfterStage))
    throw new Error('Stop stage is not present in the frozen manifest');
  const unlock = await lockWorkflow(options.output);
  try {
    const existing = await loadWorkflowState(options.output);
    const state: WorkflowState = existing ?? {
      schemaVersion: 1,
      manifestHash: loaded.hash,
      stages: [],
    };
    // 并行后审共享状态文件，按快照顺序原子落盘，避免 .pending 重命名竞争。
    let pendingSave = Promise.resolve();
    const save = () => {
      const snapshot = structuredClone(state);
      pendingSave = pendingSave.then(() =>
        writeJson(path.join(options.output, 'state.json'), snapshot)
      );
      return pendingSave;
    };
    if (state.manifestHash !== loaded.hash) {
      for (const stage of state.stages) {
        stage.status = 'stale';
        stage.error = 'Manifest or prompt changed; no run resent';
      }
      await save();
      return state;
    }
    if (!existing) await writeJson(path.join(options.output, 'manifest.freeze.json'), loaded);
    await save();
    const runStage = async (stage: (typeof loaded.stages)[number]): Promise<void> => {
      const projectId = loaded.manifest.projectId;
      const inspectionId = () =>
        loaded.manifest.schemaVersion === 1
          ? state.inspectionConversationId
          : state.stageInspectionConversations?.[stage.id];
      // 独立项目只改变文档归属，不被宣称为文件系统隔离。
      const record = async (message: ResearchToolMessage) => {
        if (loaded.manifest.schemaVersion === 1)
          state.inspectionConversationId = message.conversation_id;
        else {
          state.stageInspectionConversations ??= {};
          state.stageInspectionConversations[stage.id] = message.conversation_id;
        }
        await appendFile(
          path.join(options.output, 'workspace-calls.jsonl'),
          `${JSON.stringify(message)}\n`,
          { mode: 0o600 }
        );
        await save();
      };
      const read = (locator: string) =>
        readProjection(
          { cli: options.cli, projectId, conversationId: inspectionId(), record },
          locator
        );
      const prior = state.stages.filter(
        candidate =>
          stageRank(candidate.id) < stageRank(stage.id) && candidate.projectId === projectId
      );
      const allowed = [
        ...new Set([
          ...stage.allowedMaterials,
          ...prior.flatMap(candidate =>
            candidate.packetDocuments.map(document => document.locator)
          ),
        ]),
      ];
      const prompt = stagePrompt(stage, stage.prompt, allowed);
      let saved = state.stages.find(candidate => candidate.id === stage.id);
      if (saved && ['stale', 'admission_unknown', 'failed', 'cancelled'].includes(saved.status))
        return;
      if (
        saved?.status === 'completed' &&
        stage.sourcePacket &&
        saved.sourcePacketPolicyVersion !== sourcePacketPolicyVersion
      ) {
        invalidateStages(
          state,
          stage.id,
          'Source packet admission policy changed; preserve old records and revalidate in a separate output'
        );
        await save();
        return;
      }
      const inputs: Projection[] = [];
      for (const locator of allowed) inputs.push(await read(locator));
      if (saved) {
        const allInputsMatch =
          saved.promptHash === hashText(prompt) &&
          saved.inputs.length === inputs.length &&
          saved.inputs.every((input, index) => input.versionHash === inputs[index]?.versionHash);
        if (!allInputsMatch) {
          invalidateStages(state, stage.id, 'A bound input version changed');
          await save();
          return;
        }
        if (saved.status === 'completed') {
          for (const frozen of [...saved.outputs, ...saved.packetDocuments]) {
            const current = await read(frozen.locator);
            if (current.versionHash !== frozen.versionHash) {
              invalidateStages(state, stage.id, `Output changed: ${frozen.locator}`);
              await save();
              return;
            }
          }
          return;
        }
      } else {
        saved = {
          id: stage.id,
          projectId,
          promptHash: hashText(prompt),
          status: 'admission_unknown',
          commandApprovals: [],
          inputs,
          outputs: [],
          packetDocuments: [],
          startedAt: Date.now(),
          resumePending: false,
          semanticQuality: 'not_evaluated',
        };
        state.stages.push(saved);
        await mkdir(path.join(options.output, stage.id), { recursive: true });
        await writeFile(path.join(options.output, stage.id, 'prompt.txt'), prompt, { mode: 0o600 });
        // 先保存未知接纳状态：send 响应丢失或进程中断后绝不以新send猜测恢复。
        await save();
        try {
          saved.receipt = await options.cli.send({
            projectId,
            message: prompt,
            agentId: stage.agentId ?? 'default',
            modelId: stage.modelId,
            reasoningEffort: stage.reasoningEffort,
          });
          saved.status = 'observing';
          await save();
        } catch (error: unknown) {
          saved.error = error instanceof Error ? error.message : String(error);
          await save();
          return;
        }
      }
      const receipt = saved.receipt;
      if (!receipt) throw new Error('Observing stage has no receipt');
      try {
        let status = await options.cli.status(receipt.conversation_id, receipt.run_id);
        if (!status) throw new Error('Exact run status unavailable');
        let reconciledResume = false;
        if (saved.resumePending) {
          // 只核对原run；未知resume不自动重试，防止覆盖第一次 continuation。
          if (status.execution_id === (saved.resumeFromExecutionId ?? receipt.execution_id)) {
            saved.error = 'Resume outcome unknown; reconcile exact execution before another resume';
            await save();
            return;
          }
          saved.resumePending = false;
          reconciledResume = true;
        }
        if (
          !reconciledResume &&
          status.status === 'paused' &&
          status.pause?.settled &&
          options.resumeStage === stage.id
        ) {
          saved.resumePending = true;
          saved.resumeFromExecutionId = status.execution_id;
          await save();
          const resumed = await options.cli.resume(receipt.conversation_id, receipt.run_id);
          saved.receipt = { ...receipt, ...resumed.receipt };
          saved.resumePending = false;
          saved.status = 'observing';
          await save();
          status = await options.cli.status(receipt.conversation_id, receipt.run_id);
        }
        while (true) {
          if (!status) throw new Error('Exact run status unavailable');
          saved.commandApprovals = status.command_approvals;
          if (status.command_approvals.some(approval => approval.status === 'awaiting_reply')) {
            // 审批只挂起本轮观察：既不创建新的 run，也不把仍运行的工具伪装成 HITL 断点。
            saved.status = 'waiting_command_approval';
            await appendFile(
              path.join(options.output, stage.id, 'command-approval-observations.jsonl'),
              `${JSON.stringify({ observedAt: Date.now(), snapshot: status })}\n`,
              { mode: 0o600 }
            );
            await save();
            return;
          }
          if (status.status !== 'running' && status.status !== 'pending'
            && !(status.status === 'paused' && !status.pause?.settled)) break;
          saved.status = 'observing';
          await save();
          const observation = await options.cli.watchStatus({
            conversationId: receipt.conversation_id,
            runId: receipt.run_id,
            timeoutMs: options.observationMs ?? 30000,
          });
          await appendFile(
            path.join(options.output, stage.id, 'observations.jsonl'),
            `${JSON.stringify(observation)}\n`,
            { mode: 0o600 }
          );
          status = await options.cli.status(receipt.conversation_id, receipt.run_id);
        }
        saved.status = status.status === 'completed' ? 'collecting' : status.status;
        await save();
        await writeJson(path.join(options.output, stage.id, 'terminal-observation.json'), status);
        if (saved.status === 'paused' || saved.status === 'awaiting_user') {
          await save();
          return;
        }
        saved.finishedAt = Date.now();
        const collected = await collectStage(
          {
            cli: options.cli,
            output: options.output,
            record,
            protectedLocators: [
              ...loaded.manifest.stages.flatMap(item => [
                ...item.allowedMaterials,
                ...item.expectedDocuments,
              ]),
              ...prior.flatMap(item => item.packetDocuments.map(document => document.locator)),
            ],
            inspectionConversationId: inspectionId(),
          },
          stage,
          saved,
          allowed
        );
        saved.outputs = collected.outputs;
        saved.packetDocuments = collected.packetDocuments;
        if (stage.sourcePacket) saved.sourcePacketPolicyVersion = sourcePacketPolicyVersion;
        for (const frozen of saved.inputs) {
          const current = await read(frozen.locator);
          if (current.versionHash !== frozen.versionHash) {
            invalidateStages(state, stage.id, `Input changed during stage: ${frozen.locator}`);
            await save();
            return;
          }
        }
        if (saved.status === 'collecting') saved.status = 'completed';
        delete saved.error;
        await save();
        if (saved.status !== 'completed') return;
      } catch (error: unknown) {
        saved.error = error instanceof Error ? error.message : String(error);
        await appendFile(
          path.join(options.output, stage.id, 'errors.jsonl'),
          `${JSON.stringify({ at: Date.now(), status: saved.status, error: saved.error })}\n`,
          { mode: 0o600 }
        );
        // 已有run保持可观察；终态后的产物/材料缺口不能被重发作者掩盖。
        if (['collecting', 'completed', 'failed', 'cancelled'].includes(saved.status))
          saved.status = 'collection_failed';
        await save();
        return;
      }
    };
    for (const wave of workflowWaves(loaded.manifest)) {
      const results = await Promise.allSettled(
        loaded.stages.filter(stage => wave.includes(stage.id)).map(runStage)
      );
      // 即使一个检查发生异常，也先等待另一条原运行落盘，不留下脱离锁的后台写入。
      const rejected = results.find(result => result.status === 'rejected');
      if (rejected?.status === 'rejected') throw rejected.reason;
      if (wave.some(id => state.stages.find(stage => stage.id === id)?.status !== 'completed'))
        return state;
      if (options.stopAfterStage && wave.includes(options.stopAfterStage)) return state;
    }
    return state;
  } finally {
    await unlock();
  }
}
