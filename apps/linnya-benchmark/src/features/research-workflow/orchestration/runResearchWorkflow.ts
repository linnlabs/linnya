import path from 'node:path';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import {
  stageIds,
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
import { hashText, stagePrompt, invalidateStages } from '../functions/workflowFacts';
import { readProjection } from './readProjection';
import { collectStage } from './collectStage';

export interface RunResearchWorkflowOptions {
  manifestFile: string;
  output: string;
  cli: ResearchWorkflowCliPort;
  resumeStage?: StageId;
  /** 一次CLI观察窗口，不是后端执行预算。超时不会stop。 */
  observationMs?: number;
}

export async function runResearchWorkflow(
  options: RunResearchWorkflowOptions
): Promise<WorkflowState> {
  const loaded = await loadManifest(options.manifestFile);
  const unlock = await lockWorkflow(options.output);
  try {
    const existing = await loadWorkflowState(options.output);
    const state: WorkflowState = existing ?? {
      schemaVersion: 1,
      manifestHash: loaded.hash,
      stages: [],
    };
    const save = () => writeJson(path.join(options.output, 'state.json'), state);
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
    for (const stage of loaded.stages) {
      const projectId = loaded.manifest.projectId;
      // 独立项目只改变文档归属，不被宣称为文件系统隔离。
      const record = async (message: ResearchToolMessage) => {
        state.inspectionConversationId = message.conversation_id;
        await appendFile(
          path.join(options.output, 'workspace-calls.jsonl'),
          `${JSON.stringify(message)}\n`,
          { mode: 0o600 }
        );
        await save();
      };
      const read = (locator: string) =>
        readProjection(
          { cli: options.cli, projectId, conversationId: state.inspectionConversationId, record },
          locator
        );
      const prior = state.stages.filter(
        candidate =>
          stageIds.indexOf(candidate.id) < stageIds.indexOf(stage.id) &&
          candidate.projectId === projectId
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
        return state;
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
        return state;
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
          return state;
        }
        if (saved.status === 'completed') {
          for (const frozen of [...saved.outputs, ...saved.packetDocuments]) {
            const current = await read(frozen.locator);
            if (current.versionHash !== frozen.versionHash) {
              invalidateStages(state, stage.id, `Output changed: ${frozen.locator}`);
              await save();
              return state;
            }
          }
          continue;
        }
      } else {
        saved = {
          id: stage.id,
          projectId,
          promptHash: hashText(prompt),
          status: 'admission_unknown',
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
          return state;
        }
      }
      const receipt = saved.receipt;
      if (!receipt) throw new Error('Observing stage has no receipt');
      try {
        let status = await options.cli.status(receipt.conversation_id, receipt.run_id);
        if (!status) throw new Error('Exact run status unavailable');
        if (saved.resumePending) {
          // 只核对原run；未知resume不自动重试，防止覆盖第一次 continuation。
          if (status.execution_id === receipt.execution_id) {
            saved.error = 'Resume outcome unknown; reconcile exact execution before another resume';
            await save();
            return state;
          }
          saved.resumePending = false;
        }
        if (
          status.status === 'paused' &&
          status.pause?.settled &&
          options.resumeStage === stage.id
        ) {
          saved.resumePending = true;
          await save();
          const resumed = await options.cli.resume(receipt.conversation_id, receipt.run_id);
          saved.receipt = { ...receipt, ...resumed.receipt };
          saved.resumePending = false;
          saved.status = 'observing';
          await save();
          status = await options.cli.status(receipt.conversation_id, receipt.run_id);
        }
        while (
          status?.status === 'running' ||
          status?.status === 'pending' ||
          (status?.status === 'paused' && !status.pause?.settled)
        ) {
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
          if (!status) throw new Error('Exact run status unavailable after watch');
        }
        if (!status) throw new Error('Exact run status unavailable');
        saved.status = status.status === 'completed' ? 'collecting' : status.status;
        await save();
        await writeJson(path.join(options.output, stage.id, 'terminal-observation.json'), status);
        if (saved.status === 'paused' || saved.status === 'awaiting_user') {
          await save();
          return state;
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
            inspectionConversationId: state.inspectionConversationId,
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
            return state;
          }
        }
        if (saved.status === 'collecting') saved.status = 'completed';
        delete saved.error;
        await save();
        if (saved.status !== 'completed') return state;
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
        return state;
      }
    }
    return state;
  } finally {
    await unlock();
  }
}
