# Link Map Rebuild (v2.0) — 架构设计、思路说明与完整改动记录

> 本文档系统梳理从原版 `GarinZ/link-map`（Manifest V3 + Webpack 5 + jQuery / Fancytree）原地重构为 **Link Map v2.0** 的技术选型、架构思路、隐私安全设计与分阶段改动清单。

---

## 1. 背景与产品定位

原版 **Link Map** 基于 jQuery + `jquery.fancytree` + Webpack 5 实现，主要以独立 Popup 窗口呈现树形标签管理。在持续二开与现代化需求下，本项目确立了全新的 **v2.0 定位**：

- **核心定位**：面向重度信息消费者、开发者与知识工作者的 **纯本地优先（Local-First）树形标签页与标签页组个人工作区**。
- **核心原则**：
  1. **零联网同样完整可用**：「简易离线模式」作为第一原则默认开启，所有基础功能、导航页、二维码分享与迁移均可在彻底断网环境下运行。
  2. **兼容浏览器原生工作流**：同时支持 **Chrome/Edge 原生 Side Panel** 与 **独立弹出小窗口**，并实现与 Chrome 原生 Tab Groups 的双向同步。
  3. **数据主权完全归用户**：本地 IndexedDB 持久化 + 滚动快照 + 通用 JSON / TXT / Markdown 随时导出；云同步与 AI 均由用户自带后端（BYOS / BYOK），不经过任何第三方中转服务器。

---

## 2. 技术选型与 Rust / WASM 可行性分析

### 2.1 技术栈升级

| 维度 | v1 原版方案 | v2.0 重构方案 |
| --- | --- | --- |
| 构建链 | Webpack 5 + Babel + Less/Sass 自定义脚本 | **WXT (`0.21.5`) + Vite 7** + `@wxt-dev/module-react`（含 Windows CLI 防挂起封装 `scripts/wxt-cli.mjs`） |
| UI 框架 | jQuery + `jquery.fancytree` | **React `18.3.1` + Ant Design `5.29.3`** + `@tanstack/react-virtual` 虚拟滚动 |
| 状态管理 | 全局可变 tree store | **Zustand** 不可变状态 + Cross-View `BroadcastChannel` 实时协同 |
| 本地持久化 | 原始 IDB 封装 (`TabMasterDB`) | **Dexie v4 (`LinkMapV2DB`)** 结构化表 + 单调版本升级 (`v1 -> v4`) |
| 分享编码/图形 | 无 | **Canvas 2D (2x DPR)** + `qrcode` + `fflate` Raw Deflate |
| 加密与签名 | 无 | 浏览器原生 **Web Crypto API**（AES-256-GCM / PBKDF2-SHA256 / HMAC-SHA256 SigV4） |
| 自动化测试 | Jest（早期占位测试） | **Vitest** 单元测试（纯内核、加解密、增量同步、SigV4、WebDAV、AI 隐私脱敏全覆盖） |

### 2.2 为什么现阶段采用纯 TypeScript + 内核接口预留，而非直接引入 Rust / WASM？

我们在设计初期重点评估了用 **Rust 编写核心树引擎并编译为 WASM** 的方案，结论如下：

1. **性能瓶颈判断**：典型浏览器的树节点数量在数百到数千级。制约交互流畅度的是 **DOM 节点数量与长列表重排**，而非纯 JS 内存遍历。通过 `@tanstack/react-virtual` 虚拟列表，3,000+ 节点在纯 TS 下依然毫秒级响应；相反，若频繁在 JS/React 与 WASM 线性内存之间序列化/反序列化整棵树（如每次拖拽/快捷键焦点移动），跨边界拷贝成本反而会抵消 Rust 计算优势。
2. **包体积、MV3 CSP 与构建复杂度**：MV3 扩展在 Strict CSP 与 Service Worker 启动延迟上对 `.wasm` 初始化更敏感，同时双语言工具链（`wasm-pack` + TS 胶水代码）会显著提高个人二次开发与调试门槛。
3. **可扩展预留（面向未来平滑切换）**：项目中专门抽出纯无副作用内核接口 [`kernel-interface.ts`](../src/core/kernel-interface.ts)（`ITreeKernel`），UI 与服务层严格通过纯函数契约与树引擎交互。未来一旦出现超大规模（如 5 万+ 历史节点全文索引、BM25 本地检索或图谱布局），可直接将 [`tree-engine.ts`](../src/core/tree-engine.ts) 的实现替换为 `rust-wasm` 而无需改动 React 组件与 Chrome API 桥接层。

