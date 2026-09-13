/**
 * Типы модуля legal: версионируемые юридические документы (legal_documents).
 * Ответы — camelCase, как в остальных модулях.
 */

/**
 * Типы документов, которые ожидает клиент (реестр slugs/ссылок —
 * client/src/shared/legal/documents.ts). Пустой каталог legal_documents —
 * серверная ошибка, а не проверка: публикация CLI с опечаткой в --type
 * создала бы невидимый для UI документ, поэтому скрипт сверяет тип со списком
 * и требует --allow-unknown для нового типа (сначала — правка реестра клиента).
 * Гейтящим является privacy_policy: её принятие считается согласием на
 * обработку ПДн (_consent/GATING_DOCUMENT_TYPE), terms_of_use — информационный.
 */
export const KNOWN_DOCUMENT_TYPES = ['privacy_policy', 'terms_of_use'] as const;

export type KnownLegalDocumentType = (typeof KNOWN_DOCUMENT_TYPES)[number];

/** Ответ GET /legal/:documentType/current и /legal/:documentType/:version. */
export interface LegalDocumentDto {
  documentType: string;
  version: string;
  /** ISO-строка момента публикации. */
  publishedAt: string;
  /** Исходный Markdown — HTML рендерит клиент (react-markdown). */
  content: string;
  /** hex sha256 от content — клиент может использовать как ключ кэша/ETag. */
  contentHash: string;
}

/** Строка таблицы legal_documents ровно как её отдаёт postgres. */
export interface LegalDocumentRow {
  id: string;
  document_type: string;
  version: string;
  published_at: Date;
  is_current: boolean;
  content: string;
  content_hash: string;
}
