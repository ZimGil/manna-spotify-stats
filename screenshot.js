const path = require('path');
const forEach = require('lodash/forEach');
const Telegram = require('messaging-api-telegram');
const logger = require('./logger');

const {
  LOG_FILES_PATH,
  TELEGRAM_ERROR_BOT_TOKEN,
  TELEGRAM_ERROR_CHAT_ID,
  SCREENSHOT_URL
} = process.env;

const client = Telegram.TelegramClient.connect(TELEGRAM_ERROR_BOT_TOKEN);

class Screenshot {
  #reason;
  #lastFileName;

  constructor() {
    this.#reason = screenshotReasonsEnum.NO_REASON;
  }

  async takeScreenshot(page, _reason) {
    const reason = screenshotReasonsEnum[_reason] || _reason;
    if (this.#reason === reason) { return logger.debug('Skipping a screenshot - repetitive reason'); }
    this.#reason = reason;
    const dateString = new Date().toISOString().replace(/:/g, '_');
    const screenshotFileName = `${dateString}_screenshot.png`;
    const screenshotPath = path.join(LOG_FILES_PATH, screenshotFileName);
    logger.debug('Taking a screenshot at:', screenshotPath);
    await page.screenshot({ path: screenshotPath });
    this.#lastFileName = screenshotFileName;
    await this.#sendScreenshot();
  }

  clearReason() {
    if (!this.#reason) { return; }
    this.#reason = screenshotReasonsEnum.NO_REASON;
    logger.debug('Screenshot reason cleared');
  }

  #sendScreenshot = async () => {
    if (!TELEGRAM_ERROR_CHAT_ID) { return; }
    const screenshotUrl = `${SCREENSHOT_URL}${this.#lastFileName}`;
    const caption = `Bot Error: ${this.#reason}`.replace(/_/g, ' ');
    const options = { caption };
    logger.info('Sending screenshot');
    forEach(TELEGRAM_ERROR_CHAT_ID.split(','), async (chatId) => {
      try {
        return await client.sendPhoto(chatId, screenshotUrl, options)
          .catch(async (e) => {
            if (e.message.includes('failed to get HTTP URL content')) {
              logger.warn(`Failed to get HTTP URL content [${screenshotUrl}]`);
              const msg = `${caption}\nSee screenshot named ${this.#lastFileName}`;
              return await client.sendMessage(chatId, msg);
            }
            logger.error(e);
          });
        } catch (e) {
          logger.error('Failed sending screenshot', e);
        }
      });
  }
}

const screenshotReasonsEnum = {
  NO_REASON: null,
  ERROR_GETTING_VALUES: 'ERROR_GETTING_VALUES',
  NO_VALUES: 'NO_VALUES',
  MISSING_VALUES: 'MISSING_VALUES'
};

exports.Screenshot = new Screenshot();
exports.screenshotReasonsEnum = screenshotReasonsEnum;