---

## 3. 代码分层与目录结构

```text
link-map-Rebuild/
├── public/                         # 扩展静态图标与中英双语 i18n (_locales/en, _locales/zh_CN)
├── scripts/wxt-cli.mjs             # Programmatic WXT 构建入口，解决 Windows + Node 24 子进程挂起
├── share-web/index.html            # 零依赖静态分享查看页（可托管于 GitHub/Cloudflare Pages）
├── workers/r2-sync-worker/         # 开源可一键部署 Cloudflare R2 代理 + 短链分享 Worker 模板
├── docs/ARCHITECTURE_AND_CHANGES.md
└── src/
    ├── core/                       # 【纯逻辑内核层：零 DOM / 零 Chrome API 依赖，可在 Node Vitest 直接单测】
    │   ├── types.ts                # 树节点模型 (window / tabGroup / tab / note / collection) 与设置类型
    │   ├── kernel-interface.ts     # ITreeKernel 抽象边界，预留未来 Rust/WASM 替换能力
    │   ├── tree-engine.ts          # 不可变树操作、opener 层级插入、原生 Tab Groups 双向对齐、防环拖拽
    │   ├── search.ts               # 子串 + 模糊过滤与祖先保留、高亮区间计算
    │   ├── exporter.ts             # 缩进 TXT、嵌套 Markdown 与 v2 JSON 导出
    │   ├── categorizer.ts          # URL 规范化与启发式分类 (workspace / readlist / repo / media / general)
    │   ├── share-codec.ts          # fflate Deflate + Base64URL #lm1= 编解码与防 XSS 离线单文件 HTML 生成
    │   ├── sync-crypto.ts          # Web Crypto PBKDF2-SHA256 + AES-256-GCM 加解密与 Gzip 分块封装
    │   ├── sync-engine.ts          # 剥离跨设备瞬时 ID 的增量三片同步引擎与无损并集冲突合并
    │   ├── ai-prompts.ts           # 域名黑名单、参数脱敏、DeepSeek <think> 提取与防幻觉校验
    │   └── parsers/                # Link Map v1/v2 JSON & Tabs Outliner (.tree/.json) 解析器
    ├── services/                   # 【副作用与基础设施层】
    │   ├── db.ts                   # Dexie v1~v4 单调演进表结构、10 份滚动快照与旧版 TabMasterDB 迁移
    │   ├── network-guard.ts        # guardedFetch 全局网络闸门与 optional_host_permissions 动态申请
    │   ├── browser-bridge.ts       # Chrome Tabs / TabGroups / Windows API 封装与同源 /_favicon/
    │   ├── sync-channel.ts         # BroadcastChannel 多视图实时状态同步与 IMPORT_NODES_REQUEST 握手
    │   ├── share-card-renderer.ts  # 2x 高清本地 Canvas 二维码卡片绘制器 (4 套视觉主题)
    │   ├── i18n.ts                 # 国际化辅助读取
    │   ├── sync/                   # 云同步后端 (WebDAV / S3 / R2 / R2-Worker / Google Drive 占位)
    │   └── ai/                     # OpenAI 兼容客户端 (DeepSeek / 硅基流动 / 智谱 / OpenAI / Ollama)
    ├── store/workspace-store.ts    # Zustand 工作区总控台（400ms 防抖落盘、自动快照、增量同步调度、AI 流程）
    ├── hooks/useShortcuts.ts       # 键盘快捷键体系
    ├── components/                 # React 18 + AntD 5 UI 组件（树视图、标签组、导航页、分享、云同步、AI 面板）
    └── entrypoints/                # WXT 多入口 (background / sidepanel / window / dashboard / import / share)
```

---

## 4. 核心设计思路详解

### 4.1 「简易离线模式」零联网隐私硬保障

1. **Manifest 最小权限原则**：[`wxt.config.ts`](../wxt.config.ts) 中**不声明任何默认 `host_permissions` 或 `<all_urls>`**，仅注册 `optional_host_permissions: ['https://*/*', 'http://*/*']`。
2. **默认全本地运行**：`AppSettings.offlineOnlyMode` 默认值为 `true`。在此模式下，界面自动隐藏云同步与 AI 入口，且所有外发网络调用均强制经过 [`network-guard.ts`](../src/services/network-guard.ts) 的 `guardedFetch`，一旦离线开关开启立即抛出 `NetworkBlockedError`。
3. **动态按需授权**：仅当用户主动关闭简易离线模式并保存个人云存储或 AI 接口时，才会针对具体端点 Origin 动态调用 `chrome.permissions.request()` 申请单域名权限。

