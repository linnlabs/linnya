import { KNOWLEDGE_CLI_HELP } from './knowledgeCliCommand';

export class KnowledgeCliUsageError extends Error {
  readonly exitCode = 2;

  constructor(message: string) {
    super(`${message}\n${KNOWLEDGE_CLI_HELP}`);
    this.name = 'KnowledgeCliUsageError';
  }
}

export class KnowledgeCliPermissionError extends Error {
  readonly exitCode = 77;

  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeCliPermissionError';
  }
}
