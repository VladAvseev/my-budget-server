export interface ReportRow {
  id: string;
  user_id: string;
  name: string;

  code: string;

  period_start: string | null;
  period_end: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ReportDto {
  id: string;
  user_id: string;
  name: string;
  code: string;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportSummary {
  income: number;
  expense: number;

  savings: number;
}

export interface CapitalMonthDto {
  month: string;
  delta: number;
}

export interface CreateReportInput {
  name: string;
  code: string;
  periodStart: string | null;
  periodEnd: string | null;
}
