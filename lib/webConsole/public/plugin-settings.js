const pluginSettingsState = {
  payload: null,
  draft: {},
  skillsDraft: null,
  skillsExpanded: (() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('crystelf-plugin-settings-skills-expanded') || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  })(),
  skillsFilter: localStorage.getItem('crystelf-plugin-settings-skills-filter') || 'all',
  skillsSearchKeyword: localStorage.getItem('crystelf-plugin-settings-skills-search') || '',
  skillsEditorPayload: null,
  skillsEditorText: '',
  skillsEditorSource: 'effective',
  skillsEditorStatus: '',
  activeCategory: 'main',
  activeGroup: '',
  activeTopTab: 'plugin-settings-config-panel',
  overview: null,
  editableConfig: null,
  navCollapsed: localStorage.getItem('crystelf-plugin-settings-nav-collapsed') === 'true',
  searchKeyword: '',
  knowledgeGenerateQuery: '',
  knowledgeGenerateLoading: false,
  knowledgeGenerateStatus: '',
  knowledgeGenerateSources: [],
  knowledgeGeneratePreview: '',
  knowledgeGenerateMode: 'replace',
  knowledgeHistory: [],
  knowledgeSelectedPreviewIds: [],
  knowledgeHistoryPreviewId: '',
  recommendationStatus: '',
  recommendationUndo: null,
  featureManageStatus: '',
  featureManageHistory: [],
  helpPreviewDataUrl: '',
  helpPreviewStatus: '',
  authStatus: null,
};

if (window.matchMedia?.('(max-width: 900px)').matches) {
  pluginSettingsState.navCollapsed = true;
}

let pluginSettingsSkillsLayoutObserver = null;

const KNOWLEDGE_HISTORY_STORAGE_KEY = 'crystelf-knowledge-history';
const FEATURE_MANAGE_HISTORY_STORAGE_KEY = 'crystelf-feature-manage-history';
const SKILLS_FILTER_STORAGE_KEY = 'crystelf-plugin-settings-skills-filter';
const SKILLS_EXPANDED_STORAGE_KEY = 'crystelf-plugin-settings-skills-expanded';
const SKILLS_SEARCH_STORAGE_KEY = 'crystelf-plugin-settings-skills-search';

const GROUP_DESCRIPTIONS = {
  '常用功能开关': '这里放最常开关的功能入口，适合先快速决定这个插件要启用哪些核心能力。',
  '本群管理': '这里主要是进群、验证、欢迎这类和群成员管理有关的功能。',
  '群管理相关': '这里主要是进群、验证、欢迎这类和群成员管理有关的功能。',
  '内容与娱乐': '这里是订阅、点歌、日报等偏内容消费和娱乐互动的功能。',
  '戳一戳回复设置': '这里集中管理机器人被戳之后的回复策略。',
  '基础回复方式': '先决定戳一戳默认回文字、表情包还是语音。',
  '多媒体回复': '这里控制表情包和语音这类更有表现力的回复方式。',
  '频率与限制': '这里控制冷却、限频和单次最多回复多少条，避免刷屏。',
  '追踪接话': '这里决定机器人回复后，要不要继续观察后续群聊并按上下文自主接话。',
  '回复风格与渲染': '这里集中管理回复气质、适用群范围，以及代码和 Markdown 的展示效果。',
  '本地控制台设置': '这里是网页后台本身的相关设置。',
  '访问与安全': '这里控制后台能不能访问、是否需要登录、是否只读。',
  '网络与分页': '这里控制后台监听地址、端口和列表分页规模。',
  '日志与展示': '这里控制日志是否展示，以及后台各类详情页展示多少内容。',
  '插件维护': '这里是偏维护和调试用途的配置，普通用户一般不需要频繁改。',
  '基础设置': '这里是 AI 的基础接入信息，比如模型、接口和最基本的聊天参数。',
  '对话与会话': '这里控制聊天上下文、会话数量、历史抓取和回复相关的基础行为。',
  '故障降级': '这里设置 AI 出错、超时或联网失败时的兜底回复文案。',
  '知识库与人设': '这里决定 AI 的人设语气，以及本地知识库怎么参与回答。',
  '表情与多模态': '这里配置表情包、多模态识图和图片相关能力。',
  '高级设置': '这里放图片生成、辅助模型和其他偏进阶的 AI 能力。',
};

const GROUP_RECOMMENDATIONS = {
  '基础回复方式': '新手建议先开启文本回复，等基础效果稳定后再逐步加语音或表情包。',
  '多媒体回复': '建议先把表情包概率、语音概率调低一些，确认群里效果自然后再慢慢提高。',
  '频率与限制': '建议保留冷却和群限频，能明显减少刷屏和高频触发。',
  '追踪接话': '建议先把继续监听时长设短一些、观察条数设低一些，先观察真实群聊效果。',
  '回复风格与渲染': '建议先只调整回复风格和群范围；代码与 Markdown 渲染项更适合有明确展示需求时再改。',
  '访问与安全': '建议开启登录鉴权；如果只是自己本机调试，可以再决定要不要关闭只读模式。',
  '网络与分页': '如果只是个人调试，保持默认端口和分页通常就够用。',
  '对话与会话': '新手建议先保持默认会话上限和历史长度，先观察机器人在群里的响应是否稳定。',
  '故障降级': '建议先至少填一条通用失败回复；想更自然的话，再分别配置联网失败和超时失败。',
  '知识库与人设': '建议先写清楚机器人人设，再逐步补充知识库内容，不要一开始就塞太多长文本。',
  '表情与多模态': '如果模型成本敏感，建议先关闭多模态，确认纯文本效果后再打开。',
  '高级设置': '这一组更适合熟悉插件后再调整，初次使用可以先保持默认值。',
};

const FIELD_RECOMMENDATIONS = {
  'poke.enableTextReply': '推荐：开启',
  'poke.memeReplyProbability': '推荐：0.2 ~ 0.35',
  'poke.voiceReplyProbability': '推荐：0.1 ~ 0.25',
  'poke.cooldownMs': '推荐：15000',
  'poke.groupRateWindowMs': '推荐：60000',
  'poke.groupRateMaxReplies': '推荐：6',
  'poke.maxReplyMessages': '推荐：1 ~ 2',
  'poke.followGroupWindowMs': '推荐：5000 ~ 10000',
  'poke.followGroupMaxReplies': '推荐：1',
  'config.webConsoleReadOnly': '推荐：按需开启',
  'config.webConsolePort': '推荐：27891',
  'config.webConsolePageSize': '推荐：20',
  'config.webConsoleMaxPageSize': '推荐：100',
  'ai.temperature': '推荐：0.8 ~ 1.0',
  'ai.maxSessions': '推荐：10 ~ 20',
  'ai.fallbackGenericReply': '推荐：至少填写 1 条',
  'ai.knowledgeTopK': '推荐：3',
  'ai.character': '推荐：按当前表情包资源选择',
  'ai.multimodalEnabled': '推荐：按模型成本决定',
};

const FIELD_RECOMMENDATION_VALUES = {
  'poke.enableTextReply': true,
  'poke.memeReplyProbability': 0.3,
  'poke.voiceReplyProbability': 0.2,
  'poke.cooldownMs': 15000,
  'poke.groupRateWindowMs': 60000,
  'poke.groupRateMaxReplies': 6,
  'poke.maxReplyMessages': 2,
  'poke.followGroupWindowMs': 8000,
  'poke.followGroupMaxReplies': 1,
  'config.webConsoleReadOnly': true,
  'config.webConsolePort': 27891,
  'config.webConsolePageSize': 20,
  'config.webConsoleMaxPageSize': 100,
  'ai.temperature': 0.9,
  'ai.maxSessions': 15,
  'ai.knowledgeTopK': 3,
};

const SKILL_GUIDE_MAP = {
  weather: {
    scene: '生活查询',
    recommendation: '建议常开',
    recommendationTone: 'success',
    summary: '天气、降雨、逐小时和生活指数都属于群里高频即时查询。',
    when: '问天气、预报、下雨、温度、风力时优先使用',
    caution: '适合自动加载，属于低风险日常技能',
    examples: ['北京明天会下雨吗', '杭州现在多少度', '今天适合洗车吗'],
    priority: 120,
  },
  tracking: {
    scene: '物流查询',
    recommendation: '建议常开',
    recommendationTone: 'success',
    summary: '快递单号识别和物流轨迹属于明确需求，命中后很好用。',
    when: '问快递到哪了、单号是什么公司时优先使用',
    caution: '适合自动加载，返回结构稳定',
    examples: ['帮我查这个快递到哪了', '这个单号是什么快递公司', '顺丰现在派送到哪一步了'],
    priority: 115,
  },
  hotboard: {
    scene: '热榜资讯',
    recommendation: '建议常开',
    recommendationTone: 'success',
    summary: '适合实时热搜、平台热榜、天气预警和地震类榜单查询。',
    when: '问热搜、热榜、热门平台排行时优先使用',
    caution: '比通用搜索更快，但只覆盖榜单型问题',
    examples: ['微博热搜前十是什么', 'B站今天热榜', '看看现在有没有地震预警'],
    priority: 110,
  },
  calendar: {
    scene: '日期节气',
    recommendation: '建议常开',
    recommendationTone: 'success',
    summary: '节假日、农历、黄历、节气这类问题走结构化接口更稳。',
    when: '问节假日、农历、黄历、今日宜忌时优先使用',
    caution: '适合自动加载，适用面稳定',
    examples: ['下周一放假吗', '今天农历几号', '明天宜不宜搬家'],
    priority: 105,
  },
  webparse: {
    scene: '链接解析',
    recommendation: '建议常开',
    recommendationTone: 'success',
    summary: '适合解析链接标题、摘要、图标和页面图片，不必每次都抓整页。',
    when: '用户发链接想看预览或页面图片时优先使用',
    caution: '正文摘要仍应按需走 fetch_web_markdown',
    examples: ['这个链接讲了什么', '帮我看看这个网页标题', '提取这页里的图片'],
    priority: 100,
  },
  'air-quality': {
    scene: '空气质量',
    recommendation: '按需开启',
    recommendationTone: 'info',
    summary: '适合查询城市坐标、PM2.5、PM10、臭氧、花粉、UV 和 AQI。',
    when: '问空气质量、污染指数、花粉、紫外线时使用',
    caution: '城市名会先转坐标，再按经纬度查询空气质量',
    examples: ['北京现在 PM2.5 多少', '上海今天空气质量怎么样', '东京花粉指数高吗'],
    priority: 94,
  },
  security: {
    scene: '漏洞安全',
    recommendation: '按需开启',
    recommendationTone: 'warning',
    summary: '适合查 CVE、CVSS、NVD 漏洞详情和 OSV 开源包漏洞。',
    when: '问某个 CVE、软件漏洞或 npm/PyPI 包漏洞时使用',
    caution: '安全结论要结合版本、部署环境和官方公告，不要只凭接口结果下定论',
    examples: ['查一下 CVE-2024-3094', 'axios 有哪些已知漏洞', 'openssl 最近有什么高危漏洞'],
    priority: 92,
  },
  developer: {
    scene: '开发资料',
    recommendation: '按需开启',
    recommendationTone: 'info',
    summary: '补充 npm、PyPI、Stack Overflow 和 Hacker News 这类开发者常用信息。',
    when: '问包版本、下载量、技术问答、HN 热门技术新闻时使用',
    caution: '和搜索能力互补，适合结构化查包和问答链接',
    examples: ['axios 最新 npm 版本是多少', 'requests 支持哪些 Python 版本', 'HN 现在热门技术新闻'],
    priority: 90,
  },
  dictionary: {
    scene: '英文词典',
    recommendation: '按需开启',
    recommendationTone: 'info',
    summary: '适合英文单词释义、音标、例句、近义词、押韵词和联想词。',
    when: '问英文单词什么意思、怎么押韵、找近义词时使用',
    caution: '主要面向英文，中文词语仍应走通用回答或搜索',
    examples: ['serendipity 是什么意思', 'happy 的近义词', 'time 有哪些押韵词'],
    priority: 88,
  },
  chemistry: {
    scene: '化合物',
    recommendation: '按需开启',
    recommendationTone: 'info',
    summary: '适合从 PubChem 查询分子式、分子量、SMILES 和 IUPAC 名称。',
    when: '问化合物基础属性、药品成分或分子信息时使用',
    caution: '这是化学资料查询，不应替代医学或用药建议',
    examples: ['阿司匹林分子式是什么', 'caffeine 的分子量', 'glucose 的 SMILES'],
    priority: 86,
  },
  food: {
    scene: '食品条码',
    recommendation: '按需开启',
    recommendationTone: 'info',
    summary: '适合按包装食品条形码查名称、品牌、配料、营养等级和营养成分。',
    when: '用户给食品条形码并想查食品信息时使用',
    caution: '数据库覆盖依赖 Open Food Facts，国内小众商品可能缺失',
    examples: ['查一下 3017624010701 是什么食品', '这个条码的配料是什么', '这个食品 Nutri-Score 几级'],
    priority: 84,
  },
  anime: {
    scene: '动漫资料',
    recommendation: '按需开启',
    recommendationTone: 'info',
    summary: '适合查动漫标题、评分、集数、年份、播出状态和简介。',
    when: '问番剧资料、评分、集数、播出状态时使用',
    caution: '数据来自 Jikan / MyAnimeList，中文别名可能需要先用英文或罗马音检索',
    examples: ['葬送的芙莉莲评分多少', 'Frieren 有多少集', '查一下这部番的简介'],
    priority: 82,
  },
  'games-deals': {
    scene: '游戏折扣',
    recommendation: '按需开启',
    recommendationTone: 'info',
    summary: '适合查 PC 游戏当前折扣、价格、历史低价和 CheapShark 游戏条目。',
    when: '问某个 PC 游戏哪里便宜、有没有打折时使用',
    caution: '价格以 CheapShark 数据源为准，购买前仍应确认地区和商店',
    examples: ['Portal 现在哪里最便宜', 'Hades 最近有折扣吗', '查一下 Stardew Valley 历史低价'],
    priority: 80,
  },
  space: {
    scene: '航天自然',
    recommendation: '按需开启',
    recommendationTone: 'info',
    summary: '包含 NASA 图片、EONET 自然事件、ISS 当前位置和近期航天发射。',
    when: '问 NASA 图片、国际空间站、火箭发射或当前自然事件时使用',
    caution: '部分结果为英文原始资料，回答时需要提炼成中文',
    examples: ['国际空间站现在在哪', '最近有哪些火箭发射', '找几张 NASA 火星图片'],
    priority: 78,
  },
  bio: {
    scene: '物种资料',
    recommendation: '按需开启',
    recommendationTone: 'info',
    summary: '适合查 GBIF 物种分类、学名、同物异名和分布记录。',
    when: '问某个物种的学名、分类或出现记录时使用',
    caution: '分布记录来自开放数据集，回答时要说明可能不是完整分布范围',
    examples: ['大熊猫的学名是什么', '查一下 panda 的物种分类', 'Ailuropoda melanoleuca 有哪些记录'],
    priority: 76,
  },
  translate: {
    scene: '文本翻译',
    recommendation: '按需开启',
    recommendationTone: 'info',
    summary: '短文本翻译很直接，但不是每个群都高频需要。',
    when: '问某句怎么翻、需要多语言互译时使用',
    caution: '更适合短句和明确翻译任务',
    examples: ['把这句翻成日语', '这段英文翻成中文', '帮我翻译成韩语'],
    priority: 85,
  },
  'external-api': {
    scene: '开发检索',
    recommendation: '按需开启',
    recommendationTone: 'info',
    summary: '适合 GitHub 仓库详情、发布、提交、论文检索和汇率查询。',
    when: '问项目仓库状态、学术论文或汇率时优先使用',
    caution: '普通闲聊群不一定高频，建议按需启用',
    examples: ['这个 GitHub 仓库最近有更新吗', '搜几篇 RAG 论文', '美元兑人民币现在多少'],
    priority: 82,
  },
  youtube: {
    scene: '视频链接',
    recommendation: '按需开启',
    recommendationTone: 'info',
    summary: '专门补充 YouTube 链接的标题、作者和缩略图信息。',
    when: '用户贴 YouTube 链接并想快速看视频信息时使用',
    caution: '只保留了公开视频元信息，不处理字幕和 InnerTube 细节',
    examples: ['这个 YouTube 链接是什么视频', '看看这个视频是谁发的', '给我这条视频的缩略图'],
    priority: 78,
  },
  network: {
    scene: '网络诊断',
    recommendation: '按需开启',
    recommendationTone: 'warning',
    summary: '适合 IP、DNS、RDAP、ICP备案和 URL 状态等明确技术查询。',
    when: '问域名、IP、DNS、备案、URL 可达性时使用',
    caution: '普通群聊不高频，建议按需开启',
    examples: ['查一下这个域名的解析', '这个网址能打开吗', '看看这个 IP 是哪里的'],
    priority: 74,
  },
  social: {
    scene: '社媒资料',
    recommendation: '按需开启',
    recommendationTone: 'info',
    summary: '适合 B 站视频、直播间、用户资料和 GitHub 仓库基础信息。',
    when: '问 B 站内容或社媒资料时使用',
    caution: '与其他信息技能有一定交叉，建议按需开启',
    examples: ['查一下这个 BV 号', '这个 B站主播开播了吗', '看看这个 B站用户资料'],
    priority: 70,
  },
  game: {
    scene: '游戏查询',
    recommendation: '按需开启',
    recommendationTone: 'info',
    summary: '适合 Epic 免费游戏、Minecraft 和 Steam 玩家摘要。',
    when: '问游戏服务器状态或玩家信息时使用',
    caution: '垂直场景明显，不建议无脑常开',
    examples: ['Epic 这周送什么游戏', '查一下这个 MC 服务器在线没', '看看这个 Steam 玩家信息'],
    priority: 68,
  },
  'misc-extra': {
    scene: '实用补充',
    recommendation: '按需开启',
    recommendationTone: 'info',
    summary: '补充世界时间、手机号归属地、行政区划和历史上的今天。',
    when: '问时区、归属地、区划或程序员历史话题时使用',
    caution: '用途分散，适合需要时再开',
    examples: ['纽约现在几点', '这个手机号是哪里的', '程序员历史上的今天发生了什么'],
    priority: 64,
  },
  text: {
    scene: '文本安全',
    recommendation: '按需开启',
    recommendationTone: 'warning',
    summary: '偏敏感词检测和文本安全，不是日常闲聊的高频刚需。',
    when: '明确需要做文本安全检查时使用',
    caution: '不要把它当通用聊天能力，适用面较窄',
    examples: ['帮我检查这段话有没有敏感词', '这句内容适不适合发', '快速扫一下文本风险'],
    priority: 60,
  },
};

