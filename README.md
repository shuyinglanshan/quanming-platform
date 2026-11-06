# 小天才圈名平台 · Quanming Registry

> 给每一个圈名，一个清晰的归属。
> 一个面向创作圈的「圈名归属登记 / 检索 / 审核 / 申诉」平台，包含三级权限的管理后台。
> 开发者：**疏影阑珊**

---

## ✦ 功能总览

### 前台（用户侧）

| 页面 | 说明 |
| --- | --- |
| 圈名广场 `/` | 大搜索框 + 联想补全，展示所有**已完成归属审核**的圈名；支持最新/最热/名称排序、分页 |
| 圈名详情 `/names/:id` | 圈名简介、归属者、绑定标识、浏览量；**发起归属申诉**（上传材料，人工复核） |
| 登录 `/login` | **QQ 邮箱 / 手机号 / 用户名** 三种方式 + 密码登录；另支持 QQ 邮箱验证码登录 |
| 注册 `/register` | 支持 **QQ 邮箱** 与 **手机号** 两种方式；QQ 邮箱**只需填 QQ 号，后缀固定为 `@qq.com`**；引入 **滑块验证码** 与注册频率风控；需填写唯一用户名 |
| 个人中心 `/me` | 我的圈名 / 归属申请 / 申诉进度 / **账号信息（手机号、QQ、微信、小红书绑定情况，支持修改，每月限 3 次）** / 修改密码 |
| 通知中心 `/notifications` | **个人通知 + 系统通知**，按类型筛选、仅看未读、按日期分组、详情弹层；导航栏红点提醒 |
| 提交归属审核 | 拖拽或点选上传图片（最多 6 张、单张 8MB），填写圈名与简介 |
| 关于 `/about` | 项目描述、开发者信息（疏影阑珊）、技术栈、**加入交流群按钮** |

### 后台（管理侧）`/admin`

后台按**权限组**展示功能：普通用户看不到入口，直接访问也会被拦截。

| 模块 | 管理员 admin | 审核员 assessor |
| --- | :-: | :-: |
| 数据概览 | ✅ | ✅ |
| 归属审核（通过 / 驳回 / 批量） | ✅ | ✅ |
| 归属申诉（通过并转移归属 / 驳回） | ✅ | ✅ |
| 用户与权限组管理（含**代改社交绑定**） | ✅ | — |
| 圈名管理 | ✅ | — |
| 通知发布（全员广播 / 指定用户） | ✅ | — |
| QQ 邮箱配置 | ✅ | — |
| 访问风控（限流参数 / 注册频率 / IP 拉黑） | ✅ | — |
| 访问日志 | ✅ | ✅ |

- **数据概览**：用户数、圈名数、待审核、待处理申诉、访问量、通过率、平均审核时长；14 天趋势图（SVG 自绘）、搜索热词、待审队列、待处理申诉、最近访问、运营提示
- **归属审核**：按状态/关键词筛选，查看材料大图，**通过**（创建圈名并绑定、自动驳回同名申请）或**驳回**（必填理由 + 常用理由模板），支持批量处理
- **归属申诉**：查看申诉材料与理由，**通过后圈名归属立即转移给申诉人**，系统同时通知申诉人与原归属账号；驳回需填写理由
- **用户与权限组**：搜索 / 筛选 / 排序、查看详情、**调整为 admin / assessor / user**、批量调整、封禁解封、删除
- **通知发布**：全员系统通知广播、按邮箱/昵称搜索指定用户定向发送、通知记录管理与删除
- **QQ 邮箱配置**：设置 QQ 邮箱账号、SMTP 授权码、发送者名称、SMTP 服务器与端口、SSL、**邮件主题与 HTML 模板**（支持 `{{code}}` `{{action}}` `{{year}}` `{{site}}`），可测试连接、预览邮件、发送测试邮件
- **访问风控**：滑动窗口频繁请求检测（先提醒、再短暂拉黑，避免误触发）、IP 白名单、临时限制与永久拉黑 / 解除、风控事件流
- **访问日志**：路径、状态码、耗时、IP、浏览器、系统、设备、账号；支持登录注册 / 审核动作 / 风控限制 / 异常请求筛选，可开启自动刷新

