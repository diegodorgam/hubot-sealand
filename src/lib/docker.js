var drc = require('docker-registry-client');

module.exports = function (options) {
  var that = {};

  that.checkHubForImage = function (hash) {
    return function (dockerRepo, cb) {
      var onlisttags = function (err, data) {
        if (err) return cb(err);
        if (data.tags === null) return cb('Docker Repo doesn\'t exist: ' + dockerRepo, false);

        var tagIndex = data.tags.indexOf(hash);

        if (tagIndex < 0) return cb('Commit not found in Docker repo', false);

        return cb(null, true);
      };

      var client = drc.createClientV2({
        name: dockerRepo,
        username: options.username,
        password: options.password
      });

      client.listTags(onlisttags);
    };
  };

  return that;
};
