export interface EditingPlan {
  id: string;
  projectId: string;
  mode: "混剪" | "固定模板剪辑" | "口播剪辑" | "产品展示剪辑";
  status: "placeholder" | "draft" | "exported";
}