const SKILL_PRESET_MAP = {
  daily: {
    label: '补齐日常查询',
    skills: ['weather', 'tracking', 'hotboard', 'calendar', 'webparse'],
  },
  research: {
    label: '补齐开发检索',
    skills: ['translate', 'external-api', 'youtube', 'network', 'misc-extra'],
  },
};

const SKILL_FILTER_MAP = {
  all: {
    label: '全部',
  },
  enabled: {
    label: '已开启',
  },
  disabled: {
    label: '未开启',
  },
  customized: {
    label: '已自定义',
  },
  recommended: {
    label: '建议常开',
  },
  daily: {
    label: '日常查询',
  },
  research: {
    label: '开发检索',
  },
};

function normalizeSkillFilterValue(value) {
  const normalized = String(value || '').trim();
  return Object.prototype.hasOwnProperty.call(SKILL_FILTER_MAP, normalized) ? normalized : 'all';
}

pluginSettingsState.skillsFilter = normalizeSkillFilterValue(pluginSettingsState.skillsFilter);

const BUNDLED_SKILL_FALLBACK_CONFIG = {
  enabled: true,
  autoLoad: true,
  defaultTimeoutMs: 15000,
  previewOnly: true,
  previewReason: '当前控制台后端没有返回 Skills 列表，已改用前端内置目录预览。',
  definitions: [
    { name: 'weather', enabled: true, description: 'UAPI 天气查询，使用免登录免积分模式' },
    { name: 'tracking', enabled: true, description: 'UAPI 快递工具，使用免登录免积分模式，支持物流查询、快递公司识别和公司列表读取' },
    { name: 'hotboard', enabled: true, description: 'UAPI 热榜查询，使用免登录免积分模式，适合获取主流平台实时热榜' },
    { name: 'calendar', enabled: true, description: 'UAPI 日历时间工具，使用免登录免积分模式，支持节假日与农历时间查询' },
    { name: 'webparse', enabled: true, description: 'UAPI 网页解析工具，使用免登录免积分模式，适合做轻量链接预览和网页图片提取' },
    { name: 'air-quality', enabled: false, description: 'Open-Meteo 空气质量工具，适合查询 PM2.5、PM10、臭氧、花粉、AQI 和城市坐标' },
    { name: 'security', enabled: false, description: '公开漏洞查询工具，包含 NVD CVE 和 OSV 开源包漏洞查询' },
    { name: 'developer', enabled: false, description: '开发者信息工具，包含 npm、PyPI、Stack Overflow 和 Hacker News 查询' },
    { name: 'dictionary', enabled: false, description: '英文词典与词语关系工具，包含单词释义、近义词、押韵词和联想词' },
    { name: 'chemistry', enabled: false, description: 'PubChem 化合物查询工具，适合查询分子式、分子量、SMILES 和 IUPAC 名称' },
    { name: 'food', enabled: false, description: 'Open Food Facts 食品条形码查询工具，适合查询品牌、配料、营养等级和营养成分' },
    { name: 'anime', enabled: false, description: 'Jikan 动漫资料查询工具，适合查询动漫标题、评分、集数、年份和简介' },
    { name: 'games-deals', enabled: false, description: 'CheapShark 游戏折扣查询工具，适合查询 PC 游戏当前折扣和历史低价' },
    { name: 'space', enabled: false, description: '航天与自然事件工具，包含 NASA 图片、EONET 自然事件、ISS 位置和航天发射' },
    { name: 'bio', enabled: false, description: 'GBIF 物种与分布记录查询工具，适合查询学名、分类和物种出现记录' },
    { name: 'translate', enabled: false, description: '轻量翻译工具，适合短文本多语言互译' },
    { name: 'external-api', enabled: false, description: '开发者与学术检索工具，包含 GitHub 仓库详情、搜索、提交、发布、论文与汇率查询' },
    { name: 'youtube', enabled: false, description: 'YouTube 视频信息工具，适合从公开视频链接提取标题、作者和缩略图' },
    { name: 'network', enabled: false, description: '网络诊断与域名信息工具，包含 IP 查询、RDAP、DNS、ICP备案与 URL 状态检查' },
    { name: 'social', enabled: false, description: '社交与开发者资料工具，包含 B站视频/直播/用户信息与 GitHub 仓库信息' },
    { name: 'game', enabled: false, description: '游戏信息工具，包含 Epic 免费游戏、Minecraft 服务器/玩家信息与 Steam 玩家摘要' },
    { name: 'misc-extra', enabled: false, description: '扩展实用工具，包含世界时间、手机号归属地、行政区划与程序员历史上的今天' },
    { name: 'text', enabled: false, description: '文本安全工具，包含敏感词快速检测' },
  ].map((item) => ({
    ...item,
    timeoutMs: 15000,
    toolCount: 0,
    enabledToolCount: 0,
    allowedHosts: [],
    origin: 'builtin',
    customized: false,
    tools: [],
  })),
};

function isRecommendationMatched(field, value) {
  if (!Object.prototype.hasOwnProperty.call(FIELD_RECOMMENDATION_VALUES, field)) {
    return false;
  }
  const expected = FIELD_RECOMMENDATION_VALUES[field];
  if (typeof expected === 'number') {
    return Number(value) === expected;
  }
  if (typeof expected === 'boolean') {
    return Boolean(value) === expected;
  }
  if (Array.isArray(expected)) {
    return JSON.stringify(value || []) === JSON.stringify(expected);
  }
  return String(value ?? '') === String(expected);
}

function renderFieldHead(item, typeLabel) {
  const recommendation = FIELD_RECOMMENDATIONS[item.field];
  const canApplyRecommendation = Object.prototype.hasOwnProperty.call(FIELD_RECOMMENDATION_VALUES, item.field);
  const currentValue = pluginSettingsState.draft[item.field];
  const matched = isRecommendationMatched(item.field, currentValue);
  return `
    <div class="plugin-settings-field-head">
      <div class="kv-label">${escapeHtml(item.label)}</div>
      <div class="plugin-settings-field-tags">
        ${recommendation ? `<button type="button" class="tag ${matched ? 'plugin-settings-recommendation-tag matched' : 'plugin-settings-recommendation-tag'}" data-apply-recommendation="${escapeHtml(item.field)}" ${canApplyRecommendation ? '' : 'disabled'}>${escapeHtml(matched ? `${recommendation} · 已命中` : recommendation)}</button>` : ''}
        <span class="tag">${escapeHtml(typeLabel)}</span>
      </div>
    </div>
  `;
}

function getFieldTone(item) {
  const field = String(item.field || '').toLowerCase();
  const fieldName = field.split('.').pop() || '';
  if (item.readonly) return 'readonly';
  if (
    item.component === 'InputPassword' ||
    fieldName.endsWith('token') ||
    fieldName.endsWith('apikey') ||
    fieldName.endsWith('password') ||
    fieldName.endsWith('secret')
  ) {
    return 'danger';
  }
  if (Object.prototype.hasOwnProperty.call(FIELD_RECOMMENDATION_VALUES, item.field)) return 'recommended';
  return 'normal';
}

function renderFieldMeta(item) {
  const tone = getFieldTone(item);
  const toneLabelMap = {
    readonly: '只读字段',
    danger: '敏感字段',
    recommended: '推荐字段',
    normal: '普通字段',
  };
  return `
    <div class="plugin-settings-field-meta">
      <span class="plugin-settings-field-path">${escapeHtml(item.field || '')}</span>
      <span class="plugin-settings-field-tone plugin-settings-field-tone-${tone}">${escapeHtml(toneLabelMap[tone])}</span>
    </div>
  `;
}

function renderFieldNotice(item) {
  const tone = getFieldTone(item);
  if (tone === 'danger') {
    return '<div class="plugin-settings-field-notice plugin-settings-field-notice-danger">该字段包含登录口令或其他敏感凭证，建议仅在可信环境下修改，并避免直接展示给其他人。</div>';
  }
  if (tone === 'recommended') {
    const recommendation = FIELD_RECOMMENDATIONS[item.field] || '建议优先使用推荐值';
    return `<div class="plugin-settings-field-notice plugin-settings-field-notice-recommended">${escapeHtml(recommendation)}</div>`;
  }
  return '';
}

function buildFieldCardClasses(item, matched = false, extra = '') {
  const tone = getFieldTone(item);
  return ['setting-item', 'plugin-settings-field-card', `plugin-settings-field-card-${tone}`, matched ? 'plugin-settings-field-card-matched' : '', extra]
    .filter(Boolean)
    .join(' ');
}

function renderPanelMetaChips(chips = []) {
  return chips.map(chip => `<span class="plugin-settings-meta-chip ${chip.tone ? `tone-${chip.tone}` : ''}">${escapeHtml(chip.label)}</span>`).join('');
}

function getSkillGuide(skillName) {
  return SKILL_GUIDE_MAP[String(skillName || '').trim()] || {
    scene: '通用技能',
    recommendation: '按需评估',
    recommendationTone: 'warning',
    summary: '这个 skill 没有额外的预设解说，请按工具描述自行判断是否启用。',
    when: '只在你明确知道用途时再启用',
    caution: '优先检查工具说明和 Host 白名单',
    examples: ['先看卡片下方工具说明再决定是否开启'],
    priority: 40,
  };
}

function buildSkillToolPreview(tools = []) {
  const names = (Array.isArray(tools) ? tools : [])
    .map(tool => String(tool?.name || '').trim())
    .filter(Boolean);
  if (names.length === 0) {
    return '';
  }
  return names.length > 4
    ? `${names.slice(0, 4).join('、')} 等 ${names.length} 个`
    : names.join('、');
}

function buildSkillHostSummary(hosts = []) {
  const list = (Array.isArray(hosts) ? hosts : [])
    .map(item => String(item || '').trim())
    .filter(Boolean);
  if (list.length === 0) {
    return '';
  }
  if (list.length === 1) {
    return `Host：${list[0]}`;
  }
  if (list.length === 2) {
    return `Host：${list.join('、')}`;
  }
  return `Host：${list[0]} 等 ${list.length} 个`;
}

function getSkillToolSummaryLabel(skill = {}, previewOnly = false) {
  const toolCount = Number(skill?.toolCount || 0);
  const enabledToolCount = Number(skill?.enabledToolCount || 0);
  if (toolCount > 0) {
    return `工具 ${enabledToolCount}/${toolCount}`;
  }
  return previewOnly ? '工具明细待后端支持' : '暂无工具明细';
}

