import { pool } from '@/db/pool.js';
import type { LegalDocumentRow } from './types.js';

export class LegalRepository {

  async findCurrent(documentType: string): Promise<LegalDocumentRow | null> {
    const { rows } = await pool.query<LegalDocumentRow>(
      `SELECT * FROM public.legal_documents
        WHERE document_type = $1 AND is_current
        LIMIT 1`,
      [documentType],
    );
    return rows[0] ?? null;
  }

  async findByVersion(documentType: string, version: string): Promise<LegalDocumentRow | null> {
    const { rows } = await pool.query<LegalDocumentRow>(
      `SELECT * FROM public.legal_documents
        WHERE document_type = $1 AND version = $2
        LIMIT 1`,
      [documentType, version],
    );
    return rows[0] ?? null;
  }
}

export const legalRepository = new LegalRepository();
