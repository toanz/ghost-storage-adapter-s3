'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

var _awsSdk = require('aws-sdk');

var _awsSdk2 = _interopRequireDefault(_awsSdk);

var _path = require('path');

var _fs = require('fs');

var _imageTransform = require('@tryghost/image-transform');

var _imageTransform2 = _interopRequireDefault(_imageTransform);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

var activeTheme = require((0, _path.join)(process.cwd(), 'current/core/frontend/services/themes/active'));
var LocalStorage = require((0, _path.join)(process.cwd(), 'current/core/server/adapters/storage/LocalFileStorage'));

var readFileAsync = function readFileAsync(fp) {
  return new Promise(function (resolve, reject) {
    return (0, _fs.readFile)(fp, function (err, data) {
      return err ? reject(err) : resolve(data);
    });
  });
};
var stripLeadingSlash = function stripLeadingSlash(s) {
  return s.indexOf('/') === 0 ? s.substring(1) : s;
};
var stripEndingSlash = function stripEndingSlash(s) {
  return s.indexOf('/') === s.length - 1 ? s.substring(0, s.length - 1) : s;
};

class Store extends LocalStorage {
  constructor() {
    var config = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

    super(config);

    var accessKeyId = config.accessKeyId,
        assetHost = config.assetHost,
        bucket = config.bucket,
        pathPrefix = config.pathPrefix,
        region = config.region,
        secretAccessKey = config.secretAccessKey,
        endpoint = config.endpoint,
        serverSideEncryption = config.serverSideEncryption,
        forcePathStyle = config.forcePathStyle,
        signatureVersion = config.signatureVersion,
        acl = config.acl;

    // Compatible with the aws-sdk's default environment variables

    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.region = process.env.AWS_DEFAULT_REGION || region;

    this.bucket = process.env.GHOST_STORAGE_ADAPTER_S3_PATH_BUCKET || bucket;

    // Optional configurations
    this.host = process.env.GHOST_STORAGE_ADAPTER_S3_ASSET_HOST || assetHost || `https://s3${this.region === 'us-east-1' ? '' : `-${this.region}`}.amazonaws.com/${this.bucket}`;
    this.pathPrefix = stripLeadingSlash(process.env.GHOST_STORAGE_ADAPTER_S3_PATH_PREFIX || pathPrefix || '');
    this.endpoint = process.env.GHOST_STORAGE_ADAPTER_S3_ENDPOINT || endpoint || '';
    this.serverSideEncryption = process.env.GHOST_STORAGE_ADAPTER_S3_SSE || serverSideEncryption || '';
    this.s3ForcePathStyle = Boolean(process.env.GHOST_STORAGE_ADAPTER_S3_FORCE_PATH_STYLE) || Boolean(forcePathStyle) || false;
    this.signatureVersion = process.env.GHOST_STORAGE_ADAPTER_S3_SIGNATURE_VERSION || signatureVersion || 'v4';
    this.acl = process.env.GHOST_STORAGE_ADAPTER_S3_ACL || acl || 'public-read';
  }

  delete(fileName, targetDir) {
    var _this = this;

    var directory = targetDir || this.getTargetDir(this.pathPrefix);

    return new Promise(function (resolve, reject) {
      _this.s3().deleteObject({
        Bucket: _this.bucket,
        Key: stripLeadingSlash((0, _path.join)(directory, fileName))
      }, function (err) {
        return err ? resolve(false) : resolve(true);
      });
    });
  }

  exists(fileName, targetDir) {
    var _this2 = this;

    return new Promise(function (resolve, reject) {
      _this2.s3().getObject({
        Bucket: _this2.bucket,
        Key: stripLeadingSlash((0, _path.join)(targetDir, fileName))
      }, function (err) {
        return err ? resolve(false) : resolve(true);
      });
    });
  }