---

## ✦ 技术栈

- **后端**：Node.js 22.5+ / Express 4 / **SQLite（node:sqlite，内置无需编译）** / multer / nodemailer / bcryptjs
- **前端**：React 19 + TypeScript + Vite 8 + Tailwind CSS 4 + **shadcn/ui**（Radix UI）+ lucide-react + sonner
- **视觉**：深色玻璃拟态（毛玻璃）风格；视觉体系经过收敛，仅保留必要的 backdrop-filter 与静态渐变，动画克制、移动端自动降级
- **国内镜像**：Node.js 走 **清华 TUNA 镜像**，npm 走 npmmirror

---

## ✦ 部署步骤

### 1. 安装 Node.js（清华镜像）

```bash
./scripts/install-node.sh 22.14.0
```

脚本会从 `https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/` 下载对应架构的 Node.js，
安装到 `/usr/local/node` 并软链到 `/usr/local/bin`，同时把 npm registry 设为 npmmirror。

> 已有 Node.js 18+ 可跳过此步。

### 2. 安装依赖

```bash
npm run install:all
```

### 3. 配置环境变量（**必填**）

```bash
cp server/.env.example server/.env
```

编辑 `server/.env`（**管理员账号可全部留空，首次启动自动随机生成**）：

```ini
PORT=3000

# 首个管理员账号：留空即自动随机生成用户名与密码，并打印到控制台
# 仅在数据库为空时创建一次
ADMIN_EMAIL=          # 可选，留空则只能用用户名登录
ADMIN_USERNAME=       # 可选，留空则随机生成如 qm_admin_7f3a2c
ADMIN_PASSWORD=       # 可选，留空则随机生成 16 位强密码
ADMIN_NICKNAME=平台管理员

# QQ 邮箱发信（也可登录后台在「邮箱配置」里填写）
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USER=你的QQ邮箱@qq.com
SMTP_PASS=你的SMTP授权码           # 是授权码，不是登录密码

# 应用层加密（可选）
# CRYPTO_ROTATE_KEYS=1            # 需轮换密钥时临时开启一次，启动成功后删除该行
REQUIRE_ENCRYPTED=1               # 生产默认开启；敏感接口拒绝明文
# ALLOW_PLAINTEXT_SENSITIVE=1     # 确有明文脚本调用需求时才放开（不推荐）

# 反代与协议（生产部署在 Nginx 后必须配置）
TRUST_PROXY=1
TRUST_PROXY_HOPS=1
TRUSTED_PROXIES=127.0.0.1/32
FORCE_HTTPS=0                     # HTTPS 可用后改为 1，强制敏感操作走 HTTPS
ENABLE_HSTS=1                     # 可选，默认生产已发送 HSTS
```

> **必须完成邮箱配置**，否则注册与验证码登录无法使用。
> QQ 邮箱需在「设置 → 账户 → POP3/IMAP/SMTP 服务」开启并生成授权码。
> 也可先留空，启动后用管理员账号登录后台在「邮箱配置」页面填写（保存即生效）。

### 4. 构建并启动

```bash
npm run build      # 构建前端到 web/dist
npm start          # 启动服务（http://localhost:3000）
```

或使用便捷脚本：

```bash
./scripts/start.sh          # 自动构建 + 后台启动
./scripts/dev-server.sh log # 查看日志
./scripts/dev-server.sh stop
```

首次启动时，系统会在数据库为空的情况下**自动随机生成一个管理员账号**，
并把用户名与密码打印到控制台：

```
═══════════════════════════════════════════════════════
✦ 首次启动：管理员账号已自动生成
➜ 以下账号密码为随机生成，仅本次显示，请立即保存
═══════════════════════════════════════════════════════
用户名    qm_admin_7f3a2c
密码      vPMm3Lkz&$9PCRyE
登录地址  /login
═══════════════════════════════════════════════════════
```

- 用户名格式为 `qm_admin_` + 6 位随机十六进制；密码为 16 位，包含大小写字母、数字与符号
- 密码只以 bcrypt 哈希入库，明文**仅在首次启动时打印一次**
- 若在 `.env` 中显式填写 `ADMIN_USERNAME` / `ADMIN_PASSWORD`，则使用指定值
- 忘记密码时可删除 `server/data/quanming.db`（连同 `-wal`/`-shm`）重启，会重新生成
  （**会清空所有数据**）；或直接修改数据库中的 `password_hash` 字段

