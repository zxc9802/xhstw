export async function createEditPlan(input: unknown) {
  return { mode: "mock", input, message: "自动剪辑模块将在下一阶段接入：混剪 / 固定模板剪辑 / 口播剪辑 / 产品展示剪辑 / 剪映素材包导出" };
}

export async function exportEditingDraft(input: unknown) {
  return { mode: "mock", input, status: "placeholder-export" };
}
