export class RunInputQuoteError extends Error {
  constructor(readonly code: 'unavailable' | 'invalid_quote' | 'quote_mismatch', message: string) {
    super(message);
    this.name = 'RunInputQuoteError';
  }
}