**不会写入任何示例圈名、示例用户或示例审核记录**，所有数据均来自真实使用。

登录后请立即在「个人中心 → 安全设置」修改密码，并按需在后台把其他账号设为审核员。

### 5. 开发模式（前后端分离热更新）

```bash
npm run dev:server   # 终端 1：后端 :3000
npm run dev:web      # 终端 2：前端 :5173（已配置 /api、/uploads 代理）
```

---

## ✦ 权限组设计

```js
ROLE_PERMISSIONS = {
  admin:    ['review', 'appeal', 'users', 'names', 'logs', 'settings', 'notify', 'dashboard'],
  assessor: ['review', 'appeal', 'dashboard', 'logs'],
  user:     [],
}
```

- 后端：`requireStaff`（admin/assessor）+ `requirePermission('review' | 'appeal' | 'users' | 'settings' | 'notify' | 'logs')`
- 前端：`useAuth().can(permission)` 控制导航与面板；普通用户访问 `/admin` 会被 `RequireAuth staff` 拦截
- 权限变更即时生效（每次请求都校验角色），并给被调整的用户发送通知

---

## ✦ 数据库

### 引擎选择

使用 **Node.js 内置 `node:sqlite`**（Node 22.5+）：

- 无需编译原生模块（比 better-sqlite3 更适合受限环境）
- 单文件存储，备份只需复制一个文件
- 开启 **WAL 模式**：读写并发更好，崩溃可恢复
- 启用外键约束，保证数据一致性

### 表结构（17 张）

| 表 | 说明 |
| --- | --- |
| `users` | 用户（邮箱/手机号/用户名唯一索引，密码 bcrypt 哈希） |
| `sessions` | 登录会话（外键级联删除） |
| `names` | 已绑定圈名（名称唯一索引，浏览量索引） |
| `claims` | 圈名归属申请（含图片 SHA-256） |
| `appeals` | 归属申诉 |
| `notifications` | 通知（按用户+时间索引） |
| `logs` | 访问日志（含防篡改哈希链 `prev`/`chain`） |
| `codes` | 邮箱验证码（只存 hash） |
| `captchas` | 滑块挑战（一次性） |
| `searches` | 搜索行为（热词统计） |
| `blocked_ips` | IP 永久黑名单 |
| `temp_blocks` | IP 临时封禁 |
| `security_events` | 风控事件流 |
| `login_failures` | 登录失败计数（账号/IP/密码指纹 三维度） |
| `register_attempts` | 注册频率闸门 |
| `settings` | 系统配置（键值对） |
| `meta` | 元信息（版本） |

### 初始化

**首次启动自动完成建库建表**，无需手动干预。也可手动执行：

```bash
npm run db:init     # 初始化（幂等，已存在则只校验结构）
npm run db:info     # 查看表数量与各表数据量
npm run db:reset    # 删除并重建（⚠️ 清空所有数据）
```

数据库文件：`server/data/quanming.db`（已在 .gitignore 中排除）

### 读写策略

采用「**写穿透 + 内存读缓存**」：

- 启动时全量加载到内存，保证原有同步查询语义（性能好）
- 所有写操作**立即持久化到 SQLite**（非定时刷盘，断电不丢数据）
- 多表关联操作用事务保证原子性

> 说明：结构化字段（email/username/status/views）建独立列并加索引，
> 查询频率低的嵌套数据（bindings/images/history）以 JSON 文本存储，兼顾灵活性与查询性能。

### 备份

```bash
# 停服后复制即可（WAL 文件也需一并复制）
cp server/data/quanming.db* /your/backup/

# 或使用 SQLite 在线备份（服务运行中也可）
sqlite3 server/data/quanming.db ".backup '/backup/quanming-$(date +%F).db'"
```

---

## ✦ 目录结构

