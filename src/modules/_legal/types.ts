export const KNOWN_DOCUMENT_TYPES = ['privacy_policy', 'terms_of_use'] as const;

export type KnownLegalDocumentType = (typeof KNOWN_DOCUMENT_TYPES)[number];

export interface LegalDocumentDto {
  documentType: string;
  version: string;

  publishedAt: string;

  content: string;

  contentHash: string;
}

export interface LegalDocumentRow {
  id: string;
  document_type: string;
  version: string;
  published_at: Date;
  is_current: boolean;
  content: string;
  content_hash: string;
}
