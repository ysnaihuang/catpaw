import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const SITE_DOMAINS = ['https://javheo.com', 'https://www.javheo.com'];
let activeDomain = SITE_DOMAINS[0];

const CARD_STYLE = { type: 'rect', ratio: 1.78 };

const DEFAULT_CAT_SLUGS = [
  'jav',
  'japanese',
  'japan',
  'uncensored',
  'fc2',
  'ssis',
  'ssni',
  'heyzo',
  'chinese',
  'thai',
  'asian',
  'big-tits',
  'creampie',
  'milf',
  'mom',
  'wife',
  'married-woman',
  'stepmom',
  'massage',
  'nurse',
  'office',
  'schoolgirl',
  'stockings',
  'squirt',
  'hentai',
  'lesbian',
  'anal',
  'bdsm',
  'gangbang',
  'group-sex',
];

let cachedCatSlugs = [];
const PLAY_CACHE = new Map();
const PLAY_CACHE_TTL = 10 * 60 * 1000;
const PROXY_STREAM_CACHE = new Map();
const COOKIE_JAR = new Map();

const DEFAULT_SLICE_CHUNK_BYTES = 512 * 1024; // 512KB per open-ended upstream slice
const MAX_EXPLICIT_SLICE_BYTES = 4 * 1024 * 1024; // 4MB cap for explicit-end range requests

let localProxyServer = null;
let localProxyPort = 0;
let fastifyRoutesRegistered = false;

const AD_OR_DECOY_MEDIA_RE =
  /(?:^|[/_.-])(?:preview|sample|trailer|teaser|preroll|ad_video|advideo|thumb_video)[0-9_-]*\.(?:mp4|m3u8|webm)|\/(?:preview|previews|trailer|trailers|sample|samples|ads|adserver|banners?|thumbs?|sprites?)\/|top_banner|native-ad|stat\.php|exoclick|juicyads|magsrv|tsyndicate|realsrv|adtng|doubleclick|googlesyndication/i;

const AD_IFRAME_RE =
  /exoclick|juicyads|magsrv|tsyndicate|realsrv|adtng|doubleclick|googlesyndication|googletagmanager|histats|stat\.php|adserver|popunder|a-ads\.com|trafficjunky|plugrush/i;

const NON_VIDEO_ASSET_RE =
  /\.(?:jpg|jpeg|png|gif|webp|bmp|svg|ico|vtt|srt|ass|ssa|css|js|woff2?|ttf|eot)(?:$|\?)/i;

const PARKING_OR_BLOCK_RE =
  /domain is for sale|parked free|sedoparking|hugedomains|afternic|\bdan\.com\b|Attention Required!\s*\|\s*Cloudflare|cf-error-details|<title>\s*(?:403 Forbidden|404 Not Found|502 Bad Gateway|503 Service)/i;

const FASTIFY_INTERNAL_KEYS = new Set([
  'query',
  'body',
  'params',
  'raw',
  'server',
  'headers',
  'log',
  'context',
  'routeOptions',
  'routerPath',
  'routerMethod',
  'is404',
  'hostname',
  'ip',
  'ips',
  'protocol',
  'method',
  'originalUrl',
  'socket',
  'connection',
]);

function getHostOrigin(urlStr) {
  try {
    const u = new URL(urlStr);
    return `${u.protocol}//${u.host}`;
  } catch {
    return activeDomain;
  }
}