```
quanming/
├── server/                     # Node.js 后端
│   ├── index.js                # 入口：中间件、路由挂载、静态资源、启动与首个管理员创建
│   ├── lib/
│   │   ├── db.js               # JSON 数据库（深合并迁移 + 防抖 + 原子写入）
│   │   ├── auth.js             # 会话、Cookie、requireAuth/requireStaff/requirePermission
│   │   ├── mailer.js           # QQ 邮箱 SMTP 发信 / 后台动态配置 / 模板渲染
│   │   ├── notify.js           # 通知中心（个人通知、全员广播、已读、未读数）
│   │   ├── guard.js            # 访问风控（滑动窗口、提醒升级、临时/永久拉黑）
│   │   ├── logger.js           # 访问日志与业务事件日志
│   │   ├── upload.js           # multer 图片上传（类型/大小限制）
│   │   └── util.js             # 邮箱识别、校验、UA 解析、分页
│   ├── routes/
│   │   ├── auth.js             # 发送验证码 / 注册 / 登录 / 登出 / 改密
│   │   ├── names.js            # 圈名列表、联想、详情、搜索热词、公开统计
│   │   ├── claims.js           # 提交归属申请、我的申请、撤回
│   │   ├── appeals.js          # 提交归属申诉、我的申诉、撤回
│   │   ├── notifications.js    # 通知列表、未读数、标记已读
│   │   ├── me.js               # 个人资料、社交账号绑定、我的申诉
│   │   ├── admin.js            # 概览统计、归属审核、申诉审核
│   │   ├── admin-manage.js     # 用户与权限组、圈名管理、访问日志
│   │   └── admin-system.js     # 邮箱配置、通知发布、IP 风控
│   ├── data/db.json            # 运行时数据（gitignore，首次启动自动生成）
│   └── uploads/                # 用户上传的图片材料
├── web/                        # React 前端
│   └── src/
│       ├── components/ui/      # shadcn/ui 组件（button/card/dialog/select/tabs…）
│       ├── components/admin/   # 后台面板（审核/申诉/用户/通知/邮箱/风控/日志/图表）
│       ├── pages/              # home / name-detail / login / register / profile / notifications / about / admin
│       └── lib/                # api、auth、notifications、rate-alert、工具函数、站点常量
└── scripts/
    ├── install-node.sh         # 清华镜像安装 Node.js
    ├── start.sh                # 一键构建 + 启动
    ├── dev-server.sh           # 启停脚本
    └── quanming.service        # systemd 服务单元
```

---

## ✦ 关键实现说明

- **QQ 邮箱格式**：统一使用 `QQ号@qq.com`（5-11 位数字），其余后缀一律拒绝；
  前端把 `@qq.com` 作为固定后缀展示，只接收 QQ 号，并实时提示「将使用 xxx@qq.com」与注册状态。
- **验证码安全**：数据库只存 `sha256(code)`，10 分钟过期、单码最多试 5 次、60 秒重发间隔、单邮箱每小时 6 次。
- **验证码发送**：只走真实 SMTP。未配置发信账号时接口返回 503 并提示管理员配置，**不做任何模拟发送**，
  发送失败会立即作废该验证码，不占用发送次数。
- **归属审核**：审核通过时创建圈名记录并绑定 owner，同时**自动驳回同名的其他待审申请**；
  驳回必须填写 ≥2 字的理由，用户端会完整展示并收到通知。
- **归属申诉**：申诉期间归属不变；通过时把 `ownerId` 转移给申诉人、写入 `history`，
  并给**新归属者**与**原归属者**各发一条通知；同名其它待审申诉自动驳回。
- **通知**：广播时为每位用户各写一条记录（便于统计已读），未读数由前端 30 秒轮询刷新。
- **权限**：`requireStaff` / `requirePermission` 中间件；封禁用户时立即清除其全部会话。
- **访问风控**：滑动窗口按 IP 统计接口请求；超限先返回 429 提醒（同一窗口只累计 1 次 strike），
  **连续多个窗口都超限**才升级为临时拉黑（首次 `tempBlockSeconds`，再次延长到 `longBlockSeconds`），
  避免正常用户并发请求被误封；解封时会清空该 IP 的窗口计数，防止解封后立刻又被限流。
