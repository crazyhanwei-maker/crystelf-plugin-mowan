# 内置 ZCode 运行时——构建与调用说明

> 定版：zai-org/ZCode **v3.14.3**（不追上游；将来升级 = 手动拉新 tag 重新构建）。
> 产物形态：**cjs + node 资产**（esbuild bundle，宿主 Node 直接执行；无 npm install）。
> 硬性要求：**宿主 Node ≥ 22**（上游 esbuild target=node22，运行时模块会预检并给出可区分错误）。

## 1. 产物目录结构

```
<Path.data>/agent-cli-runtime/zcode/       ← 运行时根（Yunzai 数据目录，优先级更高：不换插件即可更新产物）
resources/zcode-runtime/                   ← 仓库内置副本（随 git 分发，clone 即用；已剔除 zcode.cjs.map 调试映射）
                                            解析优先级：数据目录副本存在则用之，否则回退仓库内置副本
  manifest.json                             ← 版本 + sha256 清单（resolveBundledZcodeCommand 消费）
  runtime/
    zcode.cjs                               ← CLI bundle（入口；zcode.cjs.map 调试映射默认不打包）
    provider/zcode-builtin.json             ← 供应商配置基线（-p 必需）
    THIRD-PARTY-NOTICES.md
  tools/
    rg.exe / rg                             ← pinned ripgrep 14.1.1（可选，仅搜索类工具用）
```

三个文件（zcode.cjs / manifest.json / provider/zcode-builtin.json）任一缺失，`resolveBundledZcodeCommand` 返回 `null`，工作台据此引导构建。

## 2. 构建

```bash
# 宿主需 Node ≥ 22 + pnpm（npm i -g pnpm）+ git + 网络（clone 与依赖安装）
node scripts/build-zcode-runtime.mjs                       # 全流程：clone v3.14.3 → pnpm build → 收集 → manifest
node scripts/build-zcode-runtime.mjs --skip-install        # 复用已装好的依赖
node scripts/build-zcode-runtime.mjs --skip-clone --upstream <已有源码目录> --out <目标目录>
node scripts/build-zcode-runtime.mjs --dist <已构建的 dist> --out <目标目录>   # 跳过构建只收集
```

常用参数：`--tag v3.14.3`（默认）、`--skip-rg`（不下载 ripgrep）、`ZCODE_UPSTREAM_URL` 环境变量换镜像。

构建缓存默认在 `<Path.data>/data/agent-cli-runtime/zcode-build/`，可整目录删除。
Windows 与 Linux 各自在目标平台跑一遍（rg 二进制与 manifest.platform 按平台分开）。

### 198 服务器（Linux）注意

- 构建机与目标机同为 Linux x64 即可直接使用产物；rg 用 musl 静态版，无 glibc 版本问题。
- 上游默认构建目标不含交叉产物需求，无需处理 bfs/ugrep（缺失只降级搜索类工具）。

## 3. 运行时如何调用 ZCode（供理解，无需手工操作）

每次任务 `runZcodeTask` 启动一个一次性子进程：

```
node zcode.cjs -p "<prompt>" --mode plan|edit|yolo --output-format stream-json --cwd <工作区>
     [--disallowedTools ...] [--resume <sessionId>]
```

- 续接轮次追加 `--resume <zcodeSessionId>`，并复用父任务的状态目录（否则上游会话库找不到上下文，报 Session not found）；首回合写下的 zcodeTaskId/zcodeSessionId 在续接成功/失败时均不被覆盖。
- 权限映射（headless 下 `--mode build` 的 ask 无应答面会被全拒，故不用 build 字面值）：

| 规格 permissionMode | CLI 参数 | 效果 |
|---|---|---|
| `plan`（默认） | `--mode plan --disallowedTools AskUserQuestion WebSearch Agent Task [WebFetch]` | 只读分析；联网由 allowNetwork 控制 |
| `build` | `--mode edit --disallowedTools AskUserQuestion Bash WebFetch WebSearch` | 可写工作区文件，禁终端/网络 |
| `full`（显式开启） | `--mode yolo --disallowedTools AskUserQuestion` | 完全访问，仅主人 + 二次确认 |

- 三个档统一禁 `AskUserQuestion`：headless 没有 permission client，一调用即报 “No permission client configured”；禁用后 Agent 改用文字向用户提问。

