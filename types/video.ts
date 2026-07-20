export type VideoProvider = "Seedance 2.0" | "仅生成分镜提示词，不直接生成视频";

export interface VideoScriptRow {
  id: string;
  time: string;
  scene: string;
  action: string;
  audio: string;
  voiceover: string;
  selected: boolean;
}

export interface VideoShotPlan {
  id: string;
  selected: boolean;
  no: number;
  title: string;
  scene: string;
  voiceFocus: string;
  prompt: string;
  negativePrompt: string;
  referencePath: string;
  duration: string;
  status: "done" | "generating" | "pending";
}