- **账号体系**：支持 QQ 邮箱、手机号两种注册方式，注册时必须设置**唯一用户名**；
  登录支持「邮箱 / 手机号 / 用户名」三选一，服务端统一用 `findUserByIdentifier` 解析。
- **QQ 邮箱固定后缀**：注册与验证码登录只接受 `QQ号@qq.com`（5-11 位数字），
  前端输入框把 `@qq.com` 作为固定后缀展示，用户只需填写 QQ 号，对外提交时自动拼接完整邮箱。
- **滑块验证**：服务端生成缺口位置（`GET /api/auth/captcha`），前端拖动到位后
  `POST /api/auth/captcha/verify` 预校验并标记 `verified`；真正提交时 `consumeChallenge` 一次性消费，
  防重放、5 分钟过期、最多 5 次尝试。
- **注册频率风控**：同一 IP 在窗口内注册尝试超过阈值，先返回 429 提示并**临时封禁**该 IP；
  累计封禁达到阈值后**自动永久拉黑**，注册成功后清零计数。参数可在后台「访问风控」调整。
- **绑定修改限额**：每个用户每月可修改社交绑定 3 次（可后台调整），**首次绑定不占用额度**，
  解绑同样计入；额度用尽返回 429 并提示下月重置。管理员代改不受限制，且会通知用户。
- **安全加固**（已通过渗透测试验证）：
  - 滑块挑战由服务端签发，客户端传入的 `completed` / `offset` 一律忽略，必须由服务端记录 `verified` 才能消费，且一次性防重放
  - 登录防爆破：账号 5 次 / IP 20 次连续失败即锁定，锁定期间即使密码正确也拒绝，成功后清零
  - 统一安全响应头：CSP、X-Frame-Options、nosniff、Referrer-Policy、Permissions-Policy
  - CSRF 防护：写操作校验 Origin/Referer 同源
  - 原型污染防护：`urlencoded({extended:false})` + 递归剔除 `__proto__` 等危险键
  - 上传安全：禁止 SVG，校验文件头 magic bytes 防伪装，服务端重命名，上传目录强制 CSP `sandbox`；
    业务校验失败立即删除已落盘文件，并按用户 200MB/小时配额限制上传，防止磁盘耗尽
  - XSS 防护：昵称、圈名、简介、申诉理由统一 `sanitizeText` 清洗（移除 script/style 等危险元素与全部标签）
  - 验证码接口单 IP 每小时签发上限，防内存耗尽
  - 路径穿越防护、错误信息不泄漏堆栈、敏感字段（passwordHash）永不出现在接口响应
- **反向代理与真实 IP**（重要）：默认 `trust proxy = false`，客户端 IP 一律取 TCP 连接地址，
  因此伪造 `X-Forwarded-For` 无法绕过任何 IP 限流。部署在 Nginx/CDN 之后必须显式设置
  `TRUST_PROXY=1`、`TRUST_PROXY_HOPS`、`TRUSTED_PROXIES`，否则会把所有访客识别为同一个反代 IP。
  解析逻辑位于 `server/lib/ip.js`，从 XFF **右侧**按可信任跳数取值，左侧内容不可信。
- **防爆破与限流实测**：
  - 同一 IP 10 分钟内注册超过 5 次即被拒（**成功注册不再清零窗口**，防止「注册一次清零一次」绕过）
  - 账号连续 5 次密码错误锁定 5 分钟起，指数退避至 1 小时；单 IP 20 次失败同样锁定
  - 验证码签发按 IP 每小时 300 次上限，防内存耗尽
  - 绑定修改额度为同步临界区自增，并发无法击穿
- **会话安全**：Cookie 带 `HttpOnly` + `SameSite=Lax`；**修改密码后自动失效该账号所有其他会话**
  （保留当前会话），避免被盗会话在改密后继续可用；管理员封禁/删除用户时立即清除其全部会话。
- **恒定时间登录**：账号不存在时仍执行一次 bcrypt 比对，消除通过响应时间枚举已注册账号的侧信道。
- **信息暴露面收敛**：SPA fallback 只对明确的前端路由返回 `index.html`，
  其他路径（尤其带扩展名或隐藏文件，如 `/.env`、`/x.zip`、`/.git/config`）一律返回真正的 404。
  避免"任意路径都 200"导致扫描器/安全设备无法识别真实攻击面，也避免掩盖静态目录误挂载。
