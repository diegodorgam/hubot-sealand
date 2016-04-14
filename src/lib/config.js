'use strict';
const AWS = require('aws-sdk');
const s3 = new AWS.S3();

module.exports = function (key, cb) {
  const params = { Bucket: process.env.CONFIG_BUCKET, Key: key };
  s3.getObject(params, function (err, data) {
    if (err) return cb(err);
    cb(null, JSON.parse(data.Body));
  });
};
