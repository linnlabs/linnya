export type WebSearchAcquisition = {
  readonly toolName: 'search_web' | 'web_read';
  readonly callId: string;
  readonly status: 'success' | 'error';
  readonly data?: unknown;
  readonly observation: string;
  readonly timestamp: number;
};

export interface WebSearchAcquisitionPort {
  list(): readonly WebSearchAcquisition[];
}

export interface WebSearchSnapshotReader {
  read(
    bundleId: string,
    ref: string
  ): Promise<{ text: string; url: string; captureKind: 'web_search_result' | 'web_page' }>;
}
const readers = new WeakMap<object, WebSearchSnapshotReader>();
const acquisitions = new WeakMap<object, WebSearchAcquisitionPort>();
export function attachWebSearchSnapshotReader(
  context: object,
  reader: WebSearchSnapshotReader
): void {
  readers.set(context, reader);
}
export function requireWebSearchSnapshotReader(context: object): WebSearchSnapshotReader {
  const reader = readers.get(context);
  if (!reader) throw new Error('Deep web assembly requires a host snapshot reader');
  return reader;
}

export function attachWebSearchAcquisitions(
  context: object,
  port: WebSearchAcquisitionPort
): void {
  acquisitions.set(context, port);
}

export function requireWebSearchAcquisitions(context: object): WebSearchAcquisitionPort {
  const port = acquisitions.get(context);
  if (!port) throw new Error('Deep web assembly requires a host acquisition port');
  return port;
}
