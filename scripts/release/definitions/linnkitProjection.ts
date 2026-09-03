export const LINNKIT_SOURCE_PROVENANCE_FILE = 'LINNKIT_SOURCE_PROVENANCE.json';

export const LINNKIT_PROJECTION_SCHEMA_VERSION = 1;

export interface LinnkitProjectionEntry {
  readonly path: string;
  readonly mode: '100644' | '100755';
  readonly content: Buffer;
}

export interface LinnkitSourceProvenance {
  readonly schemaVersion: typeof LINNKIT_PROJECTION_SCHEMA_VERSION;
  readonly sourceRepository: string;
  readonly sourceCommit: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly projectedFileCount: number;
  readonly projectionSha256: string;
}
