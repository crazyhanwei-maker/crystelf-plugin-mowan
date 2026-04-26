# Network Candidates

## 1. UAPI IP 信息查询

- 优先级：`A`
- 文档：<https://uapis.cn/docs/api-reference/get-network-ipinfo>
- 方法：`GET`
- 接口：`https://uapis.cn/api/v1/network/ipinfo`
- 鉴权：标准模式免 key；`source=commercial` 属于 Pro，不建议默认接
- 核心参数：`ip`
- 成功响应核心字段：`ip`、`region`、`isp`、`llc`、`asn`、`latitude`、`longitude`
- 适合原因：查 IP 或域名来源、运营商、ASN、经纬度，非常适合群聊问答和控制台诊断
- 风险 / 限制：私网 IP 或未分配地址会返回未找到
- 推荐命名：`network.get_ipinfo`

## 2. RDAP.org

- 优先级：`A`
- 文档：<https://about.rdap.org/> ｜ <https://www.icann.org/rdap/>
- 方法：`GET`
- 接口：`https://rdap.org/domain/{domain}`
- 鉴权：无
- 核心参数：路径参数 `domain`
- 成功响应核心字段：`objectClassName`、`ldhName`、`status`、`nameservers`、`entities`、`events`
- 适合原因：它是标准化 JSON 域名注册数据，明显比原始 WHOIS 文本更适合当前 skill 框架
- 风险 / 限制：会跳转到各注册局；有频率限制；部分字段会因隐私策略被脱敏
- 推荐命名：`whois.get_domain_rdap`

## 3. Google Public DNS JSON API

- 优先级：`A`
- 文档：<https://developers.google.com/speed/public-dns/docs/doh/json>
- 方法：`GET`
- 接口：`https://dns.google/resolve`
- 鉴权：无
- 核心参数：`name`
- 常用可选：`type`
- 成功响应核心字段：`Status`、`Question`、`Answer`、`Authority`、`AD`、`CD`
- 适合原因：做 DNS 查询最稳，字段结构天然适合做 `response.pick`
- 风险 / 限制：更偏原始 DNS 结果，接入时建议再做一层摘要；大陆部署环境需测连通性
- 推荐命名：`dns.resolve_record`

## 4. UAPI 手机归属地

- 优先级：`A`
- 文档：<https://uapis.cn/docs/api-reference/get-misc-phoneinfo>
- 方法：`GET`
- 接口：`https://uapis.cn/api/v1/misc/phoneinfo`
- 鉴权：免 key
- 核心参数：`phone`
- 成功响应核心字段：`province`、`city`、`sp`
- 适合原因：用户很常问手机号归属地和运营商，结构也非常简单
- 风险 / 限制：只支持 11 位中国大陆手机号
- 推荐命名：`phone.get_phoneinfo`

## 5. UAPI ICP 备案查询

- 优先级：`A`
- 文档：<https://uapis.cn/docs/api-reference/get-network-icp>
- 方法：`GET`
- 接口：`https://uapis.cn/api/v1/network/icp`
- 鉴权：免 key
- 核心参数：`domain`
- 成功响应核心字段：`domain`、`natureName`、`serviceLicence`、`unitName`
- 适合原因：查网站主体、做站点背景核验、机器人识别站点可信度都很实用
- 风险 / 限制：仅适用于中国大陆备案域名
- 推荐命名：`network.get_icp`

## 6. UAPI WHOIS 查询

- 优先级：`A`
- 文档：<https://uapis.cn/docs/api-reference/get-network-whois>
- 方法：`GET`
- 接口：`https://uapis.cn/api/v1/network/whois`
- 鉴权：免 key
- 核心参数：`domain`
- 可选参数：`format=json`
- 成功响应核心字段：`whois.domain`、`whois.registrar`、`whois.registrant`、`created_date`、`expiration_date`
- 适合原因：适合查域名注册信息、到期时间、注册商，适配站点分析和控制台工具
- 风险 / 限制：不同注册局字段差异较大；建议只在 `format=json` 模式下接入
- 推荐命名：`network.get_whois`

## 7. UAPI URL 状态检查

- 优先级：`A`
- 文档：<https://uapis.cn/docs/api-reference/get-network-urlstatus>
- 方法：`GET`
- 接口：`https://uapis.cn/api/v1/network/urlstatus`
- 鉴权：免 key
- 核心参数：`url`
- 成功响应核心字段：`status`、`url`
- 适合原因：非常适合控制台链路检测，也适合 AI 回答“这个地址能不能打开”
- 风险 / 限制：只能给出可达性和 HTTP 状态，不能替代正文抓取
- 推荐命名：`network.check_url_status`

## 备选

- UAPI DNS 查询：<https://uapis.cn/docs/api-reference/get-network-dns>
- UAPI 检查域名在微信中的访问状态：<https://uapis.cn/docs/api-reference/get-network-wxdomain>
- UAPI 查询我的 IP：<https://uapis.cn/docs/api-reference/get-network-myip>

## 这一组建议先接入

1. `network.get_ipinfo`
2. `whois.get_domain_rdap`
3. `dns.resolve_record`
4. `network.get_icp`
5. `network.check_url_status`
