var RancherClient = require('rancher-cli-async/dist/rancher');
var yaml = require('js-yaml');
var rimraf = require('rimraf');
var request = require('request');
var encryptEnv = require('encrypt-env');
var envfile = require('envfile');
var mkdirp = require('mkdirp');
var fs = require('fs');

var utils = require('./utils');

module.exports = function (rancherOptions, extras) {
  var that = {};

  var rancher = new RancherClient(rancherOptions);

  var AES_KEY = extras.AES_KEY;
  var DOCKER_COMPOSE_FILE = extras.DOCKER_COMPOSE_FILE;

  var github = require('./github')(extras.GITHUB_API_TOKEN);

  var docker = require('./docker')({
    username: extras.DOCKER_HUB_USERNAME,
    password: extras.DOCKER_HUB_PASSWORD
  });

  var downloadComposeFile = function (repoCreds, commitHash, cb) {
    var composeFilePath = utils.getComposeFilePath(repoCreds, DOCKER_COMPOSE_FILE);

    var onwritecomposefilewithenv = function (err) {
      if (err) return cb(err);
      return cb();
    };

    var ongetencryptedenv = function (err, encryptedEnv) {
      if (err) return cb(err);

      var doc = yaml.safeLoad(fs.readFileSync(composeFilePath, 'utf8'));

      var decryptedEnv = encryptEnv('KEY', {'KEY': AES_KEY}).decryptEnv(false, encryptedEnv);
      var envJson = envfile.parseSync(decryptedEnv);

      doc.web.environment = envJson;
      doc.web.image += ':' + commitHash;

      delete doc.web['env_file'];

      fs.writeFile(composeFilePath, yaml.safeDump(doc), onwritecomposefilewithenv);
    };

    var oncheckdocker = function (err) {
      if (err) return cb(err);

      var doc = yaml.safeLoad(fs.readFileSync(composeFilePath, 'utf8'));
      var encryptedEnvPath = doc.web.env_file + '.enc';

      github.getFile(repoCreds, commitHash, encryptedEnvPath, ongetencryptedenv);
    };

    var onwritecomposefile = function (err) {
      if (err) return cb(err);

      var doc = yaml.safeLoad(fs.readFileSync(composeFilePath, 'utf8'));
      var dockerRepo = doc.web.image;

      docker.checkHubForImage(dockerRepo, commitHash, oncheckdocker);
    };

    var ongetcomposefile = function (err, composeFile) {
      if (err) return cb(err);

      mkdirp(utils.getTmpDir(repoCreds), function (err) {
        if (err) return cb(err);

        fs.writeFile(composeFilePath, composeFile, onwritecomposefile);
      });
    };

    github.getFile(repoCreds, commitHash, DOCKER_COMPOSE_FILE, ongetcomposefile);
  };

  that.deployCommit = function (repoCreds, commitHash, cb) {
    var composeFilePath = utils.getComposeFilePath(repoCreds, DOCKER_COMPOSE_FILE);

    downloadComposeFile(repoCreds, commitHash, function (err) {
      if (err) return cb(err);

      rancher.up({
        stack: repoCreds.repo + '-' + commitHash,
        dockerComposeFile: composeFilePath
      }, function (err) {
        if (err) return cb(err);
        cb();
      });
    });
  };

  that.killCommit = function (repoCreds, commitHash, cb) {
    var composeFilePath = utils.getComposeFilePath(repoCreds, DOCKER_COMPOSE_FILE);

    var ondownloadcomposefile = function (err) {
      if (err) return cb(err);

      rancher.exec('-f ' + composeFilePath + ' -p ' + repoCreds.repo + '-' + commitHash + ' rm --force', function (err) {
        if (err) return cb(err);

        rimraf(utils.getTmpDir(repoCreds), function (err) {
          if (err) return cb(err);
          cb();
        });
      });
    };

    downloadComposeFile(repoCreds, commitHash, ondownloadcomposefile);
  };

  that.getLoadbalancerStatus = function (cb) {
    request('http://rancher.foundersapps.com/v1/projects/' + process.env.RANCHER_PROJECT_ID + '/serviceconsumemaps?serviceId=' + process.env.RANCHER_LOADBALANCER_ID, {
      auth: {
        user: process.env.RANCHER_ACCESS_KEY,
        pass: process.env.RANCHER_SECRET_KEY
      }
    }, function (err, response, body) {
      if (err) return cb(err);

      if (!err && response.statusCode === 200) {
        var serviceConsumeMaps = JSON.parse(body);

        var mappings = serviceConsumeMaps.data.map(function (s) {
          return s.ports.pop().split('=')[0].replace(':80', '');
        });

        cb(null, mappings);
      } else {
        cb({errror: 'Rancher API returned: ' + response.statusCode + ' - ' + body});
      }
    });
  };

  return that;
};