- **日志完整性哈希链**：每条日志携带 `prev`（上一条的哈希）与 `chain`（本条哈希），形成防篡改链。
  新版日志（`v=2`）将 `detail`、`email`、`ua` 一并纳入哈希，管理员可通过
  `GET /api/admin/logs/integrity` 校验，重启后仍可发现字段级篡改并定位断裂点。
  系统**不提供删除访问日志的接口**；清理风控事件这类高风险操作会先写入审计日志再执行。
- **高频写入收敛**：圈名浏览量、搜索热词属于可容忍少量延迟的计数数据，改为 3 秒合并落库，
  避免单个请求重写整张表造成写放大 DoS；关键业务数据仍保持同步写穿。
- **封禁一致性**：被封禁账号会被拒绝获得圈名归属（审核通过返回 409 `OWNER_BANNED`），
  管理员手动转移归属同样拒绝封禁账号，避免"封禁后仍可通过审核/转移持有圈名"。
- **前端 UI 体系（shadcn/ui + 液态玻璃）**：
  - **液态玻璃 `liquid`**：`backdrop-filter: blur(26px) saturate(180%) brightness(1.08)` + 双层渐变背景 + 多层内阴影，
    配合 `liquid-sheen`（顶部高光带）与 `liquid-flow`（悬停流光扫过）营造玻璃质感
  - **模糊半径用 CSS 变量驱动**（`--liquid-blur` / `--glass-blur`）：移动端自动降为 14px/12px 节省 GPU。
    早期用媒体查询直接覆盖 `.liquid`，因 Tailwind v4 规则提升导致被基础样式覆盖而失效，改用变量后解决
  - **点击动画**：按钮按下 `scale(0.968)` + 从落点扩散的涟漪光晕（直接操作 DOM，无额外重渲染）
  - **过渡动画**：`cubic-bezier(0.22,1,0.36,1)` 缓动；悬停上浮 1px、卡片浮起、Tab 内容淡入上滑、
    Dialog 缩放+上浮进出场、路由切换淡出淡入、`Reveal` 组件基于 IntersectionObserver 的滚入渐显
  - **无障碍**：全面支持 `prefers-reduced-motion`，关闭动画偏好时自动禁用所有过渡
- **应用层加密协议 v2（RSA-3072 + AES-256-GCM）**：
  浏览器拉取服务端公钥（带 `kid` 指纹与 `v:2`）→ 每次请求生成随机 32 字节 AES 密钥与 12 字节 IV →
  AES-256-GCM 加密请求体（AAD 绑定 `qm:v2|METHOD|PATH`）→ RSA-OAEP(SHA-256) 封装 AES 密钥 →
  整体以 `{"enc":{v,kid,key,iv,data,tag}}` 传输。服务端校验协议版本、`kid`、IV/Tag 长度、RSA 密钥长度，
  并校验明文内的 `ts`（5 分钟有效期）、一次性 `nonce`（防原样重放）与 `path`/`method`（防跨接口重放）。
  `/auth/*`、`/me/*`、`/admin/*` 等敏感写接口自动加密，抓包只能看到密文；
  生产环境对登录、注册、改密、换绑手机等接口**强制加密**，明文请求返回 400 `ENCRYPTION_REQUIRED`。
  密钥首次启动自动生成 RSA-3072；检测到旧密钥不足 3072 位、或设置 `CRYPTO_ROTATE_KEYS=1` 时，
  启动会自动删除旧 PEM 并生成新密钥，旧 `kid` 立即失效（前端收到 `DECRYPT_FAILED` 后自动刷新公钥缓存）。
- **密码存储**（重要设计说明）：需求中的「SHA-256 哈希存储」若**单独使用是安全倒退**——
  SHA-256 太快、无盐值，GPU 每秒可算数十亿次，且可被彩虹表直接命中。
  本实现采用业界标准：客户端 `SHA-256(password)` → 服务端 `HMAC-SHA256(pepper)` 收敛 →
  **bcrypt(cost=12) 加盐存储**。既避免明文过网，又抵抗离线爆破与彩虹表；
  同一密码在不同用户处哈希不同。数据库泄露也无法反推原始密码。
