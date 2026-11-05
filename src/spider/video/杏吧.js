/**
 * 杏吧视频 - 猫爪 (catBridge / CatVod) Node.js ES Module 源
 * 由 Python Spider (飞鱼版) 完整迁移并强化播放解析与全链路域名容灾
 */
import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

const META = {
  key: 'xbsp',
  name: '杏吧视频',
  type: 3,
};

const DEFAULT_DOMAIN = 'https://jlj.xbsp6.boats';
const PUBLISH_PAGE_URL = 'https://ruv.xxkk7.com/323/';

const SITE_DOMAINS = [
  DEFAULT_DOMAIN,
];

let activeDomain = SITE_DOMAINS[0];
let domainInitialized = false;

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CLASSES = [
  { type_id: '20', type_name: '熟母少妇' },
  { type_id: '21', type_name: '网红直播' },
  { type_id: '22', type_name: '自拍偷拍' },
  { type_id: '23', type_name: '强奸乱伦' },
  { type_id: '24', type_name: '高清国产' },
  { type_id: '25', type_name: '韩国专区' },
  { type_id: '26', type_name: '日本有码' },
  { type_id: '27', type_name: '日本无码' },
  { type_id: '28', type_name: '欧美情色' },
  { type_id: '29', type_name: '动漫卡通' },
  { type_id: '30', type_name: '三级伦理' },
];

const CARD_STYLE = {
  type: 'rect',
  ratio: 1.78,
};

// 播放解析结果缓存 (TTL: 10 分钟)
const PLAY_CACHE = new Map();
const PLAY_CACHE_TTL = 10 * 60 * 1000;

function getPlayCache(key) {
  if (!key) return null;
  const entry = PLAY_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > PLAY_CACHE_TTL) {
    PLAY_CACHE.delete(key);
    return null;
  }
  return entry.val;
}

function setPlayCache(key, val) {
  if (!key || !val) return;
  PLAY_CACHE.set(key, { val, ts: Date.now() });
}

function buildHeaders(referer, extra = {}) {
  const ref = referer || `${activeDomain}/`;
  return {
    'User-Agent': DEFAULT_UA,
    Referer: ref,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...extra,
  };
}

function registerDomain(domainUrl) {
  if (!domainUrl) return;
  const cleaned = String(domainUrl).trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/i.test(cleaned)) return;
  if (!SITE_DOMAINS.includes(cleaned)) {
    SITE_DOMAINS.unshift(cleaned);
  }
  activeDomain = cleaned;
}

function isKnownSiteHost(hostname) {
  if (!hostname) return false;
  const lower = hostname.toLowerCase();
  if (/xbsp/i.test(lower)) return true;
  for (const d of SITE_DOMAINS) {
    try {
      if (new URL(d).hostname.toLowerCase() === lower) return true;
    } catch (_) {}
  }
  return false;
}

