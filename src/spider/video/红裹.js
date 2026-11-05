import req from '../../util/req.js';
import crypto from 'crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import zlib from 'node:zlib';

const SITE_DOMAINS = [
  'https://hguoo.com',
  'https://www.hguoo.com',
  'https://nbck.hguoo.cyou',
  'https://mst4.hgyng.com',
];

let activeDomain = SITE_DOMAINS[0];

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const BRAND_NAME = '蝴蝶影视';
const BRAND_ACTOR = '🦋 TG群: @tvshare23';
const BRAND_DIRECTOR = '🦋 蝴蝶影视';
const FULL_DESC = '🦋 蝴蝶影视专线直连 | 官方交流群: @tvshare23 | 4K高清原生画质';

const CARD_STYLE = { type: 'rect', ratio: 1.78 };

const BAD_MEDIA_KEYWORDS = [
  'preview.mp4',
  'sample.mp4',
  'trailer.mp4',
  'top_banner',
  '55287.mp4',
  'native-ad',
  'stat.php',
];

const CLASSES = [
  { type_id: '/category/%E4%BA%BA%E5%A6%BB%E7%B3%BB%E5%88%97-101', type_name: '人妻系列' },
  { type_id: '/category/%E6%97%A5%E9%9F%A9%E7%B2%BE%E5%93%81-102', type_name: '日韩精品' },
  { type_id: '/category/%E5%8E%9F%E5%88%9B%E4%B9%B1%E4%BC%A6-104', type_name: '原创乱伦' },
  { type_id: '/category/%E9%AC%BC%E7%88%B6%E6%93%8D%E5%A5%B3-105', type_name: '鬼父操女' },
  { type_id: '/category/%E5%AB%82%E5%AD%90%E8%AF%B1%E6%83%91-106', type_name: '嫂子诱惑' },
  { type_id: '/category/%E5%A7%90%E5%A4%AB%E5%B0%8F%E5%A7%A8%E5%AD%90-107', type_name: '姐夫小姨子' },
  { type_id: '/category/%E5%85%84%E5%BC%9F%E5%A7%90%E5%A6%B9-108', type_name: '兄弟姐妹' },
  { type_id: '/category/%E9%A3%8E%E9%9F%B5%E5%B2%B3%E6%AF%8D-109', type_name: '风韵岳母' },
  { type_id: '/category/%E5%84%BF%E5%AA%B3%E7%8C%AE%E7%A9%B4-110', type_name: '儿媳献穴' },
  { type_id: '/category/%E5%AE%B6%E6%97%8F%E6%B7%AB%E8%B6%B4-111', type_name: '家族淫趴' },
  { type_id: '/category/%E4%B8%AD%E6%96%87%E5%AD%97%E5%B9%95-112', type_name: '中文字幕' },
  { type_id: '/category/%E5%88%B6%E6%9C%8D%E8%AF%B1%E6%83%91-113', type_name: '制服诱惑' },
  { type_id: '/category/%E5%B8%88%E7%94%9F%E8%BF%B7%E6%83%85-114', type_name: '师生迷情' },
  { type_id: '/category/av%E8%A7%A3%E8%AF%B4-115', type_name: 'AV解说' },
  { type_id: '/category/sm%E9%87%8D%E5%91%B3-116', type_name: 'SM重味' },
  { type_id: '/category/%E4%BC%A6%E7%90%86%E5%BD%B1%E7%89%87-117', type_name: '伦理影片' },
  { type_id: '/category/%E6%97%A5%E9%9F%A9%E6%97%A0%E7%A0%81-118', type_name: '日韩无码' },
  { type_id: '/category/%E5%BC%BA%E5%A5%B8%E4%B9%B1%E4%BC%A6-119', type_name: '强奸乱伦' },
  { type_id: '/category/%E5%90%83%E7%93%9C%E9%BB%91%E6%96%99-120', type_name: '吃瓜黑料' },
  { type_id: '/category/%E9%85%92%E5%BA%97%E6%8E%A2%E8%8A%B1-121', type_name: '酒店探花' },
  { type_id: '/category/sm%E8%B0%83%E6%95%99-122', type_name: 'SM调教' },
  { type_id: '/category/ai%E6%8D%A2%E8%84%B8-123', type_name: 'AI换脸' },
  { type_id: '/category/%E5%9B%BD%E4%BA%A7%E4%B8%BB%E6%92%AD-124', type_name: '国产主播' },
  { type_id: '/category/%E6%B7%AB%E6%AF%8D%E5%85%BD%E5%84%BF-125', type_name: '淫母兽儿' },
  { type_id: '/category/%E8%BF%91%E4%BA%B2%E7%9B%B8%E5%A5%B8-126', type_name: '近亲相奸' },
  { type_id: '/category/%E6%AC%A7%E7%BE%8E%E5%8A%B2%E7%88%86-127', type_name: '欧美劲爆' },
  { type_id: '/category/%E5%BC%BA%E5%A5%B8%E8%BF%B7%E5%A5%B8-144', type_name: '强奸迷奸' },
  { type_id: '/category/%E9%87%8E%E6%88%98%E8%BD%A6%E9%9C%87-145', type_name: '野战车震' },
  { type_id: '/category/%E7%86%9F%E5%A5%B3%E5%B0%91%E5%A6%87-146', type_name: '熟女少妇' },
  { type_id: '/category/%E5%8F%8D%E5%B7%AE%E6%AF%8D%E7%8B%97-147', type_name: '反差母狗' },
  { type_id: '/category/%E4%BA%BA%E5%A6%BB%E5%B7%A8%E4%B9%B3-148', type_name: '人妻巨乳' },
  { type_id: '/category/%E8%87%AA%E6%8B%8D%E5%81%B7%E6%8B%8D-149', type_name: '自拍偷拍' },
  { type_id: '/category/%E6%95%99%E5%B8%88%E5%AD%A6%E7%94%9F-150', type_name: '教师学生' },
  { type_id: '/category/3d%E5%8A%A8%E6%BC%AB-151', type_name: '3D动漫' },
  { type_id: '/category/%E7%9F%AD%E8%A7%86%E9%A2%91-152', type_name: '短视频' },
];

// In-memory stream & session cache keyed by vod_id, URL, or sessionId (TTL: 30 minutes)
const PLAY_CACHE = new Map();
const STREAM_SESSIONS = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_SLICE_BYTES = 512 * 1024; // 512KB moderate slice size

function getCacheEntry(key) {
  if (!key) return null;
  const entry = PLAY_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    PLAY_CACHE.delete(key);
    return null;
  }
  return entry;
}

function getCache(key) {
  const entry = getCacheEntry(key);
  if (!entry) return null;
  return typeof entry.value === 'object' && entry.value !== null ? entry.value.url : entry.value;
}

function getCacheMeta(key) {
  const entry = getCacheEntry(key);
  if (!entry) return null;
  if (typeof entry.value === 'object' && entry.value !== null) {
    return entry.value;
  }
  return { url: entry.value, referer: `${activeDomain}/` };
}

function setCache(key, value, referer = '', session = null, desc = '') {
  if (!key || !value) return;
  const meta =
    typeof value === 'object' && value !== null
      ? value
      : {
          url: String(value),
          referer: referer || `${activeDomain}/`,
          session: session || null,
          desc: desc || '',
        };
  PLAY_CACHE.set(key, { value: meta, ts: Date.now() });
}

export function registerStreamSession(sessionData) {
  if (!sessionData || !sessionData.url) return '';
  const rawKey = `${sessionData.url}|${sessionData.referer || ''}|${sessionData.key || ''}|${sessionData.iv || ''}`;
  const sid = crypto.createHash('md5').update(rawKey).digest('hex').slice(0, 16);
  STREAM_SESSIONS.set(sid, {
    ...sessionData,
    ts: Date.now(),
  });
  return sid;
}

export function getStreamSession(sid) {
  if (!sid) return null;
  const entry = STREAM_SESSIONS.get(sid);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    STREAM_SESSIONS.delete(sid);
    return null;
  }
  return entry;
}

