import plugin from '../../../lib/plugins/plugin.js';
import fs from 'fs';
import path from 'path';
import Path from '../constants/path.js';
import ConfigControl from '../lib/config/configControl.js';
import { createLogDiagnosisConsole } from '../lib/webConsole/logDiagnosisConsole.js';
import { buildWebConsoleConfig } from '../lib/webConsole/webConsoleConfig.js';
import { renderLogDiagnosisImage } from '../lib/system/logDiagnosisImageRenderer.js';

let diagnosisRunning = false;

function getWebConsoleConfig() {
  return buildWebConsoleConfig(ConfigControl.get('config') || {});
}

function formatSelectedFiles(files = []) {
  if (!Array.isArray(files) || files.length <= 0) {
    return '未选中日志文件';
  }
  return files
    .slice(0, 5)
    .map(file => `${file.displayPath || '-'}(${file.hitCount || 0})`)
    .join('，');
}

function clipReplyText(value = '', maxLength = 2800) {
  const text = String(value || '').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n\n……内容较长，已截断。` : text;
}

function createGroupLogDiagnosis() {
  return createLogDiagnosisConsole({
    fs,
    path,
    Path,
    logger,
    getWebConsoleConfig,
  });
}

export default class CrystelfLogDiagnosis extends plugin {
  constructor() {
    super({
      name: 'crystelf-log-diagnosis',
      dsc: '灵晶日志 AI 排查',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^#灵晶排查日志$',
          fnc: 'diagnoseLogs',
        },
      ],
    });
  }

  async diagnoseLogs(e) {
    if (!e.isMaster) {
      return e.reply('只有主人可以在 QQ 内触发日志排查。', true);
    }

    const config = ConfigControl.get('config') || {};
    if (config.ai === false) {
      return e.reply('AI 功能已关闭，无法执行日志排查。', true);
    }
    if (config.webConsoleExposeLogs === false) {
      return e.reply('控制台日志查看已关闭，QQ 日志排查也不会读取日志。', true);
    }
    if (diagnosisRunning) {
      return e.reply('日志排查正在执行中，请稍后再试。', true);
    }

    diagnosisRunning = true;
    try {
      await e.reply('开始读取最近日志并交给 AI 排查，请稍等。', true);
      const diagnoser = createGroupLogDiagnosis();
      const result = await diagnoser.diagnosePayload({
        source: 'auto',
        includeWarnings: true,
        maxTokens: 1200,
      });
      try {
        const imagePath = await renderLogDiagnosisImage(result);
        if (imagePath) {
          return e.reply(segment.image(imagePath), true);
        }
      } catch (renderError) {
        logger.warn(`[crystelf-plugin] 日志排查图片渲染失败，回退文本: ${renderError.message}`);
      }

      const lines = [
        '灵晶日志排查结果',
        '━━━━━━━━━━━━',
        `时间：${new Date(result.diagnosedAt || Date.now()).toLocaleString('zh-CN', { hour12: false })}`,
        `命中：${result.hitCount || 0} 条疑似错误/告警`,
        `文件：${formatSelectedFiles(result.selectedFiles)}`,
        '',
        clipReplyText(result.analysis || 'AI 未返回排查结论。'),
      ];
      return e.reply(lines.join('\n'), true);
    } catch (error) {
      logger.error('[crystelf-plugin] QQ 日志排查失败:', error);
      return e.reply(`日志排查失败：${error.message || error}`, true);
    } finally {
      diagnosisRunning = false;
    }
  }
}
