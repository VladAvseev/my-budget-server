export type OperationType = 'income' | 'expense' | 'transfer';

export interface OperationRow {
  account_id: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
  id: string;
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
  month: string;
  type: OperationType;
  amount: number;
  category_id: string | null;
}

export interface CategorySummaryRowDto {
  month: string;
  type: OperationType;
  amount: number;
  category_id: string | null;
}

export interface CapitalMonthDto {
  month: string;
  delta: number;
}

export interface OperationAccounts {
  account_id: string | null;
  from_account_id: string | null;
  to_account_id: string | null;
}

export interface CreateOperationInput extends OperationAccounts {
  type: OperationType;
  amount: number;
  categoryId: string | null;
  description: string | null;
  date: string;
}

export interface UpdateOperationInput extends Partial<OperationAccounts> {
  amount?: number;
  categoryId?: string | null;
  description?: string | null;
  type?: OperationType;
  date?: string | null;
}

export const OPERATION_TYPES = ['income', 'expense', 'transfer'] as const satisfies readonly OperationType[];
