import { describe, expect, it } from 'vitest';

import { classifyUpdateError } from './classifyUpdateError';

describe('classifyUpdateError', () => {
  it('按真实 electron-updater / Squirrel / Node 错误归类', () => {
    expect(classifyUpdateError(new Error('net::ERR_CONTENT_LENGTH_MISMATCH'))).toBe('network');
    expect(classifyUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe('network');
    expect(classifyUpdateError(Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }))).toBe('network');
    expect(classifyUpdateError(new Error('sha512 checksum mismatch, expected a, got b'))).toBe('integrity');
    expect(classifyUpdateError(new Error('Code signature at URL file:///x did not pass validation'))).toBe('integrity');
    expect(classifyUpdateError(Object.assign(new Error('write'), { code: 'ENOSPC' }))).toBe('disk');
    expect(classifyUpdateError(new Error('cancelled'))).toBe('cancelled');
    expect(classifyUpdateError(Object.assign(new Error('x'), { name: 'CancellationError' }))).toBe('cancelled');
    expect(classifyUpdateError(new Error('Cannot find latest-mac.yml in the latest release artifacts (404)'))).toBe('unknown');
  });
});
