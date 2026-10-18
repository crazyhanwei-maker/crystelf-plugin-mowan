# Agent 工作台接入 ZCode 运行时——接线方案

> 适用仓库：crystelf-plugin（设计快照版本 3.0.1，行号基于只读勘察）。
> **状态：已落地（3.0.2）**。正文为原始接线方案存档；落地偏差见文末「附：落地偏差与后续扩展」。
> 前置阅读：`zcode-upstream-research.md`（§5 权限映射、§8 偏差清单）。
> 本文件只描述"怎么接"，运行时模块本身见 `lib/webConsole/bundledZcodeRuntime.js`（接口契约与规格一致）。

## 0. 接线总览

OpenCode 路径：`runTask` → `spawnAttachedOpenCodeServer`（常驻 HTTP）→ REST 调用 → 池化管理（`workspaceRuntimes`）。
ZCode 路径：`runTask` → `runZcodeTask`（一次性 `-p --output-format stream-json` 子进程）→ 事件回调直通工作台 → 进程自动退出。

ZCode 不进入 OpenCode 的运行时池（`AGENT_SHARED_RUNTIME_KEY` / `getAgentRuntimeProfile` 是 OpenCode 进程复用的池键，ZCode 每任务一个新进程，无需池化），并发由运行时模块的 `activeZcodeTasks` 池兜底（上限 `zcodeMaxConcurrent` 1-3，默认 1，满员抛 `AGENT_ZCODE_TASK_BUSY`），工作台侧再叠一层任务队列/拒绝提示。

## 1. 引入运行时模块

`lib/webConsole/agentWorkbenchConsole.js` 顶部（现有 bundledOpenCodeRuntime 导入块之后）：

```js
import {
  abortZcodeTask,
  buildBundledZcodeEnvironment,
  buildZcodeConfig,
  createBundledZcodeTaskId,
  resolveBundledZcodeCommand,
  runZcodeTask,
} from './bundledZcodeRuntime.js';
```

## 2. 供应商注册表：新增 zcode 条目（默认关闭）

锚点：`PROVIDER_DEFINITIONS`（约 66-73 行）。

```js
const PROVIDER_DEFINITIONS = Object.freeze({
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    description: 'OpenCode CLI',
    binary: 'opencode',
  },
  // ZCode 默认关闭（沿用"默认关、显式启用"模式）：
  // enabled 由 featureConfig 控制（见 §6），关闭时前端不展示该选项、创建任务直接拒绝
  zcode: {
    id: 'zcode',
    label: 'ZCode',
    description: 'ZCode CLI（内置运行时，默认关闭）',
    binary: 'zcode.cjs',
  },
});
```

供应商能力探测：现有 opencode 探测逻辑（`resolveBundledOpenCodeCommand` + `bootstrapBundledOpenCode`，约 3086-3160 行）对 zcode 走独立分支：

```js
if (id === 'zcode') {
  const resolved = resolveBundledZcodeCommand({});
  if (!resolved) return { available: false, reason: 'ZCODE_RUNTIME_MISSING' }; // UI 引导构建
  if (resolved.nodeSupported === false) return { available: false, reason: 'ZCODE_NODE_UNSUPPORTED', nodeRequirement: resolved.nodeRequirement };
  return { available: true, version: resolved.version };
}
```

## 3. runTask 分支（核心接线）

锚点：`async function runTask(task)`（约 3395 行）。在函数入口按 providerId 分流：

```js
if (task.providerId === 'zcode') {
  return await runZcodeWorkbenchTask(task);
}
```

新函数 `runZcodeWorkbenchTask`（放在 runTask 附近），职责：组装运行时入参 → 桥接事件到工作台现有流式 UI 与审计 → 中止与超时收口：

```js
async function runZcodeWorkbenchTask(task) {
  const aiConfig = /* 与 OpenCode 路径同源：主对话 API 配置或任务自定义 API */;
  const taskId = createBundledZcodeTaskId();
  task.taskId = taskId;
  // 默认 permissionMode='plan'；'build' 需控制台显式开启 + 每任务二次确认（沿用现有确认流）
  const permissionMode = task.permissionMode === 'build' && isZcodeBuildUnlocked() ? 'build' : 'plan';
  try {
    return await runZcodeTask({
      taskId,
      prompt: task.prompt,
      workspaceDir: task.workspaceDir,          // 必须已通过工作台目录白名单校验
      permissionMode,
      aiConfig,
      model: task.model || '',
      customApi: task.customApi,
      modelProviders: task.modelProviders,
      allowNetwork: task.allowNetwork === true,
      allowFullAccess: task.permissionMode === 'full' && isZcodeFullAccessUnlocked(),
      timeoutMs: ZCODE_TASK_TIMEOUT_MS,          // 建议 15min，与控制台配置贯通
      onEvent: async event => {
        // 1) 事件进现有流式 UI（text 增量 / tool_result / done 与 OpenCode 事件对齐）
        forwardZcodeEventToStream(task, event);
        // 2) 命令执行与文件写入全量进审计日志（规格硬性约束）
        if (event.type === 'command_exec' || event.type === 'file_edit' || event.type === 'permission_request') {
          appendAgentAuditLog(task, event);       // webConsoleAuditLog 既有通道
        }
      },
    });
  } catch (error) {
    if (error.code === 'AGENT_ZCODE_TASK_BUSY') {
      throw createHttpError(429, '已有 ZCode 任务在运行，请稍后再试', error.code);
    }
    if (error.code === 'AGENT_ZCODE_RUNTIME_MISSING') {
      throw createHttpError(409, 'ZCode 运行时未构建，请在控制台完成构建', error.code);
    }
    throw error;
  }
}
```

