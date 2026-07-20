export interface CheckReport {
  duplicateRate: number;
  homogenization: "低" | "中" | "高";
  sensitiveWords: string[];
  complianceRisk: "低" | "中" | "高";
  forbiddenWords: string[];
  aiTrace: number;
  suggestions: string[];
}
