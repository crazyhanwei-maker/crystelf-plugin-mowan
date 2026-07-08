import fs from 'fs';
import path from 'path';

function loadMemeCharacterOptions() {
  const defaultOptions = [{ label: '真寻', value: 'zhenxun' }];
  const candidatePaths = [
    path.join(process.cwd(), 'data', 'crystelf', 'cache', 'meme-characters.json'),
    path.join(process.cwd(), 'crystelf-plugin-main', 'data', 'crystelf', 'cache', 'meme-characters.json'),
  ];

  try {
    const apiPath = candidatePaths.find(filePath => fs.existsSync(filePath));
    if (apiPath) {
      const content = fs.readFileSync(apiPath, 'utf8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.slice(0, 1000).map(item => ({ label: item, value: item }));
      }
    }
  } catch (error) {
    logger.error(`[guoba] 读取表情包角色列表失败: ${error.message}`);
  }

  return defaultOptions;
}

const memeCharacterOptions = loadMemeCharacterOptions();

function loadTtsModelOptions() {
  const candidatePaths = [
    path.join(process.cwd(), 'data', 'crystelf', 'cache', 'tts-models-v4.json'),
    path.join(process.cwd(), 'crystelf-plugin-main', 'data', 'crystelf', 'cache', 'tts-models-v4.json'),
  ];

  try {
    const cachePath = candidatePaths.find(filePath => fs.existsSync(filePath));
    if (!cachePath) {
      return [];
    }

    const content = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(content);
    const models = parsed?.models || {};
    return Object.keys(models)
      .slice(0, 1000)
      .map(model => ({ label: model, value: model }));
  } catch (error) {
    logger.error(`[guoba] 读取语音模型列表失败: ${error.message}`);
    return [];
  }
}

const ttsModelOptions = loadTtsModelOptions();

