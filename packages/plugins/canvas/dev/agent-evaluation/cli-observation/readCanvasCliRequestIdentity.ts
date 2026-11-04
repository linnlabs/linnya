type Missing = { readonly state: 'absent' | 'ambiguous' | 'not-applicable'; readonly value: null };
export interface CanvasCliRequestIdentity {
  readonly requestId: { readonly state: 'explicit'; readonly value: string } | Missing;
  readonly dryRun: { readonly state: 'explicit' | 'absent'; readonly value: boolean }
    | { readonly state: 'ambiguous' | 'not-applicable'; readonly value: null };
}

/** 只摘取两个验收身份参数，不重复领域校验，也不把有歧义的argv猜成实际请求。 */
export function readCanvasCliRequestIdentity(argv: readonly string[]): CanvasCliRequestIdentity {
  if (argv[0] !== 'apply' && argv[0] !== 'arrange') return {
    requestId: { state: 'not-applicable', value: null }, dryRun: { state: 'not-applicable', value: null },
  };
  const end = argv.indexOf('--'), tokens = end < 0 ? argv : argv.slice(0, end);
  const booleans = new Set(['--dry-run', '--help', '-h']);
  function option(flag: string) {
    const matches = tokens.flatMap((token, index) => token === flag || token.startsWith(flag + '=') ? [{ token, index }] : []);
    if (!matches.length) return { state: 'absent' } as const;
    if (matches.length !== 1) return { state: 'ambiguous' } as const;
    const match = matches[0], previous = tokens[match.index - 1];
    if (previous?.startsWith('-') && !previous.includes('=') && !booleans.has(previous)) return { state: 'ambiguous' } as const;
    return { state: 'single', ...match } as const;
  }
  const request = option('--request-id'), dry = option('--dry-run');
  let requestId: CanvasCliRequestIdentity['requestId'];
  if (request.state !== 'single') requestId = { state: request.state, value: null };
  else if (request.token.startsWith('--request-id=')) requestId = { state: 'explicit', value: request.token.slice('--request-id='.length) };
  else {
    const value = tokens[request.index + 1];
    requestId = value !== undefined && !value.startsWith('-') ? { state: 'explicit', value } : { state: 'ambiguous', value: null };
  }
  return { requestId, dryRun: dry.state === 'absent' ? { state: 'absent', value: false }
    : dry.state === 'single' && dry.token === '--dry-run' ? { state: 'explicit', value: true }
    : { state: 'ambiguous', value: null } };
}
