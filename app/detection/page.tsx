"use client";

import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { StatCard } from "@/components/ui/StatCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { platformBadges } from "@/lib/constants/platforms";
import { detectionItems, detectionStats } from "@/lib/mock/data";

export default function DetectionPage() {
  return (
    <>
      <PageHeader title="审核检测" description="对本地生成内容做查重、合规、低流量风险和人工审核。" />

      <section className="grid gap-4 md:grid-cols-4">
        {detectionStats.map((stat) => <StatCard key={stat.label} label={stat.label} value={stat.value} tone={stat.tone} />)}
      </section>

      <Card>
        <CardHeader title="筛选区域" subtitle="按平台、类型、质量和合规状态快速缩小候选内容。" />
        <CardBody className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
          {["平台", "内容类型", "生成时间", "质量评分", "合规状态", "重复度区间"].map((label) => (
            <label key={label} className="text-sm font-medium text-ink">
              {label}
              <select className="mt-2 h-10 w-full rounded-md border border-line bg-white px-3 text-sm text-muted outline-none focus:border-orange-300">
                <option>全部</option>
                <option>小红书</option>
                <option>需优化</option>
              </select>
            </label>
          ))}
          <label className="text-sm font-medium text-ink">
            关键词搜索
            <span className="mt-2 flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3">
              <Search className="h-4 w-4 text-muted" />
              <input className="w-full text-sm outline-none" placeholder="标题 / 摘要" />
            </span>
          </label>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="内容列表" subtitle="操作仅改变本地交互反馈，不会发布到任何平台。" />
        <CardBody className="p-0">
          <DataTable headers={["内容预览", "标题 / 摘要", "来源平台", "目标平台", "类型", "质量分", "重复度", "合规状态", "生成时间", "操作"]} className="rounded-none border-0 shadow-none">
            {detectionItems.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50">
                <td className="px-4 py-3"><div className="flex h-14 w-20 items-center justify-center rounded-md bg-gradient-to-br from-orange-100 via-white to-blue-100 text-xs font-semibold text-orange-700">{item.preview}</div></td>
                <td className="min-w-80 px-4 py-3">
                  <p className="font-medium text-ink">{item.title}</p>
                  <p className="mt-1 text-xs text-muted">{item.summary}</p>
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="flex items-center gap-2">
                    <PlatformBadge badge={platformBadges[item.sourcePlatform as keyof typeof platformBadges] ?? item.sourcePlatform.slice(0, 2)} platform={item.sourcePlatform} />
                    <span className="text-muted">{item.sourcePlatform}</span>
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted">{item.targetPlatform}</td>
                <td className="whitespace-nowrap px-4 py-3 text-muted">{item.type}</td>
                <td className="px-4 py-3 font-semibold text-ink">{item.quality}</td>
                <td className="px-4 py-3 text-muted">{item.duplicate}</td>
                <td className="px-4 py-3"><StatusBadge status={item.status} label={item.compliance} /></td>
                <td className="whitespace-nowrap px-4 py-3 text-muted">{item.generatedAt}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Button>查看详情</Button>
                    <Button variant="success">保留</Button>
                    <Button>需优化</Button>
                    <Button variant="danger">淘汰</Button>
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        </CardBody>
      </Card>
    </>
  );
}
