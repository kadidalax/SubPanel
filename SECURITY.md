# SubPanel 安全审查报告

> 审查日期：2026-07-11  
> 范围：`src/**`、`web/src/**`、`schema.sql`、`wrangler.jsonc`、部署配置  
> 方法：静态代码审查（鉴权、会话、订阅 token、密钥、SSRF、注入、日志、配置）  
> 基线：此前功能审计（`AUDIT.md`）之后的代码状态  
> 说明：未做外部渗透/动态 fuzz；结论以源码可达路径为准。

## 摘要

| 等级 | 数量 | 含义 |
|------|------|------|
| **P0** | 4 | 可直接导致密钥/订阅 token/内网访问面暴露或核心机密可被读出 |
| **P1** | 8 | 高风险：可利用但需条件，或造成账号/可用性实质损害 |
| **P2** | 9 | 中风险：加固项、绕过面、运维误配 |
| **P3** | 6 | 低风险/纵深防御 |

**整体判断**：管理面鉴权骨架（Cookie HttpOnly + SameSite=Strict + Origin CSRF + PBKDF2 + session_version）基本正确；订阅 opaque 404、token 哈希存储方向正确。  
当前最大风险集中在：**加密主密钥可被管理员 API 读出**、**订阅 token 完整落入访问日志/可观测性**、**远程源 SSRF 校验不完整**、**密码重置无速率限制且明文 token 落库**。

---

## 已有正确实践（基线）

| 项 | 位置 | 评价 |
|----|------|------|
| 会话 Cookie HttpOnly; SameSite=Strict; Secure? | `src/auth/session.ts` | 正确；HTTPS 时加 Secure |
| 变更类 API Origin 校验 | admin/user/auth + sameOrigin | 有效 CSRF 防护（浏览器场景） |
| 密码 PBKDF2-SHA256 + 恒定时间比较 | `src/crypto/password.ts` | 正确；默认 10 万次迭代 |
| 会话绑定 session_version | `src/db/sessions.ts` | 改密/停用后旧会话失效 |
| 登录失败限速 | `src/db/rate_limit.ts` | IP+用户名窗口锁定 |
| 订阅 token 仅存 SHA-256 | subscriptions.token_hash | 正确；明文只创建/轮换时返回 |
| 订阅失败 opaque 404 | serveSubscription | 降低 token 有效性探测 |
| 远程源仅 https + 私网字面量拦截 + 体积/超时 | `src/services/ssrf.ts` | 有基础防护 |
| 源 URL/Headers、SMTP 密码 AES-GCM | secretbox + credentials | 方向正确 |
| 用户侧 IDOR 校验 | user.ts 订阅/节点 | user_id 比对 |
| SQL 基本参数化 | 全局 prepare/bind | 未见拼接注入 |
| 邮件 HTML 主体字段 escHtml | notifications.ts | 常规 XSS 转义有做 |
| 前端无 dangerouslySetInnerHTML | web/src | 降低 DOM XSS 面 |
| .dev.vars gitignore | .gitignore | 本地密钥未入库 |

---

## P0 — 必须优先修复

### P0-1 管理设置接口回传 credentials_key（主密钥泄露）

- **位置**：`src/routes/admin.ts` `GET /api/admin/settings`
- **问题**：`SELECT key, value_json FROM settings` 全表返回，仅对 `smtp_pass` 做了脱敏。`credentialsKey()` 在无 Secret 时会把 **AES 主密钥** 写入 `settings.credentials_key`。
- **影响**：任意已登录 **admin**（会话被盗、XSS、内部人员）可读出主密钥，解密全部远程源 URL/自定义 Headers（可能含上游订阅 token）与 SMTP 密码。
- **利用条件**：admin 会话
- **修复**：
  1. GET 设置时 **永远不返回** `credentials_key`（及任何 `*_key`/`*_secret`）
  2. 生产强制 `env.CREDENTIALS_KEY`（≥32 字节随机），禁止落 D1
  3. 已落库的 key 做一次性迁移/轮换文档

### P0-2 订阅 token 完整写入 Worker 访问日志

