# Crystelf HTTP Skills 标准文档

这份文档用于指导其他 LLM 为 `crystelf-plugin` 搜索外部网站 API，并按本插件当前实现生成可直接落地的 `skills.json` 配置片段。

适用范围：

- 为现有 `config/skills.json` 新增 skill 或 tool
- 搜索公开 API 并转换为本插件的 HTTP skill
- 输出标准化 JSON 片段，供人工合并到配置文件

不适用范围：

- 修改 JS 运行时代码
- 设计任意执行代码的动态工具
- 接入需要复杂鉴权、文件上传、多阶段状态机、流式返回的接口

## 1. 当前实现概览

本插件当前的 skills 框架是“配置化 HTTP 工具”。

- 默认配置入口：`config/skills.json`
- 可选拆分目录：`config/skills/*.json`
- 运行时代码：`lib/ai/httpSkillRegistry.js`
- 会话加载与展示：`lib/ai/sessionManager.js`

运行机制：

1. 启动后会先读取 `config/skills.json`，再按 `name` 合并 `config/skills/*.json`
2. 当 `enabled: true` 且 `autoLoad !== false` 时，系统会在 AI 会话中自动加载所有启用的 skill
3. 每个 skill 可包含多个 tool
4. 每个 tool 最终会被导出为 OpenAI function tool

拆分建议：

- `config/skills.json` 负责总开关、默认超时、skill 顺序和基础启停状态
- `config/skills/<skill-name>.json` 负责单个 skill 的完整定义
- 运行时覆盖支持 `data/crystelf/skills.json`
- 也支持运行时拆分目录 `data/crystelf/skills/*.json`

导出的工具名规则：

- 原始：`weather.get_weather`
- 导出：`skill__weather__get_weather`

命名归一化规则：

- 全小写
- 非 `[a-z0-9_]` 字符会被替换为 `_`
- 最大长度 `64`

## 2. 允许的配置位置

默认建议其他 LLM 只输出以下其中一种内容：

- 一个新的 `definition` 对象
- 某个已有 `definition.tools` 的新增数组项
- 一整份更新后的 `config/skills.json`

推荐目标文件：

- `config/skills.json`

## 3. 顶层 JSON 结构

标准结构如下：

```json
{
  "enabled": true,
  "autoLoad": true,
  "defaultTimeoutMs": 15000,
  "definitions": []
}
```

字段说明：

- `enabled`: 是否启用整个 HTTP skills 系统
- `autoLoad`: 是否在每个 AI 会话自动加载
- `defaultTimeoutMs`: 默认超时，单位毫秒，最终会被限制在 `1000-60000`
- `definitions`: skill 列表

## 4. definition 标准字段

每个 skill 定义对象结构：

```json
{
  "enabled": true,
  "name": "weather",
  "description": "技能描述",
  "allowedHosts": ["uapis.cn"],
  "timeoutMs": 10000,
  "tools": []
}
```

字段说明：

- `enabled`: 是否启用这个 skill
- `name`: skill 名称，建议简短稳定，例如 `weather`、`tracking`、`hotboard`
- `description`: skill 用途描述，会进入 AI 上下文
- `allowedHosts`: 允许访问的域名白名单，强烈建议填写；支持精确域名和 `*.example.com` 这种单段通配写法
- `timeoutMs`: skill 级默认超时，可被 tool 级覆盖
- `tools`: tool 列表

命名建议：

- skill 名建议使用领域名，而不是站点名
- 好例子：`weather`、`tracking`、`calendar`、`webparse`
- 不推荐：`uapi_weather_v2_toolbox`

## 5. tool 标准字段

每个 tool 定义对象结构：

```json
{
  "name": "get_weather",
  "description": "工具描述",
  "parameters": {
    "type": "object",
    "properties": {},
    "required": []
  },
  "request": {
    "method": "GET",
    "url": "https://example.com/api",
    "query": {},
    "headers": {},
    "body": {}
  },
  "response": {
    "path": "",
    "pick": [],
    "maxLength": 3200
  },
  "timeoutMs": 10000,
  "allowedHosts": ["example.com"],
  "returnToAI": true,
  "stopOnFailure": true
}
```

字段说明：

- `name`: tool 名称，建议动词开头，例如 `get_weather`、`list_carriers`
- `description`: 工具用途，会进入 AI 上下文
- `parameters`: OpenAI function 风格的 JSON Schema
- `request`: HTTP 请求定义
- `response`: 响应抽取与裁剪定义
- `timeoutMs`: tool 级超时
- `allowedHosts`: tool 级域名白名单，支持精确域名和 `*.example.com`
- `returnToAI`: 默认 `true`，通常无需显式写
- `stopOnFailure`: 建议外部 API tool 统一写 `true`

## 6. request 字段标准

### 6.1 method

当前实现只允许：

