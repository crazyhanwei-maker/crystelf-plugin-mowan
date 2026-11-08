# 内置 ZCode 运行时——构建与调用说明

> 定版：zai-org/ZCode **v3.14.3**（不追上游；将来升级 = 手动拉新 tag 重新构建）。
> 产物形态：**cjs + node 资产**（esbuild bundle，宿主 Node 直接执行；无 npm install）。
> 硬性要求：**宿主 Node ≥ 22**（上游 esbuild target=node22，运行时模块会预检并给出可区分错误）。**会话库模型/思考档位同步需要 Node ≥ 22.13**（`node:sqlite` 在 22.13 才取消 `--experimental-sqlite`）；22.0–22.12 首轮可用，续接轮次会降级为警告并沿用会话库旧选型。

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

### 3.1 会话目标 / 检查点 / 分叉 / 中途切换

Agent 工作台的 ZCode 会话支持上游的会话级能力，控制台侧统一走「会话控制」弹窗（头部「会话控制」按钮或 `/goal`、`/rewind` 斜杠命令）：

- **会话目标**：`/goal replace <目标>` 设置/替换，`/goal pause|resume|clear` 管理状态。设置目标会触发上游 `continueTargetAfterChange` 自动继续执行；只读档上游只记录目标、不自动执行。上游 headless 的 `/goal` 走命令中心，只输出整段 `{sessionId,response}` JSON，运行时会整段解析兜底；普通轮次里的 `session.updated`（payload.action + target）仍会透传成 `goal` 事件。命令中心响应没有目标摘要时（写档下直接继续执行），控制台按已提交的动作兜底写入状态。
- **检查点**：上游每次文件写入成功后发 `checkpoint.created`，控制台收集完整 `checkpointId`、文件数与创建时间（每任务最多 50 条）。`/rewind latest|<id>` 恢复工作区文件；`/fork latest|<id>` 从检查点创建新会话。
- **分叉**：上游 `/fork` 在事件里返回 `forkedSessionId`（当前进程仍停在父会话），运行时单独回传；控制台用该 ID 新建任务记录，与父任务共享同一 ZCode 状态目录（sqlite 会话库），标题追加「（分叉）」。同一状态目录的父子任务在调度器里互斥，避免两个进程抢 sqlite 锁。
- **中途切换模式/模型/思考强度**：ZCode 的 `--mode` 与模型配置是每次调用参数，控制台在任务记录上更新 `mode/model/modelProviderId/variant`，从下一轮消息开始生效；运行中的轮次不允许切换，避免收尾判定与记录不一致。切换到写入档仍需一次写入风险确认。
- **思考强度真实映射**（不再折叠成 enabled/disabled）：`openai-responses` 写 `reasoning.effort`；OpenAI 兼容 chat/completions（含 grok）写 `reasoning_effort`；Anthropic 写 `thinking.budget_tokens`（按模型最大输出封顶）；`enabled`/默认不注入参数，`disabled` 显式写 `none`/`disabled`。是否支持某个档位由 API 决定，运行时不伪造。
- **会话库选型同步**：上游 `--resume` 会优先恢复会话库里的 `runtime/model_selection`。运行时在每次续接前把任务当前选型写回 `session_entry`（`${sessionId}:runtime-model-selection`），否则切换模型/思考档位只会改 provider 配置，实际仍沿用旧档位。同步是尽力而为：宿主 Node 低于 22.13、`node:sqlite` 不可用或会话库被占用时，本轮任务继续执行，但会发出「未能同步会话模型/思考档位」警告并沿用旧选型。
- 所有维护命令复用普通任务的队列、并发、SSE 事件、取消与审计链路；维护命令不做「空响应/只读写入违规」判定，也不为回退/分叉创建 Git 快照。
- **错误透出**：`turn.failed` 取 cause 链最深层的 message（外层通常只有 “Turn execution failed”）；运行时再读本轮 ZCode 日志，补上真实 `HTTP 状态 / 模型 / 供应商 / request id`，并丢弃 APICallError 堆栈与请求体。`turn.failed` 即使伴随 result 行、进程退出码 0，也按失败收口。

### 3.2 MCP 服务器与动态工作流

- **MCP 结构化编辑**：Agent 设置里的「MCP 服务器」提供列表式增删改（stdio 的 command/args/env，sse/http 的 url/headers），并保留「高级 JSON」编辑。最终仍序列化为原来的 `zcodeMcpServers` JSON，任务期写入工作区 `.mcp.json`，结束清理；工作区已有 `.mcp.json` 时不覆盖。当前只做配置管理，实时连接状态需要 app-server 的 `mcp/list`。
- **动态工作流**：设置项 `zcodeEnableWorkflow` 显式开启后，ZCode 子进程追加 `--enable-workflow`。输入区 `+ → 动态工作流` 插入 `/workflow `，`runTask` 对 ZCode 会话放行 `/workflow`、`/init` 这类核心内置提示词命令，不再被控制台斜杠分发层拦截。
- 运行时把 `workflow.run.progress` 事件转成 `workflow` 事件；控制台按 runId 归并状态、节点进度与最近日志（最多 5 个 run、每个 30 条事件），在对话顶部展示工作流卡片。任务取消会杀掉进程树，未收到 `run-settled` 的运行会收口为 canceled/error。
- 工作流的运行列表/恢复管理需要 app-server 的 `workflows/*` 或 `/dwf`，当前无头模式只做启用、进度展示与随任务取消。

