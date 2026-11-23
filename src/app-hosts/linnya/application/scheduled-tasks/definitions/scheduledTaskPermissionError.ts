export class ScheduledTaskPermissionError extends Error {
  constructor() {
    super('permission_above_conversation: Set the higher permission level in the Scheduled Tasks view.');
    this.name = 'ScheduledTaskPermissionError';
  }
}
