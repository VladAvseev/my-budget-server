export interface GoalRow {
  id: string;
  user_id: string;
  account_id: string;
  amount: string;

  target_date: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface GoalDto {
  id: string;
  user_id: string;
  account_id: string;
  amount: number;
  target_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateGoalInput {
  accountId: string;
  amount: number;
  targetDate: string | null;
}

export interface UpdateGoalInput {
  amount?: number;
  targetDate?: string | null;
}
