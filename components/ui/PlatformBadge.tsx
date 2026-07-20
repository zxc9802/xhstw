import { cn } from "@/lib/utils/cn";

export function PlatformBadge({ badge, platform }: { badge: string; platform: string }) {
  const tone = "bg-red-50 text-red-600";
  return <span className={cn("inline-flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold", tone)}>{badge}</span>;
}
