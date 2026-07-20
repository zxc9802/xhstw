"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Clapperboard,
  DatabaseZap,
  GalleryVerticalEnd,
  ImagePlus,
  LibraryBig,
  PackageSearch,
  UsersRound
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

const productionNavItems = [
  { label: "① 爆款选题库", href: "/topics", icon: LibraryBig },
  { label: "② 图文生产", href: "/content?tab=image", icon: ImagePlus },
  { label: "③ 成品内容库", href: "/content-library", icon: Clapperboard }
];

const resourceNavItems = [
  { label: "素材库", href: "/assets", icon: GalleryVerticalEnd },
  { label: "产品资料库", href: "/product", icon: PackageSearch }
];

const managementNavItems = [
  { label: "账号管理", href: "/accounts", icon: UsersRound }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [dailyOpen, setDailyOpen] = useState(true);
  const [resourceOpen, setResourceOpen] = useState(true);
  const [manageOpen, setManageOpen] = useState(true);

  const materialViewActive = pathname === "/assets" || pathname === "/templates";
  return (
    <div className="min-h-screen bg-shell">
      <aside className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-line bg-white">
        <div className="flex h-16 items-center gap-3 border-b border-line px-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500 text-white">
            <DatabaseZap className="h-5 w-5" />
          </div>
          <div>
            <p className="text-base font-semibold text-ink">小红书图文生产</p>
            <p className="text-xs text-muted">Xiaohongshu Image Studio</p>
          </div>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
          <div>
            <NavGroupToggle open={dailyOpen} onClick={() => setDailyOpen((current) => !current)}>每日工作流</NavGroupToggle>
            {dailyOpen ? (
              <div className="space-y-1">
                {productionNavItems.map((item) => <MainNavLink key={item.href} item={item} pathname={pathname} />)}
              </div>
            ) : null}
          </div>

          <div>
            <NavGroupToggle open={resourceOpen} onClick={() => setResourceOpen((current) => !current)}>资源库</NavGroupToggle>
            {resourceOpen ? (
            <div className="space-y-1">
              {resourceNavItems.map((item) => <MainNavLink key={item.href} item={item} pathname={pathname} activeOverride={item.href === "/assets" ? materialViewActive : undefined} />)}
            </div>
            ) : null}
          </div>

          <div>
            <NavGroupToggle open={manageOpen} onClick={() => setManageOpen((current) => !current)}>管理</NavGroupToggle>
            {manageOpen ? (
            <div className="space-y-1">
              {managementNavItems.map((item) => <MainNavLink key={item.href} item={item} pathname={pathname} />)}
            </div>
            ) : null}
          </div>
        </nav>

        <div className="border-t border-line p-4">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-sm font-medium text-ink">小红书图文生产状态</p>
            <p className="mt-1 text-xs leading-5 text-muted">专注图文选题、仿写、生成与归档。</p>
          </div>
        </div>
      </aside>

      <div className="pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line bg-white/90 px-7 backdrop-blur">
          <div>
            <p className="text-sm font-medium text-ink">小红书图文生产状态</p>
            <p className="text-xs text-muted">本地图文 workflow</p>
          </div>
          <div className="flex items-center gap-3">
            <button className="relative flex h-9 w-9 items-center justify-center rounded-md border border-line bg-white text-muted transition hover:bg-orange-50 hover:text-orange-700" title="通知">
              <Bell className="h-4 w-4" />
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-orange-500" />
            </button>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] space-y-5 px-7 py-6">{children}</main>
      </div>
    </div>
  );
}

function NavGroupToggle({ children, open, onClick }: { children: React.ReactNode; open: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="mb-2 flex h-8 w-full items-center justify-between rounded-md bg-white px-3 text-xs font-semibold text-muted transition hover:text-orange-700">
      <span className="flex items-center gap-2">
        <span className="h-3 w-1 rounded-full bg-orange-700" />
        {children}
      </span>
      <span className={cn("text-sm transition", open ? "rotate-90" : "")}>›</span>
    </button>
  );
}

function MainNavLink({ item, pathname, activeOverride }: { item: { label: string; href: string; icon: typeof LibraryBig }; pathname: string; activeOverride?: boolean }) {
  const Icon = item.icon;
  const hrefPath = item.href.split("?")[0];
  const active = activeOverride ?? (pathname === hrefPath || pathname.startsWith(`${hrefPath}/`));

  return (
    <Link href={item.href} className={cn("group flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition", active ? "bg-orange-700 text-white shadow-sm" : "bg-white text-muted hover:bg-orange-50 hover:text-orange-700")}>
      <span className={cn("grid h-7 w-7 place-items-center rounded-md transition", active ? "text-white" : "text-muted group-hover:text-orange-700")}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 truncate">{item.label}</span>
    </Link>
  );
}
