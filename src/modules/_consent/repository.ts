import { pool } from '@/db/pool.js';
import { AppError } from '@/shared/appError.js';
import type { PoolClient } from 'pg';
import type { ConsentLogEntry, ConsentStateRow } from './types.js';

/**
 * Слой доступа к consent_log (append-only) и текущей версии документа.
 * Записи в журнал делает ТОЛЬКО сервер (п.8 требований): insert-функции
 * принимают ip/user-agent из запроса, created_at отдаёт база (DEFAULT now()),
 * клиент не может передать ни время, ни версию.
 */

/**
 * Опции pgp_sym_encrypt: у PGP-функций pgcrypto имена только через дефис
 * (underscore-синтаксис 'cipher_algo' и опция 'armor' есть лишь у
 * низкоуровневого encrypt() — иначе 'Illegal argument to function').
 * Бронирование — отдельной функцией armor(): ASCII-вывод кладём в text-колонку
 * (расшифровка — pgp_sym_decrypt(dearmor(...)), см. шапку миграции).
 */
const PGP_OPTIONS = 'cipher-algo=aes256';

/**
 * Ключ шифрования ip/user_agent (п.8: журнал ПДн защищаем так же, как и сами
 * ПДн). Отсутствие env — серверная конфигурационная ошибка, наружу 500 без
 * деталей, в stderr — точный текст.
 */
function encKey(): string {
  const key = process.env.CONSENT_ENC_KEY;
  if (!key) {
    // eslint-disable-next-line no-console -- конфигурационный сбой должен быть виден в логах контейнера
    console.error('CONSENT_ENC_KEY не задан — consent_log недоступен');
    throw new AppError('Внутренняя ошибка сервера', 500);
  }
  return key;
}

export class ConsentRepository {
  /**
   * Состояние согласия одним запросом: текущая опубликованная версия документа
   * и самая свежая строка журнала пользователя (tie-breaker id — записи одного
   * транзакционного момента created_at различить не могут). Отдельно берётся
   * версия последней grant-записи: после отзыва latest — revoked/erased, а
   * пользователю в профиле нужно показать текст, с которым он соглашался.
   */
  async getStateRow(userId: string, documentType: string): Promise<ConsentStateRow> {
    const { rows } = await pool.query<ConsentStateRow>(
      `SELECT
         (SELECT version FROM public.legal_documents
           WHERE document_type = $1 AND is_current LIMIT 1) AS current_version,
         (SELECT action FROM public.consent_log
           WHERE user_id = $2 AND document_type = $1
           ORDER BY created_at DESC, id DESC LIMIT 1) AS latest_action,
         (SELECT document_version FROM public.consent_log
           WHERE user_id = $2 AND document_type = $1
           ORDER BY created_at DESC, id DESC LIMIT 1) AS latest_version,
         (SELECT document_version FROM public.consent_log
           WHERE user_id = $2 AND document_type = $1 AND action = 'granted'
           ORDER BY created_at DESC, id DESC LIMIT 1) AS granted_version`,
      [documentType, userId],
    );
    return rows[0];
  }

  /**
   * Вставка события журнала. Принимает клиент транзакции: регистрация
   * (user + granted) и отзыв (revoked + обезличивание + erased) обязаны
   * коммититься целиком.
   */
  async insertEntry(client: PoolClient, entry: ConsentLogEntry): Promise<void> {
    await client.query(
      `INSERT INTO public.consent_log
         (user_id, ip_address, user_agent, document_type, document_version, form_id, action)
        VALUES
          ($1,
           armor(pgp_sym_encrypt($2, $4, '${PGP_OPTIONS}')),
           CASE WHEN $3::text IS NULL THEN NULL
                ELSE armor(pgp_sym_encrypt($3, $4, '${PGP_OPTIONS}')) END,
          $5, $6, $7, $8)`,
      [
        entry.userId,
        entry.ip,
        entry.userAgent,
        encKey(),
        entry.documentType,
        entry.documentVersion,
        entry.formId,
        entry.action,
      ],
    );
  }

  /** Текущая версия документа (для записи document_version); null — не опубликован. */
  async getCurrentVersion(client: PoolClient, documentType: string): Promise<string | null> {
    const { rows } = await client.query<{ version: string }>(
      `SELECT version FROM public.legal_documents
        WHERE document_type = $1 AND is_current
        LIMIT 1`,
      [documentType],
    );
    return rows[0]?.version ?? null;
  }
}

export const consentRepository = new ConsentRepository();
