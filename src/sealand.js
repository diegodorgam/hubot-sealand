'use strict';
// Description:
//   Allow you to do Rancher deploys from your favourite chat CLI
//
// Dependencies:
//   "async-each": "^1.0.0"
//   "docker-registry-client": "^3.0.1"
//   "encrypt-env": "^0.2.5"
//   "envfile": "^2.0.1"
//   "github": "^0.2.4"
//   "js-yaml": "^3.5.2"
//   "mkdirp": "^0.5.1"
//   "rancher-cli": "^0.1.1"
//   "rimraf": "^2.5.2"
//   "request": "^2.69.0"
//
// Configuration:
//   RANCHER_URL - url for rancher-compose
//   RANCHER_ACCESS_KEY - accessKey for rancher-compose
//   RANCHER_SECRET_KEY - secretKey for rancher-compose
//   RANCHER_PROJECT_ID - The id of your rancher project
//   DOCKER_HUB_USERNAME - username for Docker Hub
//   DOCKER_HUB_PASSWORD - password for Docker Hub
//   GITHUB_API_TOKEN - API token that can read from your private repos
//   DOCKER_COMPOSE_FILE - The default docker compose file that we look for in your repo
//   ADMIN_USERNAME - The chat user who is admin
//   DEV_ROOM_ID - The id of the room to post messages to when receinv github webooks
//
// Commands:
//   hubot up <githubRepo> <commitHash> <environmentKey> - Deploy this commit
//   hubot down <githubRepo> <commitHash> - Bring this commit down
//   hubot status - View loadbalancer status
//   hubot addUser <username> - Add user to whitelist (admin only)
//   hubot deleteUser <username> - Remove user from whitelist (admin only)
//   hubot whitelist - List who has access
//
// Author:
//   joshuakarjala <joshua@fluxuries.com>