- **位置**：`src/index.ts` 全局 middleware `console.log({ path: pathname })`，路由为 `/sub/:token`
- **叠加**：`wrangler.jsonc` `observability.head_sampling_rate: 1`（全量采样）
- **影响**：每一次订阅拉取都会把 **完整 bearer token** 打进 CF Logs / tail / 第三方日志汇聚。日志读权限 = 订阅接管权限。
- **修复**：
  1. 日志 path 对 `/sub/*` 重写为 `/sub/[redacted]` 或仅 token_prefix
  2. 可观测性采样降到合理值，并确认 Logpush 无原始 URL
  3. 中长期：Authorization Bearer 或短单次签，避免 token 长期待在 URL/path

### P0-3 远程源 SSRF 校验可被绕过（字面量/映射地址）

- **位置**：`src/services/ssrf.ts` `assertSafeRemoteUrl`
- **缺口**：
  1. **IPv6-mapped IPv4**：`https://[::ffff:127.0.0.1]/` — isPrivateIPv6 未识别 `::ffff:` 后的私网/回环
  2. **非点分 IP 形态**：十进制/八进制等主机名不走 IPv4 私网判断
  3. **DNS 解析后地址未二次校验**：只检查 URL 字面 hostname
  4. **自定义 Headers 无黑名单**：Host / X-Forwarded-* / CF-* 可被写入远程源 headers（sources.ts 原样带上）
- **影响**：admin 配源即可打内网字面地址/异常 host
- **修复**：拒绝 `::ffff:` 映射与非标准 IP 字面量；headers 白名单（Authorization / User-Agent / Token）；有条件时 resolve 后再 assert

### P0-4 密码重置：无速率限制 + 明文 token 持久化在通知载荷

- **位置**：`src/routes/auth.ts` forgot/reset；`notifications.payload_json.resetUrl` 含完整 raw token
- **问题**：
  1. 忘记密码无限速 → 邮箱轰炸、通知表膨胀、SMTP 封禁
  2. 明文 URL 进 notifications 表；D1 备份/控制台可读
  3. 多次 forgot 旧 token 仍有效至过期
  4. 重置接口无限速（熵高，爆破难，但仍缺防刷）
- **修复**：IP+email 限速；payload 禁止存 raw token；新请求作废旧 token；用后清理敏感字段

---

## P1 — 高风险

### P1-1 缺少安全响应头（CSP / Frame / MIME / Referrer）

- **位置**：`src/index.ts` 仅设 x-request-id
- **影响**：无 CSP 时，未来任一 DOM XSS 可直接读 sessionStorage 订阅 token（`web/src/lib/sub.ts`）
- **修复**：CSP default-src self；nosniff；Referrer-Policy no-referrer；frame-ancestors none；Permissions-Policy 收敛

### P1-2 密码长度无上限 → PBKDF2 DoS

- **位置**：login/bootstrap/user password/admin users 只校验 >=10
- **影响**：超大密码迫使 Worker 做 10 万次 PBKDF2
- **修复**：硬限制 10–128（或 256）字符

### P1-3 Cookie 解析 decodeURIComponent 可抛异常

- **位置**：`src/auth/session.ts` parseCookies
- **影响**：非法 `%` 序列导致鉴权路径 500
- **修复**：try/catch，失败当无会话

### P1-4 邮件 support_url / resetUrl 的 href 协议未校验

- **位置**：renderMail；escHtml 不阻止 javascript:/data:
- **影响**：admin 配置恶意 support_url 时邮件客户端钓鱼面
- **修复**：仅允许 https:（可选 mailto:）；resetUrl 校验同源 path

### P1-5 SMTP 主机任意 → 服务侧出站（admin SSRF 变体）

- **位置**：`src/services/smtp.ts` connect(host, port)
- **影响**：任意 host:port TCP/TLS 探测
- **修复**：私网拒绝；端口白名单 465/587

### P1-6 登录限速可被分布式绕过

- **位置**：rateKey = ip + ":" + username
- **影响**：换 IP 无限试同一用户名
- **修复**：username 全局计数 + IP 计数双阈值

### P1-7 Bootstrap 竞态

