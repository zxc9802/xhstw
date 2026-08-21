# 腾讯云 COS 接入配置

代码已固定使用存储桶 `xshcp-1410143389`、地域 `ap-singapore`。存储桶继续保持**私有读写**，不要开启公有读。

## 1. 创建专用密钥

在腾讯云 CAM 创建一个仅供本项目使用的子用户和 API 密钥，不要使用主账号密钥。给它绑定下面的最小权限策略：

```json
{
  "version": "2.0",
  "statement": [
    {
      "effect": "allow",
      "action": ["name/cos:GetBucket"],
      "resource": ["qcs::cos:ap-singapore:uid/1410143389:xshcp-1410143389/*"],
      "condition": {
        "string_like": {
          "cos:prefix": ["users/*"]
        }
      }
    },
    {
      "effect": "allow",
      "action": [
        "name/cos:GetObject",
        "name/cos:HeadObject",
        "name/cos:PutObject",
        "name/cos:DeleteObject"
      ],
      "resource": ["qcs::cos:ap-singapore:uid/1410143389:xshcp-1410143389/users/*"]
    }
  ]
}
```

## 2. 配置 CORS

在 COS 存储桶的“安全管理 → 跨域访问 CORS”中添加规则：

- 来源：正式站点的完整域名；本地调试再加 `http://127.0.0.1:3000`
- 允许方法：`PUT`
- 允许请求头：`*`
- 暴露头部：`ETag`
- 超时：`600`

正式环境不要把来源写成 `*`。

## 3. 填入密钥

本地在不提交 Git 的 `.env.local` 中填写：

```dotenv
TENCENT_COS_BUCKET=xshcp-1410143389
TENCENT_COS_REGION=ap-singapore
TENCENT_COS_SECRET_ID=你的SecretId
TENCENT_COS_SECRET_KEY=你的SecretKey
```

Cloudflare 生产环境用 Secret 保存密钥：

```powershell
npm.cmd exec -- wrangler secret put TENCENT_COS_SECRET_ID
npm.cmd exec -- wrangler secret put TENCENT_COS_SECRET_KEY
```

配置完成后登录项目：在内容生产页确认保存一条图文，再到内容库查看。COS 中应出现 `users/<成员ID>/contents/<内容ID>/`；换另一个成员登录时看不到这条内容。
