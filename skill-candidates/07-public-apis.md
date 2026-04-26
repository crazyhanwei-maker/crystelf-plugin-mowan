# 公开接口候选实测

更新时间：2026-04-27

本文件记录一批适合转成 `HTTP skills` 的公开接口。筛选规则：

- 优先免登录、免 API Key、结构化 JSON。
- 已通过 bot 所在 VPS 直接 `curl` 连通性测试。
- 避免与当前已接入能力完全重复。
- 默认只记录适合单次 HTTP 请求返回的接口。

## 推荐优先接入

| 优先级 | 推荐 skill | 接口 | VPS 状态 | 适合场景 |
| --- | --- | --- | --- | --- |
| A | `air-quality` | Open-Meteo Air Quality | 200 | 查 PM2.5、PM10、臭氧、花粉、欧洲 AQI/US AQI |
| A | `geo` | Open-Meteo Geocoding / Elevation | 200 | 城市转坐标、查海拔，给空气质量和路线工具做前置 |
| A | `security` | NVD CVE API | 200 | 按关键词查 CVE、漏洞编号、CVSS、发布日期 |
| A | `security` | OSV API | 200 | 查 npm/PyPI/Maven/Go 等开源包漏洞 |
| A | `developer` | npm Registry Search / Package / Downloads | 200 | 查 npm 包简介、版本、下载量、维护信息 |
| A | `developer` | PyPI JSON API | 200 | 查 Python 包版本、简介、发布文件、项目链接 |
| A | `developer` | Stack Exchange API | 200 | 查 Stack Overflow 问题、标签、回答数、链接 |
| A | `developer-news` | Hacker News Firebase API | 200 | 查 HN 热门技术新闻和单条详情 |
| A | `chemistry` | PubChem PUG REST | 200 | 查化合物 CID、分子式、分子量、SMILES、IUPAC 名称 |
| A | `food` | Open Food Facts API v2 | 200 | 按条形码查食品名称、品牌、营养等级、配料 |
| A | `dictionary` | dictionaryapi.dev | 200 | 英文单词释义、音标、例句 |
| A | `word-relations` | Datamuse API | 200 | 同义词、押韵词、相关词、词频联想 |
| A | `anime` | Jikan API | 200 | 查动漫、角色、评分、集数、年份 |
| A | `games-deals` | CheapShark API | 200 | 查 PC 游戏折扣、历史低价、商店价格 |
| B | `bio` | GBIF Species / Occurrence | 200 | 查物种分类、分布记录、学名 |
| B | `academic` | DBLP / Crossref / Europe PMC / ROR | 200 | 查论文、DOI、作者机构、机构信息 |
| B | `space` | NASA Images / EONET / Launch Library / SpaceX / ISS | 200 | 查 NASA 图片、自然事件、航天发射、ISS 位置 |
| B | `media` | MusicBrainz / TVMaze | 200 | 查音乐人、专辑、影视剧集资料 |
| B | `health` | ClinicalTrials / OpenFDA / RxNorm / WHO GHO | 200 | 查临床试验、FDA 召回、药品编码、WHO 指标；需要加医疗免责声明 |
| B | `trivia` | Open Trivia DB / JokeAPI / PokeAPI | 200 | 群聊互动、问答、宝可梦资料 |

## 暂缓接入

| 接口 | VPS 状态 | 暂缓原因 |
| --- | --- | --- |
| Wikipedia / Wikidata | 超时 | 与之前 `wiki` 默认关闭原因一致，远端网络不稳 |
| Open Library | 超时 | 远端访问不稳，`books` 已默认关闭 |
| arXiv API | 超时 | 可用 DBLP / OpenAlex / Europe PMC 替代 |
| GDELT DOC API | 超时 | 新闻检索不适合默认启用 |
| Internet Archive | 超时 | 远端连通性差 |
| CoinGecko | 超时 | 远端连通性差，且价格类能力需要谨慎提示 |
| Google Books | 超时 | 远端访问 `googleapis.com` 不稳定 |
| Steam Store API | 超时 | 远端访问不稳，可先用 CheapShark |
| Nominatim | 超时 | OpenStreetMap geocoding 不可用；城市坐标用 Open-Meteo 替代 |
| Open Brewery DB | TLS reset | 不建议接入 |
| ReliefWeb v2 | 403 | 需要申请 approved appname |
| GeoDB Cities | 401 | RapidAPI Key 必需 |
| balldontlie | 404 | 免费旧接口不可直接用 |

## 下一批建议

如果控制默认工具数量，建议先加 6 组：

1. `air-quality`：Open-Meteo `search` + `air-quality`
2. `security`：NVD `cves/2.0` + OSV `query`
3. `developer`：npm、PyPI、Stack Exchange、Hacker News
4. `dictionary`：dictionaryapi.dev + Datamuse
5. `chemistry`：PubChem compound property
6. `food`：Open Food Facts barcode lookup

如果还想增强群聊趣味和资讯，再加：

7. `anime`：Jikan search
8. `games-deals`：CheapShark deals
9. `space`：NASA Images、EONET、ISS、Launch Library
10. `bio`：GBIF species search

## 参考文档

- Open-Meteo Air Quality: https://open-meteo.com/en/docs/air-quality-api
- Open-Meteo Geocoding: https://open-meteo.com/en/docs/geocoding-api
- NVD CVE API: https://nvd.nist.gov/developers/vulnerabilities
- OSV API: https://google.github.io/osv.dev/api/
- npm Registry API: https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md
- PyPI JSON API: https://docs.pypi.org/api/json/
- Stack Exchange API: https://api.stackexchange.com/docs
- Hacker News API: https://github.com/HackerNews/API
- PubChem PUG REST: https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest
- Open Food Facts API: https://openfoodfacts.github.io/openfoodfacts-server/api/
- dictionaryapi.dev: https://dictionaryapi.dev/
- Datamuse API: https://www.datamuse.com/api/
- Jikan API: https://docs.api.jikan.moe/
- CheapShark API: https://apidocs.cheapshark.com/
- GBIF API: https://techdocs.gbif.org/en/openapi/
- DBLP API: https://dblp.org/faq/13501473.html
- Crossref REST API: https://www.crossref.org/documentation/retrieve-metadata/rest-api/
- Europe PMC REST API: https://europepmc.org/RestfulWebService
- ROR API: https://ror.readme.io/docs/rest-api
- NASA Images API: https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf
- NASA EONET API: https://eonet.gsfc.nasa.gov/docs/v3
- Launch Library API: https://thespacedevs.com/llapi
- SpaceX API: https://github.com/r-spacex/SpaceX-API
- MusicBrainz API: https://musicbrainz.org/doc/MusicBrainz_API
- TVMaze API: https://www.tvmaze.com/api
