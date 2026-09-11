export interface AccumulationRow {
  id: string;
  user_id: string;
  category_id: string | null;
  description: string;
  amount: string;
  created_at: Date;
  updated_at: Date;
}

export interface AccumulationDto {
  id: string;
  user_id: string;
  category_id: string | null;
  description: string;
  amount: number;
  created_at: string;
  updated_at: string;
}

export interface AccumulationsTotal {
  total: number;
}

export interface CreateAccumulationInput {
  amount: number;
  description: string;
  categoryId: string | null;
}

export interface UpdateAccumulationInput {
  amount?: number;
  description?: string;
  categoryId?: string | null;
}