const guobaSchema = [
  // config.json - 主配置
  {
    label: '主配置',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    label: '常用功能开关',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'config.ai',
    label: '晶灵智能',
    component: 'Switch',
    bottomHelpMessage: '是否启用群聊 AI 主功能',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.privateAi',
    label: '私聊 AI',
    component: 'Switch',
    bottomHelpMessage: '是否启用私聊 AI 对话；关闭后不影响群聊 AI',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.privateAiImage',
    label: '私聊生图',
    component: 'Switch',
    bottomHelpMessage: '是否允许私聊 AI 触发生图/改图能力；关闭后群聊生图不受影响。',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.privateAiVoice',
    label: '私聊语音',
    component: 'Switch',
    bottomHelpMessage: '是否允许私聊 #合成语音、语音模型切换，以及 AI 主动返回语音。',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.privateAiMeme',
    label: '私聊表情包',
    component: 'Switch',
    bottomHelpMessage: '是否允许私聊 AI 发送表情包；关闭后仍可正常文本聊天。',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.privateAiSkills',
    label: '私聊联网与 Skills',
    component: 'Switch',
    bottomHelpMessage: '是否允许私聊 AI 使用联网搜索、网页读取和 Skills 工具；关闭后只进行普通对话。',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    label: '私聊 AI 用户范围',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'config.privateAiWhitelist',
    label: '私聊 AI 用户白名单',
    component: 'InputArray',
    bottomHelpMessage: '每行一个 QQ。留空表示不限制私聊用户；填写后只有名单内用户可使用私聊 AI。黑名单优先，主人默认不受名单限制。',
  },
  {
    field: 'config.privateAiBlacklist',
    label: '私聊 AI 用户黑名单',
    component: 'InputArray',
    bottomHelpMessage: '每行一个 QQ。命中后不进入私聊 AI 主流程；这和“私聊安全黑名单”分开，用于手动限制使用权限。',
  },
  {
    label: '私聊 AI 安全',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'config.privateAiSafety.enabled',
    label: '私聊安全检查',
    component: 'Switch',
    bottomHelpMessage: '开启后，私聊消息会先经过安全门禁，再进入主 AI 对话。',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.privateAiSafety.contentGuard',
    label: '内容安全拦截',
    component: 'Switch',
    bottomHelpMessage: '拦截诱导 AI 输出受限内容、违法违规内容或绕过安全规则的私聊请求。',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.privateAiSafety.llmReview',
    label: 'LLM 复审',
    component: 'Switch',
    bottomHelpMessage: '本地规则不确定时调用 AI 做安全分类。',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.privateAiSafety.llmReviewAll',
    label: '全量 LLM 复审',
    component: 'Switch',
    bottomHelpMessage: '开启后每条私聊都会先做一次安全分类；默认关键词为空时建议开启。',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.privateAiSafety.reviewCacheEnabled',
    label: 'LLM 复审缓存',
    component: 'Switch',
    bottomHelpMessage: '开启后，相同私聊内容的安全复审结果会按哈希缓存，不保存原文，减少重复调用。',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.privateAiSafety.reviewCacheTtlHours',
    label: '复审缓存小时',
    component: 'InputNumber',
    bottomHelpMessage: 'LLM 安全复审缓存的有效期，超过后会自动重新复审。',
    componentProps: {
      min: 1,
      max: 720,
      step: 1,
      placeholder: '请输入缓存有效期',
    },
  },
  {
    field: 'config.privateAiSafety.warnBeforeBlacklist',
    label: '先警告再拉黑',
    component: 'Switch',
    bottomHelpMessage: '开启后，普通风险先警告；达到阈值后再加入私聊黑名单。',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.privateAiSafety.directBlacklistHighRisk',
    label: '高风险直接拉黑',
    component: 'Switch',
    bottomHelpMessage: '命中高风险本地规则时直接加入私聊黑名单；高风险词由用户自行填写。',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.privateAiSafety.ownerNotify',
    label: '拉黑通知主人',
    component: 'Switch',
    bottomHelpMessage: '私聊用户被安全策略拉黑时，尝试私聊通知机器人主人。',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.privateAiSafety.riskKeywords',
    label: '风险关键词',
    component: 'InputTextArea',
    bottomHelpMessage: '每行一个。默认不内置任何词，请按自己的合规标准填写。',
    componentProps: {
      rows: 4,
      placeholder: '每行一个关键词，默认留空',
    },
  },
  {
    field: 'config.privateAiSafety.highRiskKeywords',
    label: '高风险关键词',
    component: 'InputTextArea',
    bottomHelpMessage: '每行一个。命中后可按配置直接拉黑，请谨慎填写。',
    componentProps: {
      rows: 4,
      placeholder: '每行一个关键词，默认留空',
    },
  },
  {
    field: 'config.privateAiSafety.bypassKeywords',
    label: '绕过规则关键词',
    component: 'InputTextArea',
    bottomHelpMessage: '每行一个。用于识别尝试绕过规则或要求忽略限制的表达。',
    componentProps: {
      rows: 4,
      placeholder: '每行一个关键词，默认留空',
    },
  },
  {
    field: 'config.privateAiSafety.intentKeywords',
    label: '生成意图关键词',
    component: 'InputTextArea',
    bottomHelpMessage: '每行一个。用于和风险关键词组合判断是否在要求生成内容。',
    componentProps: {
      rows: 4,
      placeholder: '每行一个关键词，默认留空',
    },
  },
  {
    field: 'config.privateAiSafety.safeContextKeywords',
    label: '安全讨论放行词',
    component: 'InputTextArea',
    bottomHelpMessage: '每行一个。用于减少合规讨论、风险说明、规则设置等正常内容的误伤。',
    componentProps: {
      rows: 4,
      placeholder: '每行一个关键词，默认留空',
    },
  },
  {
    field: 'config.privateAiSafety.maxWarnings',
    label: '拉黑阈值',
    component: 'InputNumber',
    bottomHelpMessage: '同一用户在警告窗口内累计多少次后加入私聊黑名单。',
    componentProps: {
      min: 1,
      max: 10,
      step: 1,
      placeholder: '请输入拉黑阈值',
    },
  },
  {
    field: 'config.privateAiSafety.windowHours',
    label: '警告窗口小时',
    component: 'InputNumber',
    bottomHelpMessage: '只统计该时间窗口内的私聊安全警告次数。',
    componentProps: {
      min: 1,
      max: 720,
      step: 1,
      placeholder: '请输入警告窗口小时',
    },
  },
  {
    field: 'config.privateAiSafety.blacklistDurationHours',
    label: '拉黑时长小时',
    component: 'InputNumber',
    bottomHelpMessage: '加入私聊黑名单后的持续时间；填 0 表示永久。',
    componentProps: {
      min: 0,
      max: 87600,
      step: 1,
      placeholder: '请输入拉黑时长',
    },
  },
  {
    field: 'config.privateAiSafety.warningReply',
    label: '警告回复',
    component: 'InputTextArea',
    bottomHelpMessage: '用户首次或未达到阈值时收到的合规提醒。',
    componentProps: {
      rows: 3,
      placeholder: '请输入私聊安全警告回复',
    },
  },
  {
    field: 'config.privateAiSafety.blacklistReply',
    label: '拉黑回复',
    component: 'InputTextArea',
    bottomHelpMessage: '黑名单用户再次触发私聊 AI 时收到的固定回复。',
    componentProps: {
      rows: 3,
      placeholder: '请输入私聊黑名单回复',
    },
  },
  {
    field: 'config.poke',
    label: '戳一戳功能',
    component: 'Switch',
    bottomHelpMessage: '是否启用戳一戳功能',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.faceReply',
    label: '表情回复（贴表情）',
    component: 'Switch',
    bottomHelpMessage: '是否启用表情回复功能',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.imageMonitor',
    label: '图片监控',
    component: 'Switch',
    bottomHelpMessage: '是否启用独立图片监控、表情包识别入库与违规图片审核链路',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.help',
    label: '帮助功能',
    component: 'Switch',
    bottomHelpMessage: '是否启用帮助功能',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.status',
    label: '状态查询',
    component: 'Switch',
    bottomHelpMessage: '是否启用 #灵晶状态 运行状态查询命令',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.logDiagnosis',
    label: 'QQ 日志排查',
    component: 'Switch',
    bottomHelpMessage: '是否启用 #灵晶排查日志；仅主人可触发，会读取最近日志并交给 AI 排查',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.dependencyRepair',
    label: 'QQ 依赖修复',
    component: 'Switch',
    bottomHelpMessage: '是否启用 #灵晶修复依赖、#修复依赖 与依赖修复状态；#修复依赖允许群主/管理员预检后确认修复，并在成功后重启 Bot',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.auth',
    label: '入群验证功能',
    component: 'Switch',
    bottomHelpMessage: '是否启用入群验证',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.groupManagement',
    label: '群管理运行时',
    component: 'Switch',
    bottomHelpMessage: '是否启用群消息风控、黑白名单、警告积分等群管理运行时能力',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.groupTitle',
    label: '群头衔申请',
    component: 'Switch',
    bottomHelpMessage: '是否启用群头衔申请功能；实际设置头衔要求机器人在对应群是群主',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.rss',
    label: 'RSS订阅',
    component: 'Switch',
    bottomHelpMessage: '是否启用RSS订阅功能',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.music',
    label: '点歌',
    component: 'Switch',
    bottomHelpMessage: '是否启用点歌功能',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.60s',
    label: '60s新闻',
    component: 'Switch',
    bottomHelpMessage: '是否启用60s新闻功能',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.zwa',
    label: '早晚安',
    component: 'Switch',
    bottomHelpMessage: '是否启用早晚安功能',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    label: '本群管理',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'config.welcome',
    label: '入群欢迎功能',
    component: 'Switch',
    bottomHelpMessage: '是否启用欢迎功能；本群欢迎文案和欢迎图片请在控制台“群管理”里按群配置',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    label: '群头衔申请',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'groupTitle.enabled',
    label: '启用头衔申请',
    component: 'Switch',
    bottomHelpMessage: '开启后群成员可发送 #申请头衔 xxx，管理员审核后由机器人设置专属头衔',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'groupTitle.allowedGroups',
    label: '允许申请群',
    component: 'InputArray',
    bottomHelpMessage: '允许使用头衔申请的群号，留空表示全部群可用',
    componentProps: {
      placeholder: '请输入群号，按回车添加',
    },
  },
  {
    field: 'groupTitle.blockedGroups',
    label: '禁止申请群',
    component: 'InputArray',
    bottomHelpMessage: '命中这些群号时不会处理头衔申请',
    componentProps: {
      placeholder: '请输入群号，按回车添加',
    },
  },
  {
    field: 'groupTitle.approvalRoles',
    label: '审核身份',
    component: 'InputArray',
    bottomHelpMessage: '可填写 owner、admin；机器人主人始终可审核',
    componentProps: {
      placeholder: 'owner 或 admin',
    },
  },
  {
    field: 'groupTitle.forbiddenKeywords',
    label: '头衔禁用词',
    component: 'InputArray',
    bottomHelpMessage: '申请头衔或控制台发放时命中这些词会被拒绝；适合填写管理员、官方、广告等词',
    componentProps: {
      placeholder: '请输入禁用词，按回车添加',
    },
  },
  {
    field: 'groupTitle.maxDisplayWidth',
    label: '头衔长度上限',
    component: 'InputNumber',
    bottomHelpMessage: '中文通常按 2 计算；12 约等于 6 个中文字符',
    componentProps: {
      min: 2,
      max: 24,
      step: 1,
      placeholder: '请输入头衔长度上限',
    },
  },
  {
    field: 'groupTitle.pendingExpireHours',
    label: '申请过期小时',
    component: 'InputNumber',
    bottomHelpMessage: '待审核申请超过该时间后自动过期',
    componentProps: {
      min: 1,
      max: 720,
      step: 1,
      placeholder: '请输入过期小时',
    },
  },
  {
    field: 'groupTitle.autoApprove',
    label: '自动通过申请',
    component: 'Switch',
    bottomHelpMessage: '开启后 #申请头衔 的合法头衔会跳过人工/AI审核并立即发放；仍要求机器人是群主',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'groupTitle.aiReview.enabled',
    label: 'AI自动审核头衔',
    component: 'Switch',
    bottomHelpMessage: '开启后 #申请头衔 会先让 AI 判断是否合法；合法则自动通过并发放头衔',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'groupTitle.aiReview.autoRejectIllegal',
    label: 'AI自动拒绝违规',
    component: 'Switch',
    bottomHelpMessage: '开启后 AI 判断不合法会直接拒绝；关闭则保留申请给管理员人工审核',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'groupTitle.aiReview.model',
    label: 'AI审核模型',
    component: 'Input',
    bottomHelpMessage: '留空时使用 ai.workingModel、ai.modelType 或 ai.model',
    componentProps: {
      placeholder: '例如 gpt-5.2-mini，留空自动回退',
    },
  },
  {
    field: 'groupTitle.aiReview.temperature',
    label: 'AI审核温度',
    component: 'InputNumber',
    bottomHelpMessage: '建议保持 0，让审核结果更稳定',
    componentProps: {
      min: 0,
      max: 2,
      step: 0.1,
      precision: 1,
      placeholder: '请输入审核温度',
    },
  },
  {
    field: 'groupTitle.aiReview.maxTokens',
    label: 'AI审核输出上限',
    component: 'InputNumber',
    bottomHelpMessage: '只需要输出短 JSON，默认 300 通常足够',
    componentProps: {
      min: 100,
      max: 1000,
      step: 50,
      placeholder: '请输入最大 token',
    },
  },
  {
    field: 'groupTitle.aiReview.policy',
    label: 'AI审核规则',
    component: 'InputTextArea',
    bottomHelpMessage: '用于告诉 AI 哪些头衔应通过或拒绝',
    componentProps: {
      rows: 4,
      placeholder: '请输入头衔审核规则',
    },
  },
  {
    label: '戳一戳回复设置',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'poke.enableTextReply',
    label: '文本回复',
    component: 'Switch',
    bottomHelpMessage: '是否在戳一戳时发送文本回复',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'poke.enableMemeReply',
    label: '表情包回复',
    component: 'Switch',
    bottomHelpMessage: '是否在戳一戳时附带发送表情包',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'poke.memeReplyProbability',
    label: '表情包概率',
    component: 'InputNumber',
    bottomHelpMessage: '戳一戳时附带发送表情包的概率(0-1)',
    componentProps: {
      min: 0,
      max: 1,
      step: 0.05,
      placeholder: '请输入表情包概率',
    },
  },
  {
    field: 'poke.enableVoiceReply',
    label: '语音回复',
    component: 'Switch',
    bottomHelpMessage: '是否在戳一戳时优先发送语音回复',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'poke.voiceReplyProbability',
    label: '语音概率',
    component: 'InputNumber',
    bottomHelpMessage: '戳一戳时优先发送语音的概率(0-1)',
    componentProps: {
      min: 0,
      max: 1,
      step: 0.05,
      placeholder: '请输入语音概率',
    },
  },
  {
    field: 'poke.cooldownMs',
    label: '用户冷却时间',
    component: 'InputNumber',
    bottomHelpMessage: '同一用户连续戳一戳的冷却时间(毫秒)',
    componentProps: {
      min: 0,
      max: 600000,
      step: 1000,
      placeholder: '请输入冷却时间',
    },
  },
  {
    field: 'poke.groupRateWindowMs',
    label: '群限频窗口',
    component: 'InputNumber',
    bottomHelpMessage: '群内戳一戳限频统计窗口(毫秒)',
    componentProps: {
      min: 1000,
      max: 3600000,
      step: 1000,
      placeholder: '请输入限频窗口',
    },
  },
  {
    field: 'poke.groupRateMaxReplies',
    label: '群窗口回复上限',
    component: 'InputNumber',
    bottomHelpMessage: '群内限频窗口中最多允许回复多少次',
    componentProps: {
      min: 1,
      max: 100,
      step: 1,
      placeholder: '请输入回复上限',
    },
  },
  {
    field: 'poke.maxReplyMessages',
    label: '最大回复条数',
    component: 'InputNumber',
    bottomHelpMessage: '一次戳一戳最多允许回复多少条，由 AI 在范围内决定实际回复条数',
    componentProps: {
      min: 1,
      max: 10,
      step: 1,
      placeholder: '请输入最大回复条数',
    },
  },
  {
    field: 'poke.followGroupAfterPoke',
    label: '继续监听群聊',
    component: 'Switch',
    bottomHelpMessage: '戳完后是否继续监听接下来几秒的群聊，并由 AI 自主决定是否继续回复',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'poke.followGroupWindowMs',
    label: '监听时长',
    component: 'InputNumber',
    bottomHelpMessage: '戳完后继续监听群聊的时长(毫秒)',
    componentProps: {
      min: 1000,
      max: 600000,
      step: 1000,
      placeholder: '请输入监听时长',
    },
  },
  {
    field: 'poke.followGroupMaxReplies',
    label: '追踪回复上限',
    component: 'InputNumber',
    bottomHelpMessage: '监听窗口内最多继续回复多少次',
    componentProps: {
      min: 0,
      max: 20,
      step: 1,
      placeholder: '请输入追踪回复上限',
    },
  },
  {
    label: '本地控制台设置',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'config.webConsole',
    label: '本地控制台',
    component: 'Switch',
    bottomHelpMessage: '是否启用随 bot 启动的本地控制台网页',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.webConsoleToken',
    label: '控制台登录口令',
    component: 'InputPassword',
    required: false,
    bottomHelpMessage: '控制台登录页使用的口令。留空时启动控制台会自动生成随机口令、写入运行配置并在启动日志输出；控制台始终要求登录',
    componentProps: {
      placeholder: '请输入控制台登录口令',
    },
  },
  {
    field: 'config.webConsolePublicUrl',
    label: '控制台公网地址',
    component: 'Input',
    bottomHelpMessage: '用于 #灵晶登录 生成一次性登录链接。部署到服务器或反向代理后建议填写完整 http/https 地址，留空则使用当前监听地址',
    componentProps: {
      placeholder: '例如 https://console.example.com',
    },
  },
  {
    field: 'config.webConsoleReadOnly',
    label: '只读模式',
    component: 'Switch',
    bottomHelpMessage: '开启后禁止通过控制台删除画像、重置好感等写操作',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.webConsoleHost',
    label: '控制台地址',
    component: 'Input',
    bottomHelpMessage: '默认 0.0.0.0 监听所有网卡，可局域网/公网访问；请务必使用强口令并限制访问来源',
    componentProps: {
      placeholder: '请输入监听地址',
    },
  },
  {
    field: 'config.webConsolePort',
    label: '控制台端口',
    component: 'InputNumber',
    bottomHelpMessage: '控制台固定监听端口，默认建议使用 27891',
    componentProps: {
      min: 1,
      max: 65535,
      step: 1,
      placeholder: '请输入端口',
    },
  },
  {
    field: 'config.webConsolePortAutoIncrement',
    label: '端口自动递增',
    component: 'Switch',
    bottomHelpMessage: '端口冲突时是否自动尝试下一个端口，默认建议关闭以保持固定地址',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.webConsoleBackgroundSourceUrl',
    label: '控制台壁纸源',
    component: 'Input',
    bottomHelpMessage: '换壁纸按钮使用的随机图片接口。留空时使用本地动态壁纸兜底；建议填写直接返回图片或跳转到图片的 http/https 地址',
    componentProps: {
      placeholder: '例如 https://www.loliapi.com/acg/pc/',
    },
  },
  {
    field: 'config.webConsolePageSize',
    label: '控制台每页数量',
    component: 'InputNumber',
    bottomHelpMessage: '控制台列表默认每页展示多少条数据',
    componentProps: {
      min: 1,
      max: 100,
      step: 1,
      placeholder: '请输入每页数量',
    },
  },
  {
    field: 'config.webConsoleMaxPageSize',
    label: '最大每页数量',
    component: 'InputNumber',
    bottomHelpMessage: '接口允许的最大分页数量，防止一次读取过多数据',
    componentProps: {
      min: 1,
      max: 500,
      step: 1,
      placeholder: '请输入最大每页数量',
    },
  },
  {
    field: 'config.webConsoleExposeLogs',
    label: '显示日志',
    component: 'Switch',
    bottomHelpMessage: '是否允许控制台显示 AI 用量日志和好感度日志',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.webConsoleLogTailLength',
    label: '日志读取长度',
    component: 'InputNumber',
    bottomHelpMessage: '日志接口默认返回尾部多少字符',
    componentProps: {
      min: 1000,
      max: 200000,
      step: 1000,
      placeholder: '请输入日志长度',
    },
  },
  {
    field: 'config.webConsoleMaskSensitiveConfig',
    label: '隐藏敏感配置',
    component: 'Switch',
    bottomHelpMessage: '是否对一般敏感配置做掩码处理；控制台登录口令和各类 API 密钥始终不会明文返回到前端',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.webConsoleProfileRecentMessagesLimit',
    label: '画像消息条数',
    component: 'InputNumber',
    bottomHelpMessage: '画像详情页展示最近多少条相关消息，0 表示不展示',
    componentProps: {
      min: 0,
      max: 100,
      step: 1,
      placeholder: '请输入展示条数',
    },
  },
  {
    field: 'config.webConsoleAffinityHistoryLimit',
    label: '好感历史条数',
    component: 'InputNumber',
    bottomHelpMessage: '好感历史详情页最多返回多少条变更记录',
    componentProps: {
      min: 1,
      max: 500,
      step: 1,
      placeholder: '请输入返回条数',
    },
  },
  {
    label: '插件维护',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'config.autoUpdate',
    label: '自动更新',
    component: 'Switch',
    bottomHelpMessage: '是否自动更新插件',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'config.maxFeed',
    label: '最长订阅',
    component: 'InputNumber',
    bottomHelpMessage: '最长订阅数量',
    componentProps: {
      min: 1,
      max: 50,
      step: 1,
      placeholder: '请输入最长订阅数量',
    },
  },

  // coreConfig.json - 核心与工具配置
  {
    label: '核心与工具配置',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    label: '使用量限制',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'coreConfig.usageControl.enabled',
    label: '启用用量限制',
    component: 'Switch',
    bottomHelpMessage: '开启后会按每日请求数或token总量进行熔断控制',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'coreConfig.usageControl.dailyTokenLimit',
    label: '每日Token上限',
    component: 'InputNumber',
    bottomHelpMessage: '每日累计总token上限，0表示不限制',
    componentProps: {
      min: 0,
      step: 1000,
      placeholder: '请输入每日Token上限',
    },
  },
  {
    field: 'coreConfig.usageControl.dailyRequestLimit',
    label: '每日请求上限',
    component: 'InputNumber',
    bottomHelpMessage: '每日累计请求次数上限，0表示不限制',
    componentProps: {
      min: 0,
      step: 10,
      placeholder: '请输入每日请求上限',
    },
  },
  {
    field: 'coreConfig.usageControl.blockChat',
    label: '限制聊天AI',
    component: 'Switch',
    bottomHelpMessage: '超限后是否阻止普通群聊AI继续调用',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'coreConfig.usageControl.blockPoke',
    label: '限制戳一戳AI',
    component: 'Switch',
    bottomHelpMessage: '超限后是否阻止戳一戳AI继续调用',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'coreConfig.usageControl.pricingEnabled',
    label: '启用成本估算',
    component: 'Switch',
    bottomHelpMessage: '按输入/输出token单价估算今日成本',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'coreConfig.usageControl.currencySymbol',
    label: '货币符号',
    component: 'Input',
    bottomHelpMessage: '成本展示使用的货币符号，例如 $ 或 ¥',
    componentProps: {
      placeholder: '请输入货币符号',
    },
  },
  {
    field: 'coreConfig.usageControl.promptPricePer1M',
    label: '输入单价/1M',
    component: 'InputNumber',
    bottomHelpMessage: '每100万输入token价格，用于估算成本',
    componentProps: {
      min: 0,
      step: 0.001,
      precision: 6,
      placeholder: '请输入输入token单价',
    },
  },
  {
    field: 'coreConfig.usageControl.completionPricePer1M',
    label: '输出单价/1M',
    component: 'InputNumber',
    bottomHelpMessage: '每100万输出token价格，用于估算成本',
    componentProps: {
      min: 0,
      step: 0.001,
      precision: 6,
      placeholder: '请输入输出token单价',
    },
  },
  {
    field: 'coreConfig.usageControl.modelPricing',
    label: '模型单价表',
    component: 'InputTextArea',
    bottomHelpMessage: '每行一个模型，格式：模型名|输入单价/1M|输出单价/1M；未匹配时回退到全局单价',
    componentProps: {
      rows: 6,
      placeholder: '例如\nqwen-plus|0.8|2\ndeepseek-chat|0.27|1.1',
    },
  },
  {
    field: 'coreConfig.usageControl.dailySummary',
    label: '今日用量概览',
    component: 'InputTextArea',
    bottomHelpMessage: '根据本地 ai-usage.log 动态汇总，仅展示不可编辑',
    componentProps: {
      rows: 7,
      readonly: true,
      placeholder: '暂无用量数据',
    },
  },
  {
    field: 'coreConfig.usageControl.dailySceneSummary',
    label: '今日场景分布',
    component: 'InputTextArea',
    bottomHelpMessage: '按调用场景统计今日请求数与token消耗，仅展示不可编辑',
    componentProps: {
      rows: 8,
      readonly: true,
      placeholder: '暂无场景统计',
    },
  },
  {
    field: 'coreConfig.usageControl.dailyModelSummary',
    label: '今日模型分布',
    component: 'InputTextArea',
    bottomHelpMessage: '按模型统计今日请求数与token消耗，仅展示不可编辑',
    componentProps: {
      rows: 8,
      readonly: true,
      placeholder: '暂无模型统计',
    },
  },
  {
    field: 'coreConfig.usageControl.dailyCostSummary',
    label: '今日成本估算',
    component: 'InputTextArea',
    bottomHelpMessage: '基于单价配置估算今日总成本，仅展示不可编辑',
    componentProps: {
      rows: 6,
      readonly: true,
      placeholder: '暂无成本统计',
    },
  },
  {
    field: 'coreConfig.usageControl.dailyModelCostSummary',
    label: '今日模型成本',
    component: 'InputTextArea',
    bottomHelpMessage: '按模型统计今日请求数、token与预估成本，仅展示不可编辑',
    componentProps: {
      rows: 8,
      readonly: true,
      placeholder: '暂无模型成本统计',
    },
  },
  {
    field: 'coreConfig.usageControl.dailyLogFile',
    label: '今日日志文件',
    component: 'Input',
    bottomHelpMessage: '按天切分后的今日日志路径，仅展示不可编辑',
    componentProps: {
      readonly: true,
      placeholder: '暂无今日日志文件',
    },
  },
  {
    field: 'coreConfig.usageControl.totalLogFile',
    label: '总日志文件',
    component: 'Input',
    bottomHelpMessage: '完整累计日志文件路径，仅展示不可编辑',
    componentProps: {
      readonly: true,
      placeholder: '暂无总日志文件',
    },
  },
  {
    label: '工具配置',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'coreConfig.tools.search.enabled',
    label: '启用内置搜索',
    component: 'Switch',
    bottomHelpMessage: '是否启用内置 search_web 工具',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'coreConfig.tools.search.apiUrl',
    label: '搜索API地址',
    component: 'Input',
    bottomHelpMessage: '内置搜索工具使用的聚合搜索接口地址，例如 https://uapis.cn/api/v1/search/aggregate',
    componentProps: {
      placeholder: '请输入搜索API地址',
    },
  },
  {
    field: 'coreConfig.tools.search.apiKey',
    label: '搜索API密钥',
    component: 'InputPassword',
    bottomHelpMessage: '搜索服务的API密钥，可留空',
    componentProps: {
      placeholder: '请输入搜索API密钥',
    },
  },
  {
    field: 'coreConfig.tools.search.markdownApiUrl',
    label: '网页转Markdown提交地址',
    component: 'Input',
    bottomHelpMessage: '用于提交网页转 Markdown 任务的接口地址',
    componentProps: {
      placeholder: '请输入网页转 Markdown 提交地址',
    },
  },
  {
    field: 'coreConfig.tools.search.markdownStatusUrl',
    label: '网页转Markdown状态地址',
    component: 'Input',
    bottomHelpMessage: '用于拼接 task_id 后查询网页转 Markdown 任务结果的基础地址',
    componentProps: {
      placeholder: '请输入网页转 Markdown 状态基础地址',
    },
  },
  {
    field: 'coreConfig.tools.search.maxResults',
    label: '默认结果数',
    component: 'InputNumber',
    bottomHelpMessage: '每次默认返回的搜索结果数量',
    componentProps: {
      min: 1,
      max: 10,
      step: 1,
      placeholder: '请输入默认结果数',
    },
  },
  {
    field: 'coreConfig.tools.search.fetchFull',
    label: '抓取完整正文',
    component: 'Switch',
    bottomHelpMessage: '是否默认获取完整网页正文',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'coreConfig.tools.search.markdownMaxLength',
    label: '网页正文最大长度',
    component: 'InputNumber',
    bottomHelpMessage: '网页转 Markdown 返回给 AI 的最大字符数',
    componentProps: {
      min: 1000,
      max: 40000,
      step: 500,
      placeholder: '请输入网页正文最大长度',
    },
  },
  {
    field: 'coreConfig.tools.search.timeoutMs',
    label: '搜索超时',
    component: 'InputNumber',
    bottomHelpMessage: '客户端等待超时时间（毫秒），默认 60000；接口内部 timeout_ms 会自动限制在 1000-30000',
    componentProps: {
      min: 1000,
      max: 60000,
      step: 1000,
      placeholder: '请输入搜索超时',
    },
  },
  {
    label: '语音工具配置',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'coreConfig.tools.tts.enabled',
    label: '启用内置语音',
    component: 'Switch',
    bottomHelpMessage: '是否启用内置语音合成工具 speak_text',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'coreConfig.tools.tts.apiUrl',
    label: '语音接口地址',
    component: 'Input',
    bottomHelpMessage: '文本转语音接口地址，例如 http://127.0.0.1:8000/infer_single',
    componentProps: {
      placeholder: '请输入语音合成接口地址',
    },
  },
  {
    field: 'coreConfig.tools.tts.dlUrl',
    label: '语音服务基础地址',
    component: 'Input',
    bottomHelpMessage: '会作为 dl_url 一并传给 infer_single，通常填服务根地址',
    componentProps: {
      placeholder: '请输入语音服务基础地址',
    },
  },
  {
    field: 'coreConfig.tools.tts.modelsUrl',
    label: '模型列表地址',
    component: 'Input',
    bottomHelpMessage: '模型列表接口地址，例如 http://127.0.0.1:8000/models/v4',
    componentProps: {
      placeholder: '请输入模型列表接口地址',
    },
  },
  {
    field: 'coreConfig.tools.tts.fallbackApi.enabled',
    label: '启用语音备用API',
    component: 'Switch',
    bottomHelpMessage: '主语音接口不可用时，是否允许切换到备用语音服务',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'coreConfig.tools.tts.fallbackApi.apiUrl',
    label: '备用语音接口地址',
    component: 'Input',
    bottomHelpMessage: '备用文本转语音接口地址，例如 http://127.0.0.1:8001/infer_single',
    componentProps: {
      placeholder: '请输入备用语音合成接口地址',
    },
  },
  {
    field: 'coreConfig.tools.tts.fallbackApi.dlUrl',
    label: '备用语音服务基础地址',
    component: 'Input',
    bottomHelpMessage: '备用服务的 dl_url 根地址，通常填备用语音服务根地址',
    componentProps: {
      placeholder: '请输入备用语音服务基础地址',
    },
  },
  {
    field: 'coreConfig.tools.tts.fallbackApi.modelsUrl',
    label: '备用模型列表地址',
    component: 'Input',
    bottomHelpMessage: '备用模型列表接口地址，例如 http://127.0.0.1:8001/models/v4',
    componentProps: {
      placeholder: '请输入备用模型列表接口地址',
    },
  },
  {
    field: 'coreConfig.tools.tts.fallbackApi.autoSwitchEnabled',
    label: '语音自动主备切换',
    component: 'Switch',
    bottomHelpMessage: '主语音接口连续失败后，短时间优先使用备用语音服务',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'coreConfig.tools.tts.fallbackApi.failureThreshold',
    label: '语音切换失败次数',
    component: 'InputNumber',
    bottomHelpMessage: '主语音接口连续失败达到该次数后进入备用优先',
    componentProps: {
      min: 1,
      max: 10,
      step: 1,
      placeholder: '请输入失败次数',
    },
  },
  {
    field: 'coreConfig.tools.tts.fallbackApi.cooldownMs',
    label: '语音切换冷却时间',
    component: 'InputNumber',
    bottomHelpMessage: '进入备用优先后持续多久，单位毫秒；默认 300000 表示 5 分钟',
    componentProps: {
      min: 30000,
      max: 1800000,
      step: 30000,
      placeholder: '请输入冷却时间',
    },
  },
  {
    field: 'coreConfig.tools.tts.defaultModel',
    label: '默认语音模型',
    component: 'Select',
    bottomHelpMessage: ttsModelOptions.length > 0 ? '直接选择默认语音模型' : '暂无缓存模型列表，请先打开一次设置页刷新模型列表后再重开页面',
    componentProps: {
      options: ttsModelOptions,
      showSearch: true,
      placeholder: ttsModelOptions.length > 0 ? '请选择默认语音模型' : '暂无可选模型，请先刷新模型列表',
    },
  },
  {
    field: 'coreConfig.tools.tts.defaultLanguage',
    label: '默认语言',
    component: 'Input',
    bottomHelpMessage: '默认语言，例如 中文、日语',
    componentProps: {
      placeholder: '请输入默认语言',
    },
  },
  {
    field: 'coreConfig.tools.tts.defaultEmotion',
    label: '默认情感',
    component: 'Input',
    bottomHelpMessage: '默认情感，若模型不支持会自动回退到该模型可用情感',
    componentProps: {
      placeholder: '请输入默认情感',
    },
  },
  {
    field: 'coreConfig.tools.tts.mediaType',
    label: '输出音频类型',
    component: 'Select',
    bottomHelpMessage: '语音接口返回的音频类型',
    componentProps: {
      options: [
        { label: 'wav', value: 'wav' },
        { label: 'mp3', value: 'mp3' },
        { label: 'ogg', value: 'ogg' },
      ],
      placeholder: '请选择音频类型',
    },
  },
  {
    field: 'coreConfig.tools.tts.maxTextLength',
    label: '最大文本长度',
    component: 'InputNumber',
    bottomHelpMessage: '单次语音合成允许的最大文本长度',
    componentProps: {
      min: 1,
      max: 500,
      step: 10,
      placeholder: '请输入最大文本长度',
    },
  },
  {
    field: 'coreConfig.tools.tts.autoSendVoice',
    label: '自动发送语音',
    component: 'Switch',
    bottomHelpMessage: '工具调用成功后是否直接发送语音消息',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'coreConfig.tools.tts.allowAiTrigger',
    label: '允许AI主动语音',
    component: 'Switch',
    bottomHelpMessage: '允许AI在合适场景主动调用语音合成工具',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'coreConfig.tools.tts.maxAutoVoiceTextLength',
    label: '自动语音最大长度',
    component: 'InputNumber',
    bottomHelpMessage: 'AI自动选择语音时允许的最大文本长度，超过则改为文字',
    componentProps: {
      min: 1,
      max: 200,
      step: 1,
      placeholder: '请输入自动语音最大长度',
    },
  },
  {
    field: 'coreConfig.tools.tts.allowedAutoScenes',
    label: '自动语音场景',
    component: 'Input',
    bottomHelpMessage: '逗号分隔。reply=普通群聊/被@/昵称触发回复；poked=戳一戳回复（不是 poke）；留空=不限制场景。#合成语音 属于强制语音，不受这里限制',
    componentProps: {
      placeholder: '例如 reply,poked',
    },
  },
  {
    field: 'coreConfig.tools.tts.requireVoiceKeywords',
    label: '要求语音关键词',
    component: 'Switch',
    bottomHelpMessage: '开启后，仅当用户消息含“语音/念出来/发语音”等词时才允许AI自动语音',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'coreConfig.tools.tts.temperature',
    label: '语音温度',
    component: 'InputNumber',
    bottomHelpMessage: '语音采样温度',
    componentProps: {
      min: 0,
      max: 2,
      step: 0.1,
      precision: 2,
      placeholder: '请输入语音温度',
    },
  },
  {
    field: 'coreConfig.tools.tts.topK',
    label: 'Top K',
    component: 'InputNumber',
    bottomHelpMessage: '语音采样 top_k',
    componentProps: {
      min: 1,
      max: 100,
      step: 1,
      placeholder: '请输入 top_k',
    },
  },
  {
    field: 'coreConfig.tools.tts.topP',
    label: 'Top P',
    component: 'InputNumber',
    bottomHelpMessage: '语音采样 top_p',
    componentProps: {
      min: 0,
      max: 1,
      step: 0.05,
      precision: 2,
      placeholder: '请输入 top_p',
    },
  },
  {
    field: 'coreConfig.tools.tts.speed',
    label: '语速倍率',
    component: 'InputNumber',
    bottomHelpMessage: '语音播放速度倍率',
    componentProps: {
      min: 0.5,
      max: 2,
      step: 0.1,
      precision: 2,
      placeholder: '请输入语速倍率',
    },
  },
  {
    label: '语音高级参数',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'coreConfig.tools.tts.version',
    label: '模型版本标识',
    component: 'Input',
    bottomHelpMessage: '传给语音服务的版本标识，例如 v4',
    componentProps: {
      placeholder: '请输入模型版本标识',
    },
  },
  {
    field: 'coreConfig.tools.tts.batchSize',
    label: '批量推理大小',
    component: 'InputNumber',
    bottomHelpMessage: '批量推理时单次处理的大小',
    componentProps: {
      min: 1,
      max: 100,
      step: 1,
      placeholder: '请输入批量推理大小',
    },
  },
  {
    field: 'coreConfig.tools.tts.batchThreshold',
    label: '批量阈值',
    component: 'InputNumber',
    bottomHelpMessage: '批量推理触发阈值，通常保持 0 到 1',
    componentProps: {
      min: 0,
      max: 1,
      step: 0.05,
      precision: 2,
      placeholder: '请输入批量阈值',
    },
  },
  {
    field: 'coreConfig.tools.tts.fragmentInterval',
    label: '片段间隔',
    component: 'InputNumber',
    bottomHelpMessage: '语音片段间的停顿间隔',
    componentProps: {
      min: 0,
      max: 5,
      step: 0.1,
      precision: 2,
      placeholder: '请输入片段间隔',
    },
  },
  {
    field: 'coreConfig.tools.tts.seed',
    label: '随机种子',
    component: 'InputNumber',
    bottomHelpMessage: '语音采样随机种子，-1 表示随机',
    componentProps: {
      min: -1,
      max: 9999999,
      step: 1,
      placeholder: '请输入随机种子',
    },
  },
  {
    field: 'coreConfig.tools.tts.sampleSteps',
    label: '采样步数',
    component: 'InputNumber',
    bottomHelpMessage: '语音采样步数，越高通常越慢',
    componentProps: {
      min: 1,
      max: 100,
      step: 1,
      placeholder: '请输入采样步数',
    },
  },
  {
    field: 'coreConfig.tools.tts.parallelInfer',
    label: '并行推理',
    component: 'Switch',
    bottomHelpMessage: '是否允许语音服务并行推理',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'coreConfig.tools.tts.splitBucket',
    label: '启用分桶',
    component: 'Switch',
    bottomHelpMessage: '是否启用语音服务的分桶处理',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'coreConfig.tools.tts.repetitionPenalty',
    label: '重复惩罚',
    component: 'InputNumber',
    bottomHelpMessage: '控制重复内容的惩罚系数',
    componentProps: {
      min: 0,
      max: 5,
      step: 0.05,
      precision: 2,
      placeholder: '请输入重复惩罚',
    },
  },
  {
    field: 'coreConfig.tools.tts.textSplitMethod',
    label: '文本切分方式',
    component: 'Input',
    bottomHelpMessage: '传给语音服务的文本切分方式，例如 按标点符号切',
    componentProps: {
      placeholder: '请输入文本切分方式',
    },
  },
  {
    field: 'coreConfig.tools.tts.modelSummary',
    label: '可用语音模型概览',
    component: 'InputTextArea',
    bottomHelpMessage: '根据模型列表接口动态刷新，仅展示不可编辑',
    componentProps: {
      rows: 18,
      readonly: true,
      placeholder: '暂无语音模型信息',
    },
  },

  // auth.json - 认证配置
  {
    label: '入群验证',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'auth.url',
    label: '手性碳验证API地址',
    component: 'Input',
    bottomHelpMessage: '验证基础api，有需求可自建',
    componentProps: {
      placeholder: '请输入验证API地址',
    },
  },
  {
    field: 'auth.default.enable',
    label: '全局启用验证',
    component: 'Switch',
    bottomHelpMessage: '是否在全部群聊启用验证',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'auth.default.carbon.enable',
    label: '手性碳验证',
    component: 'Switch',
    bottomHelpMessage: '是否默认启用手性碳验证,关闭则为数字验证',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'auth.default.carbon.hint',
    label: '手性碳验证提示',
    component: 'Switch',
    bottomHelpMessage: '是否显示手性碳验证提示(使用星号标注手性碳位置)',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'auth.default.carbon.hard-mode',
    label: '手性碳验证困难模式',
    component: 'Switch',
    bottomHelpMessage: '是否启用手性碳验证困难模式(困难模式下需要找出全部手性碳)',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'auth.default.timeout',
    label: '验证超时时间',
    component: 'InputNumber',
    bottomHelpMessage: '验证超时时间(秒)',
    componentProps: {
      min: 30,
      max: 600,
      step: 10,
      placeholder: '请输入验证超时时间(秒)',
    },
  },
  {
    field: 'auth.default.recall',
    label: '撤回未认证消息',
    component: 'Switch',
    bottomHelpMessage: '是否撤回验证通过前用户发送的消息',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'auth.default.frequency',
    label: '最大验证次数',
    component: 'InputNumber',
    bottomHelpMessage: '验证的最大次数，超过视为失败',
    componentProps: {
      min: 1,
      max: 24,
      step: 1,
      placeholder: '请输入最大验证次数',
    },
  },
  {
    label: '加群申请默认自动通过',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'auth.default.autoApprove.enable',
    label: '默认启用自动通过',
    component: 'Switch',
    bottomHelpMessage: '作为未单独配置群的默认加群申请自动通过开关；建议按群开启更稳妥',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'auth.default.autoApprove.minQqLevel',
    label: '默认最低 QQ 等级',
    component: 'InputNumber',
    bottomHelpMessage: '0 表示不检查；资料无法读取时不会自动通过',
    componentProps: {
      min: 0,
      max: 255,
      step: 1,
      placeholder: '请输入默认最低 QQ 等级',
    },
  },
  {
    field: 'auth.default.autoApprove.minAge',
    label: '默认最低年龄',
    component: 'InputNumber',
    bottomHelpMessage: '0 表示不检查；资料无法读取时不会自动通过',
    componentProps: {
      min: 0,
      max: 150,
      step: 1,
      placeholder: '请输入默认最低年龄',
    },
  },
  {
    field: 'auth.default.autoApprove.commentKeywords',
    label: '默认必要关键词',
    component: 'InputArray',
    bottomHelpMessage: '申请理由必须包含其中至少一个关键词才会自动通过；留空表示不检查',
    componentProps: {
      placeholder: '请输入关键词，按回车添加',
    },
  },
  {
    field: 'auth.default.autoApprove.blockedKeywords',
    label: '默认拦截关键词',
    component: 'InputArray',
    bottomHelpMessage: '申请理由命中这些关键词时不自动通过',
    componentProps: {
      placeholder: '请输入关键词，按回车添加',
    },
  },
  {
    field: 'auth.default.autoApprove.customRules',
    label: '默认自定义条件',
    component: 'InputArray',
    bottomHelpMessage: '支持如“qq等级 >= 20”“年龄 >= 18”“申请理由 包含 原神”；按群配置会覆盖默认值',
    componentProps: {
      placeholder: '请输入自定义条件，按回车添加',
    },
  },
  {
    label: '入群风险评分默认',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'auth.default.autoApprove.risk.enabled',
    label: '默认启用风险评分',
    component: 'Switch',
    bottomHelpMessage: '开启后申请列表会记录风险评分，并接入群管黑白名单和警告积分',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'auth.default.autoApprove.risk.scoreEnabled',
    label: '默认记录风险分',
    component: 'Switch',
    bottomHelpMessage: '关闭后只按普通自动通过条件处理，不计算风险分',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'auth.default.autoApprove.risk.blockBlacklistAutoApprove',
    label: '默认黑名单不自动通过',
    component: 'Switch',
    bottomHelpMessage: '申请人命中群管黑名单时保留人工审核',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'auth.default.autoApprove.risk.autoApproveWhitelisted',
    label: '默认白名单直接通过',
    component: 'Switch',
    bottomHelpMessage: '申请人命中群管白名单时可跳过等级、年龄和申请理由条件',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'auth.default.autoApprove.risk.holdHighRisk',
    label: '默认高风险保留人工',
    component: 'Switch',
    bottomHelpMessage: '风险分达到阈值时不自动通过',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'auth.default.autoApprove.risk.highRiskScore',
    label: '默认高风险阈值',
    component: 'InputNumber',
    bottomHelpMessage: '风险分达到该值时视为高风险',
    componentProps: {
      min: 1,
      max: 100,
      step: 1,
      placeholder: '请输入高风险阈值',
    },
  },
  {
    field: 'auth.default.autoApprove.risk.warningBlockThreshold',
    label: '默认警告拦截阈值',
    component: 'InputNumber',
    bottomHelpMessage: '0 表示不按警告积分拦截自动通过',
    componentProps: {
      min: 0,
      max: 100,
      step: 1,
      placeholder: '请输入警告拦截阈值',
    },
  },

  // ai.json - AI配置
  {
    label: '晶灵智能',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    label: '基础设置',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'ai.mode',
    label: '对话模式',
    component: 'Select',
    bottomHelpMessage: '推荐使用混合模式，如果你不喜欢词库或不想消耗token可以修改',
    componentProps: {
      options: [
        { label: '混合模式', value: 'mix' },
        { label: 'AI模式', value: 'ai' },
        { label: '词库模式', value: 'keyword' },
      ],
      placeholder: '请选择对话模式',
    },
  },
  {
    field: 'ai.baseApi',
    label: 'API基础地址',
    component: 'Input',
    bottomHelpMessage: '填写 OpenAI 风格的 API 基础地址，通常写到 /v1，不要填写 /chat/completions 完整路径',
    required: true,
    componentProps: {
      placeholder: '请输入API基础地址，如: https://xx.xx.com/v1',
    },
  },
  {
    field: 'ai.apiKey',
    label: 'API密钥',
    component: 'InputPassword',
    bottomHelpMessage: '用于请求API的密钥',
    required: true,
    componentProps: {
      placeholder: '请输入API密钥',
    },
  },
  {
    field: 'ai.userAgent',
    label: '请求 User-Agent',
    component: 'Input',
    bottomHelpMessage: 'LLM 请求头使用的 User-Agent，方便中转、CDN 或上游日志识别来源；留空使用插件默认 UA，最多 200 个字符，不能包含换行',
    componentProps: {
      maxlength: 200,
      placeholder: '留空使用插件默认 UA',
    },
  },
  {
    field: 'ai.modelType',
    label: '文本模型',
    component: 'Input',
    bottomHelpMessage: '机器人日常聊天主回复优先使用这个模型',
    required: true,
    componentProps: {
      placeholder: '请输入模型名称，如: deepseek-ai/DeepSeek-V3.2-Exp',
    },
  },
  {
    field: 'ai.temperature',
    label: '聊天温度',
    component: 'InputNumber',
    bottomHelpMessage: '温度越高聊天的发散性越高，可选0-2.0',
    componentProps: {
      min: 0,
      max: 2,
      step: 0.1,
      precision: 1,
      placeholder: '请输入温度值，如: 1.2',
    },
  },
  {
    label: '对话与会话',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'ai.maxMix',
    label: '混合模式阈值',
    component: 'InputNumber',
    bottomHelpMessage: '混合模式下，如果用户消息长度大于这个值，那么使用ai回复',
    componentProps: {
      min: 1,
      step: 1,
      placeholder: '请输入消息长度阈值',
    },
  },
  {
    field: 'ai.timeout',
    label: 'AI调用超时时间',
    component: 'InputNumber',
    bottomHelpMessage: 'AI 请求超时时间，单位毫秒',
    componentProps: {
      min: 1,
      max: 300000,
      step: 1000,
      placeholder: '请输入超时时间(毫秒)',
    },
  },
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
  {
    field: 'ai.emojiSuppression',
    label: 'Emoji抑制',
    component: 'Switch',
    bottomHelpMessage: '开启后会移除 AI 文本回复中的 Unicode emoji 字符，避免模型频繁乱发表情；不影响 [meme:角色:情绪] 这类表情包指令',
  },
  {
    label: '故障降级',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'ai.fallbackReply',
    label: '故障降级回复',
    component: 'InputTextArea',
    bottomHelpMessage: '模型超时、失败或没有产出可发送内容时使用的兜底回复；支持一行一句，失败时随机抽一条，留空则按系统默认策略生成',
    componentProps: {
      rows: 4,
      placeholder: '例如：\n我刚刚有点卡住了，你可以稍后再试试。\n我这次没顺利组织好回复，换个简短问法再试一次吧。',
    },
  },
  {
    field: 'ai.fallbackSearchReply',
    label: '联网失败回复',
    component: 'InputTextArea',
    bottomHelpMessage: '联网搜索、网页读取等外部检索失败时使用的兜底回复；支持一行一句随机抽取，留空则按系统默认策略生成',
    componentProps: {
      rows: 4,
      placeholder: '例如：\n我刚刚想去网上查资料，但这次外部检索没成功。\n这次联网查资料没成功，你可以晚点再问我。',
    },
  },
  {
    field: 'ai.fallbackTimeoutReply',
    label: '超时失败回复',
    component: 'InputTextArea',
    bottomHelpMessage: '模型处理超时时使用的兜底回复；支持一行一句随机抽取，留空则按系统默认策略生成',
    componentProps: {
      rows: 4,
      placeholder: '例如：\n我这次思考得有点久，结果超时了。\n我刚刚处理超时了，你可以把问题拆短一点再问我。',
    },
  },
  {
    field: 'ai.fallbackGenericReply',
    label: '通用失败回复',
    component: 'InputTextArea',
    bottomHelpMessage: '其他通用失败场景使用的兜底回复；支持一行一句随机抽取，留空则按系统默认策略生成',
    componentProps: {
      rows: 4,
      placeholder: '例如：\n我刚刚出了点小问题，暂时没组织好回复。\n这次没顺利答上来，你可以换个说法再试试。',
    },
  },
  {
    field: 'ai.maxSessions',
    label: '最大会话数',
    component: 'InputNumber',
    bottomHelpMessage: '最大同时存在的活跃群聊数量',
    componentProps: {
      min: 1,
      max: 500,
      step: 1,
      placeholder: '请输入最大会话数',
    },
  },
  {
    field: 'ai.chatHistory',
    label: '聊天历史长度',
    component: 'InputNumber',
    bottomHelpMessage: '聊天上下文最大长度',
    componentProps: {
      min: 1,
      max: 50,
      step: 1,
      placeholder: '请输入聊天历史长度',
    },
  },
  {
    field: 'ai.maxMessageLength',
    label: '最大消息长度',
    component: 'InputNumber',
    bottomHelpMessage: '处理群消息的最大长度',
    componentProps: {
      min: 50,
      max: 100,
      step: 10,
      placeholder: '请输入最大消息长度',
    },
  },
  {
    field: 'ai.getChatHistoryLength',
    label: '抓取群历史条数',
    component: 'InputNumber',
    bottomHelpMessage: '调用群历史消息接口时最多抓取多少条上下文',
    componentProps: {
      min: 1,
      max: 100,
      step: 1,
      placeholder: '请输入抓取群历史条数',
    },
  },
  {
    label: '每日群聊总结',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'ai.dailyGroupSummary.enabled',
    label: '启用每日总结',
    component: 'Switch',
    bottomHelpMessage: '每天到设定时间后，每个开启群最多自动发送一次群聊总结',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'ai.dailyGroupSummary.targetMode',
    label: '总结范围',
    component: 'Select',
    bottomHelpMessage: '选择 selected 时只总结启用群；选择 all 时总结所有有聊天记录的群，但仍会排除禁用群',
    componentProps: {
      options: [
        { label: '只总结启用群', value: 'selected' },
        { label: '总结全部群', value: 'all' },
      ],
      placeholder: '请选择总结范围',
    },
  },
  {
    field: 'ai.dailyGroupSummary.enabledGroups',
    label: '每日总结启用群',
    component: 'InputArray',
    bottomHelpMessage: 'targetMode=selected 时生效；也可以在控制台“群管理”里按群开启',
    componentProps: {
      placeholder: '请输入群号，按回车添加',
    },
  },
  {
    field: 'ai.dailyGroupSummary.blockedGroups',
    label: '每日总结禁用群',
    component: 'InputArray',
    bottomHelpMessage: '无论总结范围如何，命中这些群号都不会发送每日总结',
    componentProps: {
      placeholder: '请输入群号，按回车添加',
    },
  },
  {
    field: 'ai.dailyGroupSummary.hour',
    label: '总结小时',
    component: 'InputNumber',
    bottomHelpMessage: '每天几点开始总结，使用机器人本机时区',
    componentProps: {
      min: 0,
      max: 23,
      step: 1,
      placeholder: '请输入小时',
    },
  },
  {
    field: 'ai.dailyGroupSummary.minute',
    label: '总结分钟',
    component: 'InputNumber',
    bottomHelpMessage: '每天几分开始总结',
    componentProps: {
      min: 0,
      max: 59,
      step: 1,
      placeholder: '请输入分钟',
    },
  },
  {
    field: 'ai.dailyGroupSummary.minMessages',
    label: '最低消息数',
    component: 'InputNumber',
    bottomHelpMessage: '当天群消息少于该数量时跳过总结，避免空群刷屏',
    componentProps: {
      min: 1,
      max: 500,
      step: 1,
      placeholder: '请输入最低消息数',
    },
  },
  {
    field: 'ai.dailyGroupSummary.maxMessages',
    label: '总结消息上限',
    component: 'InputNumber',
    bottomHelpMessage: '每群每天最多取最近多少条消息生成总结',
    componentProps: {
      min: 10,
      max: 1000,
      step: 10,
      placeholder: '请输入消息上限',
    },
  },
  {
    field: 'ai.dailyGroupSummary.maxMessageChars',
    label: '单条消息长度',
    component: 'InputNumber',
    bottomHelpMessage: '记录群消息时单条消息最多保留多少字符',
    componentProps: {
      min: 20,
      max: 1000,
      step: 20,
      placeholder: '请输入单条消息长度',
    },
  },
  {
    field: 'ai.dailyGroupSummary.maxSummaryChars',
    label: '总结文本长度',
    component: 'InputNumber',
    bottomHelpMessage: '发送到群里的总结正文最大字符数',
    componentProps: {
      min: 100,
      max: 3000,
      step: 100,
      placeholder: '请输入总结文本长度',
    },
  },
  {
    field: 'ai.dailyGroupSummary.retentionDays',
    label: '记录保留天数',
    component: 'InputNumber',
    bottomHelpMessage: '本地群聊总结原始消息记录保留天数',
    componentProps: {
      min: 1,
      max: 60,
      step: 1,
      placeholder: '请输入保留天数',
    },
  },
  {
    field: 'ai.dailyGroupSummary.temperature',
    label: '总结温度',
    component: 'InputNumber',
    bottomHelpMessage: '每日总结生成温度，越低越稳定',
    componentProps: {
      min: 0,
      max: 2,
      step: 0.1,
      placeholder: '请输入总结温度',
    },
  },
  {
    field: 'ai.dailyGroupSummary.maxTokens',
    label: '总结输出上限',
    component: 'InputNumber',
    bottomHelpMessage: '每日总结请求模型时允许输出的最大 token',
    componentProps: {
      min: 100,
      max: 4000,
      step: 100,
      placeholder: '请输入输出 token 上限',
    },
  },
  {
    field: 'ai.dailyGroupSummary.includeCommands',
    label: '纳入命令消息',
    component: 'Switch',
    bottomHelpMessage: '是否把 #、＃ 或 / 开头的命令消息也纳入群聊总结',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'ai.dailyGroupSummary.imageEnabled',
    label: '图片模式',
    component: 'Switch',
    bottomHelpMessage: '开启后 #群总结 和每日自动总结会优先发送日报图片，渲染失败时自动回退文本',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'ai.dailyGroupSummary.title',
    label: '总结标题',
    component: 'Input',
    bottomHelpMessage: '发送到群里的总结标题',
    componentProps: {
      placeholder: '今日群聊总结',
    },
  },
  {
    field: 'ai.dailyGroupSummary.prompt',
    label: '额外总结要求',
    component: 'InputTextArea',
    bottomHelpMessage: '留空使用默认总结规则；可补充例如“重点列出待办”或“语气更活泼”',
    componentProps: {
      rows: 4,
      placeholder: '请输入额外总结要求',
    },
  },
  {
    label: '知识库与人设',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'ai.botPersona',
    label: '机器人人设',
    component: 'InputTextArea',
    bottomHelpMessage: '机器人的性格和行为描述',
    componentProps: {
      rows: 4,
      placeholder: '请输入机器人人设描述',
    },
  },
  {
    field: 'ai.knowledgeBaseEnabled',
    label: '启用RAG知识库',
    component: 'Switch',
    bottomHelpMessage: '是否在真实机器人聊天中启用本地RAG知识库检索',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'ai.knowledgeDebugHints',
    label: '回复中显示知识命中提示',
    component: 'Switch',
    bottomHelpMessage: '开启后，机器人回复里会附带轻量的知识库命中提示，适合调试 RAG 是否生效',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'ai.toolStatusHints',
    label: '回复中显示工具状态提示',
    component: 'Switch',
    bottomHelpMessage: '开启后，机器人回复里会附带搜索、网页读取等工具的轻量状态提示，适合调试工具链路',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'ai.knowledgeTopK',
    label: '知识库召回条数',
    component: 'InputNumber',
    bottomHelpMessage: '每次真实聊天最多注入多少条知识片段',
    componentProps: {
      min: 1,
      max: 10,
      step: 1,
      placeholder: '请输入召回条数',
    },
  },
  {
    field: 'ai.knowledgeBase',
    label: 'RAG知识库',
    component: 'InputTextArea',
    bottomHelpMessage: '按空行分隔知识片段。每段第一行是标题，可选第二行格式为 标签:群管理,验证，后续为正文。',
    componentProps: {
      rows: 12,
      placeholder: '示例：\n验证功能\n标签:群管理,验证\n新成员进群后可开启验证，管理员可手动重置或绕过验证。',
    },
  },
  {
    label: '表情与多模态',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'ai.character',
    label: '表情包角色',
    component: 'Select',
    bottomHelpMessage: '回复表情包时的角色(能力有限,目前仅支持一种角色qwq)',
    componentProps: {
      options: memeCharacterOptions,
      placeholder: '请选择表情包角色',
    },
  },
  {
    field: 'ai.memeConfig.apiBase',
    label: '表情包API地址',
    component: 'Input',
    bottomHelpMessage: '随机取图与角色列表接口基础地址，例如 http://38.22.95.201:5555',
    componentProps: {
      placeholder: '请输入表情包API地址',
    },
  },
  {
    field: 'ai.memeConfig.character',
    label: '主动表情角色',
    component: 'Select',
    bottomHelpMessage: 'AI 主动发送表情包时默认使用的角色',
    componentProps: {
      options: memeCharacterOptions,
      placeholder: '请选择主动表情角色',
    },
  },
  {
    field: 'ai.memeConfig.availableEmotions',
    label: '可用表情情绪',
    component: 'Select',
    bottomHelpMessage: 'AI 允许主动发送的表情包情绪类型',
    componentProps: {
      mode: 'multiple',
      options: [
        { label: '默认', value: 'default' },
        { label: '开心', value: 'happy' },
        { label: '难过', value: 'sad' },
        { label: '生气', value: 'angry' },
        { label: '困惑', value: 'confused' },
        { label: '害羞', value: 'shy' },
        { label: '惊讶', value: 'surprised' },
      ],
      placeholder: '请选择可用表情情绪',
    },
  },
  {
    field: 'ai.memeConfig.localEnabled',
    label: '启用本地表情包',
    component: 'Switch',
    bottomHelpMessage: '启用后允许从本地目录读取表情包。关闭时只使用远程表情包服务。',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'ai.memeConfig.preferLocal',
    label: '优先本地表情包',
    component: 'Switch',
    bottomHelpMessage: '开启后优先从本地目录选图；关闭时先走远程，失败后再回退本地。',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'ai.memeConfig.localBaseDir',
    label: '本地表情包目录',
    component: 'Input',
    bottomHelpMessage: '支持绝对路径或相对机器人运行目录的路径。支持两种结构：1) 目录/角色/情绪/图片 2) 目录/角色/图片（兼容图片监控自动入库目录）。',
    componentProps: {
      placeholder: '例如 data/chat/meme 或 /root/mu/Yunzai/data/crystelf/image-monitor/memes',
    },
  },
  {
    field: 'ai.multimodalEnabled',
    label: '多模态模式',
    component: 'Switch',
    bottomHelpMessage: '启用后将使用多模态模型',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'ai.smartMultimodal',
    label: '智能多模态',
    component: 'Switch',
    bottomHelpMessage: '开启时只有有图片才用多模态模型，其他情况使用默认模型',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'ai.multimodalModel',
    label: '多模态模型',
    component: 'Input',
    bottomHelpMessage: '用于多模态处理的模型名称',
    required: true,
    componentProps: {
      placeholder: '请输入多模态模型名称，例如Qwen/Qwen2.5-VL-72B-Instruct',
    },
  },
  {
    label: '高级设置',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'ai.workingModel',
    label: '辅助工作模型',
    component: 'Input',
    bottomHelpMessage: '用于动作规划、记忆检索、总结、欢迎、头衔审核等后台任务；留空时复用文本模型',
    componentProps: {
      placeholder: '请输入辅助工作模型名称，留空时默认复用文本模型',
    },
  },
  {
    field: 'ai.maxIterations',
    label: '最大推理轮次',
    component: 'InputNumber',
    bottomHelpMessage: '聊天引擎允许的最大迭代次数，-1 表示不限制',
    componentProps: {
      min: -1,
      max: 50,
      step: 1,
      placeholder: '请输入最大推理轮次',
    },
  },
  {
    field: 'ai.imageConfig.enabled',
    label: '图像生成功能',
    component: 'Switch',
    bottomHelpMessage: '是否允许ai生成图像',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'ai.imageConfig.imageMode',
    label: '图像生成模式',
    component: 'Select',
    bottomHelpMessage:
      'openai使用/v1/images/generations接口(如gpt-image-2、Qwen-Image), chat使用对话式生图模型(如gemini-3-pro-image-preview), jimeng使用即梦接口',
    componentProps: {
      options: [
        { label: 'OpenAI接口', value: 'openai' },
        { label: '对话式生成', value: 'chat' },
        { label: '即梦接口', value: 'jimeng' },
      ],
      placeholder: '请选择图像生成模式',
    },
  },
  {
    field: 'ai.imageConfig.model',
    label: '图像生成模型',
    component: 'Input',
    bottomHelpMessage: '用于图像生成的模型名称',
    required: true,
    componentProps: {
      placeholder: '请输入图像生成模型名称，例如 gpt-image-2',
    },
  },
  {
    field: 'ai.imageConfig.baseApi',
    label: '图像API地址',
    component: 'Input',
    bottomHelpMessage: '图像生成API基础地址,不加v1',
    required: true,
    componentProps: {
      placeholder: '请输入图像API地址，例如 https://xx.xx.com',
    },
  },
  {
    field: 'ai.imageConfig.jimengApiUrl',
    label: '即梦接口地址',
    component: 'Input',
    bottomHelpMessage: '即梦绘图/改图接口基础地址；不用即梦模式时建议留空',
    componentProps: {
      placeholder: '请输入即梦接口地址',
    },
  },
  {
    field: 'ai.imageConfig.apiKey',
    label: '图像API密钥',
    component: 'InputPassword',
    bottomHelpMessage: '用于图像生成的API密钥',
    required: false,
    componentProps: {
      placeholder: '请输入图像API密钥',
    },
  },
  {
    field: 'ai.imageConfig.timeout',
    label: '图像生成超时',
    component: 'InputNumber',
    bottomHelpMessage: '图像生成超时时间(毫秒)',
    componentProps: {
      min: 1000,
      max: 300000,
      step: 1000,
      placeholder: '请输入超时时间(毫秒)',
    },
  },
  {
    field: 'ai.imageConfig.fallbackReply',
    label: '图像失败保底',
    component: 'InputTextArea',
    bottomHelpMessage: '图像生成或改图失败时发送的兜底回复；留空则回退到 AI 通用保底',
    componentProps: {
      rows: 3,
      placeholder: '例如：\n图像生成失败了，待会儿再试试吧~',
    },
  },
  {
    field: 'ai.imageConfig.fallbackTimeoutReply',
    label: '图像超时保底',
    component: 'InputTextArea',
    bottomHelpMessage: '图像生成或改图超时时发送的兜底回复；留空则回退到 AI 通用超时保底',
    componentProps: {
      rows: 3,
      placeholder: '例如：\n图像生成超时了，你可以稍后再试试，或者把要求说短一点~',
    },
  },
  {
    field: 'ai.imageConfig.quality',
    label: '图像质量',
    component: 'Select',
    bottomHelpMessage: '生成图像的质量；gpt-image-2 建议 high，DALL-E 类接口可用 standard/hd',
    componentProps: {
      options: [
        { label: '低质量', value: 'low' },
        { label: '中质量', value: 'medium' },
        { label: '高质量', value: 'high' },
        { label: '标准', value: 'standard' },
        { label: '高清兼容', value: 'hd' },
      ],
      placeholder: '请选择图像质量',
    },
  },
  {
    field: 'ai.imageConfig.background',
    label: '图像背景',
    component: 'Select',
    bottomHelpMessage: 'gpt-image-2 支持的背景参数；留空表示不传该字段',
    componentProps: {
      options: [
        { label: '不传', value: '' },
        { label: '自动', value: 'auto' },
        { label: '不透明', value: 'opaque' },
        { label: '透明', value: 'transparent' },
      ],
      placeholder: '请选择背景模式',
    },
  },
  {
    field: 'ai.imageConfig.style',
    label: '图像风格',
    component: 'Select',
    bottomHelpMessage: '生成图像的风格',
    componentProps: {
      options: [
        { label: '自然', value: 'natural' },
        { label: '生动', value: 'vivid' },
      ],
      placeholder: '请选择图像风格',
    },
  },
  {
    field: 'ai.imageConfig.size',
    label: '图像尺寸',
    component: 'Select',
    bottomHelpMessage: '生成图像的尺寸',
    componentProps: {
      options: [
        { label: '自动/不传', value: 'auto' },
        { label: '1024x1024', value: '1024x1024' },
        { label: '1536x1024', value: '1536x1024' },
        { label: '1024x1536', value: '1024x1536' },
        { label: '2048x2048', value: '2048x2048' },
        { label: '2560x1440', value: '2560x1440' },
        { label: '3840x2160', value: '3840x2160' },
        { label: '2160x3840', value: '2160x3840' },
        { label: '1792x1024', value: '1792x1024' },
        { label: '1024x1792', value: '1024x1792' },
      ],
      placeholder: '请选择图像尺寸',
    },
  },
  {
    field: 'ai.imageConfig.responseFormat',
    label: '响应格式',
    component: 'Select',
    bottomHelpMessage: '图像响应的格式；gpt-image-2 建议 b64_json',
    componentProps: {
      options: [
        { label: 'URL', value: 'url' },
        { label: 'Base64', value: 'b64_json' },
      ],
      placeholder: '请选择响应格式',
    },
  },
  {
    field: 'ai.imageConfig.modalities',
    label: '图像输出模态',
    component: 'Select',
    bottomHelpMessage: '对话式生图模型可用的输出模态；通常保持 text + image 即可',
    componentProps: {
      mode: 'multiple',
      options: [
        { label: '文本', value: 'text' },
        { label: '图片', value: 'image' },
      ],
      placeholder: '请选择输出模态',
    },
  },
  {
    label: '图片监控与审核',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'imageMonitor.enabled',
    label: '启用图片监控',
    component: 'Switch',
    bottomHelpMessage: '是否启用独立图片监控插件；需同时打开主配置里的“图片监控”开关',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'imageMonitor.saveMemeImages',
    label: '保存表情包图片',
    component: 'Switch',
    bottomHelpMessage: '识别为表情包时是否保存原图与标签到本地',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'imageMonitor.saveReviewImages',
    label: '保存审核预览图',
    component: 'Switch',
    bottomHelpMessage: '为每条图片监控审核记录保存本地预览图，避免 QQ 图床链接过期后页面无法查看。',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'imageMonitor.saveMemeCharacters',
    label: '入库角色白名单',
    component: 'InputArray',
    bottomHelpMessage: '只保存角色名命中的表情包；留空表示不按角色限制。角色白名单和关键词白名单任一命中即可保存。',
    componentProps: {
      placeholder: '请输入要保存的角色名，按回车添加',
    },
  },
  {
    field: 'imageMonitor.saveMemeKeywords',
    label: '入库关键词白名单',
    component: 'InputArray',
    bottomHelpMessage: '只保存标签、角色名或摘要中包含这些关键词的表情包；留空表示不按关键词限制。',
    componentProps: {
      placeholder: '请输入要保存的关键词，按回车添加',
    },
  },
  {
    field: 'imageMonitor.violationAction',
    label: '违规图处理方式',
    component: 'Select',
    bottomHelpMessage: '仅记录会只写日志；告警会发短暂提示；自动撤回会直接尝试撤回原图消息',
    componentProps: {
      options: [
        { label: '仅记录', value: 'record' },
        { label: '告警提示', value: 'alert' },
        { label: '自动撤回', value: 'recall' },
      ],
      placeholder: '请选择违规图片处理方式',
    },
  },
  {
    field: 'imageMonitor.monitorQuotedImages',
    label: '监控引用图片',
    component: 'Switch',
    bottomHelpMessage: '是否同时分析回复或引用消息里的图片',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'imageMonitor.allowedGroups',
    label: '允许监控群号',
    component: 'InputArray',
    bottomHelpMessage: '白名单群号，留空表示全部群都可监控',
    componentProps: {
      placeholder: '请输入允许监控的群号，按回车添加',
    },
  },
  {
    field: 'imageMonitor.blockedGroups',
    label: '禁止监控群号',
    component: 'InputArray',
    bottomHelpMessage: '黑名单群号，命中后不再执行图片监控',
    componentProps: {
      placeholder: '请输入禁止监控的群号，按回车添加',
    },
  },
  {
    field: 'imageMonitor.apiBase',
    label: '视觉模型地址',
    component: 'Input',
    bottomHelpMessage: '独立视觉模型API基础地址，兼容 OpenAI 接口',
    componentProps: {
      placeholder: '请输入视觉模型API地址',
    },
  },
  {
    field: 'imageMonitor.apiKey',
    label: '视觉模型密钥',
    component: 'InputPassword',
    bottomHelpMessage: '独立视觉模型使用的 API 密钥',
    componentProps: {
      placeholder: '请输入视觉模型 API Key',
    },
  },
  {
    field: 'imageMonitor.model',
    label: '视觉模型名称',
    component: 'Input',
    bottomHelpMessage: '用于图片监控识别的独立视觉模型',
    componentProps: {
      placeholder: '请输入视觉模型名称',
    },
  },
  {
    field: 'imageMonitor.temperature',
    label: '识别温度',
    component: 'InputNumber',
    bottomHelpMessage: '图片审核与标签识别温度，建议保持较低值',
    componentProps: {
      min: 0,
      max: 1,
      step: 0.1,
      precision: 1,
      placeholder: '请输入识别温度',
    },
  },
  {
    field: 'imageMonitor.maxImagesPerMessage',
    label: '单条消息最大图片数',
    component: 'InputNumber',
    bottomHelpMessage: '单条群消息里最多分析多少张图片',
    componentProps: {
      min: 1,
      max: 10,
      step: 1,
      placeholder: '请输入图片数量上限',
    },
  },
  {
    field: 'imageMonitor.duplicateWindowMs',
    label: '去重窗口',
    component: 'InputNumber',
    bottomHelpMessage: '同一张图在这段时间内不重复分析，单位毫秒',
    componentProps: {
      min: 0,
      max: 3600000,
      step: 1000,
      placeholder: '请输入去重窗口',
    },
  },
  {
    field: 'imageMonitor.analysisTimeoutMs',
    label: '识别超时',
    component: 'InputNumber',
    bottomHelpMessage: '单次图片识别的超时时间，单位毫秒',
    componentProps: {
      min: 1000,
      max: 300000,
      step: 1000,
      placeholder: '请输入识别超时',
    },
  },
  {
    field: 'imageMonitor.fallbackReply',
    label: '识别失败提示',
    component: 'InputTextArea',
    bottomHelpMessage: '图片监控识别失败时发送的提示文案；留空则保持静默',
    componentProps: {
      rows: 3,
      placeholder: '留空表示识别失败时不发送群提示',
    },
  },
  {
    field: 'imageMonitor.fallbackTimeoutReply',
    label: '识别超时提示',
    component: 'InputTextArea',
    bottomHelpMessage: '图片监控识别超时时发送的提示文案；留空则保持静默',
    componentProps: {
      rows: 3,
      placeholder: '留空表示识别超时时不发送群提示',
    },
  },
  {
    field: 'imageMonitor.riskThreshold',
    label: '违规撤回阈值',
    component: 'Select',
    bottomHelpMessage: '达到哪个风险等级后才视为违规并执行撤回',
    componentProps: {
      options: [
        { label: '低风险', value: 'low' },
        { label: '中风险', value: 'medium' },
        { label: '高风险', value: 'high' },
      ],
      placeholder: '请选择违规阈值',
    },
  },
  {
    field: 'imageMonitor.prompt',
    label: '监控提示词',
    component: 'InputTextArea',
    bottomHelpMessage: '控制视觉模型如何判断表情包、打标签与识别违规内容',
    componentProps: {
      rows: 5,
      placeholder: '请输入图片监控提示词',
    },
  },
  {
    label: '实验与拟人化',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'ai.planner.enabled',
    label: '启用动作规划器',
    component: 'Switch',
    bottomHelpMessage: '让 AI 先判断应该回复、等待还是结束，减少无意义插话',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'ai.planner.idleThresholdMs',
    label: '空闲发言间隔',
    component: 'InputNumber',
    bottomHelpMessage: '群聊多久没人说话后，允许主动发言，单位毫秒',
    componentProps: {
      min: 60000,
      max: 86400000,
      step: 60000,
      placeholder: '请输入空闲发言间隔(毫秒)',
    },
  },
  {
    field: 'ai.planner.idleMessageCount',
    label: '空闲检测消息数',
    component: 'InputNumber',
    bottomHelpMessage: '触发空闲发言前，群内至少要累计多少条消息',
    componentProps: {
      min: 1,
      max: 500,
      step: 1,
      placeholder: '请输入消息阈值',
    },
  },
  {
    field: 'ai.memory.enabled',
    label: '启用记忆检索',
    component: 'Switch',
    bottomHelpMessage: '启用后会在需要时智能检索历史聊天内容',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'ai.memory.maxIterations',
    label: '记忆检索轮次',
    component: 'InputNumber',
    bottomHelpMessage: 'ReAct 检索允许的最大迭代次数',
    componentProps: {
      min: 1,
      max: 10,
      step: 1,
      placeholder: '请输入记忆检索轮次',
    },
  },
  {
    field: 'ai.memory.timeoutMs',
    label: '记忆检索超时',
    component: 'InputNumber',
    bottomHelpMessage: '记忆检索最长等待时间，单位毫秒',
    componentProps: {
      min: 1000,
      max: 120000,
      step: 1000,
      placeholder: '请输入记忆检索超时(毫秒)',
    },
  },
  {
    field: 'ai.topic.enabled',
    label: '启用话题跟踪',
    component: 'Switch',
    bottomHelpMessage: '自动总结并跟踪群内近期话题',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'ai.topic.messageThreshold',
    label: '话题分析消息阈值',
    component: 'InputNumber',
    bottomHelpMessage: '累计达到多少条消息后触发一次话题分析',
    componentProps: {
      min: 1,
      max: 500,
      step: 1,
      placeholder: '请输入话题分析消息阈值',
    },
  },
  {
    field: 'ai.topic.timeThresholdMs',
    label: '话题分析时间阈值',
    component: 'InputNumber',
    bottomHelpMessage: '距离上次分析多久后允许再次分析，单位毫秒',
    componentProps: {
      min: 60000,
      max: 86400000,
      step: 60000,
      placeholder: '请输入时间阈值(毫秒)',
    },
  },
  {
    field: 'ai.topic.maxTopicsPerSession',
    label: '会话最大话题数',
    component: 'InputNumber',
    bottomHelpMessage: '每个会话保留的最近话题数量',
    componentProps: {
      min: 1,
      max: 50,
      step: 1,
      placeholder: '请输入最大话题数',
    },
  },
  {
    field: 'ai.expression.enabled',
    label: '启用表达学习',
    component: 'Switch',
    bottomHelpMessage: '学习群成员的表达习惯并注入回复风格',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'ai.expression.maxExpressions',
    label: '最大表达样本数',
    component: 'InputNumber',
    bottomHelpMessage: '最多保存多少条学习到的表达习惯',
    componentProps: {
      min: 1,
      max: 1000,
      step: 1,
      placeholder: '请输入最大表达样本数',
    },
  },
  {
    field: 'ai.expression.sampleSize',
    label: '表达注入数量',
    component: 'InputNumber',
    bottomHelpMessage: '每次构建提示词时随机注入多少条表达习惯',
    componentProps: {
      min: 1,
      max: 50,
      step: 1,
      placeholder: '请输入表达注入数量',
    },
  },
  {
    label: '群内用户画像',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'ai.userProfile.enabled',
    label: '启用用户画像',
    component: 'Switch',
    bottomHelpMessage: '是否为群成员生成本地聊天画像',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'ai.userProfile.injectIntoPrompt',
    label: '注入回复上下文',
    component: 'Switch',
    bottomHelpMessage: '是否把用户画像作为软参考注入 AI 回复上下文',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'ai.userProfile.minMessagesToBuild',
    label: '生成画像门槛',
    component: 'InputNumber',
    bottomHelpMessage: '单个成员累计多少条消息后尝试生成或更新画像',
    componentProps: {
      min: 3,
      max: 100,
      step: 1,
      placeholder: '请输入消息门槛',
    },
  },
  {
    field: 'ai.userProfile.maxProfileItems',
    label: '画像条目上限',
    component: 'InputNumber',
    bottomHelpMessage: '每类画像信息最多保留多少项',
    componentProps: {
      min: 1,
      max: 10,
      step: 1,
      placeholder: '请输入条目上限',
    },
  },
  {
    label: '好感度配置',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'ai.affinity.enabled',
    label: '启用好感度',
    component: 'Switch',
    bottomHelpMessage: '是否记录 bot 对群成员的本地好感度',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'ai.affinity.positiveDelta',
    label: '友好加分',
    component: 'InputNumber',
    bottomHelpMessage: '普通友好互动时的加分值',
    componentProps: {
      min: 0,
      max: 10,
      step: 1,
      placeholder: '请输入友好加分',
    },
  },
  {
    field: 'ai.affinity.strongPositiveDelta',
    label: '夸奖加分',
    component: 'InputNumber',
    bottomHelpMessage: '明显夸奖时的加分值',
    componentProps: {
      min: 0,
      max: 10,
      step: 1,
      placeholder: '请输入夸奖加分',
    },
  },
  {
    field: 'ai.affinity.negativeDelta',
    label: '负面减分',
    component: 'InputNumber',
    bottomHelpMessage: '普通负面互动时的减分值',
    componentProps: {
      min: -10,
      max: 0,
      step: 1,
      placeholder: '请输入负面减分',
    },
  },
  {
    field: 'ai.affinity.strongNegativeDelta',
    label: '攻击减分',
    component: 'InputNumber',
    bottomHelpMessage: '明显攻击时的减分值',
    componentProps: {
      min: -10,
      max: 0,
      step: 1,
      placeholder: '请输入攻击减分',
    },
  },
  {
    field: 'ai.affinity.positiveKeywords',
    label: '正向关键词',
    component: 'InputTextArea',
    bottomHelpMessage: '普通友好互动关键词，逗号或换行分隔',
    componentProps: {
      rows: 2,
      placeholder: '请输入正向关键词',
    },
  },
  {
    field: 'ai.affinity.strongPositiveKeywords',
    label: '强正向关键词',
    component: 'InputTextArea',
    bottomHelpMessage: '明显夸奖关键词，逗号或换行分隔',
    componentProps: {
      rows: 2,
      placeholder: '请输入强正向关键词',
    },
  },
  {
    field: 'ai.affinity.negativeKeywords',
    label: '负向关键词',
    component: 'InputTextArea',
    bottomHelpMessage: '普通负面互动关键词，逗号或换行分隔',
    componentProps: {
      rows: 2,
      placeholder: '请输入负向关键词',
    },
  },
  {
    field: 'ai.affinity.strongNegativeKeywords',
    label: '强负向关键词',
    component: 'InputTextArea',
    bottomHelpMessage: '明显攻击关键词，逗号或换行分隔',
    componentProps: {
      rows: 2,
      placeholder: '请输入强负向关键词',
    },
  },
  {
    field: 'ai.affinity.decayPerDay',
    label: '每日衰减',
    component: 'InputNumber',
    bottomHelpMessage: '每天向 0 回归的分值',
    componentProps: {
      min: 0,
      max: 10,
      step: 1,
      placeholder: '请输入每日衰减',
    },
  },
  {
    field: 'ai.affinity.minScore',
    label: '最小分值',
    component: 'InputNumber',
    bottomHelpMessage: '好感度最小值',
    componentProps: {
      min: -100,
      max: 0,
      step: 1,
      placeholder: '请输入最小分值',
    },
  },
  {
    field: 'ai.affinity.maxScore',
    label: '最大分值',
    component: 'InputNumber',
    bottomHelpMessage: '好感度最大值',
    componentProps: {
      min: 0,
      max: 100,
      step: 1,
      placeholder: '请输入最大分值',
    },
  },
  {
    field: 'ai.affinity.coldThreshold',
    label: '冷淡阈值',
    component: 'InputNumber',
    bottomHelpMessage: '低于等于此值时视为冷淡',
    componentProps: {
      min: -100,
      max: 0,
      step: 1,
      placeholder: '请输入冷淡阈值',
    },
  },
  {
    field: 'ai.affinity.neutralThreshold',
    label: '熟悉阈值',
    component: 'InputNumber',
    bottomHelpMessage: '达到此值后进入熟悉档位',
    componentProps: {
      min: -20,
      max: 50,
      step: 1,
      placeholder: '请输入熟悉阈值',
    },
  },
  {
    field: 'ai.affinity.warmThreshold',
    label: '亲近阈值',
    component: 'InputNumber',
    bottomHelpMessage: '达到此值后进入亲近档位',
    componentProps: {
      min: 0,
      max: 100,
      step: 1,
      placeholder: '请输入亲近阈值',
    },
  },
  {
    field: 'ai.affinity.toneByLevel.cold',
    label: '冷淡语气',
    component: 'InputTextArea',
    bottomHelpMessage: '冷淡档位下的回复语气建议，只影响表达风格',
    componentProps: {
      rows: 2,
      placeholder: '请输入冷淡语气建议',
    },
  },
  {
    field: 'ai.affinity.toneByLevel.neutral',
    label: '普通语气',
    component: 'InputTextArea',
    bottomHelpMessage: '普通档位下的回复语气建议',
    componentProps: {
      rows: 2,
      placeholder: '请输入普通语气建议',
    },
  },
  {
    field: 'ai.affinity.toneByLevel.familiar',
    label: '熟悉语气',
    component: 'InputTextArea',
    bottomHelpMessage: '熟悉档位下的回复语气建议',
    componentProps: {
      rows: 2,
      placeholder: '请输入熟悉语气建议',
    },
  },
  {
    field: 'ai.affinity.toneByLevel.warm',
    label: '亲近语气',
    component: 'InputTextArea',
    bottomHelpMessage: '亲近档位下的回复语气建议',
    componentProps: {
      rows: 2,
      placeholder: '请输入亲近语气建议',
    },
  },
  {
    label: '防刷分保护',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'ai.affinity.keywordCooldownMs',
    label: '关键词冷却时间',
    component: 'InputNumber',
    bottomHelpMessage: '同一关键词触发好感变化的冷却时间，单位毫秒，默认5分钟',
    componentProps: {
      min: 0,
      max: 3600000,
      step: 60000,
      placeholder: '请输入冷却时间(毫秒)',
    },
  },
  {
    field: 'ai.affinity.duplicateTextCooldownMs',
    label: '重复文本冷却时间',
    component: 'InputNumber',
    bottomHelpMessage: '相同文本重复触发好感变化的冷却时间，单位毫秒，默认10分钟',
    componentProps: {
      min: 0,
      max: 3600000,
      step: 60000,
      placeholder: '请输入冷却时间(毫秒)',
    },
  },
  {
    field: 'ai.affinity.streakAttenuationThreshold',
    label: '连续衰减阈值',
    component: 'InputNumber',
    bottomHelpMessage: '连续同向变化多少次后开始衰减，默认3次',
    componentProps: {
      min: 1,
      max: 20,
      step: 1,
      placeholder: '请输入阈值',
    },
  },
  {
    field: 'ai.affinity.streakAttenuationFactor',
    label: '连续衰减系数',
    component: 'InputNumber',
    bottomHelpMessage: '连续同向变化超过阈值后的衰减系数，默认0.5即减半',
    componentProps: {
      min: 0,
      max: 1,
      step: 0.1,
      precision: 2,
      placeholder: '请输入衰减系数',
    },
  },
  {
    field: 'ai.typo.enabled',
    label: '启用错字生成',
    component: 'Switch',
    bottomHelpMessage: '让回复偶尔带一点自然口语化错字',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'ai.typo.errorRate',
    label: '单字替换概率',
    component: 'InputNumber',
    bottomHelpMessage: '每个字被替换成近似错字的概率',
    componentProps: {
      min: 0,
      max: 1,
      step: 0.01,
      precision: 2,
      placeholder: '请输入单字替换概率',
    },
  },
  {
    field: 'ai.typo.wordReplaceRate',
    label: '整词替换概率',
    component: 'InputNumber',
    bottomHelpMessage: '整词口语化替换概率',
    componentProps: {
      min: 0,
      max: 1,
      step: 0.01,
      precision: 2,
      placeholder: '请输入整词替换概率',
    },
  },
  {
    field: 'ai.dynamicDelay.enabled',
    label: '启用动态延迟',
    component: 'Switch',
    bottomHelpMessage: '群聊高频互动时先收集消息再统一处理，减少刷屏',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'ai.dynamicDelay.interactionWindowMs',
    label: '互动统计窗口',
    component: 'InputNumber',
    bottomHelpMessage: '统计互动频率的时间窗口，单位毫秒',
    componentProps: {
      min: 1000,
      max: 600000,
      step: 1000,
      placeholder: '请输入互动统计窗口(毫秒)',
    },
  },
  {
    field: 'ai.dynamicDelay.baseDelayMs',
    label: '基础延迟时间',
    component: 'InputNumber',
    bottomHelpMessage: '开始批量收集消息时的基础延迟，单位毫秒',
    componentProps: {
      min: 0,
      max: 120000,
      step: 500,
      placeholder: '请输入基础延迟时间(毫秒)',
    },
  },
  {
    field: 'ai.dynamicDelay.maxDelayMs',
    label: '最大延迟时间',
    component: 'InputNumber',
    bottomHelpMessage: '动态延迟允许增长到的最大值，单位毫秒',
    componentProps: {
      min: 0,
      max: 300000,
      step: 1000,
      placeholder: '请输入最大延迟时间(毫秒)',
    },
  },
  {
    field: 'ai.cooldownAfterReplyMs',
    label: '回复后冷却时间',
    component: 'InputNumber',
    bottomHelpMessage: '机器人回复后暂停处理新消息的时间，单位毫秒',
    componentProps: {
      min: 0,
      max: 300000,
      step: 1000,
      placeholder: '请输入冷却时间(毫秒)',
    },
  },
  {
    label: '追踪接话',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'ai.followUp.enabled',
    label: '回复后继续监听',
    component: 'Switch',
    bottomHelpMessage: '机器人回复后，是否继续监听接下来的群消息，并在窗口期内按上下文继续接话',
    componentProps: {
      checkedValue: true,
      unCheckedValue: false,
    },
  },
  {
    field: 'ai.followUp.windowMs',
    label: '后续监控时长',
    component: 'InputNumber',
    bottomHelpMessage: '机器人回复后持续关注群聊的时间窗口，单位毫秒',
    componentProps: {
      min: 0,
      max: 600000,
      step: 1000,
      placeholder: '请输入后续监控时长(毫秒)',
    },
  },
  {
    field: 'ai.followUp.maxMessages',
    label: '后续观察条数',
    component: 'InputNumber',
    bottomHelpMessage: '持续关注窗口内最多观察多少条后续群消息',
    componentProps: {
      min: 1,
      max: 20,
      step: 1,
      placeholder: '请输入后续观察条数',
    },
  },
  {
    label: '回复风格与渲染',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'ai.personality.stateProbability',
    label: '人格状态触发概率',
    component: 'InputNumber',
    bottomHelpMessage: '随机切换到额外人格状态的概率',
    componentProps: {
      min: 0,
      max: 1,
      step: 0.01,
      precision: 2,
      placeholder: '请输入人格状态触发概率',
    },
  },
  {
    field: 'ai.personality.states',
    label: '人格状态列表',
    component: 'InputArray',
    bottomHelpMessage: '可随机切换的额外人格状态，如开心、困倦、慵懒',
    componentProps: {
      placeholder: '请输入人格状态，按回车添加',
    },
  },
  {
    field: 'ai.replyStyle.baseStyle',
    label: '基础回复风格',
    component: 'Input',
    bottomHelpMessage: '默认回复风格描述',
    componentProps: {
      placeholder: '请输入基础回复风格',
    },
  },
  {
    field: 'ai.replyStyle.multipleProbability',
    label: '特殊风格触发概率',
    component: 'InputNumber',
    bottomHelpMessage: '随机启用特殊回复风格的概率',
    componentProps: {
      min: 0,
      max: 1,
      step: 0.01,
      precision: 2,
      placeholder: '请输入特殊风格触发概率',
    },
  },
  {
    field: 'ai.replyStyle.multipleStyles',
    label: '特殊回复风格列表',
    component: 'InputArray',
    bottomHelpMessage: '可随机切换的回复风格，如调皮、认真、慵懒',
    componentProps: {
      placeholder: '请输入回复风格，按回车添加',
    },
  },
  {
    field: 'ai.blockGroup',
    label: '禁用群聊',
    component: 'InputArray',
    bottomHelpMessage: '黑名单群聊，AI不会在这些群聊中工作',
    componentProps: {
      placeholder: '请输入群号，按回车添加',
    },
  },
  {
    field: 'ai.whiteGroup',
    label: '白名单群聊',
    component: 'InputArray',
    bottomHelpMessage: '白名单群聊，存在时黑名单将被禁用',
    componentProps: {
      placeholder: '请输入群号，按回车添加',
    },
  },
  {
    field: 'ai.codeRenderer.fontSize',
    label: '代码字体大小',
    component: 'InputNumber',
    bottomHelpMessage: '代码渲染的字体大小',
    componentProps: {
      min: 10,
      max: 24,
      step: 1,
      placeholder: '请输入字体大小',
    },
  },
  {
    field: 'ai.markdownRenderer.fontSize',
    label: 'Markdown字体大小',
    component: 'InputNumber',
    bottomHelpMessage: 'Markdown渲染的字体大小',
    componentProps: {
      min: 10,
      max: 24,
      step: 1,
      placeholder: '请输入字体大小',
    },
  },
  // 60s.json - 60s新闻配置
  {
    label: '60s新闻',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: '60s.url',
    label: '60s新闻API',
    component: 'Input',
    bottomHelpMessage: '60s新闻的API地址',
    required: true,
    componentProps: {
      placeholder: '请输入60s新闻API地址',
    },
  },

  // music.json - 音乐配置
  {
    label: '点歌配置',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'music.urls',
    label: '音乐源地址',
    component: 'InputTextArea',
    bottomHelpMessage: '支持配置多个音乐源地址，按行、逗号或分号分隔，按顺序自动回退',
    required: true,
    componentProps: {
      rows: 4,
      placeholder: '每行一个音乐 API 地址，也可使用逗号或分号分隔',
    },
  },
  {
    field: 'music.quality',
    label: '默认音质',
    component: 'Select',
    bottomHelpMessage: '1 为低音质转语音，2 为 320kbps，3 为 FLAC',
    componentProps: {
      options: [
        { label: '1 - 低音质转语音', value: '1' },
        { label: '2 - 320kbps', value: '2' },
        { label: '3 - FLAC', value: '3' },
      ],
      placeholder: '请选择默认音质',
    },
  },

  // poke.json - 戳一戳配置
  {
    label: '戳一戳',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'poke.replyPoke',
    label: '戳一戳回戳概率',
    component: 'InputNumber',
    bottomHelpMessage: '戳一戳回戳概率',
    componentProps: {
      min: 0,
      max: 1,
      step: 0.1,
      placeholder: '请输入回戳概率',
    },
  },
  {
    field: 'poke.replyMode',
    label: '回复模式',
    component: 'Select',
    bottomHelpMessage: '选择使用AI回复、普通文案，或优先AI失败再回退普通文案',
    componentProps: {
      options: [
        { label: '自动回退', value: 'auto' },
        { label: '仅AI回复', value: 'ai' },
        { label: '仅普通回复', value: 'normal' },
      ],
      placeholder: '请选择戳一戳回复模式',
    },
  },
  {
    field: 'poke.model',
    label: '戳一戳模型',
    component: 'Input',
    bottomHelpMessage: '建议填写更小更快的模型，留空时回退到辅助工作模型或文本模型',
    componentProps: {
      placeholder: '请输入戳一戳专用模型名称',
    },
  },
  {
    field: 'poke.temperature',
    label: '戳一戳温度',
    component: 'InputNumber',
    bottomHelpMessage: '温度越高越活泼，推荐 0.6-1.2',
    componentProps: {
      min: 0,
      max: 2,
      step: 0.1,
      precision: 1,
      placeholder: '请输入戳一戳温度',
    },
  },
  {
    field: 'poke.maxTokens',
    label: '回复长度上限',
    component: 'InputNumber',
    bottomHelpMessage: '控制戳一戳AI回复长度，避免话太多',
    componentProps: {
      min: 16,
      max: 256,
      step: 8,
      placeholder: '请输入最大输出token数',
    },
  },
  {
    field: 'poke.prompt',
    label: '戳一戳提示词',
    component: 'InputTextArea',
    bottomHelpMessage: '可用变量：{{botName}} {{operatorName}} {{groupName}} {{operatorId}}',
    componentProps: {
      rows: 6,
      placeholder: '请输入戳一戳AI提示词',
    },
  },
  {
    field: 'poke.fallbackReply',
    label: '戳一戳专用兜底回复',
    component: 'InputTextArea',
    bottomHelpMessage: 'AI 失败时使用；留空则使用内置戳一戳短句，不再回退到通用 AI 兜底',
    componentProps: {
      rows: 4,
      placeholder: '请输入戳一戳专用兜底回复',
    },
  },
  {
    field: 'poke.pokeMemeEmotion',
    label: '默认表情情绪',
    component: 'Select',
    bottomHelpMessage: '戳一戳附带表情包时优先使用的默认情绪',
    componentProps: {
      options: [
        { label: '默认', value: 'default' },
        { label: '开心', value: 'happy' },
        { label: '难过', value: 'sad' },
        { label: '生气', value: 'angry' },
        { label: '困惑', value: 'confused' },
        { label: '害羞', value: 'shy' },
        { label: '惊讶', value: 'surprised' },
      ],
      placeholder: '请选择默认表情情绪',
    },
  },

  // profile.json - 用户资料配置
  {
    label: '机器人资料',
    component: 'SOFT_GROUP_BEGIN',
  },
  {
    field: 'profile.nickName',
    label: '机器人昵称',
    component: 'Input',
    bottomHelpMessage: '机器人的昵称',
    componentProps: {
      placeholder: '请输入机器人昵称',
    },
  },
];

export default guobaSchema;
