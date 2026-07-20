export type ContentStatus = "pending" | "generating" | "review" | "rework" | "publishable" | "saved" | "rejected";

export interface ContentProject {
  id: string;
  title: string;
  platform: string;
  targetAccountId: string;
  contentType: string;
  status: ContentStatus;
  updatedAt: string;
  thumbnailLabel: string;
}

export interface CopyCandidate {
  id: string;
  summary: string;
  style: string;
  body: string;
}

export interface TitleCandidate {
  title: string;
  score: number;
  tag: string;
}
