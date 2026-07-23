# 飞书同步目标链接设计

## 目标

飞书同步完成后，页面必须打开本次 API 实际写入的多维表，而不是代码中固定的历史表格链接。

## 设计

- 服务端继续从 `FEISHU_BASE_URL`/`FEISHU_APP_TOKEN` 与 `FEISHU_TABLE_ID` 解析真实写入目标。
- 服务端根据最终使用的 `appToken` 和 `tableId` 生成 `https://feishu.cn/base/<appToken>?table=<tableId>`，并随成功响应返回。
- 前端删除固定的 `FEISHU_BASE_URL`，单条和批量同步都只打开响应中的 `baseUrl`。
- 不新增 `NEXT_PUBLIC_*` 环境变量，避免构建时固化配置；飞书应用密钥仍只存在服务端。

## 错误处理

同步失败时保持现有错误提示且不打开页面；成功响应若缺少 `baseUrl`，视为接口响应异常。

## 验证

- 单元测试验证 `appToken/tableId` 能生成对应的飞书 Base URL。
- 全量测试和生产构建通过。
- 源码中不再存在固定的历史 Base Token。
