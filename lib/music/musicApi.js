import axios from 'axios';
import configControl from '../config/configControl.js';

class MusicApi {
  constructor() {
    this.config = null;
    this.baseUrls = [];
  }

  async init() {
    this.config = configControl.get('music');
    const configuredUrls = Array.isArray(this.config.urls)
      ? this.config.urls
      : String(this.config.url || '')
          .split(/\r?\n|,|;/)
          .map(item => item.trim())
          .filter(Boolean);
    this.baseUrls = configuredUrls.length > 0
      ? configuredUrls
      : ['https://api.xcvts.cn/api/music/bdyy'];
  }

  async request(params = {}) {
    for (const baseUrl of this.baseUrls) {
      try {
        const response = await axios.get(baseUrl, {
          params: {
            type: 'json',
            ...params,
          },
          timeout: 20000,
        });
        if (response.data?.code === 200) {
          return response.data;
        }
        logger.error(`[crystelf-music] API返回错误 [${baseUrl}]: ${response.data?.msg || response.data?.text || '未知错误'}`);
      } catch (error) {
        logger.error(`[crystelf-music] API请求失败 [${baseUrl}]: ${error.message}`);
      }
    }
    return null;
  }

  getQualityParam(quality) {
    const qualityMap = {
      1: '48kaac',
      2: '320kmp3',
      3: '2000kflac',
    };
    return qualityMap[Number(quality)] || qualityMap[3];
  }

  decodeText(value = '') {
    try {
      return decodeURIComponent(escape(String(value || '')));
    } catch {
      return String(value || '');
    }
  }

  normalizeSong(song = {}, index = 0) {
    return {
      id: String(index + 1),
      title: this.decodeText(song.name || ''),
      artist: this.decodeText(song.artist || ''),
      album: '',
      duration: 0,
      suffix: 'mp3',
      cover: song.cover || song.pic || '',
      detailPage: song.detail_page || '',
      playUrl: song.play_url || '',
      lyric: song.lrc || '',
    };
  }

  async getSongByIndex(query, index, quality) {
    const response = await this.request({
      msg: query,
      n: index,
      bf: this.getQualityParam(quality),
    });
    if (!response?.data) {
      logger.error('[crystelf-music] API返回格式异常');
        return null;
    }
    return this.normalizeSong(response.data, index - 1);
  }

  /**
   * 搜索音乐
   * @param {string} query 搜索关键词（歌曲名、歌手名或专辑名）
   * @param {number} count 返回结果数量
   * @returns {Promise<Array>} 搜索结果数组
   */
  async searchMusic(query, count = 20) {
    if (!query || query.trim().length === 0) {
      logger.error('[crystelf-music] 搜索关键词不能为空');
      return null;
    }

    try {
      const response = await this.request({
        msg: query.trim(),
        sc: count,
        p: 1,
      });
      const songs = Array.isArray(response?.data) ? response.data : [];
      const topSongs = songs.slice(0, count).map((song, index) => this.normalizeSong(song, index));
      return this.enhanceSearchResults(topSongs, query);
    } catch (error) {
      logger.error('[crystelf-music] 搜索失败:', error.message);
      return null;
    }
  }


  /**
   * 增强搜索结果并排序
   * @param {Array} songs 原始歌曲列表
   * @param {string} query 搜索关键词
   * @returns {Array} 增强后的歌曲列表
   */
  enhanceSearchResults(songs, query) {
    const queryLower = query.toLowerCase();
    
    return songs.map((song, index) => {
      const title = song.title?.toLowerCase() || '';
      const artist = song.artist?.toLowerCase() || '';
      const album = song.album?.toLowerCase() || '';
      let score = 0;
      if (title.includes(queryLower)) {
        score += 100;
        if (title.startsWith(queryLower)) score += 50;
      }
      if (artist.includes(queryLower)) {
        score += 50;
        if (artist.startsWith(queryLower)) score += 25;
      }
      if (album.includes(queryLower)) {
        score += 30;
        if (album.startsWith(queryLower)) score += 15;
      }
      if (song.duration && song.duration > 120 && song.duration < 480) {
        score += 10;
      }
      score += (1000 - index) * 0.01;
      
      return {
        ...song,
        score,
        sourceQuery: query,
        sourceIndex: index + 1,
        displayTitle: song.title || '未知歌曲',
        displayArtist: song.artist || '未知艺术家',
        displayAlbum: song.album || '未知专辑',
        duration: song.duration ? this.formatDuration(song.duration) : '未知',
        format: this.getAudioFormat(song.suffix),
        size: song.size ? this.formatFileSize(song.size) : '未知大小'
      };
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * 根据ID获取歌曲详细信息
   * @param {string} songId 歌曲ID
   * @returns {Promise<Object>} 歌曲详细信息
   */
  async getSongById(songId) {
    return null;
  }

  /**
   * 根据音质设置获取流媒体URL
   * @param {string} songId 歌曲ID
   * @param {number} quality 音质设置 (1=96kbps, 2=320kbps, 3=FLAC)
   * @returns {string} 流媒体URL
   */
  getStreamingUrl(songId, quality) {
    return songId;
  }

  /**
   * 格式化时长
   * @param {number} seconds 秒数
   * @returns {string} 格式化后的时长
   */
  formatDuration(seconds) {
    if (!seconds) return '未知';
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  /**
   * 格式化文件大小
   * @param {number} bytes 字节数
   * @returns {string} 格式化后的大小
   */
  formatFileSize(bytes) {
    if (!bytes) return '未知';
    
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  /**
   * 根据文件后缀获取音频格式
   * @param {string} suffix 文件后缀
   * @returns {string} 音频格式
   */
  getAudioFormat(suffix) {
    const formatMap = {
      'mp3': 'MP3',
      'flac': 'FLAC',
      'aac': 'AAC',
      'm4a': 'M4A',
      'ogg': 'OGG',
      'wav': 'WAV'
    };
    
    return formatMap[suffix?.toLowerCase()] || suffix?.toUpperCase() || '未知';
  }
}

export default MusicApi;