- **上传图片防篡改**：每张图片落盘后计算 **SHA-256** 并随记录保存。
  审核通过前自动重算校验，若文件被替换/损坏则**阻断审核**（409 `INTEGRITY_FAILED`）并记录审计日志。
  同时用于去重与溯源，校验时做路径穿越防护。
- **防中间人（MITM）**：
  - HSTS（`max-age=31536000; preload`）防 SSL 剥离，可用 `ENABLE_HSTS=1` 开启
  - COOP / CORP / COEP 三件套，隔离跨源资源
  - `mitmGuard`：校验 `Sec-Fetch-Site`，阻断跨站发起的敏感写请求
  - `FORCE_HTTPS=1` 时敏感操作强制要求 HTTPS，拒绝明文降级
- **前端视觉与性能取舍**：重构时优先"清爽"，主动砍掉了会拖累低端设备的装饰层。
  - 移除卡片 `liquid-flow` 内嵌流动光带（hover 伪元素动画是主要卡顿源）
  - 玻璃参数从 blur 26px / saturate 180% 收敛到 18px / 140%，降低 GPU 合成压力
  - 背景由「3 个 130px 模糊光斑 + 网格 mask」改为单个径向渐变，不使用 `filter: blur()`
  - 移除 `body` 的三层径向渐变，背景统一由 `Aurora` 组件负责
  - 指针跟随监听增加 rAF 合并与坐标去重，避免每帧强制重排
  - 滚动渐入统一使用 `Reveal`（IntersectionObserver，只触发一次）
- **毛玻璃**：`glass` / `glass-soft` / `glass-strong` 三个 Tailwind v4 `@utility`，
  配合 `backdrop-filter: blur() saturate()`、渐变描边与 `inset` 高光。

---

## ✦ 生产部署

```bash
# 1) 同步代码（务必排除运行数据，避免覆盖线上用户数据）
rsync -az --exclude node_modules --exclude data --exclude uploads --exclude .env \
  ./server/ user@host:/opt/quanming/server/
rsync -az --delete ./web/dist/ user@host:/opt/quanming/web/dist/

# 2) 安装生产依赖（如服务器访问 npm 源不稳定，可在本地打包 node_modules 传输）
ssh user@host 'cd /opt/quanming/server && npm ci --omit=dev'

# 3) 安装并启动 systemd 服务
sudo cp scripts/quanming.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now quanming
```

> 首次部署或需要作废旧密钥时：删除 `server/data/keys/rsa_private.pem`、`rsa_public.pem`
> 后重启（或临时设置 `CRYPTO_ROTATE_KEYS=1`）。启动日志出现
> `[crypto] 已生成新的 RSA-3072 密钥对` 即表示旧密钥已作废。
> 可通过 `GET /api/crypto/pubkey` 查看新的 `kid` 与 `bits`（应为 3072）。
> **不要删除** `server/data/keys/pepper.key`，否则历史密码哈希将无法校验。

