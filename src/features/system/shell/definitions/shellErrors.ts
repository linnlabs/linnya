export class ShellExternalUrlRequiredError extends Error {
  constructor() {
    super('External URL is required');
    this.name = 'ShellExternalUrlRequiredError';
  }
}

export class ShellExternalUrlInvalidError extends Error {
  constructor(readonly url: string) {
    super(`External URL is invalid: ${url}`);
    this.name = 'ShellExternalUrlInvalidError';
  }
}

export class ShellExternalUrlUnsupportedProtocolError extends Error {
  constructor(readonly protocol: string) {
    super(`External URL protocol is unsupported: ${protocol}`);
    this.name = 'ShellExternalUrlUnsupportedProtocolError';
  }
}

export class ShellItemPathRequiredError extends Error {
  constructor() {
    super('Shell item path is required');
    this.name = 'ShellItemPathRequiredError';
  }
}