### 4.2 原生 Side Panel + 独立小窗口双形态 & 原生标签组融合

- **双形态无缝切换**：支持在 Chrome/Edge 侧边栏（Side Panel）内作为常驻垂直标签栏使用，也可一键弹出为记住窗口尺寸与屏幕位置的独立小窗口（`window.html`）。[`SettingsModal.tsx`](../src/components/SettingsModal.tsx) 与 [`OperationBar.tsx`](../src/components/OperationBar.tsx) 均可直接设定「点击扩展图标默认行为」。
- **Windows 任务栏图标与冷启动修补**：独立窗口入口统一改用多分辨率 PNG + `favicon.ico` 替代纯 SVG，避免 Windows Chromium 将扩展弹窗渲染为空白文件图标；在 [`background.ts`](../src/entrypoints/background.ts) 中引入 `ensureStateLoaded()` Promise 锁，杜绝 Service Worker 休眠唤醒后读取 `openMode` 的竞态问题。
- **双轨标签组织**：
  1. **Chrome 原生 Tab Groups 双向同步**：打开网页、拖拽归组或修改分组标题/颜色时双向同步。
  2. **持久标签页组 (Collections)**：独立于窗口生命周期存在，支持按 `工作区 / 稍后阅读 / 开源项目 / 影音娱乐 / 常用好物` 分类整理并一键「以标签组打开全部」。

### 4.3 本地数据持久化与迁移互操作

- **Dexie 单调架构演进**：[`db.ts`](../src/services/db.ts) 通过 `version(1) -> version(4)` 依次新增 `siteMeta`、`syncStore`、`aiDigests` 表，确保老版本升级零数据丢失；首次启动若无 v2 快照则自动只读读取旧版 `TabMasterDB` 迁入。
- **三重防丢机制**：会话首次变更自动快照、导入前与云拉取前强制生成 `pre-import` 本地回滚快照（滚动保留最近 10 份）、全树 JSON 导入导出。
- **Tabs Outliner 迁移与双通道导入**：支持拖拽或选择 `.tree` / `.json` 文件进入 [`ImportApp.tsx`](../src/components/ImportApp.tsx)，通过 `BroadcastChannel` 的 `IMPORT_NODES_REQUEST / ACK` 握手协议防重复写入——侧边栏开启时实时注入内存与树结构，关闭时直接写入 IndexedDB。
- **笔记软件对接**：任意节点、子树或批量选区均可一键复制为 **缩进纯文本 (.txt)** 或 **嵌套 Markdown 列表**，直接粘贴至 Obsidian / Notion / Logseq。

### 4.4 零服务器分享与美观二维码卡片

- **单网址高清二维码卡片**：Canvas 2D（2x DPR）本地渲染，内置 `Dark / Light / Aurora / Minimal` 四种主题，使用同源 `/_favicon/` 避免画布跨域污染（tainted canvas），可一键复制 PNG 剪贴板或下载。
- **标签组与多网址压缩分享**：使用 `fflate` Raw Deflate（最高压缩等级 9）+ Base64URL 编码为 `#lm1=...` Hash 链接。不经过任何服务器，支持配合完全静态的 [`share-web/index.html`](../share-web/index.html) 扫码查看。
- **超大规模离线独立 HTML**：超过二维码承载上限（50+ 链接）时可一键导出 100% 离线单文件 `.html`（零外链依赖、内置搜索与 Markdown 复制，所有动态文本严格 HTML / JS 上下文转义防 XSS）。
- **可选 R2 Worker 短链增强**：当配置 `Cloudflare R2 + Worker` 时，分享弹窗解锁生成短链 + 二维码，解决大组链接码点过密难扫描的问题。

### 4.5 多后端云同步与中国区 Cloudflare R2 优化

- **增量三片模型**：同步引擎将状态拆分为 `tree`、`collections`、`siteMeta` 三块，各自计算 SHA-256 哈希并与 `manifest.json` 对比，仅传输发生变动的分片；加密凭证（WebDAV 密码 / S3 Secret / E2EE 口令）绝不混入普通 JSON 导出备份。
- **WebDAV 深度适配**：
  - **坚果云**：应用专用密码提醒、HTTP `429/503` 自动退避重试（识别 `Retry-After`）与 `>=60s` 最小自动同步间隔保护；
  - **123云盘**：标准 `MKCOL / PROPFIND / PUT / GET / DELETE` 递归建目录适配；
  - **OpenList / AList**：自动补全 `/dav` 挂载路径、检测 `302` 跳转并给出开启 WebDAV Proxy 代理与 CORS 诊断建议。
