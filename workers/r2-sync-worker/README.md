# Link Map R2 Sync & Short-Link Worker

部署一个属于你自己的 **Cloudflare R2 私有加速代理 + 大组分享短链服务**，零服务器运维、全球边缘节点（绑定自定义域名后中国大陆访问稳定且无需手动配置 R2 CORS）。

## 快速部署（3 分钟）

1. 安装依赖（无需在此目录额外 `npm install`）：
   ```bash
   cd workers/r2-sync-worker
   npx wrangler login
   ```

2. 创建 R2 存储桶：
   ```bash
   npx wrangler r2 bucket create link-map-sync
   ```

3. 设置私有访问密钥（用于扩展鉴权）：
   ```bash
   npx wrangler secret put AUTH_TOKEN
   ```

4. 部署 Worker：
   ```bash
   npx wrangler deploy
   ```

5. **强烈建议（中国区体验关键一步）**：
   在 Cloudflare Dashboard → **Workers & Pages** → `link-map-r2-sync` → **Settings → Domains & Routes** 中绑定你自己的自定义域名（`workers.dev` 在部分网络环境下不稳定）。

## 在 Link Map 扩展中使用

1. 打开 Link Map **设置 → 通用与隐私**，关闭 **简易离线模式（绝对不联网）**（如需 100% 零拷贝隐私可继续保持加密）。
2. 进入 **设置 → 云同步**，选择 **Cloudflare R2 + Worker 加速（推荐中国区）**。
3. 填入自定义域名与 `AUTH_TOKEN`，建议开启 **AES-256-GCM 端到端加密**（Worker 与 R2 均无法看到明文数据）。
4. 在「分享网页组 / 标签组」弹窗中还会自动解锁 **生成 R2 加速短链 + 二维码**，即使一次分享上百个标签也能轻松手机扫码打开！

## API 概览

- `GET /api/health`（需 Bearer Token）：健康检查
- `GET / PUT / DELETE /api/sync/<key>`（需 Bearer Token）：代理读写 R2 同步清单与增量分片
- `POST /api/share`（需 Bearer Token）：生成短链 ID（支持自定义过期时间 `ttlSeconds`）
- `GET /s/<id>`（公开只读页面）：展示与 `share-web/index.html` 一致的离线风响应式网页预览，支持关键词搜索与一键复制 Markdown
