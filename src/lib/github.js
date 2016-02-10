var GitHubApi = require('github');

module.exports = function (githubApiToken) {
  var that = {};

  var github = new GitHubApi({version: '3.0.0'});

  github.authenticate({
    type: 'oauth',
    token: githubApiToken
  });

  that.getFile = function (repoCreds, commitHash, path, cb) {
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

  return that;
};
