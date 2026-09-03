export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Run not found: ${runId}`);
    this.name = 'RunNotFoundError';
  }
}

export class RunAlreadyRegisteredError extends Error {
  readonly runId: string;

  constructor(runId: string) {
    super(`RunSupervisor: run ${runId} is already registered`);
    this.name = 'RunAlreadyRegisteredError';
    this.runId = runId;
  }
}

export class RunNotAwaitingUserError extends Error {
  constructor(runId: string, status: string) {
    super(`RunSupervisor: run ${runId} cannot resume from status ${status}`);
    this.name = 'RunNotAwaitingUserError';
  }
}

export class RunInteractionConflictError extends Error {
  constructor(runId: string, reason: string) {
    super(`RunSupervisor: interaction rejected for run ${runId}: ${reason}`);
    this.name = 'RunInteractionConflictError';
  }
}

export class RunConcurrencyLimitExceededError extends Error {
  readonly runId: string;
  readonly maxActiveRuns: number;
  readonly activeRuns: number;

  constructor(runId: string, maxActiveRuns: number, activeRuns: number) {
    super(`RunSupervisor: maxActiveRuns=${maxActiveRuns} exceeded while registering run ${runId}`);
    this.name = 'RunConcurrencyLimitExceededError';
    this.runId = runId;
    this.maxActiveRuns = maxActiveRuns;
    this.activeRuns = activeRuns;
  }
}

export class RunConcurrencyKeyOccupiedError extends Error {
  readonly concurrencyKey: string;
  readonly activeRunId: string;
  readonly requestedRunId: string;

  constructor(concurrencyKey: string, activeRunId: string, requestedRunId: string) {
    super(`RunSupervisor: concurrency key ${concurrencyKey} is held by active run ${activeRunId}`);
    this.name = 'RunConcurrencyKeyOccupiedError';
    this.concurrencyKey = concurrencyKey;
    this.activeRunId = activeRunId;
    this.requestedRunId = requestedRunId;
  }
}
