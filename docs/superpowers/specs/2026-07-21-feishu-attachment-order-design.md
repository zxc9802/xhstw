# 飞书附件数字命名与顺序设计

## 目标

成品内容同步到飞书时，以用户选择素材的先后顺序作为唯一顺序来源。第一个素材上传到飞书后的文件名必须是 `1`，第二个是 `2`，依此类推；文件名不带扩展名。飞书“图片或视频”单元格中的附件从左到右保持相同顺序。

## 已确认的数据流与根因

当前成品保存流程会把用户每次新选择的图片追加到 `finishedImageAssignments`，随后按该数组顺序保存到成品的 `mediaUrls`。同步飞书时，前端继续按 `mediaUrls` 顺序生成请求体中的 `images` 数组，因此用户选择顺序在前端和请求中均已保留。

服务端当前按请求数组下标生成 `content-image-1.png` 一类带前缀、带扩展名的名称，并使用 `Promise.all` 并发上传全部图片。因而线上既没有得到要求的纯数字文件名，也不能用上传先后来加强飞书侧的附件展示顺序。

## 方案

只修改飞书同步服务端，不改变选图界面、成品存储结构或请求体：

1. 继续把请求体 `images` 数组的顺序视为用户选择顺序。
2. 服务端截取现有上限内的前 9 张图片，并按数组顺序逐张处理。
3. 第 `index` 张图片的飞书上传文件名固定为字符串 `index + 1`，例如 `1`、`2`、`3`、`4`；不附加扩展名。
4. 图片 Blob 继续保留真实 MIME 类型，使飞书仍能识别图片内容。
5. 图片改为串行上传。每张上传成功后立即按同一顺序追加对应 `file_token`，最终将该数组写入飞书附件字段。
6. 单张上传失败时沿用现有警告行为，后续素材继续上传；成功素材保持各自在原用户选择顺序中的相对位置。全部失败时仍沿用现有整体失败行为。

## 边界

- 保留每次最多上传 9 张图片的现有上限。
- 不修改用户已经保存的历史成品数据；历史记录同步时按其现有 `images` 数组顺序编号。
- 不修改飞书表结构、字段名或文字字段同步逻辑。
- 不给纯数字文件名补扩展名。

## 测试与验收

自动化测试模拟四张按用户选择顺序传入的图片，并验证：

1. 飞书媒体上传请求依次收到文件名 `1`、`2`、`3`、`4`。
2. 任意时刻最多只有一个媒体上传请求进行中，证明上传是串行的。
3. 创建飞书记录时，“图片或视频”字段的 `file_token` 顺序与 `1`、`2`、`3`、`4` 一致。
4. 现有单图上传、全部图片失败、字段别名等测试继续通过。

实施后运行目标测试、完整测试和生产构建。代码验证通过只证明本地链路正确；上线后还需要用一条按顺序选择四张真实素材的成品执行同步，确认飞书中实际显示的文件名和从左到右顺序均为 `1`、`2`、`3`、`4`。

## 2026-07-21 validated upload-type addendum

Live verification showed that `bitable_image` can replace an extensionless numeric name with the source image name. Use `parent_type=bitable_file` while keeping the original image bytes, numeric `file_name`, serial upload, and ordered token collection unchanged. A direct Feishu upload/download check confirmed that the requested name `1` is returned unchanged and that the downloaded bytes have the same size and SHA-256 hash as the uploaded image.
