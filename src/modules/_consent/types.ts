/**
 * Типы модуля consent: юридически значимые согласия из таблицы consent_log
 * (append-only журнал) и состояние consent-gate для middleware/клиента.
 */

/**
 * document_type гейтящего документа — «Политика конфиденциальности»: её
 * принятие юридически считается согласием на обработку персональных данных
 * (отдельного документа «Согласие на обработку ПДн» на сайте нет).
 */
export const GATING_DOCUMENT_TYPE = 'privacy_policy';

/** Возможные события журнала. 'erased' — факт удаления (обезличивания) данных. */
export type ConsentAction = 'granted' | 'revoked' | 'erased';

/** Где получено событие (CHECK-констрейнт form_id в схеме). */
export type ConsentFormId = 'registration' | 'consent_gate' | 'account_settings' | 'admin';

/** Причина, по которой гейт требует действия (зеркалит check_consent() ТЗ). */
export type ConsentReason = 'missing' | 'revoked' | 'version_changed';

/** Ответ GET /consent/status и результат grant. */
export interface ConsentStateDto {
  needsConsent: boolean;
  /** null — согласия не требуется (или документ ещё не опубликован). */
  reason: ConsentReason | null;
  /** Текущая is_current версия гейтящего документа; null — не опубликована. */
  currentVersion: string | null;
  /**
   * Версия гейтящего документа из последней grant-записи журнала (если итог —
   * действующее или отозванное согласие); null — записей granted не было.
   * Нужна профилю: «с каким текстом я соглашался» (п.2/п.8 требований).
   */
  grantedVersion: string | null;
}

/** Метаданные запроса, обязательные для записи в журнал (см. AGENTS.md/миграцию). */
export interface ConsentRequestMeta {
  /** req.ip (при trust proxy=2 — реальный адрес клиента). */
  ip: string;
  /** Заголовок User-Agent либо null. */
  userAgent: string | null;
}

/** Параметры одной записи consent_log (ip/ua шифруются в репозитории). */
export interface ConsentLogEntry {
  userId: string;
  ip: string;
  userAgent: string | null;
  documentType: string;
  documentVersion: string;
  formId: ConsentFormId;
  action: ConsentAction;
}

/** Сырая строка запроса состояния: текущая версия + последние строки журнала. */
export interface ConsentStateRow {
  current_version: string | null;
  latest_action: ConsentAction | null;
  latest_version: string | null;
  /** Версия последней grant-записи (после отзыва там revoked/erased — не latest). */
  granted_version: string | null;
}
