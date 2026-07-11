# SubPanel 全面审查报告

> 审查基准：仓库 `C:\\工作区\\sub-panel`（`main` @ `966b67c` + 未提交 Me/Password UI 改动）  
> 对照需求：CF Worker+D1 管理面板 / 多源聚合订阅 / 分组下发 / 多内核输出 / 次级用户 / 流量设备审计 / 到期自动停用与邮件  
> 明确不做：真实测速、在线 WebSocket、3X-UI 流量、代理商树、CF Queues/CF Email  
> 日期：2026-07-11

本文件只列问题与建议，不改代码。优先级：

| 级 | 含义 |
|----|------|
| P0 | 正确性/安全/部署阻塞，应先修 |
| P1 | 需求缺口或高概率踩坑 |
| P2 | 体验、可维护性、一致性 |
| P3 | 增强项 / 可选 |

---

## 0. 现状快照

**已具备（主干可用）**
- Worker + D1 + Assets SPA；Cron `*/5 * * * *`；无 Queue 绑定
- 源：手工 / 远程 / 透传；节点池；分组（含空分组）；订阅 token；多格式渲染
- 角色：`admin` / `operator` / `user`（库与后端仍有 operator）
- 会话 Cookie + PBKDF2；登录限速；审计/访问/通知/任务日志
- 生命周期：到期/超额自动停用、可选自动恢复、SMTP 邮件
- 前端：总览/用户/源/节点/分组/订阅/日志/设置/我的订阅/改密；亮暗主题

**未提交改动（工作区脏）**
- `src/routes/user.ts` 用户节点 API
- `web/src/pages/MePage.tsx` tabs + 复制弹 QR
- `web/src/pages/PasswordPage.tsx`（未跟踪）
- 订阅流量 GB 输入等

---

## 1. P0 — 安全 / 数据 / 部署

### 1.1 README 中文乱码（部署文档不可用）
- **现象**：`README.md` 正文在 UTF-8 解码下为乱码（疑似错误编码写入/转存），GitHub 中文介绍会坏。
- **影响**：一键部署说明不可读。
- **修法**：UTF-8 无 BOM 重写 README；提交前用 `file`/十六进制核对。

### 1.2 源文件 UTF-8 BOM
- **文件**：`src/auth/session.ts`、`src/db/types.ts`、`src/renderers/{index,mihomo,uri}.ts`、`src/routes/{auth,user}.ts`、`src/services/{health,sources,subscriptions}.ts` 等带 `EF BB BF`。
- **影响**：工具链/diff/部分解析怪异；风格不统一。
- **修法**：批量去 BOM。

### 1.3 远程源凭证密钥可丢且难轮换
- **位置**：`src/services/sources.ts` `credentialsKey()`
- **问题**：
  1. 缺省 `CREDENTIALS_KEY` 时自动写入 D1 `settings.credentials_key`；备份/多环境复制后密钥与密文可能不一致。
  2. 密钥丢失则 `encrypted_url` / `encrypted_headers` 全废。
  3. 无轮换/重加密流程。
- **修法**：生产强制 Secret；提供重填 URL / 重加密运维入口；禁止静默换 key。

### 1.4 SMTP 密码明文落 D1
- **位置**：`settings.smtp_pass` JSON 明文；API 仅回读打码。
- **影响**：D1 读权限 = 邮件凭据泄露。
- **修法**：AES-GCM 加密存储，或改 Worker Secret。

### 1.5 设备上限 TOCTOU 竞态
- **位置**：`serveSubscription` 先数设备再 INSERT 指纹。
- **问题**：并发首拉可突破 `device_limit`。
- **修法**：事务/插入后校验；或文档标明「尽力限制」。

### 1.6 订阅拉取写放大（D1 限额风险）
- **位置**：每次 touch `subscription_devices` + 写 `subscription_access_logs`；列表 health 多格式 render。
- **问题**：客户端高频刷新易顶 D1 写/行数。
- **修法**：设备 touch 节流；访问日志采样；health 按 revision 缓存。

### 1.7 Passthrough 短路语义错误
- **位置**：`serveSubscription` 对分组 `LIMIT 1` 取任意 passthrough。
- **问题**：混合分组会错误整包透传、丢掉其它节点。
- **修法**：仅当分组全部来自单一 passthrough，或显式 `group.mode=passthrough`。

### 1.8 ETag 过弱
- **位置**：etag = `id/revision/group/format/body.length`，无 body 哈希/源 revision。
- **问题**：内容变长度不变 → 304 脏缓存；源刷新未 bump 订阅 revision 更糟。
- **修法**：body hash 或 `group.revision + source revisions`；refresh 时 bump 引用分组。

