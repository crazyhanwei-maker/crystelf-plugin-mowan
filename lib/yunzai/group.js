import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const VOICE_SAMPLE_RATE = 24000;

const Group = {
  getGlobalBot() {
    return typeof globalThis !== 'undefined' ? globalThis.Bot : undefined;
  },

  getBot(e) {
    return e?.bot || this.getGlobalBot();
  },

  async callBotApi(e, api, params) {
    const bot = this.getBot(e);
    if (typeof bot?.sendApi === 'function') {
      return await bot.sendApi(api, params);
    }
    logger.warn(`[crystelf-group] 当前环境不支持 sendApi: ${api}`);
    return null;
  },

  async sendMessageByEvent(e, group_id, message) {
    if (typeof e?.reply === 'function') {
      return await e.reply(message);
    }
    const bot = this.getBot(e);
    const group = bot?.pickGroup?.(group_id);
    if (typeof group?.sendMsg === 'function') {
      return await group.sendMsg(message);
    }
    return null;
  },

  getSegment() {
    return typeof globalThis !== 'undefined' ? globalThis.segment : undefined;
  },

  getFfmpegPath() {
    return this.getGlobalBot()?.config?.ffmpeg_path || 'ffmpeg';
  },

  getLocalFilePath(file) {
    const text = String(file || '').trim();
    if (!text) return '';
    if (/^https?:\/\//i.test(text) || /^base64:\/\//i.test(text) || /^protobuf:\/\//i.test(text)) {
      return '';
    }
    if (/^file:\/\//i.test(text)) {
      try {
        return fileURLToPath(text);
      } catch {
        const stripped = text.replace(/^file:\/+/i, process.platform === 'win32' ? '' : '/');
        return process.platform === 'win32' ? stripped.replace(/^\//, '') : stripped;
      }
    }
    return text;
  },

  getGroup(e, group_id) {
    if (String(e?.group_id || '') === String(group_id || '') && e?.group) {
      return e.group;
    }
    const bot = this.getBot(e);
    return bot?.pickGroup?.(group_id) || this.getGlobalBot()?.pickGroup?.(group_id) || null;
  },

  formatError(error) {
    if (!error) return 'unknown error';
    const code = error.code !== undefined ? `code=${error.code} ` : '';
    return `${code}${error.message || String(error)}`.trim();
  },

  async loadSilkWasm() {
    const candidates = [
      'silk-wasm',
      pathToFileURL(path.join(process.cwd(), 'node_modules', '.pnpm', 'node_modules', 'silk-wasm', 'lib', 'index.mjs')).href,
      pathToFileURL(path.join(process.cwd(), 'node_modules', '.pnpm', 'silk-wasm@3.7.1', 'node_modules', 'silk-wasm', 'lib', 'index.mjs')).href,
      pathToFileURL(path.join(process.cwd(), 'plugins', 'xiaofei-plugin', 'node_modules', 'silk-wasm', 'lib', 'index.mjs')).href,
    ];

    let lastError = null;
    for (const candidate of candidates) {
      try {
        return await import(candidate);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('未找到 silk-wasm');
  },

  runFfmpeg(args) {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn(this.getFfmpegPath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      ffmpeg.stderr.on('data', data => {
        stderr += data.toString();
      });
      ffmpeg.on('error', error => {
        reject(new Error(`ffmpeg 启动失败: ${error.message}`));
      });
      ffmpeg.on('close', code => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg 转码失败(${code}): ${stderr.trim().slice(0, 500)}`));
        }
      });
    });
  },

  async readFileHeader(filePath, length = 16) {
    const handle = await fs.promises.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const result = await handle.read(buffer, 0, length, 0);
      return buffer.subarray(0, result.bytesRead);
    } finally {
      await handle.close();
    }
  },

  async getSilkDurationSeconds(filePath, silkModule = null) {
    const silk = silkModule || await this.loadSilkWasm();
    const data = await fs.promises.readFile(filePath);
    const durationMs = Number(silk.getDuration?.(data) || 0);
    return durationMs > 0 ? Math.max(1, Math.ceil(durationMs / 1000)) : 0;
  },

  async convertLocalAudioToSilk(filePath) {
    const stat = await fs.promises.stat(filePath);
    const key = crypto
      .createHash('md5')
      .update(`${filePath}:${stat.size}:${Math.floor(stat.mtimeMs)}`)
      .digest('hex')
      .slice(0, 16);
    const voiceDir = path.join(process.cwd(), 'temp', 'crystelf-plugin', 'voice');
    await fs.promises.mkdir(voiceDir, { recursive: true });
    const baseName = path.basename(filePath, path.extname(filePath)).replace(/[<>:"/\\|?*\s]+/g, '_').slice(0, 80);
    const pcmPath = path.join(voiceDir, `${baseName}_${key}.pcm`);
    const silkPath = path.join(voiceDir, `${baseName}_${key}.silk`);
    const silk = await this.loadSilkWasm();

    try {
      if (fs.existsSync(silkPath)) {
        return {
          file: silkPath,
          seconds: await this.getSilkDurationSeconds(silkPath, silk),
          cached: true,
        };
      }

      await this.runFfmpeg([
        '-y',
        '-i', filePath,
        '-vn',
        '-ac', '1',
        '-ar', String(VOICE_SAMPLE_RATE),
        '-f', 's16le',
        pcmPath,
      ]);
      const pcm = await fs.promises.readFile(pcmPath);
      const encoded = await silk.encode(pcm, VOICE_SAMPLE_RATE);
      if (!encoded?.data?.length) {
        throw new Error('silk 编码结果为空');
      }
      await fs.promises.writeFile(silkPath, Buffer.from(encoded.data));
      const seconds = Number(encoded.duration || 0) > 0
        ? Math.max(1, Math.ceil(Number(encoded.duration) / 1000))
        : await this.getSilkDurationSeconds(silkPath, silk);
      return { file: silkPath, seconds, cached: false };
    } finally {
      fs.promises.unlink(pcmPath).catch(() => {});
    }
  },

  async preparePttRecordFile(file) {
    const filePath = this.getLocalFilePath(file);
    if (!filePath || !fs.existsSync(filePath)) {
      return { file, seconds: 0, converted: false };
    }

    const header = await this.readFileHeader(filePath);
    const headerText = header.toString();
    if (headerText.includes('SILK')) {
      return {
        file: filePath,
        seconds: await this.getSilkDurationSeconds(filePath).catch(() => 0),
        converted: false,
      };
    }
    if (headerText.includes('AMR')) {
      return { file: filePath, seconds: 0, converted: false };
    }

    const converted = await this.convertLocalAudioToSilk(filePath);
    logger.info(`[crystelf-group] 已将音频转为 SILK 语音: ${path.basename(converted.file)}${converted.cached ? ' (缓存)' : ''}`);
    return {
      file: converted.file,
      seconds: converted.seconds,
      converted: true,
    };
  },

  /**
   * 群戳一戳
   * @param e
   * @param user_id 被戳的用户
   * @param group_id 群号
   * @returns {Promise<*>}
   */
  async groupPoke(e, user_id, group_id) {
    return await this.callBotApi(e, 'group_poke', {
      group_id: group_id,
      user_id: user_id,
    });
  },

  /**
   * 群踢人
   * @param e
   * @param user_id 要踢的人
   * @param group_id 群号
   * @param ban 是否允许再次加群
   * @returns {Promise<*>}
   */
  async groupKick(e, user_id, group_id, ban) {
    return await this.callBotApi(e, 'set_group_kick', {
      user_id: user_id,
      group_id: group_id,
      reject_add_request: ban,
    });
  },

  /**
   * 发送群语音
   * @param e
   * @param group_id
   * @param file 本地文件：file://,网络文件:https://
   * @param adapter nc/lgr
   * @returns {Promise<void>}
   */
  async sendGroupRecord(e,group_id,file,adapter='nc'){
    const resolvedAdapter = adapter === 'lgr' ? 'lgr' : 'nc';
    if (typeof globalThis?.uploadRecord === 'function') {
      try {
        const pttFile = await this.preparePttRecordFile(file);
        const recordMessage = await globalThis.uploadRecord(pttFile.file, pttFile.seconds || 0, true);
        if (recordMessage) {
          const result = await this.sendMessageByEvent(e, group_id, recordMessage);
          if (result !== null) {
            logger.info('[crystelf-group] 已通过 PTT SILK 上传方式发送群语音');
            return result;
          }
        }
      } catch (error) {
        logger.warn(`[crystelf-group] PTT 上传方式发送群语音失败: ${error.message}`);
      }
    }

    const segment = this.getSegment();
    if (typeof segment?.record === 'function') {
      try {
        const recordMessage = await segment.record(file);
        const result = await this.sendMessageByEvent(e, group_id, recordMessage);
        if (result !== null) {
          logger.info('[crystelf-group] 已通过 segment.record 发送群语音');
          return result;
        }
      } catch (error) {
        logger.warn(`[crystelf-group] segment.record 发送群语音失败: ${error.message}`);
      }
    }

    if(resolvedAdapter === 'nc'){
      return await this.callBotApi(e, 'send_group_msg', {
        group_id:group_id,
        message: [
          {
            type: "record",
            data: {
              file : file,
            }
          }
        ]
      });
    } else if(resolvedAdapter === 'lgr'){
      return await this.callBotApi(e, 'send_group_msg', {
        group_id: group_id,
        message:{
          type: "dict",
          data:{
            file:file
          }
        }
      });
    }
  },

  /**
   * 发送群文件
   * @param e
   * @param group_id
   * @param file file://
   * @param name 文件名
   * @param adapter nc/lgr
   * @returns {Promise<void>}
   */
  async sendGroupFile(e,group_id,file,name,adapter='nc'){
    const params = {
      group_id: group_id,
      file: file,
      name: name
    };

    const bot = this.getBot(e);
    let apiError = null;
    if (typeof bot?.sendApi === 'function') {
      try {
        return await bot.sendApi('upload_group_file', params);
      } catch (error) {
        apiError = error;
        logger.warn(`[crystelf-group] upload_group_file 上传群文件失败，尝试群对象兜底: ${error.message}`);
      }
    } else {
      logger.warn('[crystelf-group] 当前环境不支持 sendApi: upload_group_file，尝试群对象兜底');
    }

    const localFile = this.getLocalFilePath(file);
    if (!localFile) {
      const message = '当前环境不支持 upload_group_file，且文件不是本地路径，无法使用 sendFile 兜底';
      if (apiError) throw new Error(`${message}: ${apiError.message}`);
      throw new Error(message);
    }
    if (!fs.existsSync(localFile)) {
      throw new Error(`群文件不存在，无法上传: ${localFile}`);
    }

    const group = this.getGroup(e, group_id);
    const failures = [];
    const candidates = [
      {
        name: 'group.fs.upload',
        enabled: typeof group?.fs?.upload === 'function',
        run: () => group.fs.upload(localFile, '/', name),
      },
      {
        name: 'group.uploadFile',
        enabled: typeof group?.uploadFile === 'function',
        run: () => group.uploadFile(localFile, name),
      },
      {
        name: 'group.fsend',
        enabled: typeof group?.fsend === 'function',
        run: () => group.fsend(localFile, name),
      },
      {
        name: 'group.sendFile',
        enabled: typeof group?.sendFile === 'function',
        run: () => group.sendFile(localFile, name),
      },
    ];

    for (const candidate of candidates) {
      if (!candidate.enabled) {
        continue;
      }
      try {
        const result = await candidate.run();
        if (result !== null && result !== undefined) {
          logger.info(`[crystelf-group] 已通过 ${candidate.name} 兜底上传群文件`);
          return result;
        }
        const message = `${candidate.name} 未返回上传结果`;
        failures.push(message);
        logger.warn(`[crystelf-group] ${message}`);
      } catch (error) {
        const message = `${candidate.name}: ${this.formatError(error)}`;
        failures.push(message);
        logger.warn(`[crystelf-group] ${candidate.name} 上传群文件失败: ${this.formatError(error)}`);
      }
    }

    const detail = failures.length ? `；失败详情: ${failures.join(' | ')}` : '';
    throw new Error(`当前环境不支持 upload_group_file，也没有可用的群文件上传能力(adapter=${adapter || 'unknown'})${detail}`);
  }
};
export default Group;
