import fs from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import path from 'path';
import Meme from '../core/meme.js';
import { resolvePreferredMemeCharacter } from '../ai/personaIdentity.js';

export class EmojiAgent {
  constructor(ai, config, db) {
    this.ai = ai;
    this.config = config;
    this.db = db;
    this.memeBaseDir = '';
  }

  getLocalBaseDir() {
    return Meme.resolveLocalBaseDir(this.config?.memeConfig || {});
  }

  isLocalEnabled() {
    return this.config?.memeConfig?.localEnabled !== false;
  }

  getPreferredCharacter(explicitCharacter = '') {
    return resolvePreferredMemeCharacter({
      explicitCharacter,
      configuredCharacter: this.config?.memeConfig?.character || this.config?.character || '',
      fallbackCharacter: this.config?.nickName || this.config?.nickname || '芙宁娜',
    });
  }

  findCharacterDirectory(character) {
    const baseDir = this.getLocalBaseDir();
    if (!existsSync(baseDir)) {
      return '';
    }

    const target = String(character || '').trim().toLowerCase();
    if (!target) {
      return '';
    }

    const entries = readdirSync(baseDir, { withFileTypes: true });
    const matched = entries.find(entry => entry.isDirectory() && entry.name.toLowerCase() === target);
    return matched ? path.join(baseDir, matched.name) : '';
  }

  getAvailableCharacters() {
    if (Array.isArray(this.cachedCharacters) && this.cachedCharacters.length > 0) {
      return this.cachedCharacters;
    }

    if (!this.isLocalEnabled()) {
      return [];
    }

    const baseDir = this.getLocalBaseDir();
    if (!existsSync(baseDir)) {
      return [];
    }

    const entries = readdirSync(baseDir, { withFileTypes: true });
    const dirs = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);

