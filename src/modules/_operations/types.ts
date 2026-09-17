export type OperationType = 'income' | 'expense' | 'transfer';

export interface OperationRow {
  account_id: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
  id: string;
  report_id: string | null;
  user_id: string;
  type: OperationType;

  amount: string;
  category_id: string | null;
  description: string | null;

  date: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface OperationDto {
  account_id: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
  id: string;
  report_id: string | null;
  user_id: string;
  type: OperationType;
  amount: number;
  category_id: string | null;
  description: string | null;
  date: string | null;
  created_at: string;
  updated_at: string;
}

export interface OverviewOperationDto {
  report_id: string;
  type: OperationType;
  amount: number;
  category_id: string | null;
}

export interface CategorySummaryRowDto {
  report_id: string;
  type: OperationType;
  amount: number;
  category_id: string | null;
}

export interface OperationAccounts {
  account_id: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
}

export interface CreateOperationInput extends OperationAccounts {
  reportId: string;
  type: OperationType;
  amount: number;
  categoryId: string | null;
  description: string | null;
  date: string | null;
}

export interface UpdateOperationInput extends Partial<OperationAccounts> {
  amount?: number;
  categoryId?: string | null;
  description?: string | null;
  type?: OperationType;
  date?: string | null;
}

export const OPERATION_TYPES = ['income', 'expense', 'transfer'] as const satisfies readonly OperationType[];