function normalizeUrl(urlStr, baseDomain = activeDomain) {
  if (!urlStr) return '';
  const trimmed = String(urlStr).trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  const base = (baseDomain || activeDomain || DEFAULT_DOMAIN).replace(/\/+$/, '');
  return `${base}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
}

function expandCandidateUrls(urlOrPath) {
  if (!urlOrPath) return [];
  const raw = String(urlOrPath).trim();
  if (!raw) return [];

  const orderedDomains = [
    activeDomain,
    ...SITE_DOMAINS.filter((d) => d !== activeDomain),
  ];

  if (!/^https?:\/\//i.test(raw)) {
    const relPath = raw.startsWith('/') ? raw : `/${raw}`;
    return orderedDomains.map((d) => `${d.replace(/\/+$/, '')}${relPath}`);
  }

  try {
    const parsed = new URL(raw);
    if (isKnownSiteHost(parsed.hostname)) {
      const pathAndQuery = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      const list = orderedDomains.map((d) => `${d.replace(/\/+$/, '')}${pathAndQuery}`);
      if (!list.includes(raw)) list.push(raw);
      return list;
    }
  } catch (_) {}

  return [raw];
}

function decodeBodyBuffer(buf) {
  if (!buf) return '';
  if (typeof buf === 'string') return buf;
  let bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      bytes = zlib.gunzipSync(bytes);
    } catch (_) {}
  }
  const utf8 = bytes.toString('utf8');
  if (utf8.includes('\ufffd')) {
    try {
      const gbkDecoder = new TextDecoder('gbk');
      return gbkDecoder.decode(bytes);
    } catch (_) {}
  }
  return utf8;
}

async function rawRequest(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  let originReferer = options.referer || `${activeDomain}/`;
  try {
    const u = new URL(url);
    originReferer = `${u.origin}/`;
  } catch (_) {}

  const headers = buildHeaders(originReferer, options.headers || {});
  const reqConfig = {
    method,
    headers,
    timeout: options.timeout || 10000,
  };
  if (options.buffer) {
    reqConfig.responseType = 'arraybuffer';
    reqConfig.buffer = 2;
  }

  let resp;
  if (typeof req === 'function') {
    resp = await req(url, reqConfig);
  } else if (req && typeof req.get === 'function' && method === 'GET') {
    resp = await req.get(url, reqConfig);
  } else if (req && typeof req.request === 'function') {
    resp = await req.request({ url, ...reqConfig });
  } else {
    throw new Error('util/req.js is not callable');
  }

  const status = resp?.status ?? resp?.statusCode ?? 200;
  const rawData = resp?.data ?? resp?.body ?? resp?.content ?? '';
  let text = '';
  if (Buffer.isBuffer(rawData) || rawData instanceof Uint8Array || rawData instanceof ArrayBuffer) {
    text = decodeBodyBuffer(Buffer.from(rawData));
  } else if (typeof rawData === 'object' && rawData !== null) {
    text = JSON.stringify(rawData);
  } else {
    text = String(rawData || '');
  }

  return {
    status,
    headers: resp?.headers || {},
    data: rawData,
    text,
    url,
  };
}

function isValidSiteHtml(html) {
  if (!html || typeof html !== 'string') return false;
  if (html.length < 30) return false;
  return (
    html.includes('id="posts"') ||
    html.includes("id='posts'") ||
    /<article\b/i.test(html) ||
    /rawUrl\b/i.test(html) ||
    /player_aaaa|player_data|player_config|MacPlayerConfig/i.test(html) ||
    /eval\(function\(p,a,c,k,e,/i.test(html) ||
    /m3u8|\.mp4/i.test(html) ||
    /<video\b/i.test(html) ||
    /<iframe\b/i.test(html) ||
    /杏吧/.test(html) ||
    /vodtype|vodplay|voddetail/i.test(html)
  );
}

/**
 * 从发布页 https://ruv.xxkk7.com/323/ 解析最新域名
 * 原 Python 逻辑:
 *   sub_domain = '...'
 *   prefix = '...'
 *   suffix = '...'
 *   site_url = f"https://{sub_domain}.{prefix}.{suffix}"
 */
export function parseLatestDomainFromPublishHtml(html) {
  if (!html || typeof html !== 'string') return '';
  const subDomainMatch = html.match(/sub_domain\s*=\s*['"]([^'"]+)['"]/i);
  const prefixMatch = html.match(/prefix\s*=\s*['"]([^'"]+)['"]/i);
  const suffixMatch = html.match(/suffix\s*=\s*['"]([^'"]+)['"]/i);

  if (subDomainMatch && prefixMatch && suffixMatch) {
    const sub = subDomainMatch[1].trim();
    const pre = prefixMatch[1].trim();
    const suf = suffixMatch[1].trim();
    if (sub && pre && suf) {
      return `https://${sub}.${pre}.${suf}`.replace(/\/+$/, '');
    }
  }

  // 备用提取: 页面中如果存在直接指向最新地址的变量或链接
  const directVarMatch = html.match(/(?:site_url|latest_url|main_url|jump_url)\s*=\s*['"](https?:\/\/[^'"]+)['"]/i);
  if (directVarMatch) {
    try {
      const u = new URL(directVarMatch[1].trim());
      return u.origin;
    } catch (_) {}
  }

  return '';
}