function getSkillCollapsedMessage(skill = {}, previewOnly = false) {
  const toolCount = Number(skill?.toolCount || 0);
  if (toolCount > 0) {
    return `已收起 ${toolCount} 个 tool，点击上方按钮展开详情。`;
  }
  if (previewOnly) {
    return '兼容预览模式下暂不展示 tool 明细。';
  }
  return '当前没有可展示的 tool 明细。';
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightSkillSearchText(value, keyword = pluginSettingsState.skillsSearchKeyword) {
  const rawText = String(value ?? '');
  const normalizedKeyword = normalizeSearchText(keyword);
  if (!normalizedKeyword) {
    return escapeHtml(rawText);
  }
  const rawKeyword = String(keyword || '').trim();
  if (!rawKeyword) {
    return escapeHtml(rawText);
  }
  const pattern = new RegExp(`(${escapeRegExp(rawKeyword)})`, 'ig');
  return rawText
    .split(pattern)
    .map(part => (
      part && part.match(pattern)
        ? `<mark>${escapeHtml(part)}</mark>`
        : escapeHtml(part)
    ))
    .join('');
}

function renderSkillExamples(examples = [], keyword = pluginSettingsState.skillsSearchKeyword) {
  const list = (Array.isArray(examples) ? examples : [])
    .map(item => String(item || '').trim())
    .filter(Boolean);
  if (list.length === 0) {
    return '';
  }
  return `
    <div class="plugin-settings-skill-examples">
      <div class="plugin-settings-skill-examples-title">适合问题示例</div>
      <div class="plugin-settings-skill-examples-list">
        ${list.map(item => `<span class="plugin-settings-skill-example-chip">${highlightSkillSearchText(item, keyword)}</span>`).join('')}
      </div>
    </div>
  `;
}

function compareSkillCards(left, right) {
  const leftGuide = getSkillGuide(left?.name);
  const rightGuide = getSkillGuide(right?.name);
  if (Boolean(left?.enabled) !== Boolean(right?.enabled)) {
    return left?.enabled ? -1 : 1;
  }
  if ((leftGuide.priority || 0) !== (rightGuide.priority || 0)) {
    return (rightGuide.priority || 0) - (leftGuide.priority || 0);
  }
  if (Number(left?.toolCount || 0) !== Number(right?.toolCount || 0)) {
    return Number(right?.toolCount || 0) - Number(left?.toolCount || 0);
  }
  return String(left?.name || '').localeCompare(String(right?.name || ''));
}

function applySkillPreset(presetName) {
  const preset = SKILL_PRESET_MAP[String(presetName || '').trim()];
  if (!preset || !pluginSettingsState.skillsDraft) {
    return;
  }
  const selected = new Set(preset.skills || []);
  pluginSettingsState.skillsDraft.definitions = (pluginSettingsState.skillsDraft.definitions || []).map((item) => {
    if (!selected.has(item.name)) {
      return item;
    }
    const tools = (Array.isArray(item.tools) ? item.tools : []).map(tool => ({
      ...tool,
      enabled: true,
    }));
    return {
      ...item,
      enabled: true,
      enabledToolCount: tools.length,
      tools,
    };
  });
}

function matchesSkillFilter(skill, filterName = pluginSettingsState.skillsFilter) {
  const normalizedFilter = normalizeSkillFilterValue(filterName);
  if (!skill || normalizedFilter === 'all') {
    return true;
  }
  if (normalizedFilter === 'enabled') {
    return skill.enabled === true;
  }
  if (normalizedFilter === 'disabled') {
    return skill.enabled !== true;
  }
  if (normalizedFilter === 'customized') {
    return skill.customized === true;
  }
  if (normalizedFilter === 'recommended') {
    return getSkillGuide(skill.name).recommendation === '建议常开';
  }
  if (normalizedFilter === 'daily') {
    return (SKILL_PRESET_MAP.daily.skills || []).includes(skill.name);
  }
  if (normalizedFilter === 'research') {
    return (SKILL_PRESET_MAP.research.skills || []).includes(skill.name);
  }
  return true;
}

function matchesSkillSearch(skill, keyword = pluginSettingsState.skillsSearchKeyword) {
  const normalizedKeyword = normalizeSearchText(keyword);
  if (!normalizedKeyword) {
    return true;
  }
  const guide = getSkillGuide(skill?.name);
  const haystack = [
    skill?.name,
    skill?.description,
    guide?.scene,
    guide?.summary,
    guide?.when,
    guide?.caution,
    ...(Array.isArray(guide?.examples) ? guide.examples : []),
    ...(Array.isArray(skill?.tools) ? skill.tools.flatMap(tool => [tool?.name, tool?.description]) : []),
  ]
    .map(item => String(item || '').trim().toLowerCase())
    .join(' ');
  return haystack.includes(normalizedKeyword);
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function getSkillsLayoutMode(width = 0) {
  const numericWidth = Number(width || 0);
  if (!Number.isFinite(numericWidth) || numericWidth <= 0) {
    return 'triple';
  }
  if (numericWidth < 680) {
    return 'single';
  }
  if (numericWidth < 920) {
    return 'double';
  }
  return 'triple';
}

function syncSkillsLayoutMode() {
  const box = document.getElementById('plugin-settings-skills-box');
  if (!box) {
    return;
  }
  const width = Math.round(box.getBoundingClientRect().width || 0);
  box.dataset.skillsLayout = getSkillsLayoutMode(width);
}

function ensureSkillsLayoutObserver() {
  const box = document.getElementById('plugin-settings-skills-box');
  if (!box) {
    return;
  }
  if (pluginSettingsSkillsLayoutObserver) {
    pluginSettingsSkillsLayoutObserver.disconnect();
    pluginSettingsSkillsLayoutObserver = null;
  }
  if (typeof ResizeObserver === 'function') {
    pluginSettingsSkillsLayoutObserver = new ResizeObserver(() => {
      syncSkillsLayoutMode();
    });
    pluginSettingsSkillsLayoutObserver.observe(box);
  }
  window.requestAnimationFrame(() => {
    syncSkillsLayoutMode();
  });
}

function isMatchedBySearch(item, keyword = pluginSettingsState.searchKeyword) {
  if (!keyword) return true;
  const haystack = [
    item.category,
    item.group,
    item.label,
    item.field,
    item.bottomHelpMessage,
  ].join(' ').toLowerCase();
  return haystack.includes(keyword);
}

function buildHeaders(extra = {}) {
  return { ...extra };
}

function setPluginSettingsRisk(message = '', hidden = false) {
  const box = document.getElementById('plugin-settings-risk');
  if (!box) return;
  box.textContent = String(message || '');
  box.classList.toggle('hidden', hidden || !message);
}

async function fetchPluginSettingsAuthStatus() {
  const auth = window.CrystelfAuth;
  if (!auth?.fetchAuthStatus) {
    return pluginSettingsState.authStatus;
  }
  try {
    return await auth.fetchAuthStatus();
  } catch {
    return auth.status || pluginSettingsState.authStatus;
  }
}

function buildFallbackSkillsEditorResponse(reason = '') {
  return {
    data: {
      supported: false,
      reason: String(reason || '').trim(),
      effectiveConfig: {},
      runtimeConfig: {},
      defaultConfig: {},
      stats: {},
    },
  };
}

async function fetchSkillsEditorConfigForAuth(authStatus) {
  if (authStatus?.bootstrapMode === true) {
    return buildFallbackSkillsEditorResponse('初始化模式下暂不提供高级 JSON 编辑。');
  }
  try {
    return await fetchJson('/api/plugin-settings/skills-config');
  } catch (error) {
    if (String(error?.message || '').includes('/api/plugin-settings/skills-config -> 404')) {
      return buildFallbackSkillsEditorResponse('当前控制台后端版本不支持高级 JSON 编辑，请更新控制台后端后再使用。');
    }
    throw error;
  }
}

function applyBootstrapModeUi() {
  const bootstrapMode = pluginSettingsState.authStatus?.bootstrapMode === true;
  const saveButton = document.getElementById('plugin-settings-save-btn');
  const meta = document.getElementById('plugin-settings-meta');
  const summary = document.getElementById('plugin-settings-summary');
  const consoleBox = document.getElementById('plugin-settings-console-box');
  const skillsBox = document.getElementById('plugin-settings-skills-box');

  document.querySelectorAll('[data-plugin-top-tab]').forEach(button => {
    button.disabled = bootstrapMode && button.dataset.pluginTopTab !== 'plugin-settings-console-panel';
  });

  consoleBox?.querySelectorAll('[data-field], [data-switch-field]').forEach(control => {
    const field = control.dataset.field || control.dataset.switchField || '';
    const tokenOnly = field === 'config.webConsoleToken';
    if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
      control.readOnly = bootstrapMode && !tokenOnly;
      control.disabled = false;
      return;
    }
    if (control instanceof HTMLSelectElement || control instanceof HTMLButtonElement) {
      control.disabled = bootstrapMode && !tokenOnly;
    }
  });

  skillsBox?.querySelectorAll('[data-skills-field], [data-skills-global-toggle], [data-skills-all-toggle], [data-skills-expand-all], [data-skills-preset], [data-skills-filter], [data-skills-search], [data-skills-search-clear], [data-skills-view-reset], [data-skill-toggle], [data-skill-expand], [data-skill-tool-toggle], [data-skills-editor-load], [data-skills-editor-format], [data-skills-editor-validate], [data-skills-editor-save], [data-skills-editor-reset], [data-skills-editor]').forEach(control => {
    if (control instanceof HTMLInputElement || control instanceof HTMLButtonElement) {
      control.disabled = bootstrapMode;
    }
    if (control instanceof HTMLTextAreaElement) {
      control.readOnly = bootstrapMode;
    }
  });

  if (saveButton) {
    saveButton.textContent = bootstrapMode ? '保存并完成初始化' : '保存插件设置';
  }

  if (meta) {
    meta.textContent = bootstrapMode
      ? '首次初始化仅允许本机进入，请先在控制台设置登录口令，保存后再重新登录。'
      : '基于锅巴配置项渲染，统一管理插件配置、控制台与 HTTP skills。';
  }

  if (bootstrapMode) {
    pluginSettingsState.activeTopTab = 'plugin-settings-console-panel';
    switchPluginTopTab('plugin-settings-console-panel');
    if (summary) {
      summary.textContent = '首次初始化：请先设置控制台登录口令';
    }
    setPluginSettingsRisk('首次初始化仅允许本机访问。请先在“控制台设置”中填写“控制台登录口令”，保存后将跳转到登录页。');
    window.requestAnimationFrame(() => {
      document.querySelector('[data-field="config.webConsoleToken"]')?.focus();
    });
    return;
  }

  if (summary && summary.textContent === '首次初始化：请先设置控制台登录口令') {
    summary.textContent = '正在加载设置项...';
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store', headers: buildHeaders() });
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return await response.json();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || data.success === false) throw new Error(data.error || `${url} -> ${response.status}`);
  return data;
}

function loadKnowledgeHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KNOWLEDGE_HISTORY_STORAGE_KEY) || '[]');
    pluginSettingsState.knowledgeHistory = Array.isArray(parsed) ? parsed : [];
  } catch {
    pluginSettingsState.knowledgeHistory = [];
  }
}

function persistKnowledgeHistory() {
  localStorage.setItem(KNOWLEDGE_HISTORY_STORAGE_KEY, JSON.stringify(pluginSettingsState.knowledgeHistory.slice(0, 20)));
}

function persistSkillFilter() {
  localStorage.setItem(SKILLS_FILTER_STORAGE_KEY, pluginSettingsState.skillsFilter);
}

function persistSkillsSearchKeyword() {
  localStorage.setItem(SKILLS_SEARCH_STORAGE_KEY, pluginSettingsState.skillsSearchKeyword || '');
}

function persistSkillsExpandedState() {
  localStorage.setItem(SKILLS_EXPANDED_STORAGE_KEY, JSON.stringify(pluginSettingsState.skillsExpanded || {}));
}

function isSkillExpanded(skill) {
  const skillName = String(skill?.name || '').trim();
  if (!skillName) {
    return false;
  }
  if (normalizeSearchText(pluginSettingsState.skillsSearchKeyword)) {
    return true;
  }
  const explicit = pluginSettingsState.skillsExpanded?.[skillName];
  if (typeof explicit === 'boolean') {
    return explicit;
  }
  return skill?.enabled === true;
}

function setSkillExpanded(skillName, expanded) {
  const normalizedName = String(skillName || '').trim();
  if (!normalizedName) {
    return;
  }
  pluginSettingsState.skillsExpanded = {
    ...(pluginSettingsState.skillsExpanded || {}),
    [normalizedName]: Boolean(expanded),
  };
  persistSkillsExpandedState();
}

function setSkillsExpandedByFilter(expanded, filterName = pluginSettingsState.skillsFilter) {
  const normalizedFilter = normalizeSkillFilterValue(filterName);
  const definitions = Array.isArray(pluginSettingsState.skillsDraft?.definitions)
    ? pluginSettingsState.skillsDraft.definitions
    : [];
  const nextState = {
    ...(pluginSettingsState.skillsExpanded || {}),
  };
  for (const item of definitions) {
    if (!matchesSkillFilter(item, normalizedFilter)) {
      continue;
    }
    const skillName = String(item?.name || '').trim();
    if (!skillName) {
      continue;
    }
    nextState[skillName] = Boolean(expanded);
  }
  pluginSettingsState.skillsExpanded = nextState;
  persistSkillsExpandedState();
}

function resetSkillsViewState() {
  pluginSettingsState.skillsFilter = 'all';
  pluginSettingsState.skillsSearchKeyword = '';
  pluginSettingsState.skillsExpanded = {};
  persistSkillFilter();
  persistSkillsSearchKeyword();
  persistSkillsExpandedState();
}

function loadFeatureManageHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FEATURE_MANAGE_HISTORY_STORAGE_KEY) || '[]');
    pluginSettingsState.featureManageHistory = Array.isArray(parsed) ? parsed : [];
  } catch {
    pluginSettingsState.featureManageHistory = [];
  }
}

function persistFeatureManageHistory() {
  localStorage.setItem(FEATURE_MANAGE_HISTORY_STORAGE_KEY, JSON.stringify(pluginSettingsState.featureManageHistory.slice(0, 10)));
}

function pushFeatureManageHistory(action, message, success = true) {
  pluginSettingsState.featureManageHistory.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    message,
    success,
    createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
  });
  pluginSettingsState.featureManageHistory = pluginSettingsState.featureManageHistory.slice(0, 10);
  persistFeatureManageHistory();
}

function createKnowledgeHistoryEntry({ action, content, sources = [], query = '', mode = '', note = '' }) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    content,
    query,
    mode,
    note,
    sources,
    createdAt: new Date().toLocaleString('zh-CN', { hour12: false }),
  };
}

function pushKnowledgeHistory(entry) {
  pluginSettingsState.knowledgeHistory.unshift(entry);
  pluginSettingsState.knowledgeHistory = pluginSettingsState.knowledgeHistory.slice(0, 20);
  persistKnowledgeHistory();
}

function applyGeneratedKnowledgePreview() {
  const previewSegments = parseKnowledgePreview(pluginSettingsState.knowledgeGeneratePreview || '')
    .filter(segment => pluginSettingsState.knowledgeSelectedPreviewIds.length === 0 || pluginSettingsState.knowledgeSelectedPreviewIds.includes(segment.id));
  const preview = stringifyKnowledgeSegments(previewSegments).trim();
  if (!preview) {
    pluginSettingsState.knowledgeGenerateStatus = '当前没有可应用的生成结果';
    renderForm();
    return;
  }
  const field = 'ai.knowledgeBase';
  const current = String(pluginSettingsState.draft[field] || '').trim();
  if (current) {
    pushKnowledgeHistory(createKnowledgeHistoryEntry({
      action: 'before_apply',
      content: current,
      note: '应用生成结果前的知识库快照',
    }));
  }
  const next = pluginSettingsState.knowledgeGenerateMode === 'append' && current
    ? `${current}\n\n${preview}`
    : preview;
  pluginSettingsState.draft[field] = next;
  pushKnowledgeHistory(createKnowledgeHistoryEntry({
    action: 'apply_generated',
    content: next,
    query: pluginSettingsState.knowledgeGenerateQuery,
    mode: pluginSettingsState.knowledgeGenerateMode,
    sources: pluginSettingsState.knowledgeGenerateSources,
    note: '已将联网生成结果应用到知识库草稿',
  }));
  pluginSettingsState.knowledgeGenerateStatus = `已按“${pluginSettingsState.knowledgeGenerateMode === 'append' ? '追加' : '覆盖'}”模式应用生成结果，记得保存配置。`;
  pluginSettingsState.knowledgeGeneratePreview = '';
  pluginSettingsState.knowledgeSelectedPreviewIds = [];
  renderForm();
}

function restoreKnowledgeHistory(id) {
  const target = pluginSettingsState.knowledgeHistory.find(item => item.id === id);
  if (!target) return;
  pluginSettingsState.draft['ai.knowledgeBase'] = target.content || '';
  pluginSettingsState.knowledgeGenerateStatus = `已恢复版本：${target.createdAt}`;
  renderForm();
}

