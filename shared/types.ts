export type SplitType = 'per_head' | 'per_party' | 'shares' | 'exact';

export type SplitParty = {
  memberId: string;
  /** Headcount or share weight. Ignored for per_party and exact. */
  weight?: number;
  /** Integer paise. Required for exact. */
  owedPaise?: number;
};

export type ResolvedShare = {
  memberId: string;
  /** Weight actually used. Null for an exact split. */
  weight: number | null;
  owedPaise: number;
};

export type BalanceExpense = {
  paidBy: string;
  amountPaise: number;
  splits: { memberId: string; owedPaise: number }[];
  deletedAt?: string | null;
};

export type BalanceSettlement = {
  fromMemberId: string;
  toMemberId: string;
  amountPaise: number;
  deletedAt?: string | null;
};

export type Transfer = {
  fromMemberId: string;
  toMemberId: string;
  amountPaise: number;
};