  s3() {
    var options = {
      bucket: this.bucket,
      region: this.region,
      signatureVersion: this.signatureVersion,
      s3ForcePathStyle: this.s3ForcePathStyle

      // Set credentials only if provided, falls back to AWS SDK's default provider chain
    };if (this.accessKeyId && this.secretAccessKey) {
      options.credentials = new _awsSdk2.default.Credentials(this.accessKeyId, this.secretAccessKey);
    }

    if (this.endpoint !== '') {
      options.endpoint = this.endpoint;
    }
    return new _awsSdk2.default.S3(options);
  }

  save(image, targetDir) {
    var _this3 = this;

    var directory = targetDir || this.getTargetDir(this.pathPrefix);

    var imageSizes = activeTheme.get().config('image_sizes');

    var imageDimensions = Object.keys(imageSizes).reduce(function (dimensions, size) {
      var _imageSizes$size = imageSizes[size],
          width = _imageSizes$size.width,
          height = _imageSizes$size.height;

      var dimension = (width ? 'w' + width : '') + (height ? 'h' + height : '');
      return Object.assign({
        [dimension]: imageSizes[size]
      }, dimensions);
    }, {});

    return new Promise(function (resolve, reject) {
      Promise.all([_this3.getUniqueFileName(image, (0, _path.join)(directory, 'original')), readFileAsync(image.path)]).then(function (_ref) {
        var _ref2 = _slicedToArray(_ref, 2),
            fileName = _ref2[0],
            file = _ref2[1];

        var config = {
          ACL: _this3.acl,
          Body: file,
          Bucket: _this3.bucket,
          CacheControl: `max-age=${30 * 24 * 60 * 60}`,
          ContentType: image.type,
          Key: stripLeadingSlash(fileName)
        };

        if (_this3.serverSideEncryption !== '') {
          config.ServerSideEncryption = _this3.serverSideEncryption;
        }

        Promise.all([_this3.s3().putObject(config).promise()].concat(_toConsumableArray(Object.keys(imageDimensions).map(function (imageDimension) {
          return Promise.all([_this3.getUniqueFileName(image, (0, _path.join)(directory, 'size', imageDimension)), _imageTransform2.default.resizeFromBuffer(file, imageDimensions[imageDimension])]).then(function (_ref3) {
            var _ref4 = _slicedToArray(_ref3, 2),
                name = _ref4[0],
                transformed = _ref4[1];

            return Object.assign({}, config, { Body: transformed, Key: stripLeadingSlash(name) });
          }).then(function (config) {
            return _this3.s3().putObject(config).promise();
          });
        })))).then(function () {
          return resolve(`${_this3.host}/${fileName}`);
        }).catch(function (err) {
          return reject(err);
        });
      }).catch(function (err) {
        return reject(err);
      });
    });
  }

  serve() {
    var _this4 = this;

    console.log(LocalStorage);
    return function (req, res, next) {
      return _this4.s3().getObject({
        Bucket: _this4.bucket,
        Key: stripLeadingSlash(stripEndingSlash(_this4.pathPrefix) + req.path)
      }).on('httpHeaders', function (statusCode, headers, response) {
        return res.set(headers);
      }).createReadStream().on('error', function (err) {
        return LocalStorage.prototype.serve.call(_this4)(req, res, next);
      }).pipe(res);
    };
  }

  read(options) {
    var _this5 = this;

    options = options || {};
    var directory = stripEndingSlash(this.pathPrefix || '');

    return new Promise(function (resolve, reject) {
      // remove trailing slashes
      var path = (options.path || '').replace(/\/$|\\$/, '');

      // check if path is stored in s3 then stripping it
      if (path.startsWith(_this5.host)) {
        path = path.substring(_this5.host.length);
        _this5.s3().getObject({
          Bucket: _this5.bucket,
          Key: stripLeadingSlash(path)
        }, function (err, data) {
          return err ? reject(err) : resolve(data.Body);
        });
      } else {
        return LocalStorage.prototype.read.call(_this5, options);
      }
    });
  }
}

exports.default = Store;
module.exports = exports['default'];
