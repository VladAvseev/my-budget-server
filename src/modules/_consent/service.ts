import { usersRepository } from '@/modules/_users/repository.js';
import { lockActiveUser } from '@/shared/accountRules.js';
import { AppError } from '@/shared/appError.js';
import { logWarn } from '@/shared/logger.js';
import { withTransaction } from '@/shared/transaction.js';
import { hash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { consentRepository } from './repository.js';
import {
  GATING_DOCUMENT_TYPE,
  type ConsentFormId,
  type ConsentReason,
  type ConsentRequestMeta,
  type ConsentStateDto,
  type ConsentStateRow,
} from './types.js';

const CONSENT_CACHE_TTL_MS = 60 * 1000;
const CONSENT_CACHE_MAX = 5000;

const consentCache = new Map<string, { state: ConsentStateDto; checkedAt: number }>();

function invalidateConsentCache(userId: string): void {
  consentCache.delete(userId);
}

function deriveState(row: ConsentStateRow): ConsentStateDto {
  const base = { currentVersion: row.current_version, grantedVersion: row.granted_version };

  if (!row.current_version) {
    return { needsConsent: false, reason: null, ...base };
  }
  if (!row.latest_action) {
    return { needsConsent: true, reason: 'missing' as ConsentReason, ...base };
  }
  if (row.latest_action === 'revoked' || row.latest_action === 'erased') {
    return { needsConsent: true, reason: 'revoked' as ConsentReason, ...base };
  }
  if (row.latest_version !== row.current_version) {
    return { needsConsent: true, reason: 'version_changed' as ConsentReason, ...base };
  }
  return { needsConsent: false, reason: null, ...base };
}

export const CONSENT_REQUIRED_MESSAGE =
  'Необходимо подтверждение согласия на обработку персональных данных. Чтобы принять соглашение, обновите страницу';

export class ConsentService {

  async getState(userId: string): Promise<ConsentStateDto> {
    const row = await consentRepository.getStateRow(userId, GATING_DOCUMENT_TYPE);
    return deriveState(row);
  }

  async ensureConsent(userId: string): Promise<void> {
    const now = Date.now();
    const cached = consentCache.get(userId);
    const needsConsent =
      cached && now - cached.checkedAt < CONSENT_CACHE_TTL_MS
        ? cached.state.needsConsent
        : await this.refreshCache(userId, now);

    if (needsConsent) {
      throw new AppError(CONSENT_REQUIRED_MESSAGE, 403, 'CONSENT_REQUIRED');
    }
  }

  private async refreshCache(userId: string, checkedAt: number): Promise<boolean> {
    const state = await this.getState(userId);
    if (consentCache.size >= CONSENT_CACHE_MAX) {
      for (const [id, item] of consentCache) {
        if (checkedAt - item.checkedAt >= CONSENT_CACHE_TTL_MS) {
          consentCache.delete(id);
        }
      }
    }
    consentCache.set(userId, { state, checkedAt });
    return state.needsConsent;
  }

  async grant(userId: string, meta: ConsentRequestMeta): Promise<ConsentStateDto> {
    await withTransaction(async (client) => {
      const version = await consentRepository.getCurrentVersion(client, GATING_DOCUMENT_TYPE);
      if (!version) {
        throw new AppError('Документ ещё не опубликован. Повторите попытку позже.', 500);
      }
      await consentRepository.insertEntry(client, {
        userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        documentType: GATING_DOCUMENT_TYPE,
        documentVersion: version,
        formId: 'consent_gate',
        action: 'granted',
      });
    });

    invalidateConsentCache(userId);
    return this.getState(userId);
  }

  async revokeAndErase(
    userId: string,
    meta: ConsentRequestMeta,
    formId: ConsentFormId,
  ): Promise<void> {

    const unreachableHash = await hash(randomBytes(32).toString('base64url'), 10);

    let published = true;

    await withTransaction(async (client) => {
      await lockActiveUser(client, userId);
      const version = await consentRepository.getCurrentVersion(client, GATING_DOCUMENT_TYPE);
      if (!version) {
        published = false;
      } else {
        await consentRepository.insertEntry(client, {
          userId,
          ip: meta.ip,
          userAgent: meta.userAgent,
          documentType: GATING_DOCUMENT_TYPE,
          documentVersion: version,
          formId,
          action: 'revoked',
        });
      }

      await usersRepository.anonymize(client, userId, unreachableHash);

      if (version) {
        await consentRepository.insertEntry(client, {
          userId,
          ip: meta.ip,
          userAgent: meta.userAgent,
          documentType: GATING_DOCUMENT_TYPE,
          documentVersion: version,
          formId,
          action: 'erased',
        });
      }
    });

    if (!published) {
      logWarn(
        `Обезличивание user=${userId} выполнено до публикации privacy_policy — ` +
          `события revoked/erased не записаны (нет версии документа для FK)`,
      );
    }

    invalidateConsentCache(userId);
  }
}

export const consentService = new ConsentService();
