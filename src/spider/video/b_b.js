import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

const SITE_NAME = 'B里B里';
const SPIDER_KEY = 'blibli';
const SITE_DOMAINS = [
  'https://bli.nbpss.cfd',
];
let activeDomain = SITE_DOMAINS[0];

const TG_GROUP = 'https://t.me/tvshare23';
const BRAND_ACTOR = '🦋 TG群: @tvshare23';
const BRAND_DIRECTOR = '🦋 蝴蝶影视';
const BRAND_SHORT = '蝴蝶影视';
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const CARD_STYLE = { type: 'rect', ratio: 1.78 };

const PLAY_CACHE = new Map();
const PLAY_CACHE_TTL = 10 * 60 * 1000;

const CLASSES = [
  { type_id: '1', type_name: '国产视频' },
  { type_id: '2', type_name: '传媒精品' },
  { type_id: '3', type_name: '特殊嗜好' },
  { type_id: '4', type_name: '三级伦理' },
  { type_id: '41', type_name: '女优精选' },
];

const FILTERS = {
  '1': [
    {
      key: 'sub',
      name: '分类',
      init: '1',
      value: [
        { n: '全部', v: '1' },
        { n: '国产自拍', v: '6' },
        { n: '国产偷拍', v: '7' },
        { n: '国产探花', v: '8' },
        { n: '国产主播', v: '9' },
        { n: '国产户外', v: '10' },
        { n: '黑料吃瓜', v: '11' },
        { n: '国产伦理', v: '12' },
        { n: '黑料视频', v: '20' },
      ],
    },
  ],
  '2': [
    {
      key: 'sub',
      name: '分类',
      init: '2',
      value: [
        { n: '全部', v: '2' },
        { n: '精东影业', v: '13' },
        { n: '蜜桃传媒', v: '14' },
        { n: '果冻传媒', v: '15' },
        { n: '天美传媒', v: '16' },
        { n: '星空传媒', v: '21' },
        { n: '大象传媒', v: '22' },
        { n: '香蕉传媒', v: '23' },
        { n: '爱神传媒', v: '24' },
      ],
    },
  ],
  '3': [
    {
      key: 'sub',
      name: '分类',
      init: '3',
      value: [
        { n: '全部', v: '3' },
        { n: '绿帽换妻', v: '25' },
        { n: 'SM调教', v: '26' },
        { n: '男同系列', v: '27' },
        { n: '女同系列', v: '28' },
        { n: '乱伦系列', v: '29' },
        { n: '特殊嗜好', v: '30' },
        { n: '网黄自制', v: '31' },
        { n: '欧美AV', v: '32' },
      ],
    },
  ],
  '4': [
    {
      key: 'sub',
      name: '分类',
      init: '4',
      value: [
        { n: '全部', v: '4' },
        { n: '国产伦理', v: '33' },
        { n: '香港伦理', v: '34' },
        { n: '台湾伦理', v: '35' },
        { n: '韩国伦理', v: '36' },
        { n: '日本伦理', v: '37' },
        { n: '西方伦理', v: '38' },
        { n: '成人动漫', v: '39' },
        { n: '糖心Vlog', v: '40' },
      ],
    },
  ],
  '41': [
    {
      key: 'sub',
      name: '分类',
      init: '41',
      value: [
        { n: '全部', v: '41' },
        { n: '日本无码', v: '42' },
        { n: '日本有码', v: '43' },
        { n: '中字无码', v: '44' },
        { n: '中字有码', v: '45' },
        { n: '红斯灯影像', v: '46' },
        { n: '冉冉学姐', v: '48' },
        { n: '小水水', v: '47' },
        { n: '柚子猫', v: '49' },
      ],
    },
  ],
};

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
    .replace(/&nbsp;/gi, ' ');
}

function cleanLabel(text) {
  if (!text) return '';
  let t = decodeHtmlEntities(String(text));
  t = t.replace(/<[^>]+>/g, '');
  t = t.replace(/[\r\n\t]+/g, ' ');
  t = t.replace(/[$#]/g, '');
  return t.trim();
}

function formatRemarks(brand = BRAND_SHORT, meta = '') {
  const cleanMeta = cleanLabel(meta);
  if (cleanMeta) {
    return `${brand} | ${cleanMeta}`;
  }
  return brand;
}

function setPlayCache(key, val) {
  if (!key || !val) return;
  PLAY_CACHE.set(String(key), { val, ts: Date.now() });
}

function getPlayCache(key) {
  if (!key) return null;
  const entry = PLAY_CACHE.get(String(key));
  if (!entry) return null;
  if (Date.now() - entry.ts > PLAY_CACHE_TTL) {
    PLAY_CACHE.delete(String(key));
    return null;
  }
  return entry.val;
}

function unwrapParams(inReq) {
  const merged = {};
  if (!inReq) return merged;

  const mergeObj = (src) => {
    if (!src) return;
    if (typeof src === 'string') {
      const trimmed = src.trim();
      if (!trimmed) return;
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          Object.assign(merged, JSON.parse(trimmed));
          return;
        } catch (_) {}
      }
      try {
        const sp = new URLSearchParams(trimmed);
        for (const [k, v] of sp.entries()) {
          merged[k] = v;
        }
      } catch (_) {}
      return;
    }
    if (typeof src === 'object') {
      Object.assign(merged, src);
    }
  };

  mergeObj(inReq.params);
  mergeObj(inReq.query);
  mergeObj(inReq.body);

  if (typeof merged.extend === 'string') {
    const extStr = merged.extend.trim();
    if (extStr.startsWith('{') && extStr.endsWith('}')) {
      try {
        merged.extend = JSON.parse(extStr);
      } catch (_) {}
    }
  }
  return merged;
}