- **位置**：POST /api/auth/bootstrap-admin 先 COUNT 再 INSERT
- **影响**：空库并发可能双 admin
- **修复**：settings.initialized 唯一哨兵 / 启动后封口

### P1-8 设备数限制非原子（残留 TOCTOU）

- **位置**：serveSubscription count → insert → recheck
- **影响**：并发可能短暂超过 device_limit
- **修复**：文档化尽力而为，或条件插入

---

## P2 — 中风险 / 加固

### P2-1 会话生命周期偏长

- 配置：SESSION_IDLE_MS=7d，SESSION_ABSOLUTE_MS=30d
- 建议：管理端 idle 12h–24h，绝对期限 7d

### P2-2 订阅 token 长期路径凭证

- `/sub/{token}` 会进历史/代理日志/屏幕分享
- 建议：强调轮换与一键吊销

### P2-3 用户节点列表暴露 server:port

- `GET /api/user/subscriptions/:id/nodes`
- 建议：可配置脱敏或仅 name/protocol

### P2-4 decryptSecret 明文兼容

- 非 `v1.` 直接当明文返回
- 建议：告警并强制重加密，后续拒绝明文

### P2-5 生产未强制 CREDENTIALS_KEY

- 自动写 D1；备份即主密钥
- 建议：production 无 Secret 直接 503

### P2-6 忘记密码用户枚举面（弱）

- 已统一 `{ok:true}`；保持 enqueue 快速返回即可

### P2-7 无最后 admin 保护

- 可禁用自己导致锁死面板
- 建议：禁止关闭最后一个 enabled admin

### P2-8 审计/访问日志可一键清空

- `POST /logs/clear` 利于入侵抹痕
- 建议：清空动作写不可删最小审计

### P2-9 sameOrigin 拒绝无 Origin 的非 GET

- 浏览器正确；自动化需带 Origin；文档化即可

---

## P3 — 低风险 / 纵深

| ID | 项 | 说明 |
|----|----|------|
| P3-1 | 密码策略仅长度 | 小范围面板可接受 |
| P3-2 | 无 2FA | admin 建议后续 TOTP |
| P3-3 | workers.dev 公网暴露 | 可加自定义域 + Access |
| P3-4 | health 信息 | ready 暴露缺表名，信息量低 |
| P3-5 | 前端路由守卫 | 仅 UX，授权在 API |
| P3-6 | PBKDF2 10 万次 | 可；长期评估更强 KDF |

---

## 攻击面地图

```
Internet
  ├─ GET  /sub/:token          → 订阅下发（无会话；token=密钥）
  │     风险：日志泄露、设备竞态、无拉取限速
  ├─ POST /api/auth/*          → 登录/重置/bootstrap
  │     风险：重置限速、bootstrap 竞态、密码 DoS
  ├─ /api/admin/*              → admin Cookie
  │     风险：settings 主密钥、SSRF 配源、SMTP、日志清空
  ├─ /api/user/*               → 用户 Cookie
  │     风险：节点情报、sessionStorage token
  └─ 静态 ASSETS               → SPA
        风险：缺 CSP 时 XSS 影响放大

Cron */5                       → 刷新源 / 通知 / 清理
  风险：源 SSRF、SMTP 出站
```

---

## 密钥与敏感数据流

| 数据 | 存储 | 传输 | 风险点 |
|------|------|------|--------|
| 用户密码 | PBKDF2 哈希 | 仅 POST body | 无上限长度 |
| 会话 token | SHA-256@sessions | Cookie HttpOnly | 日志不该出现 — 当前 OK |
| 订阅 token | SHA-256@subscriptions | URL path | **访问日志 / 可观测性** |
| 源 URL/Headers | AES-GCM | 内存解密后 fetch | **主密钥 API 可读** |
| SMTP 密码 | AES-GCM | SMTP AUTH | 主密钥、settings 仅脱敏 pass |
| 重置 token | SHA-256@表 + **明文@notifications** | 邮件链接 | **payload 落库** |
| credentials_key | env 或 **D1 settings** | GET settings | **P0-1** |

---

## 与需求的安全映射

