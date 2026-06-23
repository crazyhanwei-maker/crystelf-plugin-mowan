# AI 大模型调用重试机制 设计文档

- 日期：2026-06-24
- 状态：已批准，待实现
- 关联代码：`modules/openai/openaiChat.js`、`lib/ai/aiCaller.js`、`lib/ai/imageProcessor.js`、`guoba/configSchema.js`、`guoba/configHandler.js`、`config/ai.json`

## 1. 背景与目标

当前插件在主聊天、工具调用、戳一戳、多模态、图像生成等路径上**没有可配置的同接口重试机制**。现有能力只有两种，均不是「同接口重试」：

- **备用 API 切换（fallback）**：主接口失败后，切换到另一套 `baseApi/apiKey/model` 再试一次。逻辑在 `lib/ai/apiFallback.js` 与 `aiCaller.js` 的 `callAiDirect`/`callAiComplete`、`imageProcessor.generateOrEditImage` 中。默认 `config/ai.json` 未启用 `fallbackApi`。
- **戳一戳 app 层重试**：`apps/poke.js` 的 `generateWithRetry`，仅对戳一戳场景、针对「空回复」重试，与接口层错误重试不同。
- **OpenAI SDK 内置重试**：客户端初始化未设 `maxRetries`，走 SDK 默认（2 次指数退避），但仅覆盖走 SDK 的 chat 调用，对图像（axios 直连）无效，且行为对用户不可见、不可配、不与插件 fallback/日志体系联动。

**目标**：为所有 AI 大模型调用增加可配置次数的同接口重试，仅对可重试错误（网络错误/超时/429/5xx）做指数退避重试，重试耗尽后再走现有 fallback；默认关闭（0 次），不改变现有默认行为。

## 2. 关键决策（已与用户确认）

| 决策项 | 选择 |
|---|---|
| 覆盖范围 | 所有 AI 调用统一覆盖（聊天/工具调用/戳一戳/多模态/图像生成） |
| 错误策略 | 仅对可重试错误（网络/超时/429/5xx）重试；4xx（401/403/400 等）不重试 |
| 退避策略 | 指数退避，初始 500ms，2 倍递增，上限 8s |
| 与 fallback 关系 | 先重试 N 次，全部失败后再走 fallback |
| 配置粒度 | 网页控制台仅暴露「重试次数」一项；退避参数写死 |
| 默认重试次数 | 0（默认关闭，不改变现有默认行为） |
| 实现路线 | 路线 A：抽出一个通用 `withRetry` 工具，在各调用点包裹「单次请求」 |

## 3. 总体架构

新增模块 `lib/ai/retry.js`，导出两个函数：

- `isRetryableError(error)` — 判断错误是否值得重试。
- `withRetry(fn, options)` — 通用重试包裹器。

重试逻辑发生在「主接口单次请求」这一层（包裹 `openai.chat.completions.create` 或 `axios.post` 调用本身）；现有 fallback（`attemptedFallback` 守卫）保持原样在上层运作：

```
主接口 create (withRetry 包裹 → 失败重试 N 次)
  → 全部失败抛异常 → 上层 catch (callAiDirect/callAiComplete/generateOrEditImage)
  → attemptedFallback 判定 → 切备用接口
  → 备用接口 create (同样 withRetry 包裹 → 失败重试 N 次)
```

`attemptedFallback` 守卫不受影响，因为重试是接口请求内部的，不改变外层「是否已尝试过 fallback」的标志。

## 4. 重试模块设计 `lib/ai/retry.js`

### 4.1 `isRetryableError(error)`

判定一个错误是否值得重试。返回 `boolean`。

判定优先级：
1. **网络层错误**：`error.code` 命中 `ETIMEDOUT`/`ECONNABORTED`/`ECONNRESET`/`ENOTFOUND`/`EAI_AGAIN`/`ECONNREFUSED`/`EPIPE` → 可重试。
2. **超时类（消息匹配）**：`error.name + error.code + error.message` 拼接后匹配 `/超时|timeout|timed out|time out|abort/i` → 可重试（复用现有 `normalizeAiErrorMessage` 的正则思路）。
3. **HTTP 状态码**：从 `error.status` 或 `error.response?.status` 取状态码；`429` 或 `5xx`（500-599）→ 可重试；`4xx`（400-499，含 401/403/400）→ **不重试**。
4. 其余未知错误 → 不重试（保守，避免对永久性错误反复浪费配额和时间）。

