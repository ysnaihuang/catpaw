import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'zlib';
import http from 'http';

const SPIDER_KEY = '91dasai';
const SPIDER_NAME = '91大赛';

const SITE_DOMAINS = [
  'https://www.dycg66.com',
  'https://dycg66.com',
  'https://91dswz14.com',
  'https://beyond.msydnlna.cc',
  'https://believe.dmikczev.cc',
  'https://degsk16unbzxx.cloudfront.net',
  'https://91dswz12.com',
  'https://91dasai25.com',
  'https://91dasai24.com',
  'https://dycg01.com',
];

let activeDomain = SITE_DOMAINS[0];

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';

const CATEGORIES = [
  { type_id: '/category/jrds/', type_name: '今日大赛', icon: 'iconfont icon-jrds' },
  { type_id: '/category/rsds/', type_name: '热搜大赛', icon: 'iconfont icon-rsds' },
  { type_id: '/category/mrds/', type_name: '每日大赛', icon: 'iconfont icon-mrds' },
  { type_id: '/category/aidj/', type_name: 'AI短剧', icon: 'iconfont icon-aidj' },
  { type_id: '/category/nsds/', type_name: '女神大赛', icon: 'iconfont icon-nsds' },
  { type_id: '/category/llds/', type_name: '乱伦大赛', icon: 'iconfont icon-llds' },
  { type_id: '/category/xyds/', type_name: '学院大赛', icon: 'iconfont icon-xyds' },
  { type_id: '/category/whds/', type_name: '网红大赛', icon: 'iconfont icon-whds' },
  { type_id: '/category/lyds/', type_name: '撸友看片', icon: 'iconfont icon-lyds' },
  { type_id: '/category/sjbzq/', type_name: '优选投放区', icon: 'iconfont icon-sjbzq' },
  { type_id: '/category/qwds/', type_name: '奇闻大赛', icon: 'iconfont icon-qwds' },
  { type_id: '/category/mxds/', type_name: '明星吃瓜', icon: 'iconfont icon-mxds' },
  { type_id: '/category/ntds/', type_name: '女同大赛', icon: 'iconfont icon-ntds' },
  { type_id: '/category/wmds/', type_name: '污漫大赛', icon: 'iconfont icon-wmds' },
];

const PLAY_CACHE = new Map();
const PIC_CACHE = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

const AES_IMAGE_KEY_PAIRS = [
  { key: 'f5d965df75336270', iv: '97b60394abc2fbe1' },
  { key: '97b60394abc2fbe1', iv: 'f5d965df75336270' },
  { key: '102_53_100_57_54_53_100_102_55_53_51_51_54_50_55_48', iv: '57_55_98_54_48_51_57_52_97_98_99_50_102_98_101_49' },
];

let localProxyServer = null;
let localProxyPort = 0;
let forceStreamProxy = false;

function setCachedPlay(key, val) {
  if (!key || !val) return;
  PLAY_CACHE.set(String(key).trim(), { val, ts: Date.now() });
}

function getCachedPlay(key) {
  if (!key) return null;
  const k = String(key).trim();
  const item = PLAY_CACHE.get(k);
  if (!item) return null;
  if (Date.now() - item.ts > CACHE_TTL_MS) {
    PLAY_CACHE.delete(k);
    return null;
  }
  return item.val;
}

function registerDynamicAesKeyPair(keyStr, ivStr) {
  if (!keyStr || !ivStr) return;
  const k = String(keyStr).trim();
  const v = String(ivStr).trim();
  if (k.length !== 16 || v.length !== 16) return;
  if (!AES_IMAGE_KEY_PAIRS.some((p) => p.key === k && p.iv === v)) {
    AES_IMAGE_KEY_PAIRS.unshift({ key: k, iv: v });
  }
}