export function formatRemarks(brand = BRAND_NAME, meta = '') {
  const cleanMeta = String(meta || '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return cleanMeta ? `${brand} | ${cleanMeta}` : brand;
}

export function cleanLabel(text) {
  let clean = String(text || '')
    .replace(/[$#\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length > 20) {
    clean = clean.slice(0, 20) + '...';
  }
  return clean;
}

export function decodeHtmlEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#0*(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function unescapeJsString(str) {
  if (!str) return '';
  return decodeHtmlEntities(String(str))
    .replace(/\\u([0-9a-fA-F]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\//g, '/');
}

function stripTags(html) {
  return decodeHtmlEntities(
    String(html || '')
      .replace(/<[^>]+>/g, '')
      .replace(/_+\s*title=_+[\s\S]*$/i, '')
  ).trim();
}

function isPlaceholderUri(val) {
  if (!val) return true;
  const s = String(val).trim().toLowerCase();
  if (!s || s === '#' || s === 'none' || s === 'null' || s === 'undefined' || s === 'false') {
    return true;
  }
  if (s.startsWith('about:') || s.startsWith('javascript:') || s.startsWith('data:')) return true;
  if (/(?:blank\.gif|loading\.gif|lazyload\.|placeholder\.)/i.test(s)) return true;
  return false;
}

function isBadMediaUrl(url) {
  if (!url) return true;
  const low = String(url).toLowerCase();
  return BAD_MEDIA_KEYWORDS.some((kw) => low.includes(kw));
}

/**
 * Extracts media or image URL from an HTML tag or snippet by checking lazy-load
 * attributes first before falling back to src, regardless of attribute order.
 */
export function extractLazySrc(
  htmlSnippet,
  attrPriority = [
    'data-litespeed-src',
    'data-lazy-src',
    'data-original',
    'data-src',
    'data-echo',
    'data-url',
    'data-play',
    'src',
  ]
) {
  if (!htmlSnippet) return '';
  const str = String(htmlSnippet);
  for (const attr of attrPriority) {
    const regex = new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'gi');
    let match;
    while ((match = regex.exec(str)) !== null) {
      const candidate = decodeHtmlEntities(match[1]).trim();
      if (!isPlaceholderUri(candidate)) {
        return candidate;
      }
    }
  }
  const bgMatch = /background(?:-image)?\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i.exec(str);
  if (bgMatch && bgMatch[1]) {
    const candidate = decodeHtmlEntities(bgMatch[1]).trim();
    if (!isPlaceholderUri(candidate)) {
      return candidate;
    }
  }
  return '';
}

function normalizeUrl(url, base = activeDomain) {
  if (!url) return '';
  const str = unescapeJsString(String(url)).trim();
  if (isPlaceholderUri(str)) return '';
  if (str.startsWith('//')) return 'https:' + str;
  if (str.startsWith('http://') || str.startsWith('https://')) return str;
  try {
    return new URL(str, base || activeDomain).href;
  } catch (_) {
    if (str.startsWith('/')) return (base || activeDomain).replace(/\/+$/, '') + str;
    return str;
  }
}

function getCandidateDomains() {
  const ordered = [activeDomain, ...SITE_DOMAINS.filter((d) => d !== activeDomain)];
  return [...new Set(ordered)];
}

/**
 * Determines whether a URL belongs to one of the known site domains so that
 * detail/play requests can automatically fail over across mirror domains.
 */
function expandCandidateUrls(targetUrl) {
  if (!targetUrl) return { isSiteRequest: false, urls: [] };
  const raw = unescapeJsString(String(targetUrl)).trim();
  const domains = getCandidateDomains();

  if (raw.startsWith('/')) {
    return {
      isSiteRequest: true,
      urls: domains.map((d) => d.replace(/\/+$/, '') + raw),
    };
  }

  try {
    const parsed = new URL(normalizeUrl(raw));
    const knownHosts = new Set(
      domains.map((d) => {
        try {
          return new URL(d).hostname.toLowerCase();
        } catch (_) {
          return '';
        }
      })
    );
    const targetHost = parsed.hostname.toLowerCase();
    const isKnownSiteHost =
      knownHosts.has(targetHost) ||
      targetHost.endsWith('.hguoo.com') ||
      targetHost.endsWith('.hguoo.cyou') ||
      targetHost.endsWith('.hgyng.com');

    if (isKnownSiteHost) {
      const pathAndQuery = (parsed.pathname || '/') + (parsed.search || '');
      const expanded = [];
      for (const d of domains) {
        const candidate = d.replace(/\/+$/, '') + pathAndQuery;
        if (!expanded.includes(candidate)) expanded.push(candidate);
      }
      const normalizedOrig = parsed.href;
      if (!expanded.includes(normalizedOrig)) expanded.unshift(normalizedOrig);
      return { isSiteRequest: true, urls: expanded };
    }
  } catch (_) {}

  return { isSiteRequest: false, urls: [normalizeUrl(raw)] };
}

function decodeBuffer(buf, contentEncoding = '') {
  if (!buf) return '';
  if (typeof buf === 'string') return buf;
  let raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const enc = String(contentEncoding || '').toLowerCase();
  if ((raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) || enc.includes('gzip')) {
    try {
      raw = zlib.gunzipSync(raw);
    } catch (_) {}
  } else if (enc.includes('deflate')) {
    try {
      raw = zlib.inflateSync(raw);
    } catch (_) {
      try {
        raw = zlib.inflateRawSync(raw);
      } catch (__) {}
    }
  } else if (enc.includes('br') && typeof zlib.brotliDecompressSync === 'function') {
    try {
      raw = zlib.brotliDecompressSync(raw);
    } catch (_) {}
  }
  const utf8 = raw.toString('utf-8');
  if (utf8.includes('\ufffd')) {
    try {
      const gbkDecoder = new TextDecoder('gbk');
      return gbkDecoder.decode(raw);
    } catch (_) {
      return utf8;
    }
  }
  return utf8;
}

/**
 * Low-level raw socket fallback that resolves immediately when Content-Length or chunked
 * body completes, avoiding 15-25s HTTP/1.1 Keep-Alive hangs on upstream CDNs.
 */
function rawSocketRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (err) {
      return reject(err);
    }
    const isHttps = parsed.protocol === 'https:';
    const port = Number(parsed.port) || (isHttps ? 443 : 80);
    const host = parsed.hostname;
    const path = (parsed.pathname || '/') + (parsed.search || '');
    const method = (options.method || 'GET').toUpperCase();
    const timeoutMs = options.timeout || 8000;

    const reqHeaders = {
      Host: parsed.host,
      'User-Agent': DEFAULT_UA,
      Accept: '*/*',
      Connection: 'close',
      ...(options.headers || {}),
    };

    const headerLines = [`${method} ${path} HTTP/1.1`];
    for (const [k, v] of Object.entries(reqHeaders)) {
      if (v !== undefined && v !== null) {
        headerLines.push(`${k}: ${v}`);
      }
    }
    const rawReq = headerLines.join('\r\n') + '\r\n\r\n';

    let settled = false;
    let headerParsed = false;
    let statusCode = 200;
    let respHeaders = {};
    let contentLength = null;
    let isChunked = false;
    let rawBuffer = Buffer.alloc(0);

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock.destroy();
      } catch (_) {}
      if (err) reject(err);
      else resolve(result);
    };

    const sock = isHttps
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: false })
      : net.connect({ host, port });

    const timer = setTimeout(() => {
      if (headerParsed) {
        finish(null, { status: statusCode, headers: respHeaders, data: rawBuffer, url: urlStr });
      } else {
        finish(new Error(`Socket timeout requesting ${urlStr}`));
      }
    }, timeoutMs);

    sock.on('connect', () => {
      if (!isHttps) sock.write(rawReq);
    });
    sock.on('secureConnect', () => {
      sock.write(rawReq);
    });

    sock.on('data', (chunk) => {
      rawBuffer = Buffer.concat([rawBuffer, chunk]);
      if (!headerParsed) {
        const sepIdx = rawBuffer.indexOf('\r\n\r\n');
        if (sepIdx === -1) return;
        headerParsed = true;
        const headerPart = rawBuffer.slice(0, sepIdx).toString('latin1');
        rawBuffer = rawBuffer.slice(sepIdx + 4);

        const lines = headerPart.split('\r\n');
        const statusMatch = /^HTTP\/\d\.\d\s+(\d+)/.exec(lines[0] || '');
        statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 200;
        for (let i = 1; i < lines.length; i++) {
          const col = lines[i].indexOf(':');
          if (col > 0) {
            const k = lines[i].slice(0, col).trim().toLowerCase();
            const v = lines[i].slice(col + 1).trim();
            respHeaders[k] = v;
          }
        }
        if (respHeaders['content-length'] !== undefined) {
          const cl = parseInt(respHeaders['content-length'], 10);
          if (Number.isFinite(cl) && cl >= 0) contentLength = cl;
        }
        if (
          respHeaders['transfer-encoding'] &&
          respHeaders['transfer-encoding'].toLowerCase().includes('chunked')
        ) {
          isChunked = true;
        }

        if (method === 'HEAD' || statusCode === 204 || statusCode === 304) {
          return finish(null, {
            status: statusCode,
            headers: respHeaders,
            data: Buffer.alloc(0),
            url: urlStr,
          });
        }
      }

      if (headerParsed) {
        if (contentLength !== null && rawBuffer.length >= contentLength) {
          return finish(null, {
            status: statusCode,
            headers: respHeaders,
            data: rawBuffer.slice(0, contentLength),
            url: urlStr,
          });
        }
        if (isChunked && rawBuffer.includes(Buffer.from('0\r\n\r\n'))) {
          const decodedChunks = [];
          let offset = 0;
          while (offset < rawBuffer.length) {
            const lineEnd = rawBuffer.indexOf('\r\n', offset);
            if (lineEnd === -1) break;
            const sizeHex = rawBuffer.slice(offset, lineEnd).toString('ascii').split(';')[0].trim();
            const chunkSize = parseInt(sizeHex, 16);
            if (!Number.isFinite(chunkSize) || chunkSize === 0) break;
            const dataStart = lineEnd + 2;
            if (dataStart + chunkSize > rawBuffer.length) break;
            decodedChunks.push(rawBuffer.slice(dataStart, dataStart + chunkSize));
            offset = dataStart + chunkSize + 2;
          }
          return finish(null, {
            status: statusCode,
            headers: respHeaders,
            data: Buffer.concat(decodedChunks),
            url: urlStr,
          });
        }
      }
    });

    sock.on('end', () => {
      finish(null, { status: statusCode, headers: respHeaders, data: rawBuffer, url: urlStr });
    });
    sock.on('close', () => {
      finish(null, { status: statusCode, headers: respHeaders, data: rawBuffer, url: urlStr });
    });
    sock.on('error', (err) => {
      finish(err);
    });
  });
}

/**
 * Native HTTP/HTTPS request with redirect following, Content-Length immediate resolution,
 * and raw socket fallback.
 */
export async function nativeHttpRequest(urlStr, options = {}, redirectCount = 0) {
  if (redirectCount > 5) {
    throw new Error(`Too many redirects for ${urlStr}`);
  }
  const parsed = new URL(urlStr);
  const isHttps = parsed.protocol === 'https:';
  const lib = isHttps ? https : http;
  const method = (options.method || 'GET').toUpperCase();
  const timeoutMs = options.timeout || 8000;

  const headers = {
    'User-Agent': DEFAULT_UA,
    Accept: '*/*',
    ...(options.headers || {}),
  };

  try {
    const res = await new Promise((resolve, reject) => {
      let settled = false;
      const done = (err, val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(val);
      };

      const reqObj = lib.request(
        urlStr,
        {
          method,
          headers,
          rejectUnauthorized: false,
          timeout: timeoutMs,
        },
        (resp) => {
          const status = resp.statusCode || 200;
          const respHeaders = {};
          for (const [k, v] of Object.entries(resp.headers || {})) {
            respHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
          }

          if (method === 'HEAD') {
            resp.resume();
            return done(null, {
              status,
              headers: respHeaders,
              data: Buffer.alloc(0),
              url: urlStr,
            });
          }

          const expectedLen =
            respHeaders['content-length'] !== undefined
              ? parseInt(respHeaders['content-length'], 10)
              : null;

          const chunks = [];
          let received = 0;

          resp.on('data', (chunk) => {
            chunks.push(chunk);
            received += chunk.length;
            if (expectedLen !== null && Number.isFinite(expectedLen) && received >= expectedLen) {
              const full = Buffer.concat(chunks).slice(0, expectedLen);
              try {
                resp.destroy();
              } catch (_) {}
              return done(null, {
                status,
                headers: respHeaders,
                data: full,
                url: urlStr,
              });
            }
          });

          resp.on('end', () => {
            done(null, {
              status,
              headers: respHeaders,
              data: Buffer.concat(chunks),
              url: urlStr,
            });
          });

          resp.on('error', (err) => {
            if (chunks.length > 0 && expectedLen !== null && received >= expectedLen) {
              done(null, {
                status,
                headers: respHeaders,
                data: Buffer.concat(chunks).slice(0, expectedLen),
                url: urlStr,
              });
            } else {
              done(err);
            }
          });
        }
      );

      const timer = setTimeout(() => {
        try {
          reqObj.destroy(new Error(`Request timeout: ${urlStr}`));
        } catch (_) {}
      }, timeoutMs);

      reqObj.on('error', (err) => done(err));
      reqObj.end();
    });

    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.location) {
      const nextUrl = new URL(res.headers.location, urlStr).href;
      const nextHeaders = { ...(options.headers || {}) };
      return nativeHttpRequest(
        nextUrl,
        { ...options, method: res.status === 303 ? 'GET' : method, headers: nextHeaders },
        redirectCount + 1
      );
    }

    return res;
  } catch (_) {
    const rawRes = await rawSocketRequest(urlStr, options);
    if ([301, 302, 303, 307, 308].includes(rawRes.status) && rawRes.headers.location) {
      const nextUrl = new URL(rawRes.headers.location, urlStr).href;
      return nativeHttpRequest(nextUrl, options, redirectCount + 1);
    }
    return rawRes;
  }
}

function hasValidSiteContent(html) {
  if (!html) return false;
  return (
    html.includes('/video/') ||
    html.includes('/category/') ||
    html.includes('/vodplay/') ||
    html.includes('/play/') ||
    html.includes('vipPlayUrl') ||
    html.includes('__MAYI_PLAY_URL__') ||
    html.includes('player_') ||
    html.includes('decryptDatas') ||
    html.includes('.m3u8') ||
    html.includes('.mp4') ||
    html.includes('<iframe') ||
    html.includes('<video') ||
    html.includes('<h1') ||
    html.includes('eval(function(p,a,c,k,e,')
  );
}

