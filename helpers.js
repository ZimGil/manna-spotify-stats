const map = require('lodash/map');
const reduce = require('lodash/reduce');
const logger = require('./logger');
const { Screenshot, screenshotReasonsEnum } = require('./screenshot');

const dataRowsSelector = '[data-testid=songs-table] tbody > tr';
const dataColumnIndices = {
  ID: 0,
  NAME: 1,
  STREAMS: 3,
  LISTENERS: 4,
  VIEWS: 5,
  SAVES: 6
}

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
    values = await page.evaluate((dataRowsSelector, dataColumnIndices) => {
      const rows = document.querySelectorAll(dataRowsSelector);
      return Array.from(rows).reduce((values, node) => {
        values[node.children[dataColumnIndices.NAME].title] = {
          streams: +node.children[dataColumnIndices.STREAMS].title.replace(/,/g, ''),
          listeners: +node.children[dataColumnIndices.LISTENERS].title.replace(/,/g, ''),
          saves: +node.children[dataColumnIndices.SAVES].title.replace(/,/g, '')
        }
        return values;
      }, {});
    }, dataRowsSelector, dataColumnIndices);
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
  return await page.waitForSelector(dataRowsSelector, { visible: true });
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
