var path = require('path');

var utils = {};

utils.getTmpDir = function (repoCreds) {
  return path.join('tmp/', repoCreds.user, repoCreds.repo);
};

utils.getComposeFilePath = function (repoCreds, dockerComposeFile) {
  return path.join(utils.getTmpDir(repoCreds), dockerComposeFile);
};

utils.generateRepoCreds = function (githubRepo) {
  return {
    user: githubRepo.split('/')[0],
    repo: githubRepo.split('/')[1]
  };
};

module.exports = utils;