function normalizeHostKey(urlStr) {
  try {
    return new URL(urlStr).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function storeCookiesFromHeaders(urlStr, headers) {
  if (!headers || typeof headers !== 'object') return;
  const host = normalizeHostKey(urlStr);
  if (!host) return;
  const rawSetCookie =
    headers['set-cookie'] || headers['Set-Cookie'] || headers['SET-COOKIE'];
  if (!rawSetCookie) return;
  const list = Array.isArray(rawSetCookie)
    ? rawSetCookie
    : String(rawSetCookie).split(/\r?\n|,(?=\s*[A-Za-z0-9_-]+=)/);
  const jar = COOKIE_JAR.get(host) || new Map();
  for (const item of list) {
    const firstPart = String(item || '').split(';')[0].trim();
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx > 0) {
      const k = firstPart.slice(0, eqIdx).trim();
      const v = firstPart.slice(eqIdx + 1).trim();
      if (k) jar.set(k, v);
    }
  }
  COOKIE_JAR.set(host, jar);
}

function getCookieHeader(urlStr) {
  const host = normalizeHostKey(urlStr);
  if (!host) return '';
  const jar = COOKIE_JAR.get(host);
  if (!jar || jar.size === 0) return '';
  const pairs = [];
  for (const [k, v] of jar.entries()) {
    pairs.push(`${k}=${v}`);
  }
  return pairs.join('; ');
}

function isKnownSiteHost(urlStr) {
  const h = normalizeHostKey(urlStr);
  if (!h) return false;
  return SITE_DOMAINS.some((d) => normalizeHostKey(d) === h);
}

function getDomainPool() {
  const seen = new Set();
  const pool = [];
  for (const d of [activeDomain, ...SITE_DOMAINS]) {
    if (!d) continue;
    const clean = String(d).replace(/\/+$/, '');
    if (!seen.has(clean)) {
      seen.add(clean);
      pool.push(clean);
    }
  }
  return pool;
}

function expandCandidateUrls(urlOrPath) {
  const raw = decodeHtmlEntities(String(urlOrPath || '').trim());
  if (!raw) return [];
  const pool = getDomainPool();

  if (raw.startsWith('//')) {
    return [`https:${raw}`];
  }
  if (raw.startsWith('/')) {
    return pool.map((d) => `${d}${raw}`);
  }
  if (/^https?:\/\//i.test(raw)) {
    if (isKnownSiteHost(raw)) {
      try {
        const u = new URL(raw);
        const suffix = `${u.pathname}${u.search}${u.hash}`;
        return pool.map((d) => `${d}${suffix}`);
      } catch {
        return [raw];
      }
    }
    return [raw];
  }
  return pool.map((d) => `${d}/${raw.replace(/^\/+/, '')}`);
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&amp;/gi, '&')
    .replace(/&#0*38;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    });
}

function normalizeUrl(rawUrl, baseUrl = activeDomain) {
  const cleaned = decodeHtmlEntities(String(rawUrl || '').trim());
  if (
    !cleaned ||
    /^(?:about:blank|javascript:|data:|mailto:|tel:|#|none$|null$|undefined$)/i.test(
      cleaned
    )
  ) {
    return '';
  }
  if (cleaned.startsWith('//')) {
    return `https:${cleaned}`;
  }
  if (/^https?:\/\//i.test(cleaned)) {
    return cleaned;
  }
  if (cleaned.startsWith('/')) {
    return `${getHostOrigin(baseUrl).replace(/\/+$/, '')}${cleaned}`;
  }
  try {
    return new URL(cleaned, baseUrl).href;
  } catch {
    return '';
  }
}

function extractFilenameFromUrl(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string') return '';
  try {
    const u = new URL(fileUrl, activeDomain);
    const segs = u.pathname.split('/').filter(Boolean);
    return segs.length > 0 ? decodeURIComponent(segs[segs.length - 1]) : '';
  } catch {
    const noQuery = String(fileUrl).split(/[?#]/)[0];
    const segs = noQuery.split('/').filter(Boolean);
    return segs.length > 0 ? segs[segs.length - 1] : '';
  }
}

function decompressBuffer(buf, contentEncoding = '', isBinaryMedia = false) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return Buffer.alloc(0);
  const enc = String(contentEncoding || '').toLowerCase();
  if (isBinaryMedia && !enc) return buf;
  try {
    if (
      enc.includes('gzip') ||
      (!isBinaryMedia && buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b)
    ) {
      return zlib.gunzipSync(buf);
    }
    if (enc.includes('br')) {
      return zlib.brotliDecompressSync(buf);
    }
    if (enc.includes('deflate')) {
      try {
        return zlib.inflateSync(buf);
      } catch {
        return zlib.inflateRawSync(buf);
      }
    }
  } catch {
    return buf;
  }
  return buf;
}

function decodeBufferToText(buf, contentType = '') {
  if (!Buffer.isBuffer(buf)) return String(buf || '');
  const ct = String(contentType || '').toLowerCase();
  if ((ct.includes('gbk') || ct.includes('gb2312')) && typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch {}
  }
  const utf8 = buf.toString('utf8');
  if (utf8.includes('\ufffd') && typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch {}
  }
  return utf8;
}

function isValidResponseContent(text, targetUrl, isPost = false, postMix = '') {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (PARKING_OR_BLOCK_RE.test(trimmed)) return false;

  if (isKnownSiteHost(targetUrl)) {
    let pathname = '';
    try {
      pathname = new URL(targetUrl).pathname.toLowerCase();
    } catch {}

    if (pathname.endsWith('.xml')) {
      return /<loc>|<urlset|<sitemap/i.test(trimmed);
    }
    if (/^moviesiframe/i.test(String(postMix || ''))) {
      return /<iframe|<embed|<video|<source|Artplayer|player_|decryptDatas|eyJ[A-Za-z0-9+/=_-]{20,}|\.m3u8|\.mp4/i.test(
        trimmed
      );
    }
    if (isPost || pathname.includes('hash-javheo')) {
      return /<iframe|<embed|<video|<source|Artplayer|player_|decryptDatas|eyJ[A-Za-z0-9+/=_-]{20,}|\/watch\/|\.m3u8|\.mp4|https?:\/\/|\/\/[a-z0-9]/i.test(
        trimmed
      );
    }
    return /\/watch\/|\/porn\/|<iframe|<video|<source|Artplayer|player_aaaa|player_data|player_config|decryptDatas|videoUrl|playUrl|hlsUrl|streamUrl|og:image|video:duration|\.m3u8|\.mp4|eval\(function|<h1>/i.test(
      trimmed
    );
  }

  return trimmed.length > 5;
}

function rawSocketHttpRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (err) {
      return reject(err);
    }
    const isHttps = parsed.protocol === 'https:';
    const port = Number(parsed.port) || (isHttps ? 443 : 80);
    const method = (options.method || 'GET').toUpperCase();
    const timeout = options.timeout || 12000;
    const maxBytes = options.maxBytes || 4 * 1024 * 1024;
    const headers = {
      Host: parsed.host,
      Connection: 'close',
      ...(options.headers || {}),
    };
    const bodyBuf =
      options.body != null && method !== 'GET' && method !== 'HEAD'
        ? Buffer.isBuffer(options.body)
          ? options.body
          : Buffer.from(String(options.body), 'utf8')
        : null;
    if (bodyBuf && !headers['Content-Length'] && !headers['content-length']) {
      headers['Content-Length'] = String(bodyBuf.length);
    }

    let settled = false;
    let sock = null;
    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      if (sock && !sock.destroyed) {
        try {
          sock.destroy();
        } catch {}
      }
      if (err) reject(err);
      else resolve(val);
    };

    const onConnect = () => {
      const reqPath = `${parsed.pathname || '/'}${parsed.search || ''}`;
      let rawReq = `${method} ${reqPath} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(headers)) {
        if (v !== undefined && v !== null) {
          rawReq += `${k}: ${v}\r\n`;
        }
      }
      rawReq += '\r\n';
      sock.write(rawReq);
      if (bodyBuf) sock.write(bodyBuf);
    };

    sock = isHttps
      ? tls.connect(
          {
            host: parsed.hostname,
            port,
            servername: parsed.hostname,
            rejectUnauthorized: false,
          },
          onConnect
        )
      : net.connect({ host: parsed.hostname, port }, onConnect);

    sock.setTimeout(timeout, () => finish(new Error('Socket timeout')));
    sock.on('error', (err) => finish(err));

    let rawBuf = Buffer.alloc(0);
    let headerEndIdx = -1;
    let status = 200;
    let resHeaders = {};
    let expectedLen = null;
    let isChunked = false;

    const tryComplete = (force = false) => {
      if (headerEndIdx === -1) return;
      const bodySlice = rawBuf.subarray(headerEndIdx + 4);
      if (method === 'HEAD') {
        return finish(null, {
          status,
          headers: resHeaders,
          buffer: Buffer.alloc(0),
          text: '',
          finalUrl: urlStr,
        });
      }
      if (isChunked) {
        if (bodySlice.includes(Buffer.from('0\r\n\r\n')) || force) {
          const decodedChunks = [];
          let pos = 0;
          while (pos < bodySlice.length) {
            const lineEnd = bodySlice.indexOf('\r\n', pos);
            if (lineEnd === -1) break;
            const sizeHex = bodySlice
              .subarray(pos, lineEnd)
              .toString('ascii')
              .split(';')[0]
              .trim();
            const chunkSize = parseInt(sizeHex, 16);
            if (!Number.isFinite(chunkSize) || chunkSize === 0) break;
            const chunkStart = lineEnd + 2;
            if (chunkStart + chunkSize > bodySlice.length) break;
            decodedChunks.push(bodySlice.subarray(chunkStart, chunkStart + chunkSize));
            pos = chunkStart + chunkSize + 2;
          }
          const fullBody = Buffer.concat(decodedChunks);
          const decomp = decompressBuffer(
            fullBody,
            resHeaders['content-encoding'] || '',
            Boolean(options.binaryOnly)
          );
          return finish(null, {
            status,
            headers: resHeaders,
            buffer: decomp,
            text: options.binaryOnly
              ? ''
              : decodeBufferToText(decomp, resHeaders['content-type'] || ''),
            finalUrl: urlStr,
          });
        }
        return;
      }
      if (
        force ||
        (expectedLen !== null && bodySlice.length >= expectedLen) ||
        bodySlice.length >= maxBytes
      ) {
        const targetLen =
          expectedLen !== null
            ? Math.min(bodySlice.length, expectedLen, maxBytes)
            : Math.min(bodySlice.length, maxBytes);
        const finalBody = bodySlice.subarray(0, targetLen);
        const decomp = decompressBuffer(
          finalBody,
          resHeaders['content-encoding'] || '',
          Boolean(options.binaryOnly)
        );
        return finish(null, {
          status,
          headers: resHeaders,
          buffer: decomp,
          text: options.binaryOnly
            ? ''
            : decodeBufferToText(decomp, resHeaders['content-type'] || ''),
          finalUrl: urlStr,
        });
      }
    };

    sock.on('data', (chunk) => {
      rawBuf = Buffer.concat([rawBuf, chunk]);
      if (headerEndIdx === -1) {
        headerEndIdx = rawBuf.indexOf('\r\n\r\n');
        if (headerEndIdx !== -1) {
          const headerText = rawBuf.subarray(0, headerEndIdx).toString('utf8');
          const lines = headerText.split('\r\n');
          const statusMatch = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/i.exec(lines[0] || '');
          status = statusMatch ? parseInt(statusMatch[1], 10) : 200;
          for (let i = 1; i < lines.length; i += 1) {
            const idx = lines[i].indexOf(':');
            if (idx > 0) {
              const k = lines[i].slice(0, idx).trim().toLowerCase();
              const v = lines[i].slice(idx + 1).trim();
              if (k === 'set-cookie') {
                if (!resHeaders['set-cookie']) resHeaders['set-cookie'] = [];
                resHeaders['set-cookie'].push(v);
              } else {
                resHeaders[k] = v;
              }
            }
          }
          storeCookiesFromHeaders(urlStr, resHeaders);
          if (resHeaders['content-length'] !== undefined) {
            const cl = parseInt(resHeaders['content-length'], 10);
            if (Number.isFinite(cl) && cl >= 0) expectedLen = cl;
          }
          if (/chunked/i.test(resHeaders['transfer-encoding'] || '')) {
            isChunked = true;
          }
        }
      }
      tryComplete(false);
    });

    sock.on('end', () => tryComplete(true));
    sock.on('close', () => tryComplete(true));
  });
}

function nativeHttpRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const maxRedirects = options.maxRedirects ?? 5;
    let redirects = 0;

    const doReq = (currentUrl) => {
      let parsed;
      try {
        parsed = new URL(currentUrl);
      } catch (err) {
        return reject(err);
      }
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;
      const method = (options.method || 'GET').toUpperCase();
      const headers = {
        Connection: 'close',
        ...(options.headers || {}),
      };
      const cookieStr = getCookieHeader(currentUrl);
      if (cookieStr && !headers.Cookie && !headers.cookie) {
        headers.Cookie = cookieStr;
      }
      let bodyBuf = null;
      if (options.body != null && method !== 'GET' && method !== 'HEAD') {
        bodyBuf = Buffer.isBuffer(options.body)
          ? options.body
          : Buffer.from(String(options.body), 'utf8');
        if (!headers['Content-Length'] && !headers['content-length']) {
          headers['Content-Length'] = String(bodyBuf.length);
        }
      }

      const reqOpts = {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers,
        timeout: options.timeout || 12000,
        rejectUnauthorized: false,
        agent: false,
      };

      let settled = false;
      const done = (err, resObj) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve(resObj);
      };

      const clientReq = lib.request(reqOpts, (res) => {
        storeCookiesFromHeaders(currentUrl, res.headers);
        const status = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          if (redirects >= maxRedirects) {
            return done(new Error('Too many redirects'));
          }
          redirects += 1;
          const nextUrl = new URL(res.headers.location, currentUrl).href;
          settled = true;
          return doReq(nextUrl);
        }

        if (method === 'HEAD') {
          res.resume();
          try {
            res.destroy();
          } catch {}
          return done(null, {
            status,
            headers: res.headers,
            buffer: Buffer.alloc(0),
            text: '',
            finalUrl: currentUrl,
          });
        }

        const chunks = [];
        let total = 0;
        const limit = options.maxBytes || 4 * 1024 * 1024;
        const clHeader = res.headers['content-length'];
        const expectedLen =
          clHeader !== undefined && /^\d+$/.test(String(clHeader).trim())
            ? parseInt(String(clHeader).trim(), 10)
            : null;

        const finishResponse = () => {
          if (settled) return;
          const rawBuf = Buffer.concat(chunks);
          const slicedBuf =
            expectedLen !== null && rawBuf.length > expectedLen
              ? rawBuf.subarray(0, expectedLen)
              : rawBuf.length > limit
              ? rawBuf.subarray(0, limit)
              : rawBuf;
          const decompressed = decompressBuffer(
            slicedBuf,
            res.headers['content-encoding'] || '',
            Boolean(options.binaryOnly)
          );
          done(null, {
            status,
            headers: res.headers,
            buffer: decompressed,
            text: options.binaryOnly
              ? ''
              : decodeBufferToText(decompressed, res.headers['content-type'] || ''),
            finalUrl: currentUrl,
          });
        };

        res.on('data', (chunk) => {
          if (settled) return;
          const remaining = limit - total;
          if (remaining > 0) {
            chunks.push(chunk.length <= remaining ? chunk : chunk.subarray(0, remaining));
            total += chunk.length;
          }
          if (
            total >= limit ||
            (expectedLen !== null && expectedLen > 0 && total >= expectedLen)
          ) {
            finishResponse();
            try {
              res.destroy();
            } catch {}
          }
        });
        res.on('end', finishResponse);
        res.on('close', finishResponse);
        res.on('error', (err) => {
          if (total > 0) finishResponse();
          else done(err);
        });
      });

      clientReq.on('timeout', () => {
        clientReq.destroy(new Error('Request timeout'));
      });
      clientReq.on('error', async (err) => {
        if (settled) return;
        try {
          const fallbackRes = await rawSocketHttpRequest(currentUrl, {
            ...options,
            headers,
            body: bodyBuf,
          });
          done(null, fallbackRes);
        } catch {
          done(err);
        }
      });

      if (bodyBuf) {
        clientReq.write(bodyBuf);
      }
      clientReq.end();
    };

    doReq(urlStr);
  });
}

function extractTextFromReqResponse(resp) {
  if (!resp) return '';
  const payload =
    resp.data !== undefined
      ? resp.data
      : resp.body !== undefined
      ? resp.body
      : resp.content !== undefined
      ? resp.content
      : resp;
  if (typeof payload === 'string') return payload;
  if (
    Buffer.isBuffer(payload) ||
    payload instanceof Uint8Array ||
    payload instanceof ArrayBuffer
  ) {
    const buf = Buffer.isBuffer(payload)
      ? payload
      : payload instanceof ArrayBuffer
      ? Buffer.from(payload)
      : Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
    const decomp = decompressBuffer(
      buf,
      resp.headers?.['content-encoding'] || resp.headers?.['Content-Encoding'] || ''
    );
    return decodeBufferToText(
      decomp,
      resp.headers?.['content-type'] || resp.headers?.['Content-Type'] || ''
    );
  }
  if (payload && typeof payload === 'object') {
    try {
      return JSON.stringify(payload);
    } catch {
      return '';
    }
  }
  return '';
}

async function fetchPage(
  urlOrPath,
  { data = null, referer = null, timeout = 12000, extraHeaders = {} } = {}
) {
  const candidates = expandCandidateUrls(urlOrPath);
  const isPost = data !== null && data !== undefined;

  let formBody = null;
  let plainFormObj = null;
  if (isPost) {
    if (typeof data === 'string') {
      formBody = data;
      try {
        const sp = new URLSearchParams(data);
        const obj = {};
        for (const [k, v] of sp.entries()) obj[k] = v;
        if (Object.keys(obj).length > 0) plainFormObj = obj;
      } catch {}
    } else if (typeof data === 'object') {
      plainFormObj = data;
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(data)) {
        if (v !== undefined && v !== null) {
          params.append(k, String(v));
        }
      }
      formBody = params.toString();
    }
  }
  const postMix = String(plainFormObj?.mix || '');

  const buildHeadersForTarget = (targetUrl) => {
    const targetOrigin = getHostOrigin(targetUrl);
    const headers = {
      'User-Agent': UA,
      Accept: isPost
        ? '*/*'
        : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...extraHeaders,
    };

    if (referer) {
      if (isKnownSiteHost(referer) && isKnownSiteHost(targetUrl)) {
        try {
          const refUrl = new URL(referer);
          headers.Referer = `${targetOrigin}${refUrl.pathname}${refUrl.search}`;
        } catch {
          headers.Referer = referer;
        }
      } else {
        headers.Referer = referer;
      }
    } else {
      headers.Referer = `${targetOrigin}/`;
    }

    const cookieHeader = getCookieHeader(targetUrl);
    if (cookieHeader && !headers.Cookie) {
      headers.Cookie = cookieHeader;
    }

    if (isPost) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      headers['X-Requested-With'] = 'XMLHttpRequest';
      headers.Origin = targetOrigin;
    }

    return { headers, targetOrigin };
  };

  // Pass 1: Try `req` across all candidate domains first for fast mirror failover
  for (const targetUrl of candidates) {
    const { headers, targetOrigin } = buildHeadersForTarget(targetUrl);

    const acceptResp = (resp) => {
      if (!resp) return null;
      const status = Number(resp.status ?? resp.statusCode ?? resp.code ?? 200);
      storeCookiesFromHeaders(targetUrl, resp.headers);
      const text = extractTextFromReqResponse(resp);
      const finalUrl = String(resp.url || resp.finalUrl || targetUrl);
      if (
        status >= 200 &&
        status < 400 &&
        isValidResponseContent(text, finalUrl, isPost, postMix)
      ) {
        if (isKnownSiteHost(finalUrl)) {
          activeDomain = getHostOrigin(finalUrl);
        } else if (isKnownSiteHost(targetUrl)) {
          activeDomain = targetOrigin;
        }
        return {
          text,
          finalUrl,
          origin: getHostOrigin(finalUrl),
        };
      }
      return null;
    };

    try {
      if (isPost) {
        if (typeof req === 'function') {
          if (plainFormObj) {
            try {
              const rForm = await req(targetUrl, {
                method: 'POST',
                headers,
                timeout,
                data: plainFormObj,
                postType: 'form',
              });
              const okForm = acceptResp(rForm);
              if (okForm) return okForm;
            } catch {}
          }

          try {
            const rRaw = await req(targetUrl, {
              method: 'POST',
              headers,
              timeout,
              data: formBody,
              body: formBody,
            });
            const okRaw = acceptResp(rRaw);
            if (okRaw) return okRaw;
          } catch {}
        }
        if (typeof req?.post === 'function') {
          try {
            const rPost = await req.post(targetUrl, formBody, { headers, timeout });
            const okPost = acceptResp(rPost);
            if (okPost) return okPost;
          } catch {}
        }
      } else {
        const getOpts = { method: 'GET', headers, timeout };
        const resp =
          typeof req === 'function'
            ? await req(targetUrl, getOpts)
            : typeof req?.get === 'function'
            ? await req.get(targetUrl, getOpts)
            : null;
        const ok = acceptResp(resp);
        if (ok) return ok;
      }
    } catch {}
  }

  // Pass 2: Fallback to nativeHttpRequest across candidate domains
  const method = isPost ? 'POST' : 'GET';
  for (const targetUrl of candidates) {
    const { headers, targetOrigin } = buildHeadersForTarget(targetUrl);
    try {
      const nativeRes = await nativeHttpRequest(targetUrl, {
        method,
        headers,
        body: formBody,
        timeout,
      });
      if (
        nativeRes &&
        nativeRes.status >= 200 &&
        nativeRes.status < 400 &&
        isValidResponseContent(
          nativeRes.text,
          nativeRes.finalUrl || targetUrl,
          isPost,
          postMix
        )
      ) {
        const finalUrl = nativeRes.finalUrl || targetUrl;
        if (isKnownSiteHost(finalUrl)) {
          activeDomain = getHostOrigin(finalUrl);
        } else if (isKnownSiteHost(targetUrl)) {
          activeDomain = targetOrigin;
        }
        return {
          text: nativeRes.text,
          finalUrl,
          origin: getHostOrigin(finalUrl),
        };
      }
    } catch {}
  }

  return null;
}

async function fetchHtml(urlOrPath, options = {}) {
  const res = await fetchPage(urlOrPath, options);
  return res ? res.text : null;
}

function unwrapParams(inReq, extraArgs = [], mode = '') {
  const merged = {};

  if (typeof inReq === 'string' || typeof inReq === 'number') {
    const val = String(inReq).trim();
    if (mode === 'init') {
      merged.extend = val;
    } else if (mode === 'category') {
      merged.id = val;
      merged.tid = val;
      if (extraArgs[0] !== undefined) merged.page = extraArgs[0];
      if (extraArgs[1] !== undefined) merged.filter = extraArgs[1];
      if (extraArgs[2] && typeof extraArgs[2] === 'object') merged.extend = extraArgs[2];
    } else if (mode === 'detail') {
      merged.id = val;
    } else if (mode === 'play') {
      if (extraArgs.length >= 1 && extraArgs[0] !== undefined) {
        if (typeof extraArgs[0] === 'string' || typeof extraArgs[0] === 'number') {
          merged.flag = val;
          merged.id = String(extraArgs[0]);
        } else if (typeof extraArgs[0] === 'object') {
          merged.flag = val;
          Object.assign(merged, extraArgs[0]);
        }
      } else {
        merged.id = val;
      }
    } else if (mode === 'search') {
      merged.wd = val;
      if (
        extraArgs[0] !== undefined &&
        (typeof extraArgs[0] === 'number' || /^\d+$/.test(String(extraArgs[0])))
      ) {
        merged.page = extraArgs[0];
      } else if (extraArgs[1] !== undefined) {
        merged.page = extraArgs[1];
      }
    } else {
      merged.id = val;
    }
    return merged;
  }

  if (Array.isArray(inReq)) {
    merged.ids = inReq;
    if (inReq.length > 0) merged.id = inReq[0];
    return merged;
  }

  if (!inReq || typeof inReq !== 'object') {
    return merged;
  }

  const isFastifyWrapper =
    'body' in inReq ||
    'query' in inReq ||
    'params' in inReq ||
    'raw' in inReq ||
    'server' in inReq ||
    'headers' in inReq;

  const absorb = (src, isRoot = false) => {
    if (!src) return;
    if (Array.isArray(src)) {
      merged.ids = src;
      if (src.length > 0 && merged.id === undefined) merged.id = src[0];
      return;
    }
    if (typeof src === 'string') {
      const trimmed = src.trim();
      if (!trimmed) return;
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            merged.ids = parsed;
            if (parsed.length > 0 && merged.id === undefined) merged.id = parsed[0];
            return;
          }
          if (parsed && typeof parsed === 'object') {
            Object.assign(merged, parsed);
            return;
          }
        } catch {}
      }
      if (!trimmed.includes('=') && !trimmed.includes('&')) {
        if (merged.id === undefined) merged.id = trimmed;
        return;
      }
      try {
        const sp = new URLSearchParams(trimmed);
        for (const [k, v] of sp.entries()) {
          merged[k] = v;
        }
      } catch {}
    } else if (typeof src === 'object') {
      for (const [k, v] of Object.entries(src)) {
        if (v === undefined) continue;
        if (isRoot) {
          if (FASTIFY_INTERNAL_KEYS.has(k)) continue;
          if (isFastifyWrapper && k === 'id' && /^req-\d+$/i.test(String(v))) continue;
          if (
            isFastifyWrapper &&
            k === 'url' &&
            /^\/(?:spider|api)\//i.test(String(v)) &&
            (src.body || src.query || src.params)
          ) {
            continue;
          }
        }
        merged[k] = v;
      }
    }
  };

  absorb(inReq, true);
  absorb(inReq.params, false);
  absorb(inReq.query, false);
  absorb(inReq.body, false);
  return merged;
}

function toTitleCase(slug) {
  return String(slug || '')
    .replace(/-/g, ' ')
    .replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

function extractImgFromSnippet(snippet, baseUrl = activeDomain) {
  if (!snippet) return '';
  const imgTagRegex = /<img\b[^>]*>/gi;
  let tagMatch;
  while ((tagMatch = imgTagRegex.exec(snippet)) !== null) {
    const tag = tagMatch[0];
    const attrs = ['data-litespeed-src', 'data-lazy-src', 'data-original', 'data-src', 'src'];
    for (const attr of attrs) {
      const m = new RegExp(`\\b${attr}=["']([^"']+)["']`, 'i').exec(tag);
      if (m && m[1] && !/^(?:data:image\/svg|about:blank|javascript:)/i.test(m[1].trim())) {
        const url = normalizeUrl(m[1], baseUrl);
        if (url) return url;
      }
    }
  }
  return '';
}

function formatCardRemark(quality, dmin) {
  if (quality && dmin !== null && dmin !== undefined) {
    return `${quality}·${dmin}分`;
  }
  if (quality) return quality;
  if (dmin !== null && dmin !== undefined) return `${dmin}分`;
  return '';
}

function cleanCardTitle(rawTitle) {
  if (!rawTitle) return '';
  return decodeHtmlEntities(rawTitle)
    .replace(/(4K|1080p|720p|480p)/gi, '')
    .replace(/\b\d{1,3}:\d{2}(?::\d{2})?\b/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[ |-]+|[ |-]+$/g, '');
}

function parseCards(html) {
  if (!html || typeof html !== 'string') return [];
  const linkRegex = /href=["'](?:https?:\/\/[^/"']+)?\/watch\/([A-Za-z0-9_%.-]+?)\/?["']/gi;
  const links = [];
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    links.push({
      wid: m[1],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  if (links.length === 0) return [];

  const items = [];
  for (let i = 0; i < links.length; i += 1) {
    const { wid, start, end } = links[i];
    const nextStart = i + 1 < links.length ? links[i + 1].start : html.length;
    const prevEnd = i > 0 ? links[i - 1].end : 0;
    const winStart = Math.max(prevEnd, start - 800);
    const win = html.slice(winStart, nextStart);
    const winAfter = html.slice(end, nextStart);

    const pic = extractImgFromSnippet(winAfter) || extractImgFromSnippet(win);

    let title = '';
    const altMatch =
      /\balt=["']([^"']+)["']/i.exec(winAfter) || /\balt=["']([^"']+)["']/i.exec(win);
    const titleAttrMatch = /\btitle=["']([^"']+)["']/i.exec(
      html.slice(Math.max(0, start - 200), Math.min(html.length, end + 300))
    );
    if (altMatch && cleanCardTitle(altMatch[1])) {
      title = cleanCardTitle(altMatch[1]);
    } else if (titleAttrMatch && cleanCardTitle(titleAttrMatch[1])) {
      title = cleanCardTitle(titleAttrMatch[1]);
    } else {
      const textNodeRegex = />([^<>]{2,200})</g;
      let tm;
      while ((tm = textNodeRegex.exec(winAfter)) !== null) {
        const candidate = cleanCardTitle(tm[1]);
        if (candidate && !/^(?:FHD|HD|\d+\s*MIN)$/i.test(candidate)) {
          title = candidate;
          break;
        }
      }
    }

    let quality = '';
    let bestQDist = null;
    const qRegex = /(4K|1080p|720p|480p)/gi;
    let qm;
    while ((qm = qRegex.exec(win)) !== null) {
      const dist = Math.abs(winStart + qm.index - start);
      if (bestQDist === null || dist < bestQDist) {
        bestQDist = dist;
        quality = qm[1];
      }
    }

    let dmin = null;
    let bestDDist = null;
    const durRegex = /(\d{1,3}):(\d{2})(?::(\d{2}))?/g;
    let dm;
    while ((dm = durRegex.exec(win)) !== null) {
      const dist = Math.abs(winStart + dm.index - start);
      if (bestDDist === null || dist < bestDDist) {
        bestDDist = dist;
        if (dm[3] !== undefined) {
          dmin = parseInt(dm[1], 10) * 60 + parseInt(dm[2], 10);
        } else {
          dmin = parseInt(dm[1], 10);
        }
      }
    }
    if (dmin === null) {
      const minMatch = /(\d+)\s*MIN/i.exec(win);
      if (minMatch) {
        dmin = parseInt(minMatch[1], 10);
      }
    }

    items.push({
      vod_id: wid,
      vod_name: title || wid,
      vod_pic: pic,
      vod_remarks: formatCardRemark(quality, dmin),
      _q: quality.toLowerCase(),
      _rawQ: quality,
      _dmin: dmin,
    });
  }

  const rank = { '4k': 3, '1080p': 2, '720p': 1, '480p': 0, '': -1 };
  const best = new Map();
  const order = [];
  for (const it of items) {
    const wid = it.vod_id;
    if (!best.has(wid)) {
      best.set(wid, { ...it });
      order.push(wid);
    } else {
      const prev = best.get(wid);
      const curRank = rank[it._q] ?? -1;
      const prevRank = rank[prev._q] ?? -1;

      if (
        (!prev.vod_name || prev.vod_name === wid) &&
        it.vod_name &&
        it.vod_name !== wid
      ) {
        prev.vod_name = it.vod_name;
      } else if (
        it.vod_name &&
        it.vod_name !== wid &&
        it.vod_name.length > (prev.vod_name || '').length
      ) {
        prev.vod_name = it.vod_name;
      }

      if (!prev.vod_pic && it.vod_pic) {
        prev.vod_pic = it.vod_pic;
      }
      if (curRank > prevRank) {
        prev._q = it._q;
        prev._rawQ = it._rawQ;
      }
      if ((prev._dmin === null || prev._dmin === undefined) && it._dmin !== null) {
        prev._dmin = it._dmin;
      }
      prev.vod_remarks = formatCardRemark(prev._rawQ, prev._dmin);
    }
  }
  return order.map((wid) => best.get(wid));
}

function cleanCards(cards) {
  return (cards || []).map((c) => ({
    vod_id: c.vod_id || '',
    vod_name: c.vod_name || '',
    vod_pic: c.vod_pic || '',
    vod_remarks: c.vod_remarks || '',
  }));
}

function normalizeExtendFilter(extendInput) {
  let ext = extendInput;
  if (Array.isArray(ext)) {
    ext = ext.length > 0 && typeof ext[0] === 'object' ? ext[0] : {};
  }
  if (typeof ext === 'string') {
    const s = ext.trim();
    if (!s) {
      ext = {};
    } else {
      try {
        ext = JSON.parse(s);
      } catch {
        try {
          const decoded = Buffer.from(s, 'base64').toString('utf8');
          ext = JSON.parse(decoded);
        } catch {
          ext = {};
        }
      }
    }
  }
  if (!ext || typeof ext !== 'object' || Array.isArray(ext)) {
    return {};
  }
  return ext;
}

function applyFilters(cards, extendInput) {
  const ext = normalizeExtendFilter(extendInput);
  const q = String(ext.quality || '').toLowerCase().trim();
  const d = String(ext.duration || '').trim();
  const out = [];
  for (const c of cards || []) {
    if (q && (c._q || '') !== q) {
      continue;
    }
    if (d) {
      const dmin = c._dmin;
      if (dmin === null || dmin === undefined) continue;
      if (d === 'short' && !(dmin < 60)) continue;
      if (d === 'medium' && !(dmin >= 60 && dmin <= 120)) continue;
      if (d === 'long' && !(dmin > 120)) continue;
    }
    out.push(c);
  }
  return cleanCards(out);
}

function extractBalancedJson(str, startIdx) {
  const openIdx = str.indexOf('{', startIdx);
  if (openIdx === -1) return null;
  let depth = 0;
  let inString = false;
  let quoteChar = '';
  let escaped = false;
  for (let i = openIdx; i < str.length; i += 1) {
    const ch = str[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (inString) {
      if (ch === quoteChar) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      quoteChar = ch;
      continue;
    }
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return str.slice(openIdx, i + 1);
      }
    }
  }
  return null;
}

function extractBalancedParens(str, openParenIdx) {
  if (str[openParenIdx] !== '(') return null;
  let depth = 0;
  let inString = false;
  let quoteChar = '';
  let escaped = false;
  const args = [];
  let argStart = openParenIdx + 1;

  for (let i = openParenIdx; i < str.length; i += 1) {
    const ch = str[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (inString) {
      if (ch === quoteChar) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      quoteChar = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0 && ch === ')') {
        const lastArg = str.slice(argStart, i).trim();
        if (lastArg || args.length > 0) args.push(lastArg);
        return { content: str.slice(openParenIdx + 1, i), args, endIdx: i + 1 };
      }
    } else if (ch === ',' && depth === 1) {
      args.push(str.slice(argStart, i).trim());
      argStart = i + 1;
    }
  }
  return null;
}

function customUnescape(str) {
  return String(str || '')
    .replace(/%u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/%([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function normalizeEscapedSlashes(str) {
  return decodeHtmlEntities(String(str || ''))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\//g, '/');
}

function unescapeJsStringLiteral(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(['"`\\/])/g, '$1')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