### 3.3 技能/自定义命令、会话库刷新与压缩附加指令

- **技能与自定义命令**：控制台通过 `zcode skills list --json` / `zcode commands list --json` 探测工作区可见能力（独立临时 HOME，不读宿主 `~/.zcode`），结果按目录缓存 30 秒。技能插入 `/skill <name> `；自定义命令插入 `/<name> ` 并在下一次提交时放行给 ZCode 的 customCommandPromptResolver。`disableNonInteractive` 的命令在面板中标记为不可用。
- **会话库刷新**：`POST /api/agent-workbench/tasks/:id/zcode-state` 只读会话库，补齐 `session_target` 目标（含 Token 预算/用量/耗时）、`runtime/workspace_checkpoint` 检查点、`turn_usage` 累计 Token/轮次/工具次数。刷新只更新 `zcodeStateRefreshedAt`，不影响任务 `updatedAt` 与列表排序；目标表读取失败（锁冲突/损坏）时保留事件流里的已有目标，不误清空。旧 `GET` 客户端兼容但只读不落库。切换选中会话时自动刷新一次（60 秒节流），会话控制弹窗也有手动「刷新」按钮。会话库不存在/被清理时返回 `refreshed:false`，不影响任务。
- **压缩附加指令**：手动 `/compact [要求]` 会拼成 `/compact <instructions>` 交给上游；自动压缩仍使用默认 `/compact`。
- **AI 用量日志**：ZCode 每轮按 `result.usage` 直接写入 `scene=agent_task:zcode`（单轮值，不做累计差分），成功、失败、超时、取消都记；`completion` 含 reasoning，`total` 按 prompt+completion 计算，避免日志里 completion 大于 total。失败/取消轮 result 没有 usage 时回读会话库最新 `turn_usage` 兜底，`total=0` 自动跳过。OpenCode 按会话累计增量写入 `scene=agent_task:opencode`，失败/取消会尽力回读一次会话用量。已上报基线 `usageReported` 随任务落盘，控制台重启后续聊同一 OpenCode 会话不会重复记账。

## 4. 隔离测试

```bash
node --experimental-vm-modules scripts/check-zcode-runtime.mjs
```

39 项检查：配置生成（协议映射/错误码/自定义供应商/manual 白名单）、沙箱 env、产物定位、假 CLI 全管道（成功事件序列、plan/build 档参数与 AskUserQuestion 禁用、相对路径解析、turn.failed、深层 cause 错误透出、非零退出、.env 保护）、能力配置（AGENTS.md 注入、.mcp.json 不覆盖原则、contextWindow 回传）、续接（--resume 注入与父状态目录复用、选型同步失败降级）、思考强度真实映射（Responses / chat-completions / Anthropic / 自定义档位）、会话控制事件（goal / checkpoint / rewind / forked / 命令中心整段 JSON）、动态工作流（--enable-workflow / workflow.run.progress）、能力探测（skills / commands JSON 解析、单个子命令失败返回部分结果）、并发池（上限 1 拒绝、可配 2 并存、中止、超时强杀）、状态目录清理（orphans/all 两种模式）。不读写真实配置。也可经 `npm run check:zcode` 运行。

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
| 续接轮次提示「未能同步会话模型/思考档位」 | 宿主 Node < 22.13（`node:sqlite` 仍需 `--experimental-sqlite`）或会话库被锁/损坏；任务会继续，但本轮沿用旧选型 → 升级 Node 到 22.13+，或等当前轮结束再切换 |
| `AGENT_ZCODE_TASK_BUSY` | 并发池已满（上限 `zcodeMaxConcurrent` 1-3，默认 1）→ 等待、调高上限或 `abortZcodeTask` |
| 启动报 rg 相关错误 | 不应发生（rg 缺失只降级搜索）；确认 `tools/rg` 存在或 PATH 有 rg |
| 模型请求 401/404 | 检查灵晶 baseApi/apiKey；anthropic 协议地址由运行时自动补 `/v1`，openai 地址保持原样 |
| 任务失败后 zcode-state/tasks 残留 | 设计如此（保留现场排查）；确认问题后可手动删除 |

## 6. 上游升级流程（将来手动）

1. `node scripts/build-zcode-runtime.mjs --tag v<新版本>`（新 tag 重新 clone 构建，旧产物目录被覆盖）。
2. 重跑隔离测试 + 真实冒烟；重点核对 provider_config schema（schemaVersion）与权限档语义是否变化。
3. Apache-2.0：本集成零源码 patch，manifest 记录 commit 即满足合规。
