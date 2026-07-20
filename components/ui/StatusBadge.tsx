import { cn } from "@/lib/utils/cn";

const toneMap: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700 ring-slate-200",
  generating: "bg-blue-50 text-blue-700 ring-blue-200",
  review: "bg-orange-50 text-orange-700 ring-orange-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  publishable: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  rework: "bg-rose-50 text-rose-700 ring-rose-200",
  saved: "bg-violet-50 text-violet-700 ring-violet-200",
  rejected: "bg-red-50 text-red-700 ring-red-200",
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  disabled: "bg-zinc-100 text-zinc-600 ring-zinc-200",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  done: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  used: "bg-violet-50 text-violet-700 ring-violet-200",
  optimizing: "bg-amber-50 text-amber-700 ring-amber-200"
};

const labelMap: Record<string, string> = {
  pending: "待处理",
  generating: "生成中",
  review: "待审核",
  approved: "已通过",
  publishable: "可发布",
  rework: "需重做",
  saved: "已保存本地",
  rejected: "已拒绝",
  active: "活跃",
  disabled: "停用",
  warning: "需优化",
  done: "完成",
  used: "已使用",
  optimizing: "待优化"
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1", toneMap[status] ?? toneMap.pending)}>{label ?? labelMap[status] ?? status}</span>;
}