async function fetchHtml(targetUrl, referer = '') {
  if (!targetUrl) return { code: 0, text: '', finalUrl: '' };

  const { isSiteRequest, urls: candidates } = expandCandidateUrls(targetUrl);
  let lastErr = '';
  let fallbackSuccess = null;

  for (const fullUrl of candidates) {
    let origin = activeDomain;
    try {
      origin = new URL(fullUrl).origin;
    } catch (_) {
      origin = activeDomain;
    }

    let effectiveReferer = referer || `${origin}/`;
    if (referer && isSiteRequest) {
      try {
        const refParsed = new URL(referer);
        if (refParsed.origin !== origin) {
          effectiveReferer = `${origin}${refParsed.pathname || '/'}${refParsed.search || ''}`;
        }
      } catch (_) {}
    }

    const headers = {
      'User-Agent': DEFAULT_UA,
      Referer: effectiveReferer,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await req.get(fullUrl, {
          headers,
          timeout: 8000,
          responseType: 'arraybuffer',
        });
        const status = resp?.status ?? resp?.statusCode ?? 200;
        const data = resp?.data ?? resp?.body ?? resp ?? '';
        const text = decodeBuffer(data, resp?.headers?.['content-encoding']);
        const redirectedUrl =
          resp?.url ||
          resp?.finalUrl ||
          resp?.request?.res?.responseUrl ||
          (resp?.headers?.location ? normalizeUrl(resp.headers.location, fullUrl) : '') ||
          fullUrl;

        if (status >= 200 && status < 400 && text) {
          if (!isSiteRequest || hasValidSiteContent(text)) {
            try {
              const finalOrigin = new URL(redirectedUrl).origin;
              if (isSiteRequest) activeDomain = finalOrigin;
            } catch (_) {
              if (isSiteRequest) activeDomain = origin;
            }
            return { code: status, text, finalUrl: redirectedUrl };
          }
          if (!fallbackSuccess) {
            fallbackSuccess = { code: status, text, finalUrl: redirectedUrl, origin };
          }
        }
      } catch (err) {
        lastErr = err?.message || String(err);
      }

      // Fallback to native HTTP transport if req.get failed or returned empty
      try {
        const natResp = await nativeHttpRequest(fullUrl, { headers, timeout: 8000 });
        const text = decodeBuffer(natResp.data, natResp.headers?.['content-encoding']);
        if (natResp.status >= 200 && natResp.status < 400 && text) {
          const finalUrl = natResp.url || fullUrl;
          if (!isSiteRequest || hasValidSiteContent(text)) {
            try {
              const finalOrigin = new URL(finalUrl).origin;
              if (isSiteRequest) activeDomain = finalOrigin;
            } catch (_) {}
            return { code: natResp.status, text, finalUrl };
          }
          if (!fallbackSuccess) {
            fallbackSuccess = { code: natResp.status, text, finalUrl, origin };
          }
        }
      } catch (err2) {
        lastErr = err2?.message || lastErr;
      }
    }
  }

  if (fallbackSuccess) {
    if (isSiteRequest && fallbackSuccess.origin) {
      activeDomain = fallbackSuccess.origin;
    }
    return {
      code: fallbackSuccess.code,
      text: fallbackSuccess.text,
      finalUrl: fallbackSuccess.finalUrl,
    };
  }

  return { code: -1, text: '', finalUrl: candidates[0] || targetUrl, err: lastErr };
}

function unwrapParams(inReq) {
  if (!inReq) return {};
  const merged = {};
  const isFastifyReq =
    typeof inReq === 'object' &&
    ('query' in inReq || 'body' in inReq || 'params' in inReq || 'server' in inReq || 'raw' in inReq);
  const sources = isFastifyReq
    ? [inReq.params, inReq.query, inReq.body]
    : [inReq.params, inReq.query, inReq.body, inReq];

  for (const src of sources) {
    if (!src) continue;
    if (typeof src === 'string') {
      const trimmed = src.trim();
      if (trimmed.startsWith('{')) {
        try {
          Object.assign(merged, JSON.parse(trimmed));
          continue;
        } catch (_) {}
      }
      try {
        const sp = new URLSearchParams(trimmed);
        for (const [k, v] of sp.entries()) merged[k] = v;
      } catch (_) {}
    } else if (typeof src === 'object') {
      for (const [k, v] of Object.entries(src)) {
        if (
          k !== 'query' &&
          k !== 'body' &&
          k !== 'params' &&
          k !== 'server' &&
          k !== 'raw' &&
          k !== 'headers' &&
          v !== undefined
        ) {
          merged[k] = v;
        }
      }
    }
  }
  return merged;
}

function extractCardTitle(innerHtml, fullAnchorHtml = '') {
  const titleRegex =
    /(?:title=["']([^"']+)["']|alt=["']([^"']+)["']|<div[^>]*class=["'][^"']*(?:title|name)[^"']*["'][^>]*>([\s\S]*?)<\/div>|<span[^>]*class=["'][^"']*(?:title|name)[^"']*["'][^>]*>([\s\S]*?)<\/span>|<p[^>]*class=["'][^"']*(?:title|name|sub-title)[^"']*["'][^>]*>([\s\S]*?)<\/p>|<h[2345][^>]*>([\s\S]*?)<\/h[2345]>)/i;
  const mInner = titleRegex.exec(innerHtml);
  if (mInner) {
    const raw =
      mInner[1] || mInner[2] || mInner[3] || mInner[4] || mInner[5] || mInner[6] || '';
    const cleaned = stripTags(raw);
    if (cleaned) return cleaned;
  }
  if (fullAnchorHtml) {
    const mAnchor = /<a[^>]+title=["']([^"']+)["']/i.exec(fullAnchorHtml);
    if (mAnchor && mAnchor[1]) {
      const cleaned = stripTags(mAnchor[1]);
      if (cleaned) return cleaned;
    }
  }
  return '';
}

function normalizeVodHref(rawHref) {
  if (!rawHref) return '';
  const trimmed = decodeHtmlEntities(String(rawHref)).trim();
  if (trimmed.startsWith('/')) return trimmed;
  try {
    const u = new URL(trimmed);
    if (/^\/(?:video|vodplay|play)\//i.test(u.pathname)) {
      return u.pathname + (u.search || '');
    }
  } catch (_) {}
  return trimmed;
}

export function parseVideoCards(html) {
  const items = [];
  if (!html) return items;

  const cardRegex =
    /<a[^>]+href=["']((?:https?:\/\/[^"'/]+)?\/(?:video|vodplay|play)\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const cardByHref = new Map();
  let match;

  while ((match = cardRegex.exec(html)) !== null) {
    const fullTag = match[0];
    const rawHref = normalizeVodHref(match[1]);
    const inner = match[2];
    if (!rawHref) continue;

    const rawPic = extractLazySrc(inner) || extractLazySrc(fullTag);
    const pic = rawPic ? normalizeUrl(rawPic) : '';

    let name = extractCardTitle(inner, fullTag);
    if (!name) {
      const plain = stripTags(inner);
      if (plain && plain.length >= 2 && !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(plain)) {
        name = plain.split(/\r?\n/)[0].trim();
      }
    }

    const durMatch = /class=["'][^"']*(?:duration|time|tag|remarks)[^"']*["'][^>]*>([\s\S]*?)</i.exec(
      inner
    );
    const remark = durMatch ? stripTags(durMatch[1]) : '';

    const existing = cardByHref.get(rawHref);
    if (existing) {
      if (!existing.vod_name && name) existing.vod_name = name;
      if (!existing.vod_pic && pic) existing.vod_pic = pic;
      if (remark && existing.vod_remarks === formatRemarks(BRAND_NAME, 'HD')) {
        existing.vod_remarks = formatRemarks(BRAND_NAME, remark);
      }
    } else {
      cardByHref.set(rawHref, {
        vod_id: rawHref,
        vod_name: name,
        vod_pic: pic,
        vod_remarks: formatRemarks(BRAND_NAME, remark || 'HD'),
        style: CARD_STYLE,
      });
    }
  }

  for (const item of cardByHref.values()) {
    if (item.vod_name && item.vod_id) {
      items.push(item);
    }
  }

  return items;
}

/**
 * Balanced-brace JSON extractor for CMS player variables (such as player_aaaa, player_data).
 * Avoids non-greedy regex truncation when nested objects like vod_data: {...} are present.
 */
export function extractBalancedJson(
  html,
  varNames = ['player_aaaa', 'player_data', 'player_config', 'MacPlayerConfig', 'mac_player']
) {
  if (!html) return null;
  for (const name of varNames) {
    let searchFrom = 0;
    while (searchFrom < html.length) {
      const idx = html.indexOf(name, searchFrom);
      if (idx === -1) break;
      searchFrom = idx + name.length;

      const eqIdx = html.indexOf('=', idx + name.length);
      if (eqIdx === -1 || eqIdx - (idx + name.length) > 20) continue;
      const braceStart = html.indexOf('{', eqIdx);
      if (braceStart === -1 || braceStart - eqIdx > 20) continue;

      let depth = 0;
      let inString = false;
      let quoteChar = '';
      let escaped = false;

      for (let i = braceStart; i < html.length; i++) {
        const ch = html[i];
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
        if (ch === '"' || ch === "'") {
          inString = true;
          quoteChar = ch;
          continue;
        }
        if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0) {
            const rawJson = html.slice(braceStart, i + 1);
            try {
              return JSON.parse(rawJson);
            } catch (_) {
              try {
                const normalized = rawJson
                  .replace(/,\s*([}\]])/g, '$1')
                  .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (__, inner) => {
                    return `"${inner.replace(/"/g, '\\"')}"`;
                  });
                return JSON.parse(normalized);
              } catch (__) {
                break;
              }
            }
          }
        }
      }
    }
  }
  return null;
}

/**
 * Custom unescape supporting both %uXXXX and %XX sequences (with multi-pass decode for double-encoded URLs).
 */
