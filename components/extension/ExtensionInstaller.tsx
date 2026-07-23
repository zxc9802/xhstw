"use client";

import React, { useState } from "react";
import { createPortal } from "react-dom";
import { CircleHelp, Download, X } from "lucide-react";

export const XHS_EXTENSION_DOWNLOAD_PATH = "/downloads/xhs-browser-extension-0.1.12.zip";

export function ExtensionInstaller() {
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-2">
        <a
          href={XHS_EXTENSION_DOWNLOAD_PATH}
          download
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-800"
        >
          <Download className="h-4 w-4" />
          下载插件
        </a>
        <button
          type="button"
          onClick={() => setGuideOpen(true)}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium text-ink transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800"
        >
          <CircleHelp className="h-4 w-4" />
          安装说明
        </button>
      </div>

      {guideOpen && typeof document !== "undefined"
        ? createPortal(<ExtensionInstallDialog onClose={() => setGuideOpen(false)} />, document.body)
        : null}
    </>
  );
}

export function ExtensionInstallDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="extension-install-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-line bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id="extension-install-title" className="text-lg font-semibold text-ink">小红书插件安装说明</h2>
            <p className="mt-1 text-sm text-muted">支持 Chrome 和 Edge，首次安装约需 1 分钟。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭安装说明" className="rounded-md p-2 text-muted transition hover:bg-slate-100 hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5 text-sm text-ink">
          <ol className="list-decimal space-y-3 pl-5 leading-6">
            <li>点击顶部“下载插件”，将 ZIP 完整解压到一个固定目录。</li>
            <li>Chrome 打开 <code className="rounded bg-slate-100 px-1.5 py-0.5">chrome://extensions</code>；Edge 打开 <code className="rounded bg-slate-100 px-1.5 py-0.5">edge://extensions</code>。</li>
            <li>开启扩展管理页右上角的“开发者模式”。</li>
            <li>把刚刚下载的压缩包里的文件放在一个文件夹里，然后点击“加载已解压的扩展”并选择这个文件夹。</li>
            <li>在同一个浏览器中打开小红书并完成登录。</li>
            <li>刷新生产网站，确认选题页显示“本机抓取已连接”。</li>
          </ol>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <h3 className="font-semibold text-amber-900">升级插件</h3>
            <p className="mt-1 leading-6 text-amber-800">先在扩展管理页移除旧版本，再解压新 ZIP、加载新目录并刷新网站。</p>
          </div>

          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <h3 className="font-semibold text-red-900">遇到 300013 或访问频繁</h3>
            <p className="mt-1 leading-6 text-red-800">立即停止重试并等待页面提示的冷却时间。不要反复卸载、重装或刷新来绕过冷却。</p>
          </div>
        </div>

        <div className="flex justify-end border-t border-line px-5 py-4">
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center justify-center rounded-md bg-emerald-700 px-4 text-sm font-medium text-white transition hover:bg-emerald-800">
            我知道了
          </button>
        </div>
      </section>
    </div>
  );
}
