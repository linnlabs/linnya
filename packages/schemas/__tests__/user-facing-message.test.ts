import { describe, expect, it } from 'vitest';
import {
  createOperationFailure,
  createUserFacingMessage,
  parseUserFacingMessage,
} from '../src/user-facing-message';

describe('UserFacingMessage', () => {
  it('creates a structured operation failure while keeping legacy error', () => {
    const message = createUserFacingMessage('workspace.project.operation.duplicateName', {
      params: { projectName: 'Demo' },
      fallback: 'Project already exists',
      diagnostic: 'Project name already exists: Demo',
    });

    expect(createOperationFailure('Project name already exists: Demo', message)).toEqual({
      success: false,
      error: 'Project name already exists: Demo',
      userMessage: message,
    });
  });

  it('rejects non-primitive params at the process boundary', () => {
    expect(parseUserFacingMessage({
      key: 'workspace.project.operation.duplicateName',
      params: { nested: { value: 'Demo' } },
    })).toBeNull();
  });
});
