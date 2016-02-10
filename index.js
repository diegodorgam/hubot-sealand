var fs = require('fs');
var path = require('path');

module.exports = function(robot, scripts) {
  var scriptsPath = path.resolve(__dirname, 'src');

  return fs.exists(scriptsPath, function(exists) {
    if (exists) {
      fs.readdirSync(scriptsPath).forEach(function (script) {
        if (scripts !== undefined && scripts.indexOf('*') < 0) {
          if (scripts.indexOf(script) >= 0) {
            robot.loadFile(scriptsPath, script);
          }
        } else {
          robot.loadFile(scriptsPath, script);
        }
      });
    }
  });
};
