const map = require('lodash/map');
const reduce = require('lodash/reduce');
const logger = require('./logger');
const { Screenshot, screenshotReasonsEnum } = require('./screenshot');

const {
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
    logger.error('Error getting values', e);
    await Screenshot.takeScreenshot(page, screenshotReasonsEnum.ERROR_GETTING_VALUES);
  }
  return values;
}

exports.getMessage = async function (values, knownValues) {
  const messages = map(values, ({ streams, listeners, saves }, songName) => {
    const knownStreams = knownValues[songName] && knownValues[songName].streams;
    const knownListeners = knownValues[songName] && knownValues[songName].listeners;
    const knownSaves = knownValues[songName] && knownValues[songName].saves;
    return [
      `*${songName}:*`,
      `Streams: ${streams} ${getPercentDiff(streams, knownStreams)}`,
      `Listeners: ${listeners} ${getPercentDiff(listeners, knownListeners)}`,
      `Saves: ${saves} ${getPercentDiff(saves, knownSaves)}`
    ].join('\n')
  });

  return escapeReservedChars(messages.join('\n\n'));;
}

exports.isBiggerValues = function (values, knownValues) {
  return reduce(values, (isBigger, songData, songName) => {
    if (!knownValues[songName]) { return true; }
    const isBiggerStreams = songData.streams >= knownValues[songName].streams;
    const isBiggerListeners = songData.listeners >= knownValues[songName].listeners;
    return isBigger || isBiggerStreams || isBiggerListeners;
  }, false)
}

exports.waitForData = async function (page) {
  return await page.waitForRequest('https://tracing.spotify.com/api/v0/reports');
}

function getPercentDiff(current, known) {
  if (!known || current === known) { return ''; }
  const perecntage = Math.abs((((current - known) * 100) / known).toFixed(2));
  const operator = current > known ? '+' : '-';
  return `(${operator}${perecntage.toFixed(2)}%)`;
}

function escapeReservedChars(str) {
  // https://core.telegram.org/bots/api#markdownv2-style
  return str.replace(/[_\[\]\(\)~`>#+-=|{}\.!]/g, (s) => `\\${s}`);
}
