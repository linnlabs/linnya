export class KnowledgeBaseNameRequiredError extends Error {
  constructor() {
    super('Knowledge base name is required');
    this.name = 'KnowledgeBaseNameRequiredError';
  }
}

export class KnowledgeBaseIdRequiredError extends Error {
  constructor(readonly operation: string) {
    super(`Knowledge base id is required: ${operation}`);
    this.name = 'KnowledgeBaseIdRequiredError';
  }
}

export class KnowledgeBaseInvalidRequestError extends Error {
  constructor(readonly operation: string) {
    super(`Knowledge base request is invalid: ${operation}`);
    this.name = 'KnowledgeBaseInvalidRequestError';
  }
}

export class KnowledgeBaseNotFoundError extends Error {
  constructor(readonly knowledgeBaseId: string) {
    super(`Knowledge base not found: ${knowledgeBaseId}`);
    this.name = 'KnowledgeBaseNotFoundError';
  }
}

export class KnowledgeBaseDefaultDeleteBlockedError extends Error {
  constructor() {
    super('Default knowledge base cannot be deleted');
    this.name = 'KnowledgeBaseDefaultDeleteBlockedError';
  }
}

export class KnowledgeBaseReadAfterUpdateFailedError extends Error {
  constructor(readonly knowledgeBaseId: string) {
    super(`Knowledge base cannot be read after update: ${knowledgeBaseId}`);
    this.name = 'KnowledgeBaseReadAfterUpdateFailedError';
  }
}