function customUnescape(str) {
  if (!str) return '';
  let cur = String(str);
  for (let pass = 0; pass < 2; pass++) {
    const s = cur.replace(/%u([0-9a-fA-F]{4})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
    let next = s;
    try {
      next = decodeURIComponent(s);
    } catch (_) {
      next = s.replace(/%([0-9a-fA-F]{2})/g, (__, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      );
    }
    if (next === cur) break;
    cur = next;
    if (!/%[0-9a-fA-F]{2}/i.test(cur)) break;
  }
  return cur;
}

function tryDecodeBase64Url(str) {
  if (!str) return '';
  const trimmed = String(str).trim();
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('//') || trimmed.startsWith('/')) {
    return trimmed;
  }
  if (/^[A-Za-z0-9+/=_-]{16,}$/.test(trimmed)) {
    try {
      const normalizedB64 = trimmed.replace(/-/g, '+').replace(/_/g, '/');
      const pad = '='.repeat((4 - (normalizedB64.length % 4)) % 4);
      const decoded = Buffer.from(normalizedB64 + pad, 'base64').toString('utf-8').trim();
      const unescaped = customUnescape(decoded).trim();
      if (
        /^https?:\/\//i.test(unescaped) ||
        unescaped.startsWith('//') ||
        unescaped.startsWith('/video/') ||
        unescaped.startsWith('/play/') ||
        /\.(?:m3u8|mp4)\b/i.test(unescaped)
      ) {
        return unescaped;
      }
    } catch (_) {}
  }
  return trimmed;
}

/**
 * Decode CMS player URL according to encrypt mode (0: plain/escaped, 1: escape, 2: base64+escape).
 */
export function decodeCmsUrl(rawUrl, encrypt = 0) {
  if (!rawUrl) return '';
  let url = String(rawUrl).trim();
  const enc = Number(encrypt || 0);

  if (enc === 2) {
    try {
      const unquoted = customUnescape(url);
      const decodedB64 = Buffer.from(unquoted, 'base64').toString('utf-8');
      url = customUnescape(decodedB64);
    } catch (_) {}
  } else if (enc === 1) {
    url = customUnescape(url);
  } else {
    url = tryDecodeBase64Url(url);
  }

  url = unescapeJsString(url).trim();
  return unwrapPlayerUrl(url);
}

/**
 * Unwrap wrapper player URLs (e.g., /player/index.html?url=https%3A%2F%2F...m3u8)
 * by checking pathname rather than full string suffix.
 */
export function unwrapPlayerUrl(candidateUrl, base = activeDomain) {
  if (!candidateUrl) return '';
  let cleaned = unescapeJsString(String(candidateUrl)).trim();
  if (isPlaceholderUri(cleaned)) return '';

  cleaned = tryDecodeBase64Url(cleaned);

  if (
    cleaned.includes('url=') ||
    cleaned.includes('v=') ||
    cleaned.includes('src=') ||
    cleaned.includes('play=') ||
    cleaned.includes('m3u8=') ||
    cleaned.includes('file=')
  ) {
    let isDirectMediaPath = false;
    try {
      const parsed = new URL(cleaned, base || activeDomain);
      const pathname = parsed.pathname.toLowerCase();
      isDirectMediaPath = /\.(m3u8|mp4|flv|mkv|ts)(\b|$)/i.test(pathname);
    } catch (_) {
      isDirectMediaPath = false;
    }

    if (!isDirectMediaPath) {
      const paramMatch = /[?&](?:url|v|play|src|m3u8|file)=([^&#]+)/i.exec(cleaned);
      const rawInner = paramMatch
        ? paramMatch[1]
        : cleaned.includes('url=')
          ? cleaned.split('url=')[1].split('&')[0]
          : '';
      if (rawInner) {
        const decodedInner = unescapeJsString(tryDecodeBase64Url(customUnescape(rawInner))).trim();
        if (
          decodedInner.startsWith('http') ||
          decodedInner.startsWith('//') ||
          (decodedInner.startsWith('/') && /\.(?:m3u8|mp4|flv|mkv|ts)\b/i.test(decodedInner))
        ) {
          return normalizeUrl(decodedInner, base);
        }
      }
    }
  }

  return normalizeUrl(cleaned, base);
}

export function isDirectMediaUrl(url) {
  if (!url) return false;
  const cleaned = unescapeJsString(String(url)).split('@@@')[0].trim();
  if (isPlaceholderUri(cleaned)) return false;
  try {
    const parsed = new URL(normalizeUrl(cleaned));
    const pathname = parsed.pathname.toLowerCase();
    if (/\.(m3u8|mp4|flv|mkv|ts|mpd)(\b|$)/i.test(pathname)) {
      return true;
    }
    if (!/\.(?:html?|php|asp|aspx|jsp)$/i.test(pathname)) {
      if (/(?:\.m3u8|\.mp4|\bformat=m3u8|\bstreamhls\b)/i.test(parsed.search)) {
        return true;
      }
    }
    return false;
  } catch (_) {
    const low = cleaned.toLowerCase().split('?')[0];
    return /\.(m3u8|mp4|flv|mkv|ts|mpd)$/.test(low);
  }
}

export function isM3u8Url(url) {
  if (!url) return false;
  const cleaned = String(url).split('@@@')[0].trim();
  try {
    const parsed = new URL(normalizeUrl(cleaned));
    return (
      /\.m3u8(\b|$)/i.test(parsed.pathname) || /(?:\bformat=m3u8|\.m3u8)/i.test(parsed.search)
    );
  } catch (_) {
    return /\.m3u8(\b|$|\?)/i.test(cleaned);
  }
}

function md5Hex(str) {
  return crypto.createHash('md5').update(String(str), 'utf8').digest('hex');
}

/**
 * Decrypts outer Base64 + AES-CTR / AES-CBC encrypted player manifests (`decryptDatas`).
 * Supports both `{ encryptedData/data/cipher, iv, key }` envelopes and `{ media, user_id, slug, md5_id }` envelopes.
 */
export function decryptDatas(rawPayload, keyStr = '') {
  if (!rawPayload) return null;
  const trimmed = String(rawPayload).trim();

  // Try direct JSON first
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch (_) {}
  }

  // Decode outer Base64 trying UTF-8 first, then Latin-1 fallback
  const outerCandidates = [];
  try {
    const utf8Str = Buffer.from(trimmed, 'base64').toString('utf8');
    if (utf8Str) outerCandidates.push(utf8Str);
  } catch (_) {}
  try {
    const latin1Str = Buffer.from(trimmed, 'base64').toString('latin1');
    if (latin1Str && !outerCandidates.includes(latin1Str)) {
      outerCandidates.push(latin1Str);
    }
  } catch (_) {}

  const buildKeyVariants = (rawK) => {
    if (!rawK) return [];
    const buf = Buffer.isBuffer(rawK) ? rawK : Buffer.from(String(rawK), 'utf8');
    const variants = [];
    const addKey = (kBuf) => {
      if (!kBuf || ![16, 24, 32].includes(kBuf.length)) return;
      const algo = `aes-${kBuf.length * 8}-ctr`;
      if (!variants.some((v) => v.key.equals(kBuf))) {
        variants.push({ key: kBuf, algo, cbcAlgo: `aes-${kBuf.length * 8}-cbc` });
      }
    };
    addKey(buf);
    if (buf.length > 32) addKey(buf.slice(0, 32));
    if (buf.length > 24) addKey(buf.slice(0, 24));
    if (buf.length > 16) addKey(buf.slice(0, 16));
    if (buf.length < 16 && buf.length > 0) {
      const padded = Buffer.alloc(16);
      buf.copy(padded);
      addKey(padded);
    }
    return variants;
  };

  const extraKeys = Array.isArray(keyStr) ? keyStr : [keyStr];
  const keyVariants = [];
  for (const k of extraKeys) {
    for (const v of buildKeyVariants(k)) {
      if (!keyVariants.some((existing) => existing.key.equals(v.key))) {
        keyVariants.push(v);
      }
    }
  }

  for (const candidate of outerCandidates) {
    let envelope = null;
    try {
      envelope = JSON.parse(candidate);
    } catch (_) {
      continue;
    }
    if (!envelope || typeof envelope !== 'object') continue;
    if (envelope.sources || envelope.url || envelope.video || envelope.mp4) {
      return envelope;
    }

    // Handle `{ media, user_id, slug, md5_id }` format
    if (envelope.media && envelope.user_id !== undefined && envelope.slug && envelope.md5_id) {
      try {
        const derivedMd5 = md5Hex(`${envelope.user_id}:${envelope.slug}:${envelope.md5_id}`);
        const aesKey = Buffer.from(derivedMd5, 'utf8');
        const ivBuf = aesKey.subarray(0, 16);
        const decipher = crypto.createDecipheriv('aes-256-ctr', aesKey, ivBuf);
        const decBuf = Buffer.concat([
          decipher.update(Buffer.from(String(envelope.media), 'latin1')),
          decipher.final(),
        ]);
        const decText = decBuf.toString('utf8').trim();
        if (decText.startsWith('{') || decText.startsWith('[')) {
          return JSON.parse(decText);
        }
      } catch (_) {}
    }

    const cipherTextStr =
      envelope.encryptedData || envelope.data || envelope.cipher || envelope.media || '';
    const ivHexOrB64 = envelope.iv || '';
    const inlineKey = envelope.key || '';
    const activeKeys = inlineKey
      ? [...buildKeyVariants(inlineKey), ...keyVariants]
      : keyVariants;

    if (!cipherTextStr || activeKeys.length === 0) continue;

    let ivBuf = null;
    if (ivHexOrB64) {
      if (/^[0-9a-fA-F]{32}$/.test(ivHexOrB64)) {
        ivBuf = Buffer.from(ivHexOrB64, 'hex');
      } else {
        const b64Iv = Buffer.from(ivHexOrB64, 'base64');
        if (b64Iv.length === 16) ivBuf = b64Iv;
        else {
          const utfIv = Buffer.from(String(ivHexOrB64), 'utf8');
          if (utfIv.length >= 16) ivBuf = utfIv.slice(0, 16);
        }
      }
    }

    // Ciphertext inside JSON envelope may be Latin-1 binary string or Base64
    const cipherBufs = [Buffer.from(String(cipherTextStr), 'latin1')];
    try {
      const b64Buf = Buffer.from(String(cipherTextStr), 'base64');
      if (b64Buf.length > 0) cipherBufs.push(b64Buf);
    } catch (_) {}

    for (const cBuf of cipherBufs) {
      for (const { key, algo, cbcAlgo } of activeKeys) {
        const candidateIvs = ivBuf ? [ivBuf] : [Buffer.alloc(16, 0), key.subarray(0, 16)];
        for (const curIv of candidateIvs) {
          for (const mode of [algo, cbcAlgo]) {
            try {
              const decipher = crypto.createDecipheriv(mode, key, curIv);
              if (mode.endsWith('-cbc')) decipher.setAutoPadding(true);
              const decBuf = Buffer.concat([decipher.update(cBuf), decipher.final()]);
              const decText = decBuf.toString('utf8').trim();
              if (decText.startsWith('{') || decText.startsWith('[')) {
                return JSON.parse(decText);
              }
            } catch (_) {}
          }
        }
      }
    }
  }

  return null;
}

/**
 * Extracts normalized stream metadata (including fallback size aggregation and filename path resolution)
 * from a decrypted player manifest object.
 */
export function parseDecryptedManifest(manifest, baseUrl = activeDomain) {
  if (!manifest || typeof manifest !== 'object') return null;

  const extractPathFilename = (rawUrl) => {
    if (!rawUrl) return '';
    try {
      const u = new URL(normalizeUrl(rawUrl, baseUrl));
      const parts = u.pathname.split('/').filter(Boolean);
      return parts[parts.length - 1] || '';
    } catch (_) {
      const clean = String(rawUrl).split('?')[0].split('#')[0];
      const parts = clean.split('/').filter(Boolean);
      return parts[parts.length - 1] || '';
    }
  };

  // Handle nested `manifest.mp4` structure (`{ mp4: { sources: [...], fristDatas: [...] } }`)
  if (manifest.mp4 && typeof manifest.mp4 === 'object') {
    const mp4Obj = manifest.mp4;
    const fd = Array.isArray(mp4Obj.fristDatas) ? mp4Obj.fristDatas : [];
    const fallbackSize = Number(fd[0]?.size || 0);
    let chosen = null;
    for (const s0 of mp4Obj.sources || []) {
      if (s0 && (s0.status === undefined || s0.status) && s0.url) {
        chosen = s0;
        break;
      }
    }
    if (!chosen && fd[0] && fd[0].url) {
      chosen = fd[0];
    }
    if (chosen) {
      const fullUrl = chosen.path
        ? `${String(chosen.url).replace(/\/+$/, '')}/${String(chosen.path).replace(/^\/+/, '')}`
        : normalizeUrl(chosen.url, baseUrl);
      const fn = extractPathFilename(chosen.path || fullUrl);
      const derivedKey = chosen.key || (fn ? md5Hex(fn) : '');
      const derivedIv =
        chosen.iv || (derivedKey ? Buffer.from(derivedKey, 'utf8').subarray(0, 16) : '');
      return {
        url: fullUrl,
        filename: fn,
        size: Number(chosen.size || fallbackSize || 0),
        key: derivedKey,
        iv: derivedIv,
        encLen: Number(chosen.encLen ?? manifest.encLen ?? 65536),
      };
    }
  }

  // Build size map from secondary manifest arrays (videos, backup, list, files, fristDatas)
  const fallbackSizeMap = new Map();
  let firstFallbackSize = 0;
  const secondaryArrays = [
    manifest.videos,
    manifest.backup,
    manifest.list,
    manifest.files,
    manifest.fristDatas,
  ].filter(Array.isArray);
  for (const arr of secondaryArrays) {
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const itemSize = Number(item.size || item.fileSize || item.totalSize || 0);
      if (itemSize > 0) {
        if (!firstFallbackSize) firstFallbackSize = itemSize;
        const u = item.url || item.src || item.file || item.name || item.path || '';
        const fn = extractPathFilename(u);
        if (fn) fallbackSizeMap.set(fn, itemSize);
      }
    }
  }

  const primarySources = Array.isArray(manifest.sources)
    ? manifest.sources
    : manifest.video && Array.isArray(manifest.video.sources)
      ? manifest.video.sources
      : manifest.url || manifest.src || manifest.file
        ? [manifest]
        : [];

  for (const srcObj of primarySources) {
    if (!srcObj) continue;
    let rawUrl =
      typeof srcObj === 'string' ? srcObj : srcObj.url || srcObj.src || srcObj.file || '';
    if (!rawUrl) continue;
    if (typeof srcObj === 'object' && srcObj.path && !rawUrl.endsWith(srcObj.path)) {
      rawUrl = `${String(rawUrl).replace(/\/+$/, '')}/${String(srcObj.path).replace(/^\/+/, '')}`;
    }
    const fullUrl = normalizeUrl(rawUrl, baseUrl);
    if (!fullUrl) continue;
    const fn = extractPathFilename(fullUrl);
    const size =
      Number(srcObj.size || srcObj.fileSize || manifest.size || 0) ||
      (fn && fallbackSizeMap.get(fn)) ||
      firstFallbackSize ||
      0;

    return {
      url: fullUrl,
      filename: fn,
      size,
      key: srcObj.key || manifest.key || manifest.decKey || '',
      iv: srcObj.iv || manifest.iv || manifest.decIv || '',
      encLen: Number(srcObj.encLen ?? manifest.encLen ?? manifest.encryptLength ?? 0),
    };
  }

  return null;
}

/**
 * Unpack Dean Edwards Packer blocks: eval(function(p,a,c,k,e,d){...}('payload',radix,count,'dict'.split('|')))
 * Supports both single and double quotes, escaped quotes in payload, and optional trailing arguments.
 */
export function unpackPacker(html) {
  if (!html || !html.includes('eval(function(p,a,c,k,e,')) return '';
  const packerRegex =
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(\s*['"]\|['"]\s*\)/g;

  const unpackedBlocks = [];
  let match;

  const encodeBase = (num, radix) => {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (num < radix) return num < 36 ? num.toString(36) : chars[num];
    return (
      encodeBase(Math.floor(num / radix), radix) +
      (num % radix < 36 ? (num % radix).toString(36) : chars[num % radix])
    );
  };

  while ((match = packerRegex.exec(html)) !== null) {
    const rawPayload = match[2]
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
    const radix = parseInt(match[3], 10);
    const count = parseInt(match[4], 10);
    const symtab = match[6].split('|');

    const dict = new Map();
    for (let i = 0; i < count; i++) {
      const token = encodeBase(i, radix);
      dict.set(token, symtab[i] || token);
    }

    const unpacked = rawPayload.replace(/\b[0-9a-zA-Z_]+\b/g, (word) =>
      dict.has(word) ? dict.get(word) : word
    );
    unpackedBlocks.push(unpacked);
  }

  return unpackedBlocks.join('\n');
}

/**
 * Core stream extractor from HTML content (Stage 1 - Stage 3).
 */
export function extractPlayStreamFromHtml(html, baseUrl = activeDomain) {
  if (!html) return '';

  const fallbackWrapperUrls = [];

  // 1a-priority: Primary 红裹视频 / 蚂蚁 player variables (`vipPlayUrl`, `window.__MAYI_PLAY_URL__`, `window.__PLAY_URL__`)
  const priorityPatterns = [
    /["']?vipPlayUrl["']?\s*[:=]\s*["']([^"']+)["']/gi,
    /window\.(?:__MAYI_PLAY_URL__|__PLAY_URL__)\s*=\s*["']([^"']+)["']/gi,
  ];
  for (const regex of priorityPatterns) {
    let m;
    while ((m = regex.exec(html)) !== null) {
      if (!m[1] || isPlaceholderUri(m[1])) continue;
      const unwrapped = unwrapPlayerUrl(m[1], baseUrl);
      if (isDirectMediaUrl(unwrapped) && !isBadMediaUrl(unwrapped)) {
        return unwrapped;
      }
      if (unwrapped.startsWith('http')) {
        fallbackWrapperUrls.push(unwrapped);
      }
    }
  }

  // 1a-secondary: Other player stream variable assignments (must resolve to a direct media URL)
  const secondaryVarPatterns = [
    /["']?\b(?:m3u8Url|hlsUrl|playUrl|videoUrl|video_url|play_url|mp4Url|normalPlayUrl|freePlayUrl)\b["']?\s*[:=]\s*["']([^"']+)["']/gi,
    /window\.(?:playUrl|videoUrl)\s*=\s*["']([^"']+)["']/gi,
    /MacPlayer\.PlayUrl\s*=\s*["']([^"']+)["']/gi,
    /\bdp_video_url\s*=\s*["']([^"']+)["']/gi,
  ];
  for (const regex of secondaryVarPatterns) {
    let m;
    while ((m = regex.exec(html)) !== null) {
      if (!m[1] || isPlaceholderUri(m[1])) continue;
      const unwrapped = unwrapPlayerUrl(m[1], baseUrl);
      if (isDirectMediaUrl(unwrapped) && !isBadMediaUrl(unwrapped)) {
        return unwrapped;
      }
    }
  }

  // 1b. Encrypted player manifest (`decryptDatas(datas, key)` or `datas = "..."`)
  const rawPayloads = [];
  const callRegex = /decryptDatas\s*\(\s*["']([A-Za-z0-9+/=_-]{24,})["'](?:\s*,\s*["']([^"']+)["'])?\s*\)/gi;
  let cm;
  while ((cm = callRegex.exec(html)) !== null) {
    rawPayloads.push({ payload: cm[1], inlineKey: cm[2] || '' });
  }
  const dataVarRegex = /\b(?:datas|encryptedData|__DATA__)\s*=\s*["']([A-Za-z0-9+/=_-]{24,})["']/gi;
  let dm;
  while ((dm = dataVarRegex.exec(html)) !== null) {
    rawPayloads.push({ payload: dm[1], inlineKey: '' });
  }

  if (rawPayloads.length > 0) {
    const candidateKeys = [];
    const callWithVarKeyRegex = /decryptDatas\s*\(\s*[a-zA-Z0-9_$]+\s*,\s*["']([^"']+)["']\s*\)/gi;
    let ckm;
    while ((ckm = callWithVarKeyRegex.exec(html)) !== null) {
      if (ckm[1]) candidateKeys.push(ckm[1]);
    }
    const keyRegex = /\b(?:key|decKey|aesKey|secret|rawKey|cryptoKey)\b\s*[:=]\s*["']([^"']{8,64})["']/gi;
    let km;
    while ((km = keyRegex.exec(html)) !== null) {
      if (km[1] && !candidateKeys.includes(km[1])) candidateKeys.push(km[1]);
    }
    const utf8ParseRegex = /(?:Utf8\.parse|TextEncoder\(\)\.encode|Buffer\.from)\(\s*["']([^"']{8,64})["']/gi;
    let um;
    while ((um = utf8ParseRegex.exec(html)) !== null) {
      if (um[1] && !candidateKeys.includes(um[1])) candidateKeys.push(um[1]);
    }

    for (const { payload, inlineKey } of rawPayloads) {
      const allKeys = inlineKey ? [inlineKey, ...candidateKeys] : candidateKeys;
      const manifest = decryptDatas(payload, allKeys);
      const parsedManifest = parseDecryptedManifest(manifest, baseUrl);
      if (parsedManifest && parsedManifest.url) {
        const sid = registerStreamSession({
          ...parsedManifest,
          referer: baseUrl,
        });
        setCache(parsedManifest.url, parsedManifest.url, baseUrl, getStreamSession(sid));
        return parsedManifest.url;
      }
    }
  }

  // 1c. Balanced-brace CMS player object (player_aaaa / player_data / player_config)
  const cmsPlayer = extractBalancedJson(html);
  if (cmsPlayer && (cmsPlayer.url || cmsPlayer.playurl)) {
    const decoded = decodeCmsUrl(cmsPlayer.url || cmsPlayer.playurl, cmsPlayer.encrypt);
    if (isDirectMediaUrl(decoded) || decoded.startsWith('http')) {
      return decoded;
    }
  }

  // 1d. HTML5 <video> or <source> tags (supporting lazy attributes)
  const mediaTagRegex = /<(?:video|source)\b[^>]*>/gi;
  let tagMatch;
  while ((tagMatch = mediaTagRegex.exec(html)) !== null) {
    const candidate = extractLazySrc(tagMatch[0]);
    if (candidate) {
      const unwrapped = unwrapPlayerUrl(candidate, baseUrl);
      if (isDirectMediaUrl(unwrapped) && !isBadMediaUrl(unwrapped)) return unwrapped;
    }
  }

  // 2. Unpack eval(function(p,a,c,k,e,d)...) blocks and inspect recursively
  const unpacked = unpackPacker(html);
  if (unpacked) {
    const fromUnpacked = extractPlayStreamFromHtml(unpacked, baseUrl);
    if (fromUnpacked && isDirectMediaUrl(fromUnpacked)) {
      return fromUnpacked;
    }
    const normalizedUnpacked = unescapeJsString(unpacked);
    const unpackedDirect = /(https?:\/\/[^\s"'<>\\]+\.(?:m3u8|mp4)[^\s"'<>\\]*)/i.exec(
      normalizedUnpacked
    );
    if (unpackedDirect && !isBadMediaUrl(unpackedDirect[1])) {
      return unwrapPlayerUrl(unpackedDirect[1], baseUrl);
    }
  }

  // 3. Direct m3u8 / mp4 regex after normalizing escaped slashes and unicode escapes
  const normalizedHtml = unescapeJsString(html);

  const m3u8Regex = /(https?:\/\/(?:(?!localhost|127\.0\.0\.1)[^\s"'<>\\])+\.m3u8[^\s"'<>\\]*)/gi;
  let m3u8Match;
  while ((m3u8Match = m3u8Regex.exec(normalizedHtml)) !== null) {
    const cand = unwrapPlayerUrl(m3u8Match[1], baseUrl);
    if (!isBadMediaUrl(cand)) return cand;
  }

  const mp4Regex = /(https?:\/\/(?:(?!localhost|127\.0\.0\.1)[^\s"'<>\\])+\.mp4[^\s"'<>\\]*)/gi;
  let mp4Match;
  while ((mp4Match = mp4Regex.exec(normalizedHtml)) !== null) {
    const cand = unwrapPlayerUrl(mp4Match[1], baseUrl);
    if (!isBadMediaUrl(cand)) return cand;
  }

  if (fallbackWrapperUrls.length > 0) {
    return fallbackWrapperUrls[0];
  }

  return '';
}

/**
 * Full multi-stage playback resolver including iframe following, redirect tracking,
 * and alternate route fallback. Returns { url, referer, session }.
 */
async function resolveStreamMetaFromPage(targetUrl, preloadedHtml = '', preloadedFinalUrl = '') {
  const fullUrl = normalizeUrl(targetUrl);
  const cachedMeta = getCacheMeta(targetUrl) || getCacheMeta(fullUrl);
  if (cachedMeta && cachedMeta.url && isDirectMediaUrl(cachedMeta.url)) {
    return cachedMeta;
  }

  let html = preloadedHtml;
  let pageUrl = preloadedFinalUrl || fullUrl;
  if (!html) {
    const res = await fetchHtml(targetUrl);
    html = res.text || '';
    pageUrl = res.finalUrl || normalizeUrl(targetUrl);
  }

  let pageOrigin = activeDomain;
  try {
    pageOrigin = new URL(pageUrl).origin;
  } catch (_) {}
  const pageReferer = `${pageOrigin}/`;

  if (!html) return { url: '', referer: pageReferer, session: null };

  // Stages 1-3: Direct / CMS / Encrypted / Packer extraction on the page
  let stream = extractPlayStreamFromHtml(html, pageUrl);
  if (stream && isDirectMediaUrl(stream)) {
    const existingMeta = getCacheMeta(stream);
    const session = existingMeta?.session || null;
    setCache(fullUrl, stream, pageReferer, session);
    setCache(targetUrl, stream, pageReferer, session);
    setCache(stream, stream, pageReferer, session);
    return { url: stream, referer: pageReferer, session };
  }

  // If Stage 1a returned a non-direct wrapper URL (e.g. window.__MAYI_PLAY_URL__ = "https://.../player?id=..."), try fetching it
  if (stream && stream.startsWith('http') && !isDirectMediaUrl(stream)) {
    const wrapperRes = await fetchHtml(stream, pageUrl);
    if (wrapperRes.text) {
      const wrapperFinalUrl = wrapperRes.finalUrl || stream;
      let wrapperOrigin = pageOrigin;
      try {
        wrapperOrigin = new URL(wrapperFinalUrl).origin;
      } catch (_) {}
      const wrapperReferer = `${wrapperOrigin}/`;
      const innerStream = extractPlayStreamFromHtml(wrapperRes.text, wrapperFinalUrl);
      if (innerStream && isDirectMediaUrl(innerStream)) {
        const existingMeta = getCacheMeta(innerStream);
        const session = existingMeta?.session || null;
        setCache(fullUrl, innerStream, wrapperReferer, session);
        setCache(targetUrl, innerStream, wrapperReferer, session);
        setCache(innerStream, innerStream, wrapperReferer, session);
        return { url: innerStream, referer: wrapperReferer, session };
      }
    }
  }

  // Stage 4: Check embedded <iframe ...> supporting lazy-load attributes and HTML entities
  const iframeTagRegex = /<iframe\b[^>]*>/gi;
  let iframeMatch;
  while ((iframeMatch = iframeTagRegex.exec(html)) !== null) {
    const rawSrc = extractLazySrc(iframeMatch[0]);
    if (!rawSrc || isPlaceholderUri(rawSrc)) continue;
    const unwrappedSrc = unwrapPlayerUrl(rawSrc, pageUrl);
    if (isDirectMediaUrl(unwrappedSrc)) {
      setCache(fullUrl, unwrappedSrc, pageReferer);
      setCache(targetUrl, unwrappedSrc, pageReferer);
      setCache(unwrappedSrc, unwrappedSrc, pageReferer);
      return { url: unwrappedSrc, referer: pageReferer, session: null };
    }
    const iframeUrl = normalizeUrl(rawSrc, pageUrl);
    const iframeRes = await fetchHtml(iframeUrl, pageUrl);
    if (iframeRes.text) {
      const iframeFinalUrl = iframeRes.finalUrl || iframeUrl;
      let iframeOrigin = pageOrigin;
      try {
        iframeOrigin = new URL(iframeFinalUrl).origin;
      } catch (_) {}
      const iframeReferer = `${iframeOrigin}/`;
      const iframeStream = extractPlayStreamFromHtml(iframeRes.text, iframeFinalUrl);
      if (iframeStream && isDirectMediaUrl(iframeStream)) {
        const existingMeta = getCacheMeta(iframeStream);
        const session = existingMeta?.session || null;
        setCache(fullUrl, iframeStream, iframeReferer, session);
        setCache(targetUrl, iframeStream, iframeReferer, session);
        setCache(iframeStream, iframeStream, iframeReferer, session);
        return { url: iframeStream, referer: iframeReferer, session };
      }
    }
  }

  // Stage 5: Alternate play route discovery (if URL has sid/1/nid/1 or alternate /vodplay/ or /play/ route)
  const altRouteRegex = /href=["']([^"']*(?:\/vodplay\/|\/play\/|sid\/\d+\/nid\/\d+)[^"']*)["']/gi;
  let altMatch;
  const triedRoutes = new Set([fullUrl, targetUrl, pageUrl]);
  while ((altMatch = altRouteRegex.exec(html)) !== null) {
    const altHref = normalizeUrl(altMatch[1], pageUrl);
    if (!altHref || triedRoutes.has(altHref)) continue;
    triedRoutes.add(altHref);
    const altRes = await fetchHtml(altHref, pageUrl);
    if (altRes.text) {
      const altFinalUrl = altRes.finalUrl || altHref;
      let altOrigin = pageOrigin;
      try {
        altOrigin = new URL(altFinalUrl).origin;
      } catch (_) {}
      const altReferer = `${altOrigin}/`;
      const altStream = extractPlayStreamFromHtml(altRes.text, altFinalUrl);
      if (altStream && isDirectMediaUrl(altStream)) {
        const existingMeta = getCacheMeta(altStream);
        const session = existingMeta?.session || null;
        setCache(fullUrl, altStream, altReferer, session);
        setCache(targetUrl, altStream, altReferer, session);
        setCache(altStream, altStream, altReferer, session);
        return { url: altStream, referer: altReferer, session };
      }
    }
  }

  return { url: stream || '', referer: pageReferer, session: null };
}

/**
 * AES-CTR counter increment helper for arbitrary byte offset decryption.
 */
function incrementIvCounter(ivBuf, blockOffset) {
  const counter = Buffer.from(ivBuf);
  let carry = BigInt(blockOffset);
  for (let i = 15; i >= 0 && carry > 0n; i--) {
    const sum = BigInt(counter[i]) + (carry & 0xffn);
    counter[i] = Number(sum & 0xffn);
    carry = (carry >> 8n) + (sum >> 8n);
  }
  return counter;
}

/**
 * Decrypts a slice [start, end] of an AES-CTR stream (supporting partial encryption `encLen`
 * or full-file encryption).
 */
export function decryptRangeSlice(rawSlice, startOffset, keyStr, ivStr, encLen = 0) {
  if (!rawSlice || rawSlice.length === 0 || !keyStr) return rawSlice;
  const totalSliceLen = rawSlice.length;
  const effectiveEncLen = encLen > 0 ? encLen : startOffset + totalSliceLen;

  if (startOffset >= effectiveEncLen) {
    return rawSlice;
  }

  let keyBuf = Buffer.isBuffer(keyStr) ? keyStr : Buffer.from(String(keyStr), 'utf8');
  if (![16, 24, 32].includes(keyBuf.length)) {
    if (keyBuf.length > 32) keyBuf = keyBuf.slice(0, 32);
    else if (keyBuf.length > 24) keyBuf = keyBuf.slice(0, 24);
    else if (keyBuf.length > 16) keyBuf = keyBuf.slice(0, 16);
    else {
      const padded = Buffer.alloc(16);
      keyBuf.copy(padded);
      keyBuf = padded;
    }
  }
  const algo = `aes-${keyBuf.length * 8}-ctr`;

  let ivBuf = Buffer.alloc(16, 0);
  if (ivStr) {
    if (Buffer.isBuffer(ivStr) && ivStr.length === 16) {
      ivBuf = ivStr;
    } else if (/^[0-9a-fA-F]{32}$/.test(String(ivStr))) {
      ivBuf = Buffer.from(String(ivStr), 'hex');
    } else {
      const b64 = Buffer.from(String(ivStr), 'base64');
      if (b64.length === 16) ivBuf = b64;
      else {
        const u8 = Buffer.from(String(ivStr), 'utf8');
        if (u8.length >= 16) ivBuf = u8.slice(0, 16);
      }
    }
  }

  const encryptedBytesInSlice = Math.min(totalSliceLen, effectiveEncLen - startOffset);
  const encPart = rawSlice.slice(0, encryptedBytesInSlice);
  const plainPart = rawSlice.slice(encryptedBytesInSlice);

  const blockIndex = Math.floor(startOffset / 16);
  const byteOffsetInBlock = startOffset % 16;
  const counterIv = incrementIvCounter(ivBuf, blockIndex);

  const paddedInput =
    byteOffsetInBlock > 0 ? Buffer.concat([Buffer.alloc(byteOffsetInBlock, 0), encPart]) : encPart;
  const decipher = crypto.createDecipheriv(algo, keyBuf, counterIv);
  const decPadded = Buffer.concat([decipher.update(paddedInput), decipher.final()]);
  const decPart = decPadded.slice(byteOffsetInBlock, byteOffsetInBlock + encryptedBytesInSlice);

  return plainPart.length > 0 ? Buffer.concat([decPart, plainPart]) : decPart;
}

/**
 * Rewrites M3U8 playlist lines and URI="..." attributes so all segments (.ts, .m4s, disguised .jpg/.png),
 * sub-playlists (.m3u8), and encryption keys (#EXT-X-KEY) route through the local proxy.
 */
export function rewriteM3u8Manifest(m3u8Text, manifestUrl, proxyBaseUrl, referer = '') {
  if (!m3u8Text) return '';
  const lines = String(m3u8Text).split(/\r?\n/);

  const wrapTarget = (rawTarget, isSegmentHint = false) => {
    const absUrl = normalizeUrl(rawTarget, manifestUrl);
    if (!absUrl) return rawTarget;
    const isSubM3u8 = isM3u8Url(absUrl);
    const baseEndpoint = isSubM3u8
      ? proxyBaseUrl.replace(/\.(?:mp4|m3u8|ts)$/i, '.m3u8')
      : proxyBaseUrl.replace(/\.(?:mp4|m3u8|ts)$/i, '');
    const sep = baseEndpoint.includes('?') ? '&' : '?';
    const typeParam = !isSubM3u8 && isSegmentHint ? '&type=ts' : '';
    return `${baseEndpoint}${sep}url=${encodeURIComponent(absUrl)}&referer=${encodeURIComponent(
      referer || `${activeDomain}/`
    )}${typeParam}`;
  };

  let expectSubPlaylist = false;
  const rewritten = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
        expectSubPlaylist = true;
      }
      return line.replace(/URI=["']([^"']+)["']/gi, (_, uriVal) => {
        return `URI="${wrapTarget(uriVal, true)}"`;
      });
    }
    const isSeg = !expectSubPlaylist && !isM3u8Url(trimmed);
    expectSubPlaylist = false;
    return wrapTarget(trimmed, isSeg);
  });

  return rewritten.join('\n');
}

/**
 * Parses an HTTP Range header (`bytes=start-end`, `bytes=start-`, `bytes=-suffix`)
 * against a known `totalSize`.
 */
function parseHttpRange(rangeHeader, totalSize) {
  if (!rangeHeader || !/^bytes=/i.test(String(rangeHeader).trim())) {
    return null;
  }
  const spec = String(rangeHeader)
    .trim()
    .replace(/^bytes=/i, '')
    .split(',')[0]
    .trim();
  const dashIdx = spec.indexOf('-');
  if (dashIdx === -1) return null;

  const startStr = spec.slice(0, dashIdx).trim();
  const endStr = spec.slice(dashIdx + 1).trim();

  if (startStr === '') {
    const suffixLen = parseInt(endStr, 10);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return { invalid: true };
    if (totalSize <= 0) return { start: 0, end: suffixLen - 1 };
    const start = Math.max(0, totalSize - suffixLen);
    return { start, end: totalSize - 1 };
  }

  const start = parseInt(startStr, 10);
  if (!Number.isFinite(start) || start < 0) return { invalid: true };
  if (totalSize > 0 && start >= totalSize) return { invalid: true };

  let end = endStr
    ? parseInt(endStr, 10)
    : totalSize > 0
      ? totalSize - 1
      : start + MAX_SLICE_BYTES - 1;
  if (!Number.isFinite(end) || end < start) return { invalid: true };
  if (totalSize > 0 && end >= totalSize) {
    end = totalSize - 1;
  }

  return { start, end };
}

/**
 * Probes upstream media total byte size via Range: bytes=0-0 or HEAD request.
 */
const SIZE_CACHE = new Map();
async function probeUpstreamSize(targetUrl, referer) {
  if (SIZE_CACHE.has(targetUrl)) return SIZE_CACHE.get(targetUrl);
  const headers = {
    'User-Agent': DEFAULT_UA,
    Referer: referer || `${activeDomain}/`,
    Range: 'bytes=0-0',
  };
  try {
    const res = await nativeHttpRequest(targetUrl, { method: 'GET', headers, timeout: 8000 });
    const cr = res.headers['content-range'] || '';
    const crMatch = /\/(\d+)$/.exec(cr);
    if (crMatch) {
      const total = parseInt(crMatch[1], 10);
      if (total > 0) {
        SIZE_CACHE.set(targetUrl, total);
        return total;
      }
    }
    const cl = parseInt(res.headers['content-length'] || '0', 10);
    if (res.status === 200 && cl > 0) {
      SIZE_CACHE.set(targetUrl, cl);
      return cl;
    }
  } catch (_) {}

  try {
    const headRes = await nativeHttpRequest(targetUrl, {
      method: 'HEAD',
      headers: { 'User-Agent': DEFAULT_UA, Referer: referer || `${activeDomain}/` },
      timeout: 8000,
    });
    const cl = parseInt(headRes.headers['content-length'] || '0', 10);
    if (cl > 0) {
      SIZE_CACHE.set(targetUrl, cl);
      return cl;
    }
  } catch (_) {}

  return 0;
}

/**
 * Core stream proxy handler supporting both HLS (.m3u8 + .ts + .key) and
 * RFC 9110 HTTP Range MP4 streaming (with optional AES-CTR decryption).
 */
export async function handleStreamProxy(
  query = {},
  reqHeaders = {},
  method = 'GET',
  proxyBaseUrl = ''
) {
  const sid = query.sid || '';
  const session = sid ? getStreamSession(sid) : null;
  const targetUrl = normalizeUrl(query.url || session?.url || '');
  const referer =
    query.referer ||
    session?.referer ||
    getCacheMeta(targetUrl)?.referer ||
    `${activeDomain}/`;

  if (!targetUrl) {
    return {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: Buffer.from('Missing stream url'),
    };
  }

  const upperMethod = String(method || 'GET').toUpperCase();
  const clientRange = reqHeaders.range || reqHeaders.Range || '';

  // 1. Check if the target is an M3U8 playlist
  if (isM3u8Url(targetUrl)) {
    try {
      const upstreamRes = await nativeHttpRequest(targetUrl, {
        method: 'GET',
        headers: {
          'User-Agent': DEFAULT_UA,
          Referer: referer,
        },
        timeout: 8000,
      });
      const text = decodeBuffer(upstreamRes.data, upstreamRes.headers?.['content-encoding']);
      const finalManifestUrl = upstreamRes.url || targetUrl;
      const effectiveBase = proxyBaseUrl || 'http://127.0.0.1/proxy.m3u8';
      const rewritten = text.includes('#EXTM3U')
        ? rewriteM3u8Manifest(text, finalManifestUrl, effectiveBase, referer)
        : text;
      const bodyBuf = Buffer.from(rewritten, 'utf-8');
      const respHeaders = {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Content-Length': String(bodyBuf.length),
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      };
      return {
        status: 200,
        headers: respHeaders,
        body: upperMethod === 'HEAD' ? Buffer.alloc(0) : bodyBuf,
      };
    } catch (err) {
      return {
        status: 502,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: Buffer.from(`Upstream M3U8 error: ${err?.message || err}`),
      };
    }
  }

  // 2. Check if the target is an HLS segment (.ts, .aac, .m4s, or disguised segment) or AES key
  const lowerPath = (() => {
    try {
      return new URL(targetUrl).pathname.toLowerCase();
    } catch (_) {
      return targetUrl.toLowerCase();
    }
  })();

  if ((/\.(?:ts|aac|key|m4s)(\b|$)/i.test(lowerPath) || query.type === 'ts') && !session?.key) {
    try {
      const upstreamHeaders = {
        'User-Agent': DEFAULT_UA,
        Referer: referer,
      };
      if (clientRange) upstreamHeaders.Range = clientRange;
      const upstreamRes = await nativeHttpRequest(targetUrl, {
        method: upperMethod === 'HEAD' ? 'HEAD' : 'GET',
        headers: upstreamHeaders,
        timeout: 10000,
      });
      const mime = /\.key(\b|$)/i.test(lowerPath)
        ? 'application/octet-stream'
        : 'video/mp2t';
      const bodyBuf = upstreamRes.data || Buffer.alloc(0);
      const respHeaders = {
        'Content-Type': mime,
        'Content-Length': String(
          upperMethod === 'HEAD'
            ? upstreamRes.headers['content-length'] || 0
            : bodyBuf.length
        ),
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
      };
      if (clientRange && upstreamRes.status === 206 && upstreamRes.headers['content-range']) {
        respHeaders['Content-Range'] = upstreamRes.headers['content-range'];
      }
      return {
        status: clientRange && upstreamRes.status === 206 ? 206 : 200,
        headers: respHeaders,
        body: upperMethod === 'HEAD' ? Buffer.alloc(0) : bodyBuf,
      };
    } catch (err) {
      return {
        status: 502,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: Buffer.from(`Upstream segment error: ${err?.message || err}`),
      };
    }
  }

  // 3. Direct Media / MP4 HTTP Range Proxy (RFC 9110 Compliant + AES-CTR Decryption Support)
  let totalSize = Number(session?.size || query.size || 0);
  if (!totalSize) {
    totalSize = await probeUpstreamSize(targetUrl, referer);
  }

  // Handle HEAD request immediately
  if (upperMethod === 'HEAD') {
    if (clientRange && totalSize > 0) {
      const parsedRange = parseHttpRange(clientRange, totalSize);
      if (parsedRange?.invalid) {
        return {
          status: 416,
          headers: {
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes */${totalSize}`,
            'Content-Length': '0',
            'Access-Control-Allow-Origin': '*',
          },
          body: Buffer.alloc(0),
        };
      }
      if (parsedRange) {
        const len = parsedRange.end - parsedRange.start + 1;
        return {
          status: 206,
          headers: {
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${parsedRange.start}-${parsedRange.end}/${totalSize}`,
            'Content-Length': String(len),
            'Access-Control-Allow-Origin': '*',
          },
          body: Buffer.alloc(0),
        };
      }
    }

    // 200 OK on HEAD without Range (Omit Content-Range per RFC 9110)
    return {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Length': String(totalSize || 0),
        'Access-Control-Allow-Origin': '*',
      },
      body: Buffer.alloc(0),
    };
  }

  // Handle GET with Range header -> 206 Partial Content
  if (clientRange) {
    const parsedRange = parseHttpRange(clientRange, totalSize);
    if (parsedRange?.invalid) {
      return {
        status: 416,
        headers: {
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes */${totalSize || '*'}`,
          'Content-Length': '0',
          'Access-Control-Allow-Origin': '*',
        },
        body: Buffer.alloc(0),
      };
    }

    if (parsedRange) {
      const reqStart = parsedRange.start;
      const isOpenEnded =
        /-\s*$/.test(String(clientRange).trim()) && !/^bytes=-/i.test(String(clientRange).trim());
      const reqEnd = isOpenEnded
        ? totalSize > 0
          ? Math.min(totalSize - 1, reqStart + MAX_SLICE_BYTES - 1)
          : reqStart + MAX_SLICE_BYTES - 1
        : parsedRange.end;

      const upstreamRes = await nativeHttpRequest(targetUrl, {
        method: 'GET',
        headers: {
          'User-Agent': DEFAULT_UA,
          Referer: referer,
          Range: `bytes=${reqStart}-${reqEnd}`,
        },
        timeout: 10000,
      });

      let rawData = upstreamRes.data || Buffer.alloc(0);
      const expectedLen = reqEnd - reqStart + 1;
      // If upstream ignored Range and returned full 200 body, slice to [reqStart, reqEnd + 1]
      if (
        upstreamRes.status === 200 &&
        rawData.length > expectedLen &&
        rawData.length >= reqEnd + 1
      ) {
        if (!totalSize) {
          totalSize = rawData.length;
          SIZE_CACHE.set(targetUrl, totalSize);
        }
        rawData = rawData.slice(reqStart, reqEnd + 1);
      } else if (rawData.length > expectedLen) {
        rawData = rawData.slice(0, expectedLen);
      }

      if (!totalSize) {
        const cr = upstreamRes.headers['content-range'] || '';
        const crMatch = /\/(\d+)$/.exec(cr);
        if (crMatch) totalSize = parseInt(crMatch[1], 10);
        else totalSize = reqStart + rawData.length;
      }

      const finalSlice = session?.key
        ? decryptRangeSlice(rawData, reqStart, session.key, session.iv, session.encLen)
        : rawData;

      const actualEnd = reqStart + finalSlice.length - 1;
      return {
        status: 206,
        headers: {
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${reqStart}-${actualEnd}/${totalSize}`,
          'Content-Length': String(finalSlice.length),
          'Access-Control-Allow-Origin': '*',
        },
        body: finalSlice,
      };
    }
  }

  // Handle GET without Range header -> 200 OK (MUST omit Content-Range per RFC 9110)
  const upstreamRes = await nativeHttpRequest(targetUrl, {
    method: 'GET',
    headers: {
      'User-Agent': DEFAULT_UA,
      Referer: referer,
    },
    timeout: 12000,
  });

  const rawBody = upstreamRes.data || Buffer.alloc(0);
  const finalBody = session?.key
    ? decryptRangeSlice(rawBody, 0, session.key, session.iv, session.encLen)
    : rawBody;

  // Check if upstream actually returned an M3U8 playlist without .m3u8 extension
  const headText = finalBody.slice(0, 64).toString('utf-8').trim();
  if (headText.startsWith('#EXTM3U')) {
    const fullText = decodeBuffer(finalBody);
    const effectiveBase = proxyBaseUrl || 'http://127.0.0.1/proxy.m3u8';
    const rewritten = rewriteM3u8Manifest(
      fullText,
      upstreamRes.url || targetUrl,
      effectiveBase,
      referer
    );
    const m3u8Buf = Buffer.from(rewritten, 'utf-8');
    return {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Content-Length': String(m3u8Buf.length),
        'Access-Control-Allow-Origin': '*',
      },
      body: m3u8Buf,
    };
  }

  return {
    status: 200,
    headers: {
      'Content-Type': upstreamRes.headers['content-type'] || 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Content-Length': String(finalBody.length),
      'Access-Control-Allow-Origin': '*',
    },
    body: finalBody,
  };
}

/**
 * Local Loopback HTTP Stream Proxy Server for 127.0.0.1 / localhost playback.
 */
let localProxyServer = null;
let localProxyPort = 0;

export async function ensureLocalProxyServer() {
  if (localProxyServer && localProxyPort > 0) {
    return localProxyPort;
  }
  return new Promise((resolve, reject) => {
    const srv = http.createServer(async (reqIncoming, resOutgoing) => {
      try {
        const reqUrl = new URL(reqIncoming.url || '/', `http://127.0.0.1:${localProxyPort || 80}`);
        if (reqUrl.pathname === '/hguoo_pic') {
          const queryObj = Object.fromEntries(reqUrl.searchParams.entries());
          const picRes = await proxyPicHandler(queryObj);
          resOutgoing.writeHead(200, { 'Content-Type': picRes.mime });
          return resOutgoing.end(picRes.data);
        }
        const queryObj = Object.fromEntries(reqUrl.searchParams.entries());
        const proxyBase = `http://127.0.0.1:${localProxyPort}${reqUrl.pathname}`;
        const result = await handleStreamProxy(
          queryObj,
          reqIncoming.headers || {},
          reqIncoming.method || 'GET',
          proxyBase
        );
        resOutgoing.writeHead(result.status, result.headers);
        resOutgoing.end(result.body);
      } catch (err) {
        resOutgoing.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        resOutgoing.end(`Proxy error: ${err?.message || err}`);
      }
    });

    srv.unref();
    srv.listen(0, '0.0.0.0', () => {
      const addr = srv.address();
      localProxyPort = typeof addr === 'object' && addr ? addr.port : 0;
      localProxyServer = srv;
      resolve(localProxyPort);
    });
    srv.on('error', (err) => reject(err));
  });
}

export async function closeLocalProxyServer() {
  if (!localProxyServer) return;
  const srv = localProxyServer;
  localProxyServer = null;
  localProxyPort = 0;
  await new Promise((resolve) => srv.close(() => resolve()));
}

/**
 * Builds the local proxy playback URL:
 * - Routes loopback requests (127.0.0.1, localhost, or direct invocations) to the local loopback streaming server.
 * - Routes remote, LAN, or Docker requests through the Fastify server's exposed port and route prefix.
 * - Appends .mp4 or .m3u8 route alias for AVPlayer / ExoPlayer compatibility.
 */
async function buildStreamProxyUrl(inReq, streamUrl, referer = '', session = null) {
  const isM3u8 = isM3u8Url(streamUrl);
  const extAlias = isM3u8 ? '.m3u8' : '.mp4';

  const sid = registerStreamSession({
    url: streamUrl,
    referer: referer || `${activeDomain}/`,
    ...(session || {}),
  });

  const queryParts = [`sid=${encodeURIComponent(sid)}`, `url=${encodeURIComponent(streamUrl)}`];
  if (referer) {
    queryParts.push(`referer=${encodeURIComponent(referer)}`);
  }
  const queryString = queryParts.join('&');

  const hostHeader = String(
    inReq?.headers?.['x-forwarded-host'] ||
      inReq?.headers?.host ||
      inReq?.raw?.headers?.host ||
      ''
  ).trim();
  const hostnameOnly = hostHeader.replace(/:\d+$/, '').toLowerCase();
  const isLoopback =
    !hostnameOnly ||
    hostnameOnly === '127.0.0.1' ||
    hostnameOnly === 'localhost' ||
    hostnameOnly === '[::1]' ||
    hostnameOnly === '::1';

  const derivedPrefix = String(inReq?.raw?.url || inReq?.url || '')
    .split('?')[0]
    .replace(/\/play\/?$/i, '')
    .replace(/\/+$/, '');
  const prefix = String(inReq?.server?.prefix || derivedPrefix || '').replace(/\/+$/, '');

  if (!isLoopback && hostHeader) {
    const proto = String(
      inReq?.headers?.['x-forwarded-proto'] || inReq?.protocol || 'http'
    )
      .split(',')[0]
      .trim();
    return `${proto}://${hostHeader}${prefix}/proxy${extAlias}?${queryString}`;
  }

  const port = await ensureLocalProxyServer();
  return `http://127.0.0.1:${port}/proxy${extAlias}?${queryString}`;
}

export async function init(inReq) {
  const params = unwrapParams(inReq);
  const customSite = String(params.siteUrl || params.site || params.ext || params.extend || '').trim();
  if (/^https?:\/\//i.test(customSite)) {
    activeDomain = customSite.replace(/\/+$/, '');
    if (!SITE_DOMAINS.includes(activeDomain)) {
      SITE_DOMAINS.unshift(activeDomain);
    }
  }
  await ensureLocalProxyServer();
  return {};
}

export async function home(inReq) {
  const params = unwrapParams(inReq);
  let list = [];
  if (CLASSES.length > 0) {
    const firstCat = CLASSES[0].type_id;
    const res = await fetchHtml(firstCat);
    if (res.text) {
      list = parseVideoCards(res.text);
    }
  }
  if (list.length === 0) {
    const rootRes = await fetchHtml('/');
    if (rootRes.text) {
      list = parseVideoCards(rootRes.text);
    }
  }
  const result = {
    class: CLASSES,
    list,
    style: CARD_STYLE,
  };
  if (params.filter) {
    result.filters = {};
  }
  return result;
}

export async function category(inReq) {
  const params = unwrapParams(inReq);
  const tid = String(params.id || params.tid || CLASSES[0].type_id).trim();
  const page = Math.max(1, parseInt(params.page || params.pg || '1', 10) || 1);

  const sep = tid.includes('?') ? '&' : '?';
  const targetPath = page > 1 ? `${tid}${sep}page=${page}` : tid;

  const res = await fetchHtml(targetPath);
  const items = parseVideoCards(res.text || '');

  return {
    page,
    pagecount: items.length >= 20 ? page + 1 : page,
    limit: items.length || 20,
    total: items.length >= 20 ? 999 : items.length,
    list: items,
    style: CARD_STYLE,
  };
}

export async function detail(inReq) {
  const params = unwrapParams(inReq);
  const rawIds = params.id || params.ids || params.url || '';
  const rawId = Array.isArray(rawIds) ? String(rawIds[0] || '') : String(rawIds || '');
  const cleanRawId = rawId.includes(',') ? rawId.split(',')[0].trim() : rawId.trim();

  // Pass cleanRawId directly so fetchHtml can expand across all candidate domains
  const res = await fetchHtml(cleanRawId);
  const html = res.text || '';
  const detailUrl = normalizeUrl(cleanRawId);
  const finalPageUrl = res.finalUrl || detailUrl;
  let pageOrigin = activeDomain;
  try {
    pageOrigin = new URL(finalPageUrl).origin;
  } catch (_) {}
  const pageReferer = `${pageOrigin}/`;

  let title = '';
  const h1Match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1Match) {
    title = stripTags(h1Match[1]);
  }
  if (!title) {
    const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(html);
    if (titleMatch) {
      const rawT = stripTags(titleMatch[1]);
      if (rawT.includes(' - ')) {
        const parts = rawT.split(' - ');
        title = parts.length >= 3 ? parts.slice(0, -2).join(' - ') : parts[0];
      } else {
        title = rawT;
      }
    }
  }
  title = title.replace(/[$#\r\n\t]+/g, ' ').trim() || '超清正片';

  const imgMatch =
    /property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html) ||
    /content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html);
  const pic = imgMatch ? normalizeUrl(imgMatch[1], finalPageUrl) : '';

  const resolvedMeta = await resolveStreamMetaFromPage(cleanRawId, html, finalPageUrl);
  const mainStream = resolvedMeta.url || '';
  const streamReferer = resolvedMeta.referer || pageReferer;
  const existingSession =
    resolvedMeta.session || (mainStream ? getCacheMeta(mainStream)?.session : null) || null;

  if (mainStream) {
    setCache(cleanRawId, mainStream, streamReferer, existingSession, title);
    setCache(detailUrl, mainStream, streamReferer, existingSession, title);
    setCache(finalPageUrl, mainStream, streamReferer, existingSession, title);
    setCache(mainStream, mainStream, streamReferer, existingSession, title);
  }

  const normalizedRawHref = normalizeVodHref(cleanRawId);
  const seenUrls = new Set([
    cleanRawId,
    normalizedRawHref,
    cleanRawId.replace(activeDomain, ''),
    detailUrl,
    finalPageUrl,
  ]);
  const firstTarget = mainStream || cleanRawId;
  const episodes = [`正片$${firstTarget}@@@${encodeURIComponent(title)}`];

  const recRegex =
    /<a[^>]+href=["']((?:https?:\/\/[^"'/]+)?\/video\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let recMatch;
  let recIdx = 1;

  while ((recMatch = recRegex.exec(html)) !== null) {
    const fullTag = recMatch[0];
    const href = normalizeVodHref(recMatch[1]);
    const inner = recMatch[2];
    if (!href || seenUrls.has(href)) continue;
    seenUrls.add(href);

    let rTitle = extractCardTitle(inner, fullTag);
    if (!rTitle) {
      const cleanInner = stripTags(inner);
      if (cleanInner.length >= 4) {
        rTitle = cleanInner.split('\n')[0].trim();
      }
    }

    if (rTitle) {
      rTitle = rTitle.replace(/[$#\r\n\t]+/g, ' ').trim();
      const cleanT = cleanLabel(rTitle);
      episodes.push(
        `${String(recIdx).padStart(2, '0')}·${cleanT}$${href}@@@${encodeURIComponent(rTitle)}`
      );
      recIdx++;
      if (recIdx > 24) break;
    }
  }

  const vod = {
    vod_id: cleanRawId,
    vod_name: title,
    vod_pic: pic,
    vod_actor: BRAND_ACTOR,
    vod_director: BRAND_DIRECTOR,
    vod_remarks: formatRemarks(BRAND_NAME, `全${episodes.length}部连播`),
    vod_content: FULL_DESC,
    vod_play_from: '蝴蝶专线',
    vod_play_url: episodes.join('#'),
  };

  return { list: [vod] };
}

export async function play(inReq) {
  const params = unwrapParams(inReq);
  let rawVal = String(params.id || params.url || '').trim();

  // Strip leading episode label prefix if the client passed "正片$https://..." or "01·xxx$/video/..."
  if (rawVal.includes('$')) {
    const dollarIdx = rawVal.indexOf('$');
    const prefixPart = rawVal.slice(0, dollarIdx);
    if (!/^https?:\/\//i.test(prefixPart) && !prefixPart.startsWith('/')) {
      rawVal = rawVal.slice(dollarIdx + 1).trim();
    }
  }

  let target = rawVal;
  let descTitle = '';
  if (rawVal.includes('@@@')) {
    const splitIdx = rawVal.indexOf('@@@');
    target = rawVal.slice(0, splitIdx).trim();
    const rawTitle = rawVal.slice(splitIdx + 3);
    try {
      descTitle = decodeURIComponent(rawTitle);
    } catch (_) {
      descTitle = rawTitle;
    }
  }

  let realStream = '';
  let refererUrl = '';
  let session = null;

  const unwrappedTarget = unwrapPlayerUrl(target);
  const cachedMeta = getCacheMeta(target) || getCacheMeta(unwrappedTarget);
  if (!descTitle && cachedMeta?.desc) {
    descTitle = cachedMeta.desc;
  }

  if (isDirectMediaUrl(unwrappedTarget)) {
    realStream = unwrappedTarget;
    refererUrl = cachedMeta?.referer || `${activeDomain}/`;
    session = cachedMeta?.session || null;
  } else {
    const resolved = await resolveStreamMetaFromPage(target);
    realStream = resolved.url || normalizeUrl(target);
    refererUrl = resolved.referer || `${activeDomain}/`;
    session = resolved.session || getCacheMeta(realStream)?.session || null;
  }

  const isDirect = isDirectMediaUrl(realStream);
  const playHeaders = {
    'User-Agent': DEFAULT_UA,
    Referer: refererUrl || `${activeDomain}/`,
  };

  // Only route through local proxy when AES-CTR decryption is required (session.key)
  // or when proxy mode is explicitly requested via params.proxy === '1' / true.
  // Standard .m3u8 and .mp4 streams play directly in 猫爪 / ExoPlayer / AVPlayer / IJKPlayer.
  const forceProxy =
    params.proxy === '1' ||
    params.proxy === true ||
    params.proxy === 'true' ||
    (Boolean(session?.key) && params.proxy !== '0' && params.proxy !== false);

  let finalPlayUrl = realStream;
  if (isDirect && forceProxy) {
    finalPlayUrl = await buildStreamProxyUrl(inReq, realStream, playHeaders.Referer, session);
  }

  const result = {
    parse: isDirect ? 0 : 1,
    jx: 0,
    playUrl: '',
    url: finalPlayUrl,
    rawUrl: realStream,
    header: playHeaders,
    headers: playHeaders,
  };

  if (descTitle) {
    result.desc = descTitle;
  }

  return result;
}

export async function search(inReq) {
  const params = unwrapParams(inReq);
  const wd = String(params.wd || params.key || params.keyword || '').trim();
  const page = Math.max(1, parseInt(params.page || params.pg || '1', 10) || 1);

  if (!wd) {
    return { page: 1, pagecount: 1, limit: 0, total: 0, list: [] };
  }

  const searchPath = `/search?q=${encodeURIComponent(wd)}&page=${page}`;
  const res = await fetchHtml(searchPath);
  const items = parseVideoCards(res.text || '');

  return {
    page,
    pagecount: items.length >= 20 ? page + 1 : page,
    limit: items.length,
    total: items.length >= 20 ? 999 : items.length,
    list: items,
    style: CARD_STYLE,
  };
}

async function proxyPicHandler(query) {
  const picUrl = query?.url || '';
  if (!picUrl) {
    return { mime: 'text/plain', data: 'Missing url' };
  }
  try {
    const resp = await req.get(normalizeUrl(picUrl), {
      headers: {
        'User-Agent': DEFAULT_UA,
        Referer: `${activeDomain}/`,
      },
      responseType: 'arraybuffer',
      timeout: 8000,
    });
    const mime = resp?.headers?.['content-type'] || 'image/jpeg';
    const data = Buffer.isBuffer(resp?.data) ? resp.data : Buffer.from(resp?.data || '');
    return { mime, data };
  } catch (_) {
    try {
      const natResp = await nativeHttpRequest(normalizeUrl(picUrl), {
        headers: {
          'User-Agent': DEFAULT_UA,
          Referer: `${activeDomain}/`,
        },
        timeout: 8000,
      });
      const mime = natResp?.headers?.['content-type'] || 'image/jpeg';
      return { mime, data: natResp.data || Buffer.alloc(0) };
    } catch (__) {
      return { mime: 'image/jpeg', data: Buffer.alloc(0) };
    }
  }
}

async function fastifyProxyRouteHandler(request, reply) {
  const hostHeader =
    request?.headers?.['x-forwarded-host'] || request?.headers?.host || '127.0.0.1';
  const proto = String(
    request?.headers?.['x-forwarded-proto'] || request?.protocol || 'http'
  )
    .split(',')[0]
    .trim();
  const rawUrlPath = String(request?.raw?.url || request?.url || '/proxy').split('?')[0];
  const proxyBaseUrl = `${proto}://${hostHeader}${rawUrlPath}`;

  const res = await handleStreamProxy(
    unwrapParams(request),
    request?.headers || {},
    request?.method || 'GET',
    proxyBaseUrl
  );

  reply.code(res.status);
  for (const [k, v] of Object.entries(res.headers || {})) {
    reply.header(k, v);
  }
  return reply.send(res.body);
}

export default {
  meta: {
    key: 'hguoo',
    name: '红裹视频',
    type: 3,
  },
  api: async (fastify) => {
    fastify.post('/init', init);
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    for (const routePath of ['/proxy', '/proxy.mp4', '/proxy.m3u8', '/proxy.ts']) {
      fastify.get(routePath, fastifyProxyRouteHandler);
      if (typeof fastify.head === 'function') {
        fastify.head(routePath, fastifyProxyRouteHandler);
      }
    }
    fastify.get('/hguoo_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
  },
};