Nginx 反代示例（注意转发真实 IP，风控依赖 `X-Forwarded-For`）：

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  client_max_body_size 10m;
}
```

> **同时必须在 `server/.env` 中设置**（否则风控会把所有访客当成同一个反代 IP）：
> ```ini
> TRUST_PROXY=1
> TRUST_PROXY_HOPS=1
> TRUSTED_PROXIES=127.0.0.1/32
> ```

> 备份只需备份 `server/data/quanming.db`（连同 `-wal`/`-shm`，建议停服或用 SQLite 在线备份）
> 与 `server/uploads/`。数据库与密钥文件权限应为 `600`，目录为 `700`。

---

## ✦ 安全审计与渗透测试

最近一次完整审计（2026-11）覆盖认证、越权、注入、上传、CSRF、加密协议、信息泄露与防爆破，
共 **84 项检查全部通过**（本地生产模式 62 项 + 线上 22 项，含加密链路与只读探测）：

| 类别 | 验证结果 |
| --- | --- |
| 加密协议 | v2 信封、RSA-3072、AAD 绑定、`kid` 轮换、`ts` 过期、`nonce` 重放均按预期拒绝 |
| 认证与越权 | 未认证接口 401；普通用户与审核员访问后台接口均 403；批量操作无绕过 |
| 注入 | 搜索/联想/登录标识符 SQL 注入均无效（全部参数化）；原型污染载荷被清洗 |
| XSS | 昵称、简介 HTML 被清洗；圈名脚本标签直接 400 |
| 上传 | 伪装脚本 415、双扩展名 415、路径穿越文件名被重命名、超 8MB 413 |
| CSRF | 跨站 Origin、`Origin: null`、`Sec-Fetch-Site: cross-site` 均 403 |
| 信息泄露 | `/.env`、`/.git/config`、`/package.json`、数据库路径、上传目录穿越均 404 |
| 防爆破 | 连续失败触发 `LOGIN_LOCKED`；注册失败累计临时/永久封禁 |
| 依赖 | `npm audit` 0 漏洞；`multer` 已升级至 2.5.0，`nodemailer` 10.3.1 |

> 说明：`/api/auth/email-check` 会返回邮箱是否已注册，属于注册流程的必要提示（低风险信息暴露）；
> `/uploads` 为公开资源，已通过服务端重命名、哈希校验与 CSP `sandbox` 降低风险。

### 深度渗透测试（第二轮，2026-11-03）

在首轮 84 项基础上，针对业务逻辑、竞态、上传解析、写放大 DoS、审计链与提权路径做定向攻击。
本地以生产模式（`NODE_ENV=production`）搭建靶场，最终 19 项回归 + 30 余项定向攻击全部通过：

| 攻击面 | 测试内容 | 结果 |
| --- | --- | --- |
| 权限提升 | 普通用户/审核员访问用户管理、批量改角色、系统与邮件配置 | 均 403，无 mass assignment |
| 越权/IDOR | 普通用户读取后台申请详情、跨账号撤回申请与通知读取 | 403 / 404 / 严格按 `userId` 隔离 |
| 竞态 | 同一申请 12 路并发审核、重复提交、审批与撤回交错 | 仅 1 次成功，圈名唯一索引兜底 |
| 上传解析 | SVG 伪装 PNG、MIME/扩展名错配、PNG+PHP 多语言、路径穿越 | 415 / 404；静态响应带 `nosniff` + CSP `sandbox` |
| 磁盘耗尽 | 业务校验失败是否遗留文件、重复上传配额 | 失败即删除；新增 200MB/小时/用户配额 |
| 写放大 DoS | 浏览量、搜索热词高频写入；通知 ids 超大数组 | 改为 3 秒合并落库；`markRead` 改 Set 并限 1000 条 |
| 业务逻辑 | 封禁用户申请审核、管理员转移归属 | 均 409，封禁后不再获得圈名 |
| 审计链 | 重启后校验、直接改库篡改 `detail` | 定位到被篡改日志（`ok:false`） |
| 加密链路 | 加密登录、密文重放、AAD 路径错配 | 200 / 400 / 400，`nonce` 与 AAD 绑定有效 |
| 注入/信息泄露 | 深层 JSON、畸形 JSON、分页越界、敏感文件 | 无 5xx、无堆栈、参数夹紧、全部 404 |

**残留风险（需部署层配合，非应用代码缺陷）**：
1. 反向代理必须配置 `TRUST_PROXY=1`、`TRUST_PROXY_HOPS=1`、`TRUSTED_PROXIES=127.0.0.1/32`，
   Nginx 使用 `$proxy_add_x_forwarded_for` 追加真实 IP；否则 XFF 轮换可绕过 IP 限流与注册/登录风控。
2. Node 默认监听 `0.0.0.0:3000`，应通过防火墙仅允许本机/内网访问，避免绕过 Nginx 直连；
   Nginx 侧建议启用 Host 白名单、`server_tokens off` 与上传目录独立安全头。
3. 浏览量、搜索热词属于公开可写计数，仍可被刷量（仅影响展示排序，不涉及权限与资金）。
4. 历史上传文件无自动回收，长期运行建议按季度清理未被申请/申诉引用的孤儿文件。


---

© 小天才圈名平台 · Designed & Built by 疏影阑珊
