import { pool } from '@/db/pool.js';
import type { LegalDocumentRow } from './types.js';

/**
 * Слой чтения реестра юридических документов. Модуль только читает:
 * публикация — исключительная прерогатива CLI src/scripts/publish-legal-document.ts
 * (строка опубликованной версии приложением не редактируется никогда).
 */
export class LegalRepository {
  /** Текущая (is_current) версия документа заданного типа; null — не опубликован. */
  async findCurrent(documentType: string): Promise<LegalDocumentRow | null> {
    const { rows } = await pool.query<LegalDocumentRow>(
      `SELECT * FROM public.legal_documents
        WHERE document_type = $1 AND is_current
        LIMIT 1`,
      [documentType],
    );
    return rows[0] ?? null;
  }

  /** Конкретная историческая версия — нужна для споров о том, что видел пользователь. */
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