function scanHtmlForAesKeys(html) {
  if (!html || typeof html !== 'string') return;
  const parseMatches = [...html.matchAll(/Utf8\.parse\s*\(\s*['"]([A-Za-z0-9_!@#$%^&*-]{16})['"]\s*\)/g)];
  if (parseMatches.length >= 2) {
    registerDynamicAesKeyPair(parseMatches[0][1], parseMatches[1][1]);
  }
  const keyVarMatch = html.match(/\b(?:key|aesKey|imgKey|k)\s*=\s*['"]([A-Za-z0-9]{16})['"]/i);
  const ivVarMatch = html.match(/\b(?:iv|aesIv|imgIv)\s*=\s*['"]([A-Za-z0-9]{16})['"]/i);
  if (keyVarMatch && ivVarMatch) {
    registerDynamicAesKeyPair(keyVarMatch[1], ivVarMatch[1]);
  }
}

function discoverMirrorsFromHtml(html) {
  if (!html || typeof html !== 'string') return;
  const patterns = [
    /https?:\/\/([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)(?=\/|\s|$|['"<，,。])/g,
    /(?:线路[一二三四五1-5]|亚马逊直连|回家地址|永久链接|备用入口)[\s\S]{0,80}?\b([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)\b/g,
  ];
  const ignoreDomains = /(?:google|gmail|cloudflare|w3\.org|schema\.org|baidu|qq\.com|t\.me|twitter|x\.com|jsdelivr|cdnjs|bootcdn|staticfile)/i;
  for (const reg of patterns) {
    let m;
    while ((m = reg.exec(html)) !== null) {
      const host = String(m[1] || '').trim().toLowerCase();
      if (!host || ignoreDomains.test(host) || !host.includes('.')) continue;
      if (/\.(?:js|css|png|jpg|jpeg|webp|gif|svg|txt|mp4|m3u8|html|php|ico)$/i.test(host)) continue;
      const origin = `https://${host}`;
      if (!SITE_DOMAINS.includes(origin)) {
        SITE_DOMAINS.splice(Math.min(3, SITE_DOMAINS.length), 0, origin);
      }
    }
  }
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
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    });
}

function stripTags(str) {
  if (!str) return '';
  let s = String(str);
  // 1. Remove comments, <script>, <style>, <noscript>, <svg> blocks BEFORE stripping tags
  s = s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<script\b[\s\S]*$/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ');
  // 2. Strip HTML tags with quote-aware regex so '>' inside onload="()=>..." never breaks early
  s = s.replace(/<(?:[^>"']|"[^"]*"|'[^']*')+>/g, ' ').replace(/<[^>]+>/g, ' ');
  // 3. Decode HTML entities and strip any entity-encoded tags (&lt;img ...&gt;)
  s = decodeHtmlEntities(s);
  s = s
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<(?:[^>"']|"[^"]*"|'[^']*')+>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function unescapeStringLiteral(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\\//g, '/')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function parseSourceIntoObject(src, target) {
  if (!src) return;
  if (Buffer.isBuffer(src) || src instanceof Uint8Array) {
    parseSourceIntoObject(Buffer.from(src).toString('utf8'), target);
    return;
  }
  if (typeof src === 'string') {
    const trimmed = src.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        Object.assign(target, JSON.parse(trimmed));
        return;
      } catch (_) {}
    }
    try {
      const sp = new URLSearchParams(trimmed);
      for (const [k, v] of sp.entries()) {
        target[k] = v;
      }
    } catch (_) {}
    return;
  }
  if (typeof src === 'object') {
    Object.assign(target, src);
  }
}

function unwrapRequestParams(inReq, secondArg) {
  const merged = {};
  if (inReq === undefined || inReq === null) return merged;

  if (typeof inReq === 'string' || typeof inReq === 'number') {
    merged.id = String(inReq);
    if (secondArg !== undefined) merged.page = secondArg;
    return merged;
  }

  if (Array.isArray(inReq)) {
    merged.ids = inReq;
    merged.id = inReq[0];
    return merged;
  }

  const isFastifyReq =
    Boolean(inReq.params || inReq.query || inReq.body || inReq.headers || inReq.raw || inReq.server);
  if (isFastifyReq) {
    parseSourceIntoObject(inReq.params, merged);
    parseSourceIntoObject(inReq.query, merged);
    parseSourceIntoObject(inReq.body, merged);
  } else {
    parseSourceIntoObject(inReq, merged);
  }

  for (const key of ['ids', 'id']) {
    if (typeof merged[key] === 'string') {
      const val = merged[key].trim();
      if (val.startsWith('[') && val.endsWith(']')) {
        try {
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed) && parsed.length > 0) {
            merged[key] = parsed[0];
          }
        } catch (_) {}
      }
    } else if (Array.isArray(merged[key]) && merged[key].length > 0) {
      merged[key] = merged[key][0];
    }
  }

  return merged;
}

function getKnownHostSet() {
  const set = new Set();
  for (const d of SITE_DOMAINS) {
    try {
      const u = new URL(d);
      set.add(u.hostname.toLowerCase());
      set.add(u.hostname.toLowerCase().replace(/^www\./, ''));
    } catch (_) {}
  }
  return set;
}

function expandCandidateUrls(inputUrl) {
  const raw = decodeHtmlEntities(String(inputUrl || '').trim());
  if (!raw) return SITE_DOMAINS.map((d) => `${d}/`);

  const orderedDomains = [
    activeDomain,
    ...SITE_DOMAINS.filter((d) => d !== activeDomain),
  ];

  if (raw.startsWith('//')) {
    return [`https:${raw}`, `http:${raw}`];
  }

  if (raw.startsWith('/')) {
    return orderedDomains.map((d) => `${d.replace(/\/+$/, '')}${raw}`);
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      const knownHosts = getKnownHostSet();
      if (knownHosts.has(host) || knownHosts.has(parsed.hostname.toLowerCase())) {
        const pathAndQuery = `${parsed.pathname}${parsed.search}${parsed.hash || ''}`;
        const list = orderedDomains.map((d) => `${d.replace(/\/+$/, '')}${pathAndQuery}`);
        if (!list.includes(raw)) list.unshift(raw);
        return [...new Set(list)];
      }
      return [raw];
    } catch (_) {
      return [raw];
    }
  }

  return orderedDomains.map((d) => `${d.replace(/\/+$/, '')}/${raw.replace(/^\/+/, '')}`);
}

function normalizeUrl(urlStr, baseDomain = activeDomain) {
  const raw = decodeHtmlEntities(unescapeStringLiteral(String(urlStr || '').trim()));
  if (!raw) return '';
  if (/^(?:javascript:|mailto:|tel:|about:blank|#)/i.test(raw)) return '';
  if (/^data:image\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = (baseDomain || activeDomain || SITE_DOMAINS[0]).replace(/\/+$/, '');
  if (raw.startsWith('/')) return `${base}${raw}`;
  return `${base}/${raw}`;
}

function isPlaceholderImage(urlStr) {
  if (!urlStr) return true;
  const s = String(urlStr).trim().toLowerCase();
  if (!s || s === '#' || s.startsWith('javascript:') || s.startsWith('about:blank')) return true;
  if (
    /(?:\/|^|_|-|\.)(?:loading|lazyload|placeholder|spacer|blank|default|avatar|logo|empty|1x1|grey|noimage|generic_cover)[^/]*\.(?:gif|png|jpg|jpeg|webp|svg)/i.test(
      s
    )
  ) {
    return true;
  }
  if (/^data:image\/svg\+xml/i.test(s)) return true;
  if (/^data:image\//i.test(s) && s.length < 256) return true;
  if (/^data:image\/(?:gif|png|svg\+xml);base64,(?:r0lgod|ivborw0kggoaaaansuheugaaaae|phn2zy|pd94bw)/i.test(s)) {
    return true;
  }
  return false;
}

function buildHeaders(targetUrl, extraHeaders = {}) {
  let origin = activeDomain || SITE_DOMAINS[0];
  try {
    const u = new URL(targetUrl);
    const knownHosts = getKnownHostSet();
    const cleanHost = u.hostname.toLowerCase().replace(/^www\./, '');
    if (knownHosts.has(cleanHost) || knownHosts.has(u.hostname.toLowerCase())) {
      origin = u.origin;
    }
  } catch (_) {}
  return {
    'User-Agent': DEFAULT_UA,
    Referer: `${origin.replace(/\/+$/, '')}/`,
    Origin: origin.replace(/\/+$/, ''),
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    ...extraHeaders,
  };
}

function decodeBufferToText(buf) {
  if (!buf) return '';
  if (typeof buf === 'string') return buf;
  let buffer = Buffer.isBuffer(buf)
    ? buf
    : buf instanceof ArrayBuffer
      ? Buffer.from(buf)
      : ArrayBuffer.isView(buf)
        ? Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength)
        : Buffer.from(buf);
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    try {
      buffer = zlib.gunzipSync(buffer);
    } catch (_) {}
  }
  const utf8 = buffer.toString('utf8');
  if (utf8.includes('\ufffd')) {
    try {
      const gbkDecoder = new TextDecoder('gbk');
      return gbkDecoder.decode(buffer);
    } catch (_) {}
  }
  return utf8;
}

function isLandingOrErrorPage(html) {
  if (!html || typeof html !== 'string') return true;
  if (/<title>\s*(?:403\s+Forbidden|404\s+Not\s+Found|502\s+Bad\s+Gateway|503\s+Service|Just\s+a\s+moment|Attention\s+Required)/i.test(html)) {
    return true;
  }
  const hasLandingMarkers =
    (html.includes('91大赛-线路一') || html.includes('91大赛-线路二') || html.includes('亚马逊直连')) &&
    !/\/category\/[a-z]+\//i.test(html) &&
    !/\bdata-config\b/i.test(html) &&
    !/<article\b/i.test(html);
  if (hasLandingMarkers) {
    discoverMirrorsFromHtml(html);
    return true;
  }
  return false;
}

function isValidSiteHtml(html) {
  if (!html || typeof html !== 'string' || html.length < 100) return false;
  if (isLandingOrErrorPage(html)) return false;
  if (
    /\/category\/[a-z0-9_-]+\/?/i.test(html) ||
    html.includes('joe_list') ||
    html.includes('joe_detail') ||
    html.includes('dplayer') ||
    html.includes('DPlayer') ||
    html.includes('player_aaaa') ||
    html.includes('.m3u8') ||
    html.includes('.mp4') ||
    /<article\b/i.test(html) ||
    /<video\b/i.test(html) ||
    /\/(?:archives\/)?\d+\.html/i.test(html)
  ) {
    return true;
  }
  return false;
}

async function fetchRaw(url, options = {}) {
  const headers = buildHeaders(url, options.headers || {});
  const res = await req.get(url, {
    headers,
    timeout: options.timeout || 10000,
    ...(options.buffer !== undefined ? { buffer: options.buffer } : {}),
    ...(options.responseType ? { responseType: options.responseType } : {}),
  });
  return res;
}

async function fetchHtml(inputUrl, options = {}) {
  const candidates = expandCandidateUrls(inputUrl);
  let lastHtml = '';
  for (const candidateUrl of candidates) {
    try {
      const res = await fetchRaw(candidateUrl, options);
      const status = Number(res?.status ?? res?.statusCode ?? 200);
      if (status >= 400 && !options.allowAnyHtml) continue;
      const rawData = res?.data ?? res?.body ?? res?.content ?? res ?? '';
      const html = decodeBufferToText(rawData);
      if (!html) continue;
      lastHtml = html;
      scanHtmlForAesKeys(html);
      discoverMirrorsFromHtml(html);
      if (isValidSiteHtml(html) || (options.allowAnyHtml && !isLandingOrErrorPage(html))) {
        try {
          const parsed = new URL(candidateUrl);
          const knownHosts = getKnownHostSet();
          const cleanHost = parsed.hostname.toLowerCase().replace(/^www\./, '');
          if (knownHosts.has(cleanHost) || knownHosts.has(parsed.hostname.toLowerCase())) {
            activeDomain = parsed.origin;
          }
        } catch (_) {}
        return { html, finalUrl: candidateUrl };
      }
    } catch (_) {}
  }
  return { html: lastHtml, finalUrl: candidates[0] || String(inputUrl || '') };
}

async function ensureLocalProxyServer() {
  if (localProxyServer && localProxyPort > 0) {
    return `http://127.0.0.1:${localProxyPort}`;
  }
  return new Promise((resolve) => {
    try {
      const srv = http.createServer(async (reqIncoming, resOutgoing) => {
        try {
          const parsed = new URL(reqIncoming.url || '/', `http://127.0.0.1:${localProxyPort || 80}`);
          const query = Object.fromEntries(parsed.searchParams.entries());
          if (parsed.pathname.endsWith('_pic') || parsed.pathname === '/pic') {
            const picRes = await proxyPicHandler(query);
            resOutgoing.writeHead(200, {
              'Content-Type': picRes.mime || 'image/jpeg',
              'Cache-Control': 'public, max-age=86400',
              'Access-Control-Allow-Origin': '*',
            });
            resOutgoing.end(picRes.data);
            return;
          }
          const streamRes = await proxyStreamHandler(query);
          resOutgoing.writeHead(streamRes.status || 200, {
            'Content-Type': streamRes.mime || 'application/vnd.apple.mpegurl',
            'Access-Control-Allow-Origin': '*',
            ...(streamRes.headers || {}),
          });
          resOutgoing.end(streamRes.data);
        } catch (_) {
          resOutgoing.writeHead(502);
          resOutgoing.end();
        }
      });
      srv.on('error', () => resolve(''));
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        localProxyPort = typeof addr === 'object' && addr ? addr.port : 0;
        localProxyServer = srv;
        if (typeof srv.unref === 'function') srv.unref();
        resolve(localProxyPort ? `http://127.0.0.1:${localProxyPort}` : '');
      });
    } catch (_) {
      resolve('');
    }
  });
}

async function closeLocalProxyServer() {
  if (!localProxyServer) return;
  const srv = localProxyServer;
  localProxyServer = null;
  localProxyPort = 0;
  await new Promise((resolve) => {
    try {
      srv.close(() => resolve());
    } catch (_) {
      resolve();
    }
  });
}

function getRouteProxyBase(inReq, routeSuffix = `${SPIDER_KEY}_pic`) {
  try {
    const prefix =
      inReq?.server?.prefix ||
      String(inReq?.raw?.url || inReq?.url || '')
        .split('?')[0]
        .replace(/\/(?:home|category|detail|play|search|init|proxy)\/?$/i, '');
    const host = inReq?.headers?.host || inReq?.hostname || '';
    const proto =
      inReq?.headers?.['x-forwarded-proto'] ||
      inReq?.protocol ||
      'http';
    if (host && prefix) {
      return `${proto}://${host}${prefix.replace(/\/+$/, '')}/${routeSuffix}`;
    }
    if (host) {
      return `${proto}://${host}/${routeSuffix}`;
    }
    if (localProxyPort > 0) {
      return `http://127.0.0.1:${localProxyPort}/${routeSuffix}`;
    }
  } catch (_) {}
  return '';
}

function isEncryptedOrRemotePicUrl(urlStr) {
  if (!urlStr) return false;
  const s = String(urlStr).trim();
  if (/^data:image\//i.test(s)) return false;
  if (/\.(?:txt|enc|bin)(?:$|\?)/i.test(s) || /[?&]enc=1/i.test(s)) return true;
  if (/^https?:\/\//i.test(s)) return true;
  return false;
}

function formatVodPic(picUrl, inReq) {
  const normalized = normalizeUrl(picUrl);
  if (!normalized) return '';
  if (/^data:image\//i.test(normalized)) return normalized;
  if (isEncryptedOrRemotePicUrl(normalized)) {
    const proxyBase = getRouteProxyBase(inReq, `${SPIDER_KEY}_pic`);
    if (proxyBase && /^https?:\/\//i.test(proxyBase)) {
      return `${proxyBase}?url=${encodeURIComponent(normalized)}`;
    }
  }
  return normalized;
}

function isCandidateCoverUrl(urlStr) {
  if (!urlStr) return false;
  const s = String(urlStr).trim();
  if (isPlaceholderImage(s)) return false;
  if (/^data:image\//i.test(s)) return true;
  if (/\/(?:category|tag|page|search|author|archives)\b/i.test(s)) return false;
  if (/\.(?:html|htm|php|js|css|mp4|m3u8)(?:$|\?)/i.test(s)) return false;
  if (/\.(?:txt|enc|bin|jpg|jpeg|png|webp|gif|bmp|avif)(?:$|\?)/i.test(s)) return true;
  if (/(?:img|pic|image|cover|thumb|upload|banner|photo|cdn)/i.test(s) && /^https?:\/\//i.test(s)) {
    return true;
  }
  return false;
}

function extractImageFromFragment(fragment, baseDomain = activeDomain) {
  if (!fragment) return '';

  // 1. Check inline script / onload banner helpers (supports URL in 1st or 2nd argument)
  const bannerCallRegex =
    /(?:loadBannerDirect|loadBanner|loadImg|decryptImg|decryptImage|renderBanner|showImg|initBanner|zImageLoader)\s*\(([^)]+)\)/gi;
  let m;
  while ((m = bannerCallRegex.exec(fragment)) !== null) {
    const argsStr = m[1];
    const quoteRegex = /(['"])((?:https?:\/\/|\/\/|\/)[^'"]+)\1/g;
    let qm;
    while ((qm = quoteRegex.exec(argsStr)) !== null) {
      const candidate = normalizeUrl(qm[2], baseDomain);
      if (candidate && isCandidateCoverUrl(candidate)) return candidate;
    }
  }

  // 2. Check CSS background-image url(...)
  const bgRegex = /background(?:-image)?\s*:[^;>]*?url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi;
  while ((m = bgRegex.exec(fragment)) !== null) {
    const candidate = normalizeUrl(m[1], baseDomain);
    if (candidate && isCandidateCoverUrl(candidate)) return candidate;
  }

  // 3. Check <img> or container lazy attributes in priority order
  const attrNames = [
    'data-xkrkllgl',
    'z-image-loader-url',
    'data-litespeed-src',
    'data-lazy-src',
    'data-original',
    'data-echo',
    'data-src',
    'data-url',
    'data-img',
    'data-cover',
    'data-poster',
    'data-bg',
    'data-thumb',
    'src',
  ];
  for (const attr of attrNames) {
    const attrRegex = new RegExp(`\\b${attr}\\s*=\\s*(['"])([^'"]+)\\1`, 'gi');
    while ((m = attrRegex.exec(fragment)) !== null) {
      const candidate = normalizeUrl(m[2], baseDomain);
      if (candidate && isCandidateCoverUrl(candidate)) return candidate;
    }
  }

  // 4. Check any custom/obfuscated data-* attribute or inline script URL ending in image/.txt extension
  const anyUrlRegex =
    /(['"])((?:https?:\/\/|\/\/|\/)[^\s"'<>\\)]+?\.(?:txt|enc|bin|jpg|jpeg|png|webp|gif|avif)(?:\?[^\s"'<>\\)]*)?)\1/gi;
  while ((m = anyUrlRegex.exec(fragment)) !== null) {
    const candidate = normalizeUrl(m[2], baseDomain);
    if (candidate && isCandidateCoverUrl(candidate)) return candidate;
  }

  // 5. Fallback: raw unquoted URL inside fragment pointing to an image or .txt cover
  const rawImgUrlRegex =
    /(https?:\/\/[^\s"'<>\\)]+?\.(?:txt|enc|bin|jpg|jpeg|png|webp|gif|avif)(?:\?[^\s"'<>\\)]*)?)/gi;
  while ((m = rawImgUrlRegex.exec(fragment)) !== null) {
    const candidate = normalizeUrl(m[1], baseDomain);
    if (candidate && isCandidateCoverUrl(candidate)) return candidate;
  }

  return '';
}

function extractRemarksFromFragment(fragment) {
  if (!fragment) return '';
  const text = stripTags(fragment);

  for (const cat of CATEGORIES) {
    if (text.includes(cat.type_name)) {
      const dateMatch = text.match(/\b(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d+(?:\.\d+)?[wk万]?\s*阅读)\b/i);
      if (dateMatch) return `${cat.type_name} · ${dateMatch[1]}`;
      return cat.type_name;
    }
  }

  const readMatch = text.match(/(\d+(?:\.\d+)?[wk万]?\s*阅读)/i);
  if (readMatch) return readMatch[1];

  const dateMatch = text.match(/\b(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?)\b/);
  if (dateMatch) return dateMatch[1];

  return '';
}

function isArticleHref(href) {
  if (!href) return false;
  const h = decodeHtmlEntities(String(href).trim());
  if (!h || h.startsWith('#') || h.startsWith('javascript:')) return false;

  let pathname = h;
  if (/^https?:\/\//i.test(h) || h.startsWith('//')) {
    try {
      const u = new URL(h.startsWith('//') ? `https:${h}` : h);
      pathname = u.pathname;
    } catch (_) {
      return false;
    }
  }

  if (/^\/(?:category|tag|page|search|author|user|feed|rss|sitemap|login|register|usr|wp-content|static)\b/i.test(pathname)) {
    return false;
  }
  if (/\/18109\.html$/i.test(pathname)) {
    return false;
  }

  if (/^\/(?:index\.php\/)?(?:archives\/|post\/|p\/|video\/|v\/)?\d+\.html$/i.test(pathname)) {
    return true;
  }
  if (/^\/(?:index\.php\/)?archives\/\d+\/?$/i.test(pathname)) {
    return true;
  }
  return false;
}

function deduplicateRepeatedPrefixTitle(title) {
  if (!title || title.length < 8) return title;
  const parts = title.split(/\s+/);
  if (parts.length >= 2) {
    for (let splitIdx = 1; splitIdx < parts.length; splitIdx++) {
      const firstPart = parts.slice(0, splitIdx).join(' ').trim();
      const restPart = parts.slice(splitIdx).join(' ').trim();
      if (firstPart.length >= 4 && restPart.startsWith(firstPart)) {
        return restPart;
      }
      if (restPart.length >= 4 && firstPart.startsWith(restPart)) {
        return firstPart;
      }
    }
  }
  const maxPrefixLen = Math.floor(title.length / 2);
  for (let len = maxPrefixLen; len >= 6; len--) {
    const prefix = title.slice(0, len);
    const remainder = title.slice(len).trim();
    if (remainder.startsWith(prefix)) {
      return remainder;
    }
  }
  return title;
}

function cleanArticleTitle(rawTitle, categoryNamesSet) {
  if (!rawTitle) return '';
  let t = stripTags(rawTitle);
  if (!t) return '';

  t = t.replace(
    /\b(?:loadBannerDirect|loadBanner|loadImg|decryptImg|decryptImage|renderBanner|showImg|initBanner|fetch|setTimeout)\s*\([^)]*\)/gi,
    ' '
  );
  t = t.replace(
    /\b(?:src|data-[\w-]+|z-image-loader-url|alt|title|class|style|width|height|onload|onerror)\s*=\s*(['"])[^'"]*\1/gi,
    ' '
  );
  t = t.replace(/(?:\{|\[)dplayer[^}\]]*(?:\}|\])/gi, ' ');
  t = t
    .replace(/https?:\/\/[^\s"'<>\\)]+/gi, ' ')
    .replace(/\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\/[^\s"'<>\\)]*/g, ' ')
    .replace(/\/(?:upload|usr|wp-content|images|static|storage|content)\/[^\s"'<>\\)]+/gi, ' ');

  t = t
    .replace(/^[\s'"();,.:>+=-]+/, '')
    .replace(/[\s'"();,]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (categoryNamesSet) {
    for (const catName of categoryNamesSet) {
      if (t.length > catName.length + 4 && t.endsWith(` ${catName}`)) {
        t = t.slice(0, t.length - catName.length - 1).trim();
      }
    }
  }

  t = t
    .replace(/\s+\d+(?:\.\d+)?[wk万]?\s*(?:阅读|次观看|播放|浏览).*$/i, '')
    .replace(/^[1-9]\d?\s+(?=[\u4e00-\u9fa5【「《])/u, '')
    .trim();

  t = deduplicateRepeatedPrefixTitle(t);

  if (!t) return '';
  if (categoryNamesSet && categoryNamesSet.has(t)) return '';
  if (
    /^(?:首页|更多|官方APP|最新回家路|投稿求瓜|官方QQ|官方TG|官方推特|所有标签|官方商务|往期内容|搜索|下载|阅读全文|查看详情|立即观看|热门文章|侧边栏壁纸|上一页|下一页|跳转)$/i.test(
      t
    )
  ) {
    return '';
  }
  if (/^(?:https?:\/\/|www\.|[a-z0-9.-]+\.(?:com|net|org|cc|xyz|club|top|txt|jpg|png|webp|html))$/i.test(t)) {
    return '';
  }
  return t;
}

function extractBalancedTagBlocks(html, tagPattern, classKeywordPattern) {
  const blocks = [];
  if (!html) return blocks;
  const startRegex = new RegExp(
    `<(${tagPattern})\\b[^>]*class\\s*=\\s*['"][^'"]*(?:${classKeywordPattern})[^'"]*['"][^>]*>`,
    'gi'
  );
  let m;
  while ((m = startRegex.exec(html)) !== null) {
    const tagName = m[1].toLowerCase();
    const startIdx = m.index;
    const tagScanRegex = new RegExp(`<(\\/?)${tagName}\\b[^>]*>`, 'gi');
    tagScanRegex.lastIndex = startIdx;
    let depth = 0;
    let tm;
    let endIdx = -1;
    while ((tm = tagScanRegex.exec(html)) !== null) {
      const fullTag = tm[0];
      const isClose = tm[1] === '/';
      const isSelfClose = /\/>$/.test(fullTag);
      if (isClose) {
        depth--;
        if (depth <= 0) {
          endIdx = tm.index + fullTag.length;
          break;
        }
      } else if (!isSelfClose) {
        depth++;
      }
    }
    if (endIdx !== -1) {
      blocks.push(html.slice(startIdx, endIdx));
      startRegex.lastIndex = endIdx;
    } else {
      blocks.push(html.slice(startIdx, Math.min(html.length, startIdx + 2500)));
    }
  }
  return blocks;
}

function parseVideoCards(html, inReq) {
  if (!html) return [];

  let workHtml = html;
  const footerIdx = workHtml.indexOf('91大赛常见问题');
  if (footerIdx > 500) {
    workHtml = workHtml.slice(0, footerIdx);
  }
  workHtml = workHtml.replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, ' ');
  const hotMarkerIdx = workHtml.indexOf('热门文章');
  const wallMarkerIdx = workHtml.indexOf('侧边栏壁纸');
  if (hotMarkerIdx !== -1 && wallMarkerIdx !== -1 && wallMarkerIdx > hotMarkerIdx && wallMarkerIdx - hotMarkerIdx < 8000) {
    workHtml =
      workHtml.slice(0, hotMarkerIdx) +
      workHtml.slice(wallMarkerIdx + '侧边栏壁纸'.length);
  }

  const categoryNamesSet = new Set(CATEGORIES.map((c) => c.type_name));
  const cardMap = new Map();

  function upsertCard(href, data) {
    if (!isArticleHref(href)) return;
    let relPath = decodeHtmlEntities(String(href).trim());
    if (/^https?:\/\//i.test(relPath) || relPath.startsWith('//')) {
      try {
        const u = new URL(relPath.startsWith('//') ? `https:${relPath}` : relPath);
        relPath = `${u.pathname}${u.search}`;
      } catch (_) {}
    }
    if (!relPath.startsWith('/')) relPath = `/${relPath}`;

    const existing = cardMap.get(relPath) || {
      vod_id: relPath,
      vod_name: '',
      vod_pic: '',
      vod_remarks: '',
      _titlePriority: 0,
    };

    const incomingName = cleanArticleTitle(data.vod_name, categoryNamesSet);
    const incomingPriority = data.titlePriority || 1;
    if (incomingName) {
      if (!existing.vod_name) {
        existing.vod_name = incomingName;
        existing._titlePriority = incomingPriority;
      } else if (incomingPriority > existing._titlePriority) {
        existing.vod_name = incomingName;
        existing._titlePriority = incomingPriority;
      } else if (
        incomingPriority === existing._titlePriority &&
        incomingName.length > existing.vod_name.length
      ) {
        existing.vod_name = incomingName;
      } else if (incomingName.startsWith(existing.vod_name) && incomingName.length > existing.vod_name.length) {
        existing.vod_name = incomingName;
      }
    }

    if (data.vod_pic && !existing.vod_pic) {
      existing.vod_pic = formatVodPic(data.vod_pic, inReq);
    }
    if (data.vod_remarks && !existing.vod_remarks) {
      existing.vod_remarks = data.vod_remarks;
    }
    cardMap.set(relPath, existing);
  }

  function processCardBlock(block) {
    const aRegex = /<a\b([^>]*?)href\s*=\s*(['"])([^'"]+)\2([^>]*?)>([\s\S]*?)<\/a>/gi;
    let aMatch;
    let primaryHref = '';
    let bestTitle = '';
    let bestPriority = 0;

    const headingMatch = block.match(/<h[1-5]\b[^>]*>([\s\S]*?)<\/h[1-5]>/i);
    if (headingMatch) {
      const ht = cleanArticleTitle(headingMatch[1], categoryNamesSet);
      if (ht) {
        bestTitle = ht;
        bestPriority = 3;
      }
    }

    while ((aMatch = aRegex.exec(block)) !== null) {
      const attrs = `${aMatch[1]} ${aMatch[4]}`;
      const h = aMatch[3];
      const inner = aMatch[5];
      if (!isArticleHref(h)) continue;
      if (!primaryHref) primaryHref = h;

      const isThumbAnchor = /\b(?:thumbnail|thumb|cover|pic)\b/i.test(attrs);
      const isTitleAnchor = /\b(?:title|post-title|entry-title)\b/i.test(attrs);

      const titleAttrMatch = attrs.match(/\btitle\s*=\s*(['"])([^'"]+)\1/i);
      if (titleAttrMatch) {
        const tat = cleanArticleTitle(titleAttrMatch[2], categoryNamesSet);
        if (tat && (3 > bestPriority || (3 === bestPriority && tat.length > bestTitle.length))) {
          bestTitle = tat;
          bestPriority = 3;
        }
      }

      const t = cleanArticleTitle(inner, categoryNamesSet);
      if (t) {
        const prio = isTitleAnchor ? 3 : isThumbAnchor ? 1 : 2;
        if (
          prio > bestPriority ||
          (prio === bestPriority && t.length > bestTitle.length) ||
          (bestTitle && t.startsWith(bestTitle) && t.length > bestTitle.length)
        ) {
          bestTitle = t;
          bestPriority = prio;
        }
      }
    }

    if (!primaryHref) return;

    if (!bestTitle) {
      const altMatch = block.match(/\balt\s*=\s*(['"])([^'"]+)\1/i);
      if (altMatch) {
        bestTitle = cleanArticleTitle(altMatch[2], categoryNamesSet);
        bestPriority = 2;
      }
    }

    const pic = extractImageFromFragment(block);
    const remarks = extractRemarksFromFragment(block);
    upsertCard(primaryHref, {
      vod_name: bestTitle,
      vod_pic: pic,
      vod_remarks: remarks,
      titlePriority: bestPriority,
    });
  }

  const structuredBlocks = extractBalancedTagBlocks(
    workHtml,
    'article|li|div',
    'joe_list__item|post-card|article-item|video-item|list-item|post-list-item|entry-card|masonry-item|blog-post|item-box|vod-item'
  );
  for (const block of structuredBlocks) {
    processCardBlock(block);
  }

  const articleTagRegex = /<article\b[^>]*>([\s\S]*?)<\/article>/gi;
  let match;
  while ((match = articleTagRegex.exec(workHtml)) !== null) {
    processCardBlock(match[0]);
  }

  const anchorRegex = /<a\b([^>]*?)href\s*=\s*(['"])([^'"]+)\2([^>]*?)>([\s\S]*?)<\/a>/gi;
  while ((match = anchorRegex.exec(workHtml)) !== null) {
    const fullAnchor = match[0];
    const attrs = `${match[1]} ${match[4]}`;
    const href = match[3];
    const innerHtml = match[5];

    if (!isArticleHref(href)) continue;

    const isThumbAnchor = /\b(?:thumbnail|thumb|cover|pic)\b/i.test(attrs);
    const isTitleAnchor = /\b(?:title|post-title|entry-title)\b/i.test(attrs);

    let title = '';
    let priority = isTitleAnchor ? 3 : isThumbAnchor ? 1 : 2;

    const titleAttr = attrs.match(/\btitle\s*=\s*(['"])([^'"]+)\1/i);
    if (titleAttr) {
      title = cleanArticleTitle(titleAttr[2], categoryNamesSet);
      if (title) priority = 3;
    }

    const innerClean = cleanArticleTitle(innerHtml, categoryNamesSet);
    if (innerClean) {
      if (!title || innerClean.startsWith(title) || (!isThumbAnchor && innerClean.length > title.length)) {
        title = innerClean;
      }
    }

    if (!title) {
      const altAttr = innerHtml.match(/\balt\s*=\s*(['"])([^'"]+)\1/i);
      if (altAttr) title = cleanArticleTitle(altAttr[2], categoryNamesSet);
    }

    let pic = extractImageFromFragment(fullAnchor);
    const windowStart = Math.max(0, match.index - 450);
    const windowEnd = Math.min(workHtml.length, match.index + fullAnchor.length + 450);
    const surrounding = workHtml.slice(windowStart, windowEnd);

    if (!pic) {
      pic = extractImageFromFragment(surrounding);
    }
    const remarks = extractRemarksFromFragment(surrounding);

    upsertCard(href, {
      vod_name: title,
      vod_pic: pic,
      vod_remarks: remarks,
      titlePriority: priority,
    });
  }

  const results = [];
  for (const card of cardMap.values()) {
    if (!card.vod_name) continue;
    delete card._titlePriority;
    results.push(card);
  }
  return results;
}

function parsePageCount(html, currentPage = 1) {
  if (!html) return currentPage;
  let maxPage = Number(currentPage) || 1;
  const pageMatches = [
    ...html.matchAll(/\/page\/(\d+)\/?/gi),
    ...html.matchAll(/\/category\/[a-z0-9_-]+\/(\d+)\/?/gi),
    ...html.matchAll(/[?&]page=(\d+)/gi),
    ...html.matchAll(/<a\b[^>]*>(\d{1,4})<\/a>/gi),
  ];
  for (const m of pageMatches) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > maxPage && n < 50000) {
      maxPage = n;
    }
  }
  return maxPage;
}

function extractBalancedObject(source, startIndex) {
  if (!source) return null;
  const openIdx = source.indexOf('{', startIndex);
  if (openIdx === -1) return null;

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(openIdx, i + 1);
      }
    }
  }
  return null;
}

function unpackDeanEdwards(html) {
  if (!html || !html.includes('eval(function(p,a,c,k,e,')) return '';
  const unpackedChunks = [];
  const regex =
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    try {
      const payload = m[2];
      const radix = parseInt(m[3], 10);
      const count = parseInt(m[4], 10);
      const symtab = m[6].split('|');

      const encodeBase = (num, base) => {
        const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        if (num < base) return chars[num];
        return encodeBase(Math.floor(num / base), base) + chars[num % base];
      };

      const dict = new Map();
      for (let i = count - 1; i >= 0; i--) {
        const key = encodeBase(i, radix);
        dict.set(key, symtab[i] || key);
      }

      const unpacked = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (token) =>
        dict.has(token) ? dict.get(token) : token
      );
      unpackedChunks.push(unpacked);
    } catch (_) {}
  }
  return unpackedChunks.join('\n');
}

function decodeCmsEncryptedUrl(rawUrl, encryptType = 0) {
  if (!rawUrl) return '';
  let s = String(rawUrl).trim();
  const enc = Number(encryptType) || 0;

  if (enc === 1) {
    try {
      s = decodeURIComponent(s);
    } catch (_) {
      try {
        s = unescape(s);
      } catch (__) {}
    }
  } else if (enc === 2) {
    try {
      const b64Decoded = Buffer.from(s, 'base64').toString('utf8');
      try {
        s = decodeURIComponent(b64Decoded);
      } catch (_) {
        s = unescape(b64Decoded);
      }
    } catch (_) {}
  }

  return normalizeUrl(unescapeStringLiteral(decodeHtmlEntities(s)));
}

function tryDecryptAesText(cipherText, customKey = '', customIv = '') {
  if (!cipherText || typeof cipherText !== 'string') return '';
  const cleaned = cipherText.trim();
  if (cleaned.length < 16) return '';

  const pairs = [...AES_IMAGE_KEY_PAIRS];
  if (customKey && customIv) {
    pairs.unshift({ key: customKey, iv: customIv });
  } else if (customKey && customKey.length === 16) {
    pairs.unshift({ key: customKey, iv: customKey });
  }

  const cipherBuffers = [];
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(cleaned)) {
    try {
      cipherBuffers.push(Buffer.from(cleaned, 'base64'));
    } catch (_) {}
  }
  if (/^[0-9a-fA-F]+$/.test(cleaned) && cleaned.length % 32 === 0) {
    try {
      cipherBuffers.push(Buffer.from(cleaned, 'hex'));
    } catch (_) {}
  }

  for (const pair of pairs) {
    let keyBuf;
    let ivBuf;
    if (pair.key.includes('_')) {
      keyBuf = Buffer.from(pair.key.split('_').map((n) => parseInt(n, 10)));
      ivBuf = Buffer.from(pair.iv.split('_').map((n) => parseInt(n, 10)));
    } else {
      keyBuf = Buffer.from(pair.key, 'utf8');
      ivBuf = Buffer.from(pair.iv, 'utf8');
    }
    if (keyBuf.length !== 16) continue;

    for (const cBuf of cipherBuffers) {
      if (!cBuf || cBuf.length === 0 || cBuf.length % 16 !== 0) continue;
      for (const algo of ['aes-128-cbc', 'aes-128-ecb']) {
        if (algo === 'aes-128-cbc' && ivBuf.length !== 16) continue;
        try {
          const decipher =
            algo === 'aes-128-cbc'
              ? crypto.createDecipheriv(algo, keyBuf, ivBuf)
              : crypto.createDecipheriv(algo, keyBuf, null);
          const out = Buffer.concat([decipher.update(cBuf), decipher.final()]).toString('utf8').trim();
          if (out && /^[\x20-\x7e\u4e00-\u9fa5\s]+$/.test(out) && (out.includes('http') || out.includes('.m3u8') || out.includes('.mp4') || out.startsWith('{'))) {
            return out;
          }
        } catch (_) {}
      }
    }
  }
  return '';
}

function isDirectMediaUrl(urlStr) {
  if (!urlStr) return false;
  const s = String(urlStr).trim();
  if (!/^https?:\/\//i.test(s)) return false;
  if (/(?:preview|sample|trailer|top_banner|native-ad|stat\.php|lazyload|avatar|logo)/i.test(s)) return false;
  try {
    const u = new URL(s);
    if (/\.(?:html|htm|php|jsp|asp)$/i.test(u.pathname) && /[?&](?:url|v|src|vid|file|m3u8|play)=/i.test(u.search)) {
      return false;
    }
    if (/\.(?:m3u8|mp4|flv|mpd|m4s|mov|mkv|webm)$/i.test(u.pathname)) {
      return true;
    }
    if (/\.(?:m3u8|mp4)(?:$|[?&])/i.test(u.search)) {
      return false;
    }
  } catch (_) {}
  return /\.(?:m3u8|mp4|flv|mpd)(?:$|\?)/i.test(s);
}

function tryDecodeBase64Url(str) {
  if (!str || typeof str !== 'string') return '';
  const trimmed = str.trim();
  if (!/^[A-Za-z0-9+/=_-]{16,}$/.test(trimmed) || /^https?:\/\//i.test(trimmed)) return '';
  try {
    const normalizedB64 = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(normalizedB64, 'base64').toString('utf8').trim();
    if (/^(?:https?:\/\/|\/\/|\/[^\s]+)/i.test(decoded)) {
      return decoded;
    }
  } catch (_) {}
  return '';
}

function unwrapNestedMediaUrl(urlStr, baseDomain = activeDomain) {
  const norm = normalizeUrl(urlStr, baseDomain);
  if (!norm) return '';
  if (/(?:preview|sample|trailer|top_banner|native-ad|stat\.php)/i.test(norm)) return '';
  try {
    const u = new URL(norm);
    if (
      /\.(?:m3u8|mp4|flv|mpd|mov|mkv|webm)$/i.test(u.pathname) &&
      !/[?&](?:url|v|src|vid|file|m3u8|play)=https?/i.test(u.search)
    ) {
      return norm;
    }

    const rawNestedMatch = norm.match(/[?&](?:url|v|src|vid|file|m3u8|play)=(https?:\/\/[^\s"'<>]+)$/i);
    if (rawNestedMatch) {
      let rawInner = rawNestedMatch[1];
      try {
        if (/%[0-9A-Fa-f]{2}/.test(rawInner)) {
          rawInner = decodeURIComponent(rawInner);
        }
      } catch (_) {}
      const candidate = normalizeUrl(rawInner, u.origin);
      if (isDirectMediaUrl(candidate)) return candidate;
    }

    const paramKeys = ['url', 'v', 'src', 'vid', 'file', 'm3u8', 'play'];
    for (const k of paramKeys) {
      let val = u.searchParams.get(k);
      if (!val) continue;
      for (let pass = 0; pass < 3; pass++) {
        try {
          const dec = decodeURIComponent(val);
          if (dec === val) break;
          val = dec;
        } catch (_) {
          break;
        }
      }
      const b64Candidate = tryDecodeBase64Url(val);
      if (b64Candidate) val = b64Candidate;
      const candidate = normalizeUrl(val, u.origin);
      if (isDirectMediaUrl(candidate)) {
        return candidate;
      }
    }
  } catch (_) {}
  return isDirectMediaUrl(norm) ? norm : '';
}

function extractArticleRegion(html) {
  if (!html) return '';
  const blocks = extractBalancedTagBlocks(
    html,
    'article|div|main',
    'joe_detail__article|post-content|entry-content|article-content|joe_detail'
  );
  if (blocks.length > 0) {
    return blocks.join('\n');
  }
  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) return articleMatch[1];
  return '';
}

function findNearbyEpisodeLabel(source, index, fallbackIndex) {
  const lookbehind = source.slice(Math.max(0, index - 600), index);
  const headingMatches = [
    ...lookbehind.matchAll(/<(?:h[1-5]|strong|b)\b[^>]*>([\s\S]*?)<\/(?:h[1-5]|strong|b)>/gi),
    ...lookbehind.matchAll(/<p\b[^>]*>([\s\S]{1,60}?)<\/p>/gi),
  ];
  for (let i = headingMatches.length - 1; i >= 0; i--) {
    const raw = stripTags(headingMatches[i][1])
      .replace(/[$#]/g, ' ')
      .trim();
    if (
      raw &&
      raw.length >= 2 &&
      raw.length <= 35 &&
      !/^(?:91大赛|今日大赛|热搜大赛|每日大赛|免责声明|关键词|标签)/.test(raw)
    ) {
      return raw;
    }
  }
  return fallbackIndex === 0 ? '正片' : `第${fallbackIndex + 1}集`;
}

function buildJsVarMap(source) {
  const varMap = new Map();
  if (!source) return varMap;

  const strVarRegex = /\b(?:var|let|const)\s+([a-zA-Z_$][\w$]*)\s*=\s*(['"])([^'"]{8,})\2/g;
  let m;
  while ((m = strVarRegex.exec(source)) !== null) {
    varMap.set(m[1], unescapeStringLiteral(decodeHtmlEntities(m[3].trim())));
  }

  const atobRegex = /\b(?:var|let|const)?\s*([a-zA-Z_$][\w$]*)\s*=\s*(?:window\.)?atob\(\s*(['"])([A-Za-z0-9+/=]+)\2\s*\)/g;
  while ((m = atobRegex.exec(source)) !== null) {
    try {
      const dec = Buffer.from(m[3], 'base64').toString('utf8').trim();
      if (dec) varMap.set(m[1], dec);
    } catch (_) {}
  }

  const decCallRegex =
    /\b(?:decryptDatas|decryptUrl|decryptVideo|aesDecrypt|decrypt)\s*\(\s*(['"])([^'"]+)\1(?:\s*,\s*(['"])([^'"]+)\3)?(?:\s*,\s*(['"])([^'"]+)\5)?\s*\)/g;
  while ((m = decCallRegex.exec(source)) !== null) {
    const out = tryDecryptAesText(m[2], m[4] || '', m[6] || '');
    if (out) {
      varMap.set(`__decrypted_${m.index}`, out);
    }
  }

  const varDecCallRegex =
    /\b(?:decryptDatas|decryptUrl|decryptVideo|aesDecrypt)\s*\(\s*([a-zA-Z_$][\w$]*)(?:\s*,\s*(?:(['"])([^'"]+)\2|([a-zA-Z_$][\w$]*)))?\s*\)/g;
  while ((m = varDecCallRegex.exec(source)) !== null) {
    const cipherVal = varMap.get(m[1]);
    const keyVal = m[3] || (m[4] ? varMap.get(m[4]) : '') || '';
    if (cipherVal) {
      const out = tryDecryptAesText(cipherVal, keyVal);
      if (out) varMap.set(`__decrypted_var_${m.index}`, out);
    }
  }

  return varMap;
}

function scanSourceForStreams(sourceChunk, baseDomain = activeDomain) {
  if (!sourceChunk) return [];
  const streams = [];
  const seen = new Set();
  const labelCounter = new Map();

  const addStream = (urlCandidate, rawLabel = '') => {
    if (!urlCandidate) return;
    let candidateStr = unescapeStringLiteral(decodeHtmlEntities(String(urlCandidate).trim()));
    const b64 = tryDecodeBase64Url(candidateStr);
    if (b64) candidateStr = b64;

    let resolved = unwrapNestedMediaUrl(candidateStr, baseDomain);
    if (!resolved) {
      const normalized = normalizeUrl(candidateStr, baseDomain);
      if (isDirectMediaUrl(normalized)) resolved = normalized;
    }
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);

    let cleanLabel = String(rawLabel || '')
      .replace(/[$#]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleanLabel) {
      cleanLabel = streams.length === 0 ? '正片' : `第${streams.length + 1}集`;
    }
    const count = (labelCounter.get(cleanLabel) || 0) + 1;
    labelCounter.set(cleanLabel, count);
    const finalLabel = count > 1 ? `${cleanLabel} (${count})` : cleanLabel;

    streams.push({
      label: finalLabel,
      url: resolved,
    });
  };

  const unpacked = unpackDeanEdwards(sourceChunk);
  const fullSource = unpacked ? `${sourceChunk}\n${unpacked}` : sourceChunk;
  const varMap = buildJsVarMap(fullSource);

  for (const [k, v] of varMap.entries()) {
    if (k.startsWith('__decrypted_')) {
      try {
        const parsed = JSON.parse(v);
        const u = parsed?.video?.url || parsed?.url || parsed?.src || parsed?.file;
        if (u) addStream(u);
      } catch (_) {
        addStream(v);
      }
    }
  }

  // 1. DPlayer data-config attribute (handles balanced braces & HTML-entity JSON)
  const dataConfigStartRegex = /\bdata-config\s*=\s*(['"]?)/gi;
  let m;
  while ((m = dataConfigStartRegex.exec(fullSource)) !== null) {
    const epLabel = findNearbyEpisodeLabel(fullSource, m.index, streams.length);
    const afterEq = fullSource.slice(m.index + m[0].length - (m[1] ? 1 : 0), m.index + 4000);
    const decodedSlice = decodeHtmlEntities(afterEq);
    const balanced = extractBalancedObject(decodedSlice, 0);
    if (balanced) {
      try {
        const parsed = JSON.parse(balanced);
        const vUrl = parsed?.video?.url || parsed?.url || parsed?.src;
        if (vUrl) addStream(vUrl, epLabel);
        if (Array.isArray(parsed?.video?.quality)) {
          for (const q of parsed.video.quality) {
            if (q?.url) addStream(q.url, q.name || epLabel);
          }
        }
        continue;
      } catch (_) {
        const urlMatch = balanced.match(/['"]?url['"]?\s*:\s*(['"])([^'"]+)\1/i);
        if (urlMatch) {
          addStream(urlMatch[2], epLabel);
          continue;
        }
      }
    }
  }

  // 2. Joe theme <joe-dplayer ...> or DPlayer / player container tags
  const playerTagRegex =
    /<(?:joe-dplayer|(?:div|section)\b[^>]*(?:class|id)\s*=\s*['"][^'"]*(?:dplayer|joe_detail__article-video|artplayer|video-player|aliplayer)[^'"]*['"])[^>]*>/gi;
  while ((m = playerTagRegex.exec(fullSource)) !== null) {
    const tag = m[0];
    const epLabel = findNearbyEpisodeLabel(fullSource, m.index, streams.length);
    const attrMatch = tag.match(/\b(?:data-src|data-url|video-url|data-video|src|url)\s*=\s*(['"])([^'"]+)\1/i);
    if (attrMatch) addStream(attrMatch[2], epLabel);
  }

  // 3. Typecho Joe / WordPress shortcodes: {dplayer url="..."} or [dplayer url="..."]
  const shortcodeRegex =
    /(?:\{|\[)(?:dplayer|dplayer-single|video|mp4)\b[^}\]]*?\b(?:url|src)\s*=\s*(?:(['"])([^'"]+)\1|([^\s}\]]+))[^}\]]*(?:\}|\])/gi;
  while ((m = shortcodeRegex.exec(fullSource)) !== null) {
    const epLabel = findNearbyEpisodeLabel(fullSource, m.index, streams.length);
    addStream(m[2] || m[3], epLabel);
  }

  // 4. CMS & Player config objects (player_aaaa, player_data, player_config, new DPlayer, new Artplayer)
  const playerObjStartRegex =
    /(?:\b(?:player_aaaa|player_data|player_config|videoInfo|dplayerConfig)\s*=\s*|\bnew\s+(?:DPlayer|Artplayer|Aliplayer|Playerjs)\s*\(\s*)/g;
  while ((m = playerObjStartRegex.exec(fullSource)) !== null) {
    const objLiteral = extractBalancedObject(fullSource, m.index + m[0].length);
    if (!objLiteral) continue;
    try {
      const parsed = JSON.parse(objLiteral);
      const rawUrl = parsed?.video?.url || parsed?.url || parsed?.src || parsed?.file;
      if (rawUrl) {
        addStream(decodeCmsEncryptedUrl(rawUrl, parsed.encrypt));
        continue;
      }
    } catch (_) {}

    const videoBlockMatch = objLiteral.match(/['"]?video['"]?\s*:\s*\{([\s\S]*?)\}/i);
    const targetScope = videoBlockMatch ? videoBlockMatch[1] : objLiteral;
    const urlField = targetScope.match(/['"]?(?:url|src|file)['"]?\s*:\s*(?:(['"])([^'"]+)\1|([a-zA-Z_$][\w$]*))/i);
    const encField = objLiteral.match(/['"]?encrypt['"]?\s*:\s*(\d+)/i);
    if (urlField) {
      const candidate = urlField[2] || (urlField[3] ? varMap.get(urlField[3]) : '');
      if (candidate) {
        addStream(decodeCmsEncryptedUrl(candidate, encField ? encField[1] : 0));
      }
    }
  }

  // 5. Generic JS video: { url: ... } or hls.loadSource(...) or priority variables
  const jsVideoObjRegex =
    /['"]?video['"]?\s*:\s*\{[\s\S]{1,600}?['"]?url['"]?\s*:\s*(?:(['"])([^'"]+)\1|([a-zA-Z_$][\w$]*))/gi;
  while ((m = jsVideoObjRegex.exec(fullSource)) !== null) {
    const candidate = m[2] || (m[3] ? varMap.get(m[3]) : '');
    if (candidate) addStream(candidate);
  }

  const hlsLoadRegex =
    /(?:loadSource|player\.src|video\.src)\s*(?:\(\s*|=\s*)(?:(['"])([^'"]+)\1|([a-zA-Z_$][\w$]*))/gi;
  while ((m = hlsLoadRegex.exec(fullSource)) !== null) {
    const candidate = m[2] || (m[3] ? varMap.get(m[3]) : '');
    if (candidate) addStream(candidate);
  }

  const priorityVarRegex =
    /\b(?:playUrl|videoUrl|video_url|m3u8Url|m3u8_url|mp4Url|srcUrl|rawUrl|vUrl)\s*=\s*(['"])([^'"]+)\1/gi;
  while ((m = priorityVarRegex.exec(fullSource)) !== null) {
    addStream(m[2]);
  }

  // 6. <video> and <source> tags
  const videoTagRegex = /<(?:video|source)\b[^>]*\b(?:src|data-src)\s*=\s*(['"])([^'"]+)\1[^>]*>/gi;
  while ((m = videoTagRegex.exec(fullSource)) !== null) {
    addStream(m[2]);
  }

  // 7. Direct media URLs in unescaped source
  const unescapedSource = unescapeStringLiteral(decodeHtmlEntities(fullSource));
  const directMediaRegex =
    /https?:\/\/[^\s"'<>\\(){}\[\],;]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\(){}\[\],;]*)?/gi;
  while ((m = directMediaRegex.exec(unescapedSource)) !== null) {
    addStream(m[0]);
  }

  // 8. Root-relative media paths (/.../index.m3u8 or /.../.mp4)
  const relMediaRegex = /(['"])(\/[^\s"'<>\\(){}\[\],;]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\(){}\[\],;]*)?)\1/gi;
  while ((m = relMediaRegex.exec(unescapedSource)) !== null) {
    addStream(m[2]);
  }

  return streams;
}

function extractStreamsFromHtml(html, baseDomain = activeDomain) {
  if (!html) return [];
  const articleRegion = extractArticleRegion(html);
  if (articleRegion) {
    const articleStreams = scanSourceForStreams(articleRegion, baseDomain);
    if (articleStreams.length > 0) {
      return articleStreams;
    }
  }
  return scanSourceForStreams(html, baseDomain);
}

function extractIframePlayerUrls(html, baseDomain = activeDomain) {
  if (!html) return [];
  const iframes = [];
  const regions = [extractArticleRegion(html), html].filter(Boolean);
  for (const region of regions) {
    const iframeRegex = /<iframe\b[^>]*>/gi;
    let m;
    while ((m = iframeRegex.exec(region)) !== null) {
      const tag = m[0];
      const srcMatch =
        tag.match(/\bdata-litespeed-src\s*=\s*(['"])([^'"]+)\1/i) ||
        tag.match(/\bdata-lazy-src\s*=\s*(['"])([^'"]+)\1/i) ||
        tag.match(/\bdata-src\s*=\s*(['"])([^'"]+)\1/i) ||
        tag.match(/\bsrc\s*=\s*(['"])([^'"]+)\1/i);
      if (!srcMatch) continue;
      const rawSrc = srcMatch[2].trim();
      if (/^(?:about:blank|javascript:|data:)/i.test(rawSrc)) continue;
      if (/(?:google|doubleclick|exoclick|juicyads|magsrv|stat|analytics)/i.test(rawSrc)) continue;
      const norm = normalizeUrl(rawSrc, baseDomain);
      if (norm && !iframes.includes(norm)) {
        iframes.push(norm);
      }
    }
    if (iframes.length > 0) break;
  }
  return iframes;
}

function extractSubArticleEpisodes(html, currentUrl = '') {
  const articleRegion = extractArticleRegion(html);
  if (!articleRegion) return [];

  let cleanRegion = articleRegion;
  for (const marker of ['91大赛常见问题', '相关推荐', '猜你喜欢', '发表评论', '评论列表', '版权声明']) {
    const idx = cleanRegion.indexOf(marker);
    if (idx > 100) cleanRegion = cleanRegion.slice(0, idx);
  }

  let currentPath = '';
  try {
    currentPath = new URL(currentUrl, activeDomain).pathname;
  } catch (_) {}

  const subItems = [];
  const seenPaths = new Set();
  const categoryNamesSet = new Set(CATEGORIES.map((c) => c.type_name));

  const aRegex = /<a\b[^>]*href\s*=\s*(['"])([^'"]+)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aRegex.exec(cleanRegion)) !== null) {
    const href = m[2];
    if (!isArticleHref(href)) continue;
    const norm = normalizeUrl(href, activeDomain);
    if (!norm) continue;
    let pathname = '';
    try {
      pathname = new URL(norm).pathname;
    } catch (_) {
      continue;
    }
    if (pathname === currentPath || seenPaths.has(pathname)) continue;
    seenPaths.add(pathname);

    let label = cleanArticleTitle(m[3], categoryNamesSet)
      .replace(/^(?:👉|点击查看|点此观看|立即观看|查看详情|视频链接)[:：\s]*/i, '')
      .replace(/[$#]/g, ' ')
      .trim();
    if (!label) {
      label = findNearbyEpisodeLabel(cleanRegion, m.index, subItems.length);
    }
    subItems.push({
      label: label || `第${subItems.length + 1}集`,
      url: pathname,
    });
  }
  return subItems;
}

async function resolveStreamsWithFallback(html, pageUrl) {
  let baseOrigin = activeDomain;
  try {
    baseOrigin = new URL(pageUrl).origin;
  } catch (_) {}

  const streams = extractStreamsFromHtml(html, baseOrigin);
  if (streams.length > 0) return streams;

  const iframes = extractIframePlayerUrls(html, baseOrigin);
  for (const iframeUrl of iframes.slice(0, 3)) {
    const unwrapped = unwrapNestedMediaUrl(iframeUrl, baseOrigin);
    if (unwrapped) {
      streams.push({ label: streams.length === 0 ? '正片' : `第${streams.length + 1}集`, url: unwrapped });
      continue;
    }
    try {
      const { html: iframeHtml, finalUrl } = await fetchHtml(iframeUrl, {
        headers: { Referer: pageUrl },
        allowAnyHtml: true,
      });
      const subStreams = extractStreamsFromHtml(iframeHtml, new URL(finalUrl).origin);
      for (const s of subStreams) {
        streams.push(s);
      }
    } catch (_) {}
  }

  return streams;
}

function isImageMagic(buf) {
  if (!buf || buf.length < 4) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8) return true; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true; // GIF
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return true; // WEBP
  if (buf[0] === 0x42 && buf[1] === 0x4d) return true; // BMP
  return false;
}

function tryDecryptImageBuffer(rawBuffer) {
  if (!rawBuffer || rawBuffer.length < 4) return null;

  if (isImageMagic(rawBuffer)) {
    return rawBuffer;
  }

  const cipherCandidates = [rawBuffer];
  const asText = rawBuffer.toString('utf8').trim();

  if (asText.startsWith('data:image/')) {
    const commaIdx = asText.indexOf(',');
    if (commaIdx !== -1) {
      try {
        const b64Part = asText.slice(commaIdx + 1).replace(/\s+/g, '');
        const decoded = Buffer.from(b64Part, 'base64');
        if (isImageMagic(decoded)) return decoded;
        cipherCandidates.unshift(decoded);
      } catch (_) {}
    }
  }

  const cleanB64 = asText.replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/=_-]+$/.test(cleanB64) && cleanB64.length >= 16) {
    try {
      const b64Buf = Buffer.from(cleanB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      if (isImageMagic(b64Buf)) {
        return b64Buf;
      }
      if (b64Buf.length >= 16) {
        cipherCandidates.unshift(b64Buf);
      }
    } catch (_) {}
  }

  for (const pair of AES_IMAGE_KEY_PAIRS) {
    let keyBuf;
    let ivBuf;
    if (pair.key.includes('_')) {
      keyBuf = Buffer.from(pair.key.split('_').map((n) => parseInt(n, 10)));
      ivBuf = Buffer.from(pair.iv.split('_').map((n) => parseInt(n, 10)));
    } else {
      keyBuf = Buffer.from(pair.key, 'utf8');
      ivBuf = Buffer.from(pair.iv, 'utf8');
    }
    if (keyBuf.length !== 16 || ivBuf.length !== 16) continue;

    for (const candidate of cipherCandidates) {
      if (!candidate || candidate.length < 16) continue;
      const blockAligned =
        candidate.length % 16 === 0
          ? candidate
          : candidate.subarray(0, candidate.length - (candidate.length % 16));
      if (blockAligned.length < 16) continue;

      for (const algo of ['aes-128-cbc', 'aes-128-ecb']) {
        for (const autoPad of [true, false]) {
          try {
            const decipher =
              algo === 'aes-128-cbc'
                ? crypto.createDecipheriv(algo, keyBuf, ivBuf)
                : crypto.createDecipheriv(algo, keyBuf, null);
            decipher.setAutoPadding(autoPad);
            const decrypted = Buffer.concat([decipher.update(blockAligned), decipher.final()]);
            if (isImageMagic(decrypted)) {
              return decrypted;
            }
            const decStr = decrypted.toString('utf8').trim();
            if (decStr.startsWith('data:image/')) {
              const b64Part = decStr.split(',')[1];
              if (b64Part) {
                const inner = Buffer.from(b64Part.replace(/\s+/g, ''), 'base64');
                if (isImageMagic(inner)) return inner;
              }
            } else if (/^\/9j\/|^iVBORw0KGgo|^R0lGOD|^UklGR/.test(decStr)) {
              const inner = Buffer.from(decStr.replace(/\s+/g, ''), 'base64');
              if (isImageMagic(inner)) return inner;
            }
          } catch (_) {}
        }
      }
    }
  }

  return rawBuffer;
}

function detectImageMime(buf) {
  if (!buf || buf.length < 4) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'image/webp';
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp';
  return 'image/jpeg';
}

function coerceResponseToBuffer(raw) {
  if (!raw) return Buffer.alloc(0);
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  if (ArrayBuffer.isView(raw)) return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('data:image/')) {
      return Buffer.from(trimmed, 'utf8');
    }
    const noWs = trimmed.replace(/\s+/g, '');
    if (noWs.length >= 16 && noWs.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(noWs)) {
      return Buffer.from(trimmed, 'utf8');
    }
    return Buffer.from(raw, 'binary');
  }
  if (Array.isArray(raw)) return Buffer.from(raw);
  return Buffer.alloc(0);
}

async function proxyPicHandler(query = {}) {
  let targetUrl = String(query.url || '').trim();
  try {
    if (/%[0-9A-Fa-f]{2}/.test(targetUrl)) {
      targetUrl = decodeURIComponent(targetUrl);
    }
  } catch (_) {}
  if (!targetUrl) {
    return { mime: 'image/jpeg', data: Buffer.alloc(0) };
  }

  const cached = PIC_CACHE.get(targetUrl);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { mime: cached.mime, data: cached.data };
  }

  try {
    const res = await fetchRaw(targetUrl, {
      responseType: 'arraybuffer',
      headers: {
        Referer: `${activeDomain}/`,
        Origin: activeDomain,
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });
    const raw = res?.data ?? res?.body ?? res?.content ?? res;
    const rawBuf = coerceResponseToBuffer(raw);
    const outBuf = tryDecryptImageBuffer(rawBuf) || rawBuf;
    const mime = detectImageMime(outBuf);
    if (isImageMagic(outBuf) && PIC_CACHE.size < 200) {
      PIC_CACHE.set(targetUrl, { mime, data: outBuf, ts: Date.now() });
    }
    return { mime, data: outBuf };
  } catch (_) {
    return { mime: 'image/jpeg', data: Buffer.alloc(0) };
  }
}

async function proxyStreamHandler(query = {}, inReq = null) {
  let targetUrl = String(query.url || '').trim();
  try {
    if (/%[0-9A-Fa-f]{2}/.test(targetUrl)) {
      targetUrl = decodeURIComponent(targetUrl);
    }
  } catch (_) {}
  if (!targetUrl) {
    return { status: 400, mime: 'text/plain', data: Buffer.alloc(0) };
  }

  const forceTs = query.type === 'ts' || /\.(?:ts|m4s)(?:$|\?)/i.test(targetUrl);
  try {
    const res = await fetchRaw(targetUrl, {
      responseType: 'arraybuffer',
      headers: {
        Referer: `${activeDomain}/`,
        Origin: activeDomain,
      },
    });
    const raw = res?.data ?? res?.body ?? res?.content ?? res;
    let buf = coerceResponseToBuffer(raw);

    const textSample = buf.subarray(0, 64).toString('utf8').trim();
    if (!forceTs && (textSample.startsWith('#EXTM3U') || /\.m3u8(?:$|\?)/i.test(targetUrl))) {
      const m3u8Text = decodeBufferToText(buf);
      const proxyBase =
        getRouteProxyBase(inReq, 'proxy') ||
        (localProxyPort > 0 ? `http://127.0.0.1:${localProxyPort}/proxy` : '/proxy');

      const rewritten = m3u8Text
        .split(/\r?\n/)
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return line;
          if (trimmed.startsWith('#EXT-X-KEY') || trimmed.startsWith('#EXT-X-MAP')) {
            return line.replace(/URI=(['"])([^'"]+)\1/i, (_, q, uri) => {
              const absKey = normalizeUrl(uri, targetUrl);
              return `URI=${q}${proxyBase}?url=${encodeURIComponent(absKey)}${q}`;
            });
          }
          if (trimmed.startsWith('#')) return line;
          const absSeg = new URL(trimmed, targetUrl).href;
          const isSubM3u8 = /\.m3u8(?:$|\?)/i.test(absSeg);
          return `${proxyBase}?url=${encodeURIComponent(absSeg)}${isSubM3u8 ? '' : '&type=ts'}`;
        })
        .join('\n');

      return {
        status: 200,
        mime: 'application/vnd.apple.mpegurl',
        data: Buffer.from(rewritten, 'utf8'),
      };
    }

    if (forceTs && buf.length > 188 && buf[0] !== 0x47) {
      for (let i = 1; i < Math.min(buf.length - 188, 512); i++) {
        if (buf[i] === 0x47 && buf[i + 188] === 0x47) {
          buf = buf.subarray(i);
          break;
        }
      }
    }

    return {
      status: 200,
      mime: forceTs ? 'video/mp2t' : 'application/octet-stream',
      data: buf,
    };
  } catch (_) {
    return { status: 502, mime: 'text/plain', data: Buffer.alloc(0) };
  }
}

async function init(inReq, _outResp) {
  const params = unwrapRequestParams(inReq);
  const customDomain = params.domain || params.site || params.host || params.url;
  if (customDomain && typeof customDomain === 'string' && /^https?:\/\//i.test(customDomain.trim())) {
    const clean = customDomain.trim().replace(/\/+$/, '');
    activeDomain = clean;
    if (!SITE_DOMAINS.includes(clean)) SITE_DOMAINS.unshift(clean);
  }
  if (params.proxy === '1' || params.proxy === true || params.proxy === 1) {
    forceStreamProxy = true;
  }
  await ensureLocalProxyServer();
  return {};
}

async function home(inReq, _outResp) {
  await ensureLocalProxyServer();
  const classes = CATEGORIES.map(({ type_id, type_name }) => ({
    type_id,
    type_name,
  }));

  let list = [];
  try {
    const { html } = await fetchHtml('/');
    list = parseVideoCards(html, inReq);
    if (list.length === 0) {
      const { html: catHtml } = await fetchHtml(CATEGORIES[0].type_id);
      list = parseVideoCards(catHtml, inReq);
    }
  } catch (_) {}

  return {
    class: classes,
    filters: {},
    list,
    style: { type: 'rect', ratio: 1.78 },
  };
}

async function homeVod(inReq, outResp) {
  const res = await home(inReq, outResp);
  return { list: res.list || [] };
}

async function category(inReq, secondArg) {
  await ensureLocalProxyServer();
  const params = unwrapRequestParams(inReq, secondArg);
  const tid = String(params.id || params.tid || params.type_id || CATEGORIES[0].type_id).trim();
  const pg = Math.max(1, parseInt(params.page || params.pg || '1', 10) || 1);

  let cleanTid = tid;
  if (/^https?:\/\//i.test(cleanTid)) {
    try {
      cleanTid = new URL(cleanTid).pathname;
    } catch (_) {}
  }
  if (!cleanTid.startsWith('/')) cleanTid = `/${cleanTid}`;
  if (!cleanTid.endsWith('/')) cleanTid = `${cleanTid}/`;

  const candidatePaths =
    pg > 1
      ? [`${cleanTid}${pg}/`, `${cleanTid}page/${pg}/`, `/index.php${cleanTid}${pg}/`]
      : [cleanTid, `/index.php${cleanTid}`];

  let html = '';
  let list = [];
  for (const path of candidatePaths) {
    const res = await fetchHtml(path);
    if (res.html) {
      const parsed = parseVideoCards(res.html, inReq);
      if (parsed.length > 0) {
        html = res.html;
        list = parsed;
        break;
      }
      if (!html) html = res.html;
    }
  }

  const pagecount = Math.max(pg, parsePageCount(html, pg));
  return {
    page: pg,
    pagecount,
    limit: list.length || 20,
    total: pagecount * (list.length || 20),
    list,
  };
}

async function detail(inReq, _outResp) {
  await ensureLocalProxyServer();
  const params = unwrapRequestParams(inReq);
  const rawId =
    params.id ||
    params.ids ||
    params.url ||
    '';
  const vodId = String(rawId || '').trim();
  if (!vodId) return { list: [] };

  const { html, finalUrl } = await fetchHtml(vodId);
  const categoryNamesSet = new Set(CATEGORIES.map((c) => c.type_name));

  let title = '';
  const detailTitleMatch =
    html.match(/<h1\b[^>]*class\s*=\s*['"][^'"]*(?:title|post-title|entry-title|joe_detail__title)[^'"]*['"][^>]*>([\s\S]*?)<\/h1>/i) ||
    html.match(/<meta\b[^>]*property\s*=\s*['"]og:title['"][^>]*content\s*=\s*['"]([^'"]+)['"]/i) ||
    html.match(/<meta\b[^>]*content\s*=\s*['"]([^'"]+)['"][^>]*property\s*=\s*['"]og:title['"]/i) ||
    html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (detailTitleMatch) {
    title = cleanArticleTitle(detailTitleMatch[1], categoryNamesSet);
  }
  if (!title) {
    const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    if (titleTag) {
      const rawT = stripTags(titleTag[1]).replace(/\s*[-|_]\s*91大赛.*$/i, '').trim();
      title = cleanArticleTitle(rawT, categoryNamesSet) || rawT;
    }
  }

  const articleBody = extractArticleRegion(html) || html;

  let pic = '';
  const ogImage =
    html.match(/<meta\b[^>]*property\s*=\s*['"]og:image['"][^>]*content\s*=\s*['"]([^'"]+)['"]/i) ||
    html.match(/<meta\b[^>]*content\s*=\s*['"]([^'"]+)['"][^>]*property\s*=\s*['"]og:image['"]/i);
  if (ogImage && isCandidateCoverUrl(ogImage[1])) {
    pic = formatVodPic(ogImage[1], inReq);
  }
  if (!pic) {
    const extractedPic = extractImageFromFragment(articleBody);
    if (extractedPic) pic = formatVodPic(extractedPic, inReq);
  }

  let typeName = '';
  for (const c of CATEGORIES) {
    if (html.includes(c.type_name)) {
      typeName = c.type_name;
      break;
    }
  }
  const dateMatch = html.match(/\b(20\d{2}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*日?)/);
  const vodYear = dateMatch ? dateMatch[1].replace(/\s+/g, '') : '';

  let content = '';
  const descMeta =
    html.match(/<meta\b[^>]*name\s*=\s*['"]description['"][^>]*content\s*=\s*['"]([^'"]+)['"]/i) ||
    html.match(/<meta\b[^>]*content\s*=\s*['"]([^'"]+)['"][^>]*name\s*=\s*['"]description['"]/i);
  if (descMeta) {
    content = cleanArticleTitle(descMeta[1]);
  }
  if (!content) {
    content = cleanArticleTitle(articleBody).slice(0, 300);
  }

  let streams = await resolveStreamsWithFallback(html, finalUrl);

  if (streams.length === 0) {
    const subEpisodes = extractSubArticleEpisodes(html, finalUrl);
    if (subEpisodes.length > 0) {
      streams = subEpisodes;
      try {
        const firstSub = subEpisodes[0];
        const { html: subHtml, finalUrl: subFinalUrl } = await fetchHtml(firstSub.url);
        const subStreams = await resolveStreamsWithFallback(subHtml, subFinalUrl);
        if (subStreams.length > 0) {
          setCachedPlay(firstSub.url, subStreams[0].url);
          setCachedPlay(subFinalUrl, subStreams[0].url);
          setCachedPlay(vodId, subStreams[0].url);
        }
      } catch (_) {}
    }
  }

  let playUrlStr = '';
  if (streams.length > 0) {
    if (isDirectMediaUrl(streams[0].url)) {
      setCachedPlay(vodId, streams[0].url);
      setCachedPlay(finalUrl, streams[0].url);
    }
    playUrlStr = streams
      .map((s, idx) => {
        const rawLabel = streams.length === 1 ? '正片' : s.label || `第${idx + 1}集`;
        const epLabel = String(rawLabel).replace(/[$#]/g, ' ').trim() || `第${idx + 1}集`;
        return `${epLabel}$${s.url}`;
      })
      .join('#');
  } else {
    playUrlStr = `正片$${finalUrl || normalizeUrl(vodId)}`;
  }

  const vod = {
    vod_id: vodId,
    vod_name: title || '91大赛视频',
    vod_pic: pic,
    type_name: typeName,
    vod_year: vodYear,
    vod_remarks: typeName || vodYear,
    vod_content: content || title || '91大赛视频',
    vod_play_from: SPIDER_NAME,
    vod_play_url: playUrlStr,
  };

  return { list: [vod] };
}

function sanitizePlayId(rawId) {
  let id = String(rawId || '').trim();
  if (!id) return '';

  if (id.includes('@@@')) {
    id = id.split('@@@')[0].trim();
  }

  if (id.includes('#')) {
    id = id.split('#')[0].trim();
  }

  if (id.includes('$')) {
    const dollarIdx = id.indexOf('$');
    const prefix = id.slice(0, dollarIdx).trim();
    if (!/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
      id = id.slice(dollarIdx + 1).trim();
    }
  }

  return decodeHtmlEntities(unescapeStringLiteral(id));
}

function maybeWrapStreamWithProxy(streamUrl, inReq, params = {}) {
  const useProxy =
    forceStreamProxy ||
    params.proxy === '1' ||
    params.proxy === true ||
    params.proxy === 1;
  if (!useProxy || !streamUrl) return streamUrl;
  const proxyBase =
    getRouteProxyBase(inReq, 'proxy') ||
    (localProxyPort > 0 ? `http://127.0.0.1:${localProxyPort}/proxy` : '');
  if (proxyBase && /^https?:\/\//i.test(proxyBase)) {
    return `${proxyBase}?url=${encodeURIComponent(streamUrl)}`;
  }
  return streamUrl;
}

async function play(inReq, secondArg) {
  await ensureLocalProxyServer();
  let params = {};
  if (typeof inReq === 'string' && secondArg !== undefined) {
    params = { flag: inReq, id: String(secondArg) };
  } else {
    params = unwrapRequestParams(inReq);
  }

  const rawId = params.id || params.url || params.playUrl || '';
  const cleanId = sanitizePlayId(rawId);

  const playHeaders = {
    'User-Agent': DEFAULT_UA,
    Referer: `${activeDomain}/`,
    Origin: activeDomain,
  };

  if (!cleanId) {
    return { parse: 0, jx: 0, url: '', header: playHeaders, headers: playHeaders };
  }

  const directCandidate = unwrapNestedMediaUrl(cleanId, activeDomain);
  if (directCandidate) {
    return {
      parse: 0,
      jx: 0,
      url: maybeWrapStreamWithProxy(directCandidate, inReq, params),
      header: playHeaders,
      headers: playHeaders,
    };
  }

  const cachedStream = getCachedPlay(cleanId);
  if (cachedStream && isDirectMediaUrl(cachedStream)) {
    return {
      parse: 0,
      jx: 0,
      url: maybeWrapStreamWithProxy(cachedStream, inReq, params),
      header: playHeaders,
      headers: playHeaders,
    };
  }

  const { html, finalUrl } = await fetchHtml(cleanId);
  let originReferer = `${activeDomain}/`;
  let originHost = activeDomain;
  try {
    const parsedOrigin = new URL(finalUrl).origin;
    originReferer = `${parsedOrigin}/`;
    originHost = parsedOrigin;
  } catch (_) {}

  const resolvedHeaders = {
    'User-Agent': DEFAULT_UA,
    Referer: originReferer,
    Origin: originHost,
  };

  let streams = await resolveStreamsWithFallback(html, finalUrl);

  if (streams.length === 0) {
    const subEpisodes = extractSubArticleEpisodes(html, finalUrl);
    if (subEpisodes.length > 0) {
      const { html: subHtml, finalUrl: subFinalUrl } = await fetchHtml(subEpisodes[0].url);
      streams = await resolveStreamsWithFallback(subHtml, subFinalUrl);
    }
  }

  if (streams.length > 0 && isDirectMediaUrl(streams[0].url)) {
    const streamUrl = streams[0].url;
    setCachedPlay(cleanId, streamUrl);
    return {
      parse: 0,
      jx: 0,
      url: maybeWrapStreamWithProxy(streamUrl, inReq, params),
      header: resolvedHeaders,
      headers: resolvedHeaders,
    };
  }

  return {
    parse: 1,
    jx: 0,
    url: finalUrl || normalizeUrl(cleanId),
    header: resolvedHeaders,
    headers: resolvedHeaders,
  };
}

async function search(inReq, _outResp) {
  await ensureLocalProxyServer();
  const params = unwrapRequestParams(inReq);
  const wd = String(params.wd || params.key || params.keyword || '').trim();
  const pg = Math.max(1, parseInt(params.page || params.pg || '1', 10) || 1);

  if (!wd) return { page: 1, pagecount: 1, list: [] };

  const encodedWd = encodeURIComponent(wd);
  const searchPaths =
    pg > 1
      ? [
          `/search/${encodedWd}/${pg}/`,
          `/index.php/search/${encodedWd}/${pg}/`,
          `/?s=${encodedWd}&page=${pg}`,
        ]
      : [
          `/search/${encodedWd}/`,
          `/index.php/search/${encodedWd}/`,
          `/?s=${encodedWd}`,
        ];

  let list = [];
  let html = '';
  for (const path of searchPaths) {
    const res = await fetchHtml(path);
    if (res.html) {
      const parsed = parseVideoCards(res.html, inReq);
      if (parsed.length > 0) {
        html = res.html;
        list = parsed;
        break;
      }
    }
  }

  const pagecount = Math.max(pg, parsePageCount(html, pg));
  return {
    page: pg,
    pagecount,
    limit: list.length || 20,
    total: pagecount * (list.length || 20),
    list,
  };
}

async function proxy(inReq, outResp) {
  const query = unwrapRequestParams(inReq);
  if (query.pic === '1' || (/\.(?:txt|enc|bin|jpg|jpeg|png|webp|gif)(?:$|\?)/i.test(String(query.url || '')) && query.type !== 'ts')) {
    const res = await proxyPicHandler(query);
    if (outResp && typeof outResp.type === 'function') {
      return outResp.type(res.mime).send(res.data);
    }
    return { code: 200, headers: { 'Content-Type': res.mime }, content: res.data };
  }
  const res = await proxyStreamHandler(query, inReq);
  if (outResp && typeof outResp.code === 'function') {
    return outResp.code(res.status).type(res.mime).send(res.data);
  }
  return { code: res.status, headers: { 'Content-Type': res.mime }, content: res.data };
}

export default {
  meta: { key: SPIDER_KEY, name: SPIDER_NAME, type: 3 },
  api: async (fastify) => {
    fastify.post('/init', init);
    fastify.post('/home', home);
    fastify.post('/homeVod', homeVod);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/proxy', proxy);
    fastify.get(`/${SPIDER_KEY}_pic`, async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
  },
  spider: {
    init,
    home,
    homeVod,
    category,
    detail,
    play,
    search,
    proxy,
    proxyPicHandler,
    closeLocalProxyServer,
  },
};