const path = require('path');
const fs = require('fs-extra');
const assign = require('lodash/assign');
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
      this.#allValues = {}
      logger.warn(`Unable to restore data from: ${this.#valuesFilePath}`);
    }

    const lastEntry = orderBy(this.#allValues, 'date', 'desc')[0]
    this.#lastValues = lastEntry && lastEntry.values || {};
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
    logger.debug(`Creating a new data file: ${this.#valuesFilePath}`);
    try {
      await fs.createFile(this.#valuesFilePath);
    } catch (e) {
      logger.error(`Unable to create data file: ${this.#valuesFilePath}`);
    }
    return true;
  }

  saveValues() {
    this.updateFilePath();
    logger.debug('Saving data to file');
    return fs.writeJSON(this.#valuesFilePath, this.#allValues, { flag: 'w' })
      .catch((e) => logger.error('Unable to save data to file', e));
  }
}

module.exports = new ValuesManager();