- `GET`
- `POST`
- `PUT`
- `PATCH`
- `DELETE`

### 6.2 url

- 必填
- 必须是 `http` 或 `https`
- 最好写死到具体接口地址
- 不要让 LLM 生成任意可变域名

### 6.3 query / headers / body

支持模板变量：

```json
{
  "city": "{{city}}",
  "adcode": "{{adcode}}",
  "api_key": "{{env.OPENAI_API_KEY}}"
}
```

规则：

- 模板格式：`{{field}}`
- 支持简单路径：`{{user.id}}`
- 支持环境变量：`{{env.OPENAI_API_KEY}}`，也支持在未命中参数时直接回退到同名环境变量 `{{OPENAI_API_KEY}}`
- 如果整段值就是单个模板变量，例如 `"messages": "{{messages}}"`，会尽量保留原始类型
- 若整值模板解析出的字符串本身是 JSON 对象或数组文本，会自动转成对象或数组
- `null` / `undefined` / 空字符串 会在发送前被递归删除，包括嵌套对象和数组内的空值
- 只有在字符串拼接场景下，非字符串值才会序列化成 JSON 字符串

## 7. response 字段标准

### 7.1 path

可选，用于先取响应中的某个子路径。

示例：

```json
{
  "path": "data"
}
```

如果不写，则直接使用整个响应体。

### 7.2 pick

可选，用于只保留某些字段。

示例：

```json
{
  "pick": ["title", "description", "list"]
}
```

支持点路径：

```json
{
  "pick": ["data.title", "data.items"]
}
```

### 7.3 maxLength

可选，控制最终 `summary` 的最大长度。

如果不写，默认上限约为 `4000` 字符。

## 8. 运行时安全与裁剪规则

这是外部 LLM 必须知道的硬约束。

### 8.1 域名限制

如果配置了 `allowedHosts`：

- 最终请求域名必须在白名单中

如果没有配置 `allowedHosts`：

- 模板替换后的最终域名必须与原始 `url` 的域名一致

因此：

- 强烈建议始终填写 `allowedHosts`

### 8.2 返回值裁剪

运行时会自动裁剪返回数据：

- 字符串最长约 `4000`
- 数组最多 `10` 项
- 对象最多 `30` 个键
- 最大递归深度 `4`

因此：

- 不要把超大响应原样塞给模型
- 优先用 `pick` 缩小结构

### 8.3 超时范围

所有超时最终都会被限制在：

- 最小 `1000ms`
- 最大 `60000ms`

建议：

- 普通查询类接口使用 `8000-15000ms`

## 9. 当前配置合并规则

当前实现会把：

- 插件默认 `config/skills.json`
- 插件默认拆分目录 `config/skills/*.json`
- 运行时配置 `data/crystelf/skills.json`
- 运行时拆分目录 `data/crystelf/skills/*.json`

按 `name` 进行合并。

合并规则：

- `definition` 层按 `name` 合并
- `tools` 层按 `name` 合并
- 运行时配置优先覆盖默认配置
- 默认配置中新增的 skill / tool 会自动补进运行时配置视图

因此：

- 新 skill / 新 tool 的 `name` 必须稳定且唯一
- 不要轻易改已有名称

## 10. 外部 LLM 搜接口的工作标准

让其他 LLM 搜接口时，要求它必须按下面流程产出。

### 10.1 必查项

每个候选 API 至少确认这些信息：

1. 实际请求方法
2. 实际接口 URL
3. 是否免登录 / 免 key / 免费模式可用
4. 必填参数
5. 可选参数
6. 哪些参数是 Pro / 付费 / 不建议暴露
7. 成功响应的核心字段
8. 失败响应是否稳定
9. 是否适合做“一次请求一次返回”的 tool

### 10.2 过滤规则

以下接口优先接入：

- 公开 GET/POST 接口
- 请求参数简单
- 响应结构稳定
- 对群聊 bot 有高频价值
- 可直接转成结构化查询能力

以下接口暂不优先：

- 必须登录态
- 强依赖文件上传
- 多阶段异步轮询
- 需要复杂签名
- 返回过大且结构不稳定
- 与现有能力高度重复

### 10.3 免费与 Pro 策略

默认只接免费模式。

如果文档里某些参数标了 `Pro`、`会员`、`付费`：

- 默认不要放进 tool
- 除非用户明确要求接入付费能力

## 11. 命名规范

### 11.1 skill 命名

使用领域名：

- `weather`
- `tracking`
- `hotboard`
- `calendar`
- `webparse`

### 11.2 tool 命名

推荐模式：

- `get_xxx`
- `list_xxx`
- `detect_xxx`
- `search_xxx`

示例：

- `get_weather`
- `get_tracking`
- `detect_carrier`
- `list_carriers`
- `get_hotboard`
- `get_holiday_calendar`
- `get_lunartime`
- `get_metadata`
- `extract_images`

