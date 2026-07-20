export interface LocalProjectMetadata {
  id: string;
  title: string;
  platform: string;
  accountId: string;
  contentType: "image-text" | "video";
  outputDir: string;
  createdAt: string;
  mockMode: boolean;
}