function unpackDeanEdwards(html) {
  if (!html || !/eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e/i.test(html)) {
    return '';
  }
  const regex =
    /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)\s*\{[\s\S]*?\}\s*\(\s*(['"])((?:\\.|(?!\1)[\s\S])*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])((?:\\.|(?!\5)[\s\S])*?)\5\.split\(['"]\|['"]\)/g;
  const unpackedChunks = [];
  let m;
  while ((m = regex.exec(html)) !== null) {
    const payload = m[2].replace(/\\(['"\\])/g, '$1');
    const radix = parseInt(m[3], 10) || 36;
    const count = parseInt(m[4], 10) || 0;
    const symtab = m[6].split('|');
    const encodeToken = (c) => {
      const prefix = c < radix ? '' : encodeToken(Math.floor(c / radix));
      const rem = c % radix;
      return prefix + (rem > 35 ? String.fromCharCode(rem + 29) : rem.toString(36));
    };
    const dict = new Map();
    const maxIdx = Math.max(count, symtab.length);
    for (let i = maxIdx - 1; i >= 0; i -= 1) {
      const token = encodeToken(i);
      dict.set(token, symtab[i] || token);
    }
    const unpacked = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (word) =>
      dict.has(word) ? dict.get(word) : word
    );
    unpackedChunks.push(unpacked);
  }
  return unpackedChunks.join('\n');
}

function isDirectMediaUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  const cleaned = urlStr.trim();
  if (!/^https?:\/\//i.test(cleaned)) return false;
  if (AD_OR_DECOY_MEDIA_RE.test(cleaned)) return false;
  if (NON_VIDEO_ASSET_RE.test(cleaned)) return false;
  try {
    const u = new URL(cleaned);
    if (/\.(?:m3u8|mp4|flv|mpd|ts|mkv|webm)$/i.test(u.pathname)) {
      return true;
    }
    if (
      /(?:\.m3u8|\.mp4|video\/mp4|video%2Fmp4|application\/x-mpegurl|application\/vnd\.apple\.mpegurl|type=m3u8|type=mp4|mime=video)/i.test(
        u.pathname + u.search
      )
    ) {
      return true;
    }
  } catch {}
  return false;
}

function unwrapNestedStreamUrl(rawUrl, baseUrl = activeDomain) {
  let full = normalizeUrl(normalizeEscapedSlashes(rawUrl), baseUrl);
  if (!full) return '';
  try {
    const u = new URL(full);
    if (!/\.(?:m3u8|mp4|flv|mpd|mkv|webm)$/i.test(u.pathname)) {
      for (const paramName of ['url', 'src', 'file', 'video', 'm3u8', 'v']) {
        const inner = u.searchParams.get(paramName);
        if (inner) {
          let decoded = normalizeEscapedSlashes(inner.trim());
          for (let i = 0; i < 3; i += 1) {
            try {
              const next = decodeURIComponent(decoded);
              if (next === decoded) break;
              decoded = normalizeEscapedSlashes(next);
            } catch {
              const next = customUnescape(decoded);
              if (next === decoded) break;
              decoded = normalizeEscapedSlashes(next);
            }
          }
          if (
            /^(?:https?:\/\/|\/\/|\/)/i.test(decoded) ||
            /\.(?:m3u8|mp4)(?:$|\?)/i.test(decoded)
          ) {
            const normalizedInner = normalizeUrl(decoded, full);
            if (normalizedInner && isDirectMediaUrl(normalizedInner)) {
              full = normalizedInner;
              break;
            }
          }
        }
      }
    }
  } catch {}
  return full;
}

function stripPkcs7AndControlPadding(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return buf;
  let end = buf.length;
  const lastByte = buf[end - 1];
  if (lastByte >= 1 && lastByte <= 16 && end >= lastByte) {
    let validPad = true;
    for (let i = end - lastByte; i < end; i += 1) {
      if (buf[i] !== lastByte) {
        validPad = false;
        break;
      }
    }
    if (validPad) {
      end -= lastByte;
    }
  }
  while (end > 0 && buf[end - 1] < 0x20 && buf[end - 1] !== 0x09 && buf[end - 1] !== 0x0a && buf[end - 1] !== 0x0d) {
    end -= 1;
  }
  return end === buf.length ? buf : buf.subarray(0, end);
}

function isPlausibleDecryptedManifestText(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.replace(/[\x00-\x1f]+$/g, '').trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return Boolean(parsed && typeof parsed === 'object');
    } catch {
      const balanced = extractBalancedJson(trimmed, 0);
      if (balanced) {
        try {
          const parsed = JSON.parse(balanced);
          return Boolean(parsed && typeof parsed === 'object');
        } catch {}
      }
      return false;
    }
  }
  if (/^https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)/i.test(trimmed)) {
    return true;
  }
  return false;
}

function tryDecryptBuffer(cipherBuf, keyBuf, ivBuf) {
  if (!Buffer.isBuffer(cipherBuf) || cipherBuf.length === 0) return '';
  if (!Buffer.isBuffer(keyBuf)) return '';
  const bits = keyBuf.length * 8;
  if (bits !== 128 && bits !== 192 && bits !== 256) return '';

  const modes = [
    { alg: `aes-${bits}-ctr`, autoPad: false },
    { alg: `aes-${bits}-cbc`, autoPad: true },
    { alg: `aes-${bits}-cbc`, autoPad: false },
    { alg: `aes-${bits}-ecb`, autoPad: true },
    { alg: `aes-${bits}-ecb`, autoPad: false },
  ];

  const effectiveIv =
    Buffer.isBuffer(ivBuf) && ivBuf.length >= 16
      ? ivBuf.subarray(0, 16)
      : Buffer.concat([Buffer.from(ivBuf || []), Buffer.alloc(16, 0)]).subarray(0, 16);

  const checkCandidateBuffer = (rawOutBuf) => {
    const cleanedBuf = stripPkcs7AndControlPadding(rawOutBuf);
    for (const candidateBuf of [cleanedBuf, rawOutBuf]) {
      for (const enc of ['utf8', 'latin1']) {
        const out = candidateBuf
          .toString(enc)
          .replace(/[\x00-\x1f]+$/g, '')
          .trim();
        if (isPlausibleDecryptedManifestText(out)) {
          if (out.startsWith('{')) {
            try {
              JSON.parse(out);
              return out;
            } catch {
              const bal = extractBalancedJson(out, 0);
              if (bal) return bal;
            }
          }
          return out;
        }
      }
    }
    return '';
  };

  for (const { alg, autoPad } of modes) {
    try {
      const iv = alg.endsWith('-ecb') ? null : effectiveIv;
      const decipher = crypto.createDecipheriv(alg, keyBuf, iv);
      if (!autoPad) {
        decipher.setAutoPadding(false);
      }
      const outBuf = Buffer.concat([decipher.update(cipherBuf), decipher.final()]);
      const matched = checkCandidateBuffer(outBuf);
      if (matched) return matched;
    } catch {}
  }

  // Also try WebCrypto AES-GCM (where the last 16 bytes of cipherBuf are the authTag)
  if (cipherBuf.length > 16) {
    const gcmAlg = `aes-${bits}-gcm`;
    const gcmCipher = cipherBuf.subarray(0, cipherBuf.length - 16);
    const gcmTag = cipherBuf.subarray(cipherBuf.length - 16);
    const gcmIvs = [effectiveIv.subarray(0, 12), effectiveIv];
    if (Buffer.isBuffer(ivBuf) && ivBuf.length === 12) {
      gcmIvs.unshift(ivBuf);
    }
    for (const gIv of gcmIvs) {
      try {
        const decipher = crypto.createDecipheriv(gcmAlg, keyBuf, gIv);
        decipher.setAuthTag(gcmTag);
        const outBuf = Buffer.concat([decipher.update(gcmCipher), decipher.final()]);
        const matched = checkCandidateBuffer(outBuf);
        if (matched) return matched;
      } catch {}
    }
  }

  return '';
}

function buildKeyCandidates(rawKey) {
  const candidates = [];
  const seen = new Set();
  const pushKey = (buf) => {
    if (!Buffer.isBuffer(buf)) return;
    if (buf.length !== 16 && buf.length !== 24 && buf.length !== 32) return;
    const hex = buf.toString('hex');
    if (!seen.has(hex)) {
      seen.add(hex);
      candidates.push(buf);
    }
  };

  if (Buffer.isBuffer(rawKey)) {
    pushKey(rawKey);
    if (rawKey.length >= 32) pushKey(rawKey.subarray(0, 32));
    if (rawKey.length >= 24) pushKey(rawKey.subarray(0, 24));
    if (rawKey.length >= 16) pushKey(rawKey.subarray(0, 16));
    return candidates;
  }

  const s = String(rawKey ?? '');
  if (!s) {
    pushKey(Buffer.alloc(16, 0));
    return candidates;
  }

  const utf8 = Buffer.from(s, 'utf8');
  const latin1 = Buffer.from(s, 'latin1');

  for (const rawBuf of [utf8, latin1]) {
    if (rawBuf.length === 16 || rawBuf.length === 24 || rawBuf.length === 32) {
      pushKey(rawBuf);
    }
    if (rawBuf.length >= 32) {
      pushKey(rawBuf.subarray(0, 32));
      pushKey(rawBuf.subarray(0, 24));
      pushKey(rawBuf.subarray(0, 16));
    } else if (rawBuf.length >= 24) {
      pushKey(rawBuf.subarray(0, 24));
      pushKey(rawBuf.subarray(0, 16));
      const pad32 = Buffer.alloc(32, 0);
      rawBuf.copy(pad32);
      pushKey(pad32);
    } else if (rawBuf.length > 16) {
      pushKey(rawBuf.subarray(0, 16));
      const pad24 = Buffer.alloc(24, 0);
      rawBuf.copy(pad24);
      pushKey(pad24);
      const pad32 = Buffer.alloc(32, 0);
      rawBuf.copy(pad32);
      pushKey(pad32);
    } else if (rawBuf.length > 0 && rawBuf.length < 16) {
      const pad16 = Buffer.alloc(16, 0);
      rawBuf.copy(pad16);
      pushKey(pad16);
    }
  }

  if (/^[0-9a-fA-F]{32}$/.test(s) || /^[0-9a-fA-F]{48}$/.test(s) || /^[0-9a-fA-F]{64}$/.test(s)) {
    const hexBuf = Buffer.from(s, 'hex');
    pushKey(hexBuf);
    if (hexBuf.length > 16) pushKey(hexBuf.subarray(0, 16));
  }

  if (/^[A-Za-z0-9+/=]{20,48}$/.test(s)) {
    try {
      const b64 = Buffer.from(s, 'base64');
      pushKey(b64);
      if (b64.length > 16) pushKey(b64.subarray(0, 16));
    } catch {}
  }

  pushKey(crypto.createHash('md5').update(utf8).digest());
  const sha = crypto.createHash('sha256').update(utf8).digest();
  pushKey(sha);
  pushKey(sha.subarray(0, 16));

  return candidates;
}

