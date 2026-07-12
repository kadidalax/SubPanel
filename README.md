# <img src="assets/logo.svg" alt="SubPanel" width="36" height="36" align="absmiddle" /> SubPanel

轻量订阅聚合分发面板：Cloudflare Workers + D1。多源导入 → 节点池 → 分组 → 订阅链接，适配 Mihomo / sing-box / Surge / V2rayN 等客户端。适合个人 / 家庭 / 小团队。

## 特性

- 手工节点、远程订阅、透传源（URI / Base64 / Mihomo / sing-box 等）

- 分组下发独立订阅；到期、订阅拉取设备数、流量额度（无法精准统计真实代理流量）

- 管理后台 + 次级用户自助；访问与审计日志

- 第三方 SMTP 到期 / 流量提醒，自动停用

- 亮暗双主题
  
  <img width="1696" height="948" alt="image" src="https://github.com/user-attachments/assets/a566060d-3f11-436f-9fb0-edbba2d95359" />

## 一键部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/kadidalax/SubPanel)

全部在 Cloudflare / 面板里完成，**无需配置 Secret**（生产建议补 `CREDENTIALS_KEY` 保护远程源 URL）：

1. 点击上方 **Deploy to Cloudflare**，创建应用。
2. 在 Dashboard 创建并绑定 **D1**：库名 `subpanel` → Worker 绑定 `DB`（fork 后请改掉示例 `database_id`）。
3. 确认 **Cron** `*/5 * * * *`（配置文件已声明；免费账号注意全账号 Cron 配额）。
4. 打开 Worker 域名 → 面板会提示 **初始化数据库**（一键创建表，已有表则跳过、不删数据）→ **初始化管理员** → 开始使用。

订阅地址：`https://你的域名/sub/<token>`（可选 `?format=mihomo|singbox|uri|surge`）。

### 流量说明

- `none`：不统计
- `manual`：管理员手填已用与额度
- `upstream_exclusive`：读取单一远程源返回的用量

**无法精准统计真实代理流量。** 面板只负责下发订阅，不经过用户上网链路，上述用量仅供参考，不能作为计费依据。

「设备数」= 拉取订阅时的客户端指纹，不是在线连接数。

### 可选 Secret

| 名称                | 作用                                                         |
| ----------------- | ---------------------------------------------------------- |
| `CREDENTIALS_KEY` | ≥16 字符；加密远程源 URL/Headers 与 SMTP 密码。不填则首次运行写入 D1（备份/迁移库时勿丢） |

## 本地开发

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run build:web
npx wrangler dev --ip 127.0.0.1 --port 8787
```

## 许可

[MIT License](LICENSE)
