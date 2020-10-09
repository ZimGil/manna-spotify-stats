const os = require('os');
const cron = require('node-cron');
const puppeteer = require("puppeteer");
const Telegram = require('messaging-api-telegram');
const forEach = require('lodash/forEach');
const isEmpty = require('lodash/isEmpty');
const isEqual = require('lodash/isEqual');
const noop = require('lodash/noop');
const pickBy = require('lodash/pickBy');
const size = require('lodash/size');
const logger = require('./logger');
const { getValues, getMessage, spotifyLogin, isBiggerValues, waitForData } = require('./helpers');
const { Screenshot, screenshotReasonsEnum } = require('./screenshot');
const valuesManager = require('./values-manager');

const browserOptions = {
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
};
if (os.arch().includes('arm')) {
  browserOptions.executablePath = 'chromium-browser';
}

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_IDS,
  SPOTIFY_URL,
  CRON_EXPRESSION,
  CRON_INTERVAL_IN_MINUTES,
} = process.env;

const client = Telegram.TelegramClient.connect(TELEGRAM_BOT_TOKEN)

if (!TELEGRAM_BOT_TOKEN) { process.exit(1); }
let cronExpression = null;
let firstRun = true;
// TODO - remove INTERVAL_IN_MINUTES validation after resolution of:
// https://github.com/node-cron/node-cron/issues/226
const cronIntervalInMinutes = CRON_INTERVAL_IN_MINUTES && `*/${CRON_INTERVAL_IN_MINUTES} * * * *`;

if (cron.validate(CRON_EXPRESSION)) {
  cronExpression = CRON_EXPRESSION;
} else if (cron.validate(cronIntervalInMinutes)) {
  cronExpression = cronIntervalInMinutes;
}

run();

async function run() {
  let browser = { close: noop };
  let page = null;
  const reloadTask = cron.schedule(cronExpression, reloadAndCheck, { scheduled: false });

  try {
    browser = await puppeteer.launch(browserOptions);
    page = await browser.newPage();
    await page.goto(SPOTIFY_URL, { waitUntil: 'networkidle0' });
    logger.debug(`Navigated to ${SPOTIFY_URL}`);
    await page.setViewport({ width: 1536, height: 722 });
    await spotifyLogin(page);
    await waitForData(page);
    reloadTask.start();
  } catch (e) {
    logger.error(e);
    reloadTask.destroy();
    await browser.close();
  }

  async function reloadAndCheck() {
    if (!firstRun) {
      try {
        logger.debug('Relodaing');
        await page.reload();
        await waitForData(page);
        logger.debug('Reloaded the page');
      } catch (e) {
        logger.error('Failed reloading', e);
        await stop();
        return;
      }
    } else {
      firstRun = false;
    }

    const knownValues = valuesManager.getLastValues();
    const baseValues = await getValues(page);

    // Filter out disabled songs
    const values = pickBy(baseValues, (v, songName) => songName);

    if (isEmpty(baseValues)) {
      logger.warn('No values received');
      return await Screenshot.takeScreenshot(page, screenshotReasonsEnum.NO_VALUES);
    }
    if (size(values) !== size(baseValues)) {
      logger.warn('Some Values are missing');
      return await Screenshot.takeScreenshot(page, screenshotReasonsEnum.MISSING_VALUES);
    }
    if (isEqual(values, knownValues)) { return logger.debug('Already known values'); }
    if (!isBiggerValues(values, knownValues)) { return logger.warn('Received lower values :/', values, knownValues); }

    logger.info('These values are new :)');
    valuesManager.addValues(values);
    const message = await getMessage(values, knownValues);
    Screenshot.clearReason();

    try {
      logger.info('Sending a message');
      forEach(TELEGRAM_CHAT_IDS.split(','), async (chatId) => await client.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' }));
    } catch (e) {
      logger.error('Failed sending Telegram Messages', e);
    }
  }

  async function stop() {
    reloadTask.stop();
    await browser.close();
  }
}
