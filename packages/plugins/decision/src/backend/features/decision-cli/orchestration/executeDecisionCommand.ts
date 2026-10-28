import { randomUUID } from 'node:crypto';
import type { PluginSqliteDatabasePort } from '@plugin/backend/toolRuntime';
import type { DecisionRecord, DecisionReportProvenance } from '../../../../shared';
import type { InlineDecisionCliCommand } from '../functions/parseDecisionCli';
import { DECISION_CLI_HELP } from '../functions/parseDecisionCli';
import {
  validateDecisionModel, projectDecisionRecord, recordDecisionRecommendation,
  updateDecisionRecord, createDecisionRecordRepository,
  simulateDecisionScenarios, compareDecisionRecords,
  planDecisionAction, resolveDecisionAction, withdrawDecisionActionReport,
  checkDecisionOptions, DecisionFailure,
  recordDecisionProgress, reviewDecisionAction,
} from '../../decision-record';

export function executeDecisionCommand(
  command: Exclude<InlineDecisionCliCommand, { kind: 'research_prepare' | 'research_read' | 'research_receive' | 'research_list' }>,
  database: PluginSqliteDatabasePort,
  projectId: string,
  reportProvenance?: DecisionReportProvenance,
) {
  if (command.kind === 'help') return DECISION_CLI_HELP;
  const repository = createDecisionRecordRepository(database, projectId);
  if (command.kind === 'list') {
    return repository.list().map(record => ({
      id: record.id, title: record.model.title, revision: record.revision,
      recommendationStatus: projectDecisionRecord(record).recommendationStatus,
    }));
  }
  if (command.kind === 'read') return projectDecisionRecord(repository.read(command.id, command.revision));
  if (command.kind === 'compare') {
    return compareDecisionRecords(repository.read(command.id, command.fromRevision), repository.read(command.id, command.toRevision));
  }
  if (command.kind === 'create') {
    validateDecisionModel(command.model);
    const record: DecisionRecord = {
      schemaVersion: 1, id: randomUUID(), revision: 1, inputRevision: 1,
      reason: 'Initial decision conditions', model: command.model, recommendation: null,
    };
    repository.append(record, 0);
    return projectDecisionRecord(record);
  }
  const current = repository.read(command.id);
  if (command.kind === 'simulate') return simulateDecisionScenarios(current, command.expectedRevision, command.scenarios);
  if (command.kind === 'check') return checkDecisionOptions(current, command.expectedRevision, command.request);
  const record = command.kind === 'action_plan'
    ? planDecisionAction(current, randomUUID(), command.plan)
    : command.kind === 'action_progress'
      ? recordDecisionProgress(current, command.actionId, randomUUID(), command.progress, requireProvenance(reportProvenance))
    : command.kind === 'action_review'
      ? reviewDecisionAction(current, command.actionId, command.review, requireProvenance(reportProvenance))
    : command.kind === 'action_withdraw'
      ? withdrawDecisionActionReport(current, command.actionId, command.withdrawal, requireProvenance(reportProvenance))
    : command.kind === 'action_resolve'
      ? resolveDecisionAction(current, command.actionId, command.resolution, requireProvenance(reportProvenance))
      : command.kind === 'update'
    ? updateDecisionRecord(current, command.update)
    : recordDecisionRecommendation(current, command.recommendation);
  repository.append(record, command.expectedRevision);
  return projectDecisionRecord(record);
}

function requireProvenance(value: DecisionReportProvenance | undefined): DecisionReportProvenance {
  if (!value) throw new DecisionFailure('invalid_model', 'Action reports require Host-supplied provenance.');
  return value;
}
