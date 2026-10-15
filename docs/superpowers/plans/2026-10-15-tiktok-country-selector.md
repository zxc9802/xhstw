# TikTok 国家可选项实施计划

目标：账号国家从固定 MY 改为下拉选择，默认 MY，空字符串表示不限。国家判断继续使用绑定作者的真实国家字段，不把搜索请求地区当作作者归属。

- [x] 在 `tests/tiktok-videos.test.ts` 验证指定国家、未知归属和不限国家；在 provider/media 测试验证请求地区、真实归属不被选项覆盖及非法国家提前拒绝。先运行并确认失败。
- [x] `lib/tiktok/countries.ts` 与 `country-names.json` 提供固定 CLDR 国家/地区代码和中文选项，常用市场排前。`videos.ts` 按 `filters.country ?? "MY"` 筛选，空值跳过国家条件；provider 按选项请求详情，不限时沿用默认请求地区，结果仍独立核实归属。
- [x] `app/tiktok/page.tsx` 增加账号国家下拉、标题去掉固定国家，收集请求及下一批游标绑定所选国家。切换国家不能复用不同国家的游标。音画详情采用视频自身已知国家；创作角色去掉固定 MY。
- [x] 运行 TikTok 测试、应用类型检查和生产构建。重启自己的 3100 服务，用真实已有候选切换 MY/US/不限核对筛选并保存截图，不额外凑造候选或付费抓取。

验证命令：`npx.cmd tsx --test tests/tiktok-*.test.ts`、`npx.cmd tsc --noEmit -p outputs/tiktok-app-tsconfig.json`、`npm.cmd run build`。更新 `docs/tiktok-video-workflow.md` 说明账号归属和请求地区的区别。继续保留用户此前删除的状态标签及能力范围卡片的删除结果。

结果：TikTok 43 项、全量 414 项通过，应用类型检查及构建通过。已有31条真实候选在美国条件下命中1条、国家不限时命中3条；实际归属仍为上游或导入记录中的国家。真实 HTTP 非法国家请求返回400。截图及浏览器核对记录在 `outputs/tiktok-country-selector.*`，测试与构建日志在 `outputs/tiktok-country-*.log`。

浏览器检查发现服务端和浏览器的 Intl 地区名称存在4处差异，触发React首次渲染错误；先保存差异证据并添加跨运行环境回归测试，再改为固定中文名称表，避免运行时翻译差异。