function buildIvCandidates(rawIv, fallbackKeyBuf = null) {
  const candidates = [];
  const seen = new Set();
  const pushIv = (buf) => {
    if (!Buffer.isBuffer(buf) || buf.length < 16) return;
    const slice = buf.subarray(0, 16);
    const hex = slice.toString('hex');
    if (!seen.has(hex)) {
      seen.add(hex);
      candidates.push(slice);
    }
  };

  if (Buffer.isBuffer(rawIv)) {
    pushIv(rawIv);
  } else if (rawIv !== undefined && rawIv !== null && String(rawIv).length > 0) {
    const s = String(rawIv);
    const latin1 = Buffer.from(s, 'latin1');
    const utf8 = Buffer.from(s, 'utf8');
    if (latin1.length === 16) pushIv(latin1);
    if (utf8.length === 16) pushIv(utf8);
    if (/^[0-9a-fA-F]{32}$/.test(s)) {
      pushIv(Buffer.from(s, 'hex'));
    }
    if (s.endsWith('=') && /^[A-Za-z0-9+/=]{20,28}$/.test(s)) {
      try {
        const b64 = Buffer.from(s, 'base64');
        if (b64.length === 16) pushIv(b64);
      } catch {}
    }
    if (latin1.length > 16) pushIv(latin1.subarray(0, 16));
    if (utf8.length > 16) pushIv(utf8.subarray(0, 16));
    if (!s.endsWith('=') && /^[A-Za-z0-9+/=]{20,28}$/.test(s)) {
      try {
        const b64 = Buffer.from(s, 'base64');
        if (b64.length === 16) pushIv(b64);
      } catch {}
    }
    if (latin1.length > 0 && latin1.length < 16) {
      const pad = Buffer.alloc(16, 0);
      latin1.copy(pad);
      pushIv(pad);
    }
    pushIv(crypto.createHash('md5').update(utf8).digest());
  }

  if (Buffer.isBuffer(fallbackKeyBuf) && fallbackKeyBuf.length >= 16) {
    pushIv(fallbackKeyBuf.subarray(0, 16));
  }
  pushIv(Buffer.alloc(16, 0));
  return candidates;
}

function buildCiphertextCandidates(rawCipher) {
  const candidates = [];
  const seen = new Set();
  const pushBuf = (buf) => {
    if (!Buffer.isBuffer(buf) || buf.length === 0) return;
    const sig = `${buf.length}:${buf.subarray(0, 16).toString('hex')}`;
    if (!seen.has(sig)) {
      seen.add(sig);
      candidates.push(buf);
    }
  };

  if (Buffer.isBuffer(rawCipher)) {
    pushBuf(rawCipher);
    return candidates;
  }
  const s = String(rawCipher || '');
  if (!s) return candidates;

  // 1. Latin-1 binary string (most common inside JSON.stringify({ encryptedData, iv }))
  pushBuf(Buffer.from(s, 'latin1'));

  // 2. Base64 string
  const cleanB64 = s.replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/=_-]{8,}$/.test(cleanB64)) {
    try {
      pushBuf(Buffer.from(cleanB64, 'base64'));
    } catch {}
  }

  // 3. Hex string
  if (/^[0-9a-fA-F]{16,}$/.test(cleanB64) && cleanB64.length % 2 === 0) {
    try {
      pushBuf(Buffer.from(cleanB64, 'hex'));
    } catch {}
  }

  // 4. UTF-8 fallback
  pushBuf(Buffer.from(s, 'utf8'));

  return candidates;
}

function coerceKeyBuffer(rawKey, targetLen = 16) {
  const cands = buildKeyCandidates(rawKey);
  if (cands.length > 0) {
    const exact = cands.find((b) => b.length === targetLen);
    return exact || cands[0];
  }
  return Buffer.alloc(targetLen, 0);
}

function coerceIvBuffer(rawIv, fallbackKeyStr = '') {
  const keyBuf = fallbackKeyStr ? coerceKeyBuffer(fallbackKeyStr, 16) : null;
  const cands = buildIvCandidates(rawIv, keyBuf);
  return cands[0] || Buffer.alloc(16, 0);
}

function isDirectHlsUrl(urlStr) {
  return /\.m3u8(?:$|\?)|type=m3u8|application\/x-mpegurl/i.test(String(urlStr || ''));
}

function parseQualityScore(labelOrUrl) {
  const s = String(labelOrUrl || '').toLowerCase();
  if (s.includes('4k') || s.includes('2160')) return 2160;
  if (s.includes('2k') || s.includes('1440')) return 1440;
  if (s.includes('1080') || s.includes('fhd')) return 1080;
  if (s.includes('720') || s.includes('hd')) return 720;
  if (s.includes('480') || s.includes('sd')) return 480;
  if (s.includes('360')) return 360;
  return 0;
}

function buildFilenameSizeMap(rootObj) {
  const sizeMap = new Map();
  const metaMap = new Map();
  if (!rootObj || typeof rootObj !== 'object') return { sizeMap, metaMap };

  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 5) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }

    const rawUrlOrName =
      node.file ||
      node.url ||
      node.src ||
      node.media ||
      node.name ||
      node.filename ||
      node.path ||
      '';
    const rawSize = Number(
      node.size ?? node.fileSize ?? node.file_size ?? node.totalSize ?? node.length ?? 0
    );
    if (typeof rawUrlOrName === 'string' && rawUrlOrName.trim()) {
      const fname = extractFilenameFromUrl(rawUrlOrName);
      if (fname) {
        if (Number.isFinite(rawSize) && rawSize > 0 && !sizeMap.has(fname)) {
          sizeMap.set(fname, rawSize);
        }
        const prevMeta = metaMap.get(fname) || {};
        metaMap.set(fname, { ...prevMeta, ...node });
      }
    }

    for (const [k, v] of Object.entries(node)) {
      if (/\.(?:mp4|m3u8)$/i.test(k)) {
        const fname = extractFilenameFromUrl(k);
        if (typeof v === 'number' && v > 0) {
          sizeMap.set(fname, v);
        } else if (v && typeof v === 'object') {
          const sz = Number(v.size ?? v.fileSize ?? v.file_size ?? v.length ?? 0);
          if (Number.isFinite(sz) && sz > 0) sizeMap.set(fname, sz);
          metaMap.set(fname, { ...(metaMap.get(fname) || {}), ...v });
        }
      }
      if (v && typeof v === 'object') {
        visit(v, depth + 1);
      }
    }
  };

  visit(rootObj, 0);
  return { sizeMap, metaMap };
}

function extractEncryptionSpec(entryObj, rootObj, fallbackKeyStr = '', outerIvBuf = null) {
  const merged = { ...(rootObj && !Array.isArray(rootObj) ? rootObj : {}), ...(entryObj || {}) };
  const rawEncLimit = Number(
    merged.encSize ??
      merged.encryptSize ??
      merged.encryptedSize ??
      merged.encryptedLength ??
      merged.encryptedByteLength ??
      merged.enc_len ??
      merged.encrypt_size ??
      merged.headerSize ??
      merged.header_size ??
      0
  );
  const encLimit = Number.isFinite(rawEncLimit) && rawEncLimit > 0 ? rawEncLimit : Infinity;

  const hasExplicitKey = Boolean(merged.key || merged.aesKey || merged.decryptKey);
  const hasExplicitIv = Boolean(merged.iv || merged.aesIv || merged.counter);
  const hasSeedMeta = Boolean(merged.user_id || merged.md5_id || merged.slug);
  const isEncryptedFlag = Boolean(
    merged.encrypted ||
      merged.isEncrypted ||
      hasExplicitKey ||
      hasExplicitIv ||
      hasSeedMeta ||
      (Number.isFinite(rawEncLimit) && rawEncLimit > 0)
  );

  if (!isEncryptedFlag) return null;

  const seed =
    `${merged.user_id ?? ''}${merged.slug ?? ''}${merged.md5_id ?? ''}` || fallbackKeyStr;
  const rawKey = merged.key || merged.aesKey || merged.decryptKey || seed || fallbackKeyStr;
  const keyBuf = coerceKeyBuffer(rawKey, 16);

  let ivBuf;
  if (merged.iv || merged.aesIv || merged.counter) {
    ivBuf = coerceIvBuffer(merged.iv || merged.aesIv || merged.counter, String(rawKey));
  } else if (merged.md5_id || merged.slug || merged.user_id) {
    ivBuf = crypto
      .createHash('md5')
      .update(String(merged.md5_id || merged.slug || seed || 'iv'))
      .digest();
  } else if (Buffer.isBuffer(outerIvBuf) && outerIvBuf.length >= 16) {
    ivBuf = outerIvBuf.subarray(0, 16);
  } else {
    ivBuf = keyBuf.subarray(0, 16);
  }

  // Build candidate (key, iv) pairs for automatic MP4 ftyp header verification
  const keyPool = [
    keyBuf,
    ...buildKeyCandidates(rawKey),
    ...(seed ? buildKeyCandidates(seed) : []),
    ...(fallbackKeyStr ? buildKeyCandidates(fallbackKeyStr) : []),
  ];
  const ivPool = [
    ivBuf,
    ...(merged.md5_id ? buildIvCandidates(String(merged.md5_id), keyBuf) : []),
    ...(seed ? buildIvCandidates(seed, keyBuf) : []),
    ...(Buffer.isBuffer(outerIvBuf) && outerIvBuf.length >= 16
      ? [outerIvBuf.subarray(0, 16)]
      : []),
    Buffer.alloc(16, 0),
  ];
  if (seed && Buffer.from(seed, 'utf8').length >= 32) {
    ivPool.push(Buffer.from(seed, 'utf8').subarray(16, 32));
  }

  const dedupKeys = [];
  const seenK = new Set();
  for (const k of keyPool) {
    if (!Buffer.isBuffer(k)) continue;
    const h = k.toString('hex');
    if (!seenK.has(h)) {
      seenK.add(h);
      dedupKeys.push(k);
    }
  }
  const dedupIvs = [];
  const seenIv = new Set();
  for (const v of ivPool) {
    if (!Buffer.isBuffer(v) || v.length < 16) continue;
    const slice = v.subarray(0, 16);
    const h = slice.toString('hex');
    if (!seenIv.has(h)) {
      seenIv.add(h);
      dedupIvs.push(slice);
    }
  }

  const candidates = [];
  for (const k of dedupKeys.slice(0, 8)) {
    for (const v of dedupIvs.slice(0, 8)) {
      candidates.push({ key: k, iv: v });
    }
  }

  return {
    key: keyBuf,
    iv: ivBuf,
    encLimit,
    candidates,
  };
}

function parseOuterBase64Envelope(b64Str) {
  if (!b64Str || typeof b64Str !== 'string') return null;
  const cleaned = b64Str.trim();
  if (!cleaned) return null;

  if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
    try {
      return JSON.parse(cleaned);
    } catch {}
  }

  const rawBuf = Buffer.from(cleaned.replace(/\s+/g, ''), 'base64');
  if (rawBuf.length === 0) return null;

  // Decode outer Base64 using Latin-1 first (matching browser atob()), preserving raw 0x00..0xFF
  // binary bytes inside { encryptedData, iv } without UTF-8 U+FFFD replacement corruption.
  let latin1Obj = null;
  let utf8Obj = null;
  try {
    const strLatin1 = rawBuf.toString('latin1').trim();
    if (strLatin1.startsWith('{') || strLatin1.startsWith('[')) {
      latin1Obj = JSON.parse(strLatin1);
    }
  } catch {}

  try {
    const strUtf8 = rawBuf.toString('utf8').trim();
    if (strUtf8.startsWith('{') || strUtf8.startsWith('[')) {
      utf8Obj = JSON.parse(strUtf8);
    }
  } catch {}

  if (latin1Obj && typeof latin1Obj === 'object') {
    const hasBinaryCipher =
      latin1Obj.encryptedData !== undefined ||
      latin1Obj.cipherText !== undefined ||
      latin1Obj.ciphertext !== undefined ||
      latin1Obj.ct !== undefined;
    if (hasBinaryCipher || !utf8Obj) {
      return latin1Obj;
    }
  }

  return utf8Obj || latin1Obj;
}

function parseEncryptedEnvelope(
  rawObjOrStr,
  fallbackKeyStr = '',
  pageUrl = activeDomain,
  outerIvBuf = null
) {
  if (!rawObjOrStr) return null;
  let obj = rawObjOrStr;
  if (typeof obj === 'string') {
    const trimmed = obj.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      const u = unwrapNestedStreamUrl(trimmed, pageUrl);
      if (isDirectMediaUrl(u)) return { url: u };
    }
    const parsedOuter = parseOuterBase64Envelope(trimmed);
    if (parsedOuter) {
      obj = parsedOuter;
    } else {
      const m = /(https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)[^\s"'<>]*)/i.exec(trimmed);
      if (m && m[1]) {
        const u = unwrapNestedStreamUrl(m[1], pageUrl);
        if (isDirectMediaUrl(u)) return { url: u };
      }
      return null;
    }
  }

  if (!obj || typeof obj !== 'object') return null;

  // 1. Handle encrypted wrapper envelope: { encryptedData / data / cipherText, iv, key? }
  const rawCipherField = obj.encryptedData ?? obj.cipherText ?? obj.ciphertext ?? obj.ct;
  if (rawCipherField !== undefined && rawCipherField !== null) {
    const keySource = obj.key || fallbackKeyStr || '';
    if (typeof rawCipherField === 'string' && /^https?:\/\//i.test(rawCipherField.trim())) {
      const streamUrl = unwrapNestedStreamUrl(rawCipherField, pageUrl);
      if (streamUrl) {
        const aesSpec = extractEncryptionSpec(obj, obj, keySource, outerIvBuf);
        return {
          url: streamUrl,
          needsProxy: /\.mp4(?:$|\?)/i.test(streamUrl),
          aesCtr: aesSpec,
          size: Number(obj.size ?? obj.fileSize ?? 0) || 0,
        };
      }
    }

    const cipherCandidates = buildCiphertextCandidates(rawCipherField);
    const keyCandidates = buildKeyCandidates(keySource);
    for (const keyBuf of keyCandidates) {
      const ivCandidates = buildIvCandidates(obj.iv, keyBuf);
      for (const cipherBuf of cipherCandidates) {
        for (const ivBuf of ivCandidates) {
          const decText = tryDecryptBuffer(cipherBuf, keyBuf, ivBuf);
          if (decText) {
            const innerRes = parseEncryptedEnvelope(decText, keySource, pageUrl, ivBuf);
            if (innerRes && innerRes.url) {
              if (innerRes.needsProxy && !innerRes.aesCtr) {
                innerRes.aesCtr = { key: keyBuf, iv: ivBuf, encLimit: Infinity };
              }
              return innerRes;
            }
          }
        }
      }
    }
  }

  // 2. Collect candidate media sources from decrypted manifest object or array
  const { sizeMap, metaMap } = buildFilenameSizeMap(obj);
  const candidateEntries = [];
  const NON_STREAM_KEY_RE =
    /^(?:poster|thumb|thumbnail|cover|image|img|avatar|icon|logo|preview|trailer|teaser|vtt|srt|subtitle|subtitles|tracks|captions|title|name|slug|user_id|md5_id|id|key|aesKey|decryptKey|iv|aesIv|counter)$/i;

  const collectFromNode = (node, labelHint = '', depth = 0) => {
    if (!node || depth > 5) return;
    if (typeof node === 'string') {
      const u = unwrapNestedStreamUrl(node, pageUrl);
      if (isDirectMediaUrl(u)) {
        candidateEntries.push({ url: u, label: labelHint, raw: {} });
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        collectFromNode(item, labelHint, depth + 1);
      }
      return;
    }
    if (typeof node === 'object') {
      for (const field of [
        'media',
        'url',
        'videoUrl',
        'playUrl',
        'hlsUrl',
        'streamUrl',
        'file',
        'src',
      ]) {
        if (typeof node[field] === 'string' && node[field].trim()) {
          const u = unwrapNestedStreamUrl(node[field], pageUrl);
          if (isDirectMediaUrl(u)) {
            candidateEntries.push({
              url: u,
              label: String(node.label || node.quality || node.res || labelHint || ''),
              raw: node,
            });
          }
        }
      }
      for (const listField of [
        'sources',
        'video',
        'videos',
        'files',
        'urls',
        'streams',
        'qualities',
        'list',
        'data',
        'media',
        'backup',
      ]) {
        if (node[listField] && typeof node[listField] === 'object') {
          collectFromNode(node[listField], labelHint || listField, depth + 1);
        }
      }
      for (const [k, v] of Object.entries(node)) {
        if (/\.(?:mp4|m3u8)(?:$|\?)/i.test(k) && /^https?:\/\/|^\/\//i.test(k)) {
          const u = unwrapNestedStreamUrl(k, pageUrl);
          if (isDirectMediaUrl(u)) {
            const rawMeta =
              typeof v === 'number' && v > 0
                ? { size: v }
                : v && typeof v === 'object'
                ? v
                : {};
            candidateEntries.push({ url: u, label: k, raw: rawMeta });
          }
        }
        if (NON_STREAM_KEY_RE.test(k)) continue;
        if (typeof v === 'string') {
          const u = unwrapNestedStreamUrl(v, pageUrl);
          if (isDirectMediaUrl(u)) {
            candidateEntries.push({ url: u, label: k || labelHint, raw: node });
          }
        } else if (v && typeof v === 'object') {
          collectFromNode(v, k || labelHint, depth + 1);
        }
      }
    }
  };

  collectFromNode(obj, '', 0);

  // Fallback: if obj has a base media URL and sizeMap has .mp4/.m3u8 filenames, join them
  if (candidateEntries.length === 0 && sizeMap.size > 0 && typeof obj === 'object') {
    const baseStr = String(
      obj.media || obj.cdn || obj.domain || obj.host || obj.baseUrl || obj.server || ''
    ).trim();
    if (/^https?:\/\//i.test(baseStr)) {
      const cleanBase = baseStr.replace(/\/+$/, '');
      for (const [fname, fsize] of sizeMap.entries()) {
        const joined = `${cleanBase}/${fname.replace(/^\/+/, '')}`;
        if (isDirectMediaUrl(joined)) {
          candidateEntries.push({
            url: joined,
            label: fname,
            raw: { ...(metaMap.get(fname) || {}), size: fsize },
          });
        }
      }
    }
  }

  if (candidateEntries.length > 0) {
    candidateEntries.sort((a, b) => {
      const qa = Math.max(parseQualityScore(a.label), parseQualityScore(a.url));
      const qb = Math.max(parseQualityScore(b.label), parseQualityScore(b.url));
      return qb - qa;
    });

    const chosen = candidateEntries[0];
    const fname = extractFilenameFromUrl(chosen.url);
    const secondaryMeta = (fname && metaMap.get(fname)) || {};
    const combinedEntry = { ...secondaryMeta, ...chosen.raw };

    const rawSize = Number(
      combinedEntry.size ??
        combinedEntry.fileSize ??
        combinedEntry.file_size ??
        (fname ? sizeMap.get(fname) : 0) ??
        obj.size ??
        obj.fileSize ??
        0
    );
    const resolvedSize = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : 0;

    const aesSpec = extractEncryptionSpec(combinedEntry, obj, fallbackKeyStr, outerIvBuf);
    const isEncryptedMp4 = Boolean(aesSpec) && !isDirectHlsUrl(chosen.url);

    return {
      url: chosen.url,
      needsProxy: isEncryptedMp4,
      aesCtr: isEncryptedMp4 ? aesSpec : null,
      size: resolvedSize,
      filename: fname,
    };
  }

  return null;
}

