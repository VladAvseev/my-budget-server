export interface AccountRow {
  id: string;
  user_id: string;
  name: string;
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
  initial_balance?: string;
  is_closed?: boolean;
}