function getDomainHostSet() {
  const set = new Set();
  for (const d of SITE_DOMAINS) {
    try {
      set.add(new URL(d).hostname.toLowerCase());
    } catch (_) {}
  }
  return set;
}

function getCandidateDomains() {
  const list = [activeDomain, ...SITE_DOMAINS];
  return [...new Set(list.filter(Boolean))];
}

function expandCandidateUrls(targetUrl) {
  if (!targetUrl) return [];
  const raw = decodeHtmlEntities(String(targetUrl).trim());
  if (!raw) return [];
  if (raw.startsWith('//')) {
    return [`https:${raw}`];
  }
  const domains = getCandidateDomains();
  if (raw.startsWith('/')) {
    return domains.map((d) => `${d.replace(/\/+$/, '')}${raw}`);
  }
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const knownHosts = getDomainHostSet();
      if (knownHosts.has(u.hostname.toLowerCase())) {
        const pathAndQuery = `${u.pathname}${u.search}${u.hash}`;
        const ordered = domains.map((d) => `${d.replace(/\/+$/, '')}${pathAndQuery}`);
        if (!ordered.includes(raw)) ordered.unshift(raw);
        return [...new Set(ordered)];
      }
    } catch (_) {}
    return [raw];
  }
  return domains.map((d) => `${d.replace(/\/+$/, '')}/${raw.replace(/^\/+/, '')}`);
}

function resolveUrl(url, base = activeDomain) {
  if (!url) return '';
  const raw = decodeHtmlEntities(String(url).trim());
  if (!raw || /^(?:about:blank|javascript:|data:|mailto:|tel:)/i.test(raw)) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  if (/^https?:\/\//i.test(raw)) return raw;
  const cleanBase = (base || activeDomain || SITE_DOMAINS[0]).replace(/\/+$/, '');
  if (raw.startsWith('/')) return `${cleanBase}${raw}`;
  return `${cleanBase}/${raw}`;
}

function decodeResponseBuffer(buf) {
  if (!buf) return '';
  if (typeof buf === 'string') return buf;
  let bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      bytes = zlib.gunzipSync(bytes);
    } catch (_) {}
  }
  const utf8Text = bytes.toString('utf8');
  if (utf8Text.includes('\ufffd')) {
    try {
      const gbkDec = new TextDecoder('gbk');
      return gbkDec.decode(bytes);
    } catch (_) {}
  }
  return utf8Text;
}

function isLikelyValidSiteHtml(html) {
  if (!html || typeof html !== 'string') return false;
  const low = html.toLowerCase();
  return (
    low.includes('/vod/detail/') ||
    low.includes('/vod/play/') ||
    low.includes('/vod/type/') ||
    low.includes('player_aaaa') ||
    low.includes('player_data') ||
    low.includes('.m3u8') ||
    low.includes('.mp4') ||
    low.includes('<video') ||
    low.includes('<iframe') ||
    low.includes('vod-list') ||
    low.includes('vodlist') ||
    low.includes('<title>')
  );
}

async function fetchHtml(targetUrl, options = {}) {
  const candidates = expandCandidateUrls(targetUrl);
  const timeout = options.timeout || 8000;
  let lastHtml = '';
  let lastFinalUrl = candidates[0] || targetUrl || '';

  for (const candUrl of candidates) {
    let origin = activeDomain;
    try {
      origin = new URL(candUrl).origin;
    } catch (_) {}

    let referer = options.referer || `${origin}/`;
    if (options.referer) {
      try {
        const refUrl = new URL(options.referer);
        if (getDomainHostSet().has(refUrl.hostname.toLowerCase())) {
          referer = `${origin}${refUrl.pathname}${refUrl.search}`;
        }
      } catch (_) {}
    }

    const headers = {
      'User-Agent': DEFAULT_UA,
      Referer: referer,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...(options.headers || {}),
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await req.get(candUrl, {
          headers,
          timeout,
        });
        const rawData = resp?.data ?? resp?.body ?? resp ?? '';
        const text = decodeResponseBuffer(rawData);
        const status = resp?.status ?? resp?.statusCode ?? (text ? 200 : 0);
        lastHtml = text;
        lastFinalUrl = resp?.url || resp?.headers?.location || candUrl;

        if (status >= 200 && status < 400 && text) {
          if (isLikelyValidSiteHtml(text) || candidates.length === 1) {
            if (getDomainHostSet().has(new URL(candUrl).hostname.toLowerCase())) {
              activeDomain = origin;
            }
            return { ok: true, status, text, finalUrl: lastFinalUrl, origin };
          }
        }
      } catch (_) {
        if (attempt === 0) continue;
      }
    }
  }

  return { ok: Boolean(lastHtml), status: lastHtml ? 200 : -1, text: lastHtml, finalUrl: lastFinalUrl, origin: activeDomain };
}

