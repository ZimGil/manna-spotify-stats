const path = require('path');
const _ = require('lodash');
const logger = require('./logger');

const {
  LOG_FILES_PATH,
  SPOTIFY_USERNAME,
  SPOTIFY_PASSWORD
 } = process.env;

exports.spotifyLogin = async function (page) {
  const usernameSelector = '.content #login-username'
  const passwordSelector = '.content #login-password'
  const buttonSelector = '.content #login-button'
  try {
    await page.waitForSelector(usernameSelector);
    await page.waitForSelector(passwordSelector);
    await page.waitForSelector(buttonSelector);
    await page.type(usernameSelector, SPOTIFY_USERNAME);
    await page.type(passwordSelector, SPOTIFY_PASSWORD);
    await page.click(buttonSelector);
    await page.waitForNavigation({waitUntil: 'networkidle0'});
    logger.debug('Logged in');
  } catch (e) {
    logger.error('Error logging into spotify', e);
  }
}

exports.getValues = async function (page) {
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
    logger.error('Error getting values', e);
    await page.screenshot({path: screenshotPath});
  }
  return values;
}

exports.getMessage = async function (values, knownValues) {
  const messages = _.map(values, ({ streams, listeners, saves }, songName) => {
    return [
      `*${songName}:*`,
      `Streams: ${streams} ${getPercentDiff(streams, knownValues[songName].streams)}`,
      `Listeners: ${listeners} ${getPercentDiff(listeners, knownValues[songName].listeners)}`,
      `Saves: ${saves} ${getPercentDiff(saves, knownValues[songName].saves)}`
    ].join('\n')
  });

  return escapeReservedChars(messages.join('\n\n'));;
}

function getPercentDiff(current, known) {
  if (!known || current === known) { return ''; }
  const perecntage = ((current - known) * 100) / known;
  return `(+${perecntage.toFixed(2)}%)`;
}

function escapeReservedChars(str) {
  // https://core.telegram.org/bots/api#markdownv2-style
  return str.replace(/[_\[\]\(\)~`>#+-=|{}\.!]/g, (s) => `\\${s}`);
}
