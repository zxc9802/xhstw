import assert from "node:assert/strict";
import test from "node:test";
import { validateMediaOutput } from "../lib/tiktok/media-format";

export const mediaOutput = {
  inputRecognized: true, durationSeconds: 17.2,
  transcript: { speechDetected: true, language: "zh", segments: [{ start: 0, end: 5, text: "这是原视频中的中文说明。" }] },
  summary: { hook: "展示实物", structure: "介绍、演示、收尾", visual: "人物在桌边展示卡盒", audio: "人声与室内声音", editing: "固定机位，物品切换", pacing: "短句快节奏", onScreenText: "原片有字幕", callToAction: "结尾指向画面下方", limits: "小字需要人工核对" },
  timeline: [{ start: 0, end: 5, visual: "展示第一件物品", audio: "人声说明", onScreenText: "第一段字幕", editing: "固定机位" }, { start: 5, end: 17.2, visual: "物品切换并收尾", audio: "继续介绍", onScreenText: "后续字幕", editing: "切换实物" }],
  warnings: ["原片价格不能代表当前售价"]
};

test("full source duration, original speech and observed audiovisual timeline are validated", () => {
  const result = validateMediaOutput(mediaOutput, 17.203991, true);
  assert.equal(result.transcript.text, "这是原视频中的中文说明。");
  assert.equal(result.transcript.status, "transcribed");
  assert.equal(result.timeline.at(-1)?.end, 17.203991);
  assert.equal(result.summary.visual, "人物在桌边展示卡盒");
});

test("HTTP success or claimed recognition cannot validate the wrong video or incomplete timeline", () => {
  for (const output of [{ ...mediaOutput, durationSeconds: 14.6 }, { ...mediaOutput, inputRecognized: false }, { ...mediaOutput, timeline: [] }, { ...mediaOutput, timeline: [{ ...mediaOutput.timeline[0], start: 1 }, mediaOutput.timeline[1]] }, { ...mediaOutput, timeline: [{ ...mediaOutput.timeline[0], end: 4 }, mediaOutput.timeline[1]] }, { ...mediaOutput, transcript: { speechDetected: true, language: "zh", segments: [] } }, { ...mediaOutput, summary: {} }]) {
    assert.throws(() => validateMediaOutput(output, 17.203991, true), /视频|时长|时间轴|转录|音画/);
  }
  assert.throws(() => validateMediaOutput(mediaOutput, 17.203991, false), /声音|音轨/);
});

test("a source with no spoken words has an explicit empty transcript, not invented speech", () => {
  const result = validateMediaOutput({ ...mediaOutput, transcript: { speechDetected: false, language: null, segments: [] } }, 17.203991, true);
  assert.equal(result.transcript.status, "no_speech");
  assert.equal(result.transcript.text, "");
});