- 沙箱 env（每任务独立目录，成功后自动清理）：`ZCODE_DATA_BASE_DIR` / `ZCODE_STORAGE_DIR` / `ZCODE_SESSION_DB_PATH` / `ZCODE_LOG_DIR` / `HOME` / `USERPROFILE` 全部指向任务目录；`ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` + `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 成对指向产物基线与每任务配置。需要会话续接的任务成功后保留状态目录（keepStateOnSuccess），供 `--resume` 复用。
- 能力配置（控制台可选）：`zcodeInstructions` 写入运行时 `HOME/.zcode/AGENTS.md`（不碰真实用户 HOME）；`zcodeMcpServers` 生成工作区 `.mcp.json`，任务期存在、结束清理，工作区已有 `.mcp.json` 时不覆盖也不删除。
- 并发池：`activeZcodeTasks` 上限由工作台配置 `zcodeMaxConcurrent`（1-3，默认 1）控制，满员新任务抛 `AGENT_ZCODE_TASK_BUSY`。
- API key：不进环境变量、不进日志。每任务生成 `provider_config.json`（写明灵晶 baseApi/apiKey/model），任务成功即删除；失败保留在任务目录供排查。
- 工作区预置空 `.env` 阻断上游 CLI 向上查找（任务成功后删除；工作区已有 `.env` 则不动）。
- 超时/中止：Windows `taskkill /T /F`，Linux 进程组 `SIGKILL`。上游文件写入原子化、SQLite WAL，强杀不留半写文件。

## 4. 隔离测试

```bash
node --experimental-vm-modules scripts/check-zcode-runtime.mjs
```

28 项检查：配置生成（协议映射/错误码/自定义供应商/manual 白名单）、沙箱 env、产物定位、假 CLI 全管道（成功事件序列、plan/build 档参数与 AskUserQuestion 禁用、相对路径解析、turn.failed、非零退出、.env 保护）、能力配置（AGENTS.md 注入、.mcp.json 不覆盖原则、contextWindow 回传）、续接（--resume 注入与父状态目录复用）、并发池（上限 1 拒绝、可配 2 并存、中止、超时强杀）、状态目录清理（orphans/all 两种模式）。不读写真实配置。也可经 `npm run check:zcode` 运行。

### 真实冒烟（需要测试 key 与真实产物）

```bash
# 1. 完成构建；2. 在临时工作区跑一次 plan 任务与一次 build 任务（经 Agent 工作台发起）。
# 验收点：事件流可见、文件真实变更、webConsoleAuditLog 有记录、超时可杀、OpenCode 路径回归正常。
```

## 5. 故障排查

| 现象 | 原因与处理 |
|---|---|
| `Select a model before continuing` | personal 配置 decode 失败被静默降级（schemaVersion/providerModelRules/manual 规则必填字段）——运行时模块已按完整形状生成；若手工改过配置文件，用上游 `decodeProviderConfigFile` 校验 |
| json 模式看不到真实失败原因 | 上游 json 模式不打印 Cause，加 `--verbose` 或改用 stream-json 看事件载荷 |
| `AGENT_ZCODE_RUNTIME_MISSING` | 产物未构建或不完整 → 重跑构建脚本；检查 `manifest.json` 是否存在 |
| `AGENT_ZCODE_NODE_UNSUPPORTED` | 宿主 Node < 22 → 升级 Yunzai 宿主 Node |
| `AGENT_ZCODE_TASK_BUSY` | 并发池已满（上限 `zcodeMaxConcurrent` 1-3，默认 1）→ 等待、调高上限或 `abortZcodeTask` |
| 启动报 rg 相关错误 | 不应发生（rg 缺失只降级搜索）；确认 `tools/rg` 存在或 PATH 有 rg |
| 模型请求 401/404 | 检查灵晶 baseApi/apiKey；anthropic 协议地址由运行时自动补 `/v1`，openai 地址保持原样 |
| 任务失败后 zcode-state/tasks 残留 | 设计如此（保留现场排查）；确认问题后可手动删除 |

## 6. 上游升级流程（将来手动）

1. `node scripts/build-zcode-runtime.mjs --tag v<新版本>`（新 tag 重新 clone 构建，旧产物目录被覆盖）。
2. 重跑隔离测试 + 真实冒烟；重点核对 provider_config schema（schemaVersion）与权限档语义是否变化。
3. Apache-2.0：本集成零源码 patch，manifest 记录 commit 即满足合规。
