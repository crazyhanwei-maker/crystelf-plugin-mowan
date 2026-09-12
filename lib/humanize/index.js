import { ActionPlanner } from './actionPlanner.js';
import { MemoryDistiller } from './memoryDistiller.js';
import { TypoGenerator } from './typoGenerator.js';
import { TopicTracker } from './topicTracker.js';
import { ExpressionLearner } from './expressionLearner.js';
import { EmojiAgent } from './emojiAgent.js';
import { UserProfiler } from './userProfiler.js';
import { MemeTimingController } from './memeTimingController.js';

export class HumanizeEngine {
  constructor(ai, config, db) {
    this.actionPlanner = new ActionPlanner(ai, config);
    this.memoryDistiller = new MemoryDistiller(ai, config, db);
    this.typoGenerator = new TypoGenerator(config);
    this.topicTracker = new TopicTracker(ai, config, db);
    this.expressionLearner = new ExpressionLearner(ai, config, db);
    this.emojiAgent = new EmojiAgent(ai, config, db);
    this.userProfiler = new UserProfiler(ai, config, db);
    this.memeTiming = new MemeTimingController(config?.memeTiming);
  }

  async init() {
    logger.info('[HumanizeEngine] 初始化人性化引擎...');
    await this.emojiAgent.refreshCharactersFromApi();
  }
}

export { ActionPlanner } from './actionPlanner.js';
export { MemoryDistiller } from './memoryDistiller.js';
export { TypoGenerator } from './typoGenerator.js';
export { TopicTracker } from './topicTracker.js';
export { ExpressionLearner } from './expressionLearner.js';
export { EmojiAgent } from './emojiAgent.js';
export { UserProfiler } from './userProfiler.js';
export { MemeTimingController } from './memeTimingController.js';
