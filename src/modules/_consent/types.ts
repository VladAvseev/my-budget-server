export const GATING_DOCUMENT_TYPE = 'privacy_policy';

export type ConsentAction = 'granted' | 'revoked' | 'erased';

export type ConsentFormId = 'registration' | 'consent_gate' | 'account_settings' | 'admin';

export type ConsentReason = 'missing' | 'revoked' | 'version_changed';

export interface ConsentStateDto {
  needsConsent: boolean;

  reason: ConsentReason | null;

  currentVersion: string | null;

  grantedVersion: string | null;
}

export interface ConsentRequestMeta {

  ip: string;

  userAgent: string | null;
}

export interface ConsentLogEntry {
  userId: string;
  ip: string;
  userAgent: string | null;
  documentType: string;
  documentVersion: string;
  formId: ConsentFormId;
  action: ConsentAction;
}

export interface ConsentStateRow {
  current_version: string | null;
  latest_action: ConsentAction | null;
  latest_version: string | null;

  granted_version: string | null;
}