| 需求 | 安全现状 |
|------|----------|
| CF Worker + D1 后台管理 | 鉴权可用；缺安全头与密钥托管 hardening |
| 多协议订阅聚合下发 | token 模型正确；日志与可观测性拖后腿 |
| 分组/多用户 | IDOR 基本 OK；admin 单角色 |
| 流量/设备/审计 | 设备尽力而为；审计可被清空 |
| 自动停用/邮件提醒 | SMTP 第三方 OK；重置与邮件载荷需收紧 |
| 明确不做：测速/WS/3X-UI/代理商 | 无额外攻击面 |

---

## 修复优先级路线

### 第一批（P0）

1. settings GET 剔除 credentials_key；生产强制 Secret
2. access log 脱敏 /sub/:token；降低 observability 采样
3. SSRF：::ffff: + 保留地址 + headers 白名单
4. forgot-password 限速；notifications 禁止存 raw reset token

### 第二批（P1）

5. 全局安全头
6. 密码最大长度
7. cookie 解析容错
8. support_url 协议白名单
9. SMTP 出站限制
10. 登录双维限速 + bootstrap 原子化

### 第三批（P2/P3）

11. 会话时长收紧
12. 最后 admin 保护
13. 清空日志的不可抹痕迹
14. 明文 secret 迁移告警
15. 可选 2FA / Cloudflare Access

---

## 验证清单（修复后）

- [ ] admin GET /api/admin/settings JSON 中无 credentials_key、无 smtp 明文
- [ ] wrangler tail 拉取订阅时 path 无完整 token
- [ ] 远程源 URL https://[::ffff:127.0.0.1]/ → 拒绝
- [ ] 自定义 headers 含 Host → 拒绝或剥离
- [ ] 1 分钟内 >N 次 forgot-password → 429
- [ ] D1 notifications.payload_json 无 reset_token= 明文
- [ ] 响应头含 CSP / nosniff / frame-ancestors
- [ ] 10k 字符密码 → 400
- [ ] 非法 Cookie 百分号 → 401 而非 500

---

## 非结论（避免误报）

- **SQL 注入**：主要路径参数化，LIKE ? 绑定安全
- **用户 API 越权订阅**：已按 user_id 过滤
- **订阅失败回显**：opaque 404，无详细原因 — 正确
- **CORS 开放**：未见 Access-Control-Allow-Origin: *；同站 Cookie 模型
- **前端角色判断**：仅 UX，不当事授权

---

## 参考文件

| 文件 | 相关问题 |
|------|----------|
| `src/routes/admin.ts` | P0-1 settings；用户管理；日志清空 |
| `src/index.ts` | P0-2 path 日志；缺安全头 |
| `src/services/ssrf.ts` | P0-3 |
| `src/services/sources.ts` | 源 headers/URL 加密与 fetch |
| `src/services/credentials.ts` | 主密钥派生与明文兼容 |
| `src/routes/auth.ts` | P0-4 重置；bootstrap；登录限速 |
| `src/services/notifications.ts` | 重置载荷；邮件 HTML |
| `src/services/smtp.ts` | P1-5 出站 |
| `src/auth/session.ts` | Cookie 解析；会话签发 |
| `src/services/subscriptions.ts` | 设备限制；token 校验；下发 |
| `src/routes/user.ts` | 改密；节点信息 |
| `web/src/lib/sub.ts` | sessionStorage token |
| `wrangler.jsonc` | 可观测性采样；会话时长 |

---

*本报告只记录问题与修复方向，不包含利用 PoC 代码。*


---

## 修复进度（2026-07-11）

| ID | 状态 | 说明 |
|----|------|------|
| P0-1 | 已修 | settings GET 剔除 credentials_key |
| P0-2 | 已修 | /sub path 日志脱敏；采样 0.1 |
| P0-3 | 已修 | SSRF ::ffff/headers 白名单 |
| P0-4 | 已修 | 重置限速 + enc token + scrub |
| P1-1~7 | 已修 | 安全头/密码上限/cookie/href/SMTP/限速/bootstrap |
| P1-8 | 保持 | 设备限制尽力而为 |
| P2 多项 | 已修 | 会话时长/节点脱敏/最后 admin/日志清空标记 |
| P2-4/5 | 部分 | D1 credentials_key 回退仍在；生产请设 Secret |
