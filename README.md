# Text Hosting 使用说明

## 项目简介

Text Hosting 是一个运行在 Cloudflare Workers 上的轻量级文本托管平台。匿名用户可以立即发布公共文档，持有令牌的用户则可保存私有文档并随时更新。系统内置版本历史、差异对比、原文链接等高级能力，适合粘贴板、配置片段及共享说明等场景。

## 主要功能

- **匿名发布**：无需账号即可创建公共文档，适合一次性分享。
- **令牌登录**：通过随机字符串作为“账号”，生成后保存在浏览器中，可随时更新或清除。
- **私有存储**：携带令牌保存的文档仅令牌拥有者可见，支持删除与更新。
- **版本控制**：每次保存都会产生新版本，可查看历史内容与差异。
- **原始链接**：生成带有版本号或原始访问密钥的链接，便于外部系统引用。
- **响应式界面**：包含折叠侧边栏、状态栏、语法高亮编辑器等现代化体验。

## 使用流程

1. **管理令牌**
   - 点击顶部的 `Add token` 输入已有令牌；
   - 或者使用 `Generate token` 生成新令牌（自动保存在 localStorage）；
   - 如需回到匿名模式，可点击 `Clear token`。

2. **创建文档**
   - 点击 `New` 建立草稿，占位将显示在左侧列表；
   - 输入标题（支持使用 `.md`, `.json`, `.ts` 等后缀来辅助语法识别）；
   - 在编辑器中编写正文内容。

3. **保存与版本管理**
   - 点击 `Save` 保存文档；匿名状态下为公共文档，有令牌时为私有文档；
   - 右侧 `Versions` 面板显示历史记录，可切换查看旧版本并比较差异；
   - 需要删除私有文档时点击 `Delete` 并确认。

4. **分享与访问**
   - 使用 `Open latest` 打开浏览页，支持按版本查看；
   - `View raw` 提供纯文本链接，可用于脚本或嵌入；
   - 私有文档会附带 `rawKey` 参数，可在无需令牌的情况下开放只读访问。

5. **查阅帮助**
   - 顶部令牌按钮旁提供十个“Doc”按钮，涵盖匿名发布、令牌管理、版本控制等指南，点击即可在新标签页查看。

## 开发与部署

### 本地开发

```bash
npm install          # 安装依赖
npm run dev:client   # 启动前端开发服务器（默认 http://localhost:5173）
npm run typecheck    # 运行 TypeScript 类型检查
npm run build        # 构建静态资源到 dist/
```

### Cloudflare Wrangler 部署

1. **准备环境**
   - 安装 Wrangler：`npm install -g wrangler`
   - 登录 Cloudflare：`wrangler login`
   - 在 Cloudflare Dashboard 创建 KV 命名空间，并把 `id` 和 `preview_id` 写入 `wrangler.toml` 的 `[[kv_namespaces]]`。
   - 根据需要调整 `MAX_FILE_SIZE` 及 `SHARE_SECRET`（可在 `[vars]` 中配置）。

2. **本地构建**
   ```bash
   npm run build
   ```

3. **部署**
   ```bash
   wrangler deploy
   ```
   Wrangler 会将 Worker 代码（`src/worker.ts`）与 `dist/` 静态资源一并上传，同时绑定 `TEXT_KV` 命名空间。

4. **验证与调试**
   - 访问 Wrangler 输出的 `https://<your-worker>.<subdomain>.workers.dev`。
   - `wrangler tail` 查看实时日志。
   - `wrangler kv:key put/get --namespace-id <id>` 管理 KV 数据。

### 通过 GitHub Actions 部署到 Cloudflare

可使用官方 `cloudflare/wrangler-action` 将仓库推送自动部署到 Workers。

1. **仓库配置**
   - 为项目创建 GitHub 仓库，将代码推送上去。
   - 在 Cloudflare Dashboard 获取 API Token（需要 Workers KV 读写与 Workers 编辑权限）。
   - 在 GitHub 仓库的 *Settings → Secrets and variables → Actions* 中设置：
     - `CLOUDFLARE_API_TOKEN`：上述 API Token。
     - `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账户 ID。

2. **添加工作流**（`.github/workflows/deploy.yml`）：
   ```yaml
   name: Deploy Worker
   on:
     push:
       branches: [ main ]

   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with:
             node-version: 20
         - run: npm install
         - run: npm run build
         - uses: cloudflare/wrangler-action@v3
           with:
             apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
             accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
             command: deploy
   ```

3. **推送触发部署**
   - 将以上文件提交并推送到 `main`。
   - GitHub Actions 会自动执行构建与 `wrangler deploy`，完成后可在 Actions 页面查看日志及结果。

> 如需 GitHub Pages 或 Vercel 静态托管，可单独部署 `dist/` 目录，并通过 API 域名指向已部署的 Worker，但需要处理跨域与 API 域名配置。

## 目录结构

```
txt-hosted/
├─ client/                 # 前端源码（React + Vite）
│  ├─ public/docs          # 使用指南 HTML 文档
│  ├─ src/components       # 可复用组件
│  ├─ src/pages            # 页面级组件（Editor / View）
│  └─ src/utils            # 工具函数
├─ src/                    # Cloudflare Worker 服务端逻辑
├─ dist/                   # 构建后的静态资源（执行 build 后生成）
├─ README.md               # 本说明文档
└─ wrangler.toml           # Workers 配置
```

## 常见问题

- **令牌遗失怎么办？** 令牌只保存在本地浏览器与个人备份中，遗失后无法找回原私有文档，请及时备份。
- **能否导出所有版本？** 目前可通过版本原始链接逐个导出，如需批量导出可在 Worker 层新增接口。
- **文档大小限制？** 默认受 KV 限制，具体上限由 `MAX_FILE_SIZE` 决定，可在部署时调整。
- **是否支持 Markdown 渲染？** 编辑器提供语法高亮但不渲染，可自行扩展前端以支持预览。