### 1.9 Schema 双轨 + FK 弱约束
- **文件**：`schema.sql` 与 `migrations/0001_init.sql`。
- **问题**：演进易漂移；D1/SQLite 默认不强制 FK；`usage_mode` CHECK 含未实现的 `managed`。
- **修法**：单源生成；清理 managed 或实现；文档写清初始化路径。

### 1.10 一键部署仍脆弱
- 历史：`vite: not found`（web 依赖布局已部分缓解）。
- `wrangler.jsonc` 写死个人 `database_id`，他人 fork 必须重绑。
- 空库无「缺表」友好探测（仅 bootstrap 用户）。
- **修法**：文档强调绑 D1 + 粘贴 schema；`/health/ready` 或登录探测缺表。

---

## 2. P1 — 需求对照缺口 / 逻辑坑

### 2.1 角色模型与产品声明不一致（operator）
- UI 文案：次级账号固定 user、无 operator。
- 实际：DB CHECK、`UserRole`、`isStaff`、创建/改角色、Layout `operatorGroups`、App 路由仍支持 operator。
- **修法**：删干净或正式化；半残最差。

### 2.2 流量统计能力边界未产品化
- 模式：`none` | `manual` | `upstream_exclusive`；（schema 还有 `managed`）
- 无真实链路流量（符合不做 3X-UI），但「流量统计」易误解。
- `manual` 纯手填；`upstream_exclusive` 依赖上游 userinfo，多源无法拆账。
- **修法**：UI/README 写清三种模式；去掉或灰显 managed。

### 2.3 设备数语义
- 指纹 = IP 前缀 + UA hash + client family；NAT/UA 变化导致偏差。
- Me 页有说明，管理端仍易被当成「在线设备」。
- **修法**：全站统一「订阅拉取设备」文案。

### 2.4 自动停用 / 邮件
**已有**：到期/超额停用、`auto_reenable`、SMTP、event_key 去重。  
**缺口**：
- 忘记密码 API 有，登录页无入口；`/?reset_token=` 前端未接。
- 邮件 HTML 未转义 payload（管理员可控内容进邮件客户端）。
- Cron 单触发扛多任务；SMTP 同步发送拖长 cron/请求。
- free plan 全账号 cron 限额需文档强调。

### 2.5 协议解析 / 渲染一致性

| 问题 | 说明 |
|------|------|
| capability vs renderer | 矩阵称 mihomo 无 naive，`mihomo.ts` 仍 emit `naiveproxy` |
| sing-box/mihomo 导入 map | 缺 anytls/naive 等，配置导入会丢 |
| Reality 字段 | `publicKey`/`public_key` 混用 |
| Surge | 仅 ss/trojan/http 子集 |
| SSR | 仅 uri 透传 |
| WireGuard | 无 uri 分享线 |
| 超长 cert | 进 URI query 可能被客户端截断 |

### 2.6 客户端识别
- karing→singbox，flclash/clash→mihomo，nekobox→uri，基本合理。
- `meta` 子串偏宽；Loon/部分 UA 不全；unknown 默认 uri。

### 2.7 订阅安全响应
- 无效/停用/超额 → 空 404（防枚举，好）。
- 全节点 skip → 422 JSON，与 opaque 策略不一致。
- 无 sub 级限速，token 泄露可刷写日志。

### 2.8 用户/订阅管理
- 用户到期编辑偏「再延 N 天」，绝对日期/清空弱；列表信息密度不足。
- 无删除用户。
- 订阅 token 只显示一次 + sessionStorage；换浏览器必须轮换（安全正确，需引导）。

### 2.9 健康检查成本
- `buildSubscriptionHealth` 每订阅 5 格式全 render；列表 N 倍放大。

### 2.10 日志保留默认不一致
- wrangler vars：7 天；`readVars` fallback：30 天；cleanup 再读 settings。需统一。

---

## 3. P2 — 前端 / UX / 工程

### 3.1 改密双 API
- `/api/auth/me/password` 与 `/api/user/password` 并存。
- 会话失效路径不一致。
- **修法**：单路径；成功强制登出。

### 3.2 外部二维码隐私
- `api.qrserver.com` 外传完整订阅 URL。
- **修法**：本地生成 QR。

### 3.3 UI / 权限
- operator 菜单残留。
- 列表无分页（多处 LIMIT 200）。
- 移动端未系统适配。
- toast 右下角策略需保持，禁止再顶布局。

### 3.4 设置
- 发件与通用已拆分。
- 缺 SMTP 测试发送、模板/触发说明内嵌、`SITE_NAME` vs `site_name` 优先级说明。

### 3.5 质量门禁
- 无 tests（gitignore 掉 tests/）；无 CI。
- 解析/渲染回归全靠手工。