## 12. 生成配置时的建议

### 12.1 parameters 建议

- 尽量给每个参数写清楚 `description`
- 必填项一定写进 `required`
- 布尔参数在当前项目里通常直接用字符串 `"true"` / `"false"` 更稳，尤其 GET 查询参数

### 12.2 response 建议

- 如果返回数据很大，优先加 `pick`
- 如果根结构已经很小，可以只写 `maxLength`
- 对列表型接口，保留最关键字段即可

### 12.3 stopOnFailure 建议

建议统一：

```json
"stopOnFailure": true
```

这样外部接口失败时，AI 不会在同一轮重复重试同一个工具。

## 13. 标准输出格式

让其他 LLM 输出时，统一要求它给出下面四部分：

1. 接口摘要
2. 是否值得接入
3. 推荐 skill / tool 命名
4. 可直接粘贴到 `config/skills.json` 的 JSON 片段

推荐模板：

```md
接口名称：
请求方式：
接口地址：
免费可用：
必填参数：
可选参数：
不建议暴露的参数：
成功响应核心字段：
推荐接入结论：

推荐 skill 名：
推荐 tool 名：

JSON 片段：
```json
{}
```
```

## 14. 标准 JSON 模板

### 14.1 新建一个 skill

```json
{
  "enabled": true,
  "name": "example",
  "description": "示例 skill 描述",
  "allowedHosts": ["example.com"],
  "timeoutMs": 10000,
  "tools": [
    {
      "name": "get_example",
      "description": "示例工具描述",
      "parameters": {
        "type": "object",
        "properties": {
          "keyword": {
            "type": "string",
            "description": "查询关键词"
          }
        },
        "required": ["keyword"]
      },
      "request": {
        "method": "GET",
        "url": "https://example.com/api/v1/example",
        "query": {
          "keyword": "{{keyword}}"
        },
        "headers": {
          "Accept": "application/json"
        }
      },
      "response": {
        "pick": ["title", "items", "count"],
        "maxLength": 2600
      },
      "stopOnFailure": true
    }
  ]
}
```

### 14.2 给已有 skill 追加一个 tool

```json
{
  "name": "webparse",
  "tools": [
    {
      "name": "extract_images",
      "description": "提取网页中的图片链接列表",
      "parameters": {
        "type": "object",
        "properties": {
          "url": {
            "type": "string",
            "description": "需要提取图片的网页 URL"
          }
        },
        "required": ["url"]
      },
      "request": {
        "method": "GET",
        "url": "https://example.com/api/v1/images",
        "query": {
          "url": "{{url}}"
        },
        "headers": {
          "Accept": "application/json"
        }
      },
      "response": {
        "pick": ["page_url", "image_urls"],
        "maxLength": 2600
      },
      "stopOnFailure": true
    }
  ]
}
```

## 15. 给其他 LLM 的直接提示词

如果你要把任务丢给别的 LLM，可以直接给它下面这段要求：

```text
你正在为 crystelf-plugin 的 config/skills.json 搜索并生成 HTTP skill 配置。

请严格遵守以下规则：
1. 只选择公开可调用、结构稳定、适合单次 HTTP 请求返回的接口。
2. 优先免费模式；如果某些参数是 Pro/付费，请默认不要接入。
3. 必须确认真实的请求方法、真实接口 URL、必填参数、可选参数、成功响应核心字段。
4. 输出内容必须包含：
   - 接口摘要
   - 是否值得接入
   - 推荐 skill 名 / tool 名
   - 可直接粘贴到 config/skills.json 的 JSON 片段
5. JSON 结构必须符合以下规范：
   - definition 字段：enabled, name, description, allowedHosts, timeoutMs, tools
   - tool 字段：name, description, parameters, request, response, stopOnFailure
   - request.method 仅允许 GET/POST/PUT/PATCH/DELETE
   - request.url 必须写死为具体接口地址
   - query / headers / body 使用 {{field}} 模板
   - response 优先使用 pick 和 maxLength 控制返回体
6. 默认推荐 stopOnFailure=true。
7. 不要输出伪代码，不要修改 JS 运行时代码，只输出配置方案。
```

## 16. 当前已接入能力

其他 LLM 搜索新接口时，应避免与以下能力重复：

- `weather.get_weather`
- `tracking.get_tracking`
- `tracking.detect_carrier`
- `tracking.list_carriers`
- `hotboard.get_hotboard`
- `calendar.get_holiday_calendar`
- `calendar.get_lunartime`
- `webparse.get_metadata`
- `webparse.extract_images`
- 内置 `search_web`
- 内置 `fetch_web_markdown`
- 内置 `speak_text`

如果找到的接口与以上能力高度重复，应优先给出“不建议接入”的结论。
