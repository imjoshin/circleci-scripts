const { promisify } = require('util');
const fetch = promisify(require("request"));
const execPromise = promisify(require('child_process').exec)


const context = {
  v1: `github/gatsbyjs/gatsby`,
  v2: `gh/gatsbyjs/gatsby`,
}

const client = {
  get: async (api, path, data = {}, opt = {}) => {
    const url = [
      `https://circleci.com/api`,
      `v${opt.version || 2}`,
      api,
      ...(opt.skipContext ? [] : [opt.version ? context.v1 : context.v2]),
      path,
    ].join('/')

    const options = {
      method: 'GET',
      url,
      headers: {
        'Circle-Token': process.env.CIRCLECI_TOKEN,
      },
      qs: data,
    };


    const req = await fetch(options)
    return opt.raw ? req.body : JSON.parse(req.body)
  }
}

const getS3File = async (url) => {
  // we have to get s3 files this way to avoid using s3 apis with auth
  // for some reason fetching or requesting produces encoded results

  // TODO try to stream this - sometimes we get a buffer overload
  const curl = await execPromise(`
  curl '${url}' \
  -H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9' \
  -H 'Accept-Language: en-US,en;q=0.9' \
  -H 'Cache-Control: no-cache' \
  -H 'Connection: keep-alive' \
  -H 'Pragma: no-cache' \
  -H 'Upgrade-Insecure-Requests: 1' \
  -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.0.0 Safari/537.36' \
  --compressed \
  --insecure
  `)

  return curl.stdout
}

exports.client = client
exports.fetch = fetch
exports.getS3File = getS3File