### 4.2 `withRetry(fn, options)`

```js
export async function withRetry(fn, {
  retries = 0,            // 重试次数（不含首次），默认 0 即不重试
  isFailureResult = null, // 可选，用于「返回失败结果而非抛异常」型调用；返回 true 表示需重试
  baseDelay = 500,        // 初始退避间隔 ms
  maxDelay = 8000,        // 退避上限 ms
  sleep = (ms) => new Promise(r => setTimeout(r, ms)),
  onRetry = null,         // 可选回调 (info) => void，用于日志
} = {})
```

执行流程：
1. `retries <= 0` 时直接 `return await fn()`，不进入循环，零开销。
2. 首次执行 `fn()`：
   - 抛异常且 `isRetryableError(error)` → 进入重试循环；抛异常但不可重试 → 直接 `throw`。
   - 返回结果且提供了 `isFailureResult` 且 `isFailureResult(result) === true` → 进入重试循环；否则直接 `return result`。
   - 返回结果且未提供 `isFailureResult` → 直接 `return result`（抛异常型调用的正常路径）。
3. 重试循环（最多 `retries` 次）：
   - 退避：`delay = min(baseDelay * 2^(attempt-1), maxDelay)`，即 500ms → 1s → 2s → 4s → 8s → 8s…
   - `await sleep(delay)` 后再次执行 `fn()`。
   - 调用 `onRetry?.({ attempt, delay, error })` 便于上层记录日志。
   - 成功（不再抛/不再返回失败结果）→ `return result`。
   - 仍失败但不可重试 → 中止，抛出/返回最后结果。
4. 重试耗尽：
   - 若最后一次是 `reject`（抛异常）→ 重新抛出该异常。
   - 若最后一次是 `resolve` 但为失败结果 → 返回该结果。

### 4.3 日志

`withRetry` 本身不直接写业务日志，通过可选 `onRetry` 回调让调用方决定日志格式，避免与现有 `[crystelf-ai]` 日志风格脱节。调用方在 `onRetry` 里用 `logger.warn` 记录，例如：

```
[crystelf-ai] AI请求重试 1/3，500ms 后重试: AI请求超时（60000ms）
```

## 5. 接入点（路线 A，四处包裹「单次请求」）

| 路径 | 文件:行 | 包裹对象 | 失败表达 | shouldRetry |
|---|---|---|---|---|
| 文本/多模态 | `modules/openai/openaiChat.js` `callAi` 内 `this.openai.chat.completions.create(...)` | `create(...)` | 抛异常 | `isRetryableError(error)` |
| direct | `lib/ai/aiCaller.js` `createDirectCompletion`（~第 197 行） | `apiCaller.openai.chat.completions.create(...)` | 抛异常 | `isRetryableError(error)` |
| tool | `lib/ai/aiCaller.js` `createToolCompletion`（~第 210 行） | `apiCaller.openai.chat.completions.create(...)` | 抛异常 | `isRetryableError(error)` |
| 图像生成 | `lib/ai/imageProcessor.js` 6 个底层方法内的 `axios.post(...)` | `axios.post(...)` | 抛异常 | `isRetryableError(error)` |

### 5.1 openaiChat.callAi 接入

`callAi`（第 88-178 行）的 try 块内，把第 94-101 行的 `this.openai.chat.completions.create(...)` 用 `withRetry` 包裹：

```js
const completion = await withRetry(
  () => this.openai.chat.completions.create({
    messages: sanitizeMessages(finalMessages),
    model: model,
    temperature: temperature,
    frequency_penalty: 0.2,
    presence_penalty: 0.2,
    stream: false,
  }),
  {
    retries: this.retryCount,
    onRetry: (info) => logger.warn(`[crystelf-ai] AI请求重试 ${info.attempt}/${this.retryCount}，${info.delay}ms 后重试: ${info.error?.message || info.error}`),
  },
);
```

后续的响应解析、`logAiUsage`、`return` 逻辑不变；catch 块的 `normalizeAiErrorMessage`/`logAiUsage` 不变（重试耗尽后异常仍会冒到 catch）。

### 5.2 createDirectCompletion / createToolCompletion 接入

