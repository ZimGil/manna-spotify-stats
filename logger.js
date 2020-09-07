const log4js = require('log4js');

const defaultAppenders = ['file', 'errorsOnly'];
const ipChangeAppenders = ['ipChange'];
const logFilesPath = process.env.LOG_FILES_PATH || 'logs'

if (process.env.NODE_ENV !== 'production') {
  defaultAppenders.push('stdout');
  ipChangeAppenders.push('stdout');
}


log4js.configure({
  appenders: {
    stdout: { type: 'stdout' },
    file: { type: 'file', filename: `${logFilesPath}/debug.log`, maxLogSize: 1048576, compress: true, keepFileExt: true },
    errorsFile: { type: 'file', filename: `${logFilesPath}/error.log` },
    errorsOnly: { type: 'logLevelFilter', appender: 'errorsFile', level: 'error' }
  },
  categories: {
    default: { appenders: defaultAppenders, level: process.env.LOG_LEVEL || 'debug' },
  }
});

module.exports = log4js.getLogger();
