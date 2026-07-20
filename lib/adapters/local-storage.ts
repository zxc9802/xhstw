import path from "node:path";

export function imageProjectStructure(accountId = "xhs_01_baitao_yangfuji", title = "夏天通勤防晒喷雾") {
  const root = process.env.LOCAL_OUTPUT_DIR ?? "E:\\content-production-studio\\outputs";
  return {
    outputDir: path.join(root, accountId, "2026-07-08", `001_${title}`),
    files: ["images/", "title.txt", "copy.txt", "hashtags.txt", "image_prompts.json", "reference_sources.json", "check_report.json", "review_notes.txt", "metadata.json"]
  };
}

export function videoProjectStructure(title = "防晒补涂口播视频") {
  const root = process.env.LOCAL_OUTPUT_DIR ?? "E:\\content-production-studio\\outputs";
  return {
    outputDir: path.join(root, "video", "2026-07-08", `001_${title}`),
    files: ["shots/", "selected_shots.json", "script.txt", "shot_prompts.json", "voiceover.txt", "check_report.json", "metadata.json"]
  };
}

export async function saveProject(input: unknown) {
  return { ok: true, mode: "mock", input, imageProject: imageProjectStructure(), videoProject: videoProjectStructure() };
}

export async function savePrompt(input: unknown) {
  return { ok: true, mode: "mock", input };
}

export async function archiveProject(input: unknown) {
  return { ok: true, mode: "mock", archivedAt: new Date().toISOString(), input };
}