async function refreshLatestDomainFromPublishPage() {
  try {
    const res = await rawRequest(PUBLISH_PAGE_URL, {
      timeout: 8000,
      referer: PUBLISH_PAGE_URL,
    });
    if (res.status >= 200 && res.status < 400 && res.text) {
      const discovered = parseLatestDomainFromPublishHtml(res.text);
      if (discovered) {
        registerDomain(discovered);
        return discovered;
      }
    }
  } catch (_) {}
  return '';
}

async function checkSiteAvailable(domainUrl) {
  const target = `${String(domainUrl || activeDomain).replace(/\/+$/, '')}/xbsp/`;
  try {
    const res = await rawRequest(target, { timeout: 4000 });
    if (res.status === 200 && (isValidSiteHtml(res.text) || res.text === '')) {
      return true;
    }
  } catch (_) {}
  return false;
}

async function ensureDomainInitialized() {
  if (domainInitialized) return activeDomain;
  domainInitialized = true;
  const ok = await checkSiteAvailable(activeDomain);
  if (!ok) {
    await refreshLatestDomainFromPublishPage();
  }
  return activeDomain;
}

async function fetchHtmlWithFallback(urlOrPath, options = {}) {
  await ensureDomainInitialized();

  const tryFetchCandidates = async (candidates) => {
    let lastErr = null;
    for (const candidateUrl of candidates) {
      try {
        const res = await rawRequest(candidateUrl, options);
        if (res.status >= 200 && res.status < 400 && res.text) {
          if (isValidSiteHtml(res.text) || options.allowAnyHtml) {
            try {
              const u = new URL(candidateUrl);
              if (isKnownSiteHost(u.hostname)) {
                registerDomain(u.origin);
              }
            } catch (_) {}
            return { html: res.text, finalUrl: candidateUrl, status: res.status };
          }
        }
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) throw lastErr;
    return { html: '', finalUrl: candidates[0] || '', status: 0 };
  };

  let candidates = expandCandidateUrls(urlOrPath);
  let result = await tryFetchCandidates(candidates).catch(() => ({ html: '', finalUrl: '', status: 0 }));

  if (!result.html) {
    const prevDomain = activeDomain;
    const discovered = await refreshLatestDomainFromPublishPage();
    if (discovered && discovered !== prevDomain) {
      candidates = expandCandidateUrls(urlOrPath);
      result = await tryFetchCandidates(candidates).catch(() => ({ html: '', finalUrl: '', status: 0 }));
    }
  }

  return result;
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripTags(html) {
  if (!html) return '';
  return decodeHtmlEntities(String(html).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

/**
 * 解析列表页 HTML 中的视频卡片
 * 对应原 Python Spider._get_items_from_html:
 *   doc("#posts article")
 *   title = item("h2").text().strip()
 *   href = item("a").attr("href")
 *   img = item("img").attr("data-src") or item("img").attr("src")
 *   remark = item(".meta-content").text().strip()
 */
export function parseItemsFromHtml(htmlStr, baseUrl = activeDomain) {
  const videos = [];
  if (!htmlStr || typeof htmlStr !== 'string') return videos;

  const seen = new Set();
  const base = (baseUrl || activeDomain || DEFAULT_DOMAIN).replace(/\/+$/, '');

  const articleRegex = /<article\b[^>]*>([\s\S]*?)<\/article>/gi;
  let match;
  while ((match = articleRegex.exec(htmlStr)) !== null) {
    const block = match[1];

    // 标题: 优先 h2 文本
    let title = '';
    const h2Match = block.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
    if (h2Match) {
      title = stripTags(h2Match[1]);
    }
    if (!title) {
      const titleAttrMatch =
        block.match(/<a\b[^>]*\btitle\s*=\s*["']([^"']+)["']/i) ||
        block.match(/<img\b[^>]*\balt\s*=\s*["']([^"']+)["']/i);
      if (titleAttrMatch) title = decodeHtmlEntities(titleAttrMatch[1].trim());
    }

    // 链接: 第一个有效 href
    let href = '';
    const aRegex = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let aMatch;
    while ((aMatch = aRegex.exec(block)) !== null) {
      const candidate = decodeHtmlEntities(aMatch[1].trim());
      if (candidate && !candidate.startsWith('javascript:') && candidate !== '#') {
        href = candidate;
        break;
      }
    }

    // 图片: 优先 data-src, data-original, 其次 src
    let img = '';
    const imgMatch = block.match(/<img\b[^>]*>/i);
    if (imgMatch) {
      const imgTag = imgMatch[0];
      const dataSrc =
        imgTag.match(/\bdata-src\s*=\s*["']([^"']+)["']/i) ||
        imgTag.match(/\bdata-original\s*=\s*["']([^"']+)["']/i) ||
        imgTag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
      if (dataSrc) {
        img = decodeHtmlEntities(dataSrc[1].trim());
      }
    }

    // 备注: .meta-content
    let remark = '';
    const metaMatch = block.match(/<([a-z0-9]+)\b[^>]*\bclass\s*=\s*["'][^"']*\bmeta-content\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i);
    if (metaMatch) {
      remark = stripTags(metaMatch[2]);
    }

    if (!title && !href) continue;

    const fullHref = normalizeUrl(href, base);
    const fullImg = img ? normalizeUrl(img, base) : '';

    if (seen.has(fullHref)) continue;
    seen.add(fullHref);

    videos.push({
      vod_id: fullHref,
      vod_name: title || '在线视频',
      vod_pic: fullImg,
      vod_remarks: remark,
      style: CARD_STYLE,
    });
  }

  return videos;
}

/**
 * 统一请求参数提取，兼容 body / query 为对象、JSON 字符串或 URL 查询串
 */
function unwrapParams(inReq) {
  const merged = {};
  const sources = [inReq?.query, inReq?.body];
  for (const src of sources) {
    if (!src) continue;
    if (typeof src === 'string') {
      const trimmed = src.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
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
      Object.assign(merged, src);
    }
  }
  return merged;
}

/**
 * 清洗剧集/播放 ID（剥离 `正片$` 前缀及 `@@@` 附加后缀）
 */
export function sanitizeEpisodeId(rawId) {
  if (!rawId) return '';
  let id = String(rawId).trim();
  if (id.includes('@@@')) {
    id = id.split('@@@')[0].trim();
  }
  if (id.includes('$')) {
    const idx = id.indexOf('$');
    const prefix = id.slice(0, idx).trim();
    const rest = id.slice(idx + 1).trim();
    if (rest && !/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
      id = rest;
    }
  }
  return id;
}

function unescapeJsString(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\\//g, '/')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/gi, '&');
}

function customUnescape(str) {
  if (!str) return '';
  const step1 = String(str).replace(/%u([0-9a-fA-F]{4})/gi, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  try {
    return decodeURIComponent(step1);
  } catch (_) {
    return step1.replace(/%([0-9a-fA-F]{2})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
  }
}

function decodeCmsPlayerUrl(rawUrl, encryptType = 0) {
  if (!rawUrl) return '';
  let url = String(rawUrl).trim();
  const enc = Number(encryptType) || 0;
  if (enc === 1) {
    url = customUnescape(url);
  } else if (enc === 2) {
    try {
      const b64Decoded = Buffer.from(url, 'base64').toString('utf8');
      url = customUnescape(b64Decoded);
    } catch (_) {}
  }
  return unescapeJsString(url).trim();
}

/**
 * 平衡花括号提取，防止 player_aaaa 中包含嵌套对象 (如 vod_data: {...}) 导致正则截断
 */
export function extractBalancedJsonObject(text, varPattern) {
  if (!text) return null;
  const regex = new RegExp(varPattern, 'i');
  const match = regex.exec(text);
  if (!match) return null;

  const startSearchIdx = match.index + match[0].length;
  const braceStart = text.indexOf('{', startSearchIdx);
  if (braceStart === -1) return null;

  let depth = 0;
  let inString = false;
  let quoteChar = '';
  let escaped = false;

  for (let i = braceStart; i < text.length; i++) {
    const ch = text[i];
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
        quoteChar = '';
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
        const jsonCandidate = text.slice(braceStart, i + 1);
        try {
          return JSON.parse(jsonCandidate);
        } catch (_) {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * 解包 Dean Edwards Packer: eval(function(p,a,c,k,e,d)...)
 */
export function unpackDeanEdwards(html) {
  if (!html || !html.includes('eval(function(p,a,c,k,e,')) return [];
  const results = [];
  const packerRegex =
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;

  const encodeBase = (num, radix) => {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (num < radix) return num < 36 ? num.toString(36) : chars[num];
    return encodeBase(Math.floor(num / radix), radix) + (num % radix < 36 ? (num % radix).toString(36) : chars[num % radix]);
  };

  let match;
  while ((match = packerRegex.exec(html)) !== null) {
    const payload = match[2];
    const radix = parseInt(match[3], 10);
    const count = parseInt(match[4], 10);
    const symtab = match[6].split('|');
    if (!radix || !count) continue;

    const dict = new Map();
    for (let i = count - 1; i >= 0; i--) {
      const key = encodeBase(i, radix);
      const val = symtab[i];
      if (val) dict.set(key, val);
    }

    const unpacked = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (token) =>
      dict.has(token) ? dict.get(token) : token
    );
    results.push(unpacked);
  }
  return results;
}

function isDecoyMediaUrl(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  return (
    lower.includes('preview.mp4') ||
    lower.includes('sample.mp4') ||
    lower.includes('trailer.mp4') ||
    lower.includes('top_banner') ||
    lower.includes('native-ad') ||
    lower.includes('stat.php')
  );
}

export function isDirectMediaUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  if (isDecoyMediaUrl(urlStr)) return false;
  try {
    const u = new URL(urlStr, activeDomain);
    if (/\.(m3u8|mp4|flv|mpd)$/i.test(u.pathname)) {
      return true;
    }
    // 部分直链通过路径段标识 m3u8 且无嵌套 html/php 播放器路径
    if (!/\.(html?|php|jsp|asp)$/i.test(u.pathname) && /\.m3u8(\?|$)/i.test(urlStr)) {
      return true;
    }
  } catch (_) {}
  return false;
}

/**
 * 若 URL 是包装播放器 (如 /dplayer.html?url=https%3A%2F%2F...m3u8)，剥离出内部真实流地址
 */
export function unwrapWrapperStreamUrl(candidateUrl, baseUrl = activeDomain) {
  if (!candidateUrl) return '';
  let cleaned = unescapeJsString(candidateUrl).trim();
  if (!cleaned || isDecoyMediaUrl(cleaned)) return '';

  try {
    const resolved = new URL(cleaned, baseUrl);
    if (isDecoyMediaUrl(resolved.href)) return '';
    if (/\.(m3u8|mp4|flv|mpd)$/i.test(resolved.pathname)) {
      return resolved.href;
    }
    const paramKeys = ['url', 'v', 'vid', 'src', 'file', 'm3u8', 'playurl'];
    for (const key of paramKeys) {
      const val = resolved.searchParams.get(key);
      if (val) {
        let inner = val.trim();
        for (let pass = 0; pass < 2; pass++) {
          if (/^https?:%[0-9a-fA-F]{2}/i.test(inner) || inner.includes('%2F') || inner.includes('%3A')) {
            inner = customUnescape(inner);
          }
        }
        inner = unescapeJsString(inner);
        if (isDirectMediaUrl(inner)) {
          return normalizeUrl(inner, resolved.origin);
        }
      }
    }
  } catch (_) {}

  return '';
}

/**
 * 从 HTML 文本中提取真实视频流地址
 * 阶段 1: 原 Python 优先规则 `const rawUrl = "...m3u8..."` 及变体变量
 * 阶段 2: CMS 标准播放器配置对象 `player_aaaa` / `player_data` / `player_config` (平衡花括号 + encrypt 0/1/2)
 * 阶段 3: Dean Edwards Packer 混淆脚本解包后再提取
 * 阶段 4: 反转义 `\/` 与 `\u002F` 后全局匹配直链 `.m3u8` / `.mp4`
 */
export function extractStreamFromHtml(html, baseUrl = activeDomain) {
  if (!html || typeof html !== 'string') return '';

  const scanText = (text) => {
    // 1. 优先匹配 rawUrl 变量 (原 Python 核心规则: const rawUrl = '...m3u8...')
    const rawUrlRegexes = [
      /(?:const|let|var)\s+rawUrl\s*=\s*['"]([^'"]+)['"]/i,
      /\brawUrl\s*[:=]\s*['"]([^'"]+)['"]/i,
      /(?:const|let|var)\s+(?:playUrl|videoUrl|m3u8Url|vUrl|hlsUrl)\s*=\s*['"]([^'"]+)['"]/i,
    ];
    for (const rx of rawUrlRegexes) {
      const m = text.match(rx);
      if (m && m[1]) {
        const candidate = unescapeJsString(customUnescape(m[1].trim()));
        const unwrapped = unwrapWrapperStreamUrl(candidate, baseUrl);
        if (unwrapped && !isDecoyMediaUrl(unwrapped)) return unwrapped;
        const full = normalizeUrl(candidate, baseUrl);
        if (isDirectMediaUrl(full)) return full;
      }
    }

    // 2. 平衡花括号提取 CMS player_aaaa / player_data / player_config
    const playerVarNames = [
      'player_aaaa\\s*=',
      'player_data\\s*=',
      'player_config\\s*=',
      'MacPlayerConfig\\s*=',
    ];
    for (const pat of playerVarNames) {
      const cfg = extractBalancedJsonObject(text, pat);
      if (cfg && cfg.url) {
        const decoded = decodeCmsPlayerUrl(cfg.url, cfg.encrypt);
        const unwrapped = unwrapWrapperStreamUrl(decoded, baseUrl);
        if (unwrapped && !isDecoyMediaUrl(unwrapped)) return unwrapped;
        const full = normalizeUrl(decoded, baseUrl);
        if (isDirectMediaUrl(full)) return full;
      }
    }

    // 3. 扫描 <video> / <source> 标签中的 src
    const videoSrcRegex = /<(?:video|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
    let vm;
    while ((vm = videoSrcRegex.exec(text)) !== null) {
      const candidate = unescapeJsString(vm[1].trim());
      const unwrapped = unwrapWrapperStreamUrl(candidate, baseUrl);
      if (unwrapped && !isDecoyMediaUrl(unwrapped)) return unwrapped;
      const full = normalizeUrl(candidate, baseUrl);
      if (isDirectMediaUrl(full)) return full;
    }

    // 4. 反转义 JSON 斜杠后全局匹配 .m3u8 或 .mp4
    const normalizedText = unescapeJsString(text);
    const m3u8Regex = /https?:\/\/[^\s$#'"<>\\]+\.m3u8(?:\?[^\s#'"<>\\]*)?/gi;
    let mm;
    while ((mm = m3u8Regex.exec(normalizedText)) !== null) {
      const candidate = mm[0];
      const unwrapped = unwrapWrapperStreamUrl(candidate, baseUrl);
      if (unwrapped) return unwrapped;
      if (isDirectMediaUrl(candidate)) return candidate;
    }

    const mp4Regex = /https?:\/\/[^\s$#'"<>\\]+\.mp4(?:\?[^\s#'"<>\\]*)?/gi;
    while ((mm = mp4Regex.exec(normalizedText)) !== null) {
      const candidate = mm[0];
      if (isDirectMediaUrl(candidate)) return candidate;
    }

    return '';
  };

  // 先扫描原始 HTML
  const directHit = scanText(html);
  if (directHit) return directHit;

  // 解包 Packer 混淆代码块后再扫描
  const unpackedBlocks = unpackDeanEdwards(html);
  for (const block of unpackedBlocks) {
    const hit = scanText(block);
    if (hit) return hit;
  }

  return '';
}

/**
 * 完整多阶段异步流解析器（支持 iframe 追踪及详情页跳播放页二跳）
 */
async function resolvePlayStreamFromPage(targetUrl, htmlContent = '', depth = 0) {
  const cleanTarget = sanitizeEpisodeId(targetUrl);
  if (!cleanTarget) return '';

  if (isDirectMediaUrl(cleanTarget)) {
    return normalizeUrl(cleanTarget, activeDomain);
  }
  const directUnwrapped = unwrapWrapperStreamUrl(cleanTarget, activeDomain);
  if (directUnwrapped) return directUnwrapped;

  const cached = getPlayCache(cleanTarget);
  if (cached) return cached;

  let html = htmlContent;
  let finalPageUrl = normalizeUrl(cleanTarget, activeDomain);

  if (!html) {
    const fetched = await fetchHtmlWithFallback(cleanTarget);
    html = fetched.html;
    if (fetched.finalUrl) finalPageUrl = fetched.finalUrl;
  }

  if (!html) return '';

  let baseOrigin = activeDomain;
  try {
    baseOrigin = new URL(finalPageUrl).origin;
  } catch (_) {}

  // Stage 1-3: 直接从当前页面提取
  let streamUrl = extractStreamFromHtml(html, baseOrigin);
  if (streamUrl) {
    setPlayCache(cleanTarget, streamUrl);
    setPlayCache(finalPageUrl, streamUrl);
    return streamUrl;
  }

  if (depth >= 2) return '';

  // Stage 4: 检查 iframe 嵌入播放器
  const iframeRegex = /<iframe\b[^>]*\b(?:src|data-src)\s*=\s*["']([^"']+)["']/gi;
  let im;
  while ((im = iframeRegex.exec(html)) !== null) {
    const iframeSrc = decodeHtmlEntities(im[1].trim());
    if (!iframeSrc || iframeSrc.startsWith('javascript:') || iframeSrc === 'about:blank') continue;
    const unwrappedIframe = unwrapWrapperStreamUrl(iframeSrc, baseOrigin);
    if (unwrappedIframe) {
      setPlayCache(cleanTarget, unwrappedIframe);
      return unwrappedIframe;
    }
    const fullIframeUrl = normalizeUrl(iframeSrc, baseOrigin);
    try {
      const iframeRes = await rawRequest(fullIframeUrl, { referer: finalPageUrl, timeout: 8000 });
      if (iframeRes.text) {
        const nestedStream = extractStreamFromHtml(iframeRes.text, new URL(fullIframeUrl).origin);
        if (nestedStream) {
          setPlayCache(cleanTarget, nestedStream);
          return nestedStream;
        }
      }
    } catch (_) {}
  }

  // Stage 5: 如果当前是详情页，查找页面内的播放页链接 (/vodplay/... 或 /play/...)
  const playLinkMatch = html.match(/<a\b[^>]*\bhref\s*=\s*["']([^"']*(?:\/vodplay\/|\/play\/)[^"']+)["']/i);
  if (playLinkMatch && playLinkMatch[1]) {
    const nextPlayUrl = normalizeUrl(decodeHtmlEntities(playLinkMatch[1].trim()), baseOrigin);
    if (nextPlayUrl !== finalPageUrl) {
      const nested = await resolvePlayStreamFromPage(nextPlayUrl, '', depth + 1);
      if (nested) {
        setPlayCache(cleanTarget, nested);
        return nested;
      }
    }
  }

  return '';
}

async function init(inReq, _outResp) {
  await ensureDomainInitialized();
  return {};
}

async function home(inReq, _outResp) {
  let list = [];
  try {
    const { html, finalUrl } = await fetchHtmlWithFallback('/xbsp/');
    let baseOrigin = activeDomain;
    try {
      if (finalUrl) baseOrigin = new URL(finalUrl).origin;
    } catch (_) {}
    list = parseItemsFromHtml(html, baseOrigin);
  } catch (_) {}

  return {
    class: CLASSES,
    filters: {},
    list,
    style: CARD_STYLE,
  };
}

async function category(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const tid = String(params.id ?? params.tid ?? CLASSES[0].type_id).trim();
  const pg = Math.max(1, parseInt(params.page ?? params.pg ?? '1', 10) || 1);

  let videos = [];
  try {
    const path = `/vodtype/${tid}-${pg}.html`;
    const { html, finalUrl } = await fetchHtmlWithFallback(path);
    let baseOrigin = activeDomain;
    try {
      if (finalUrl) baseOrigin = new URL(finalUrl).origin;
    } catch (_) {}
    videos = parseItemsFromHtml(html, baseOrigin);
  } catch (_) {}

  return {
    page: pg,
    pagecount: 9999,
    limit: 20,
    total: 9999,
    list: videos,
    style: CARD_STYLE,
  };
}

async function detail(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const rawIds = params.id ?? params.ids ?? params.url ?? '';
  const firstId = Array.isArray(rawIds) ? rawIds[0] : rawIds;
  const targetUrl = sanitizeEpisodeId(firstId);

  let vodName = '在线播放';
  let vodPic = '';
  let vodContent = '';
  let playUrlEntry = `正片$${targetUrl}`;

  if (targetUrl) {
    try {
      const { html, finalUrl } = await fetchHtmlWithFallback(targetUrl);
      const effectiveUrl = finalUrl || normalizeUrl(targetUrl, activeDomain);
      if (html) {
        const titleMatch =
          html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) ||
          html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i) ||
          html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
        if (titleMatch) {
          const parsedTitle = stripTags(titleMatch[1]).replace(/\s*[-_|]\s*杏吧.*$/i, '').trim();
          if (parsedTitle) vodName = parsedTitle;
        }
        const ogImgMatch =
          html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
          html.match(/\bposter\s*=\s*["']([^"']+)["']/i);
        if (ogImgMatch) {
          vodPic = normalizeUrl(decodeHtmlEntities(ogImgMatch[1].trim()), effectiveUrl);
        }

        // 预热播放缓存，加速随后触发的 /play 请求
        const resolvedStream = await resolvePlayStreamFromPage(effectiveUrl, html, 0);
        if (resolvedStream) {
          setPlayCache(targetUrl, resolvedStream);
          setPlayCache(effectiveUrl, resolvedStream);
        }
      }
    } catch (_) {}
  }

  const vod = {
    vod_id: targetUrl,
    vod_name: vodName,
    vod_pic: vodPic,
    type_name: '福利',
    vod_remarks: '',
    vod_content: vodContent,
    vod_play_from: '杏吧播放',
    vod_play_url: playUrlEntry,
  };

  return { list: [vod] };
}

async function search(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const wd = String(params.wd ?? params.key ?? params.keyword ?? '').trim();
  const pg = Math.max(1, parseInt(params.page ?? params.pg ?? '1', 10) || 1);
  if (!wd) return { list: [] };

  let videos = [];
  try {
    const encodedKey = encodeURIComponent(wd);
    const path = `/s/${encodedKey}/page/${pg}.html`;
    const { html, finalUrl } = await fetchHtmlWithFallback(path);
    let baseOrigin = activeDomain;
    try {
      if (finalUrl) baseOrigin = new URL(finalUrl).origin;
    } catch (_) {}
    videos = parseItemsFromHtml(html, baseOrigin);
  } catch (_) {}

  return {
    page: pg,
    pagecount: videos.length > 0 ? 9999 : 1,
    limit: 20,
    list: videos,
    style: CARD_STYLE,
  };
}

async function play(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const rawId = params.id ?? params.url ?? '';
  const cleanId = sanitizeEpisodeId(rawId);

  let playUrl = cleanId;
  let resolvedStream = '';

  try {
    resolvedStream = await resolvePlayStreamFromPage(cleanId);
  } catch (_) {}

  if (resolvedStream) {
    playUrl = resolvedStream;
  } else {
    const candidates = expandCandidateUrls(cleanId);
    if (candidates.length > 0) playUrl = candidates[0];
  }

  const playHeaders = {
    'User-Agent': DEFAULT_UA,
    Referer: `${activeDomain}/`,
  };

  const isDirect = isDirectMediaUrl(playUrl);

  return {
    parse: isDirect ? 0 : 1,
    jx: 0,
    url: playUrl,
    header: playHeaders,
    headers: playHeaders,
  };
}

async function proxyPicHandler(query = {}) {
  const picUrl = query.url || query.pic || '';
  if (!picUrl) {
    return { mime: 'image/jpeg', data: Buffer.alloc(0) };
  }
  try {
    const res = await rawRequest(picUrl, { buffer: true, timeout: 8000 });
    const contentType = res.headers?.['content-type'] || 'image/jpeg';
    const data = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data || '');
    return { mime: contentType, data };
  } catch (_) {
    return { mime: 'image/jpeg', data: Buffer.alloc(0) };
  }
}

export default {
  meta: META,
  api: async (fastify) => {
    fastify.post('/init', init);
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/xbsp_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
  },
};