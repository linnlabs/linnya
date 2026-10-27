import { createHash } from 'node:crypto';
import { RunInputQuoteError } from '../definitions/runInputQuoteError';

export function matchRunInputQuote(text: string, quote: string) {
  const normalized = quote.replace(/\s+/gu, ' ').trim();
  if (!normalized || normalized.length > 2000) {
    throw new RunInputQuoteError('invalid_quote', 'Input quote must contain 1–2000 characters after whitespace normalization.');
  }
  // 只等价化空白，不纠错、换词或推测语义，避免把作者转述伪装成原话。
  if (!text.replace(/\s+/gu, ' ').trim().includes(normalized)) {
    throw new RunInputQuoteError('quote_mismatch', 'Quote not found in this run’s admitted input. Use exact words from the current turn; only whitespace may differ.');
  }
  return { quote: normalized, textSha256: createHash('sha256').update(text).digest('hex') };
}
