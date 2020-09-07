const os = require('os');
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
  CRON_INTERVAL_IN_MINUTES

} = process.env;

const client = Telegram.TelegramClient.connect(TELEGRAM_BOT_TOKEN)

if (!TELEGRAM_BOT_TOKEN) { process.exit(1); }

let isRunning = false;
let cronExpression = null;
// TODO - remove INTERVAL_IN_MINUTES validation after resolution of:
// https://github.com/node-cron/node-cron/issues/226
const cronIntervalInMinutes = CRON_INTERVAL_IN_MINUTES && `*/${CRON_INTERVAL_IN_MINUTES} * * * *`;

if (cron.validate(CRON_EXPRESSION)) {
  cronExpression = CRON_EXPRESSION;
} else if (cron.validate(cronIntervalInMinutes)) {
  cronExpression = cronIntervalInMinutes;
}

if (!cronExpression) {
  run();
} else {
  cron.schedule(cronExpression, run);
}

async function run() {
  if (isRunning) { return logger.warn('Attempt to run while already running'); }
  isRunning = true;
  let knownValues = {};
  let browser = { close: _.noop };
  let values = {};
  const allMessages = [];

  fs.readFile('values.json')
    .then((values) => knownValues = JSON.parse(values))
    .then(() => logger.debug('Restored backed-up data'))
    .catch((e) => logger.warn('No backup file found, running with no known data',e));

  try {
    const browser = await puppeteer.launch(browserOptions);
    const page = await browser.newPage();
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
    logger.error(e);
  } finally {
    await browser.close();
  }

  _.forEach(values, (songData, songName) => {
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
    }
  });

  if (allMessages.length) {
    try {
      await fs.writeFile('values.json', JSON.stringify(values));
    } catch (e) {
      logger.error('Unable to save known data', e);
    }

    try {
      const message = escapeReservedChars(allMessages.join('\n\n'));
      _.forEach(TELEGRAM_CHAT_IDS.split(','), async (chatId) => await client.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' }));
    } catch (e) {
      logger.error('Failed sending Telegram Messages', e);
    }
  }

  isRunning = false;
}

function getPercentDiff(current, known) {
  if (!known) { return ''; }
  return `(+${((current - known) * 100) / known}%)`;
}

function escapeReservedChars(str) {
  // https://core.telegram.org/bots/api#markdownv2-style
  return str.replace(/[_\*\[\]\(\)~`>#+-=|{}\.!]/g, (s) => `\\${s}`);
}
