# HTTP Skills 使用说明

HTTP Skills 用来把稳定的外部 HTTP 接口接入 AI 对话，让机器人在需要时查询天气、快递、网页信息、热榜、开发者资料等结构化数据。

## 适合接入的接口

推荐选择：

- 公开可访问或配置简单密钥的接口。
- 一次 HTTP 请求即可返回结果的接口。
- 返回 JSON 或结构清晰文本的接口。
- 响应内容较小、字段稳定的接口。
- 对群聊问答、控制台诊断或日常工具有明确价值的接口。

不建议默认接入：

- 需要复杂登录态的接口。
- 需要上传本地文件的接口。
- 需要多阶段轮询的接口。
- 返回内容过大或结构频繁变化的接口。
- 会暴露敏感信息或需要高权限密钥的接口。

## 配置位置

默认配置位于：

```text
config/skills.json
config/skills/
```

运行时配置位于：

```text
data/crystelf/skills.json
data/crystelf/skills/
```

一般用户建议通过控制台“插件设置 -> Skills 设置”进行启用、关闭和查看。

## 基础结构

一个 Skill 可以包含多个工具。每个工具描述一个 HTTP 请求和返回值裁剪规则。

示例：

```json
{
  "enabled": true,
  "name": "weather",
  "description": "查询天气和空气质量",
  "allowedHosts": ["example.com"],
  "timeoutMs": 10000,
  "tools": [
    {
      "name": "get_weather",
      "description": "按城市查询天气",
      "parameters": {
        "type": "object",
        "properties": {
          "city": {
            "type": "string",
            "description": "城市名称"
          }
        },
        "required": ["city"]
      },
      "request": {
        "method": "GET",
        "url": "https://example.com/api/weather",
        "query": {
          "city": "{{city}}"
        },
        "headers": {
          "Accept": "application/json"
        }
      },
      "response": {
        "pick": ["city", "weather", "temperature"],
        "maxLength": 2000
      },
      "stopOnFailure": true
    }
  ]
}
```

## 安全建议

- 优先填写 `allowedHosts`，限制工具只能访问指定域名。
- 不要把密钥直接写进公开文档。
- 返回值尽量使用 `pick` 和 `maxLength` 裁剪。
- 外部接口失败时建议 `stopOnFailure: true`，避免同一轮对话重复请求。
- 对价格、医疗、法律、金融等高风险信息，建议让 AI 明确提示“仅供参考”。

## 常见问题

### 工具没有被调用

检查：

- Skills 总开关是否开启。
- 对应 Skill 和 Tool 是否开启。
- 主模型是否支持工具调用。
- 工具描述是否清楚表达使用场景。

### 工具调用失败

检查：

- 接口地址是否可访问。
- 参数是否完整。
- `allowedHosts` 是否包含目标域名。
- 接口是否需要密钥或有频率限制。
- 控制台“查看工具调用”里记录的错误原因。

### 返回内容太长

建议：

- 使用 `response.pick` 只保留关键字段。
- 调小 `response.maxLength`。
- 避免把大列表、全文正文或无关字段直接返回给 AI。

## 推荐接入方向

适合优先补充：

- 空气质量、城市坐标、海拔。
- 开源包和安全风险查询。
- npm、PyPI、Stack Overflow、Hacker News。
- 英文词典、同义词、短句翻译。
- 动漫、游戏折扣、航天发射。
- 食品条形码、化合物基础信息。

候选能力清单见 `skill-candidates/` 目录。
