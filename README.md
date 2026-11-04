# 小天才圈名平台 · Quanming Registry

> 给每一个圈名，一个清晰的归属。
> 面向创作圈的圈名归属登记、检索、审核与申诉平台，包含三级权限的管理后台。
> 开发者：**疏影阑珊**

---

## 项目简介

平台用于登记和查询创作圈的圈名归属：用户提交圈名与证明材料，审核员完成归属审核；出现归属争议时可发起申诉，由审核员复核后转移归属。系统同时提供通知中心、后台数据概览、用户与权限组管理、访问风控和操作日志。

### 前台功能

| 页面 | 说明 |
| --- | --- |
| 圈名广场 `/` | 搜索与联想补全，展示已完成归属审核的圈名，支持最新/最热/名称排序与分页 |
| 圈名详情 `/names/:id` | 圈名简介、归属者、绑定标识、浏览量，可发起归属申诉并上传材料 |
| 登录 `/login` | 支持 QQ 邮箱、手机号、用户名 + 密码登录，以及 QQ 邮箱验证码登录 |
| 注册 `/register` | 支持 QQ 邮箱与手机号注册，带滑块验证码与注册频率限制 |
| 个人中心 `/me` | 我的圈名、归属申请、申诉进度、社交账号绑定、修改密码 |
| 通知中心 `/notifications` | 个人通知与系统通知，支持筛选、未读和详情查看 |
| 提交归属审核 | 上传最多 6 张图片（单张 8MB），填写圈名与简介 |
| 关于 `/about` | 项目与开发者信息 |

### 后台功能 `/admin`

后台按权限组展示功能，普通用户无法进入。

| 模块 | 管理员 admin | 审核员 assessor |
| --- | :-: | :-: |
| 数据概览 | ✅ | ✅ |
| 归属审核（通过 / 驳回 / 批量） | ✅ | ✅ |
| 归属申诉（通过并转移归属 / 驳回） | ✅ | ✅ |
| 用户与权限组管理 | ✅ | — |
| 圈名管理 | ✅ | — |
| 通知发布 | ✅ | — |
| QQ 邮箱配置 | ✅ | — |
| 访问风控 | ✅ | — |
| 访问日志 | ✅ | ✅ |

### 技术栈

- **后端**：Node.js 22.5+ / Express 4 / SQLite（`node:sqlite`，内置无需编译）/ multer / nodemailer / bcryptjs
- **前端**：React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui（Radix UI）+ lucide-react + sonner

---

## 部署方法

### 环境要求

- Node.js **22.5+**（推荐 22.14.0）
- Linux 或 macOS
- 可写的 `server/data` 与 `server/uploads` 目录
- 生产环境建议使用 Nginx 反向代理

### 1. 安装 Node.js

使用项目自带脚本（清华镜像）：

```bash
./scripts/install-node.sh 22.14.0
```

已有 Node.js 22.5+ 可跳过。

### 2. 安装依赖

```bash
npm run install:all
```

### 3. 配置环境变量

```bash
cp server/.env.example server/.env
```

编辑 `server/.env`，常用配置如下：

```ini
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# 首个管理员账号：全部留空时自动随机生成，并仅在首次启动时打印
ADMIN_EMAIL=
ADMIN_USERNAME=
ADMIN_PASSWORD=
ADMIN_NICKNAME=平台管理员

# QQ 邮箱发信（也可启动后在后台「邮箱配置」中填写）
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USER=你的QQ邮箱@qq.com
SMTP_PASS=你的SMTP授权码

# 部署在 Nginx 等反向代理之后时必须配置，否则风控会把所有访客识别为同一 IP
TRUST_PROXY=1
TRUST_PROXY_HOPS=1
TRUSTED_PROXIES=127.0.0.1/32
```

> QQ 邮箱需先开启 SMTP 服务并生成授权码（不是登录密码）。
> 未配置邮箱时，邮箱注册与验证码登录不可用。

### 4. 构建并启动

```bash
npm run build    # 构建前端到 web/dist
npm start        # 启动服务，默认 http://localhost:3000
```

也可使用便捷脚本：

```bash
./scripts/start.sh          # 自动构建并后台启动
./scripts/dev-server.sh log # 查看日志
./scripts/dev-server.sh stop
```

首次启动且数据库为空时，系统会自动生成管理员账号并打印到控制台，请立即保存。若 `.env` 中已填写 `ADMIN_USERNAME` / `ADMIN_PASSWORD`，则使用指定值。

### 5. 生产部署

```bash
# 同步代码（排除运行数据，避免覆盖线上数据库与上传文件）
rsync -az --exclude node_modules --exclude data --exclude uploads --exclude .env \
  ./server/ user@host:/opt/quanming/server/
rsync -az --delete ./web/dist/ user@host:/opt/quanming/web/dist/

# 安装生产依赖
ssh user@host 'cd /opt/quanming/server && npm ci --omit=dev'

# 安装并启动 systemd 服务
sudo cp scripts/quanming.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now quanming
```

Nginx 反向代理示例：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

如需 HTTPS，在 Nginx 中增加 `listen 443 ssl;` 并配置证书与私钥即可。

### 6. 数据备份

建议定期备份以下内容：

- `server/data/quanming.db`（连同 `-wal`、`-shm` 文件）
- `server/uploads/`

停机复制或使用 SQLite 在线备份均可。数据库与密钥文件权限建议为 `600`，目录为 `700`。

### 7. 开发模式

```bash
npm run dev:server   # 后端 :3000
npm run dev:web      # 前端 :5173（已配置 /api、/uploads 代理）
```