中止接线：现有任务中止入口（opencode 走进程 kill / API cancel）加分支：

```js
if (task.providerId === 'zcode' && task.taskId) {
  await abortZcodeTask(task.taskId);   // 进程树强杀，返回 ok:false + "已中止"
}
```

## 4. 权限档与二次确认

- 默认 `plan`（只读分析；上游在权限层硬拒写入/终端，不经任何应答通道）。
- `build`（受控写入，映射 `--mode edit`）：要求控制台开关 + 每次任务发起时二次确认，确认流复用 OpenCode `crystelf-write` 档的现有 UI 流程。
- `full`（`--mode yolo`）：仅主人白名单 + 显式开启 + 二次确认；运行时侧还有 `allowFullAccess` 双保险（未开启时抛 `AGENT_ZCODE_FULL_ACCESS_DISABLED`）。
- 事件流中出现 `permission_request` 属异常信号（headless 下权限 ask 均被拒），照常进审计即可。

## 5. 群聊侧输出约束

`runZcodeTask` 返回 `{ ok, sessionId, output, filesChanged, error, usage, durationMs }`。群聊推送只取：
- `output`（已截断至 64KB，运行时兜底）
- `filesChanged` 清单（相对工作区的展示名）
- `error` 单行摘要

原始 shell 输出（`command_exec` 事件）只进工作台 UI 与审计日志，不进群聊消息。

## 6. 功能开关（默认关闭）

沿用插件 featureConfig 体系新增 `agent.zcode.enabled`（默认 false）。关闭时：
- `PROVIDER_DEFINITIONS` 过滤掉 zcode，前端选择器不可见；
- `runTask` 的 zcode 分支直接拒绝（409）。
开启时仍要求 `resolveBundledZcodeCommand({})` 非空（运行时已构建）。

## 7. 隔离与产物路径

- 运行时产物：`<Path.data>/agent-cli-runtime/zcode/`（仓库外，无需 .gitignore；若手动放到仓库内则需加入）。
- 任务状态：`<Path.data>/agent-cli-runtime/zcode-state/tasks/<taskId>/`，含明文 key 的 provider_config.json 在任务成功后由运行时自动删除，失败保留供排查。
- `.gitignore`：现有 `/data/` 规则不覆盖 `Path.data`（它在 Yunzai 数据目录），无需改动。

## 8. 验收清单（对照规格）

1. `npm run check:zcode`（等价 `node --experimental-vm-modules scripts/check-zcode-runtime.mjs`）全绿（28 项，含中止/超时/并发池/能力配置/续接/清理）。
2. `npm run check:agent-refresh` 全绿（25 项，会话列表刷新竞态：并发合并、过期响应守卫、失效会话回退）。
3. 真实冒烟：测试 key + 真实产物，plan 任务出事件流、build 任务真实改文件，全程审计可查。
4. OpenCode 回归：`PROVIDER_DEFINITIONS` 增加条目与 runTask 早分支不影响 opencode 路径；跑 `npm run check:webconsole`。
5. `npm run check:js` 通过。

## 附：落地偏差与后续扩展（相对原始方案）

- **权限档**：落地为 `plan`（只读）/ `build`（映射 edit，受控写入）/ `full`（映射 yolo，完全访问）三档，另在聊天侧暴露 `#zcode只读` 安全档；三个档统一追加禁用 `AskUserQuestion`（无头无 permission client）。
- **会话续接**：`runZcodeTask` 支持 `resumeSessionId` → 注入 `--resume` 并复用父任务状态目录；首回合写下的 `zcodeTaskId`/`zcodeSessionId` 续接轮次不覆盖（修复 Session not found）。成功任务按 `keepStateOnSuccess` 保留会话库。
- **Git 安全网**：写模式执行前对插件工作区做 plumbing 快照（临时 index，不碰工作树），支持按任务基线一键回滚；运行中禁止回滚。
- **能力配置**：任务级 `zcodeInstructions`（写运行时 HOME/.zcode/AGENTS.md）、`zcodeMcpServers`（工作区 .mcp.json 不覆盖原则）、自定义工作区（≤5 个）、上下文 usage/contextWindow 回传与 80% 提醒。
- **定时巡检**：`lib/agent/agentInspection.js` 模板巡检（node-schedule + 防重叠），Bot 群/私聊推送。
- **用量**：`reportAgentTaskUsage` 按 provider 拆分场景（`agent_task:opencode` / `agent_task:zcode`）。
- **聊天侧锚点**：`#zcode` 会话锚点（内存态）带预检与删除兜底——锚定任务被删除/不可续接时自动开新会话，不再报 404/409 卡死。
