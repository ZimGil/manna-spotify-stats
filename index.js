const os = require('os');
const fs = require('fs').promises;
const _ = require('lodash');
const cron = require('node-cron');
const puppeteer = require("puppeteer");
const Telegram = require('messaging-api-telegram');

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
  if (isRunning) { return; }
  let knownValues = {};
  fs.readFile('values.json')
    .then((values) => knownValues = JSON.parse(values));

  const browser = await puppeteer.launch(browserOptions);
  const page = await browser.newPage();
  await page.goto(SPOTIFY_URL);
  await page.setViewport({ width: 1536, height: 722 });
  await page.waitForSelector('.content #login-username');
  await page.type('.content #login-username', SPOTIFY_USERNAME);
  await page.waitForSelector('.content #login-password');
  await page.type('.content #login-password', SPOTIFY_PASSWORD);
  await page.waitForSelector('.content #login-button');
  await page.click('.content #login-button');
  await page.waitFor(10000);
  const values = await page.evaluate(() => {
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

  const allMessages = [];
  _.forEach(values, (songData, songName) => {
    const isChanged = _.reduce(songData, (isChanged, value, key) => {
      return isChanged || (!knownValues[songName] || knownValues[songName][key] !== value);
    }, false);

    if (isChanged) {
      const message = [
        `*${songName}:*`,
        `Streams: ${values[songName].streams}`,
        `Listeners: ${values[songName].listeners}`,
        `Saves: ${values[songName].saves}`
      ].join('\n');

      allMessages.push(message);
    }
  });

  if (allMessages.length) {
    await fs.writeFile('values.json', JSON.stringify(values));
    _.forEach(TELEGRAM_CHAT_IDS.split(','), async (chatId) => await client.sendMessage(chatId, allMessages.join('\n\n'), { parse_mode: 'MarkdownV2' }));
  }

  await browser.close();
}
