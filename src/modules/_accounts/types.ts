export interface AccountRow {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  initial_balance: string;
  is_closed: boolean;
  is_primary: boolean;
  created_at: Date;
  updated_at: Date;
  balance: string;
  balance_is_zero: boolean;
}

export interface AccountDto extends Omit<
  AccountRow,
  'initial_balance' | 'balance' | 'balance_is_zero' | 'created_at' | 'updated_at'
> {
  initial_balance: number;
  balance: number;
  created_at: string;
  updated_at: string;
}

export interface AccountChanges {
  name?: string;
  color?: string | null;
  initial_balance?: string;
  is_closed?: boolean;
}

// Палитра счетов — зеркало клиентской COLOR_PALETTE (client/src/shared/colors.ts).
export const ACCOUNT_COLORS = [
  '#F2756E',
  '#7CCFA0',
  '#B77DE0',
  '#F5D74A',
  '#6FC4EE',
  '#EE7AB5',
  '#9AD97B',
  '#7F97D4',
  '#F5A65C',
  '#7ED0BC',
  '#C89BE0',
  '#CBE072',
] as const;
