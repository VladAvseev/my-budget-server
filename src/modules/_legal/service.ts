import { AppError } from '@/shared/appError.js';
import { sha256Hex } from '@/shared/hash.js';
import { logWarn } from '@/shared/logger.js';
import { requireNonEmptyString } from '@/shared/validate.js';
import { legalRepository } from './repository.js';
import type { LegalDocumentDto, LegalDocumentRow } from './types.js';

const DOCUMENT_TYPE_RE = /^[a-z0-9_-]{1,50}$/;

const VERSION_RE = /^[A-Za-z0-9._-]{1,20}$/;

function requireDocumentType(value: unknown): string {
  const type = requireNonEmptyString(value, 'Некорректный тип документа');
  if (!DOCUMENT_TYPE_RE.test(type)) {
    throw new AppError('Некорректный тип документа', 400);
  }
  return type;
}

function requireVersion(value: unknown): string {
  const version = requireNonEmptyString(value, 'Некорректная версия документа');
  if (!VERSION_RE.test(version)) {
    throw new AppError('Некорректная версия документа', 400);
  }
  return version;
}

function toDto(row: LegalDocumentRow): LegalDocumentDto {
  return {
    documentType: row.document_type,
    version: row.version,
    publishedAt: row.published_at.toISOString(),
    content: row.content,
    contentHash: row.content_hash,
  };
}

export class LegalService {

  private checkIntegrity(dto: LegalDocumentDto): LegalDocumentDto {
    if (sha256Hex(dto.content) !== dto.contentHash) {
      logWarn(
        `ИНЦИДЕНТ ЦЕЛОСТНОСТИ: документ ${dto.documentType} ${dto.version}: ` +
          `content_hash не совпадает с содержимым content (правка в обход публикации)`,
      );
    }
    return dto;
  }

  async getCurrent(documentTypeParam: unknown): Promise<LegalDocumentDto> {
    const documentType = requireDocumentType(documentTypeParam);
    const row = await legalRepository.findCurrent(documentType);
    if (!row) {
      throw new AppError('Документ не найден', 404);
    }
    return this.checkIntegrity(toDto(row));
  }

  async getVersion(documentTypeParam: unknown, versionParam: unknown): Promise<LegalDocumentDto> {
    const documentType = requireDocumentType(documentTypeParam);
    const version = requireVersion(versionParam);
    const row = await legalRepository.findByVersion(documentType, version);
    if (!row) {
      throw new AppError('Документ не найден', 404);
    }
    return this.checkIntegrity(toDto(row));
  }
}

export const legalService = new LegalService();
