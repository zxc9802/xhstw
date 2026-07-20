import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "success" | "danger";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-orange-500 text-white hover:bg-orange-600 shadow-sm",
  secondary: "border border-line bg-white text-ink hover:border-orange-200 hover:bg-orange-50",
  ghost: "text-muted hover:bg-orange-50 hover:text-orange-700",
  success: "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
  danger: "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
};

export function Button({ className, variant = "secondary", icon, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: ReactNode }) {
  return (
    <button className={cn("inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50", variants[variant], className)} {...props}>
      {icon}
      {children}
    </button>
  );
}
