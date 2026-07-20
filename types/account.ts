export type AccountStatus = "active" | "pending" | "disabled" | "optimizing";

export interface ProductionAccount {
  id: string;
  platform: string;
  name: string;
  platformAccountId: string;
  avatar: string;
  bio: string;
  positioning: string;
  contentTypes: string[];
  tone: string;
  mediaSpec: string;
  autoTopicEnabled: boolean;
  status: AccountStatus;
  dailyTarget: number;
  remark: string;
}