function extractEncryptedManifestFromHtml(html, pageUrl = activeDomain) {
  if (!html || typeof html !== 'string') return null;

  const varMap = new Map();
  const strVarRegex =
    /\b(?:const|let|var)?\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:CryptoJS\.enc\.(?:Utf8|Latin1|Hex|Base64)\.parse\(\s*|new\s+TextEncoder\(\)\.encode\(\s*|atob\(\s*)?(['"`])((?:\\.|(?!\2)[\s\S])*?)\2\s*\)?/g;
  let vm;
  while ((vm = strVarRegex.exec(html)) !== null) {
    const varName = vm[1];
    if (varName === 'return' || varName === 'case' || varName === 'typeof') continue;
    varMap.set(varName, unescapeJsStringLiteral(vm[3]));
  }

  const resolveArg = (rawArg) => {
    const s = String(rawArg || '').trim();
    if (!s) return '';
    const lit = /^(['"`])([\s\S]*)\1$/.exec(s);
    if (lit) return unescapeJsStringLiteral(lit[2]);
    const wrappedCall =
      /(?:(?:Utf8|Latin1|Hex|Base64)\.parse|TextEncoder\(\)\.encode|atob)\(\s*(['"`])([\s\S]*?)\1\s*\)/.exec(
        s
      );
    if (wrappedCall) return unescapeJsStringLiteral(wrappedCall[2]);
    const wrappedVar =
      /(?:(?:Utf8|Latin1|Hex|Base64)\.parse|TextEncoder\(\)\.encode|atob)\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)/.exec(
        s
      );
    if (wrappedVar && varMap.has(wrappedVar[1])) {
      return varMap.get(wrappedVar[1]);
    }
    if (varMap.has(s)) return varMap.get(s);
    return s;
  };

  // Discover potential script-wide fallback keys (variables + inline CryptoJS / TextEncoder / Uint8Array keys)
  const fallbackKeys = [];
  const pushFallbackKey = (val) => {
    if (!val) return;
    if (typeof val === 'string') {
      const clean = val.trim();
      if (clean && !fallbackKeys.includes(clean)) {
        fallbackKeys.push(clean);
      }
    } else if (Buffer.isBuffer(val) && val.length > 0) {
      fallbackKeys.push(val);
    }
  };

  for (const [kName, kVal] of varMap.entries()) {
    if (/key|secret|pass|token|aes|dec|cipher/i.test(kName) && kVal) {
      pushFallbackKey(kVal);
    }
  }

  const inlineKeyRegex =
    /(?:CryptoJS\.enc\.(?:Utf8|Latin1|Hex|Base64)\.parse|new\s+TextEncoder\(\)\.encode)\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1\s*\)/g;
  let ikm;
  while ((ikm = inlineKeyRegex.exec(html)) !== null) {
    pushFallbackKey(unescapeJsStringLiteral(ikm[2]));
  }

  const uint8KeyRegex = /new\s+Uint8Array\(\s*\[\s*([0-9,\s]{16,300})\s*\]\s*\)/g;
  let ukm;
  while ((ukm = uint8KeyRegex.exec(html)) !== null) {
    const nums = ukm[1]
      .split(',')
      .map((n) => parseInt(n.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 255);
    if (nums.length === 16 || nums.length === 24 || nums.length === 32) {
      pushFallbackKey(Buffer.from(nums));
    }
  }

  for (const [, kVal] of varMap.entries()) {
    if (typeof kVal === 'string' && kVal.length >= 8 && kVal.length <= 64 && !/\s/.test(kVal)) {
      pushFallbackKey(kVal);
    }
  }

  const tryDecryptDataWithKeys = (dataStr, explicitKeyStr = '') => {
    const keysToTry = [explicitKeyStr, ...fallbackKeys, ''].filter(
      (v, idx, arr) => arr.indexOf(v) === idx
    );

    for (const keyStr of keysToTry) {
      const directEnv = parseEncryptedEnvelope(dataStr, keyStr, pageUrl);
      if (directEnv && directEnv.url) return directEnv;

      try {
        const cipherCandidates = buildCiphertextCandidates(dataStr);
        const keyCandidates = buildKeyCandidates(keyStr);
        for (const kBuf of keyCandidates) {
          for (const cipherBuf of cipherCandidates) {
            const ivCandidates = buildIvCandidates(null, kBuf);
            if (cipherBuf.length > 16) {
              ivCandidates.unshift(cipherBuf.subarray(0, 16));
            }
            for (const ivBuf of ivCandidates) {
              const dec1 = tryDecryptBuffer(cipherBuf, kBuf, ivBuf);
              if (dec1) {
                const env = parseEncryptedEnvelope(dec1, keyStr, pageUrl, ivBuf);
                if (env && env.url) return env;
              }
              if (cipherBuf.length > 16) {
                const prefixIv = cipherBuf.subarray(0, 16);
                const dec2 = tryDecryptBuffer(
                  cipherBuf.subarray(16),
                  kBuf,
                  prefixIv
                );
                if (dec2) {
                  const env = parseEncryptedEnvelope(dec2, keyStr, pageUrl, prefixIv);
                  if (env && env.url) return env;
                }
              }
            }
          }
        }
      } catch {}
    }
    return null;
  };

  const callPrefixRegex = /\b(?:decryptDatas?|decrypt|decodeDatas?)\s*\(/g;
  let cm;
  while ((cm = callPrefixRegex.exec(html)) !== null) {
    const before = html.slice(Math.max(0, cm.index - 25), cm.index);
    if (/\bfunction\s*$/.test(before)) {
      continue;
    }
    const openParenIdx = cm.index + cm[0].length - 1;
    const balanced = extractBalancedParens(html, openParenIdx);
    if (!balanced || balanced.args.length === 0) continue;

    const dataStr = resolveArg(balanced.args[0]);
    const explicitKeyStr = balanced.args[1] ? resolveArg(balanced.args[1]) : '';
    if (
      !dataStr ||
      (dataStr === balanced.args[0] &&
        /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(dataStr) &&
        !varMap.has(dataStr))
    ) {
      continue;
    }

    const res = tryDecryptDataWithKeys(dataStr, explicitKeyStr);
    if (res && res.url) return res;
  }

  // Fallback: scan for standalone Base64 JSON envelopes ("eyJ...") in the script
  const b64EnvRegex = /(['"`])(eyJ[A-Za-z0-9+/=_-]{24,})\1/g;
  let bm;
  while ((bm = b64EnvRegex.exec(html)) !== null) {
    const b64Candidate = bm[2];
    const parsedOuter = parseOuterBase64Envelope(b64Candidate);
    if (
      parsedOuter &&
      typeof parsedOuter === 'object' &&
      (parsedOuter.encryptedData !== undefined ||
        parsedOuter.cipherText !== undefined ||
        parsedOuter.ciphertext !== undefined ||
        parsedOuter.ct !== undefined ||
        parsedOuter.media !== undefined ||
        parsedOuter.sources !== undefined)
    ) {
      const res = tryDecryptDataWithKeys(b64Candidate, '');
      if (res && res.url) return res;
    }
  }

  return null;
}

function extractStreamDescriptorFromPageHtml(
  html,
  pageUrl = activeDomain,
  { allowGenericMediaScan = true } = {}
) {
  if (!html || typeof html !== 'string') return null;
  const unpacked = unpackDeanEdwards(html);
  const combined = unpacked ? `${html}\n${unpacked}` : html;
  const normHtml = normalizeEscapedSlashes(combined);

  // Stage 0: Encrypted manifest calls (decryptDatas / AES-CTR / AES-CBC envelopes)
  const encRes =
    extractEncryptedManifestFromHtml(combined, pageUrl) ||
    extractEncryptedManifestFromHtml(normHtml, pageUrl);
  if (encRes && encRes.url) {
    return encRes;
  }

  // Build lookup of script string variables for indirect player config references
  const scriptVars = new Map();
  const varAssignRegex =
    /\b(?:const|let|var)?\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:atob\(\s*)?(['"`])([^'"`\r\n]+)\2\s*\)?/g;
  let vam;
  while ((vam = varAssignRegex.exec(normHtml)) !== null) {
    let val = vam[3];
    if (/^aHR0c/i.test(val) && /^[A-Za-z0-9+/=]+$/.test(val)) {
      try {
        val = Buffer.from(val, 'base64').toString('utf8');
      } catch {}
    }
    scriptVars.set(vam[1], val);
  }

  // Stage 1: Artplayer configuration (primary mechanism in javheo)
  const artInitRegex = /new\s+Artplayer\s*\(/gi;
  let aim;
  while ((aim = artInitRegex.exec(normHtml)) !== null) {
    const artJson = extractBalancedJson(normHtml, aim.index + aim[0].length);
    const artScope = artJson || normHtml.slice(aim.index, aim.index + 2500);

    const artCandidates = [];
    const urlPropRegex = /\burl\s*:\s*(?:(['"`])([^'"`]+)\1|([A-Za-z_$][A-Za-z0-9_$]*))/gi;
    let upm;
    while ((upm = urlPropRegex.exec(artScope)) !== null) {
      const rawVal = upm[2] || (upm[3] && scriptVars.get(upm[3])) || '';
      if (!rawVal) continue;
      const candidate = unwrapNestedStreamUrl(rawVal, pageUrl);
      if (
        !candidate ||
        NON_VIDEO_ASSET_RE.test(candidate) ||
        AD_OR_DECOY_MEDIA_RE.test(candidate)
      ) {
        continue;
      }
      if (isDirectMediaUrl(candidate)) {
        const ctx = artScope.slice(Math.max(0, upm.index - 80), Math.min(artScope.length, upm.index + 120));
        artCandidates.push({
          url: candidate,
          score: Math.max(parseQualityScore(candidate), parseQualityScore(ctx)),
        });
      }
    }
    if (artCandidates.length > 0) {
      artCandidates.sort((a, b) => b.score - a.score);
      return { url: artCandidates[0].url };
    }
  }

  // Stage 2: CMS player config objects (player_aaaa / player_data / player_config)
  const playerVarRegex = /\b(?:player_aaaa|player_data|player_config)\s*=\s*/g;
  let pm;
  while ((pm = playerVarRegex.exec(combined)) !== null) {
    const jsonText = extractBalancedJson(combined, pm.index + pm[0].length);
    if (!jsonText) continue;
    try {
      const cfg = JSON.parse(jsonText);
      let rawUrl = String(cfg.url || '').trim();
      if (!rawUrl || /^(?:none|null|undefined)$/i.test(rawUrl)) continue;
      const enc = Number(cfg.encrypt || 0);
      if (enc === 1) {
        rawUrl = customUnescape(rawUrl);
      } else if (enc === 2) {
        const b64 = Buffer.from(rawUrl, 'base64').toString('utf8');
        try {
          rawUrl = decodeURIComponent(b64);
        } catch {
          rawUrl = customUnescape(b64);
        }
      } else {
        rawUrl = normalizeEscapedSlashes(rawUrl);
      }
      const resolved = unwrapNestedStreamUrl(rawUrl, pageUrl);
      if (isDirectMediaUrl(resolved)) {
        return { url: resolved };
      }
    } catch {}
  }

  // Stage 3A: High-priority player setup calls
  const highPriorityRegex =
    /(?:\bhls\.loadSource\s*\(\s*["']([^"']+)["']|\b(?:hlsUrl|streamUrl|m3u8Url|realPlayUrl|vipPlayUrl|mainPlayUrl|m3u8_url|hls_url|stream_url|video_url|play_url)\s*[:=]\s*["']([^"']+)["'])/gi;
  let hpm;
  while ((hpm = highPriorityRegex.exec(normHtml)) !== null) {
    const rawCandidate = hpm[1] || hpm[2];
    const candidate = unwrapNestedStreamUrl(rawCandidate, pageUrl);
    if (isDirectMediaUrl(candidate)) {
      return { url: candidate };
    }
  }

  if (!allowGenericMediaScan) {
    return null;
  }

  // Stage 3B: Secondary player properties/variables
  const propRegex =
    /\b([A-Za-z0-9_$]*(?:videoUrl|playUrl|normalPlayUrl|file|url))\s*[:=]\s*["']((?:https?:\/\/|\/\/|\/)[^"'\\\s]+)["']/gi;
  let prm;
  while ((prm = propRegex.exec(normHtml)) !== null) {
    const propName = prm[1].toLowerCase();
    if (
      propName.includes('free') ||
      propName.includes('preview') ||
      propName.includes('trailer') ||
      propName.includes('thumb') ||
      propName.includes('poster')
    ) {
      continue;
    }
    const candidate = unwrapNestedStreamUrl(prm[2], pageUrl);
    if (isDirectMediaUrl(candidate)) {
      return { url: candidate };
    }
  }

  // Stage 4: Direct <video> / <source> tag extraction (filtering preview/trailer clips)
  const sourceCandidates = [];
  const sourceRegex = /<(?:video|source)\b[^>]+?\b(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
  let sm;
  while ((sm = sourceRegex.exec(normHtml)) !== null) {
    const candidate = unwrapNestedStreamUrl(sm[1], pageUrl);
    if (isDirectMediaUrl(candidate)) {
      sourceCandidates.push({
        url: candidate,
        score: Math.max(parseQualityScore(candidate), parseQualityScore(sm[0])),
      });
    }
  }
  if (sourceCandidates.length > 0) {
    sourceCandidates.sort((a, b) => b.score - a.score);
    return { url: sourceCandidates[0].url };
  }

  // Stage 5: Direct .m3u8 / .mp4 regex scan across normalized HTML
  const directMediaRegex =
    /((?:https?:)?\/\/[A-Za-z0-9._~:/?#[\]@!$&()*+,;=%-]+\.(?:m3u8|mp4)(?:(?:\?|%3[fF]|&)[A-Za-z0-9._~:/?#[\]@!$&()*+,;=%-]*)?)/gi;
  let dm;
  while ((dm = directMediaRegex.exec(normHtml)) !== null) {
    const candidate = unwrapNestedStreamUrl(dm[1], pageUrl);
    if (isDirectMediaUrl(candidate)) {
      return { url: candidate };
    }
  }

  return null;
}

function extractStreamFromPageHtml(html, pageUrl = activeDomain) {
  const desc = extractStreamDescriptorFromPageHtml(html, pageUrl);
  return desc ? desc.url : '';
}

function extractCandidateIframeUrls(html, baseUrl = activeDomain) {
  if (!html || typeof html !== 'string') return [];
  const norm = normalizeEscapedSlashes(html);
  const results = [];
  const seen = new Set();

  const pushCandidate = (raw) => {
    const normalized = normalizeUrl(raw, baseUrl);
    if (!normalized) return;
    if (AD_IFRAME_RE.test(normalized) || NON_VIDEO_ASSET_RE.test(normalized)) return;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      results.push(normalized);
    }
  };

  const iframeTagRegex = /<(?:iframe|embed)\b[^>]*>/gi;
  let tm;
  while ((tm = iframeTagRegex.exec(norm)) !== null) {
    const tag = tm[0];
    const attrs = ['data-litespeed-src', 'data-lazy-src', 'data-src', 'src'];
    for (const attr of attrs) {
      const m = new RegExp(`\\b${attr}=["']([^"']+)["']`, 'i').exec(tag);
      if (m && m[1]) {
        pushCandidate(m[1]);
      }
    }
  }

  const playerVarRegex = /\b(?:player_aaaa|player_data|player_config)\s*=\s*/g;
  let pm;
  while ((pm = playerVarRegex.exec(norm)) !== null) {
    const jsonText = extractBalancedJson(norm, pm.index + pm[0].length);
    if (!jsonText) continue;
    try {
      const cfg = JSON.parse(jsonText);
      let rawUrl = String(cfg.url || '').trim();
      if (!rawUrl || /^(?:none|null|undefined)$/i.test(rawUrl)) continue;
      if (/^(?:https?:\/\/|\/\/|\/)/i.test(rawUrl)) {
        pushCandidate(rawUrl);
      }
    } catch {}
  }

  // Check if the response itself is a JSON object with an iframe/embed URL
  const trimmed = norm.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      for (const k of ['iframe', 'embed', 'url', 'src', 'playUrl']) {
        if (typeof parsed[k] === 'string' && /^(?:https?:\/\/|\/\/|\/)/i.test(parsed[k].trim())) {
          pushCandidate(parsed[k].trim());
        }
      }
    } catch {}
  }

  return results;
}

function sanitizeEpisodeInput(rawInput) {
  let s = String(rawInput || '').trim();
  let metaSuffix = '';
  if (!s) return { clean: '', meta: '' };

  if (s.includes('@@@')) {
    const parts = s.split('@@@');
    s = parts[0].trim();
    metaSuffix = parts.slice(1).join('@@@').trim();
  }

  if (s.includes('$')) {
    const idx = s.indexOf('$');
    const prefix = s.slice(0, idx).trim();
    if (!/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
      s = s.slice(idx + 1).trim();
    }
  }

  return { clean: s, meta: metaSuffix };
}

function extractWidFromInput(rawInput) {
  const { clean } = sanitizeEpisodeInput(rawInput);
  if (!clean) return '';
  const watchMatch = /\/watch\/([A-Za-z0-9_%.-]+?)(?:\/|$|\?|#)/i.exec(clean);
  if (watchMatch && watchMatch[1]) {
    return watchMatch[1];
  }
  const videoMatch = /\/video\/([A-Za-z0-9_%.-]+?)(?:\/|$|\?|#)/i.exec(clean);
  if (videoMatch && videoMatch[1]) {
    return videoMatch[1];
  }
  return clean;
}

function buildDetailPathFromInput(rawInput) {
  const { clean } = sanitizeEpisodeInput(rawInput);
  if (!clean) return '';
  if (/^https?:\/\//i.test(clean)) {
    if (isKnownSiteHost(clean)) {
      try {
        const u = new URL(clean);
        return `${u.pathname}${u.search}`;
      } catch {}
    }
    return clean;
  }
  if (clean.startsWith('/')) {
    return clean;
  }
  return `/watch/${clean}`;
}

async function resolveIframeChain(startHtml, startReferer, visited = new Set(), depth = 0) {
  if (!startHtml || depth >= 5) return null;

  const iframeCandidates = extractCandidateIframeUrls(startHtml, startReferer);
  for (const iframeUrl of iframeCandidates) {
    if (visited.has(iframeUrl)) continue;
    visited.add(iframeUrl);

    const unwrappedIframe = unwrapNestedStreamUrl(iframeUrl, startReferer);
    if (unwrappedIframe !== iframeUrl && isDirectMediaUrl(unwrappedIframe)) {
      return {
        url: unwrappedIframe,
        referer: iframeUrl,
        needsProxy: false,
        aesCtr: null,
        size: 0,
      };
    }

    const nextRes = await fetchPage(iframeUrl, { referer: startReferer });
    if (!nextRes || !nextRes.text) continue;
    const effectiveUrl = nextRes.finalUrl || iframeUrl;

    const desc = extractStreamDescriptorFromPageHtml(nextRes.text, effectiveUrl);
    if (desc && desc.url) {
      return {
        url: desc.url,
        referer: effectiveUrl,
        needsProxy: Boolean(desc.needsProxy),
        aesCtr: desc.aesCtr || null,
        size: Number(desc.size || 0),
      };
    }

    const deeper = await resolveIframeChain(nextRes.text, effectiveUrl, visited, depth + 1);
    if (deeper && deeper.url) {
      return deeper;
    }
  }

  return null;
}

function extractHashJavheoPayloadsFromHtml(detailHtml, wid) {
  const payloads = [];
  const seen = new Set();
  const addPayload = (mix, num) => {
    if (!mix || !num) return;
    const key = `${mix}|${num}`;
    if (!seen.has(key)) {
      seen.add(key);
      payloads.push({ mix, num });
    }
  };

  if (detailHtml && typeof detailHtml === 'string') {
    const ajaxObjRegex =
      /\{\s*mix\s*:\s*['"]([^'"]+)['"]\s*,\s*(?:num|value)\s*:\s*['"]([^'"]+)['"]/gi;
    let m;
    while ((m = ajaxObjRegex.exec(detailHtml)) !== null) {
      if (!/video-next/i.test(m[1])) {
        addPayload(m[1], m[2]);
      }
    }
  }

  addPayload('moviesiframe2', wid);
  addPayload('moviesiframe', wid);
  return payloads;
}

async function resolvePlay(rawInput, existingDetailPage = null) {
  const wid = extractWidFromInput(rawInput);
  if (!wid) return null;

  const cached = PLAY_CACHE.get(wid);
  if (cached && Date.now() - cached.ts < PLAY_CACHE_TTL) {
    return cached;
  }

  const detailPath = buildDetailPathFromInput(rawInput) || `/watch/${wid}`;
  let detailRes = existingDetailPage;
  if (!detailRes || typeof detailRes === 'string') {
    if (typeof existingDetailPage === 'string' && existingDetailPage.length > 0) {
      detailRes = {
        text: existingDetailPage,
        finalUrl: `${activeDomain}${detailPath.startsWith('/') ? detailPath : `/watch/${wid}`}`,
      };
    } else {
      detailRes = await fetchPage(detailPath);
    }
  }
  if (!detailRes || !detailRes.text) return null;

  const detailHtml = detailRes.text;
  const detailUrl = detailRes.finalUrl || `${activeDomain}/watch/${wid}`;

  const cacheAndReturn = (resolved) => {
    const entry = {
      url: resolved.url,
      referer: resolved.referer || detailUrl,
      needsProxy: Boolean(resolved.needsProxy),
      aesCtr: resolved.aesCtr || null,
      size: Number(resolved.size || 0),
      ts: Date.now(),
    };
    PLAY_CACHE.set(wid, entry);
    return entry;
  };

  // 1. Check high-confidence player configs (decryptDatas / Artplayer / player_aaaa) on detail page
  const highConfidenceDesc = extractStreamDescriptorFromPageHtml(detailHtml, detailUrl, {
    allowGenericMediaScan: false,
  });
  if (highConfidenceDesc && highConfidenceDesc.url) {
    return cacheAndReturn({ ...highConfidenceDesc, referer: detailUrl });
  }

  const visitedIframes = new Set();

  // 2. Request the player iframe container via POST /hash-javheo
  const hashPayloads = extractHashJavheoPayloadsFromHtml(detailHtml, wid);
  for (const payload of hashPayloads) {
    const postRes = await fetchPage('/hash-javheo', {
      data: payload,
      referer: detailUrl,
    });
    if (!postRes || !postRes.text) continue;

    const postReferer = postRes.finalUrl
      ? `${getHostOrigin(postRes.finalUrl)}/watch/${wid}`
      : detailUrl;
    const postDesc = extractStreamDescriptorFromPageHtml(postRes.text, postReferer);
    if (postDesc && postDesc.url) {
      return cacheAndReturn({ ...postDesc, referer: postReferer });
    }

    const fromPostIframes = await resolveIframeChain(
      postRes.text,
      postReferer,
      visitedIframes,
      0
    );
    if (fromPostIframes && fromPostIframes.url) {
      return cacheAndReturn(fromPostIframes);
    }
  }

  // 3. Check iframes embedded directly on the detail page
  const fromDetailIframes = await resolveIframeChain(
    detailHtml,
    detailUrl,
    visitedIframes,
    0
  );
  if (fromDetailIframes && fromDetailIframes.url) {
    return cacheAndReturn(fromDetailIframes);
  }

  // 4. Fallback: check alternate play routes discovered on detail page
  const altRouteRegex = /href=["']((?:https?:\/\/[^/"']+)?\/(?:vodplay|play)\/[^"']+)["']/gi;
  let arm;
  while ((arm = altRouteRegex.exec(detailHtml)) !== null) {
    const altPath = arm[1];
    if (visitedIframes.has(altPath)) continue;
    visitedIframes.add(altPath);
    const altRes = await fetchPage(altPath, { referer: detailUrl });
    if (!altRes || !altRes.text) continue;
    const altUrl = altRes.finalUrl || normalizeUrl(altPath, detailUrl);
    const altDesc = extractStreamDescriptorFromPageHtml(altRes.text, altUrl);
    if (altDesc && altDesc.url) {
      return cacheAndReturn({ ...altDesc, referer: altUrl });
    }
  }

  // 5. Final fallback: full scan (including <video> / .mp4 regex) on detail page
  const fallbackDesc = extractStreamDescriptorFromPageHtml(detailHtml, detailUrl, {
    allowGenericMediaScan: true,
  });
  if (fallbackDesc && fallbackDesc.url) {
    return cacheAndReturn({ ...fallbackDesc, referer: detailUrl });
  }

  return null;
}

function deriveRoutePrefix(inReq) {
  if (inReq?.server?.prefix) {
    return String(inReq.server.prefix).replace(/\/+$/, '');
  }
  const rawUrl = String(inReq?.raw?.url || inReq?.url || '').split('?')[0];
  if (rawUrl) {
    return rawUrl
      .replace(/\/(?:play|detail|category|home|homeVod|search|init)\/?$/i, '')
      .replace(/\/+$/, '');
  }
  return '';
}

function isLoopbackHost(hostHeader) {
  if (!hostHeader) return true;
  const h = String(hostHeader).replace(/^https?:\/\//i, '').split('/')[0].split(':')[0].toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1';
}

async function ensureLocalProxyServer() {
  if (localProxyServer && localProxyPort > 0) {
    return localProxyPort;
  }
  return new Promise((resolve) => {
    const srv = http.createServer(async (reqIncoming, resOutgoing) => {
      try {
        const parsed = new URL(reqIncoming.url || '/', 'http://127.0.0.1');
        const q = {};
        for (const [k, v] of parsed.searchParams.entries()) {
          q[k] = v;
        }
        const fakeReq = {
          method: reqIncoming.method || 'GET',
          url: reqIncoming.url || '/',
          raw: reqIncoming,
          query: q,
          headers: reqIncoming.headers || {},
        };
        const resState = {
          statusCode: 200,
          headers: {},
        };
        const fakeReply = {
          code(c) {
            resState.statusCode = c;
            return this;
          },
          type(t) {
            resState.headers['Content-Type'] = t;
            return this;
          },
          header(k, v) {
            resState.headers[k] = v;
            return this;
          },
          send(payload) {
            if (!resOutgoing.headersSent) {
              resOutgoing.writeHead(resState.statusCode, resState.headers);
            }
            if (reqIncoming.method === 'HEAD' || payload === undefined || payload === null) {
              resOutgoing.end();
            } else if (Buffer.isBuffer(payload) || typeof payload === 'string') {
              resOutgoing.end(payload);
            } else {
              resOutgoing.end(String(payload));
            }
            return this;
          },
        };
        await handleProxyStream(fakeReq, fakeReply);
      } catch (err) {
        if (!resOutgoing.headersSent) {
          resOutgoing.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        }
        resOutgoing.end(String(err?.message || 'Proxy error'));
      }
    });

    srv.on('error', () => resolve(0));
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object' && addr.port) {
        localProxyServer = srv;
        localProxyPort = addr.port;
        if (typeof srv.unref === 'function') {
          srv.unref();
        }
        resolve(localProxyPort);
      } else {
        resolve(0);
      }
    });
  });
}

async function buildFastifyProxyUrl(inReq, resEntry) {
  const token = crypto
    .createHash('md5')
    .update(`${resEntry.url}|${Date.now()}|${Math.random()}`)
    .digest('hex');
  const effectiveReferer = resEntry.referer || `${activeDomain}/`;
  const effectiveSize = Number(resEntry.size || 0);
  PROXY_STREAM_CACHE.set(token, {
    url: resEntry.url,
    referer: effectiveReferer,
    aesCtr: resEntry.aesCtr || null,
    size: effectiveSize,
    ts: Date.now(),
  });

  let extraQuery = `&referer=${encodeURIComponent(effectiveReferer)}`;
  if (effectiveSize > 0) {
    extraQuery += `&size=${effectiveSize}`;
  }
  if (resEntry.aesCtr?.key && resEntry.aesCtr?.iv) {
    extraQuery += `&k=${resEntry.aesCtr.key.toString('hex')}&iv=${resEntry.aesCtr.iv.toString('hex')}`;
    if (
      typeof resEntry.aesCtr.encLimit === 'number' &&
      Number.isFinite(resEntry.aesCtr.encLimit)
    ) {
      extraQuery += `&el=${resEntry.aesCtr.encLimit}`;
    }
  }

  const endpoint = isDirectHlsUrl(resEntry.url) ? 'proxy.m3u8' : 'proxy.mp4';
  const prefix = deriveRoutePrefix(inReq);
  const rawHost =
    inReq?.headers?.['x-forwarded-host'] ||
    inReq?.headers?.host ||
    inReq?.hostname ||
    '';

  const hasExplicitPort = /:\d+$/.test(String(rawHost));
  const canUseFastifyRoute = Boolean(fastifyRoutesRegistered || inReq?.server);
  if (
    !canUseFastifyRoute ||
    (!prefix && (!rawHost || (isLoopbackHost(rawHost) && !hasExplicitPort)))
  ) {
    const port = await ensureLocalProxyServer();
    if (port > 0) {
      return `http://127.0.0.1:${port}/${endpoint}?token=${token}&url=${encodeURIComponent(
        resEntry.url
      )}${extraQuery}`;
    }
  }

  const host = rawHost || '127.0.0.1';
  const proto = inReq?.headers?.['x-forwarded-proto'] || inReq?.protocol || 'http';
  const baseHost = /^https?:\/\//i.test(host) ? host : `${proto}://${host}`;
  return `${baseHost.replace(/\/+$/, '')}${prefix}/${endpoint}?token=${token}&url=${encodeURIComponent(
    resEntry.url
  )}${extraQuery}`;
}

function isMp4BoxHeader(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return false;
  const boxType = buf.subarray(4, 8).toString('ascii');
  return /^(?:ftyp|moov|mdat|free|skip|wide|styp|pdin|uuid)$/.test(boxType);
}

function decryptAesCtrRawBlock(cipherBuf, keyBuf, ivBuf, startByteOffset = 0) {
  if (!keyBuf || !ivBuf || !Buffer.isBuffer(cipherBuf) || cipherBuf.length === 0) {
    return cipherBuf;
  }
  const blockIndex = Math.floor(startByteOffset / 16);
  const byteOffsetInBlock = startByteOffset % 16;

  const counterBuf = Buffer.from(ivBuf.subarray(0, 16));
  let carry = blockIndex;
  for (let i = 15; i >= 0 && carry > 0; i -= 1) {
    const sum = counterBuf[i] + (carry & 0xff);
    counterBuf[i] = sum & 0xff;
    carry = Math.floor(carry / 256) + (sum >> 8);
  }

  const paddedInput = Buffer.concat([Buffer.alloc(byteOffsetInBlock, 0), cipherBuf]);
  const alg =
    keyBuf.length === 32
      ? 'aes-256-ctr'
      : keyBuf.length === 24
      ? 'aes-192-ctr'
      : 'aes-128-ctr';
  const decipher = crypto.createDecipheriv(alg, keyBuf, counterBuf);
  decipher.setAutoPadding(false);
  const dec = Buffer.concat([decipher.update(paddedInput), decipher.final()]);
  return dec.subarray(byteOffsetInBlock);
}

function decryptAesCtrSlice(
  cipherBuf,
  keyBuf,
  ivBuf,
  startByteOffset = 0,
  encLimit = Infinity
) {
  if (!keyBuf || !ivBuf || !Buffer.isBuffer(cipherBuf) || cipherBuf.length === 0) {
    return cipherBuf;
  }
  const limit =
    typeof encLimit === 'number' && Number.isFinite(encLimit) && encLimit > 0
      ? encLimit
      : Infinity;

  if (startByteOffset >= limit) {
    return cipherBuf;
  }
  const endByteOffset = startByteOffset + cipherBuf.length;
  if (endByteOffset <= limit) {
    return decryptAesCtrRawBlock(cipherBuf, keyBuf, ivBuf, startByteOffset);
  }

  // Cross-boundary slice straddling encrypted [0, limit) and plaintext [limit, ...)
  const encryptedPortionLen = limit - startByteOffset;
  const encPart = decryptAesCtrRawBlock(
    cipherBuf.subarray(0, encryptedPortionLen),
    keyBuf,
    ivBuf,
    startByteOffset
  );
  const plainPart = cipherBuf.subarray(encryptedPortionLen);
  return Buffer.concat([encPart, plainPart]);
}

function decryptStreamChunkWithVerification(rawChunk, entry, startByteOffset = 0) {
  if (!entry?.aesCtr || entry.aesCtr.disabled) return rawChunk;
  const { key, iv, encLimit = Infinity, candidates } = entry.aesCtr;
  if (!key || !iv || !Buffer.isBuffer(rawChunk) || rawChunk.length === 0) {
    return rawChunk;
  }

  if (startByteOffset === 0 && rawChunk.length >= 8 && !entry.aesCtr.verified) {
    if (isMp4BoxHeader(rawChunk)) {
      entry.aesCtr.disabled = true;
      entry.aesCtr.verified = true;
      return rawChunk;
    }
    const probeSlice = rawChunk.subarray(0, Math.min(16, rawChunk.length));
    const defaultDec = decryptAesCtrSlice(probeSlice, key, iv, 0, encLimit);
    if (isMp4BoxHeader(defaultDec)) {
      entry.aesCtr.verified = true;
    } else if (Array.isArray(candidates) && candidates.length > 0) {
      for (const cand of candidates) {
        if (!cand?.key || !cand?.iv) continue;
        const testDec = decryptAesCtrSlice(probeSlice, cand.key, cand.iv, 0, encLimit);
        if (isMp4BoxHeader(testDec)) {
          entry.aesCtr.key = cand.key;
          entry.aesCtr.iv = cand.iv;
          entry.aesCtr.verified = true;
          break;
        }
      }
    }
  }

  if (entry.aesCtr.disabled) return rawChunk;
  return decryptAesCtrSlice(
    rawChunk,
    entry.aesCtr.key,
    entry.aesCtr.iv,
    startByteOffset,
    encLimit
  );
}

function parseHttpRangeHeader(rangeStr, knownTotalSize = 0) {
  if (!rangeStr || typeof rangeStr !== 'string') return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeStr.trim());
  if (!m) return null;
  const startStr = m[1];
  const endStr = m[2];
  if (!startStr && !endStr) return null;

  if (!startStr && endStr) {
    // Suffix range: bytes=-N
    const suffixLen = parseInt(endStr, 10);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return null;
    if (knownTotalSize > 0) {
      const start = Math.max(0, knownTotalSize - suffixLen);
      return {
        start,
        end: knownTotalSize - 1,
        hasExplicitEnd: true,
        isSuffix: true,
        suffixLen,
      };
    }
    return {
      start: 0,
      end: null,
      hasExplicitEnd: false,
      isSuffix: true,
      suffixLen,
    };
  }

  const start = parseInt(startStr, 10);
  if (!Number.isFinite(start) || start < 0) return null;
  if (endStr) {
    const end = parseInt(endStr, 10);
    if (!Number.isFinite(end) || end < start) return { invalid: true, start, end };
    return { start, end, hasExplicitEnd: true, isSuffix: false, suffixLen: 0 };
  }
  return { start, end: null, hasExplicitEnd: false, isSuffix: false, suffixLen: 0 };
}

function parseContentRangeTotal(contentRangeHeader) {
  if (!contentRangeHeader) return 0;
  const m = /bytes\s+(?:\d+-\d+|\*)\/(\d+)/i.exec(String(contentRangeHeader));
  return m && m[1] ? parseInt(m[1], 10) || 0 : 0;
}

function parseContentRangeBounds(contentRangeHeader) {
  if (!contentRangeHeader) return null;
  const m = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(String(contentRangeHeader));
  if (!m) return null;
  return {
    start: parseInt(m[1], 10),
    end: parseInt(m[2], 10),
    total: m[3] === '*' ? 0 : parseInt(m[3], 10) || 0,
  };
}

async function probeUpstreamSize(targetUrl, baseHeaders) {
  try {
    const headRes = await nativeHttpRequest(targetUrl, {
      method: 'HEAD',
      headers: baseHeaders,
      timeout: 8000,
      binaryOnly: true,
    });
    const cl = parseInt(headRes.headers?.['content-length'] || '', 10);
    if (Number.isFinite(cl) && cl > 0) {
      return { size: cl, mime: headRes.headers?.['content-type'] || 'video/mp4' };
    }
  } catch {}

  try {
    const probeRes = await nativeHttpRequest(targetUrl, {
      method: 'GET',
      headers: { ...baseHeaders, Range: 'bytes=0-1' },
      timeout: 8000,
      maxBytes: 64,
      binaryOnly: true,
    });
    const total = parseContentRangeTotal(probeRes.headers?.['content-range']);
    if (total > 0) {
      return { size: total, mime: probeRes.headers?.['content-type'] || 'video/mp4' };
    }
    const cl = parseInt(probeRes.headers?.['content-length'] || '', 10);
    if (Number.isFinite(cl) && cl > 0 && probeRes.status === 200) {
      return { size: cl, mime: probeRes.headers?.['content-type'] || 'video/mp4' };
    }
  } catch {}

  return { size: 0, mime: 'video/mp4' };
}

async function handleProxyStream(request, reply) {
  const q = request.query || {};
  const token = String(q.token || '').trim();
  let entry = token ? PROXY_STREAM_CACHE.get(token) : null;
  const targetUrl = String(q.url || entry?.url || '').trim();
  if (!targetUrl) {
    return reply.code(400).send('Missing stream url');
  }

  if (!entry && (q.k || q.size || q.referer)) {
    let aesCtr = null;
    if (q.k && q.iv && /^[0-9a-fA-F]+$/.test(String(q.k)) && /^[0-9a-fA-F]+$/.test(String(q.iv))) {
      const el = q.el !== undefined ? Number(q.el) : Infinity;
      aesCtr = {
        key: Buffer.from(String(q.k), 'hex'),
        iv: Buffer.from(String(q.iv), 'hex'),
        encLimit: Number.isFinite(el) && el > 0 ? el : Infinity,
      };
    }
    entry = {
      url: targetUrl,
      referer: String(q.referer || `${activeDomain}/`),
      aesCtr,
      size: Number(q.size || 0) || 0,
      ts: Date.now(),
    };
    if (token) {
      PROXY_STREAM_CACHE.set(token, entry);
    }
  }

  const reqMethod = String(request.method || request.raw?.method || 'GET').toUpperCase();
  const referer = String(q.referer || entry?.referer || `${activeDomain}/`);
  const rangeHeader = request.headers?.range || request.headers?.Range || '';
  const baseHeaders = {
    'User-Agent': UA,
    Referer: referer,
    Origin: getHostOrigin(referer),
  };

  try {
    // 1. HLS segment passthrough
    if (q.type === 'ts') {
      const upstream = await nativeHttpRequest(targetUrl, {
        method: reqMethod === 'HEAD' ? 'HEAD' : 'GET',
        headers: rangeHeader ? { ...baseHeaders, Range: rangeHeader } : baseHeaders,
        timeout: 15000,
        maxBytes: 16 * 1024 * 1024,
        binaryOnly: true,
      });
      reply.header('Accept-Ranges', 'bytes');
      if (upstream.buffer) {
        reply.header('Content-Length', String(upstream.buffer.length));
      }
      return reply
        .code(upstream.status || 200)
        .type('video/mp2t')
        .send(reqMethod === 'HEAD' ? '' : upstream.buffer);
    }

    // 2. HLS manifest (.m3u8) rewriting
    if (isDirectHlsUrl(targetUrl)) {
      const upstream = await nativeHttpRequest(targetUrl, {
        method: 'GET',
        headers: baseHeaders,
        timeout: 15000,
        maxBytes: 4 * 1024 * 1024,
      });
      const prefix = String(request.raw?.url || request.url || '')
        .split('?')[0]
        .replace(/\/proxy(?:\.m3u8|\.mp4)?\/?$/i, '');
      const baseManifestUrl = upstream.finalUrl || targetUrl;
      const rewritten = upstream.text
        .split(/\r?\n/)
        .map((line) => {
          const t = line.trim();
          if (!t) return line;
          if (t.startsWith('#')) {
            return line.replace(/URI=["']([^"']+)["']/gi, (fullMatch, uriVal) => {
              const absUri = normalizeUrl(uriVal, baseManifestUrl);
              if (!absUri) return fullMatch;
              return `URI="${prefix}/proxy?url=${encodeURIComponent(
                absUri
              )}&referer=${encodeURIComponent(referer)}&type=ts"`;
            });
          }
          const absSeg = normalizeUrl(t, baseManifestUrl);
          if (!absSeg) return line;
          const isSubManifest = /\.m3u8(?:$|\?)/i.test(absSeg);
          const proxyPath = isSubManifest ? 'proxy.m3u8' : 'proxy';
          const hint = isSubManifest ? '' : '&type=ts';
          return `${prefix}/${proxyPath}?url=${encodeURIComponent(
            absSeg
          )}&referer=${encodeURIComponent(referer)}${hint}`;
        })
        .join('\n');
      const bodyBuf = Buffer.from(rewritten, 'utf8');
      reply.header('Content-Length', String(bodyBuf.length));
      return reply
        .code(200)
        .type('application/vnd.apple.mpegurl')
        .send(reqMethod === 'HEAD' ? '' : bodyBuf);
    }

    // 3. MP4 / binary stream handling with RFC 9110 Range compliance and AES-CTR decryption
    let knownSize = Number(entry?.size || 0);
    let knownMime = 'video/mp4';

    if (reqMethod === 'HEAD') {
      if (knownSize <= 0) {
        const probed = await probeUpstreamSize(targetUrl, baseHeaders);
        knownSize = probed.size;
        knownMime = probed.mime || knownMime;
        if (entry && knownSize > 0) entry.size = knownSize;
      }
      reply.header('Accept-Ranges', 'bytes');
      if (rangeHeader) {
        const parsedRange = parseHttpRangeHeader(rangeHeader, knownSize);
        if (
          parsedRange?.invalid ||
          (knownSize > 0 && parsedRange && parsedRange.start >= knownSize)
        ) {
          if (knownSize > 0) reply.header('Content-Range', `bytes */${knownSize}`);
          return reply.code(416).type(knownMime).send('');
        }
        if (parsedRange && knownSize > 0) {
          const end = parsedRange.hasExplicitEnd
            ? Math.min(parsedRange.end, knownSize - 1)
            : knownSize - 1;
          reply.header('Content-Range', `bytes ${parsedRange.start}-${end}/${knownSize}`);
          reply.header('Content-Length', String(end - parsedRange.start + 1));
          return reply.code(206).type(knownMime).send('');
        }
      }
      if (knownSize > 0) {
        reply.header('Content-Length', String(knownSize));
      }
      return reply.code(200).type(knownMime).send('');
    }

    // Full-file GET (no Range header)
    if (!rangeHeader) {
      const upstream = await nativeHttpRequest(targetUrl, {
        method: 'GET',
        headers: baseHeaders,
        timeout: 15000,
        maxBytes: 16 * 1024 * 1024,
        binaryOnly: true,
      });
      const bodyBuf = decryptStreamChunkWithVerification(upstream.buffer, entry, 0);
      if (entry && bodyBuf.length > 0 && !entry.size) {
        entry.size = bodyBuf.length;
      }
      const mime = upstream.headers?.['content-type'] || 'video/mp4';
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Content-Length', String(bodyBuf.length));
      // Omit Content-Range on 200 OK per RFC 9110
      return reply.code(200).type(mime).send(bodyBuf);
    }

    // Range GET request
    let parsedRange = parseHttpRangeHeader(rangeHeader, knownSize);
    if (parsedRange?.isSuffix && knownSize <= 0) {
      const probed = await probeUpstreamSize(targetUrl, baseHeaders);
      knownSize = probed.size;
      if (entry && knownSize > 0) entry.size = knownSize;
      parsedRange = parseHttpRangeHeader(rangeHeader, knownSize);
    }

    if (!parsedRange || parsedRange.invalid || (knownSize > 0 && parsedRange.start >= knownSize)) {
      if (knownSize > 0) {
        reply.header('Content-Range', `bytes */${knownSize}`);
      }
      reply.header('Accept-Ranges', 'bytes');
      return reply.code(416).send('Range Not Satisfiable');
    }

    const startByte = parsedRange.start;
    let targetEndByte;
    if (parsedRange.hasExplicitEnd && parsedRange.end !== null) {
      const cappedExplicitEnd = parsedRange.isSuffix
        ? parsedRange.end
        : Math.min(parsedRange.end, startByte + MAX_EXPLICIT_SLICE_BYTES - 1);
      targetEndByte =
        knownSize > 0 ? Math.min(cappedExplicitEnd, knownSize - 1) : cappedExplicitEnd;
    } else {
      // Open-ended range (bytes=start-): cap slice size to 512KB
      targetEndByte =
        knownSize > 0
          ? Math.min(startByte + DEFAULT_SLICE_CHUNK_BYTES - 1, knownSize - 1)
          : startByte + DEFAULT_SLICE_CHUNK_BYTES - 1;
    }

    const expectedSliceLen = targetEndByte - startByte + 1;
    const upstreamHeaders = {
      ...baseHeaders,
      Range: `bytes=${startByte}-${targetEndByte}`,
    };

    const upstream = await nativeHttpRequest(targetUrl, {
      method: 'GET',
      headers: upstreamHeaders,
      timeout: 15000,
      maxBytes: Math.max(expectedSliceLen + 65536, DEFAULT_SLICE_CHUNK_BYTES * 2),
      binaryOnly: true,
    });

    const crBounds = parseContentRangeBounds(upstream.headers?.['content-range']);
    if (crBounds?.total && crBounds.total > 0) {
      knownSize = crBounds.total;
      if (entry) entry.size = knownSize;
    } else if (upstream.status === 200 && upstream.buffer.length > 0 && knownSize <= 0) {
      knownSize = upstream.buffer.length;
      if (entry) entry.size = knownSize;
    }

    if (knownSize > 0 && startByte >= knownSize) {
      reply.header('Content-Range', `bytes */${knownSize}`);
      reply.header('Accept-Ranges', 'bytes');
      return reply.code(416).send('Range Not Satisfiable');
    }

    let rawChunk = upstream.buffer;
    let actualStart = startByte;
    if (upstream.status === 200) {
      // Upstream ignored Range header and returned full stream from byte 0
      const sliceEnd = Math.min(targetEndByte + 1, rawChunk.length);
      rawChunk = rawChunk.subarray(startByte, sliceEnd);
      actualStart = startByte;
    } else if (crBounds && crBounds.start <= startByte) {
      const offsetInChunk = startByte - crBounds.start;
      const maxLen = Math.min(expectedSliceLen, rawChunk.length - offsetInChunk);
      rawChunk = rawChunk.subarray(offsetInChunk, offsetInChunk + maxLen);
      actualStart = startByte;
    } else if (rawChunk.length > expectedSliceLen) {
      rawChunk = rawChunk.subarray(0, expectedSliceLen);
    }

    const bodyBuf = decryptStreamChunkWithVerification(rawChunk, entry, actualStart);

    const actualEnd = actualStart + Math.max(0, bodyBuf.length - 1);
    const totalForHeader =
      knownSize > 0 ? knownSize : Math.max(actualEnd + 1, bodyBuf.length);
    const mime = upstream.headers?.['content-type'] || 'video/mp4';

    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Range', `bytes ${actualStart}-${actualEnd}/${totalForHeader}`);
    reply.header('Content-Length', String(bodyBuf.length));
    return reply.code(206).type(mime).send(bodyBuf);
  } catch (err) {
    return reply.code(502).send(String(err?.message || 'Proxy error'));
  }
}

async function init(inReq, ...extraArgs) {
  const params = unwrapParams(inReq, extraArgs, 'init');
  const ext = params.ext ?? params.extend ?? '';
  if (typeof ext === 'string' && /^https?:\/\//i.test(ext.trim())) {
    const customDomain = ext.trim().replace(/\/+$/, '');
    if (!SITE_DOMAINS.includes(customDomain)) {
      SITE_DOMAINS.unshift(customDomain);
    }
    activeDomain = customDomain;
  } else if (ext && typeof ext === 'object') {
    const domains = Array.isArray(ext.domains)
      ? ext.domains
      : ext.domain || ext.site
      ? [ext.domain || ext.site]
      : [];
    for (const d of domains) {
      if (typeof d === 'string' && /^https?:\/\//i.test(d.trim())) {
        const clean = d.trim().replace(/\/+$/, '');
        if (!SITE_DOMAINS.includes(clean)) {
          SITE_DOMAINS.push(clean);
        }
      }
    }
    if (domains.length > 0 && typeof domains[0] === 'string') {
      activeDomain = domains[0].trim().replace(/\/+$/, '');
    }
  }
  return {};
}

async function home(inReq, ...extraArgs) {
  const classes = [{ type_id: 'recommend', type_name: '推荐' }];
  const slugs = [];

  const [xml, homeHtml] = await Promise.all([
    fetchHtml('/sitemaps/category.xml'),
    fetchHtml('/'),
  ]);

  if (xml) {
    const locRegex = /<loc>([^<]+)<\/loc>/gi;
    let m;
    while ((m = locRegex.exec(xml)) !== null) {
      const sm = /\/porn\/([a-z0-9-]+)\/?$/i.exec(m[1].trim());
      if (sm && sm[1] && !slugs.includes(sm[1])) {
        slugs.push(sm[1]);
      }
    }
  }

  if (slugs.length === 0 && homeHtml) {
    const catRegex = /\/porn\/([a-z0-9-]+)\//gi;
    let m;
    while ((m = catRegex.exec(homeHtml)) !== null) {
      if (m[1] && !slugs.includes(m[1])) {
        slugs.push(m[1]);
      }
    }
  }

  if (slugs.length === 0) {
    slugs.push(...DEFAULT_CAT_SLUGS);
  }

  cachedCatSlugs = slugs;
  for (const s of slugs) {
    classes.push({
      type_id: s,
      type_name: toTitleCase(s),
    });
  }

  const filterDef = [
    {
      key: 'quality',
      name: '清晰度',
      init: '',
      value: [
        { n: '全部', v: '' },
        { n: '4K', v: '4k' },
        { n: '1080p', v: '1080p' },
        { n: '720p', v: '720p' },
      ],
    },
    {
      key: 'duration',
      name: '时长',
      init: '',
      value: [
        { n: '全部', v: '' },
        { n: '短片<60分', v: 'short' },
        { n: '中片60-120分', v: 'medium' },
        { n: '长片>120分', v: 'long' },
      ],
    },
  ];

  const filters = {};
  for (const cl of classes) {
    if (cl.type_id === 'home' || cl.type_id === 'recommend') continue;
    filters[cl.type_id] = filterDef;
  }

  const homeCards = homeHtml ? cleanCards(parseCards(homeHtml).slice(0, 50)) : [];

  return {
    class: classes,
    filters,
    list: homeCards,
    style: CARD_STYLE,
  };
}

async function homeVod() {
  const homeHtml = await fetchHtml('/');
  const homeCards = homeHtml ? cleanCards(parseCards(homeHtml).slice(0, 50)) : [];
  return { list: homeCards };
}

async function category(inReq, ...extraArgs) {
  const params = unwrapParams(inReq, extraArgs, 'category');
  const tid = String(params.id ?? params.tid ?? params.type_id ?? 'recommend').trim();
  let pg = parseInt(params.page ?? params.pg ?? 1, 10);
  if (!Number.isFinite(pg) || pg < 1) pg = 1;
  const extend = params.filters ?? params.extend ?? params.ext ?? {};

  if (tid === 'home' || tid === 'recommend') {
    if (pg !== 1) {
      return { page: pg, pagecount: 1, limit: 50, total: 0, list: [], style: CARD_STYLE };
    }
    const html = await fetchHtml('/');
    const cards = parseCards(html || '').slice(0, 50);
    const filtered = applyFilters(cards, extend);
    return {
      page: pg,
      pagecount: 1,
      limit: 50,
      total: filtered.length,
      list: filtered,
      style: CARD_STYLE,
    };
  }

  let html = '';
  if (pg === 1) {
    html = (await fetchHtml(`/porn/${tid}/`)) || '';
  } else {
    html =
      (await fetchHtml('/hash-javheo', {
        data: { mix: 'video-next2', value: tid, page: pg - 1 },
        referer: `${activeDomain}/porn/${tid}/`,
      })) || '';
  }

  const cards = parseCards(html);
  const rawCount = cards.length;
  const pagecount = rawCount < 50 ? pg : 999;
  const filtered = applyFilters(cards, extend);

  return {
    page: pg,
    pagecount,
    limit: 50,
    total: pagecount * 50,
    list: filtered,
    style: CARD_STYLE,
  };
}

async function detail(inReq, ...extraArgs) {
  const params = unwrapParams(inReq, extraArgs, 'detail');
  let rawId = params.id ?? params.ids ?? params.vod_id ?? params.url ?? '';
  if (Array.isArray(rawId)) {
    rawId = rawId[0] || '';
  }
  const wid = extractWidFromInput(rawId);
  if (!wid) {
    return { list: [] };
  }

  const detailPath = buildDetailPathFromInput(rawId) || `/watch/${wid}`;
  const detailRes = await fetchPage(detailPath);
  if (!detailRes || !detailRes.text) {
    return { list: [] };
  }

  const html = detailRes.text;
  const detailUrl = detailRes.finalUrl || `${activeDomain}/watch/${wid}`;

  let name = '';
  const h1Match = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(html);
  if (h1Match && h1Match[1]) {
    name = decodeHtmlEntities(h1Match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
  }
  if (!name && titleMatch && titleMatch[1]) {
    name = decodeHtmlEntities(titleMatch[1].replace(/\s+/g, ' ').trim());
  }

  let pic = '';
  const ogImgMatch =
    /property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
    /content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html);
  if (ogImgMatch && ogImgMatch[1]) {
    pic = normalizeUrl(ogImgMatch[1], detailUrl);
  }

  let durationMin = null;
  const dm1 = /video:duration["']?\s*content=["'](\d+)["']/i.exec(html);
  if (dm1 && dm1[1]) {
    durationMin = Math.floor(parseInt(dm1[1], 10) / 60);
  } else {
    const dm2 = /video:duration[^0-9]{0,30}(\d+)/i.exec(html);
    if (dm2 && dm2[1]) {
      durationMin = Math.floor(parseInt(dm2[1], 10) / 60);
    }
  }
  if (durationMin === null) {
    const tm2 = /TIME\s*(\d+)\s*MIN/i.exec(html);
    if (tm2 && tm2[1]) {
      durationMin = parseInt(tm2[1], 10);
    }
  }

  const tags = [];
  const cats = new Set(cachedCatSlugs);
  const tagRegex = /href=["'](?:https?:\/\/[^/"']+)?\/porn\/([a-z0-9-]+)\/?["']/gi;
  let tm;
  while ((tm = tagRegex.exec(html)) !== null) {
    const s = tm[1];
    if (s && !cats.has(s) && !tags.includes(s)) {
      tags.push(s);
      if (tags.length >= 12) break;
    }
  }

  const parts = [];
  if (durationMin !== null) {
    parts.push(`时长：${durationMin}分`);
  }
  if (tags.length > 0) {
    parts.push(`标签：${tags.map((t) => toTitleCase(t)).join(' / ')}`);
  }

  const playFrom = ['在线播放'];
  const playUrl = [`正片$${wid}`];

  const playWarmPromise = resolvePlay(rawId, detailRes).catch(() => null);

  let rec = parseCards(html)
    .filter((c) => c.vod_id !== wid)
    .slice(0, 9);

  if (rec.length === 0) {
    for (const tag of tags.slice(0, 2)) {
      const recHtml = await fetchHtml(`/porn/${tag}/`);
      if (!recHtml || recHtml.length < 200) continue;
      const recCards = parseCards(recHtml);
      rec = recCards.filter((c) => c.vod_id !== wid).slice(0, 9);
      if (rec.length > 0) break;
    }
  }

  if (rec.length > 0) {
    playFrom.push('同标签推荐');
    playUrl.push(
      rec
        .map((c) => {
          const safeName = String(c.vod_name || c.vod_id)
            .replace(/\$/g, '')
            .replace(/#/g, '');
          return `${safeName}$${c.vod_id}`;
        })
        .join('#')
    );
  }

  await playWarmPromise;

  return {
    list: [
      {
        vod_id: wid,
        vod_name: name || wid,
        vod_pic: pic,
        vod_year: '',
        vod_area: '',
        vod_remarks: durationMin !== null ? `${durationMin}分` : '',
        vod_actor: '',
        vod_director: '',
        vod_content: parts.join('\n'),
        vod_play_from: playFrom.join('$$$'),
        vod_play_url: playUrl.join('$$$'),
      },
    ],
  };
}

async function play(inReq, ...extraArgs) {
  const params = unwrapParams(inReq, extraArgs, 'play');
  let rawInputVal =
    params.id ?? params.url ?? params.playUrl ?? params.vod_id ?? params.ids ?? '';
  if (Array.isArray(rawInputVal)) {
    rawInputVal = rawInputVal[0] || '';
  }
  const rawInput = String(rawInputVal).trim();
  const forceProxy =
    params.proxy === '1' || params.proxy === true || params.proxy === 1;
  const { clean: rawId, meta } = sanitizeEpisodeInput(rawInput);

  let customReferer = '';
  if (meta && /^https?:\/\//i.test(meta)) {
    customReferer = isKnownSiteHost(meta)
      ? `${activeDomain}${new URL(meta).pathname}${new URL(meta).search}`
      : meta;
  }

  const makePlayHeaders = (ref) => {
    const effectiveRef = ref || customReferer || `${activeDomain}/`;
    return {
      'User-Agent': UA,
      Referer: effectiveRef,
      Origin: getHostOrigin(effectiveRef),
    };
  };

  if (/^https?:\/\//i.test(rawId)) {
    const unwrapped = unwrapNestedStreamUrl(rawId, customReferer || activeDomain);
    if (isDirectMediaUrl(unwrapped)) {
      const headers = makePlayHeaders(customReferer);
      if (forceProxy) {
        const proxyUrl = await buildFastifyProxyUrl(inReq, {
          url: unwrapped,
          referer: headers.Referer,
          aesCtr: null,
          size: 0,
        });
        return {
          parse: 0,
          jx: 0,
          url: proxyUrl,
          header: headers,
          headers,
        };
      }
      return {
        parse: 0,
        jx: 0,
        url: unwrapped,
        header: headers,
        headers,
      };
    }
  }

  const wid = extractWidFromInput(rawId);
  const res = await resolvePlay(rawId);
  if (res && res.url) {
    const playHeaders = makePlayHeaders(res.referer);
    const shouldProxy = Boolean(res.needsProxy || forceProxy);
    const finalPlayUrl = shouldProxy
      ? await buildFastifyProxyUrl(inReq, res)
      : res.url;
    return {
      parse: 0,
      jx: 0,
      url: finalPlayUrl,
      header: playHeaders,
      headers: playHeaders,
    };
  }

  const defaultHeaders = makePlayHeaders(customReferer);
  let fallbackUrl = `${activeDomain}/watch/${wid}`;
  if (/^https?:\/\//i.test(rawId)) {
    if (isKnownSiteHost(rawId)) {
      try {
        const u = new URL(rawId);
        fallbackUrl = `${activeDomain}${u.pathname}${u.search}`;
      } catch {
        fallbackUrl = rawId;
      }
    } else {
      fallbackUrl = rawId;
    }
  }
  return {
    parse: 1,
    jx: 0,
    url: fallbackUrl,
    header: defaultHeaders,
    headers: defaultHeaders,
  };
}

async function search(inReq, ...extraArgs) {
  const params = unwrapParams(inReq, extraArgs, 'search');
  const key = String(params.wd ?? params.key ?? params.keyword ?? params.q ?? '').trim();
  let pg = parseInt(params.page ?? params.pg ?? 1, 10);
  if (!Number.isFinite(pg) || pg < 1) pg = 1;

  const slug = key
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!slug) {
    return { page: pg, pagecount: 1, limit: 50, total: 0, list: [] };
  }

  let html = '';
  if (pg === 1) {
    html = (await fetchHtml(`/porn/${slug}/`)) || '';
  } else {
    html =
      (await fetchHtml('/hash-javheo', {
        data: { mix: 'video-next2', value: slug, page: pg - 1 },
        referer: `${activeDomain}/porn/${slug}/`,
      })) || '';
  }

  let cards = parseCards(html);
  const normKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normKey) {
    cards = cards
      .map((c, idx) => {
        const normName = String(c.vod_name || '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '');
        const score = normName.includes(normKey) ? 0 : 1;
        return { c, score, idx };
      })
      .sort((a, b) => (a.score !== b.score ? a.score - b.score : a.idx - b.idx))
      .map((entry) => entry.c);
  }

  const rawCount = cards.length;
  const pagecount = rawCount < 50 ? pg : 999;

  return {
    page: pg,
    pagecount,
    limit: 50,
    total: pagecount * 50,
    list: cleanCards(cards),
  };
}

async function proxyPicHandler(query = {}) {
  const picUrl = String(query.url || query.pic || '').trim();
  if (!picUrl) {
    return { mime: 'image/gif', data: Buffer.alloc(0) };
  }
  try {
    const res = await nativeHttpRequest(picUrl, {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        Referer: `${activeDomain}/`,
      },
      timeout: 10000,
      binaryOnly: true,
    });
    const mime = res.headers?.['content-type'] || 'image/jpeg';
    return { mime, data: res.buffer };
  } catch {
    return { mime: 'image/gif', data: Buffer.alloc(0) };
  }
}

export {
  init,
  home,
  homeVod,
  category,
  detail,
  play,
  search,
  handleProxyStream as proxy,
  handleProxyStream,
  extractStreamFromPageHtml,
  extractStreamDescriptorFromPageHtml,
  decryptAesCtrSlice,
};

export default {
  meta: {
    key: 'javheo',
    name: 'JavHeo',
    type: 3,
  },
  api: async (fastify) => {
    fastifyRoutesRegistered = true;
    fastify.post('/init', init);
    fastify.post('/home', home);
    fastify.post('/homeVod', homeVod);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/proxy', handleProxyStream);
    fastify.get('/proxy.mp4', handleProxyStream);
    fastify.get('/proxy.m3u8', handleProxyStream);
    if (typeof fastify.head === 'function') {
      fastify.head('/proxy', handleProxyStream);
      fastify.head('/proxy.mp4', handleProxyStream);
      fastify.head('/proxy.m3u8', handleProxyStream);
    }
    fastify.get('/javheo_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
  },
  init,
  home,
  homeVod,
  category,
  detail,
  play,
  search,
  proxy: handleProxyStream,
};