async function generateKnowledgeBaseFromWeb() {
  const query = String(pluginSettingsState.knowledgeGenerateQuery || '').trim();
  if (!query) {
    pluginSettingsState.knowledgeGenerateStatus = '请输入要联网生成的主题';
    renderForm();
    return;
  }
  pluginSettingsState.knowledgeGenerateLoading = true;
  pluginSettingsState.knowledgeGenerateStatus = '正在联网搜索并整理知识库，请稍候...';
  renderForm();
  try {
    const result = await postJson('/api/plugin-settings/knowledge-generate', { query });
    pluginSettingsState.knowledgeGeneratePreview = result.generatedKnowledgeBase || '';
    pluginSettingsState.knowledgeSelectedPreviewIds = parseKnowledgePreview(result.generatedKnowledgeBase || '').map(item => item.id);
    pluginSettingsState.knowledgeGenerateSources = Array.isArray(result.sources) ? result.sources : [];
    pushKnowledgeHistory(createKnowledgeHistoryEntry({
      action: 'generated',
      content: result.generatedKnowledgeBase || '',
      query,
      mode: pluginSettingsState.knowledgeGenerateMode,
      sources: pluginSettingsState.knowledgeGenerateSources,
      note: '联网生成的候选知识库结果',
    }));
    pluginSettingsState.knowledgeGenerateStatus = `已生成 ${parseKnowledgePreview(result.generatedKnowledgeBase || '').length} 条知识片段，请先预览，再决定追加或覆盖。`;
  } catch (error) {
    pluginSettingsState.knowledgeGenerateStatus = `生成失败：${error.message}`;
  } finally {
    pluginSettingsState.knowledgeGenerateLoading = false;
    renderForm();
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function parseKnowledgePreview(value = '') {
  return String(value || '')
    .split(/\r?\n\s*\r?\n/)
    .map(block => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const [title = `知识片段${index + 1}`, maybeTags = '', ...rest] = lines;
      const hasTagsLine = /^标签[:：]/.test(maybeTags);
      return {
        id: `segment-${index + 1}`,
        title,
        tags: hasTagsLine ? maybeTags.replace(/^标签[:：]/, '').split(/[，,]/).map(item => item.trim()).filter(Boolean) : [],
        content: (hasTagsLine ? rest : [maybeTags, ...rest]).join('\n').trim(),
      };
    });
}

function stringifyKnowledgeSegments(segments = []) {
  return (segments || []).map(segment => [
    segment.title || '',
    Array.isArray(segment.tags) && segment.tags.length > 0 ? `标签:${segment.tags.join(',')}` : '',
    segment.content || '',
  ].filter(Boolean).join('\n')).filter(Boolean).join('\n\n');
}

function buildKnowledgeDiffSummary(current = '', target = '') {
  const currentSegments = parseKnowledgePreview(current);
  const targetSegments = parseKnowledgePreview(target);
  const currentTitles = new Set(currentSegments.map(item => item.title));
  const targetTitles = new Set(targetSegments.map(item => item.title));
  const added = targetSegments.filter(item => !currentTitles.has(item.title)).map(item => item.title);
  const removed = currentSegments.filter(item => !targetTitles.has(item.title)).map(item => item.title);
  return { added, removed, currentCount: currentSegments.length, targetCount: targetSegments.length };
}

function buildKnowledgeDemoText() {
  return [
    '验证功能',
    '标签:群管理,验证',
    '新成员进群后可开启验证，管理员可手动重置或绕过验证。',
    '',
    '欢迎功能',
    '标签:群管理,欢迎',
    '支持欢迎文案与欢迎图片配置。',
  ].join('\n');
}

function getVisibleItems() {
  const items = pluginSettingsState.payload?.items || [];
  return items.filter(item => item.category === pluginSettingsState.activeCategory && item.group === pluginSettingsState.activeGroup && isMatchedBySearch(item));
}

function isAiKnowledgeField(field = '') {
  return ['ai.knowledgeBaseEnabled', 'ai.knowledgeTopK', 'ai.knowledgeBase'].includes(field);
}

function switchPluginTopTab(tabId) {
  if (pluginSettingsState.authStatus?.bootstrapMode === true && tabId !== 'plugin-settings-console-panel') {
    tabId = 'plugin-settings-console-panel';
  }
  pluginSettingsState.activeTopTab = tabId;
  document.querySelectorAll('[data-plugin-top-tab]').forEach(button => {
    button.classList.toggle('active', button.dataset.pluginTopTab === tabId);
  });
  document.querySelectorAll('#plugin-settings-config-panel, #plugin-settings-features-panel, #plugin-settings-console-panel, #plugin-settings-skills-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== tabId);
  });
  document.getElementById('plugin-settings-config-nav')?.classList.toggle('hidden', tabId !== 'plugin-settings-config-panel');
}

function syncNavCollapsedState() {
  document.getElementById('plugin-settings-shell')?.classList.toggle('nav-collapsed', pluginSettingsState.navCollapsed);
  const button = document.getElementById('plugin-settings-nav-toggle-btn');
  if (button) {
    button.textContent = pluginSettingsState.navCollapsed ? '展开导航' : '收起导航';
  }
}

function renderCategoryTabs() {
  const categories = pluginSettingsState.payload?.categories || [];
  const items = pluginSettingsState.payload?.items || [];
  const visibleCategories = categories.filter(category => items.some(item => item.category === category.key && isMatchedBySearch(item)));
  if (!visibleCategories.some(item => item.key === pluginSettingsState.activeCategory)) {
    pluginSettingsState.activeCategory = visibleCategories[0]?.key || categories[0]?.key || 'main';
  }
  const container = document.getElementById('plugin-settings-category-tabs');
  container.innerHTML = visibleCategories.map(item => {
    const count = items.filter(entry => entry.category === item.key && isMatchedBySearch(entry)).length;
    return `
    <button class="settings-tab-btn ${pluginSettingsState.activeCategory === item.key ? 'active' : ''}" data-settings-category="${item.key}">${escapeHtml(item.label)} (${count})</button>
  `;
  }).join('');
}

function renderGroupTabs() {
  const items = pluginSettingsState.payload?.items || [];
  const groups = [...new Set(items.filter(item => item.category === pluginSettingsState.activeCategory && isMatchedBySearch(item)).map(item => item.group))];
  if (!pluginSettingsState.activeGroup || !groups.includes(pluginSettingsState.activeGroup)) {
    pluginSettingsState.activeGroup = groups[0] || '';
  }
  const container = document.getElementById('plugin-settings-group-tabs');
  container.innerHTML = groups.map(group => {
    const count = items.filter(item => item.category === pluginSettingsState.activeCategory && item.group === group && isMatchedBySearch(item)).length;
    return `
    <button class="plugin-settings-group-btn ${pluginSettingsState.activeGroup === group ? 'active' : ''}" data-settings-group="${escapeHtml(group)}">
      <span>${escapeHtml(group)}</span>
      <span class="plugin-settings-group-count">${count}</span>
    </button>
  `;
  }).join('');
}

