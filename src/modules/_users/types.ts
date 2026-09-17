export interface UserRow {
  id: string;
  login: string;

  password_hash: string;
  role: 'user' | 'admin';
  currency: string | null;
  onboarded: boolean;
  last_active_at: Date | null;

  failed_login_attempts: number;

  locked_until: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface PublicUser {
  id: string;
  login: string;
  role: 'user' | 'admin';
  currency: string | null;
  onboarded: boolean;
  lastActiveAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfileInput {
  currency?: string | null;
  onboarded?: boolean;
}

export interface OnboardingState {
  categories: number;
  reports: number;
  operations: number;
}

export interface UserSummary {
  income: number;
  expense: number;
}

export interface HomeBootstrap {

  profile: {
    currency: string | null;
    onboarded: boolean;
  };

  onboarding: OnboardingState;

  lastReport: BootstrapLastReport | null;

  globalTotals: UserSummary;
}

export interface BootstrapLastReport {
  id: string;
  name: string;

  period_start: string | null;
  period_end: string | null;

  summary: UserSummary;
}