这两个方法已有 `config` 参数，直接读 `config.retryCount`：

```js
async createDirectCompletion(apiCaller, config, messages, options = {}, fallback = false) {
  const model = fallback ? resolveFallbackWorkModel(config) : resolvePreferredWorkModel(config, options.model);
  return withRetry(
    () => apiCaller.openai.chat.completions.create({
      model,
      messages: sanitizeMessages(messages),
      temperature: options.temperature ?? config.temperature ?? 0.7,
      max_tokens: options.max_tokens,
      stream: false,
    }),
    {
      retries: Number(config.retryCount) > 0 ? Number(config.retryCount) : 0,
      onRetry: (info) => logger.warn(`[crystelf-ai] 请求重试 ${info.attempt}/${config.retryCount}，${info.delay}ms 后重试: ${info.error?.message || info.error}`),
    },
  );
}
```

`createToolCompletion` 同理。这两个方法被 `callAiDirect`/`callAiComplete` 在主接口和 fallback 接口都调用，因此主接口重试 N 次 + fallback 接口重试 N 次会自然形成。

### 5.3 图像生成接入

`imageProcessor.js` 有 6 个底层方法，每个内部 `axios.post(...)` 是真正会因网络/超时失败的地方，逐一用 `withRetry` 包裹：

- `generateImageByOpenAI`（~第 211 行）
- `generateImageByChat`（~第 282 行）
- `generateImageByJimeng`（~第 537 行）
- `editImageByChat`（~第 369 行）
- `editImageByOpenAI`（~第 470 行）
- `editImageByJimeng`（~第 577 行）

这些方法已有 `config` 参数（即 `generateOrEditImage` 第 108 行 `mergeImageConfig` 产出的 `mergedConfig`），读 `config.retryCount`。注意 `mergeImageConfig` 原本只合并 `imageConfig` 相关字段，不含全局 `retryCount`，需在 `mergeImageConfig`（第 685 行）末尾显式继承：`mergedConfig.retryCount = Number(userConfig?.retryCount) > 0 ? Number(userConfig.retryCount) : 0;`，这样 6 个底层方法的 `config` 都能拿到重试次数。

**图像路径的特殊性**：图像的「空回复/格式错误」返回 `{ success: false }` 但不抛异常，**不在重试范围内**（只重试抛异常的 HTTP 层失败）。这与现有 `generateOrEditImage` 的 fallback 逻辑一致——fallback 判定的是 `result.success`，而重试判定的是 `axios.post` 是否抛异常，两者正交。

### 5.4 重试次数的读取

| 接入点 | retryCount 来源 |
|---|---|
| `openaiChat.callAi` | `this.retryCount`（由 `init` 传入） |
| `createDirectCompletion`/`createToolCompletion` | `config.retryCount`（已有 config 参数） |
| `imageProcessor` 6 个方法 | `config.retryCount`（`mergeImageConfig` 末尾显式继承全局值） |

`openaiChat` 目前不持有 config，需小幅改造：`init(apiKey, baseUrl, timeout, retryCount = 0)` 多存一个 `this.retryCount`。在 `aiCaller.init`（第 86 行）与 `refreshRuntimeConfig`（第 232 行）调用 `openaiChat.init` 时传入 `this.config.retryCount`。

## 6. 配置与网页控制台设置项

网页控制台与 guoba **共用同一套 schema**（`guoba/configSchema.js` 是唯一数据源）。新增设置项只需加一处，网页控制台会自动渲染、校验、保存，前端零改动。

### 6.1 配置默认值 `config/ai.json`

放在 `timeout`（第 66-67 行）附近，保持 `?key` 注释风格：

```json
"?retryCount": "AI接口调用失败时的重试次数，0表示不重试(默认)，仅对网络错误/超时/429/5xx生效，重试耗尽后仍会尝试备用API",
"retryCount": 0,
```

图像路径复用同一个 `retryCount`（通过 `mergeImageConfig` 末尾继承全局值），不单独设图像重试次数，保持「一个全局重试次数」的简洁。

### 6.2 Schema 设置项 `guoba/configSchema.js`

放在「对话与会话」分组里 `ai.timeout`（第 1623-1634 行）之后：