function renderField(item) {
  const value = pluginSettingsState.draft[item.field];
  const props = item.componentProps || {};
  const readonly = item.readonly ? 'readonly' : '';
  const typeLabel = item.readonly ? '只读' : item.component;
  const matched = isRecommendationMatched(item.field, value);
  if (item.component === 'Switch') {
    return `
      <div class="${buildFieldCardClasses(item, matched)}">
        <div class="plugin-settings-field-head">
          <div class="kv-label">${escapeHtml(item.label)}</div>
          <span class="tag">${escapeHtml(typeLabel)}</span>
        </div>
        ${renderFieldMeta(item)}
        ${renderFieldNotice(item)}
        <button class="plugin-settings-switch ${value ? '' : 'off'}" data-switch-field="${item.field}">${value ? '已开启' : '已关闭'}</button>
        <div class="setting-help">${escapeHtml(item.bottomHelpMessage || '')}</div>
      </div>
    `;
  }
  if (item.component === 'InputTextArea') {
    if (item.field === 'ai.knowledgeBase') {
      const segments = parseKnowledgePreview(value ?? '');
      const previewSegments = parseKnowledgePreview(pluginSettingsState.knowledgeGeneratePreview || '');
      const historyPreview = pluginSettingsState.knowledgeHistory.find(item => item.id === pluginSettingsState.knowledgeHistoryPreviewId);
      const diffSummary = historyPreview ? buildKnowledgeDiffSummary(pluginSettingsState.draft['ai.knowledgeBase'] || '', historyPreview.content || '') : null;
      return `
        <div class="${buildFieldCardClasses(item, matched, 'plugin-settings-knowledge-card')}">
          <div class="plugin-settings-field-head">
            <div class="kv-label">${escapeHtml(item.label)}</div>
            <span class="tag">${escapeHtml(typeLabel)}</span>
          </div>
          ${renderFieldMeta(item)}
          ${renderFieldNotice(item)}
          <div class="plugin-settings-knowledge-toolbar">
            <input data-knowledge-generator-query placeholder="输入主题，例如：崩坏星穹铁道角色培养" value="${escapeHtml(pluginSettingsState.knowledgeGenerateQuery || '')}" />
            <button type="button" data-knowledge-generator-action="generate">${pluginSettingsState.knowledgeGenerateLoading ? '生成中...' : '联网生成知识库'}</button>
            <select data-knowledge-generate-mode>
              <option value="replace" ${pluginSettingsState.knowledgeGenerateMode === 'replace' ? 'selected' : ''}>覆盖模式</option>
              <option value="append" ${pluginSettingsState.knowledgeGenerateMode === 'append' ? 'selected' : ''}>追加模式</option>
            </select>
            <button type="button" data-knowledge-generator-action="apply">应用生成结果</button>
            <button type="button" data-knowledge-editor-action="fill-demo">填入示例</button>
            <button type="button" data-knowledge-editor-action="clear">清空内容</button>
            <span class="setting-status">共 ${segments.length} 条知识片段</span>
          </div>
          <div class="setting-help">${escapeHtml(pluginSettingsState.knowledgeGenerateStatus || '可输入主题后点击“联网生成知识库”，让后台搜索资料并自动整理为 RAG 知识。')}</div>
          ${pluginSettingsState.knowledgeGenerateSources.length > 0 ? `<div class="plugin-settings-knowledge-preview">${pluginSettingsState.knowledgeGenerateSources.map((item, index) => `<div class="plugin-settings-knowledge-segment"><div class="plugin-settings-knowledge-segment-head"><strong>来源 ${index + 1}. ${escapeHtml(item.title || '未命名来源')}</strong></div><div class="plugin-settings-knowledge-content">${escapeHtml(item.snippet || item.url || '')}</div></div>`).join('')}</div>` : ''}
          ${previewSegments.length > 0 ? `<div class="plugin-settings-knowledge-preview plugin-settings-knowledge-preview-pending"><div class="setting-status">生成结果预览（尚未写入知识库草稿）</div>${previewSegments.map((segment, index) => `<label class="plugin-settings-knowledge-segment plugin-settings-knowledge-selectable"><div class="plugin-settings-knowledge-segment-head"><strong>${index + 1}. ${escapeHtml(segment.title || '未命名片段')}</strong><input type="checkbox" data-knowledge-preview-id="${escapeHtml(segment.id)}" ${pluginSettingsState.knowledgeSelectedPreviewIds.includes(segment.id) ? 'checked' : ''} /></div>${segment.tags.length > 0 ? `<div class="plugin-settings-knowledge-tags">${segment.tags.map(tag => `<span class="sandbox-rag-tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}<div class="plugin-settings-knowledge-content">${escapeHtml(segment.content || '（无正文）')}</div></label>`).join('')}</div>` : ''}
          <textarea data-field="${item.field}" rows="${props.rows || 12}" placeholder="${escapeHtml(props.placeholder || '')}" ${readonly}>${escapeHtml(value ?? '')}</textarea>
          <div class="setting-help">${escapeHtml(item.bottomHelpMessage || '')}</div>
          <div class="plugin-settings-knowledge-preview">
            ${segments.length > 0 ? segments.map((segment, index) => `
              <div class="plugin-settings-knowledge-segment">
                <div class="plugin-settings-knowledge-segment-head">
                  <strong>${index + 1}. ${escapeHtml(segment.title || '未命名片段')}</strong>
                  ${segment.tags.length > 0 ? `<div class="plugin-settings-knowledge-tags">${segment.tags.map(tag => `<span class="sandbox-rag-tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
                </div>
                <div class="plugin-settings-knowledge-content">${escapeHtml(segment.content || '（无正文）')}</div>
              </div>
            `).join('') : '<div class="setting-status">当前还没有配置知识片段</div>'}
          </div>
          <div class="plugin-settings-knowledge-history">
            <div class="plugin-settings-field-head">
              <div class="kv-label">知识库版本历史</div>
              <span class="tag">最近 ${pluginSettingsState.knowledgeHistory.length} 条</span>
            </div>
            ${pluginSettingsState.knowledgeHistory.length > 0 ? pluginSettingsState.knowledgeHistory.map(item => `<div class="plugin-settings-knowledge-history-item"><div><strong>${escapeHtml(item.createdAt)}</strong> · ${escapeHtml(item.note || item.action || '历史版本')}</div><div class="setting-help">${escapeHtml(item.query ? `主题：${item.query}` : '手动/应用生成结果形成的版本')}</div><div class="plugin-settings-knowledge-tags">${item.mode ? `<span class="sandbox-rag-tag">${escapeHtml(item.mode === 'append' ? '追加' : '覆盖')}</span>` : ''}${Array.isArray(item.sources) ? item.sources.slice(0, 3).map(source => `<span class="sandbox-rag-token">${escapeHtml(source.title || '来源')}</span>`).join('') : ''}</div><div class="plugin-settings-knowledge-history-actions"><button type="button" data-knowledge-history-action="preview" data-knowledge-history-id="${escapeHtml(item.id)}">预览差异</button><button type="button" data-knowledge-history-action="restore" data-knowledge-history-id="${escapeHtml(item.id)}">恢复此版本</button></div></div>`).join('') : '<div class="setting-status">当前还没有知识库版本历史</div>'}
            ${historyPreview ? `<div class="plugin-settings-knowledge-preview plugin-settings-knowledge-history-preview"><div class="setting-status">版本预览：${escapeHtml(historyPreview.createdAt)}</div><div class="setting-help">当前草稿 ${diffSummary?.currentCount ?? 0} 条 → 历史版本 ${diffSummary?.targetCount ?? 0} 条；新增 ${diffSummary?.added.length ?? 0} 条，移除 ${diffSummary?.removed.length ?? 0} 条。</div>${diffSummary?.added.length ? `<div class="plugin-settings-knowledge-tags">${diffSummary.added.map(item => `<span class="sandbox-rag-tag">新增：${escapeHtml(item)}</span>`).join('')}</div>` : ''}${diffSummary?.removed.length ? `<div class="plugin-settings-knowledge-tags">${diffSummary.removed.map(item => `<span class="sandbox-rag-token">移除：${escapeHtml(item)}</span>`).join('')}</div>` : ''}<div class="plugin-settings-knowledge-content">${escapeHtml(historyPreview.content || '（无内容）')}</div></div>` : ''}
          </div>
        </div>
      `;
    }
    return `
      <div class="${buildFieldCardClasses(item, matched)}">
        ${renderFieldHead(item, typeLabel)}
        ${renderFieldMeta(item)}
        ${renderFieldNotice(item)}
        <textarea data-field="${item.field}" rows="${props.rows || 4}" placeholder="${escapeHtml(props.placeholder || '')}" ${readonly}>${escapeHtml(value ?? '')}</textarea>
        <div class="setting-help">${escapeHtml(item.bottomHelpMessage || '')}</div>
      </div>
    `;
  }
  if (item.component === 'Select') {
    const multiple = props.mode === 'multiple';
    const currentValues = multiple ? (Array.isArray(value) ? value : []) : [value];
    return `
      <div class="${buildFieldCardClasses(item, matched)}">
        ${renderFieldHead(item, multiple ? '多选' : typeLabel)}
        ${renderFieldMeta(item)}
        ${renderFieldNotice(item)}
        <select data-field="${item.field}" ${multiple ? 'multiple' : ''} ${readonly}>
          ${(props.options || []).map(option => `<option value="${escapeHtml(option.value)}" ${currentValues.includes(option.value) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
        </select>
        <div class="setting-help">${escapeHtml(item.bottomHelpMessage || '')}</div>
      </div>
    `;
  }
  if (item.component === 'InputArray') {
    return `
      <div class="${buildFieldCardClasses(item, matched)}">
      ${renderFieldHead(item, '列表')}
        ${renderFieldMeta(item)}
        ${renderFieldNotice(item)}
        <textarea data-field="${item.field}" rows="4" placeholder="每行一项" ${readonly}>${escapeHtml((Array.isArray(value) ? value : []).join('\n'))}</textarea>
        <div class="setting-help">${escapeHtml(item.bottomHelpMessage || '')}</div>
      </div>
    `;
  }
  const type = item.component === 'InputPassword' ? 'password' : 'text';
  const inputHtml = `<input type="${type}" data-field="${item.field}" value="${escapeHtml(value ?? '')}" placeholder="${escapeHtml(props.placeholder || '')}" ${type === 'password' ? 'autocomplete="new-password"' : ''} ${readonly} />`;
  return `
    <div class="${buildFieldCardClasses(item, matched)}">
      ${renderFieldHead(item, typeLabel)}
      ${renderFieldMeta(item)}
      ${renderFieldNotice(item)}
      ${type === 'password'
        ? `<form class="inline-field-form" onsubmit="return false;">
            <input class="visually-hidden" type="text" autocomplete="username" tabindex="-1" aria-hidden="true" />
            ${inputHtml}
          </form>`
        : inputHtml}
      <div class="setting-help">${escapeHtml(item.bottomHelpMessage || '')}</div>
    </div>
  `;
}

function renderForm() {
  const items = getVisibleItems();
  const knowledgeItems = pluginSettingsState.activeCategory === 'ai' ? items.filter(item => isAiKnowledgeField(item.field)) : [];
  const normalItems = pluginSettingsState.activeCategory === 'ai' ? items.filter(item => !isAiKnowledgeField(item.field)) : items;
  const category = (pluginSettingsState.payload?.categories || []).find(item => item.key === pluginSettingsState.activeCategory);
  const recommendableItems = normalItems.filter(item => Object.prototype.hasOwnProperty.call(FIELD_RECOMMENDATION_VALUES, item.field));
  const knowledgePanel = knowledgeItems.length > 0 ? `
    <section class="plugin-settings-special-panel plugin-settings-knowledge-panel">
      <div class="plugin-settings-special-panel-head">
        <div>
          <h3>RAG 知识库面板</h3>
          <div class="setting-status">集中管理真实机器人聊天使用的本地知识库开关、召回条数与正文内容。</div>
        </div>
      </div>
      <div class="plugin-settings-special-panel-grid">
        ${knowledgeItems.map(renderField).join('')}
      </div>
    </section>
  ` : '';
  document.getElementById('plugin-settings-form').innerHTML = (knowledgePanel || '') + (normalItems.length > 0
    ? normalItems.map(renderField).join('')
    : '<div class="setting-item">当前分组暂无可展示配置项</div>');
  const summaryEl = document.getElementById('plugin-settings-summary');
  if (recommendableItems.length > 0) {
    summaryEl.innerHTML = `${escapeHtml(category?.label || pluginSettingsState.activeCategory)} / ${escapeHtml(pluginSettingsState.activeGroup)} / ${items.length} 项 <button type="button" class="tag" data-apply-group-recommendation="1">应用本组推荐配置</button>`;
  } else {
    summaryEl.textContent = `${category?.label || pluginSettingsState.activeCategory} / ${pluginSettingsState.activeGroup} / ${items.length} 项`;
  }
  document.getElementById('plugin-settings-group-title').textContent = pluginSettingsState.activeGroup || '配置项';
  const groupDescription = GROUP_DESCRIPTIONS[pluginSettingsState.activeGroup] || '当前分组下集中展示同一类配置，方便按使用场景快速调整。';
  const groupRecommendation = GROUP_RECOMMENDATIONS[pluginSettingsState.activeGroup] || '';
  document.getElementById('plugin-settings-group-desc').textContent = `${groupDescription}${groupRecommendation ? ` 新手建议：${groupRecommendation}` : ''} 当前共 ${items.length} 项。${pluginSettingsState.searchKeyword ? ` 当前搜索：${pluginSettingsState.searchKeyword}` : ''}`;
  document.getElementById('plugin-settings-search-status').textContent = pluginSettingsState.recommendationStatus || (pluginSettingsState.searchKeyword
    ? `当前搜索：${pluginSettingsState.searchKeyword}，已按结果过滤分类、分组和字段。`
    : '可搜索分类、分组、字段名和说明。');
  document.getElementById('plugin-settings-config-meta').innerHTML = renderPanelMetaChips([
    { label: `分类：${category?.label || pluginSettingsState.activeCategory || '未选择'}` },
    { label: `分组：${pluginSettingsState.activeGroup || '未选择'}` },
    { label: `字段：${items.length} 项`, tone: 'info' },
    ...(pluginSettingsState.searchKeyword ? [{ label: `搜索：${pluginSettingsState.searchKeyword}`, tone: 'warning' }] : []),
  ]);
}

function renderFeatureSection() {
  const data = pluginSettingsState.overview || {};
  const runtime = data.webConsoleRuntime || {};
  const backup = data.featureToggleBackup || {};
  const descriptions = {
    ai: '群聊 AI 主功能',
    music: '点歌与音乐能力',
    rss: 'RSS 推送能力',
    auth: '入群验证能力',
    welcome: '入群欢迎能力',
    groupManagement: '群消息风控与黑白名单',
    groupTitle: '群头衔申请能力',
    poke: '戳一戳能力',
    status: '群内运行状态查询',
    webConsole: '本地控制台入口',
    affinity: '好感度系统',
    userProfile: '用户画像系统',
    tts: '语音工具能力',
  };
  const actionPanel = `
    <div class="plugin-settings-feature-toolbox">
      <div class="setting-item plugin-settings-feature-panel-card">
        <div class="plugin-settings-feature-panel-head">
          <div class="kv-label">功能开关工具面板</div>
          <div class="setting-status">按操作类型分区，避免把危险操作、备份操作和预览操作混在一起。</div>
        </div>
        <div class="plugin-settings-feature-action-groups">
          <div class="plugin-settings-feature-action-group">
            <div class="plugin-settings-feature-action-title">开关操作</div>
            <div class="actions plugin-settings-feature-actions">
              <button type="button" class="feature-manage-btn feature-manage-btn-safe" data-feature-manage="enable_all">全部开启</button>
              <button type="button" class="feature-manage-btn feature-manage-btn-danger" data-feature-manage="disable_all">全部关闭</button>
              <button type="button" class="feature-manage-btn feature-manage-btn-warning" data-feature-manage="reset">重置默认</button>
            </div>
            <div class="setting-help">适合快速切换当前插件的整体启用状态，危险操作已保留确认提示。</div>
          </div>
          <div class="plugin-settings-feature-action-group">
            <div class="plugin-settings-feature-action-title">备份与导出</div>
            <div class="actions plugin-settings-feature-actions">
              <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-feature-manage="backup">备份</button>
              <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-feature-manage="restore">恢复</button>
              <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-feature-manage="export_current">导出当前</button>
              <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-feature-manage="export_backup">导出备份</button>
            </div>
            <div class="setting-help">${escapeHtml(backup.hasBackup ? `当前备份时间：${backup.savedAt || '未知'}` : '当前还没有功能开关备份。')}</div>
          </div>
          <div class="plugin-settings-feature-action-group">
            <div class="plugin-settings-feature-action-title">帮助图预览</div>
            <div class="actions plugin-settings-feature-actions">
              <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-feature-help-preview="1">预览帮助图</button>
              ${pluginSettingsState.helpPreviewDataUrl ? '<button type="button" data-feature-help-open="1">新窗口打开</button><button type="button" data-feature-help-download="1">下载 PNG</button>' : ''}
            </div>
            <div class="setting-help">${escapeHtml(pluginSettingsState.helpPreviewStatus || '可直接在后台生成最新主人功能开关帮助图预览。')}</div>
          </div>
        </div>
        <div class="setting-help">${escapeHtml(pluginSettingsState.featureManageStatus || '这里提供网页后台的一键功能开关管理。')}</div>
      </div>
      <div class="setting-item plugin-settings-feature-panel-card">
        <div class="plugin-settings-feature-panel-head">
          <div class="kv-label">帮助图预览</div>
          <div class="setting-status">这里展示当前生成出的主人功能开关帮助图，可直接打开或下载。</div>
        </div>
        ${pluginSettingsState.helpPreviewDataUrl
          ? `<div class="plugin-settings-help-preview"><img src="${pluginSettingsState.helpPreviewDataUrl}" alt="帮助图预览" /></div>`
          : '<div class="plugin-settings-help-preview plugin-settings-help-preview-empty"><div class="setting-help">当前还没有生成帮助图预览，点击上方“预览帮助图”即可生成。</div></div>'}
      </div>
      <div class="setting-item plugin-settings-feature-panel-card">
        <div class="plugin-settings-feature-panel-head">
          <div class="kv-label">最近操作记录</div>
          <div class="setting-status">保留最近的功能开关操作结果，方便回看刚刚做了什么。</div>
        </div>
        <div class="plugin-settings-feature-history">
          ${pluginSettingsState.featureManageHistory.length > 0
            ? pluginSettingsState.featureManageHistory.map(item => `
              <div class="plugin-settings-feature-history-item ${item.success ? '' : 'tone-error'}">
                <div><strong>${escapeHtml(item.createdAt)}</strong> · ${escapeHtml(item.action)}</div>
                <div class="setting-help">${escapeHtml(item.message)}</div>
              </div>
            `).join('')
            : '<div class="setting-help">当前还没有操作记录。</div>'}
        </div>
      </div>
    </div>
  `;
  document.getElementById('plugin-settings-feature-list').innerHTML = actionPanel + Object.entries(data.features || {})
    .map(([key, enabled]) => `
      <div class="feature-toggle-card ${enabled ? '' : 'off'}">
        <div class="feature-toggle-head">
          <span class="feature-toggle-name">${escapeHtml(key)}</span>
          <span class="feature-toggle-state">${enabled ? '开启' : '关闭'}</span>
        </div>
        <div class="feature-toggle-desc">${escapeHtml(descriptions[key] || '功能开关')}</div>
        ${key === 'webConsole' ? `<div class="feature-toggle-source">运行状态：${runtime.running ? `已运行（${escapeHtml(runtime.url || '')}）` : '未运行或需重启后生效'}</div>` : ''}
      </div>
    `).join('');
  document.getElementById('plugin-settings-features-meta').innerHTML = renderPanelMetaChips([
    { label: `功能：${Object.keys(data.features || {}).length} 个`, tone: 'info' },
    { label: runtime.running ? '控制台：运行中' : '控制台：未运行', tone: runtime.running ? 'success' : 'warning' },
    { label: backup.hasBackup ? `备份：${backup.savedAt || '已存在'}` : '备份：暂无', tone: backup.hasBackup ? 'success' : 'warning' },
  ]);
}

function renderConsoleSection() {
  const runtime = pluginSettingsState.editableConfig?.webConsole || {};
  const itemMap = new Map((pluginSettingsState.payload?.items || []).map(item => [item.field, item]));
  const renderConsoleFieldSection = (title, description, fields) => {
    const sectionItems = fields.map(field => itemMap.get(field)).filter(Boolean);
    if (sectionItems.length === 0) return '';
    return `
      <section class="plugin-settings-special-panel">
        <div class="plugin-settings-special-panel-head">
          <div>
            <h3>${escapeHtml(title)}</h3>
            <div class="setting-status">${escapeHtml(description)}</div>
          </div>
          <div class="plugin-settings-panel-meta">${renderPanelMetaChips([
            { label: `字段：${sectionItems.length} 项`, tone: 'info' },
          ])}</div>
        </div>
        <div class="plugin-settings-special-panel-grid">
          ${sectionItems.map(renderField).join('')}
        </div>
      </section>
    `;
  };

  const runtimeSection = `
    <section class="plugin-settings-special-panel">
      <div class="plugin-settings-special-panel-head">
        <div>
          <h3>运行状态</h3>
          <div class="setting-status">先确认控制台当前是否真的跑起来，再决定是否调整访问参数。</div>
        </div>
        <div class="plugin-settings-panel-meta">${renderPanelMetaChips([
          { label: runtime.runtimeRunning ? '当前：已运行' : '当前：未运行', tone: runtime.runtimeRunning ? 'success' : 'warning' },
        ])}</div>
      </div>
      <div class="plugin-settings-special-panel-grid">
        <div class="setting-item">
          <div class="kv-label">运行状态</div>
          <div class="kv-value">${escapeHtml(runtime.runtimeRunning ? `已运行（${runtime.webConsoleReadOnly ? '地址已隐藏' : runtime.runtimeUrl || '地址未知'}）` : '未运行或需重启后生效')}</div>
          <div class="setting-help">这里展示的是当前控制台服务实例的实际运行状态，不等于仅配置层状态。</div>
        </div>
      </div>
    </section>
  `;

  const sections = [
    runtimeSection,
    renderConsoleFieldSection('访问与安全', '控制台是否启用、是否只读，以及登录口令等安全项。控制台网页始终要求登录。', [
      'config.webConsole',
      'config.webConsoleReadOnly',
      'config.webConsoleToken',
    ]),
    renderConsoleFieldSection('网络与分页', '控制台监听地址、端口冲突处理，以及列表分页规模。', [
      'config.webConsoleHost',
      'config.webConsolePort',
      'config.webConsolePortAutoIncrement',
      'config.webConsoleBackgroundSourceUrl',
      'config.webConsolePageSize',
      'config.webConsoleMaxPageSize',
    ]),
    renderConsoleFieldSection('日志与展示', '控制日志是否暴露、敏感信息是否脱敏，以及详情页展示上限。', [
      'config.webConsoleExposeLogs',
      'config.webConsoleMaskSensitiveConfig',
      'config.webConsoleLogTailLength',
      'config.webConsoleProfileRecentMessagesLimit',
      'config.webConsoleAffinityHistoryLimit',
    ]),
    renderConsoleFieldSection('API 超时', '常用接口的请求超时时间。优先先调这里，再决定是否补保底文案。', [
      'ai.timeout',
      'ai.imageConfig.timeout',
      'imageMonitor.analysisTimeoutMs',
      'coreConfig.tools.search.timeoutMs',
    ]),
    renderConsoleFieldSection('API 保底文案', '接口失败或超时后的兜底文案。图像生成支持回退到 AI 通用保底，图片监控留空则保持静默。', [
      'ai.imageConfig.fallbackReply',
      'ai.imageConfig.fallbackTimeoutReply',
      'imageMonitor.fallbackReply',
      'imageMonitor.fallbackTimeoutReply',
    ]),
  ].filter(Boolean);

  document.getElementById('plugin-settings-console-box').innerHTML = sections.join('');
  const consoleMetaChips = [
    { label: runtime.runtimeRunning ? '运行状态：已运行' : '运行状态：未运行', tone: runtime.runtimeRunning ? 'success' : 'warning' },
    { label: '鉴权：必须登录', tone: 'success' },
    { label: runtime.runtimeLoginConfigured ? '口令：已设置' : '口令：未设置', tone: runtime.runtimeLoginConfigured ? 'success' : 'warning' },
    { label: '分组：5 类', tone: 'info' },
  ];
  if (!runtime.webConsoleReadOnly) {
    consoleMetaChips.splice(
      1,
      0,
      { label: `主机：${runtime.runtimeHost || runtime.webConsoleHost || '127.0.0.1'}` },
      { label: `端口：${runtime.runtimePort || runtime.webConsolePort || '未设置'}`, tone: 'info' },
    );
  }
  document.getElementById('plugin-settings-console-meta').innerHTML = renderPanelMetaChips(consoleMetaChips);
}

function clonePayload(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

function formatPrettyJson(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

function syncDraftFromPayload() {
  const next = {};
  for (const item of pluginSettingsState.payload?.items || []) {
    next[item.field] = item.value;
  }
  pluginSettingsState.draft = next;
}

function buildSkillsPayloadFromEditorConfig(editorPayload = {}) {
  const effectiveConfig = clonePayload(editorPayload?.effectiveConfig) || {};
  const runtimeConfig = clonePayload(editorPayload?.runtimeConfig) || {};
  const defaultConfig = clonePayload(editorPayload?.defaultConfig) || {};
  const effectiveDefinitions = Array.isArray(effectiveConfig.definitions) ? effectiveConfig.definitions : [];
  const runtimeDefinitions = Array.isArray(runtimeConfig.definitions) ? runtimeConfig.definitions : [];
  const defaultDefinitions = Array.isArray(defaultConfig.definitions) ? defaultConfig.definitions : [];
  const runtimeNameSet = new Set(runtimeDefinitions.map(item => String(item?.name || '').trim()).filter(Boolean));
  const defaultNameSet = new Set(defaultDefinitions.map(item => String(item?.name || '').trim()).filter(Boolean));
  const defaultTimeoutMs = Number(
    effectiveConfig.defaultTimeoutMs
    || runtimeConfig.defaultTimeoutMs
    || defaultConfig.defaultTimeoutMs
    || 15000
  );
  const definitions = effectiveDefinitions
    .filter(item => item?.name)
    .map((item) => {
      const name = String(item.name || '').trim();
      const tools = (Array.isArray(item.tools) ? item.tools : [])
        .filter(tool => tool?.name)
        .map((tool) => {
          const properties = tool?.parameters?.properties;
          return {
            name: String(tool.name || '').trim(),
            enabled: tool.enabled !== false,
            description: String(tool.description || '').trim(),
            method: String(tool?.request?.method || 'GET').trim().toUpperCase(),
            parameterCount: properties && typeof properties === 'object' ? Object.keys(properties).length : 0,
            requiredParameters: Array.isArray(tool?.parameters?.required)
              ? tool.parameters.required.map(entry => String(entry || '').trim()).filter(Boolean)
              : [],
          };
        });
      return {
        name,
        enabled: item.enabled !== false,
        description: String(item.description || '').trim(),
        timeoutMs: Number(item.timeoutMs || defaultTimeoutMs || 15000),
        toolCount: tools.length,
        enabledToolCount: tools.filter(tool => tool.enabled).length,
        allowedHosts: Array.isArray(item.allowedHosts)
          ? item.allowedHosts.map(host => String(host || '').trim()).filter(Boolean)
          : [],
        origin: defaultNameSet.has(name) ? 'builtin' : 'custom',
        customized: runtimeNameSet.has(name),
        tools,
      };
    });

  return {
    enabled: effectiveConfig.enabled === true,
    autoLoad: effectiveConfig.autoLoad !== false,
    defaultTimeoutMs,
    definitionCount: definitions.length,
    enabledDefinitionCount: definitions.filter(item => item.enabled).length,
    toolCount: definitions.reduce((sum, item) => sum + Number(item.toolCount || 0), 0),
    enabledToolCount: definitions.reduce((sum, item) => sum + Number(item.enabledToolCount || 0), 0),
    builtinDefinitionCount: definitions.filter(item => item.origin === 'builtin').length,
    customDefinitionCount: definitions.filter(item => item.origin === 'custom').length,
    definitions,
  };
}

function syncSkillsDraftFromPayload() {
  const payload = clonePayload(pluginSettingsState.payload?.skills) || {};
  const editorFallback = buildSkillsPayloadFromEditorConfig(pluginSettingsState.skillsEditorPayload || {});
  const bundledFallback = (!pluginSettingsState.payload?.skills && pluginSettingsState.skillsEditorPayload?.supported === false)
    ? clonePayload(BUNDLED_SKILL_FALLBACK_CONFIG)
    : null;
  const payloadDefinitions = Array.isArray(payload.definitions) ? payload.definitions : [];
  const fallbackDefinitions = Array.isArray(editorFallback.definitions) ? editorFallback.definitions : [];
  const bundledDefinitions = Array.isArray(bundledFallback?.definitions) ? bundledFallback.definitions : [];
  const definitions = payloadDefinitions.length > 0 ? payloadDefinitions : fallbackDefinitions.length > 0 ? fallbackDefinitions : bundledDefinitions;
  const enabled = typeof payload.enabled === 'boolean'
    ? payload.enabled
    : (typeof editorFallback.enabled === 'boolean' ? editorFallback.enabled : bundledFallback?.enabled === true);
  const autoLoad = typeof payload.autoLoad === 'boolean'
    ? payload.autoLoad
    : (typeof editorFallback.autoLoad === 'boolean' ? editorFallback.autoLoad : bundledFallback?.autoLoad !== false);
  const defaultTimeoutMs = Number(payload.defaultTimeoutMs || editorFallback.defaultTimeoutMs || bundledFallback?.defaultTimeoutMs || 15000);
  pluginSettingsState.skillsDraft = {
    enabled,
    autoLoad,
    defaultTimeoutMs,
    previewOnly: bundledFallback?.previewOnly === true && payloadDefinitions.length === 0 && fallbackDefinitions.length === 0,
    previewReason: bundledFallback?.previewReason || '',
    definitionCount: definitions.length,
    enabledDefinitionCount: definitions.filter(item => item?.enabled).length,
    toolCount: definitions.reduce((sum, item) => sum + Number(item?.toolCount || 0), 0),
    enabledToolCount: definitions.reduce((sum, item) => sum + Number(item?.enabledToolCount || 0), 0),
    builtinDefinitionCount: definitions.filter(item => item?.origin === 'builtin').length,
    customDefinitionCount: definitions.filter(item => item?.origin === 'custom').length,
    definitions,
  };
}

function syncSkillsEditorFromSource(source = pluginSettingsState.skillsEditorSource || 'effective') {
  const payload = pluginSettingsState.skillsEditorPayload || {};
  const sourceMap = {
    effective: payload.effectiveConfig || {},
    runtime: payload.runtimeConfig || {},
    default: payload.defaultConfig || {},
  };
  pluginSettingsState.skillsEditorSource = source in sourceMap ? source : 'effective';
  pluginSettingsState.skillsEditorText = formatPrettyJson(sourceMap[pluginSettingsState.skillsEditorSource] || {});
}

function getParsedSkillsEditorConfig() {
  const text = String(pluginSettingsState.skillsEditorText || '').trim();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`JSON 解析失败：${error.message}`);
  }
}

function renderSkillsSection() {
  const data = pluginSettingsState.skillsDraft || {
    enabled: false,
    autoLoad: true,
    defaultTimeoutMs: 15000,
    definitions: [],
  };
  const definitions = Array.isArray(data.definitions) ? data.definitions : [];
  const sortedDefinitions = [...definitions].sort(compareSkillCards);
  const activeFilter = normalizeSkillFilterValue(pluginSettingsState.skillsFilter);
  const skillsSearchKeyword = String(pluginSettingsState.skillsSearchKeyword || '');
  const normalizedSkillsSearchKeyword = normalizeSearchText(skillsSearchKeyword);
  let visibleDefinitions = sortedDefinitions.filter(item => (
    matchesSkillFilter(item, activeFilter) && matchesSkillSearch(item, skillsSearchKeyword)
  ));
  if (definitions.length > 0 && visibleDefinitions.length === 0 && !normalizedSkillsSearchKeyword && activeFilter !== 'all') {
    pluginSettingsState.skillsFilter = 'all';
    persistSkillFilter();
    visibleDefinitions = sortedDefinitions.filter(item => matchesSkillSearch(item, skillsSearchKeyword));
  }
  const expandedVisibleCount = visibleDefinitions.filter(item => isSkillExpanded(item)).length;
  const enabledCount = definitions.filter(item => item.enabled).length;
  const totalToolCount = definitions.reduce((sum, item) => sum + Number(item.toolCount || 0), 0);
  const enabledToolCount = definitions.reduce((sum, item) => {
    const tools = Array.isArray(item.tools) ? item.tools : [];
    return sum + tools.filter(tool => tool.enabled).length;
  }, 0);
  const filterButtons = Object.entries(SKILL_FILTER_MAP).map(([key, meta]) => {
    const count = definitions.filter(item => matchesSkillFilter(item, key)).length;
    const activeClass = key === activeFilter ? 'is-active' : '';
    return `<button type="button" class="feature-manage-btn feature-manage-btn-secondary plugin-settings-skill-filter-btn ${activeClass}" data-skills-filter="${escapeHtml(key)}">${escapeHtml(`${meta.label} ${count}`)}</button>`;
  }).join('');
  const summarySection = `
    <section class="plugin-settings-special-panel">
      <div class="plugin-settings-special-panel-head">
        <div>
          <h3>Skills 总览</h3>
          <div class="setting-status">这里展示 HTTP skills 的用途说明，并允许你直接在控制台启用或停用。网页只暴露介绍和开关，不展示底层请求模板与密钥细节。</div>
          ${data.previewOnly ? `<div class="setting-help">${escapeHtml(data.previewReason || '当前为兼容预览模式，显示的是前端内置 Skills 目录。')}</div>` : ''}
        </div>
        <div class="plugin-settings-panel-meta">${renderPanelMetaChips([
          { label: data.enabled ? '系统：已启用' : '系统：已关闭', tone: data.enabled ? 'success' : 'warning' },
          { label: data.autoLoad ? '会话：自动加载' : '会话：手动加载', tone: data.autoLoad ? 'success' : 'warning' },
          { label: `技能：${enabledCount}/${definitions.length}`, tone: 'info' },
          { label: `工具：${enabledToolCount}/${totalToolCount}`, tone: 'info' },
          ...(data.previewOnly ? [{ label: '模式：兼容预览', tone: 'warning' }] : []),
          { label: `当前筛选：${SKILL_FILTER_MAP[activeFilter].label}`, tone: 'info' },
          ...(normalizedSkillsSearchKeyword ? [{ label: `搜索：${skillsSearchKeyword}`, tone: 'info' }] : []),
        ])}</div>
      </div>
      <div class="plugin-settings-skills-summary-grid">
        <div class="setting-item plugin-settings-skill-metric-card">
          <div class="kv-label">已启用技能</div>
          <div class="plugin-settings-skill-metric-value">${escapeHtml(String(enabledCount))}</div>
          <div class="setting-help">总共 ${escapeHtml(String(definitions.length))} 个 skill，优先显示当前已开启项。</div>
        </div>
        <div class="setting-item plugin-settings-skill-metric-card">
          <div class="kv-label">已启用工具</div>
          <div class="plugin-settings-skill-metric-value">${escapeHtml(String(enabledToolCount))}</div>
          <div class="setting-help">当前共统计到 ${escapeHtml(String(totalToolCount))} 个 tool。</div>
        </div>
        <div class="setting-item plugin-settings-skill-metric-card">
          <div class="kv-label">自动加载</div>
          <div class="plugin-settings-skill-metric-value">${escapeHtml(data.autoLoad ? '开' : '关')}</div>
          <div class="setting-help">决定已启用 skill 是否自动进入每个 AI 会话。</div>
        </div>
        <div class="setting-item plugin-settings-skill-metric-card">
          <div class="kv-label">默认超时</div>
          <div class="plugin-settings-skill-metric-value">${escapeHtml(`${Number(data.defaultTimeoutMs || 15000)} ms`)}</div>
          <div class="setting-help">单个 skill 未单独配置时，使用这个默认超时。</div>
        </div>
      </div>
      <div class="plugin-settings-skills-control-grid">
        <div class="setting-item plugin-settings-skill-control-card plugin-settings-skill-control-card-system">
          <div class="kv-label">系统开关</div>
          <div class="plugin-settings-skill-inline-metrics">
            <span class="tag">${escapeHtml(data.enabled ? '系统：已开启' : '系统：已关闭')}</span>
            <span class="tag">${escapeHtml(data.autoLoad ? '会话：自动加载' : '会话：手动加载')}</span>
            <span class="tag">${escapeHtml(`内置 ${Number(data.builtinDefinitionCount || 0)} / 自定义 ${Number(data.customDefinitionCount || 0)}`)}</span>
          </div>
          <div class="plugin-settings-skill-control-split">
            <button type="button" class="feature-manage-btn ${data.enabled ? 'feature-manage-btn-danger' : 'feature-manage-btn-safe'}" data-skills-global-toggle="enabled">${data.enabled ? '关闭整个 skills 系统' : '开启整个 skills 系统'}</button>
            <button type="button" class="feature-manage-btn ${data.autoLoad ? 'feature-manage-btn-warning' : 'feature-manage-btn-safe'}" data-skills-global-toggle="autoLoad">${data.autoLoad ? '改为手动加载' : '开启自动加载'}</button>
          </div>
          <label class="plugin-settings-skill-timeout-box">
            <span class="kv-label">默认超时</span>
            <input type="number" data-skills-field="defaultTimeoutMs" min="1000" max="60000" step="1000" value="${escapeHtml(String(data.defaultTimeoutMs || 15000))}" />
          </label>
        </div>
        <div class="setting-item plugin-settings-skill-control-card plugin-settings-skill-control-card-workflow">
          <div class="kv-label">搜索、筛选与批量操作</div>
          <div class="setting-help">先用关键词和筛选缩小范围，再对当前列表做推荐开启、批量开关或展开工具详情。</div>
          <div class="plugin-settings-skill-search-row">
            <input type="text" data-skills-search="1" placeholder="搜索 skill / tool / 场景说明" value="${escapeHtml(skillsSearchKeyword)}" />
            <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-skills-search-clear="1">清空</button>
          </div>
          <div class="actions plugin-settings-skill-filter-actions">
            ${filterButtons}
          </div>
          <div class="plugin-settings-skill-action-cluster-grid">
            <div class="plugin-settings-skill-control-group">
              <div class="plugin-settings-skill-control-group-title">推荐组合</div>
              <div class="actions plugin-settings-skill-preset-actions">
                <button type="button" class="feature-manage-btn feature-manage-btn-safe" data-skills-preset="daily">${escapeHtml(SKILL_PRESET_MAP.daily.label)}</button>
                <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-skills-preset="research">${escapeHtml(SKILL_PRESET_MAP.research.label)}</button>
              </div>
              <div class="setting-help">只会开启对应技能，不会顺手关闭其他已启用项。</div>
            </div>
            <div class="plugin-settings-skill-control-group">
              <div class="plugin-settings-skill-control-group-title">批量开关</div>
              <div class="actions plugin-settings-skill-batch-actions">
                <button type="button" class="feature-manage-btn feature-manage-btn-safe" data-skills-all-toggle="enable">全部开启</button>
                <button type="button" class="feature-manage-btn feature-manage-btn-danger" data-skills-all-toggle="disable">全部关闭</button>
              </div>
              <div class="setting-help">同时作用到 skill 和其下全部 tool，不会改请求结构。</div>
            </div>
            <div class="plugin-settings-skill-control-group">
              <div class="plugin-settings-skill-control-group-title">工具视图</div>
              <div class="actions plugin-settings-skill-expand-actions">
                <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-skills-expand-all="expand">全部展开工具</button>
                <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-skills-expand-all="collapse">全部收起工具</button>
              </div>
              <div class="setting-help">只影响当前筛选结果，方便连续比对多个 skill。</div>
            </div>
          </div>
          <div class="plugin-settings-skill-control-footer">
            <div class="setting-status">当前筛选：${escapeHtml(SKILL_FILTER_MAP[activeFilter].label)}${normalizedSkillsSearchKeyword ? `；关键词：${escapeHtml(skillsSearchKeyword)}` : ''}；已展开 ${escapeHtml(String(expandedVisibleCount))}/${escapeHtml(String(visibleDefinitions.length))}</div>
            <div class="actions plugin-settings-skill-reset-actions">
              <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-skills-view-reset="1">重置当前视图</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;

  const cards = visibleDefinitions.length > 0
    ? visibleDefinitions.map((item) => {
      const guide = getSkillGuide(item.name);
      const toolPreview = buildSkillToolPreview(item.tools);
      const hostSummary = buildSkillHostSummary(item.allowedHosts);
      const examplesMarkup = renderSkillExamples(guide.examples, skillsSearchKeyword);
      const expanded = isSkillExpanded(item);
      const hasToolDetails = Number(item.toolCount || 0) > 0;
      const toolToggleLabel = hasToolDetails
        ? (normalizedSkillsSearchKeyword ? '搜索中自动展开' : expanded ? '收起工具列表' : '展开工具列表')
        : (data.previewOnly ? '工具明细待后端支持' : '暂无工具明细');
      return `
      <article class="setting-item plugin-settings-skill-card ${item.enabled ? '' : 'off'} ${expanded ? '' : 'collapsed'}">
        <div class="plugin-settings-skill-card-top">
          <div class="plugin-settings-skill-card-title">
            <div class="plugin-settings-skill-card-name-row">
              <div class="plugin-settings-skill-name-box">
                <span class="plugin-settings-skill-name-kicker">skill</span>
                <div class="plugin-settings-skill-name">${highlightSkillSearchText(item.name || 'unnamed-skill', skillsSearchKeyword)}</div>
              </div>
              <span class="plugin-settings-skill-scene-pill">${highlightSkillSearchText(guide.scene, skillsSearchKeyword)}</span>
            </div>
            <div class="plugin-settings-skill-card-copy">${highlightSkillSearchText(item.description || '当前没有额外说明。', skillsSearchKeyword)}</div>
            <div class="plugin-settings-panel-meta plugin-settings-skill-card-meta">${renderPanelMetaChips([
              { label: item.enabled ? '当前：已参与会话' : '当前：未参与会话', tone: item.enabled ? 'success' : 'warning' },
              { label: item.origin === 'custom' ? '来源：自定义' : '来源：内置', tone: item.origin === 'custom' ? 'warning' : 'info' },
              { label: getSkillToolSummaryLabel(item, data.previewOnly), tone: 'info' },
              { label: `超时：${Number(item.timeoutMs || data.defaultTimeoutMs || 15000)} ms`, tone: 'info' },
              ...(hostSummary ? [{ label: hostSummary, tone: 'info' }] : []),
              ...(item.customized ? [{ label: '运行时已自定义', tone: 'warning' }] : []),
            ])}</div>
          </div>
          <div class="plugin-settings-skill-card-actions">
            <button type="button" class="feature-manage-btn ${item.enabled ? 'feature-manage-btn-danger' : 'feature-manage-btn-safe'}" data-skill-toggle="${escapeHtml(item.name || '')}">${item.enabled ? '关闭此 skill' : '开启此 skill'}</button>
            <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-skill-expand="${escapeHtml(item.name || '')}" ${hasToolDetails ? '' : 'disabled'}>${escapeHtml(toolToggleLabel)}</button>
          </div>
        </div>
        <div class="plugin-settings-skill-guide">
          <div class="plugin-settings-skill-guide-head">
            <div class="plugin-settings-skill-guide-heading">
              <span class="plugin-settings-skill-guide-kicker">Usage</span>
              <div class="plugin-settings-skill-guide-title">${highlightSkillSearchText(guide.recommendation, skillsSearchKeyword)}</div>
            </div>
            <div class="plugin-settings-panel-meta">${renderPanelMetaChips([
              { label: `建议：${guide.recommendation}`, tone: guide.recommendationTone || 'info' },
              ...(data.previewOnly ? [{ label: '当前：兼容预览', tone: 'warning' }] : []),
            ])}</div>
          </div>
          <div class="plugin-settings-skill-guide-summary-card">
            <div class="setting-help plugin-settings-skill-guide-summary">${highlightSkillSearchText(guide.summary, skillsSearchKeyword)}</div>
          </div>
          <div class="plugin-settings-skill-guide-facts">
            <div class="plugin-settings-skill-guide-fact">
              <span class="plugin-settings-skill-guide-fact-label">适合</span>
              <span class="plugin-settings-skill-guide-fact-value">${highlightSkillSearchText(guide.when, skillsSearchKeyword)}</span>
            </div>
            ${guide.caution ? `<div class="plugin-settings-skill-guide-fact">
              <span class="plugin-settings-skill-guide-fact-label">注意</span>
              <span class="plugin-settings-skill-guide-fact-value">${highlightSkillSearchText(guide.caution, skillsSearchKeyword)}</span>
            </div>` : ''}
          </div>
          ${toolPreview ? `<div class="plugin-settings-skill-tool-preview">
            <span class="plugin-settings-skill-guide-fact-label">工具摘要</span>
            <span class="plugin-settings-skill-guide-fact-value">${highlightSkillSearchText(toolPreview, skillsSearchKeyword)}</span>
          </div>` : ''}
          ${examplesMarkup}
        </div>
        ${expanded ? `<div class="plugin-settings-skill-tools">
          <div class="plugin-settings-skill-tools-head">
            <div class="plugin-settings-skill-tools-heading">
              <span class="plugin-settings-skill-tools-kicker">Tools</span>
              <div class="plugin-settings-skill-tools-title">已展开 ${Number(item.toolCount || (Array.isArray(item.tools) ? item.tools.length : 0))} 个工具</div>
            </div>
            <div class="plugin-settings-panel-meta">${renderPanelMetaChips([
              { label: `启用 ${Array.isArray(item.tools) ? item.tools.filter(tool => tool?.enabled).length : 0}/${Number(item.toolCount || (Array.isArray(item.tools) ? item.tools.length : 0))}`, tone: 'info' },
            ])}</div>
          </div>
          <div class="plugin-settings-skill-tools-list">
          ${(Array.isArray(item.tools) ? item.tools : []).map((tool) => `
            <div class="plugin-settings-skill-tool-item">
              <div class="plugin-settings-skill-tool-head">
                <div class="plugin-settings-skill-tool-copy">
                  <strong>${highlightSkillSearchText(tool.name || 'tool', skillsSearchKeyword)}</strong>
                  <div class="plugin-settings-skill-tool-desc">${highlightSkillSearchText(tool.description || '当前没有工具说明。', skillsSearchKeyword)}</div>
                </div>
                <div class="plugin-settings-panel-meta">${renderPanelMetaChips([
                  { label: String(tool.method || 'GET'), tone: 'info' },
                  { label: tool.enabled ? '已开启' : '已关闭', tone: tool.enabled ? 'success' : 'warning' },
                ])}</div>
              </div>
              <div class="plugin-settings-skill-tool-footer">
                <div class="plugin-settings-panel-meta">${renderPanelMetaChips([
                  { label: `参数：${Number(tool.parameterCount || 0)} 个`, tone: 'info' },
                  ...(Array.isArray(tool.requiredParameters) && tool.requiredParameters.length > 0 ? [{ label: `必填：${tool.requiredParameters.join(', ')}`, tone: 'warning' }] : []),
                ])}</div>
                <div class="actions">
                  <button type="button" class="feature-manage-btn ${tool.enabled ? 'feature-manage-btn-warning' : 'feature-manage-btn-safe'}" data-skill-tool-toggle="${escapeHtml(item.name || '')}" data-tool-name="${escapeHtml(tool.name || '')}">${tool.enabled ? '关闭此 tool' : '开启此 tool'}</button>
                </div>
              </div>
            </div>
          `).join('') || '<div class="plugin-settings-skill-tool-empty">当前没有可展示的工具明细。</div>'}
          </div>
        </div>` : `<div class="plugin-settings-skill-tools-collapsed">${escapeHtml(getSkillCollapsedMessage(item, data.previewOnly))}</div>`}
      </article>
    `;
    }).join('')
    : `<div class="setting-item"><div class="kv-label">当前条件下暂无结果</div><div class="setting-help">已应用筛选：${escapeHtml(SKILL_FILTER_MAP[activeFilter].label)}${normalizedSkillsSearchKeyword ? `，搜索关键词：${escapeHtml(skillsSearchKeyword)}` : ''}。可以切回“全部”或清空搜索查看完整 skills 列表。</div></div>`;

  const editorPayload = pluginSettingsState.skillsEditorPayload || {};
  const editorStats = editorPayload.stats || {};
  const editorSupported = editorPayload.supported !== false;
  const editorReason = String(editorPayload.reason || '').trim();
  const editorStatusText = escapeHtml(pluginSettingsState.skillsEditorStatus || '提示：公网控制台下不要随意粘贴带私钥的 skill JSON；若含私钥，建议仅在可信环境内编辑。');
  const editorSection = editorSupported
    ? `
    <details class="plugin-settings-special-panel plugin-settings-skills-editor-panel">
      <summary class="plugin-settings-skills-editor-summary">
        <div>
          <h3>高级 JSON 编辑</h3>
          <div class="setting-status">结构化开关和这里是两套入口。需要直接改原始 JSON 时再展开。</div>
        </div>
        <div class="plugin-settings-panel-meta">${renderPanelMetaChips([
          { label: `当前来源：${pluginSettingsState.skillsEditorSource === 'runtime' ? '运行时覆盖' : pluginSettingsState.skillsEditorSource === 'default' ? '默认模板' : '当前生效配置'}`, tone: 'info' },
          { label: `生效 skill：${Number(editorStats.effectiveDefinitionCount || definitions.length)}`, tone: 'info' },
          { label: `生效 tool：${Number(editorStats.effectiveToolCount || totalToolCount)}`, tone: 'info' },
        ])}</div>
      </summary>
      <div class="plugin-settings-skills-editor-body">
        <div class="plugin-settings-skills-editor-actions">
          <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-skills-editor-load="effective">载入当前生效</button>
          <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-skills-editor-load="runtime">载入运行时覆盖</button>
          <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-skills-editor-load="default">载入默认模板</button>
          <button type="button" class="feature-manage-btn feature-manage-btn-secondary" data-skills-editor-format="1">格式化 JSON</button>
          <button type="button" class="feature-manage-btn feature-manage-btn-warning" data-skills-editor-validate="1">校验 JSON</button>
          <button type="button" class="feature-manage-btn feature-manage-btn-safe" data-skills-editor-save="1">保存 JSON</button>
          <button type="button" class="feature-manage-btn feature-manage-btn-danger" data-skills-editor-reset="1">清空运行时覆盖</button>
        </div>
        <textarea class="plugin-settings-skills-editor-textarea" data-skills-editor="1" spellcheck="false">${escapeHtml(pluginSettingsState.skillsEditorText || '{}')}</textarea>
        <div class="setting-help">${editorStatusText}</div>
      </div>
    </details>
  `
    : `
    <details class="plugin-settings-special-panel plugin-settings-skills-editor-panel">
      <summary class="plugin-settings-skills-editor-summary">
        <div>
          <h3>高级 JSON 编辑</h3>
          <div class="setting-status">当前控制台后端暂不支持这一块，结构化 Skills 开关仍可继续使用。</div>
        </div>
        <div class="plugin-settings-panel-meta">${renderPanelMetaChips([
          { label: '状态：暂不可用', tone: 'warning' },
          { label: '原因：后端接口缺失', tone: 'info' },
        ])}</div>
      </summary>
      <div class="plugin-settings-skills-editor-body">
        <div class="setting-item">
          <div class="kv-label">兼容模式</div>
          <div class="setting-help">${escapeHtml(editorReason || '当前控制台后端版本不支持 /api/plugin-settings/skills-config，因此已自动跳过高级 JSON 编辑区。')}</div>
        </div>
      </div>
    </details>
  `;

  document.getElementById('plugin-settings-skills-box').innerHTML = `${summarySection}<div class="plugin-settings-skills-grid">${cards}</div>${editorSection}`;
  document.getElementById('plugin-settings-skills-meta').innerHTML = renderPanelMetaChips([
    { label: data.enabled ? '系统：已启用' : '系统：已关闭', tone: data.enabled ? 'success' : 'warning' },
    { label: data.autoLoad ? '自动加载：开启' : '自动加载：关闭', tone: data.autoLoad ? 'success' : 'warning' },
    { label: `已启用：${enabledCount}/${definitions.length}`, tone: 'info' },
    { label: `工具：${enabledToolCount}/${totalToolCount}`, tone: 'info' },
    { label: `展示：${visibleDefinitions.length}/${definitions.length}`, tone: 'info' },
    ...(normalizedSkillsSearchKeyword ? [{ label: `匹配：${visibleDefinitions.length}`, tone: 'info' }] : []),
    { label: `默认超时：${Number(data.defaultTimeoutMs || 15000)} ms`, tone: 'info' },
  ]);
  ensureSkillsLayoutObserver();
}

async function refreshPluginSettings() {
  const authStatus = await fetchPluginSettingsAuthStatus();
  const [payload, overview, editableConfig, skillsEditorResponse] = await Promise.all([
    fetchJson('/api/plugin-settings'),
    fetchJson('/api/overview'),
    fetchJson('/api/config/editable'),
    fetchSkillsEditorConfigForAuth(authStatus),
  ]);
  pluginSettingsState.payload = payload;
  pluginSettingsState.overview = overview;
  pluginSettingsState.editableConfig = editableConfig;
  pluginSettingsState.authStatus = authStatus || pluginSettingsState.authStatus;
  pluginSettingsState.skillsEditorPayload = skillsEditorResponse?.data || {};
  if (!pluginSettingsState.activeCategory && payload.categories?.[0]) {
    pluginSettingsState.activeCategory = payload.categories[0].key;
  }
  syncDraftFromPayload();
  syncSkillsDraftFromPayload();
  syncSkillsEditorFromSource(pluginSettingsState.skillsEditorSource || 'effective');
  renderCategoryTabs();
  renderGroupTabs();
  renderForm();
  renderFeatureSection();
  renderConsoleSection();
  renderSkillsSection();
  switchPluginTopTab(pluginSettingsState.activeTopTab);
  syncNavCollapsedState();
  applyBootstrapModeUi();
}

async function savePluginSettings() {
  const result = await postJson('/api/plugin-settings/save', { data: pluginSettingsState.draft, skills: pluginSettingsState.skillsDraft });
  pluginSettingsState.payload = result.data;
  const authStatus = await fetchPluginSettingsAuthStatus();
  const [editableConfig, skillsEditorResponse] = await Promise.all([
    fetchJson('/api/config/editable'),
    fetchSkillsEditorConfigForAuth(authStatus),
  ]);
  pluginSettingsState.editableConfig = editableConfig;
  pluginSettingsState.authStatus = authStatus || pluginSettingsState.authStatus;
  pluginSettingsState.skillsEditorPayload = skillsEditorResponse?.data || pluginSettingsState.skillsEditorPayload;
  syncDraftFromPayload();
  syncSkillsDraftFromPayload();
  syncSkillsEditorFromSource(pluginSettingsState.skillsEditorSource || 'effective');
  renderCategoryTabs();
  renderGroupTabs();
  renderForm();
  renderFeatureSection();
  renderConsoleSection();
  renderSkillsSection();
  applyBootstrapModeUi();
  document.getElementById('plugin-settings-summary').textContent = result.data?.bootstrapCompleted
    ? '首次初始化完成，正在跳转到登录页...'
    : '保存成功，部分配置可能需要重启后完全生效';
  if (result.data?.bootstrapCompleted) {
    setPluginSettingsRisk('首次初始化完成，请使用刚设置的控制台登录口令重新登录。');
    window.setTimeout(() => {
      window.location.href = `/login.html?redirect=${encodeURIComponent('/plugin-settings.html')}`;
    }, 500);
  } else {
    setPluginSettingsRisk('', true);
  }
}

async function manageFeatureToggles(action) {
  const result = await postJson('/api/plugin-settings/feature-manage', { action });
  pluginSettingsState.payload = result.settings;
  pluginSettingsState.overview = result.overview;
  syncDraftFromPayload();
  syncSkillsDraftFromPayload();
  pluginSettingsState.featureManageStatus = result.data?.message || '功能开关操作已完成';
  if (result.data?.exportText) {
    try {
      await navigator.clipboard.writeText(result.data.exportText);
      pluginSettingsState.featureManageStatus += '，已复制到剪贴板';
    } catch {
      pluginSettingsState.featureManageStatus += '，复制到剪贴板失败，可直接使用下载文件';
    }
  }
  pushFeatureManageHistory(action, pluginSettingsState.featureManageStatus, true);
  renderCategoryTabs();
  renderGroupTabs();
  renderForm();
  renderFeatureSection();
  renderConsoleSection();
  renderSkillsSection();
  return result;
}

async function validateSkillsEditorConfig() {
  const config = getParsedSkillsEditorConfig();
  const result = await postJson('/api/plugin-settings/skills-config/validate', {
    config,
    source: pluginSettingsState.skillsEditorSource || 'effective',
  });
  pluginSettingsState.skillsEditorText = formatPrettyJson(result.data?.config || config);
  pluginSettingsState.skillsEditorStatus = `校验通过：${Number(result.data?.summary?.definitionCount || 0)} 个 skill，${Number(result.data?.summary?.toolCount || 0)} 个 tool。`;
  renderSkillsSection();
}

async function saveSkillsEditorConfig() {
  const config = getParsedSkillsEditorConfig();
  pluginSettingsState.skillsEditorStatus = '正在保存 skills JSON...';
  renderSkillsSection();
  const result = await postJson('/api/plugin-settings/skills-config/save', {
    config,
    source: pluginSettingsState.skillsEditorSource || 'effective',
  });
  pluginSettingsState.payload = result.settings || pluginSettingsState.payload;
  pluginSettingsState.skillsEditorPayload = result.data || pluginSettingsState.skillsEditorPayload;
  syncDraftFromPayload();
  syncSkillsDraftFromPayload();
  syncSkillsEditorFromSource(pluginSettingsState.skillsEditorSource || 'effective');
  renderCategoryTabs();
  renderGroupTabs();
  renderForm();
  renderFeatureSection();
  renderConsoleSection();
  pluginSettingsState.skillsEditorStatus = 'skills JSON 已保存，后续新会话会按最新配置加载。';
  renderSkillsSection();
  document.getElementById('plugin-settings-summary').textContent = 'skills JSON 保存成功';
}

async function resetSkillsEditorConfig() {
  pluginSettingsState.skillsEditorStatus = '正在清空运行时 skills 覆盖...';
  renderSkillsSection();
  const result = await postJson('/api/plugin-settings/skills-config/reset', {});
  pluginSettingsState.payload = result.settings || pluginSettingsState.payload;
  pluginSettingsState.skillsEditorPayload = result.data || pluginSettingsState.skillsEditorPayload;
  syncDraftFromPayload();
  syncSkillsDraftFromPayload();
  syncSkillsEditorFromSource('effective');
  renderCategoryTabs();
  renderGroupTabs();
  renderForm();
  renderFeatureSection();
  renderConsoleSection();
  pluginSettingsState.skillsEditorStatus = '已清空运行时 skills 覆盖，当前已恢复默认配置视图。';
  renderSkillsSection();
  document.getElementById('plugin-settings-summary').textContent = 'skills 已恢复默认';
}

async function loadFeatureHelpPreview() {
  pluginSettingsState.helpPreviewStatus = '正在生成帮助图预览...';
  renderFeatureSection();
  const result = await fetchJson('/api/plugin-settings/help-preview');
  pluginSettingsState.helpPreviewDataUrl = result.data?.dataUrl || '';
  pluginSettingsState.helpPreviewStatus = pluginSettingsState.helpPreviewDataUrl ? '帮助图预览已更新。' : '帮助图预览生成失败。';
  renderFeatureSection();
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadDataUrl(filename, dataUrl) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

document.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.dataset.undoRecommendation) {
    const undo = pluginSettingsState.recommendationUndo;
    if (undo?.fields) {
      Object.entries(undo.fields).forEach(([field, value]) => {
        pluginSettingsState.draft[field] = value;
      });
      pluginSettingsState.recommendationStatus = undo.message || '已恢复推荐配置应用前的值';
      pluginSettingsState.recommendationUndo = null;
      renderForm();
      renderConsoleSection();
      return;
    }
  }
  if (target.dataset.applyGroupRecommendation) {
    const groupItems = getVisibleItems().filter(item => !isAiKnowledgeField(item.field));
    const previous = {};
    const appliedLabels = [];
    groupItems.forEach(item => {
      if (Object.prototype.hasOwnProperty.call(FIELD_RECOMMENDATION_VALUES, item.field)) {
        previous[item.field] = pluginSettingsState.draft[item.field];
        pluginSettingsState.draft[item.field] = FIELD_RECOMMENDATION_VALUES[item.field];
        appliedLabels.push(item.label);
      }
    });
    pluginSettingsState.recommendationUndo = {
      fields: previous,
      message: '已撤销本组推荐配置，恢复到应用前的值',
    };
    pluginSettingsState.recommendationStatus = appliedLabels.length > 0
      ? `已应用本组推荐配置：${appliedLabels.join('、')}`
      : '当前分组没有可应用的推荐配置';
    renderForm();
    renderConsoleSection();
    return;
  }
  if (target.dataset.applyRecommendation) {
    const field = target.dataset.applyRecommendation;
    if (Object.prototype.hasOwnProperty.call(FIELD_RECOMMENDATION_VALUES, field)) {
      const item = (pluginSettingsState.payload?.items || []).find(entry => entry.field === field);
      pluginSettingsState.recommendationUndo = {
        fields: { [field]: pluginSettingsState.draft[field] },
        message: `已撤销推荐值：${item?.label || field}`,
      };
      pluginSettingsState.draft[field] = FIELD_RECOMMENDATION_VALUES[field];
      pluginSettingsState.recommendationStatus = `已应用推荐值：${item?.label || field}`;
      renderForm();
      renderConsoleSection();
      return;
    }
  }
  if (target.dataset.skillsGlobalToggle) {
    const field = target.dataset.skillsGlobalToggle;
    if (pluginSettingsState.skillsDraft && ['enabled', 'autoLoad'].includes(field)) {
      pluginSettingsState.skillsDraft[field] = !pluginSettingsState.skillsDraft[field];
      renderSkillsSection();
    }
    return;
  }
  if (target.dataset.skillsAllToggle) {
    if (pluginSettingsState.skillsDraft) {
      const enabled = target.dataset.skillsAllToggle === 'enable';
      pluginSettingsState.skillsDraft.definitions = (pluginSettingsState.skillsDraft.definitions || []).map(item => ({
        ...item,
        enabled,
        enabledToolCount: (Array.isArray(item.tools) ? item.tools : []).length,
        tools: (Array.isArray(item.tools) ? item.tools : []).map(tool => ({
          ...tool,
          enabled,
        })),
      }));
      renderSkillsSection();
    }
    return;
  }
  if (target.dataset.skillsExpandAll) {
    setSkillsExpandedByFilter(target.dataset.skillsExpandAll === 'expand');
    renderSkillsSection();
    return;
  }
  if (target.dataset.skillsPreset) {
    applySkillPreset(target.dataset.skillsPreset);
    renderSkillsSection();
    return;
  }
  if (target.dataset.skillsFilter) {
    pluginSettingsState.skillsFilter = normalizeSkillFilterValue(target.dataset.skillsFilter || 'all');
    persistSkillFilter();
    renderSkillsSection();
    return;
  }
  if (target.dataset.skillsSearchClear) {
    pluginSettingsState.skillsSearchKeyword = '';
    persistSkillsSearchKeyword();
    renderSkillsSection();
    return;
  }
  if (target.dataset.skillsViewReset) {
    resetSkillsViewState();
    renderSkillsSection();
    return;
  }
  if (target.dataset.skillsEditorLoad) {
    syncSkillsEditorFromSource(target.dataset.skillsEditorLoad || 'effective');
    pluginSettingsState.skillsEditorStatus = `已载入${pluginSettingsState.skillsEditorSource === 'runtime' ? '运行时覆盖' : pluginSettingsState.skillsEditorSource === 'default' ? '默认模板' : '当前生效配置'}。`;
    renderSkillsSection();
    return;
  }
  if (target.dataset.skillsEditorFormat) {
    try {
      pluginSettingsState.skillsEditorText = formatPrettyJson(getParsedSkillsEditorConfig());
      pluginSettingsState.skillsEditorStatus = 'JSON 已格式化。';
      renderSkillsSection();
    } catch (error) {
      pluginSettingsState.skillsEditorStatus = error.message;
      renderSkillsSection();
    }
    return;
  }
  if (target.dataset.skillsEditorValidate) {
    validateSkillsEditorConfig().catch(error => {
      pluginSettingsState.skillsEditorStatus = `校验失败：${error.message}`;
      renderSkillsSection();
    });
    return;
  }
  if (target.dataset.skillsEditorSave) {
    if (window.confirm('确认要保存当前 skills JSON 吗？这会直接覆盖运行时 skills 配置。')) {
      saveSkillsEditorConfig().catch(error => {
        pluginSettingsState.skillsEditorStatus = `保存失败：${error.message}`;
        renderSkillsSection();
      });
    }
    return;
  }
  if (target.dataset.skillsEditorReset) {
    if (window.confirm('确认要清空运行时 skills 覆盖并恢复默认吗？')) {
      resetSkillsEditorConfig().catch(error => {
        pluginSettingsState.skillsEditorStatus = `恢复默认失败：${error.message}`;
        renderSkillsSection();
      });
    }
    return;
  }
  if (target.dataset.skillToggle) {
    const skillName = target.dataset.skillToggle;
    if (pluginSettingsState.skillsDraft) {
      pluginSettingsState.skillsDraft.definitions = (pluginSettingsState.skillsDraft.definitions || []).map(item => (
        item.name === skillName ? { ...item, enabled: !item.enabled } : item
      ));
      renderSkillsSection();
    }
    return;
  }
  if (target.dataset.skillExpand) {
    const skillName = target.dataset.skillExpand;
    const skill = (pluginSettingsState.skillsDraft?.definitions || []).find(item => item.name === skillName);
    setSkillExpanded(skillName, !isSkillExpanded(skill));
    renderSkillsSection();
    return;
  }
  if (target.dataset.skillToolToggle) {
    const skillName = target.dataset.skillToolToggle;
    const toolName = target.dataset.toolName || '';
    if (pluginSettingsState.skillsDraft) {
      pluginSettingsState.skillsDraft.definitions = (pluginSettingsState.skillsDraft.definitions || []).map((item) => {
        if (item.name !== skillName) return item;
        const tools = (Array.isArray(item.tools) ? item.tools : []).map((tool) => (
          tool.name === toolName ? { ...tool, enabled: !tool.enabled } : tool
        ));
        return {
          ...item,
          enabledToolCount: tools.filter(tool => tool.enabled).length,
          tools,
        };
      });
      renderSkillsSection();
    }
    return;
  }
  if (target.dataset.featureManage) {
    const action = target.dataset.featureManage;
    const confirmTextMap = {
      disable_all: '确认要关闭全部功能吗？',
      reset: '确认要把功能开关重置为默认配置吗？',
      restore: '确认要从备份恢复当前功能开关吗？',
    };
    if (confirmTextMap[action] && !window.confirm(confirmTextMap[action])) {
      return;
    }
    manageFeatureToggles(action).then(result => {
      if (result?.data?.exportText) {
        const filename = action === 'export_backup' ? 'feature-toggle-backup.json' : 'feature-toggle-current.json';
        downloadTextFile(filename, result.data.exportText);
      }
    }).catch(error => {
      pluginSettingsState.featureManageStatus = `操作失败：${error.message}`;
      pushFeatureManageHistory(action, pluginSettingsState.featureManageStatus, false);
      renderFeatureSection();
    });
    return;
  }
  if (target.dataset.featureHelpPreview) {
    loadFeatureHelpPreview().catch(error => {
      pluginSettingsState.helpPreviewStatus = `帮助图预览失败：${error.message}`;
      renderFeatureSection();
    });
    return;
  }
  if (target.dataset.featureHelpOpen) {
    if (pluginSettingsState.helpPreviewDataUrl) {
      window.open(pluginSettingsState.helpPreviewDataUrl, '_blank');
    }
    return;
  }
  if (target.dataset.featureHelpDownload) {
    if (pluginSettingsState.helpPreviewDataUrl) {
      downloadDataUrl('feature-toggle-help-preview.png', pluginSettingsState.helpPreviewDataUrl);
    }
    return;
  }
  if (target.dataset.knowledgeEditorAction) {
    const field = 'ai.knowledgeBase';
    if (target.dataset.knowledgeEditorAction === 'fill-demo') {
      pluginSettingsState.draft[field] = buildKnowledgeDemoText();
    }
    if (target.dataset.knowledgeEditorAction === 'clear') {
      pluginSettingsState.draft[field] = '';
    }
    renderForm();
    return;
  }
  if (target.dataset.knowledgeGeneratorAction === 'generate') {
    generateKnowledgeBaseFromWeb().catch(() => {});
    return;
  }
  if (target.dataset.knowledgeGeneratorAction === 'apply') {
    applyGeneratedKnowledgePreview();
    return;
  }
  if (target.dataset.knowledgeHistoryAction === 'preview') {
    pluginSettingsState.knowledgeHistoryPreviewId = target.dataset.knowledgeHistoryId || '';
    renderForm();
    return;
  }
  if (target.dataset.knowledgeHistoryAction === 'restore') {
    restoreKnowledgeHistory(target.dataset.knowledgeHistoryId);
    return;
  }
  if (target.dataset.settingsCategory) {
    pluginSettingsState.activeCategory = target.dataset.settingsCategory;
    pluginSettingsState.recommendationStatus = '';
    pluginSettingsState.recommendationUndo = null;
    renderCategoryTabs();
    renderGroupTabs();
    renderForm();
  }
  if (target.dataset.settingsGroup) {
    pluginSettingsState.activeGroup = target.dataset.settingsGroup;
    pluginSettingsState.recommendationStatus = '';
    pluginSettingsState.recommendationUndo = null;
    renderGroupTabs();
    renderForm();
  }
  if (target.dataset.switchField) {
    const field = target.dataset.switchField;
    pluginSettingsState.draft[field] = !pluginSettingsState.draft[field];
    renderForm();
    renderConsoleSection();
  }
  if (target.dataset.pluginTopTab) {
    switchPluginTopTab(target.dataset.pluginTopTab);
  }
});

document.getElementById('plugin-settings-nav-toggle-btn').addEventListener('click', () => {
  pluginSettingsState.navCollapsed = !pluginSettingsState.navCollapsed;
  localStorage.setItem('crystelf-plugin-settings-nav-collapsed', String(pluginSettingsState.navCollapsed));
  syncNavCollapsedState();
});

document.getElementById('plugin-settings-search').addEventListener('input', event => {
  pluginSettingsState.searchKeyword = normalizeSearchText(event.target.value);
  renderCategoryTabs();
  renderGroupTabs();
  renderForm();
});

document.getElementById('plugin-settings-search-clear-btn').addEventListener('click', () => {
  pluginSettingsState.searchKeyword = '';
  document.getElementById('plugin-settings-search').value = '';
  renderCategoryTabs();
  renderGroupTabs();
  renderForm();
});

document.addEventListener('input', event => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.dataset.knowledgeGeneratorQuery !== undefined) {
    pluginSettingsState.knowledgeGenerateQuery = target.value;
    return;
  }
  if (target instanceof HTMLInputElement && target.dataset.skillsSearch !== undefined) {
    pluginSettingsState.skillsSearchKeyword = target.value;
    persistSkillsSearchKeyword();
    renderSkillsSection();
    return;
  }
  if (target instanceof HTMLTextAreaElement && target.dataset.skillsEditor !== undefined) {
    pluginSettingsState.skillsEditorText = target.value;
    return;
  }
  if (target instanceof HTMLInputElement && target.dataset.skillsField) {
    if (pluginSettingsState.skillsDraft) {
      pluginSettingsState.skillsDraft[target.dataset.skillsField] = target.value;
    }
    return;
  }
  if (!(target instanceof HTMLElement) || !target.dataset.field) return;
  const field = target.dataset.field;
  if (target instanceof HTMLTextAreaElement) {
    const item = (pluginSettingsState.payload?.items || []).find(entry => entry.field === field);
    if (item?.component === 'InputArray') {
      pluginSettingsState.draft[field] = target.value.split('\n').map(line => line.trim()).filter(Boolean);
    } else {
      pluginSettingsState.draft[field] = target.value;
    }
    return;
  }
  if (target instanceof HTMLInputElement) {
    pluginSettingsState.draft[field] = target.value;
  }
});

document.addEventListener('change', event => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.dataset.skillsField) {
    if (pluginSettingsState.skillsDraft) {
      const numeric = Number(target.value);
      pluginSettingsState.skillsDraft[target.dataset.skillsField] = Number.isFinite(numeric) ? numeric : 15000;
      renderSkillsSection();
    }
    return;
  }
  if (target instanceof HTMLInputElement && target.dataset.knowledgePreviewId) {
    const id = target.dataset.knowledgePreviewId;
    if (target.checked) {
      if (!pluginSettingsState.knowledgeSelectedPreviewIds.includes(id)) {
        pluginSettingsState.knowledgeSelectedPreviewIds.push(id);
      }
    } else {
      pluginSettingsState.knowledgeSelectedPreviewIds = pluginSettingsState.knowledgeSelectedPreviewIds.filter(item => item !== id);
    }
    return;
  }
  if (target instanceof HTMLSelectElement && target.dataset.knowledgeGenerateMode !== undefined) {
    pluginSettingsState.knowledgeGenerateMode = target.value || 'replace';
    return;
  }
  if (!(target instanceof HTMLSelectElement) || !target.dataset.field) return;
  const field = target.dataset.field;
  if (target.multiple) {
    pluginSettingsState.draft[field] = Array.from(target.selectedOptions).map(option => option.value);
  } else {
    pluginSettingsState.draft[field] = target.value;
  }
  renderConsoleSection();
});

document.getElementById('plugin-settings-save-btn').addEventListener('click', () => {
  savePluginSettings().catch(error => {
    setPluginSettingsRisk(`保存失败：${error.message}`);
  });
});

refreshPluginSettings().catch(error => {
  setPluginSettingsRisk(`加载失败：${error.message}`);
});

loadKnowledgeHistory();
loadFeatureManageHistory();
