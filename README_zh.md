# ⭐️ Link Map (v2.0 Rebuild)

语言： [English](https://github.com/TenTh0usand/link-map-Rebuild/blob/release/README.md) | [中文](https://github.com/TenTh0usand/link-map-Rebuild/blob/release/README_zh.md) | [架构设计 & 改动记录](https://github.com/TenTh0usand/link-map-Rebuild/blob/release/docs/ARCHITECTURE_AND_CHANGES.md)

> 面向 Chrome 与 Edge 的 **纯本地优先（Local-First）** 树形标签页、原生标签页组（Tab Groups）与个人知识导航工作区。

---

## 💡 这是什么项目？

本项目是基于开源项目 [`GarinZ/link-map`](https://github.com/GarinZ/link-map)（AGPL-3.0）进行的 **v2.0 原地现代重构与深度二次开发**。

我们彻底移除了原有的 Webpack 5 / jQuery / Fancytree / Firebase 技术栈，升级为 **WXT + Vite 7 + React 18 + Ant Design 5 + Zustand + Dexie (IndexedDB)** 现代架构，并在严格守护「**默认零联网隐私**」的前提下，补齐了原生侧边栏 / 独立小窗双形态、Chrome 原生标签组融合、个人导航页、零服务器二维码分享、国内常用云盘 / R2 加密同步与低成本 AI 工作流整理能力。

---

## ✨ 核心功能

### 1. 纯本地优先 & 简易离线模式（默认开启）
- **绝对不联网保障**：默认启用「简易离线模式」，Manifest **无任何默认网站读取/跨域权限**，底层 `guardedFetch` 硬拦截一切网络请求，零统计、零后台上传，全部数据保留在本地 IndexedDB。
- **自动滚动快照 & 无损迁移**：自动保留最近 10 份本地滚动快照；首次打开自动从 v1 `TabMasterDB` 迁移数据；支持完整 JSON 备份恢复及 **Tabs Outliner (`.tree` / `.json`)** 拖拽/批量迁移。

### 2. 原生 Side Panel + 独立窗口 & 高性能树形视图
- **双形态无缝切换**：既可常驻 Chrome / Edge 原生侧边栏（Side Panel），也可弹出为记住位置尺寸的独立小窗口；在 **设置** 与主工具栏 `⋮` 均可一键设定「点击扩展图标默认行为」。
- **虚拟滚动树 & 标签页组融合**：`@tanstack/react-virtual` 驱动顺滑列表；支持三区位 + 跨窗口 HTML5 拖拽、多选批量操作、**Chrome 原生 Tab Groups 双向同步** 与跨窗口持久化的 **自定义标签组 (Collections)**。
- **一键对接笔记软件**：任意节点、子树或多选条目一键复制为 **缩进纯文本 (.txt)** 或 **嵌套 Markdown 列表**，直接贴入 Obsidian / Notion / Logseq。

### 3. 个人导航页 & 零服务器美观分享
- **全屏导航页 (`dashboard.html`)**：按「工作区 / 稍后阅读 / 开源项目 / 影音娱乐 / 常用好物」自动归类，支持显示/隐藏 **网址一句话导读**（支持手动编辑与 AI 批量生成）。
- **单网址精美二维码卡片**：本地 Canvas 2D 高清绘制，提供 `Dark / Light / Aurora / Minimal` 四种主题，支持直接复制卡片图片或下载 PNG。
- **整组网页零服务器分享**：基于 `fflate` 压缩生成免后端 `#lm1=...` 分享链接与二维码；链接过多时支持导出 **100% 离线单文件 HTML**（内置搜索与 Markdown 复制）；还可托管轻量静态页 [share-web/index.html](share-web/index.html) 供手机直接扫码查看。

### 4. 可选个人云加密同步（BYOS，中国区体验优化）
关闭离线模式后按需为对应端点申请单域名权限，支持 **增量三片分块同步 + 客户端 AES-256-GCM 端到端加密**：
- **WebDAV**：内置 **坚果云**（防限流退避与专用密码引导）、**123云盘**、**OpenList / AList**（`/dav/` 规范化与 302 代理诊断）预设。
- **S3 & Cloudflare R2 直连**：自研轻量 Web Crypto AWS SigV4 签名，填入 R2 Account ID 自动推导端点，提供一键复制 CORS 策略。
- **Cloudflare R2 + 自建 Worker 加速（推荐中国区）**：使用仓库附带的开源模板 [workers/r2-sync-worker/](workers/r2-sync-worker/README.md) 部署并绑定自定义域名，解决直连丢包与 CORS 问题，同时自动解锁 **大组加速短链 + 二维码分享**。
- **Google Drive**：已预留 `appDataFolder` 适配器占位，后续版本开放。

### 5. 可选低成本 AI 助手（BYOK）
原生支持 **DeepSeek V3 (`deepseek-chat`)**、硅基流动、智谱 `glm-4-flash`、OpenAI 与本地 **Ollama**，发送前本地剥离 `?参数` 与凭证并过滤隐私域名黑名单：
- **工作进度恢复（总结做到哪了）**：提炼断点进度与下一步操作建议，一键按任务流重开标签并保存历史恢复档案。
- **工作区智能整理**：给出分类标签组方案与重复标签清理建议，预览勾选后生效。
- **Readlist 好物策展**：归档文章、新闻、GitHub 仓库与影音好物并标注重磅优先级。
- **批量一句话导读**：仅补全尚无说明的链接（跳过已有缓存与手动备注），同步展示于导航页卡片。

---

## 🚀 本地开发与打包构建

> 环境要求：Node.js >= 18.18（推荐 22+）、pnpm 10+

```bash
# 1. 安装依赖
pnpm install

# 2. 生成 WXT 类型声明
pnpm prepare:wxt

# 3. 类型检查 & 全量单元测试（45 个测试）
pnpm typecheck
pnpm test

# 4. 构建生产扩展包（产物位于 .output/chrome-mv3 与 .output/edge-mv3）
pnpm build
pnpm build:edge

# 5. 可选：打包发布 zip
pnpm zip
pnpm zip:edge
```

在 Chrome / Edge 中打开 `chrome://extensions/`（或 `edge://extensions/`）→ 开启 **开发者模式** → **加载已解压的扩展程序** → 选择 `.output/chrome-mv3` 或 `.output/edge-mv3` 即可使用。

如需了解项目完整技术决策（含 Rust/WASM 评估）与逐阶段重构清单，请阅读 [ARCHITECTURE_AND_CHANGES.md](docs/ARCHITECTURE_AND_CHANGES.md)。

---

## 🔒 权限声明（最小权限原则）

- `tabs` / `tabGroups` / `windows`：读取与管理标签页、浏览器原生标签组及多窗口树状结构。
- `sidePanel` / `system.display`：支持 Chrome/Edge 原生侧边栏，以及记住独立弹出窗口的屏幕尺寸与位置。
- `storage`：保存扩展打开模式等基础状态（主体工作区、快照、同步/AI 设置均存在本地 IndexedDB）。
- `downloads`：用于导出全树 JSON 备份、PNG 二维码卡片与离线单文件 HTML。
- `favicon`：通过浏览器同源 `/_favicon/` 安全显示网页图标。
- `optional_host_permissions` (`https://*/*`, `http://*/*`)：**默认不授予**，仅在你关闭离线模式并配置自己的云盘或 AI 接口域名时按需动态弹窗授权。

---

## 📜 开源协议与致谢

- 协议：**AGPL-3.0**（详情见 [LICENSE](LICENSE)）
- 致谢原项目 [`GarinZ/link-map`](https://github.com/GarinZ/link-map) 奠定的树形标签管理理念与交互基础。