```js
{
  field: 'ai.retryCount',
  label: 'AI调用重试次数',
  component: 'InputNumber',
  bottomHelpMessage: 'AI 接口失败时的重试次数，0 表示不重试；仅对网络错误/超时/429/5xx 重试，指数退避(500ms起,上限8s)；重试耗尽后仍会尝试备用API',
  componentProps: {
    min: 0,
    max: 10,
    step: 1,
    placeholder: '请输入重试次数，0表示不重试',
  },
},
```

### 6.3 校验 `guoba/configHandler.js`

在 `case 'ai'`（第 313 行起）内，仿第 340-342 行 `maxIterations` 写法：

```js
if (config.retryCount !== undefined && (Number(config.retryCount) < 0 || Number(config.retryCount) > 10)) {
  errors.push('AI调用重试次数必须在 0-10 之间');
}
```

### 6.4 热生效 `aiCaller.getConfigSignature`

把 `retryCount` 加入 `getConfigSignature`（第 103-133 行）的序列化对象，使网页控制台修改后 `refreshRuntimeConfig` 能检测到变更并热生效：

```js
retryCount: Number(config.retryCount) > 0 ? Number(config.retryCount) : 0,
```

### 6.5 网页控制台自动行为（无需改动）

- `buildPluginSettingsPayload`（`pluginSettingsConsole.js` 第 560-598 行）自动遍历 schema 渲染该项。
- `precheckPluginSettings`（第 769-893 行）按 `min/max` 自动校验。
- `savePluginSettings`（第 895-1029 行）按 `ai.retryCount` 的 `ai` 前缀写回 `data/crystelf/ai.json`。
- 前端 `plugin-settings-render.js`/`plugin-settings-events.js`/`plugin-settings-state.js` 按 `component` 类型通用渲染，无需改动。

## 7. 改动文件清单

| 文件 | 改动 |
|---|---|
| `lib/ai/retry.js` | **新建**：`isRetryableError` + `withRetry` |
| `modules/openai/openaiChat.js` | `init` 多收 `retryCount`；`callAi` 内 `create` 用 `withRetry` 包裹 |
| `lib/ai/aiCaller.js` | `createDirectCompletion`/`createToolCompletion` 用 `withRetry` 包裹；`init`/`refreshRuntimeConfig` 传 `retryCount`；`getConfigSignature` 加 `retryCount` |
| `lib/ai/imageProcessor.js` | `mergeImageConfig` 末尾继承全局 `retryCount`；6 个底层方法的 `axios.post` 用 `withRetry` 包裹 |
| `config/ai.json` | 新增 `?retryCount` + `retryCount: 0` |
| `guoba/configSchema.js` | 新增 `ai.retryCount` 设置项 |
| `guoba/configHandler.js` | `case 'ai'` 加 `retryCount` 范围校验 |

## 8. 不改动 / 不在范围内

- **现有 fallback 逻辑**（`apiFallback.js`、`callAiDirect`/`callAiComplete`/`generateOrEditImage` 的 fallback 分支、`attemptedFallback` 守卫）保持不变。
- **戳一戳 app 层重试**（`apps/poke.js` 的 `generateWithRetry`、`pokeConfig.aiRetryCount`）保持不变——它是「空回复」重试，与本次「接口错误」重试正交；戳一戳走 `callAiDirect`，会自动获得本次的接口层重试。
- **OpenAI SDK 的 `maxRetries`** 不显式设置，继续走默认；本次重试是插件层的、可配的、对所有路径生效的。
- 退避参数（初始 500ms、2 倍、上限 8s）写死，不暴露为配置项。

## 9. 测试要点

- `retryCount = 0`（默认）：行为与现状完全一致，`withRetry` 直接 `return await fn()`，无重试。
- 模拟可重试错误（超时/网络错误/429/500）：重试 N 次后才放弃，退避间隔符合 500ms→1s→2s→4s→8s→8s。
- 模拟不可重试错误（401/400）：不重试，立即失败。
- 重试成功：在第 k 次（k ≤ N）成功，返回正常结果。
- 重试耗尽后 fallback：主接口重试 N 次全失败 → 切备用接口 → 备用接口重试 N 次。
- 配置热生效：网页控制台改 `retryCount` 后，下次调用即按新值重试，无需重启。
- 图像路径：`axios.post` 网络失败时重试；空回复（`success:false` 不抛异常）不重试。