function isInvalidCard(vName, vPic) {
  const lowN = String(vName || '').toLowerCase();
  const lowP = String(vPic || '').toLowerCase();
  const badNames = ['广告', '导航', '备忘录', '下载app', '防走丢', '神秘入口', '加群', '交流群', '看b里b里'];
  if (badNames.some((b) => lowN.includes(b))) return true;
  const badPics = ['tg.png', 'banner', 'notice', 'ad.jpg', 'app.png', 'logo'];
  if (badPics.some((b) => lowP.includes(b))) return true;
  return false;
}

function extractImageAttr(blockText, baseOrigin = activeDomain) {
  if (!blockText) return '';
  const attrOrder = ['data-litespeed-src', 'data-lazy-src', 'data-original', 'data-src', 'src'];
  for (const attr of attrOrder) {
    const re = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'ig');
    let m;
    while ((m = re.exec(blockText)) !== null) {
      const cand = decodeHtmlEntities(m[1].trim());
      if (!cand || /^(?:about:blank|javascript:|data:)/i.test(cand)) continue;
      return resolveUrl(cand, baseOrigin);
    }
  }
  return '';
}

function extractCardTitle(blockText) {
  if (!blockText) return '';
  let m = blockText.match(/class=["'][^"']*(?:title|name|heading)[^"']*["'][^>]*>([\s\S]*?)</i);
  if (m) {
    const t = cleanLabel(m[1]);
    if (t && !/^\d+$/.test(t) && t.length > 1) return t;
  }
  m = blockText.match(/<h[23456][^>]*>([\s\S]*?)<\/h[23456]>/i);
  if (m) {
    const t = cleanLabel(m[1]);
    if (t && !/^\d+$/.test(t) && t.length > 1) return t;
  }
  m = blockText.match(/title=["']([^"']+)["']/i);
  if (m) {
    const t = cleanLabel(m[1]);
    if (t && !/^\d+$/.test(t) && t.length > 1) return t;
  }
  m = blockText.match(/alt=["']([^"']+)["']/i);
  if (m) {
    const t = cleanLabel(m[1]);
    if (t && !/^\d+$/.test(t) && t.length > 1) return t;
  }
  return '';
}

function parseCardsFromHtml(html, baseOrigin = activeDomain) {
  if (!html) return [];
  const cardMap = new Map();

  const blocks = html.split(/(?=<li[^>]+class=|<div[^>]+class=["'][^"']*(?:item|col-|vodlist_item|card|swiper-slide)[^"']*)/i);
  for (const b of blocks) {
    const idMatch = b.match(/(?:\/index\.php)?\/vod\/detail\/id\/(\d+)\.html/i);
    if (!idMatch) continue;
    const vId = idMatch[1].trim();

    const vName = extractCardTitle(b);
    const vPic = extractImageAttr(b, baseOrigin);
    const remMatch = b.match(/class=["'][^"']*(?:pic-text|remarks|note|duration|text-right|tag)[^"']*["'][^>]*>([^<]+)</i);
    const vRemarks = remMatch ? remMatch[1].trim() : '';

    if (cardMap.has(vId)) {
      const existing = cardMap.get(vId);
      if ((!existing.vod_name || existing.vod_name.startsWith('在线视频·')) && vName) {
        existing.vod_name = vName;
      }
      if (!existing.vod_pic && vPic) {
        existing.vod_pic = vPic;
      }
      if (vRemarks && existing.vod_remarks === BRAND_SHORT) {
        existing.vod_remarks = formatRemarks(BRAND_SHORT, vRemarks);
      }
    } else {
      cardMap.set(vId, {
        vod_id: vId,
        vod_name: vName || `在线视频·${vId}`,
        vod_pic: vPic,
        vod_remarks: formatRemarks(BRAND_SHORT, vRemarks),
        style: CARD_STYLE,
      });
    }
  }

  const anchorRe = /<a[^>]+href=["'](?:\S*?\/index\.php)?\/vod\/detail\/id\/(\d+)\.html["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    const vId = m[1].trim();
    const fullA = m[0];
    const inner = m[2];
    const vName = extractCardTitle(fullA) || extractCardTitle(inner) || cleanLabel(inner);
    const vPic = extractImageAttr(inner, baseOrigin) || extractImageAttr(fullA, baseOrigin);

    if (cardMap.has(vId)) {
      const existing = cardMap.get(vId);
      if ((!existing.vod_name || existing.vod_name.startsWith('在线视频·')) && vName) {
        existing.vod_name = vName;
      }
      if (!existing.vod_pic && vPic) {
        existing.vod_pic = vPic;
      }
    } else {
      cardMap.set(vId, {
        vod_id: vId,
        vod_name: vName || `在线视频·${vId}`,
        vod_pic: vPic,
        vod_remarks: formatRemarks(BRAND_SHORT, ''),
        style: CARD_STYLE,
      });
    }
  }

  const cards = [];
  for (const card of cardMap.values()) {
    if (isInvalidCard(card.vod_name, card.vod_pic)) continue;
    cards.push(card);
  }
  return cards;
}

function isBadMediaUrl(url) {
  if (!url) return true;
  const low = String(url).toLowerCase();
  const badTokens = [
    'preview.mp4',
    'sample.mp4',
    'trailer.mp4',
    'top_banner',
    'native-ad',
    'stat.php',
    'about:blank',
    'javascript:',
  ];
  return badTokens.some((token) => low.includes(token));
}

function isDirectMediaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const raw = url.trim();
  if (!/^https?:\/\//i.test(raw)) return false;
  if (isBadMediaUrl(raw)) return false;
  try {
    const parsed = new URL(raw);
    const pathname = parsed.pathname.toLowerCase();
    if (/\.(?:m3u8|mp4|flv|m4s|ts|mkv|webm)$/i.test(pathname)) {
      return true;
    }
    if (pathname.endsWith('index.png')) {
      return true;
    }
    // Check if it is an HLS endpoint without a wrapper HTML/PHP script
    if (!/\.(?:html?|php|jsp|asp|aspx)$/i.test(pathname) && /(?:m3u8|mp4)/i.test(pathname)) {
      return true;
    }
  } catch (_) {}
  return false;
}

function decodePercentAndUnicode(str) {
  if (!str) return '';
  let out = String(str)
    .replace(/\\\/|\//g, '/')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/%u([0-9a-fA-F]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  out = decodeHtmlEntities(out);
  return out;
}

function customUnescape(str) {
  if (!str) return '';
  let s = String(str).replace(/%u([0-9a-fA-F]{4})/gi, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  try {
    return decodeURIComponent(s);
  } catch (_) {
    return s.replace(/%([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
  }
}

function decodeCmsPlayerUrl(rawUrl, encrypt = 0) {
  if (!rawUrl) return '';
  let str = String(rawUrl).trim();
  const encMode = Number(encrypt) || 0;

  if (encMode === 1) {
    str = customUnescape(str);
  } else if (encMode === 2) {
    try {
      const b64Decoded = Buffer.from(str, 'base64').toString('utf8');
      str = customUnescape(b64Decoded);
    } catch (_) {}
  }

  str = decodePercentAndUnicode(str);
  return str.trim();
}

function unwrapNestedPlayerUrl(rawUrl, baseOrigin = activeDomain) {
  if (!rawUrl) return '';
  let current = resolveUrl(decodePercentAndUnicode(rawUrl), baseOrigin);
  if (!current) return '';

  for (let pass = 0; pass < 2; pass++) {
    try {
      const u = new URL(current);
      const pathname = u.pathname.toLowerCase();
      if (/\.(?:m3u8|mp4|flv|mkv|webm)$/i.test(pathname)) {
        return current;
      }
      const paramNames = ['url', 'v', 'vid', 'src', 'play', 'file', 'm3u8'];
      let extracted = '';
      for (const key of paramNames) {
        const val = u.searchParams.get(key);
        if (val && (val.includes('.m3u8') || val.includes('.mp4') || /^https?:\/\//i.test(val) || /^https?%3A/i.test(val))) {
          extracted = val;
          break;
        }
      }
      if (!extracted) {
        const rawSearch = u.search || '';
        const m = rawSearch.match(/[?&](?:url|v|src|file)=([^&]+)/i);
        if (m) extracted = m[1];
      }
      if (extracted) {
        let dec = customUnescape(extracted);
        if (/%[0-9a-fA-F]{2}/.test(dec)) {
          dec = customUnescape(dec);
        }
        dec = decodePercentAndUnicode(dec);
        const resolved = resolveUrl(dec, u.origin);
        if (resolved && resolved !== current) {
          current = resolved;
          continue;
        }
      }
    } catch (_) {}
    break;
  }

  return current;
}

function extractBalancedJsonObjects(html, varNames = ['player_aaaa', 'player_data', 'player_config', 'MacPlayerConfig']) {
  const results = [];
  if (!html) return results;

  for (const name of varNames) {
    const re = new RegExp(`(?:var|let|const|window\\.)?\\s*${name}\\s*=\\s*`, 'g');
    let m;
    while ((m = re.exec(html)) !== null) {
      let startIdx = m.index + m[0].length;
      while (startIdx < html.length && /\s/.test(html[startIdx])) {
        startIdx++;
      }
      if (html[startIdx] !== '{') continue;

      let depth = 0;
      let inString = false;
      let quoteChar = '';
      let escaped = false;
      let endIdx = -1;

      for (let i = startIdx; i < html.length; i++) {
        const ch = html[i];
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (ch === '\\') {
            escaped = true;
          } else if (ch === quoteChar) {
            inString = false;
            quoteChar = '';
          }
          continue;
        }
        if (ch === '"' || ch === "'") {
          inString = true;
          quoteChar = ch;
        } else if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0) {
            endIdx = i;
            break;
          }
        }
      }

      if (endIdx !== -1) {
        results.push(html.slice(startIdx, endIdx + 1));
      }
    }
  }
  return results;
}

function parsePlayerObjectText(objText) {
  if (!objText) return null;
  try {
    return JSON.parse(objText);
  } catch (_) {}

  const urlMatch = objText.match(/["']?url["']?\s*:\s*["']([^"']+)["']/i);
  const encMatch = objText.match(/["']?encrypt["']?\s*:\s*["']?(\d+)["']?/i);
  if (urlMatch) {
    return {
      url: urlMatch[1],
      encrypt: encMatch ? Number(encMatch[1]) : 0,
    };
  }
  return null;
}

function unpackDeanEdwards(html) {
  if (!html || !html.includes('eval(function(p,a,c,k,e,')) return [];
  const unpackedList = [];
  const packRe = /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\((['"])\|\7\)/g;

  const encodeBase = (num, radix) => {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (num < radix) {
      return num < 36 ? num.toString(36) : chars[num];
    }
    return encodeBase(Math.floor(num / radix), radix) + (num % radix < 36 ? (num % radix).toString(36) : chars[num % radix]);
  };

  let m;
  while ((m = packRe.exec(html)) !== null) {
    const payload = m[2];
    const radix = parseInt(m[3], 10);
    const count = parseInt(m[4], 10);
    const keywords = m[6].split('|');
    if (!radix || !count) continue;

    const dict = new Map();
    for (let i = count - 1; i >= 0; i--) {
      const token = encodeBase(i, radix);
      dict.set(token, keywords[i] || token);
    }

    const unpacked = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (word) =>
      dict.has(word) ? dict.get(word) : word
    );
    unpackedList.push(unpacked);
  }
  return unpackedList;
}

function tryDecryptManifestFromHtml(html, baseOrigin = activeDomain) {
  if (!html || !html.includes('decryptDatas')) return '';

  const candidates = [];
  const inlineRe = /decryptDatas\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/gi;
  let m;
  while ((m = inlineRe.exec(html)) !== null) {
    candidates.push({ dataB64: m[1], keyStr: m[2] });
  }

  const varDataMatch = html.match(/(?:var|let|const)\s+datas\s*=\s*["']([^"']+)["']/i);
  const varCallMatch = html.match(/decryptDatas\(\s*datas\s*,\s*["']([^"']+)["']\s*\)/i);
  if (varDataMatch && varCallMatch) {
    candidates.push({ dataB64: varDataMatch[1], keyStr: varCallMatch[1] });
  }

  for (const { dataB64, keyStr } of candidates) {
    for (const encoding of ['utf8', 'latin1']) {
      try {
        const outerStr = Buffer.from(dataB64, 'base64').toString(encoding);
        const envelope = JSON.parse(outerStr);
        if (envelope && envelope.encryptedData && envelope.iv) {
          const rawKey = Buffer.from(envelope.key || keyStr, 'utf8');
          const keyLengths = [rawKey.length, 16, 24, 32].filter((len) => len === 16 || len === 24 || len === 32);
          for (const kLen of [...new Set(keyLengths)]) {
            try {
              const keyBuf = Buffer.alloc(kLen);
              rawKey.copy(keyBuf, 0, 0, Math.min(rawKey.length, kLen));
              const ivBuf = Buffer.from(envelope.iv, 'base64').length === 16
                ? Buffer.from(envelope.iv, 'base64')
                : Buffer.from(String(envelope.iv).slice(0, 16), 'utf8');
              const algo = `aes-${kLen * 8}-cbc`;
              const decipher = crypto.createDecipheriv(algo, keyBuf, ivBuf);
              let dec = decipher.update(Buffer.from(envelope.encryptedData, 'base64'), undefined, 'utf8');
              dec += decipher.final('utf8');
              const stream = extractStreamFromHtmlSync(dec, baseOrigin);
              if (stream) return stream;
            } catch (_) {}
          }
        }
      } catch (_) {}
    }
  }
  return '';
}

function extractStreamFromHtmlSync(pageHtml, baseOrigin = activeDomain) {
  if (!pageHtml) return '';

  // Stage 1: Balanced-brace CMS player object extraction (player_aaaa, player_data, player_config)
  const rawObjects = extractBalancedJsonObjects(pageHtml);
  for (const objStr of rawObjects) {
    const parsed = parsePlayerObjectText(objStr);
    if (parsed && parsed.url) {
      const decoded = decodeCmsPlayerUrl(parsed.url, parsed.encrypt);
      const unwrapped = unwrapNestedPlayerUrl(decoded, baseOrigin);
      if (isDirectMediaUrl(unwrapped)) {
        return unwrapped;
      }
      if (unwrapped && /^https?:\/\//i.test(unwrapped) && !isBadMediaUrl(unwrapped)) {
        return unwrapped;
      }
    }
  }

  // Stage 2: Unpack Dean Edwards packed scripts and re-scan
  const unpackedBlocks = unpackDeanEdwards(pageHtml);
  for (const block of unpackedBlocks) {
    const innerObjs = extractBalancedJsonObjects(block);
    for (const objStr of innerObjs) {
      const parsed = parsePlayerObjectText(objStr);
      if (parsed && parsed.url) {
        const decoded = decodeCmsPlayerUrl(parsed.url, parsed.encrypt);
        const unwrapped = unwrapNestedPlayerUrl(decoded, baseOrigin);
        if (isDirectMediaUrl(unwrapped)) return unwrapped;
      }
    }
    const normalizedBlock = decodePercentAndUnicode(block);
    const blockMediaRe = /https?:\/\/[^\s"'$<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'$<>\\]*)?/gi;
    let bm;
    while ((bm = blockMediaRe.exec(normalizedBlock)) !== null) {
      const cand = unwrapNestedPlayerUrl(bm[0], baseOrigin);
      if (isDirectMediaUrl(cand)) return cand;
    }
  }

  // Stage 3: Encrypted manifest decryption if present
  const decryptedStream = tryDecryptManifestFromHtml(pageHtml, baseOrigin);
  if (decryptedStream && isDirectMediaUrl(decryptedStream)) {
    return decryptedStream;
  }

  // Stage 4: Priority variable assignments (excluding decoy preview clips)
  const normalizedHtml = decodePercentAndUnicode(pageHtml);
  const varRe = /(?:url|playUrl|videoUrl|vurl|m3u8Url)\s*[:=]\s*["']([^"']+)["']/gi;
  let vm;
  while ((vm = varRe.exec(normalizedHtml)) !== null) {
    const cand = unwrapNestedPlayerUrl(vm[1], baseOrigin);
    if (isDirectMediaUrl(cand)) {
      return cand;
    }
  }

  // Stage 5: Direct .m3u8 / .mp4 regex scan across unescaped HTML
  const m3u8Re = /https?:\/\/[^\s"'$<>\\]+?\.m3u8(?:\?[^\s"'$<>\\]*)?/gi;
  let mm;
  while ((mm = m3u8Re.exec(normalizedHtml)) !== null) {
    const cand = unwrapNestedPlayerUrl(mm[0], baseOrigin);
    if (isDirectMediaUrl(cand)) {
      return cand;
    }
  }

  const mp4Re = /https?:\/\/[^\s"'$<>\\]+?\.mp4(?:\?[^\s"'$<>\\]*)?/gi;
  while ((mm = mp4Re.exec(normalizedHtml)) !== null) {
    const cand = unwrapNestedPlayerUrl(mm[0], baseOrigin);
    if (isDirectMediaUrl(cand)) {
      return cand;
    }
  }

  return '';
}

function extractIframeUrls(pageHtml, baseOrigin = activeDomain) {
  if (!pageHtml) return [];
  const urls = [];
  const iframeTagRe = /<iframe[^>]+>/gi;
  let m;
  while ((m = iframeTagRe.exec(pageHtml)) !== null) {
    const tag = m[0];
    const src = extractImageAttr(tag, baseOrigin);
    if (src && !isBadMediaUrl(src)) {
      urls.push(src);
    }
  }
  return [...new Set(urls)];
}

function extractPlayRoutesFromDetailHtml(detailHtml, targetId = '') {
  if (!detailHtml) return [];
  const routes = [];
  const seen = new Set();
  const re = /href=["']((?:\/index\.php)?\/vod\/play\/id\/\d+\/sid\/\d+\/nid\/\d+\.html)["']/gi;
  let m;
  while ((m = re.exec(detailHtml)) !== null) {
    const path = m[1].startsWith('/index.php') ? m[1] : `/index.php${m[1]}`;
    if (targetId && !path.includes(`/id/${targetId}/`)) continue;
    if (!seen.has(path)) {
      seen.add(path);
      routes.push(path);
    }
  }
  return routes;
}

async function resolvePlayStream(playPathOrUrl, videoId = '') {
  if (videoId) {
    const cached = getPlayCache(videoId);
    if (cached && isDirectMediaUrl(cached)) return cached;
  }
  const cacheKey = playPathOrUrl || videoId;
  const cachedByPath = getPlayCache(cacheKey);
  if (cachedByPath && isDirectMediaUrl(cachedByPath)) return cachedByPath;

  const resP = await fetchHtml(playPathOrUrl, { referer: `${activeDomain}/` });
  const htmlP = resP.text || '';
  const pageOrigin = resP.origin || activeDomain;
  const pageFinalUrl = resP.finalUrl || resolveUrl(playPathOrUrl, pageOrigin);

  let stream = extractStreamFromHtmlSync(htmlP, pageOrigin);

  // If extracted URL is a wrapper page (not direct media), unwrap or fetch it
  if (stream && !isDirectMediaUrl(stream) && /^https?:\/\//i.test(stream)) {
    const unwrapped = unwrapNestedPlayerUrl(stream, pageOrigin);
    if (isDirectMediaUrl(unwrapped)) {
      stream = unwrapped;
    } else {
      const wrapRes = await fetchHtml(unwrapped, { referer: pageFinalUrl });
      const innerStream = extractStreamFromHtmlSync(wrapRes.text || '', wrapRes.origin || pageOrigin);
      if (isDirectMediaUrl(innerStream)) {
        stream = innerStream;
      }
    }
  }

  // Stage 4: Follow embedded <iframe src="..."> wrapper pages
  if (!isDirectMediaUrl(stream)) {
    const iframes = extractIframeUrls(htmlP, pageOrigin);
    for (const iframeUrl of iframes) {
      const unwrappedIframe = unwrapNestedPlayerUrl(iframeUrl, pageOrigin);
      if (isDirectMediaUrl(unwrappedIframe)) {
        stream = unwrappedIframe;
        break;
      }
      const iframeRes = await fetchHtml(iframeUrl, { referer: pageFinalUrl });
      const iframeStream = extractStreamFromHtmlSync(iframeRes.text || '', iframeRes.origin || pageOrigin);
      if (isDirectMediaUrl(iframeStream)) {
        stream = iframeStream;
        break;
      }
    }
  }

  // Stage 5: If default play route has no valid stream, fetch detail page for alternative play routes
  if (!isDirectMediaUrl(stream)) {
    const vidMatch =
      String(videoId || '').match(/^(\d+)$/) ||
      String(playPathOrUrl || '').match(/\/vod\/(?:play|detail)\/id\/(\d+)/i);
    const vid = vidMatch ? vidMatch[1] : '';
    if (vid) {
      const detailPath = `/index.php/vod/detail/id/${vid}.html`;
      const detailRes = await fetchHtml(detailPath, { referer: `${activeDomain}/` });
      const detailHtml = detailRes.text || '';
      const altRoutes = extractPlayRoutesFromDetailHtml(detailHtml, vid);
      for (const route of altRoutes) {
        if (String(playPathOrUrl).includes(route)) continue;
        const altRes = await fetchHtml(route, { referer: detailRes.finalUrl || `${activeDomain}/` });
        const altStream = extractStreamFromHtmlSync(altRes.text || '', altRes.origin || activeDomain);
        if (isDirectMediaUrl(altStream)) {
          stream = altStream;
          setPlayCache(route, stream);
          break;
        }
      }
    }
  }

  if (stream && isDirectMediaUrl(stream)) {
    if (videoId) setPlayCache(videoId, stream);
    if (cacheKey) setPlayCache(cacheKey, stream);
    return stream;
  }

  return stream || '';
}

function sanitizePlayId(rawInput) {
  let raw = String(rawInput || '').trim();
  let descTitle = '';

  if (raw.includes('@@@')) {
    const idx = raw.indexOf('@@@');
    const left = raw.slice(0, idx);
    const right = raw.slice(idx + 3);
    raw = left;
    try {
      descTitle = decodeURIComponent(right);
    } catch (_) {
      descTitle = right;
    }
  }

  if (raw.includes('$')) {
    const dollarIdx = raw.indexOf('$');
    const prefix = raw.slice(0, dollarIdx).trim();
    const rest = raw.slice(dollarIdx + 1).trim();
    if (!/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
      raw = rest;
      if (!descTitle && prefix) {
        descTitle = prefix;
      }
    }
  }

  return { targetPath: raw.trim(), descTitle };
}

async function init() {
  return {};
}

async function home(inReq) {
  const params = unwrapParams(inReq);
  const includeFilter = params.filter !== false && params.filter !== 'false' && params.filter !== 0;

  let list = [];
  try {
    const firstTid = CLASSES[0].type_id;
    const reqPath = `/index.php/vod/type/id/${firstTid}.html`;
    const res = await fetchHtml(reqPath);
    list = parseCardsFromHtml(res.text || '', res.origin);
  } catch (_) {}

  const result = {
    class: CLASSES,
    list,
    style: CARD_STYLE,
  };
  if (includeFilter) {
    result.filters = FILTERS;
  }
  return result;
}

async function category(inReq) {
  const params = unwrapParams(inReq);
  const tid = String(params.id ?? params.tid ?? params.type_id ?? '1').replace(/^\/+|\/+$/g, '');
  const pgRaw = parseInt(params.page ?? params.pg ?? '1', 10);
  const page = Number.isFinite(pgRaw) && pgRaw > 0 ? pgRaw : 1;

  const extend = params.extend && typeof params.extend === 'object' ? params.extend : {};
  const targetId = extend.sub ? String(extend.sub).replace(/^\/+|\/+$/g, '') : tid;

  const reqPath =
    page <= 1
      ? `/index.php/vod/type/id/${targetId}.html`
      : `/index.php/vod/type/id/${targetId}/page/${page}.html`;

  const res = await fetchHtml(reqPath);
  const cards = parseCardsFromHtml(res.text || '', res.origin);

  const hasNext = cards.length >= 10;
  const totalCount = hasNext ? page * cards.length + 100 : page * cards.length;
  const pageCount = hasNext ? page + 1 : page;

  return {
    list: cards,
    page,
    pagecount: pageCount,
    limit: cards.length ? cards.length : 20,
    total: totalCount,
    style: CARD_STYLE,
  };
}

async function detail(inReq) {
  const params = unwrapParams(inReq);
  let rawId = params.id ?? params.ids ?? params.url ?? '';
  if (Array.isArray(rawId)) {
    rawId = rawId[0] ?? '';
  }
  rawId = String(rawId).trim();

  const idMatch = rawId.match(/\/vod\/(?:detail|play)\/id\/(\d+)/i);
  const targetId = idMatch ? idMatch[1] : rawId.replace(/^\/+|\/+$/g, '');

  const detailPath = `/index.php/vod/detail/id/${targetId}.html`;
  const res = await fetchHtml(detailPath);
  const html = res.text || '';
  const pageOrigin = res.origin || activeDomain;

  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const rawTitle = titleMatch
    ? titleMatch[1].split('-')[0].replace(/在线播放/g, '').trim()
    : '';
  const vTitle = cleanLabel(rawTitle) || `在线视频·${targetId}`;

  const vPic = extractImageAttr(html, pageOrigin);

  const descMatch = html.match(/class=["'][^"']*(?:content|desc|summary|text)[^"']*["'][^>]*>([\s\S]*?)</i);
  const rawDesc = descMatch ? cleanLabel(descMatch[1]) : '';
  const vContent = rawDesc
    ? `🦋 蝴蝶影视专线直连 | ${rawDesc} | 官方交流群: @tvshare23`
    : '🦋 蝴蝶影视专线加速播放 | 官方TG交流群：@tvshare23 | 4K高清原生极速画质';

  const defaultPlayPath = `/index.php/vod/play/id/${targetId}/sid/1/nid/1.html`;
  const episodes = [`正片$${defaultPlayPath}`];

  // Pre-warm PLAY_CACHE if embedded stream is on detail page or pre-resolvable
  const embeddedStream = extractStreamFromHtmlSync(html, pageOrigin);
  if (embeddedStream && isDirectMediaUrl(embeddedStream)) {
    setPlayCache(targetId, embeddedStream);
    setPlayCache(defaultPlayPath, embeddedStream);
  }

  const seenRecIds = new Set([String(targetId)]);
  const recRe = /<div[^>]+class=["']vod-list["'][\s\S]*?<a[^>]+href=["'](?:\S*?\/index\.php)?\/vod\/detail\/id\/(\d+)\.html["'][\s\S]*?<p[^>]+class=["']vod-name["']>([\s\S]*?)<\/p>/gi;
  let rm;
  let recIdx = 1;
  while ((rm = recRe.exec(html)) !== null) {
    const cleanRid = String(rm[1]).trim();
    if (seenRecIds.has(cleanRid)) continue;
    seenRecIds.add(cleanRid);

    const cleanRtitle = cleanLabel(rm[2]) || `推荐·${cleanRid}`;
    const shortTitle = cleanRtitle.slice(0, 16);
    const recPlayPath = `/index.php/vod/play/id/${cleanRid}/sid/1/nid/1.html`;
    const payload = `${recPlayPath}@@@${encodeURIComponent(cleanRtitle)}`;

    const idxStr = String(recIdx).padStart(2, '0');
    episodes.push(`${idxStr}·${shortTitle}$${payload}`);
    recIdx++;
    if (recIdx > 24) break;
  }

  const vod = {
    vod_id: targetId,
    vod_name: vTitle,
    vod_pic: vPic,
    vod_actor: BRAND_ACTOR,
    vod_director: BRAND_DIRECTOR,
    vod_remarks: formatRemarks(BRAND_SHORT, `全${episodes.length}部连播`),
    vod_content: vContent,
    vod_play_from: '蝴蝶专线',
    vod_play_url: episodes.join('#'),
  };

  return { list: [vod] };
}

async function play(inReq) {
  const params = unwrapParams(inReq);
  const rawVal = params.id ?? params.url ?? '';
  const { targetPath, descTitle } = sanitizePlayId(rawVal);

  let finalPlayUrl = '';
  if (isDirectMediaUrl(targetPath)) {
    finalPlayUrl = targetPath;
  } else {
    const vidMatch =
      targetPath.match(/\/vod\/(?:play|detail)\/id\/(\d+)/i) ||
      targetPath.match(/^(\d+)$/);
    const vid = vidMatch ? vidMatch[1] : '';
    const playRoute = /^\d+$/.test(targetPath)
      ? `/index.php/vod/play/id/${targetPath}/sid/1/nid/1.html`
      : targetPath;
    finalPlayUrl = await resolvePlayStream(playRoute, vid);
  }

  const fallbackPageUrl = resolveUrl(
    /^\d+$/.test(targetPath)
      ? `/index.php/vod/play/id/${targetPath}/sid/1/nid/1.html`
      : targetPath,
    activeDomain
  );

  const headers = {
    'User-Agent': DEFAULT_UA,
    Referer: `${activeDomain}/`,
  };

  const isDirect = isDirectMediaUrl(finalPlayUrl);
  const result = {
    parse: isDirect ? 0 : 1,
    jx: 0,
    playUrl: '',
    url: finalPlayUrl || fallbackPageUrl,
    header: headers,
    headers,
  };

  if (descTitle) {
    result.desc = descTitle;
  }

  return result;
}

async function search(inReq) {
  const params = unwrapParams(inReq);
  const key = String(params.wd ?? params.key ?? params.keyword ?? '').trim();
  const pgRaw = parseInt(params.page ?? params.pg ?? '1', 10);
  const page = Number.isFinite(pgRaw) && pgRaw > 0 ? pgRaw : 1;

  if (!key) {
    return { list: [], page: 1, pagecount: 1, limit: 20, total: 0 };
  }

  const searchPath = `/index.php/vod/search/page/${page}/wd/${encodeURIComponent(key)}.html`;
  const res = await fetchHtml(searchPath);
  const cards = parseCardsFromHtml(res.text || '', res.origin);

  const hasNext = cards.length >= 10;
  const totalCount = hasNext ? page * cards.length + 100 : page * cards.length;
  const pageCount = hasNext ? page + 1 : page;

  return {
    list: cards,
    page,
    pagecount: pageCount,
    limit: cards.length ? cards.length : 20,
    total: totalCount,
    style: CARD_STYLE,
  };
}

async function proxyPicHandler(query = {}) {
  const picUrl = query.url || query.pic || '';
  if (!picUrl) {
    return { mime: 'text/plain; charset=utf-8', data: 'Missing url' };
  }
  try {
    const resolved = resolveUrl(picUrl, activeDomain);
    const resp = await req.get(resolved, {
      headers: {
        'User-Agent': DEFAULT_UA,
        Referer: `${activeDomain}/`,
      },
      responseType: 'arraybuffer',
    });
    const raw = resp?.data ?? resp?.body ?? '';
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    const mime = resp?.headers?.['content-type'] || 'image/jpeg';
    return { mime, data: buf };
  } catch (_) {
    return { mime: 'image/gif', data: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') };
  }
}

export default {
  meta: {
    key: SPIDER_KEY,
    name: SITE_NAME,
    type: 3,
  },
  api: async (fastify) => {
    fastify.post('/init', init);
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get(`/${SPIDER_KEY}_pic`, async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
  },
  init,
  home,
  category,
  detail,
  play,
  search,
};