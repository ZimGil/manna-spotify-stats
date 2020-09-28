const path = require('path');
const logger = require('./logger');

const { LOG_FILES_PATH } = process.env;

class Screenshot {
  #reason;

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
  }

  clearReason() {
    if (!this.#reason) { return; }
    this.#reason = screenshotReasonsEnum.NO_REASON;
    logger.debug('Screenshot reason cleared');
  }

}

const screenshotReasonsEnum = {
  NO_REASON: null,
  ERROR_GETTING_VALUES: 1,
  NO_VALUES: 2,
  MISSING_VALUES: 3
};

exports.Screenshot = new Screenshot();
exports.screenshotReasonsEnum = screenshotReasonsEnum;
