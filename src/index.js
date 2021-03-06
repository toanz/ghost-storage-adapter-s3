import AWS from 'aws-sdk'
import { join } from 'path'
import { readFile } from 'fs'
import imageTransform from '@tryghost/image-transform'

const activeTheme = require(join(process.cwd(), 'current/core/frontend/services/themes/active'));
const LocalStorage = require(join(process.cwd(), 'current/core/server/adapters/storage/LocalFileStorage'));

const readFileAsync = fp => new Promise((resolve, reject) => readFile(fp, (err, data) => err ? reject(err) : resolve(data)))
const stripLeadingSlash = s => s.indexOf('/') === 0 ? s.substring(1) : s
const stripEndingSlash = s => s.indexOf('/') === (s.length - 1) ? s.substring(0, s.length - 1) : s

class Store extends LocalStorage {
  constructor (config = {}) {
    super(config)

    const {
      accessKeyId,
      assetHost,
      bucket,
      pathPrefix,
      region,
      secretAccessKey,
      endpoint,
      serverSideEncryption,
      forcePathStyle,
      signatureVersion,
      acl
    } = config

    // Compatible with the aws-sdk's default environment variables
    this.accessKeyId = accessKeyId
    this.secretAccessKey = secretAccessKey
    this.region = process.env.AWS_DEFAULT_REGION || region

    this.bucket = process.env.GHOST_STORAGE_ADAPTER_S3_PATH_BUCKET || bucket

    // Optional configurations
    this.host = process.env.GHOST_STORAGE_ADAPTER_S3_ASSET_HOST || assetHost || `https://s3${this.region === 'us-east-1' ? '' : `-${this.region}`}.amazonaws.com/${this.bucket}`
    this.pathPrefix = stripLeadingSlash(process.env.GHOST_STORAGE_ADAPTER_S3_PATH_PREFIX || pathPrefix || '')
    this.endpoint = process.env.GHOST_STORAGE_ADAPTER_S3_ENDPOINT || endpoint || ''
    this.serverSideEncryption = process.env.GHOST_STORAGE_ADAPTER_S3_SSE || serverSideEncryption || ''
    this.s3ForcePathStyle = Boolean(process.env.GHOST_STORAGE_ADAPTER_S3_FORCE_PATH_STYLE) || Boolean(forcePathStyle) || false
    this.signatureVersion = process.env.GHOST_STORAGE_ADAPTER_S3_SIGNATURE_VERSION || signatureVersion || 'v4'
    this.acl = process.env.GHOST_STORAGE_ADAPTER_S3_ACL || acl || 'public-read'
  }

  delete (fileName, targetDir) {
    const directory = targetDir || this.getTargetDir(this.pathPrefix)

    return new Promise((resolve, reject) => {
      this.s3()
        .deleteObject({
          Bucket: this.bucket,
          Key: stripLeadingSlash(join(directory, fileName))
        }, (err) => err ? resolve(false) : resolve(true))
    })
  }

  exists (fileName, targetDir) {
    return new Promise((resolve, reject) => {
      this.s3()
        .getObject({
          Bucket: this.bucket,
          Key: stripLeadingSlash(join(targetDir, fileName))
        }, (err) => err ? resolve(false) : resolve(true))
    })
  }

  s3 () {
    const options = {
      bucket: this.bucket,
      region: this.region,
      signatureVersion: this.signatureVersion,
      s3ForcePathStyle: this.s3ForcePathStyle
    }

    // Set credentials only if provided, falls back to AWS SDK's default provider chain
    if (this.accessKeyId && this.secretAccessKey) {
      options.credentials = new AWS.Credentials(this.accessKeyId, this.secretAccessKey)
    }

    if (this.endpoint !== '') {
      options.endpoint = this.endpoint
    }
    return new AWS.S3(options)
  }

  save (image, targetDir) {
    const directory = targetDir || this.getTargetDir(this.pathPrefix)

    const imageSizes = activeTheme.get().config('image_sizes');

    const imageDimensions = Object.keys(imageSizes).reduce((dimensions, size) => {
        const {width, height} = imageSizes[size];
        const dimension = (width ? 'w' + width : '') + (height ? 'h' + height : '');
        return Object.assign({
            [dimension]: imageSizes[size]
        }, dimensions);
    }, {});

    return new Promise((resolve, reject) => {
      Promise.all([
        this.getUniqueFileName(image, join(directory, 'original')),
        readFileAsync(image.path)
      ]).then(([ fileName, file ]) => {
        let config = {
          ACL: this.acl,
          Body: file,
          Bucket: this.bucket,
          CacheControl: `max-age=${30 * 24 * 60 * 60}`,
          ContentType: image.type,
          Key: stripLeadingSlash(fileName)
        }

        if (this.serverSideEncryption !== '') {
          config.ServerSideEncryption = this.serverSideEncryption
        }

        Promise.all([
          this.s3().putObject(config).promise(),
          ...Object.keys(imageDimensions).map(imageDimension => {
            return Promise.all([
              this.getUniqueFileName(image, join(directory, 'size', imageDimension)),
              imageTransform.resizeFromBuffer(file, imageDimensions[imageDimension]),
            ])
            .then(([name, transformed]) => Object.assign({}, config, { Body: transformed, Key: stripLeadingSlash(name) }))
            .then(config => this.s3().putObject(config).promise());
          }),
        ]).then(() => resolve(`${this.host}/${fileName}`))
          .catch((err) => reject(err))
      })
      .catch(err => reject(err))
    })
  }

  serve () {
    console.log(LocalStorage);
    return (req, res, next) =>
      this.s3()
        .getObject({
          Bucket: this.bucket,
          Key: stripLeadingSlash(stripEndingSlash(this.pathPrefix) + req.path)
        })
        .on('httpHeaders', (statusCode, headers, response) => res.set(headers))
        .createReadStream()
        .on('error', err => {
          return LocalStorage.prototype.serve.call(this)(req, res, next);
        })
        .pipe(res)
  }

  read (options) {
    options = options || {}
    const directory = stripEndingSlash(this.pathPrefix || '');

    return new Promise((resolve, reject) => {
      // remove trailing slashes
      let path = (options.path || '').replace(/\/$|\\$/, '')

      // check if path is stored in s3 then stripping it
      if (path.startsWith(this.host)) {
        path = path.substring(this.host.length)
        this.s3()
          .getObject({
            Bucket: this.bucket,
            Key: stripLeadingSlash(path)
          }, (err, data) => err ? reject(err) : resolve(data.Body))
      } else {
        return LocalStorage.prototype.read.call(this, options);
      }
    })
  }
}

export default Store
