export type TopicStatus = "pending" | "approved" | "rejected" | "used" | "optimizing";

export interface TopicMedia {
  type: "image" | "video";
  url: string;
  name?: string;
  posterUrl?: string;
  localAssetKey?: string;
  posterLocalAssetKey?: string;
  mimeType?: string;
  size?: number;
}

export interface Topic {
  id: string;
  platform: string;
  title: string;
  contentType: string;
  likes: string;
  views?: string;
  comments: string;
  saves: string;
  risk: "低" | "中" | "高";
  priority: "P0" | "P1" | "P2";
  status: TopicStatus;
  sourceAccount: string;
  fetchedAt: string;
  url?: string;
  authorUrl?: string;
  coverUrl?: string;
  coverType?: "image" | "video";
  media?: TopicMedia[];
  mediaType?: "图文" | "视频";
  keyword?: string;
  parsedContent?: string;
}
