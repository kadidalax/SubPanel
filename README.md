# <img src="assets/logo.svg" alt="SubPanel" width="36" height="36" align="absmiddle" /> SubPanel


轻量订阅聚合分发面板：Cloudflare Workers + D1。多源导入 → 节点池 → 分组 → 订阅链接，适配 Mihomo / sing-box / Surge / URI 等客户端。适合个人 / 家庭 / 小团队使用。

## 特性

- 手工节点、远程订阅、透传源（URI / Base64 / Mihomo / sing-box 等）
- 分组下发独立订阅（支持空分组），到期 / 设备数 / 流量额度
- 管理后台 + 次级用户自助；访问与审计日志
- 第三方 SMTP 到期 / 流量提醒，自动停用
- 亮暗主题

## 一键部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/kadidalax/SubPanel)

全部在 Cloudflare / 面板里完成，**无需配置 Secret**：

1. 点击上方 **Deploy to Cloudflare**，授权 GitHub 与 Cloudflare，创建应用。
2. 在 Dashboard 创建并绑定 **D1**：库名 `subpanel` → Worker 绑定 `DB`。
3. 确认 **Cron** `*/5 * * * *`（配置文件已声明）。
4. 初始化数据库：打开 **存储 → D1 → subpanel → 控制台**，打开仓库 **`schema.sql`**，**全选复制**后粘贴执行（文件已无 `--` 注释，避免粘贴丢换行时整段被注释掉）。成功后可 `SELECT name FROM sqlite_master WHERE type='table';` 看到 `users` 等表。
5. 重新部署一次 Worker。
6. 打开域名 → **初始化管理员** → **设置** 填 SMTP（可选）→ 导入节点 → 分组 → 建订阅。

订阅地址：`https://你的域名/sub/<token>`（可选 `?format=mihomo|singbox|uri|surge`）。

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run build:web
npx wrangler dev --ip 127.0.0.1 --port 8787
```

## 许可证

[MIT License](LICENSE)
