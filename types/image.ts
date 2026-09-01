export type ImageProvider = "Image 2.0" | "gpt-image-2-c" | "gpt-image2-vip" | "Nano Banana 2" | "nanobanan新" | "仅生成提示词，不直接生图";

export interface ImagePlanItem {
  page: number;
  type: string;
  use: string;
  title: string;
  copy: string;
  prompt: string;
  negativePrompt: string;
  referencePath: string;
  included: boolean;
  status: "done" | "generating" | "pending" | "failed";
}
