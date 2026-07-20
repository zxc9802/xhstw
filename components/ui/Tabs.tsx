"use client";

import { cn } from "@/lib/utils/cn";

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: readonly T[]; value: T; onChange: (value: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-white p-1 shadow-sm">
      {tabs.map((tab) => (
        <button key={tab} onClick={() => onChange(tab)} className={cn("h-8 rounded-md px-3 text-sm font-medium transition", value === tab ? "bg-orange-500 text-white shadow-sm" : "text-muted hover:bg-orange-50 hover:text-orange-700")}>
          {tab}
        </button>
      ))}
    </div>
  );
}
