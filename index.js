// Description:
// Handle rancher
//
// Dependencies:
// "docker-registry-client": "^3.0.1"
// "encrypt-env": "^0.2.5"
// "envfile": "^1.0.0"
// "github": "^0.2.4"
// "js-yaml": "^3.5.2"
// "rancher-cli": "^0.1.1"
//
// Configuration:
//   None
//
// Commands:
//   sealand credentials set <url> <accessKey> <secretKey> - Set your Rancher credentials
//   sealand credentials get - See your active AWS credentials
//   sealand up <githubRepo> <commitHash> - Deploy this commit
//   sealand down <githubRepo> <commitHash> - Bringt this commit down
//   sealand docker set - Set your active Docker repo
//   sealand docker get - See your active Docker repo
//
// Author:
//   joshuakarjala

function hubotSealand (robot) {
  // var Sealand = require('sealand');
  var RancherClient = require('rancher-cli/dist/rancher');
  var encryptEnv = require('encrypt-env');
  var envfile = require('envfile');
  var GitHubApi = require('github');
  var github = new GitHubApi({version: '3.0.0'});
  var mkdirp = require('mkdirp');
  var path = require('path');
  var fs = require('fs');
  var yaml = require('js-yaml');

  var rc = new RancherClient({
    address: 'http://rancher.foundersapps.com',
    projectId: '1a5',
    auth: {
      accessKey: process.env.RANCHER_ACCESS_KEY,
      secretKey: process.env.RANHCER_SECRET_KEY
    }
  });

  var that = {};

  var saveUserData = function (userId, key, value) {
    robot.brain.set('sealand:' + userId + ':' + key, value);
    robot.brain.emit('save');
  };

  var getUserData = function (userId, key, cb) {
    var data = robot.brain.get('sealand:' + userId + ':' + key);
    if (data === null) return cb('UserData not found!');
    return cb(null, data);
  };

  var getCredentials = function (userId, cb) {
    getUserData(userId, 'rancherCredentials', function (err, userData) {
      if (err) return cb('No Rancher credentials set');
      return cb(null, userData);
    });
  };

  var saveCredentials = function (userId, credentials) {
    saveUserData(userId, 'rancherCredentials', credentials);
  };

  var checkDockerHubForImage = function (dockerRepo, hash, cb) {
    var drc = require('docker-registry-client');

    var onListTags = function (err, data) {
      if (err) return cb(err);
      if (data.tags === null) return cb('Docker Repo doesn\'t exist: ' + dockerRepo, false);

      var tagIndex = data.tags.indexOf(hash);

      if (tagIndex < 0) return cb('Commit not found in Docker repo', false);

      return cb(null, true);
    };

    var client = drc.createClientV2({
      name: dockerRepo,
      // Optional basic auth to the registry
      username: process.env.DOCKER_HUB_USERNAME,
      password: process.env.DOCKER_HUB_PASSWORD
    });

    client.listTags(onListTags);
  };

  var getFileGithub = function (repoCreds, commitHash, path, cb) {
    github.authenticate({
      type: 'oauth',
      token: process.env.GITHUB_TOKEN
    });

    github.repos.getContent({
      user: repoCreds.user,
      repo: repoCreds.repo,
      ref: commitHash,
      path: path
    }, function (err, data) {
      if (err) return cb(err);
      var b = new Buffer(data.content, 'base64');
      return cb(null, b.toString());
    });
  };

  var parseGithubComment = function (data) {
    return {
      repo: data.repository.full_name,
      repoOwner: data.repository.owner.login,
      repoName: data.repository.name,
      username: data.comment.user.login,
      message: data.comment.body,
      issueNumber: data.issue.number,
      issueId: data.issue.id
    };
  };

  var getComposeFilePath = function (repoCreds) {
    var tmpDir = path.join('tmp/', repoCreds.user, repoCreds.repo);
    return path.join(tmpDir, 'docker-compose.staging.yml');
  };

  var downloadComposeFile = function (repoCreds, commitHash, cb) {
     var onwritecomposefilewithenv = function (err) {
      if (err) return cb(err);
      return cb();
    }

    var ongetencryptedenv = function (err, encryptedEnv) {
      if (err) return cb(err);

      var doc = yaml.safeLoad(fs.readFileSync(composeFilePath, 'utf8'));

      var decryptedEnv = encryptEnv('STAGING').decryptEnv(false, encryptedEnv);
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

      getFileGithub(repoCreds, commitHash, encryptedEnvPath, ongetencryptedenv);
    }

    var onwritecomposefile = function (err) {
      if (err) return cb(err);

      var doc = yaml.safeLoad(fs.readFileSync(composeFilePath, 'utf8'));
      var dockerRepo = doc.web.image;

      checkDockerHubForImage(dockerRepo, commitHash, oncheckdocker);
    }

    var ongetcomposefile = function (err, composeFile) {
      if (err) return cb(err);

      mkdirp(tmpDir, function(err) {
        if (err) return res.send(err);

        fs.writeFile(composeFilePath, composeFile, onwritecomposefile);
      });
    };

    getFileGithub(repoCreds, commitHash, 'docker-compose.staging.yml', ongetcomposefile);
  };

  var deployCommit = function (repoCreds, commitHash, cb) {
    var composeFilePath = getComposeFilePath(repoCreds);

    downloadComposeFile(repoCreds, commitHash, function (err) {
      if (err) return cb(err);

      rc.up({
          stack: repoCreds.repo + '.' + commitHash,
          dockerComposeFile: composeFilePath
        });
      };
      cb();
    });
  };

  var killCommit = function (githubRepo, commitHash, cb) {
    var composeFilePath = getComposeFilePath(repoCreds);

    downloadComposeFile(repoCreds, commitHash, function (err) {
      if (err) return cb(err);

      rc.exec('-f ' + composeFilePath + ' -p ' + repoCreds.repo + '-' + commitHash + ' rm --force');

      cb();
    });
  };

  robot.router.post('/sealand/github/comment', function (req, res) {
    var roomId = 'C03FYNDDU';
    var commentObj = parseGithubComment(req.body);
    var commitHash;
    var taskDefinition;

    if (commentObj.message.toLowerCase().indexOf('deploy') < 0) return res.send('OK');

    var repoCreds = {
      user: commentObj.repoOwner,
      repo: commentObj.repoName
    };

    github.authenticate({
      type: 'oauth',
      token: process.env.GITHUB_TOKEN
    });

    var ondeploycommit = function (err) {
      if (err) return res.reply(JSON.stringify(err));

    };

    var onGetPullRequest = function (err, data) {
      if (err) return robot.messageRoom(roomId, JSON.stringify(err));
      commitHash = data.head.sha;
      deployCommit(repoCreds, commitHash, ondeploycommit);
    };

    github.pullRequests.get({
      user: repoCreds.user,
      repo: repoCreds.repo,
      number: commentObj.issueNumber
    }, onGetPullRequest);
  });

  robot.respond(/sealand credentials set (.*) (.*) (.*)/i, function (res) {
    var userId = res.envelope.user.id;

    saveCredentials(userId, {
      url: res.match[1],
      accesKey: res.match[2],
      secretKey: res.match[3]
    });
  });

  robot.respond(/sealand credentials get/, function (res) {
    var userId = res.envelope.user.id;

    getCredentials(userId, function (err, credentials) {
      if (err) return res.reply(JSON.stringify(err));
      res.reply('url: ' + credentials.url + ' || accesKey: ' + credentials.accesKey + ' || secretKey: ' + credentials.secretKey);
    });
  });

  robot.respond(/sealand docker set (.*)/i, function (res) {
    var userId = res.envelope.user.id;
    var dockerRepo = res.match[1];

    saveUserData(userId, 'currentDocker', dockerRepo);
  });

  robot.respond(/sealand docker get/, function (res) {
    var userId = res.envelope.user.id;

    getUserData(userId, 'currentDocker', function (err, dockerRepo) {
      if (err) return res.reply(JSON.stringify(err));
      res.reply(dockerRepo);
    });
  });

  robot.respond(/sealand up (.*) (.*)/i, function (res) {
    var userId = res.envelope.user.id;
    var githubRepo = res.match[1];
    var commitHash = res.match[2];

    var repoCreds = {
      user: githubRepo.split('/')[0],
      repo: githubRepo.split('/')[1]
    };

    deployCommit(repoCreds, commitHash, function (err) {
      if (err) return res.send(JSON.stringify(err));
      res.send('Commit is live -- insert url');
    });
  });

  robot.respond(/sealand down (.*) (.*)/i, function (res) {
    var userId = res.envelope.user.id;
    var githubRepo = res.match[1];
    var commitHash = res.match[2];

    var repoCreds = {
      user: githubRepo.split('/')[0],
      repo: githubRepo.split('/')[1]
    };

    killCommit(repoCreds, commitHash, function (err) {
      if (err) return res.send(JSON.stringify(err));
      res.send('Commit is down');
    });
  });

  return that;
}

module.exports = hubotSealand;
