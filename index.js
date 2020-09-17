const os = require('os');
const fs = require('fs').promises;
const _ = require('lodash');
const cron = require('node-cron');
const puppeteer = require("puppeteer");
const Telegram = require('messaging-api-telegram');
const logger = require('./logger');
const { getValues, getMessage, spotifyLogin } = require('./helpers');

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
const knownValuesBackupFile = './lib/values.json';
let knownValues = {};
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
  let browser = { close: _.noop };
  let page = null;

  try {
    knownValues = await fs.readFile(knownValuesBackupFile).then(JSON.parse);
    logger.debug('Restored backed-up data')
  } catch (e) {
    logger.warn('No backup file found, running with no known data', e)
  }

  try {
    browser = await puppeteer.launch(browserOptions);
    page = await browser.newPage();
    await page.goto(SPOTIFY_URL, { waitUntil: 'networkidle0' });
    logger.debug(`Navigated to ${SPOTIFY_URL}`);
    await page.setViewport({ width: 1536, height: 722 });
    await spotifyLogin(page);
    cron.schedule(cronExpression, reloadAndCheck);
  } catch (e) {
    logger.error(e);
    await browser.close();
  }

  async function reloadAndCheck() {
    if (!firstRun) {
      try {
        await page.reload({ waitUntil: 'networkidle0' });
        logger.debug('Reloaded the page');
      } catch (e) {
        logger.error('Failed reloading', e);
      }
    } else {
      firstRun = false;
    }

    const values = await getValues(page);
    if (_.isEmpty(values)) { return logger.warn('No values received'); }
    if (_.isEqual(values, knownValues)) { return logger.debug('Already known values'); }


    const message = await getMessage(values, knownValues);
    try {
      logger.info('Sending a message');
      _.forEach(TELEGRAM_CHAT_IDS.split(','), async (chatId) => await client.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' }));
    } catch (e) {
      logger.error('Failed sending Telegram Messages', e);
    }

    knownValues = values;
    logger.info('These values are new :)');
    try {
      logger.debug('Backing up values');
      await fs.writeFile(knownValuesBackupFile, JSON.stringify(values));
    } catch (e) {
      logger.error('Unable to save known data', e);
    }
  }
}
