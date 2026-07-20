import type { ReactNode } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/utils/cn";

export function StatCard({
  label,
  value,
  tone = "pending",
  delta,
  icon,
  className
}: {
  label: string;
  value: string | number;
  tone?: string;
  delta?: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-line bg-white p-4 shadow-sm", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{label}</p>
          <div className="mt-2 flex items-end gap-2">
            <p className="text-2xl font-semibold text-ink">{value}</p>
            {delta ? <span className="pb-1 text-xs font-medium text-emerald-600">{delta}</span> : null}
          </div>
        </div>
        {icon ? <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-600">{icon}</div> : null}
      </div>
      <div className="mt-3">
        <StatusBadge status={tone} />
      </div>
    </div>
  );
}
