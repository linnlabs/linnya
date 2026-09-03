import type { ISchemaProvider } from '../../../../../shared/database/schema-provider';

export const CITATION_REF_CLAIM_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS conversation_citation_ref_claims (
    conversation_id TEXT NOT NULL,
    source_identity TEXT NOT NULL,
    ref TEXT NOT NULL CHECK(
      length(ref) = 6
      AND ref NOT GLOB '*[^23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]*'
    ),
    attempt INTEGER NOT NULL CHECK(attempt >= 0),
    created_at INTEGER NOT NULL,
    PRIMARY KEY(conversation_id, source_identity),
    UNIQUE(conversation_id, ref),
    FOREIGN KEY(conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
  )`,
];

class CitationRefClaimSchemaProvider implements ISchemaProvider {
  readonly name = 'citation-ref-claims';

  getSchema(): string[] {
    return CITATION_REF_CLAIM_SCHEMAS;
  }
}

export function getCitationRefClaimSchemaProviders(): ISchemaProvider[] {
  return [new CitationRefClaimSchemaProvider()];
}