### 3.6 会话
- 每请求 touch 写库。
- SameSite=Strict + Origin CSRF：偏严，正确。

### 3.7 SSRF
- 私网/localhost/redirect 上限较好；DNS rebinding 类残留风险常见于 Workers fetch。

### 3.8 任务
- 名为 queue、实为同步 inline；失败无自动重试。

---

## 4. P3 — 可选增强

- 管理端 Cloudflare Access
- 分组/订阅克隆、节点拖拽排序
- 兼容矩阵与 render 单测对齐
- 总览消费 `subscription_access_daily`
- Me 页展示 announce
- 备份导出（二次确认）
- i18n

---

## 5. 需求 1–8 对照

| # | 需求 | 现状 | 差距 |
|---|------|------|------|
| 1 | CF Worker+D1 后台 | 有 | README 乱码；schema 手工；database_id 个人化 |
| 2 | 多源合成 + 多客户端 | 有 | 客户端可扩；QR 外泄 URL |
| 3 | 节点/订阅/分组下发 | 有（空分组 OK） | passthrough 混合组 bug |
| 4 | 常见节点/订阅类型 | 主线覆盖 | 导入 map 缺口 |
| 5 | 常见内核 | mihomo/singbox/uri/surge | 非完整 ruxray 导出；Surge 子集 |
| 6 | 多次级用户 | 有 user | operator 残留；无删用户 |
| 7 | 流量/设备/审计 | 有 | 非真实链路流量；指纹设备；无分页 |
| 8 | 自动停用+邮件 | 有 | 重置密码 UI 无；SMTP 明文；无测试邮件 |

---

## 6. 过度工程 / 可删减（ponytail）

- `delete:` 半套 operator
- `delete:` `managed` usage_mode 残骸
- `yagni:` jobs/queue 命名（实为 inline）
- `yagni:` access daily 聚合无前端
- `shrink:` `admin.ts` 上帝路由
- `shrink:` health 五格式全 render
- 双 schema → 单源生成

---

## 7. 建议修复顺序

1. README UTF-8 + BOM 清理 + 保留天数统一  
2. operator 删除或正式化  
3. passthrough 条件、ETag、源 revision 传播  
4. 凭证密钥与 SMTP 加密/Secret  
5. 设备/日志写放大治理  
6. 解析/capability 与 renderer 对齐  
7. 重置密码 UI + 改密单路径  
8. 本地 QR  
9. 列表分页 + health 缓存  
10. 最小 CI：build + tsc + 核心 parse 断言  

---

## 8. 关键文件索引

| 域 | 路径 |
|----|------|
| 入口 | `src/index.ts`, `wrangler.jsonc` |
| 订阅下发 | `src/services/subscriptions.ts`, `src/routes/sub.ts` |
| 源刷新 | `src/services/sources.ts`, `src/services/ssrf.ts` |
| 解析渲染 | `src/parsers/*`, `src/renderers/*` |
| 生命周期邮件 | `src/jobs/cron.ts`, `src/services/notifications.ts`, `src/services/smtp.ts` |
| 权限 | `src/routes/admin.ts`, `src/routes/auth.ts`, `src/routes/user.ts` |
| 前端壳 | `web/src/App.tsx`, `web/src/components/Layout.tsx`, `web/src/styles.css` |
| 我的订阅 | `web/src/pages/MePage.tsx`, `web/src/pages/PasswordPage.tsx` |
| 库表 | `schema.sql`, `migrations/0001_init.sql` |

---

## 9. 非问题（刻意保持）

- 不做真实测速 / 在线 WS / 3X-UI / 代理商树  
- 不做 CF Queue / CF Email Sending  
- Token 只显示一次  
- 无效订阅 opaque 404  

---

*审查方式：通读后端核心路径 + 前端路由/关键页 + schema/部署配置 + 与需求清单 diff；未做生产压测与全协议矩阵实测。*


---

## 10. 修复进度（2026-07-11）

已落地（本轮）：
- README UTF-8 重写；12 个 BOM 清除
- 日志保留默认统一 7 天
- 去掉 operator / managed（schema + 前后端）
- 订阅下发：纯 passthrough 才短路；ETag 含 body；设备写节流 + 插入后复核；全 skip 改 opaque 404；访问日志采样
- 源刷新 bump 关联分组 revision
- SMTP 密码加密存储 + 解密发送；邮件 HTML 转义
- credentials 模块共用
- health/ready 缺表提示
- anytls/naive 导入 map；mihomo 不再 emit naiveproxy
- 本地 QR（qrcode-generator）；登录找回/重置；改密强制重登
- 最小 CI workflow

仍建议后续：列表分页、health 缓存、设备限制严格事务、CREDENTIALS_KEY 生产强制校验 UI。