- **S3 与 Cloudflare R2 双模式**：
  1. **直连 S3 API 模式**：自研轻量 Web Crypto SigV4 签名（不引入体积庞大的 `@aws-sdk/client-s3`），填入 R2 Account ID 自动拼接端点，仅签名请求 `GET manifest.json` 测试连通性（免除受限 Token 的 `ListBucket` 权限要求），提供一键复制 R2 CORS JSON。
  2. **R2 + 自建 Cloudflare Worker 代理模式（推荐中国区）**：仓库附带开源 [`workers/r2-sync-worker/`](../workers/r2-sync-worker/README.md)，绑定自定义域名即可规避直连 `*.r2.cloudflarestorage.com` 的丢包与 CORS 问题，同时提供私有 Bearer Token 鉴权与短链托管。

### 4.6 低成本 BYOK AI 工作区助手与隐私隔离

- **成本友好**：原生兼容 **DeepSeek V3 (`deepseek-chat`)**、硅基流动、智谱 `glm-4-flash`、OpenAI 以及全离线 **Ollama 本地模型**。
- **严格隐私预处理**：发送给 AI 前本地剥离查询参数（`?token=...`）与账密 Hash，并强制过滤内部页面及用户可编辑的隐私域名黑名单（如银行、支付、内网 IP、邮箱等）。
- **四大实用场景**：
  1. **进度恢复（「总结做到哪了」）**：重建当前任务流进展与下一步建议，支持一键重开优先标签或按工作流在浏览器分组重开，并在本地保存最多 20 条进度归档。
  2. **工作区智能整理**：对零散标签给出分类方案与重复标签提示，先预览勾选再应用为持久标签组或 Chrome 原生标签组。
  3. **Readlist 好物策展**：梳理新闻、GitHub 仓库、影音和好物清单，标注重磅优先级与阅读理由，一键写入导航页导读。
  4. **一句话网址导读**：在导航页一键批量补全站点说明（分批控制、自动跳过手动备注与已缓存项），配合导航页开关直观展示「每个网址是看什么的」。

---

## 5. 分阶段改动记录（v1 → v2.0）

| 阶段 | 核心交付内容 |
| --- | --- |
| **Phase 1：现代架构重建** | 完成 WXT + Vite 7 + React 18 + AntD 5 + Zustand + Dexie 重写，彻底移除 Webpack / jQuery / Fancytree / Firebase；上线 Side Panel + 独立窗口、虚拟滚动树、3 区位及跨窗口拖拽、多选批量操作、原生 Tab Groups 双向同步、旧版 IDB 迁移、Tabs Outliner 导入与缩进 TXT/Markdown 复制。 |
| **Phase 2：导航页与零服务器分享** | 新增全屏 **导航页 (`dashboard.html`)**、启发式站点分类与「一句话导读」功能开关；构建 **零服务器分享系统**（高清二维码卡片、`fflate` `#lm1=` 压缩链接、离线单文件 HTML 导出、扩展内与独立可部署 `share-web/` 查看器）。 |
| **Phase 3：多云加密同步与 R2 Worker** | 升级 Dexie v3 与网络权限守卫；上线 WebDAV（坚果云 / 123云盘 / OpenList）、纯浏览器 SigV4 S3/R2、PBKDF2 + AES-256-GCM 端到端加密、三片增量同步与双端无损并集冲突合并；新增独立可部署 `workers/r2-sync-worker/` 模板并解锁 R2 短链二维码分享。 |
| **Phase 4 & 体验打磨** | 升级 Dexie v4 与 `aiDigests` 表；上线 BYOK 低成本 AI（进度恢复、智能整理预览、Readlist 策展、批量一句话导读）及导航页 `AI` 角标联动；修复 Windows 独立窗口多分辨率 PNG/ICO 任务栏图标、MV3 SW `openMode` 冷启动竞态与默认打开方式快捷切换。 |

---

## 6. 后续规划

- **Google Drive (`appDataFolder`) 同步**：目前已在 [`google-drive-provider.ts`](../src/services/sync/providers/google-drive-provider.ts) 与同步设置面板预留接口，未来版本将在按需触发 Chrome Identity OAuth 时接入隐藏应用目录同步，保持未开启时零多余权限。
