const path = require('path');
const fs = require('fs-extra');
const assign = require('lodash/assign');
const identity = require('lodash/identity')
const isEmpty = require('lodash/isEmpty');
const orderBy = require('lodash/orderBy');
const logger = require('./logger');

const { MANNA_DATA_DIR } = process.env

class ValuesManager {
  #lastValues;
  #allValues;
  #valuesFilePath;

  constructor() {
    this.updateFilePath({startup: true});
    try {
      this.#allValues = fs.readJSONSync(this.#valuesFilePath,);
      logger.debug(`Restored data from: ${this.#valuesFilePath}`);
    } catch {
      logger.warn(`Unable to restore data from: ${this.#valuesFilePath}`);
      this.#allValues = {};
    }

    // Get last value from all values if available
    this.#lastValues = isEmpty(this.#allValues)
      ? this.#getLastValuesPreviousFile()
      : this.#getLatestEntryFromData();
  }

  getLastValues() { return this.#lastValues; }

  addValues(values) {
    logger.debug('Adding values');
    const date = new Date().toISOString();

    // Update #lastValues with the new values and save the latest known values.
    values = assign({}, this.#lastValues, values);
    this.#allValues[date] = { values, date };
    return this.saveValues()
      .then(() => this.#lastValues = values);
  }

  async updateFilePath(options = {startup: false}) {
    const date = new Date();
    const newFilePath = path.join(MANNA_DATA_DIR, `${date.getFullYear()}-values.json`);
    if (this.#valuesFilePath === newFilePath) { return false; }
    this.#valuesFilePath = newFilePath;
    const isFileExist = await fs.pathExists(this.#valuesFilePath);
    if (isFileExist) {
      // Don't log on init
      !options.startup && logger.warn('Changed data file path to an existing one');
      return false;
    }
    return true;
  }

  saveValues() {
    this.updateFilePath();
    logger.debug('Saving data to file');
    return fs.writeJSON(this.#valuesFilePath, this.#allValues, { flag: 'w', spaces: 2 })
      .catch((e) => logger.error('Unable to save data to file', e));
  }

  #getLastValuesPreviousFile = () => {
    const dataFiles = fs.readdirSync(MANNA_DATA_DIR);
    if (!dataFiles.length) { return {}; }
    const orderMakers = [isFile, identity];
    const latestDataFileName = orderBy(dataFiles, orderMakers, ['desc', 'desc'])[0];
    const latestDataFilePath = path.join(MANNA_DATA_DIR, latestDataFileName);
    logger.debug(`Getting last known values from: ${latestDataFilePath}`);
    const latestData = fs.readJSONSync(latestDataFilePath);
    return this.#getLatestEntryFromData(latestData);

    function isFile(fileName) {
      const filePath = path.join(MANNA_DATA_DIR, fileName);
      return fs.statSync(filePath).isFile();
    }
  }

  #getLatestEntryFromData = (data = this.#allValues) => {
    return orderBy(data, 'date', 'desc')[0].values;
  }
}

module.exports = new ValuesManager();