    this.cachedCharacters = dirs;
    return dirs;
  }

  getAvailableEmotions(character) {
    if (!this.isLocalEnabled()) {
      return [];
    }

    const characterDir = this.findCharacterDirectory(character);
    if (!existsSync(characterDir)) {
      return [];
    }

    const entries = readdirSync(characterDir, { withFileTypes: true });
    const dirs = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);

    const rootImages = entries.some(entry => entry.isFile() && ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(path.extname(entry.name).toLowerCase()));
    return rootImages ? Array.from(new Set([...dirs, 'default'])) : dirs;
  }

  async refreshCharactersFromApi() {
    const characters = await Meme.getCharacters();
    if (characters.length > 0) {
      this.cachedCharacters = characters;
    }
    return this.cachedCharacters || [];
  }

  parseMemeIntent(text) {
    const regex = /\[meme:([^:\]]+)(?::([^\]]*))?\]/i;
    const match = text.match(regex);
    if (!match) return null;

    return {
      character: match[1].trim(),
      emotion: String(match[2] || '').trim() || 'default',
    };
  }

  async processMemeResponse(aiResponseText, sessionId) {
    const intent = this.parseMemeIntent(aiResponseText);
    if (!intent) {
      return {
        success: false,
        error: 'No meme intent found in response',
      };
    }

    const chatHistory = this.db.getMessages(sessionId, 20);
    const character = this.getPreferredCharacter(intent.character);

    const emojiResult = await this.pickEmoji(
      character,
      intent.emotion,
      chatHistory
    );

    if (!emojiResult.success || !emojiResult.emojiPath) {
      return {
        success: false,
        error: emojiResult.error || 'Failed to pick emoji',
      };
    }

    const cleanedText = this.cleanMemeMarker(aiResponseText);

    return {
      success: true,
      emojiPath: emojiResult.emojiPath,
      emojiDescription: emojiResult.description,
      emojiMeta: {
        character,
        requestedCharacter: intent.character,
        emotion: emojiResult.emotion || intent.emotion,
        requestedEmotion: intent.emotion,
        source: emojiResult.source || 'unknown',
      },
      cleanedText,
    };
  }

  async pickEmoji(character, emotion, chatHistory) {
    try {
      const emotionCandidates = Meme.getEmotionCandidates(emotion);
      const preferLocal = this.config?.memeConfig?.preferLocal === true;

      const tryRemote = async () => {
        for (const candidate of emotionCandidates) {
          const imageUrl = await Meme.getPayloadImageUrl(character, candidate, 1);
          if (imageUrl) {
            return {
              success: true,
              emojiPath: imageUrl,
              description: `${character}:${candidate}`,
              emotion: candidate,
              source: 'remote',
            };
          }
        }

        const fallbackImageUrl = await Meme.getPayloadImageUrl(character, '', 1);
        if (fallbackImageUrl) {
          return {
            success: true,
            emojiPath: fallbackImageUrl,
            description: `${character}:default`,
            emotion: 'default',
            source: 'remote',
          };
        }

        return null;
      };

      const tryLocal = async () => {
        if (!this.isLocalEnabled()) {
          return null;
        }

        for (const candidate of emotionCandidates) {
          const emotionDir = this.findEmotionDirectory(character, candidate);
          if (emotionDir) {
            return await this.selectFromDirectory(
              emotionDir,
              character,
              candidate,
              chatHistory
            );
          }
        }

        const characterDir = this.findCharacterDirectory(character);
        if (characterDir) {
          return await this.selectFromDirectory(
            characterDir,
            character,
            emotionCandidates[0] || 'default',
            chatHistory
          );
        }

        return null;
      };

      if (preferLocal) {
        const localFirst = await tryLocal();
        if (localFirst?.success && localFirst.emojiPath) {
          return localFirst;
        }
      }

      const remoteEmoji = await tryRemote();
      if (remoteEmoji?.success && remoteEmoji.emojiPath) {
        return remoteEmoji;
      }

      const localEmoji = await tryLocal();
      if (localEmoji?.success && localEmoji.emojiPath) {
        return localEmoji;
      }

      return {
        success: false,
        error: `No memes found for character: ${character}, emotion: ${emotion}`,
      };
    } catch (err) {
      logger.error(`[emoji-agent] Failed to pick emoji: ${err}`);
      return {
        success: false,
        error: String(err),
      };
    }
  }

  findEmotionDirectory(character, emotion) {
    const characterDir = this.findCharacterDirectory(character);
    if (!existsSync(characterDir)) {
      return '';
    }

    const targetEmotion = String(emotion || '').trim().toLowerCase();
    const entries = readdirSync(characterDir, { withFileTypes: true });
    const match = entries.find(
      entry => entry.isDirectory() && entry.name.toLowerCase() === targetEmotion
    );

    return match ? path.join(characterDir, match.name) : '';
  }

  async selectFromDirectory(dirPath, character, emotion, chatHistory) {
    const files = (await fs.readdir(dirPath)).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
    });

    if (files.length === 0) {
      return {
        success: false,
        error: `No emoji files in directory: ${dirPath}`,
      };
    }

    if (files.length === 1 || !chatHistory || chatHistory.length === 0) {
      const emojiPath = path.join(dirPath, files[0]);
      const description = path.basename(files[0], path.extname(files[0]));
      return {
        success: true,
        emojiPath,
        description,
        emotion,
        source: 'local',
      };
    }

    const model = this.config.workingModel || this.config.model;

    const systemPrompt = `You are an emoji/sticker selection assistant. Your task is to select the most appropriate emoji/sticker from a given list based on the chat context.

Instructions:
1. Analyze the chat history provided
2. Select the emoji that best matches the current conversation mood and context
3. Consider the character's personality and the emotional tone of the conversation
4. Provide your selection in JSON format

Available emojis in directory (${character}/${emotion}):
${files.map((f, i) => `${i + 1}. ${path.basename(f, path.extname(f))}`).join('\n')}

Response format (JSON):
{
  "selectedIndex": number (1-based index from the list above),
  "reason": "brief reason why this emoji is suitable"
}`;

    const historyText = chatHistory
      .slice(-10)
      .map(msg => {
        const role = msg.role === 'assistant' ? 'Bot' : msg.userName || 'User';
        return `${role}: ${msg.content}`;
      })
      .join('\n');

    const userPrompt = `Chat history:
${historyText}

Select the most appropriate emoji for this conversation. The emoji should match the emotional context and be appropriate for character "${character}" with emotion "${emotion}".`;

    try {
      const response = await this.ai.complete({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
      });

      if (!response.content) {
        return this.randomPick(files, dirPath, emotion);
      }

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.randomPick(files, dirPath, emotion);
      }

      const result = JSON.parse(jsonMatch[0]);
      const selectedIndex = result.selectedIndex;

      if (
        typeof selectedIndex !== 'number' ||
        selectedIndex < 1 ||
        selectedIndex > files.length
      ) {
        return this.randomPick(files, dirPath, emotion);
      }

      const selectedFile = files[selectedIndex - 1];
      const emojiPath = path.join(dirPath, selectedFile);
      const description = path.basename(
        selectedFile,
        path.extname(selectedFile)
      );

      logger.info(
        `[emoji-agent] Selected: ${selectedFile} (index: ${selectedIndex}, reason: ${result.reason})`
      );

      return {
        success: true,
        emojiPath,
        description,
        emotion,
        source: 'local',
      };
    } catch (err) {
      logger.warn(`[emoji-agent] AI selection failed, using random: ${err}`);
      return this.randomPick(files, dirPath, emotion);
    }
  }

  randomPick(files, dirPath, emotion) {
    const selectedFile = files[Math.floor(Math.random() * files.length)];
    const emojiPath = path.join(dirPath, selectedFile);
    const description = path.basename(selectedFile, path.extname(selectedFile));

    return {
      success: true,
      emojiPath,
      description,
      emotion,
      source: 'local',
    };
  }

  cleanMemeMarker(text) {
    let cleaned = text.replace(/\[meme:([^:\]]+)(?::([^\]]*))?\]/gi, '');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    cleaned = cleaned
      .split('\n')
      .map(line => line.trim())
      .join('\n');
    cleaned = cleaned.trim();
    return cleaned;
  }
}
