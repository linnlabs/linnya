import { randomUUID } from 'node:crypto';
import type { PluginSqliteDatabasePort } from '@plugin/backend/toolRuntime';
import type { DecisionRecord } from '../../../../shared';
import type { InlineDecisionCliCommand } from '../functions/parseDecisionCli';
import { DECISION_CLI_HELP } from '../functions/parseDecisionCli';
import {
  validateDecisionModel, projectDecisionRecord, recordDecisionRecommendation,
  updateDecisionRecord, createDecisionRecordRepository,
} from '../../decision-record';

export function executeDecisionCommand(
  command: InlineDecisionCliCommand,
  database: PluginSqliteDatabasePort,
  projectId: string,
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
  const record = command.kind === 'update'
    ? updateDecisionRecord(current, command.update)
    : recordDecisionRecommendation(current, command.recommendation);
  repository.append(record, command.expectedRevision);
  return projectDecisionRecord(record);
}
