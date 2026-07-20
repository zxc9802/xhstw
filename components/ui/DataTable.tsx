import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export function DataTable({ headers, children, className }: { headers: string[]; children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-line bg-white shadow-sm", className)}>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase text-muted">
            <tr>{headers.map((header) => <th key={header} className="whitespace-nowrap border-b border-line px-4 py-3">{header}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">{children}</tbody>
        </table>
      </div>
    </div>
  );
}
