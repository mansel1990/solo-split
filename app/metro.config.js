const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// shared/theme.ts lives beside this Expo project.
config.watchFolders = [path.resolve(projectRoot, '../shared')];

module.exports = config;