function hubotSealand (robot) {
  var getEnv = require('./lib/config');
  var utils = require('./lib/utils');

  var rancher = require('./lib/rancher')({
    RANCHER_LOADBALANCER_ID: process.env.RANCHER_LOADBALANCER_ID,
    AES_KEY: process.env.AES_KEY,
    GITHUB_API_TOKEN: process.env.GITHUB_API_TOKEN,
    DOCKER_HUB_USERNAME: process.env.DOCKER_HUB_USERNAME,
    DOCKER_HUB_PASSWORD: process.env.DOCKER_HUB_PASSWORD
  });

  var that = {};

  var ADMIN_USERNAME = process.env.ADMIN_USERNAME;
  var SLACK_ROOM_ID = process.env.SLACK_ROOM_ID;
  var DOCKER_COMPOSE_FILE = process.env.DOCKER_COMPOSE_FILE || 'docker-compose.staging.yml';

  // Only whitelisted users can issue commands

  robot.receiveMiddleware(function (context, next, done) {
    var whitelist = getWhitelist();
    var username = context.response.message.user.name;

    if (username === ADMIN_USERNAME || username in whitelist) return next(done);

    context.response.message.finish();

    if (context.response.message.text.match(robot.respondPattern(''))) {
      context.response.reply(`You do not have access to this command - contact @${ADMIN_USERNAME}`);
    }

    return done();
  });

  var saveWhitelist = function (whitelist) {
    robot.brain.set('SEALAND_WHITELIST_USERNAMES', whitelist);
    robot.brain.emit('save');
  };

  var deleteFromWhitelist = function (username) {
    var whitelist = getWhitelist();
    delete whitelist[username];
    saveWhitelist(whitelist);
  };

  var addToWhitelist = function (username) {
    var whitelist = getWhitelist();
    whitelist[username] = true;
    saveWhitelist(whitelist);
  };

  var getWhitelist = function () {
    return robot.brain.get('SEALAND_WHITELIST_USERNAMES') || {};
  };

  robot.router.post('/loadbalancer', function (req, res) {
    robot.logger.info('Load Balancer Webhook:\n\n' + JSON.stringify(req.body));

    var status = req.body;

    if (!(status instanceof Array)) return res.status(400).send('Expecting array');

    var entries = status.map(function (entry) {
      return entry.ports[0].split('=')[0].replace(':80', '');
    });

    if (entries.length < 1) entries = ['No service mappings present'];

    robot.messageRoom(SLACK_ROOM_ID, 'Loadbalancer Status:\n\n' + entries.join('\n'));

    return res.send('OK');
  });

  robot.router.post('/up', function (req, res) {
    robot.logger.info(`Webhook /up: ${JSON.stringify(req.body)}`);
    var githubRepo = req.body.repo;
    var commitHash = req.body.commitHash;
    var composeFile = req.body.composeFile || DOCKER_COMPOSE_FILE;
    var branch = req.body.branch || false;

    var repoCreds = utils.generateRepoCreds(githubRepo);

    getEnv(req.body.environment, function (err, environment) {
      if (err) throw err;

      rancher.deployCommit({
        repoCreds: repoCreds,
        commitHash: commitHash,
        branch: branch,
        composeFile: composeFile,
        environment: environment
      }, function (err) {
        if (err) {
          console.error(`Error deploying commit - ${githubRepo} ${commitHash}\n`, err);
          res.status(500).send(JSON.stringify(err));
          throw err;
        }
        robot.messageRoom(SLACK_ROOM_ID, `Repo: ${repoCreds.repo} Commit: ${commitHash} has been pushed to Rancher`);
        res.send('OK');
      });
    });
  });

  robot.respond(/up (.*) (.*) (.*)/i, function (res) {
    var githubRepo = res.match[1];
    var commitHash = res.match[2];
    var environment = res.match[3];

    var repoCreds = utils.generateRepoCreds(githubRepo);
    getEnv(environment, function (err, environment) {
      if (err) throw err;

      rancher.deployCommit({
        repoCreds: repoCreds,
        commitHash: commitHash,
        composeFile: DOCKER_COMPOSE_FILE,
        environment: environment,
        branch: false
      }, function (err) {
        if (err) {
          console.log(`Error deploying commit - ${githubRepo} ${commitHash}\n`, err);
          return res.send(JSON.stringify(err));
        }
        res.send(`Repo: ${repoCreds.repo} Commit: ${commitHash} has been pushed to Rancher`);
      });
    });
  });

  robot.respond(/down (.*) (.*)/i, function (res) {
    var githubRepo = res.match[1];
    var commitHash = res.match[2];

    var repoCreds = utils.generateRepoCreds(githubRepo);

    getEnv('staging.json', function (err, environment) {
      if (err) throw err;

      rancher.killCommit({
        repoCreds: repoCreds,
        commitHash: commitHash,
        environment: environment,
        composeFile: DOCKER_COMPOSE_FILE,
        branch: false
      }, function (err) {
        if (err) {
          console.error(`Error killing commit - ${githubRepo} ${commitHash}\n`, err);
          return res.send(JSON.stringify(err));
        }
        res.send(`Repo: ${repoCreds.repo} Commit: ${commitHash} has been removed from Rancher`);
      });
    });
  });

  robot.respond(/addUser (.*)/i, function (res) {
    var username = res.match[1];

    addToWhitelist(username);
    res.send(`${username} is added to the whitelist`);
  });

  robot.respond(/deleteUser (.*)/i, function (res) {
    var username = res.match[1];

    deleteFromWhitelist(username);

    res.send(`${username} is deleted from the whitelist`);
  });

  robot.respond(/whitelist/i, function (res) {
    var whitelist = getWhitelist();
    res.send(`Current whitelist: ${Object.keys(whitelist).join(', ')}`);
  });

  robot.respond(/status/i, function (res) {
    getEnv('staging.json', function (err, environment) {
      if (err) throw err;

      rancher.getLoadbalancerStatus(function (err, entries) {
        if (err) return res.send(JSON.stringify(err));
        res.send(`Loadbalancer Status: ${entries.join('\n')}`);
      });
    });
  });

  return that;
}

module.exports = hubotSealand;
