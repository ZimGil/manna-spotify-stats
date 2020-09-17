const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const _ = require('lodash');
const cron = require('node-cron');
const puppeteer = require("puppeteer");
const Telegram = require('messaging-api-telegram');
const logger = require('./logger');

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
  SPOTIFY_USERNAME,
  SPOTIFY_PASSWORD,
  SPOTIFY_URL,
  CRON_EXPRESSION,
  CRON_INTERVAL_IN_MINUTES,
  LOG_FILES_PATH

} = process.env;

const client = Telegram.TelegramClient.connect(TELEGRAM_BOT_TOKEN)

if (!TELEGRAM_BOT_TOKEN) { process.exit(1); }
const knownValuesBackupFile = './lib/values.json';
let isRunning = false;
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
  if (isRunning) { return logger.warn('Attempt to run while already running'); }
  isRunning = true;
  let knownValues = {};
  let browser = { close: _.noop };
  let page = null;

  fs.readFile(knownValuesBackupFile)
    .then((values) => knownValues = JSON.parse(values))
    .then(() => logger.debug('Restored backed-up data'))
    .catch((e) => logger.warn('No backup file found, running with no known data', e));

  try {
    browser = await puppeteer.launch(browserOptions);
    page = await browser.newPage();
    await page.goto(SPOTIFY_URL);
    logger.debug(`Navigated to ${SPOTIFY_URL}`);
    await page.setViewport({ width: 1536, height: 722 });
    await page.waitForSelector('.content #login-username');
    await page.type('.content #login-username', SPOTIFY_USERNAME);
    await page.waitForSelector('.content #login-password');
    await page.type('.content #login-password', SPOTIFY_PASSWORD);
    await page.waitForSelector('.content #login-button');
    await page.click('.content #login-button');
    await page.waitFor(10000);
    logger.debug('Logged in');
    cron.schedule(cronExpression, reloadAndCheck);
  } catch (e) {
    logger.error(e);
    await browser.close();
  }

  isRunning = false;

  async function reloadAndCheck() {
    if (!firstRun) {
      try {
        await page.reload();
        await page.waitFor(10000);
        logger.debug('Reloaded the page');
      } catch (e) {
        logger.error('Failed reloading', e);
      }
    } else {
      firstRun = false;
    }

    const values = await getValues();
    const messages = await getMessages(values);

    if (messages.length) {
      logger.info('These values are new :)')
      try {
        logger.debug('Backing up values');
        await fs.writeFile(knownValuesBackupFile, JSON.stringify(values));
      } catch (e) {
        logger.error('Unable to save known data', e);
      }

      try {
        logger.info('Sending a message');
        const message = escapeReservedChars(messages.join('\n\n'));
        _.forEach(TELEGRAM_CHAT_IDS.split(','), async (chatId) => await client.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' }));
      } catch (e) {
        logger.error('Failed sending Telegram Messages', e);
      }
    }
  }

  async function getValues() {
    let values = {}
    try {
      values = await page.evaluate(() => {
        const values = {};
        Array.from(document.getElementsByTagName('tr')).forEach((node, index) => {
          if (index === 0) { return; }
          values[node.children[1].title] = {
            streams: +node.children[3].title.replace(/,/g, ''),
            listeners: +node.children[4].title.replace(/,/g, ''),
            saves: +node.children[5].title.replace(/,/g, '')
          }
        });
        return values;
      });
      logger.debug('Received Values', values);

    } catch (e) {
      const screenshotPath = path.join(LOG_FILES_PATH, 'screenshot.png');
      console.error(e);
      await page.screenshot({path: screenshotPath});
    }
    return values;
  }

  async function getMessages(values) {
    return _.reduce(values, (allMessages, songData, songName) => {
      const isChanged = _.reduce(songData, (isChanged, value, key) => {
        return isChanged || (!knownValues[songName] || knownValues[songName][key] !== value);
      }, false);

      if (isChanged) {
        const currentStreams = values[songName].streams;
        const currentListeners = values[songName].listeners;
        const currentSaves = values[songName].saves;
        const knownStreams = knownValues[songName] && knownValues[songName].streams;
        const knownListeners = knownValues[songName] && knownValues[songName].listeners;
        const knownSaves = knownValues[songName] && knownValues[songName].saves;

        const message = [
          `*${songName}:*`,
          `Streams: ${currentStreams} ${getPercentDiff(currentStreams, knownStreams)}`,
          `Listeners: ${currentListeners} ${getPercentDiff(currentListeners, knownListeners)}`,
          `Saves: ${currentSaves} ${getPercentDiff(currentSaves, knownSaves)}`
        ].join('\n');

        allMessages.push(message);
        return allMessages;
      }
    }, []);
  }
}

function getPercentDiff(current, known) {
  if (!known || current === known) { return ''; }
  return `(+${((current - known) * 100) / known}%)`;
}

function escapeReservedChars(str) {
  // https://core.telegram.org/bots/api#markdownv2-style
  return str.replace(/[_\[\]\(\)~`>#+-=|{}\.!]/g, (s) => `\\${s}`);
}
