import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

const insecureHttpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
});

const httpAgent = new http.Agent({
  keepAlive: true,
});

function decompressBuffer(buf, encoding) {
  if (!buf || buf.length === 0) return Buffer.alloc(0);
  const enc = String(encoding || '').toLowerCase();
  try {
    if (enc.includes('gzip') || (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b)) {
      return zlib.gunzipSync(buf);
    }
    if (enc.includes('deflate')) {
      return zlib.inflateSync(buf);
    }
    if (enc.includes('br') && typeof zlib.brotliDecompressSync === 'function') {
      return zlib.brotliDecompressSync(buf);
    }
  } catch (_) {
    // Return original buffer if decompression fails
  }
  return buf;
}

function serializeBody(data, headers, postType) {
  if (data === undefined || data === null) return undefined;
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (data instanceof URLSearchParams) return Buffer.from(data.toString(), 'utf8');

  const contentTypeKey = Object.keys(headers).find((k) => k.toLowerCase() === 'content-type');
  const contentType = contentTypeKey ? String(headers[contentTypeKey]).toLowerCase() : '';

  if (postType === 'form' || contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && v !== null) params.append(k, String(v));
    }
    if (!contentTypeKey) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }
    return Buffer.from(params.toString(), 'utf8');
  }

  if (!contentTypeKey) {
    headers['Content-Type'] = 'application/json; charset=UTF-8';
  }
  return Buffer.from(JSON.stringify(data), 'utf8');
}

async function rawHttpRequest(targetUrl, options = {}, redirectCount = 0) {
  const maxRedirects = options.maxRedirects ?? 5;
  const method = String(options.method || 'GET').toUpperCase();
  const timeout = Number(options.timeout || 15000);
  const headers = Object.assign(
    {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
    },
    options.headers || {}
  );

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (err) {
    throw new Error(`Invalid URL: ${targetUrl}`);
  }

  if (options.params && typeof options.params === 'object') {
    for (const [k, v] of Object.entries(options.params)) {
      if (v !== undefined && v !== null) parsedUrl.searchParams.set(k, String(v));
    }
  }

  const rawPayload = options.data !== undefined ? options.data : options.body;
  const bodyBuf =
    method !== 'GET' && method !== 'HEAD'
      ? serializeBody(rawPayload, headers, options.postType)
      : undefined;

  if (bodyBuf && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-length')) {
    headers['Content-Length'] = String(bodyBuf.length);
  }

  const isHttps = parsedUrl.protocol === 'https:';
  const lib = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const reqOpts = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers,
      agent: isHttps ? insecureHttpsAgent : httpAgent,
      rejectUnauthorized: false,
      timeout,
    };

    const clientReq = lib.request(reqOpts, (res) => {
      const status = res.statusCode || 200;
      const respHeaders = res.headers || {};

      if (
        [301, 302, 303, 307, 308].includes(status) &&
        respHeaders.location &&
        maxRedirects > 0 &&
        redirectCount < maxRedirects
      ) {
        res.resume();
        let nextUrl = respHeaders.location;
        try {
          nextUrl = new URL(nextUrl, parsedUrl.href).href;
        } catch (_) {}
        const nextMethod = status === 303 ? 'GET' : method;
        const nextOpts = Object.assign({}, options, {
          method: nextMethod,
          data: status === 303 ? undefined : options.data,
          body: status === 303 ? undefined : options.body,
        });
        rawHttpRequest(nextUrl, nextOpts, redirectCount + 1).then(resolve, reject);
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const rawBuf = Buffer.concat(chunks);
        const wantBinary =
          options.buffer === 2 ||
          options.buffer === 1 ||
          options.buffer === true ||
          options.responseType === 'arraybuffer' ||
          options.responseType === 'buffer';

        const decompressedBuf = decompressBuffer(rawBuf, respHeaders['content-encoding']);
        let dataOut;

        if (wantBinary) {
          dataOut = decompressedBuf;
        } else {
          const text = decompressedBuf.toString('utf8');
          if (options.responseType === 'json') {
            try {
              dataOut = JSON.parse(text);
            } catch (_) {
              dataOut = text;
            }
          } else {
            dataOut = text;
          }
        }

        const responseObj = {
          status,
          statusCode: status,
          headers: respHeaders,
          data: dataOut,
          body: dataOut,
          buffer: decompressedBuf,
          url: parsedUrl.href,
          finalUrl: parsedUrl.href,
        };

        const validateStatus =
          typeof options.validateStatus === 'function' ? options.validateStatus : () => true;

        if (!validateStatus(status)) {
          const err = new Error(`Request failed with status code ${status}`);
          err.response = responseObj;
          reject(err);
          return;
        }

        resolve(responseObj);
      });
      res.on('error', reject);
    });

    clientReq.on('timeout', () => {
      clientReq.destroy(new Error(`Request timeout after ${timeout}ms`));
    });
    clientReq.on('error', reject);

    if (bodyBuf) {
      clientReq.write(bodyBuf);
    }
    clientReq.end();
  });
}

async function req(urlOrConfig, config = {}) {
  if (typeof urlOrConfig === 'object' && urlOrConfig !== null) {
    const targetUrl = urlOrConfig.url || '';
    return rawHttpRequest(targetUrl, urlOrConfig);
  }
  return rawHttpRequest(String(urlOrConfig || ''), config);
}

req.get = async (url, config = {}) => {
  return rawHttpRequest(url, Object.assign({}, config, { method: 'GET' }));
};

req.post = async (url, data, config = {}) => {
  const merged = Object.assign({}, config, { method: 'POST' });
  if (data !== undefined) {
    merged.data = data;
  }
  return rawHttpRequest(url, merged);
};

req.request = async (config = {}) => {
  return rawHttpRequest(config.url || '', config);
};

export default req;
