export async function checkDuplicate(input: unknown) {
  return { input, duplicateRate: 12, threshold: Number(process.env.DUPLICATE_THRESHOLD ?? 25), status: "pass" };
}

export async function checkCompliance(input: unknown) {
  return { input, sensitiveWords: ["最适合"], complianceRisk: "低", forbiddenWords: [], status: "warning" };
}

export async function checkLowFlowRisk(input: unknown) {
  return { input, riskScore: 42, threshold: Number(process.env.LOW_FLOW_RISK_THRESHOLD ?? 70), suggestions: ["增加收藏点", "补充真实使用场景"] };
}
