"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Tabs } from "@/components/ui/Tabs";
import { platformBadges } from "@/lib/constants/platforms";
import { accountPlatformOverview, accounts as initialAccounts } from "@/lib/mock/data";
import type { ProductionAccount } from "@/types/account";

const platformTabs = ["小红书"] as const;
type AccountWithOwner = ProductionAccount & { owner?: string };

function accountStatusLabel(status: string) {
  if (status === "pending") return "待完善";
  if (status === "optimizing") return "待优化";
  if (status === "disabled") return "停用";
  return "活跃";
}

function defaultAvatar(name: string) {
  const text = encodeURIComponent(name.slice(0, 1) || "账");
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="48" fill="#ffedd5"/><text x="48" y="58" text-anchor="middle" font-size="34" font-family="Arial" fill="#ea580c" font-weight="700">${text}</text></svg>`)}`;
}

export default function AccountsPage() {
  const [accountRows, setAccountRows] = useState<AccountWithOwner[]>(initialAccounts.map((item, index) => ({ ...item, owner: ["王欣", "张三", "李四", "陈然"][index % 4] })));
  const [platform, setPlatform] = useState<(typeof platformTabs)[number]>("小红书");
  const [keyword, setKeyword] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<AccountWithOwner | null>(null);
  const [feedback, setFeedback] = useState("小红书账号资料仅做本地管理，不登录平台，不抓取后台。");

  const filteredAccounts = useMemo(() => accountRows.filter((item) => item.platform === platform && (item.name.includes(keyword) || item.platformAccountId.includes(keyword) || (item.owner ?? "").includes(keyword))), [accountRows, platform, keyword]);

  const addAccount = (data: { platform: string; keyword: string; owner: string }) => {
    const name = data.keyword.trim() || `${data.platform}新账号`;
    const newAccount: AccountWithOwner = {
      id: `${data.platform}_${Date.now()}`,
      platform: data.platform,
      name,
      platformAccountId: data.keyword.trim(),
      avatar: defaultAvatar(name),
      bio: "",
      positioning: "待编辑内容方向",
      contentTypes: [],
      tone: "",
      mediaSpec: "",
      autoTopicEnabled: true,
      status: "active",
      dailyTarget: 0,
      remark: "本地添加账号，后续可完善资料",
      owner: data.owner || "未设置"
    };
    setAccountRows((items) => [newAccount, ...items]);
    setPlatform(data.platform as (typeof platformTabs)[number]);
    setAddOpen(false);
    setFeedback(`已添加 ${data.platform} 账号：${name}`);
  };

  const saveEditing = () => {
    if (!editing) return;
    setAccountRows((items) => items.map((item) => item.id === editing.id ? editing : item));
    setEditing(null);
    setFeedback(`已保存账号内容方向：${editing.name}`);
  };

  return (
    <>
      <PageHeader title="账号管理" description="维护小红书账号资料、账号持有人与内容方向，本地管理，不登录平台。" action={<Button variant="primary" onClick={() => setAddOpen(true)}>新增账号</Button>} />

      <div className="rounded-md bg-orange-50 px-4 py-3 text-sm text-orange-700">{feedback}</div>

      <Card>
        <CardHeader title="平台账号概览" subtitle="点击平台后查看该平台已加入的账号。" />
        <CardBody className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          {accountPlatformOverview.map((item) => (
            <button key={item.platform} onClick={() => setPlatform(item.platform as (typeof platformTabs)[number])} className={`rounded-lg border bg-white p-4 text-left shadow-sm transition ${platform === item.platform ? "border-orange-300 ring-2 ring-orange-100" : "border-line hover:border-orange-200"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <PlatformBadge badge={item.badge} platform={item.platform} />
                  <div>
                    <p className="font-semibold text-ink">{item.platform}</p>
                    <p className="mt-1 text-xs text-muted">账号总数 {accountRows.filter((account) => account.platform === item.platform).length}</p>
                  </div>
                </div>
                <span className="text-xs font-medium text-orange-700">管理账号</span>
              </div>
            </button>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="账号规则与偏好设置" subtitle="筛选并维护账号名称、头像、账号 ID、账号持有人和内容方向。" action={<Tabs tabs={[...platformTabs]} value={platform} onChange={setPlatform} />} />
        <CardBody className="space-y-4">
          <input value={keyword} onChange={(event) => setKeyword(event.target.value)} className="h-10 w-full max-w-md rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300" placeholder="搜索账号名称、ID 或持有人" />
          <DataTable headers={["平台", "头像", "账号名称", "账号 ID", "账号持有人", "内容方向", "状态", "自动选题", "备注", "操作"]} className="rounded-none border-0 shadow-none">
            {filteredAccounts.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50">
                <td className="whitespace-nowrap px-4 py-3 font-medium text-ink">{item.platform}</td>
                <td className="px-4 py-3"><img src={item.avatar || defaultAvatar(item.name)} alt={item.name} className="h-10 w-10 rounded-full object-cover" /></td>
                <td className="whitespace-nowrap px-4 py-3 font-medium text-ink">{item.name}</td>
                <td className="px-4 py-3 text-muted">{item.platformAccountId || "-"}</td>
                <td className="px-4 py-3 text-muted">{item.owner || "未设置"}</td>
                <td className="min-w-72 px-4 py-3 text-muted">{item.positioning}</td>
                <td className="px-4 py-3"><StatusBadge status={item.status === "pending" ? "pending" : item.status} label={accountStatusLabel(item.status)} /></td>
                <td className="whitespace-nowrap px-4 py-3 text-muted">{item.autoTopicEnabled ? "开启" : "关闭"}</td>
                <td className="min-w-56 px-4 py-3 text-muted">{item.remark}</td>
                <td className="px-4 py-3"><Button onClick={() => setEditing(item)}>编辑</Button></td>
              </tr>
            ))}
          </DataTable>
        </CardBody>
      </Card>

      {addOpen ? <AddAccountModal onClose={() => setAddOpen(false)} onSubmit={addAccount} /> : null}
      {editing ? <EditAccountModal account={editing} onChange={setEditing} onClose={() => setEditing(null)} onSave={saveEditing} /> : null}
    </>
  );
}

function AddAccountModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (data: { platform: string; keyword: string; owner: string }) => void }) {
  const [platform, setPlatform] = useState("小红书");
  const [keyword, setKeyword] = useState("");
  const [owner, setOwner] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4">
      <div className="w-full max-w-lg rounded-lg border border-line bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4"><div><h2 className="text-lg font-semibold text-ink">新增账号</h2><p className="mt-1 text-sm text-muted">选择平台，输入 ID 或账号名称，加入本地账号管理。</p></div><button onClick={onClose} className="rounded-md p-2 text-muted hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="space-y-4 p-5">
          <label className="block text-sm font-medium text-ink">平台<select value={platform} onChange={(event) => setPlatform(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300">{platformTabs.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="block text-sm font-medium text-ink">ID 或账号名称<input value={keyword} onChange={(event) => setKeyword(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300" placeholder="输入平台 ID 或账号名称" /></label>
          <label className="block text-sm font-medium text-ink">账号持有人<input value={owner} onChange={(event) => setOwner(event.target.value)} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300" placeholder="例如：王欣" /></label>
          <p className="rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-700">当前为本地资料链接，不登录平台，不读取后台。</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-4"><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!keyword.trim()} onClick={() => onSubmit({ platform, keyword, owner })}>加入账号管理</Button></div>
      </div>
    </div>
  );
}

function EditAccountModal({ account, onChange, onClose, onSave }: { account: AccountWithOwner; onChange: (account: AccountWithOwner) => void; onClose: () => void; onSave: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4">
      <div className="w-full max-w-2xl rounded-lg border border-line bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4"><div><h2 className="text-lg font-semibold text-ink">编辑账号</h2><p className="mt-1 text-sm text-muted">{account.platform} · {account.name}</p></div><button onClick={onClose} className="rounded-md p-2 text-muted hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="grid gap-4 p-5 md:grid-cols-2">
          <label className="block text-sm font-medium text-ink">账号名称<input value={account.name} onChange={(event) => onChange({ ...account, name: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300" /></label>
          <label className="block text-sm font-medium text-ink">账号持有人<input value={account.owner ?? ""} onChange={(event) => onChange({ ...account, owner: event.target.value })} className="mt-2 h-10 w-full rounded-md border border-line px-3 text-sm outline-none focus:border-orange-300" /></label>
          <label className="block text-sm font-medium text-ink md:col-span-2">内容方向<textarea value={account.positioning} onChange={(event) => onChange({ ...account, positioning: event.target.value })} className="mt-2 min-h-32 w-full rounded-md border border-line px-3 py-2 text-sm leading-6 outline-none focus:border-orange-300" /></label>
          <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={account.autoTopicEnabled} onChange={(event) => onChange({ ...account, autoTopicEnabled: event.target.checked })} className="h-4 w-4 accent-orange-500" />参与自动选题</label>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-4"><Button onClick={onClose}>取消</Button><Button variant="primary" onClick={onSave}>保存</Button></div>
      </div>
    </div>
  );
}
