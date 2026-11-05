import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

const META = {"siteName": "少女导航", "siteUrl": "https://app-1.ssnnav.cyou", "tgGroup": "https://t.me/tvshare23", "brandActor": "🦋 TG群: @tvshare23", "brandDirector": "🦋 蝴蝶影视", "_ua": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"};
const CATEGORIES = [
  {
    "type_id": "fenlei/日韩无码",
    "type_name": "日韩无码"
  },
  {
    "type_id": "fenlei/国产精品",
    "type_name": "国产精品"
  },
  {
    "type_id": "fenlei/日韩精品",
    "type_name": "日韩精品"
  },
  {
    "type_id": "fenlei/欧美精品",
    "type_name": "欧美精品"
  },
  {
    "type_id": "fenlei/动漫精品",
    "type_name": "动漫精品"
  },
  {
    "type_id": "fenlei/中文字幕",
    "type_name": "中文字幕"
  },
  {
    "type_id": "fenlei/自拍",
    "type_name": "自拍偷拍"
  },
  {
    "type_id": "fenlei/伦理影片",
    "type_name": "伦理影片"
  },
  {
    "type_id": "fenlei/人妻系列",
    "type_name": "人妻系列"
  },
  {
    "type_id": "fenlei/制服诱惑",
    "type_name": "制服诱惑"
  },
  {
    "type_id": "fenlei/强奸乱伦",
    "type_name": "强奸乱伦"
  },
  {
    "type_id": "fenlei/AV明星",
    "type_name": "AV明星"
  },
  {
    "type_id": "fenlei/SM重味",
    "type_name": "SM重味"
  },
  {
    "type_id": "fenlei/巨乳系列",
    "type_name": "巨乳系列"
  },
  {
    "type_id": "fenlei/颜射系列",
    "type_name": "颜射系列"
  },
  {
    "type_id": "fenlei/口交视频",
    "type_name": "口交视频"
  },
  {
    "type_id": "fenlei/自慰系列",
    "type_name": "自慰系列"
  },
  {
    "type_id": "fenlei/教师学生",
    "type_name": "教师学生"
  },
  {
    "type_id": "fenlei/大秀视频",
    "type_name": "大秀视频"
  },
  {
    "type_id": "fenlei/明星换脸",
    "type_name": "明星换脸"
  },
  {
    "type_id": "fenlei/AV解说",
    "type_name": "AV解说"
  },
  {
    "type_id": "fenlei/黑料网曝",
    "type_name": "黑料网曝"
  },
  {
    "type_id": "fenlei/精品探花",
    "type_name": "精品探花"
  },
  {
    "type_id": "fenlei/精品网红",
    "type_name": "精品网红"
  },
  {
    "type_id": "fenlei/反差母狗",
    "type_name": "反差母狗"
  },
  {
    "type_id": "fenlei/颜值正义",
    "type_name": "颜值正义"
  },
  {
    "type_id": "fenlei/熟女少妇",
    "type_name": "熟女少妇"
  },
  {
    "type_id": "fenlei/人兽乱交",
    "type_name": "人兽乱交"
  },
  {
    "type_id": "fenlei/国产传媒",
    "type_name": "国产传媒"
  },
  {
    "type_id": "fenlei/撸管必看",
    "type_name": "撸管必看"
  },
  {
    "type_id": "fenlei/直播裸聊",
    "type_name": "直播裸聊"
  },
  {
    "type_id": "fenlei/国产主播",
    "type_name": "国产主播"
  },
  {
    "type_id": "fenlei/野战车震",
    "type_name": "野战车震"
  },
  {
    "type_id": "fenlei/群P换妻",
    "type_name": "群P换妻"
  },
  {
    "type_id": "fenlei/SM调教",
    "type_name": "SM调教"
  },
  {
    "type_id": "fenlei/学生空姐",
    "type_name": "学生空姐"
  },
  {
    "type_id": "fenlei/吃瓜黑料",
    "type_name": "吃瓜黑料"
  },
  {
    "type_id": "fenlei/偷情少妇",
    "type_name": "偷情少妇"
  },
  {
    "type_id": "fenlei/百合女同",
    "type_name": "百合女同"
  },
  {
    "type_id": "fenlei/三级",
    "type_name": "经典三级"
  },
  {
    "type_id": "fenlei/按摩",
    "type_name": "按摩会所"
  },
  {
    "type_id": "fenlei/肛门",
    "type_name": "后门肛交"
  },
  {
    "type_id": "fenlei/乳交",
    "type_name": "巨乳乳交"
  },
  {
    "type_id": "fenlei/高潮",
    "type_name": "抽搐高潮"
  },
  {
    "type_id": "fenlei/少女",
    "type_name": "清纯少女"
  },
  {
    "type_id": "fenlei/新人",
    "type_name": "下海新人"
  },
  {
    "type_id": "fenlei/妈妈",
    "type_name": "熟母人妻"
  },
  {
    "type_id": "fenlei/3P",
    "type_name": "多人3P"
  },
  {
    "type_id": "fenlei/69",
    "type_name": "互舐69"
  },
  {
    "type_id": "fenlei/强迫",
    "type_name": "迷晕强迫"
  },
  {
    "type_id": "fenlei/口活",
    "type_name": "深喉口活"
  },
  {
    "type_id": "fenlei/娇小",
    "type_name": "娇小萝莉"
  },
  {
    "type_id": "fenlei/网红",
    "type_name": "热播网红"
  },
  {
    "type_id": "fenlei/大屁股",
    "type_name": "蜜桃丰臀"
  },
  {
    "type_id": "fenlei/虐待",
    "type_name": "捆绑虐待"
  },
  {
    "type_id": "fenlei/3d",
    "type_name": "3D肉感"
  },
  {
    "type_id": "fenlei/偷窥",
    "type_name": "真实偷窥"
  },
  {
    "type_id": "fenlei/特写",
    "type_name": "器官特写"
  },
  {
    "type_id": "fenlei/视角",
    "type_name": "第一视角"
  },
  {
    "type_id": "fenlei/探花",
    "type_name": "探花实录"
  },
  {
    "type_id": "tag/初下海",
    "type_name": "标签·初下海"
  },
  {
    "type_id": "tag/极品",
    "type_name": "标签·极品尤物"
  },
  {
    "type_id": "tag/深喉",
    "type_name": "标签·深喉狂插"
  },
  {
    "type_id": "tag/母狗",
    "type_name": "标签·调教母狗"
  },
  {
    "type_id": "tag/家教",
    "type_name": "标签·家庭教师"
  },
  {
    "type_id": "tag/外遇",
    "type_name": "标签·出轨外遇"
  },
  {
    "type_id": "tag/兼职",
    "type_name": "标签·兼职援交"
  },
  {
    "type_id": "tag/白领",
    "type_name": "标签·职场白领"
  },
  {
    "type_id": "tag/黑丝",
    "type_name": "标签·诱惑黑丝"
  },
  {
    "type_id": "tag/白虎",
    "type_name": "标签·白虎无毛"
  },
  {
    "type_id": "tag/约炮",
    "type_name": "标签·同城约炮"
  },
  {
    "type_id": "tag/内射",
    "type_name": "标签·疯狂内射"
  },
  {
    "type_id": "tag/潮吹",
    "type_name": "标签·高潮喷水"
  },
  {
    "type_id": "tag/双飞",
    "type_name": "标签·姐妹双飞"
  },
  {
    "type_id": "tag/破处",
    "type_name": "标签·稚嫩破处"
  }
];

const DOMAIN_POOL = [
  META.siteUrl,
  'https://app-2.ssnnav.cyou',
  'https://app-3.ssnnav.cyou',
];
let activeDomain = DOMAIN_POOL[0];

const DEFAULT_UA = META._ua;
const CARD_STYLE = { type: 'rect', ratio: 1.78 };
const PLAY_CACHE = new Map();
const STREAM_SESSION_CACHE = new Map();
const CACHE_TTL = 10 * 60 * 1000;

const BAD_STREAM_PATTERNS = [
  'preview.mp4',
  'sample.mp4',
  'trailer.mp4',
  'top_banner',
  'native-ad',
  'stat.php',
];

function setPlayCache(key, val) {
  if (!key || !val) return;
  PLAY_CACHE.set(String(key), { url: val, ts: Date.now() });
}

function getPlayCache(key) {
  if (!key) return '';
  const item = PLAY_CACHE.get(String(key));
  if (!item) return '';
  if (Date.now() - item.ts > CACHE_TTL) {
    PLAY_CACHE.delete(String(key));
    return '';
  }
  return item.url;
}

function formatRemarks(brand = '蝴蝶影视', meta = '') {
  const cleanMeta = String(meta || '').replace(/[\r\n\t]+/g, ' ').trim();
  return cleanMeta ? `${brand} | ${cleanMeta}` : brand;
}

function getKnownHosts() {
  const hosts = new Set();
  for (const d of DOMAIN_POOL) {
    try {
      hosts.add(new URL(d).hostname.toLowerCase());
    } catch (_) {}
  }
  return hosts;
}

function resolveUrl(targetUrl, base = activeDomain) {
  if (!targetUrl) return '';
  const str = String(targetUrl).trim();
  if (str.startsWith('http://') || str.startsWith('https://')) return str;
  if (str.startsWith('//')) return 'https:' + str;
  try {
    return new URL(str, base || activeDomain).href;
  } catch (_) {
    const cleanBase = String(base || activeDomain).replace(/\/+$/, '');
    if (str.startsWith('/')) return cleanBase + str;
    return cleanBase + '/' + str;
  }
}

function buildCandidateUrls(targetUrl) {
  if (!targetUrl) return [];
  const str = String(targetUrl).trim();
  const orderedDomains = [activeDomain, ...DOMAIN_POOL.filter((d) => d !== activeDomain)];

  if (!/^https?:\/\//i.test(str) && !str.startsWith('//')) {
    return orderedDomains.map((d) => resolveUrl(str, d));
  }

  const normalized = str.startsWith('//') ? 'https:' + str : str;
  try {
    const parsed = new URL(normalized);
    const knownHosts = getKnownHosts();
    if (knownHosts.has(parsed.hostname.toLowerCase()) || parsed.hostname.endsWith('.ssnnav.cyou')) {
      const pathAndQuery = `${parsed.pathname || '/'}${parsed.search || ''}${parsed.hash || ''}`;
      return orderedDomains.map((d) => resolveUrl(pathAndQuery, d));
    }
  } catch (_) {}

  return [normalized];
}

function buildHeaders(targetUrl, customReferer = '') {
  let referer = customReferer || (activeDomain.replace(/\/+$/, '') + '/');
  try {
    const u = new URL(targetUrl);
    if (!customReferer) {
      referer = `${u.protocol}//${u.host}/`;
    } else {
      const refUrl = new URL(customReferer);
      const knownHosts = getKnownHosts();
      if (knownHosts.has(refUrl.hostname.toLowerCase()) && refUrl.host !== u.host && knownHosts.has(u.hostname.toLowerCase())) {
        referer = `${u.protocol}//${u.host}${refUrl.pathname || '/'}${refUrl.search || ''}`;
      }
    }
  } catch (_) {}
  return {
    'User-Agent': DEFAULT_UA,
    'Referer': referer,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
}

function decodeBuffer(buf) {
  if (!buf) return '';
  if (typeof buf === 'string') return buf;
  let raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
    try {
      raw = zlib.gunzipSync(raw);
    } catch (_) {}
  }
  const utf8 = raw.toString('utf-8');
  if (utf8.includes('\ufffd')) {
    try {
      const dec = new TextDecoder('gbk');
      return dec.decode(raw);
    } catch (_) {}
  }
  return utf8;
}

function isValidSiteHtml(html) {
  if (!html || typeof html !== 'string') return false;
  const trimmed = html.trim();
  if (trimmed.length < 20) return false;
  if (
    /class=["']thumb["']/i.test(trimmed) ||
    /play-\d+-\d+-\.html/i.test(trimmed) ||
    /data-preview=/i.test(trimmed) ||
    /player_aaaa|player_data|player_config|cms_player|decryptDatas/i.test(trimmed) ||
    /<video[\s>]|<iframe[\s>]|<h1[\s>]/i.test(trimmed) ||
    /\.m3u8|\.mp4/i.test(trimmed) ||
    /eval\(function\(p,a,c,k,e/i.test(trimmed)
  ) {
    return true;
  }
  return false;
}

async function fetchHtml(targetUrl, referer = '') {
  if (!targetUrl) return { code: 0, text: '', finalUrl: '' };
  const candidateUrls = buildCandidateUrls(targetUrl);
  let lastFallback = { code: -1, text: '', finalUrl: resolveUrl(targetUrl) };

  for (const fullUrl of candidateUrls) {
    const headers = buildHeaders(fullUrl, referer);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await req.get(fullUrl, {
          headers,
          timeout: 10000,
          responseType: 'arraybuffer',
        });
        const status = resp?.status ?? 200;
        const data = resp?.data ?? resp?.body ?? resp ?? '';
        const text = decodeBuffer(data);
        if (status >= 200 && status < 400 && text) {
          lastFallback = { code: status, text, finalUrl: fullUrl };
          if (isValidSiteHtml(text)) {
            try {
              const u = new URL(fullUrl);
              const knownHosts = getKnownHosts();
              if (knownHosts.has(u.hostname.toLowerCase()) || u.hostname.endsWith('.ssnnav.cyou')) {
                activeDomain = `${u.protocol}//${u.host}`;
              }
            } catch (_) {}
            return { code: status, text, finalUrl: fullUrl };
          }
          break;
        }
      } catch (_) {
        if (attempt === 0) continue;
      }
    }
  }
  return lastFallback;
}

function parseParams(inReq) {
  const merged = {};
  if (!inReq) return merged;

  const isFastifyReq =
    typeof inReq === 'object' &&
    (inReq.body !== undefined ||
      inReq.query !== undefined ||
      inReq.params !== undefined ||
      inReq.raw !== undefined ||
      inReq.headers !== undefined);

  const sources = isFastifyReq
    ? [inReq.query, inReq.params, inReq.body]
    : [inReq];

  for (const src of sources) {
    if (!src) continue;
    if (typeof src === 'string') {
      const trimmed = src.trim();
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
      for (const [k, v] of Object.entries(src)) {
        if (v !== undefined && v !== null) {
          merged[k] = v;
        }
      }
    }
  }
  return merged;
}

function unescapeUrlString(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .trim();
}

function customUnescape(str) {
  if (!str) return '';
  return String(str)
    .replace(/%u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/%([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function multiPassDecodeUri(str, maxPasses = 2) {
  let cur = String(str || '').trim();
  for (let i = 0; i < maxPasses; i++) {
    if (!/%[0-9a-fA-F]{2}|%u[0-9a-fA-F]{4}/.test(cur)) break;
    try {
      const next = decodeURIComponent(cur);
      if (next === cur) break;
      cur = next;
    } catch (_) {
      const next = customUnescape(cur);
      if (next === cur) break;
      cur = next;
    }
  }
  return unescapeUrlString(cur);
}

function decodeCmsUrl(rawUrl, encrypt = 0) {
  if (!rawUrl) return '';
  let u = String(rawUrl).trim();
  const enc = Number(encrypt || 0);
  if (enc === 1) {
    u = multiPassDecodeUri(u, 2);
  } else if (enc === 2) {
    try {
      const b64 = Buffer.from(u, 'base64').toString('utf-8');
      u = multiPassDecodeUri(b64, 2);
    } catch (_) {}
  } else {
    u = unescapeUrlString(u);
  }
  return u;
}

function sanitizeEpisodeTarget(rawVal) {
  let str = String(rawVal || '').trim();
  let descTitle = '';

  if (str.includes('@@@')) {
    const parts = str.split('@@@');
    if (/^\d+$/.test(parts[0]) && parts.length > 1 && parts[1]) {
      // vod_id payload format: vid@@@encodedStreamUrl@@@encodedTitle
      const vid = parts[0];
      const streamPart = multiPassDecodeUri(parts[1], 2);
      if (parts.length > 2 && parts[2]) {
        descTitle = multiPassDecodeUri(parts[2], 2);
      }
      return {
        vid,
        target: streamPart || `/?play-${vid}-1-.html`,
        descTitle,
      };
    }
    str = parts[0];
    if (parts[1]) {
      descTitle = multiPassDecodeUri(parts[1], 2);
    }
  }

  if (str.includes('$')) {
    const dollarIdx = str.indexOf('$');
    const prefix = str.slice(0, dollarIdx).trim();
    const rest = str.slice(dollarIdx + 1).trim();
    if (rest && !/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
      if (!descTitle) descTitle = prefix;
      str = rest;
    }
  }

  let vid = '';
  const mVid = str.match(/play-(\d+)-/i);
  if (mVid) {
    vid = mVid[1];
  } else if (/^\d+$/.test(str)) {
    vid = str;
    str = `/?play-${vid}-1-.html`;
  }

  return { vid, target: str, descTitle };
}

function unwrapNestedPlayerUrl(rawUrl) {
  if (!rawUrl) return '';
  const cleaned = unescapeUrlString(rawUrl);
  try {
    const parsed = new URL(cleaned, activeDomain);
    const pathname = parsed.pathname.toLowerCase();
    if (!pathname.endsWith('.m3u8') && !pathname.endsWith('.mp4') && !pathname.endsWith('.flv')) {
      for (const key of ['url', 'v', 'vid', 'src', 'file', 'm3u8']) {
        const inner = parsed.searchParams.get(key);
        if (!inner) continue;
        const decodedInner = multiPassDecodeUri(inner, 2);
        if (
          /^https?:\/\//i.test(decodedInner) ||
          decodedInner.startsWith('//') ||
          (decodedInner.startsWith('/') && (/\.(?:m3u8|mp4|flv)(?:$|[?#])/i.test(decodedInner)))
        ) {
          return resolveUrl(decodedInner, `${parsed.protocol}//${parsed.host}`);
        }
      }
    }
  } catch (_) {}
  return cleaned;
}

function isBadStreamUrl(urlStr) {
  if (!urlStr) return true;
  const low = String(urlStr).toLowerCase();
  return BAD_STREAM_PATTERNS.some((bad) => low.includes(bad));
}

function isDirectMediaUrl(rawUrl) {
  if (!rawUrl) return false;
  const u = unescapeUrlString(rawUrl);
  if (!u || u === 'none' || u === 'null' || u === 'undefined') return false;
  if (isBadStreamUrl(u)) return false;

  try {
    const parsed = new URL(u, activeDomain);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return false;
    }
    const pathname = parsed.pathname.toLowerCase();
    for (const key of ['url', 'v', 'src', 'file', 'm3u8']) {
      const inner = parsed.searchParams.get(key);
      if (inner) {
        const decInner = multiPassDecodeUri(inner, 2);
        if (/^https?:\/\//i.test(decInner) && /\.(?:m3u8|mp4)/i.test(decInner)) {
          return false;
        }
      }
    }
    if (
      pathname.endsWith('.m3u8') ||
      pathname.endsWith('.mp4') ||
      pathname.endsWith('.flv') ||
      pathname.endsWith('index.png')
    ) {
      return true;
    }
    const fullLower = `${pathname}${parsed.search}`.toLowerCase();
    if (fullLower.includes('.m3u8') || fullLower.includes('format=.m3u8')) {
      return true;
    }
  } catch (_) {}
  return false;
}

function cleanM3u8Url(rawStr) {
  if (!rawStr) return '';
  const normalized = unwrapNestedPlayerUrl(unescapeUrlString(rawStr));
  if (isDirectMediaUrl(normalized)) {
    return resolveUrl(normalized);
  }
  const m = normalized.match(/(https?:\/\/(?:(?!localhost|127\.0\.0\.1)[^\s"'$<>])+\.(?:m3u8|mp4)[^\s"'$<>]*)/i);
  if (m) {
    let clean = unwrapNestedPlayerUrl(m[1]);
    if (isBadStreamUrl(clean)) return '';
    if (!clean.toLowerCase().includes('.m3u8') && !clean.toLowerCase().includes('.mp4')) {
      const sep = clean.includes('?') ? '&' : '?';
      clean = `${clean}${sep}format=.m3u8`;
    }
    return clean;
  }
  return '';
}

function extractBalancedJson(text, varPatterns) {
  if (!text) return null;
  for (const regex of varPatterns) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const startSearch = match.index + match[0].length;
      const braceStart = text.indexOf('{', startSearch - 1);
      if (braceStart === -1) continue;
      let depth = 0;
      let inStr = false;
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
        if (inStr) {
          if (ch === quoteChar) inStr = false;
          continue;
        }
        if (ch === '"' || ch === "'") {
          inStr = true;
          quoteChar = ch;
          continue;
        }
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            const candidate = text.slice(braceStart, i + 1);
            try {
              return JSON.parse(candidate);
            } catch (_) {
              break;
            }
          }
        }
      }
    }
  }
  return null;
}

function unpackDeanEdwards(html) {
  if (!html || !html.includes('eval(function(p,a,c,k,e,')) return [];
  const results = [];
  const regex = /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\((['"])([\s\S]*?)\1,\s*(\d+),\s*(\d+),\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    let p = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const a = parseInt(m[3], 10);
    let c = parseInt(m[4], 10);
    const k = m[6].split('|');
    if (!a || k.length === 0) continue;

    const encodeBase = (num) => {
      const first = num < a ? '' : encodeBase(Math.floor(num / a));
      const rem = num % a;
      const ch = rem > 35 ? String.fromCharCode(rem + 29) : rem.toString(36);
      return first + ch;
    };

    const dict = new Map();
    while (c--) {
      const token = encodeBase(c);
      dict.set(token, k[c] || token);
    }

    const unpacked = p.replace(/\b[0-9a-zA-Z_]+\b/g, (word) => (dict.has(word) ? dict.get(word) : word));
    results.push(unpacked);
  }
  return results;
}

function tryDecryptManifest(cipherB64, keyStr) {
  if (!cipherB64 || !keyStr) return null;
  try {
    const rawBuf = Buffer.from(cipherB64, 'base64');
    const keyBytes = Buffer.from(keyStr, 'utf-8');
    const validKey =
      keyBytes.length === 16 || keyBytes.length === 24 || keyBytes.length === 32
        ? keyBytes
        : crypto.createHash('md5').update(keyStr).digest();
    const algo = `aes-${validKey.length * 8}-cbc`;
    const iv = validKey.subarray(0, 16);
    const decipher = crypto.createDecipheriv(algo, validKey, iv);
    const decrypted = Buffer.concat([decipher.update(rawBuf), decipher.final()]).toString('utf-8');
    const parsed = JSON.parse(decrypted);
    return parsed;
  } catch (_) {
    try {
      const decoded = Buffer.from(cipherB64, 'base64').toString('utf-8');
      return JSON.parse(decoded);
    } catch (_) {}
  }
  return null;
}

function extractEncryptedManifest(htmlText, baseUrl = activeDomain) {
  if (!htmlText || !htmlText.includes('decryptDatas')) return null;

  let cipherB64 = '';
  let keyStr = '';

  const inlineMatch = htmlText.match(/decryptDatas\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/i);
  if (inlineMatch) {
    cipherB64 = inlineMatch[1];
    keyStr = inlineMatch[2];
  } else {
    const varCallMatch = htmlText.match(/decryptDatas\(\s*([a-zA-Z0-9_$]+)\s*(?:,\s*([a-zA-Z0-9_$'"]+))?\s*\)/i);
    if (varCallMatch) {
      const varName = varCallMatch[1];
      const varDefRegex = new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*['"]([^'"]{16,})['"]`);
      const vd = htmlText.match(varDefRegex);
      if (vd) cipherB64 = vd[1];

      if (varCallMatch[2]) {
        const arg2 = varCallMatch[2].trim();
        if ((arg2.startsWith('"') && arg2.endsWith('"')) || (arg2.startsWith("'") && arg2.endsWith("'"))) {
          keyStr = arg2.slice(1, -1);
        } else {
          const keyDefRegex = new RegExp(`(?:const|let|var)\\s+${arg2}\\s*=\\s*(?:CryptoJS\\.enc\\.Utf8\\.parse\\(|new\\s+TextEncoder\\(\\)\\.encode\\()?['"]([^'"]+)['"]`);
          const kd = htmlText.match(keyDefRegex);
          if (kd) keyStr = kd[1];
        }
      }
      if (!keyStr) {
        const fallbackKey = htmlText.match(/(?:Utf8\.parse|TextEncoder\(\)\.encode)\(\s*['"]([^'"]+)['"]\s*\)/i);
        if (fallbackKey) keyStr = fallbackKey[1];
      }
    }
  }

  if (!cipherB64 || !keyStr) return null;
  const envelope = tryDecryptManifest(cipherB64, keyStr);
  if (!envelope || typeof envelope !== 'object') return null;

  if (envelope.encryptedData && envelope.key && envelope.iv) {
    try {
      const kBuf = Buffer.from(envelope.key, 'utf-8');
      const ivBuf = Buffer.from(envelope.iv, 'utf-8').subarray(0, 16);
      const dec = crypto.createDecipheriv(`aes-${kBuf.length * 8}-cbc`, kBuf, ivBuf);
      const innerStr = Buffer.concat([
        dec.update(Buffer.from(envelope.encryptedData, 'base64')),
        dec.final(),
      ]).toString('utf-8');
      const innerObj = JSON.parse(innerStr);
      const mediaUrl = innerObj.url || innerObj.media || innerObj.playUrl || '';
      if (mediaUrl) {
        return { url: resolveUrl(unescapeUrlString(mediaUrl), baseUrl), requiresProxy: false };
      }
    } catch (_) {}
  }

  if (envelope.media) {
    const mediaUrl = resolveUrl(unescapeUrlString(envelope.media), baseUrl);
    if (envelope.user_id && envelope.slug && envelope.md5_id) {
      const rawSeed = `${envelope.user_id}${envelope.slug}${envelope.md5_id}`;
      const aesCtrKey = crypto.createHash('md5').update(rawSeed).digest('hex').slice(0, 16);
      const sid = crypto.createHash('md5').update(mediaUrl).digest('hex').slice(0, 16);
      STREAM_SESSION_CACHE.set(sid, {
        url: mediaUrl,
        key: Buffer.from(aesCtrKey, 'utf-8'),
        ts: Date.now(),
      });
      return { url: mediaUrl, requiresProxy: true, sid };
    }
    return { url: mediaUrl, requiresProxy: false };
  }

  if (envelope.url) {
    return { url: resolveUrl(unescapeUrlString(envelope.url), baseUrl), requiresProxy: false };
  }

  return null;
}

function extractStreamInfoFromSegment(segmentHtml, baseUrl = activeDomain, allowPreviewAttr = true) {
  if (!segmentHtml) return null;

  // 1. Check encrypted manifest (decryptDatas)
  const encManifest = extractEncryptedManifest(segmentHtml, baseUrl);
  if (encManifest && encManifest.url && isDirectMediaUrl(encManifest.url)) {
    return encManifest;
  }

  // 2. Check CMS player objects via balanced-brace scanner
  const playerObj = extractBalancedJson(segmentHtml, [
    /player_aaaa\s*=\s*/g,
    /player_data\s*=\s*/g,
    /player_config\s*=\s*/g,
    /cms_player\s*=\s*/g,
  ]);
  if (playerObj && playerObj.url) {
    const decoded = decodeCmsUrl(playerObj.url, playerObj.encrypt);
    const unwrapped = unwrapNestedPlayerUrl(decoded);
    const cleaned = cleanM3u8Url(unwrapped) || resolveUrl(unwrapped, baseUrl);
    if (cleaned && isDirectMediaUrl(cleaned)) {
      return { url: cleaned, requiresProxy: false };
    }
  }

  // 3. Check packed JS blocks
  const unpackedBlocks = unpackDeanEdwards(segmentHtml);
  for (const block of unpackedBlocks) {
    const fromBlock = extractStreamInfoFromSegment(block, baseUrl, allowPreviewAttr);
    if (fromBlock && fromBlock.url) return fromBlock;
  }

  // 4. Check high-priority script variables (excluding decoys)
  const normalized = unescapeUrlString(segmentHtml);
  const priorityVarRegex = /(?:vurl|video_url|hlsUrl|m3u8Url|realPlayUrl|vipPlayUrl)\s*[:=]\s*['"]([^'"]+)['"]/gi;
  let pvm;
  while ((pvm = priorityVarRegex.exec(normalized)) !== null) {
    const cand = cleanM3u8Url(pvm[1]);
    if (cand && isDirectMediaUrl(cand)) {
      return { url: cand, requiresProxy: false };
    }
  }

  // 5. Check secondary script variables (strictly require verified media URL & non-preview)
  const secondaryVarRegex = /(?:playUrl|videoUrl|normalPlayUrl|freePlayUrl|url)\s*[:=]\s*['"]([^'"]+)['"]/gi;
  let svm;
  while ((svm = secondaryVarRegex.exec(normalized)) !== null) {
    const cand = cleanM3u8Url(svm[1]);
    if (cand && isDirectMediaUrl(cand)) {
      return { url: cand, requiresProxy: false };
    }
  }

  // 6. Check <video> and <source> tags
  const videoTagRegex = /<(?:video|source)[^>]+src=["']([^"']+)["']/gi;
  let vtm;
  while ((vtm = videoTagRegex.exec(normalized)) !== null) {
    const cand = cleanM3u8Url(vtm[1]);
    if (cand && isDirectMediaUrl(cand)) {
      return { url: cand, requiresProxy: false };
    }
  }

  // 7. Check data-preview attribute if permitted in this segment
  if (allowPreviewAttr) {
    const previewRegex = /data-preview=["']([^"']+)["']/gi;
    let pm;
    while ((pm = previewRegex.exec(segmentHtml)) !== null) {
      const candidate = cleanM3u8Url(pm[1]);
      if (candidate && isDirectMediaUrl(candidate)) {
        return { url: candidate, requiresProxy: false };
      }
    }
  }

  // 8. Scan for direct .m3u8 / .mp4 stream URLs
  const directRegex = /(https?:\/\/(?:(?!localhost|127\.0\.0\.1)[^\s"'$<>])+\.(?:m3u8|mp4)[^\s"'$<>]*)/gi;
  let dm;
  while ((dm = directRegex.exec(normalized)) !== null) {
    const cand = unwrapNestedPlayerUrl(dm[1]);
    if (isDirectMediaUrl(cand)) {
      return { url: cand, requiresProxy: false };
    }
  }

  return null;
}

function extractStreamInfoFromHtml(htmlText, baseUrl = activeDomain) {
  if (!htmlText) return null;
  const thumbSplitIdx = htmlText.indexOf('<div class="thumb">');
  if (thumbSplitIdx !== -1) {
    const mainPlayerArea = htmlText.slice(0, thumbSplitIdx);
    const mainResult = extractStreamInfoFromSegment(mainPlayerArea, baseUrl, true);
    if (mainResult && mainResult.url) return mainResult;
    // Do not allow data-preview from recommendation cards to masquerade as the main video stream
    return extractStreamInfoFromSegment(htmlText, baseUrl, false);
  }
  return extractStreamInfoFromSegment(htmlText, baseUrl, true);
}

function extractStreamFromText(htmlText, baseUrl = activeDomain) {
  const info = extractStreamInfoFromHtml(htmlText, baseUrl);
  return info ? info.url : '';
}

async function resolvePlayStreamInfo(targetUrl, vid = '', preFetchedHtml = '') {
  if (!targetUrl) return { url: '', requiresProxy: false };
  const unwrappedInput = unwrapNestedPlayerUrl(targetUrl);
  if (isDirectMediaUrl(unwrappedInput)) {
    const directUrl = resolveUrl(unwrappedInput);
    if (vid) setPlayCache(vid, directUrl);
    return { url: directUrl, requiresProxy: false };
  }

  const cached = getPlayCache(targetUrl) || (vid ? getPlayCache(vid) : '');
  if (cached && isDirectMediaUrl(cached)) {
    return { url: cached, requiresProxy: false };
  }

  const pageUrl = resolveUrl(unwrappedInput);
  let html = preFetchedHtml;
  let finalPageUrl = pageUrl;
  if (!html) {
    const res = await fetchHtml(pageUrl);
    html = res.text || '';
    if (res.finalUrl) finalPageUrl = res.finalUrl;
  }

  const info = extractStreamInfoFromHtml(html, finalPageUrl);
  if (info && info.url && isDirectMediaUrl(info.url)) {
    setPlayCache(targetUrl, info.url);
    setPlayCache(finalPageUrl, info.url);
    if (vid) setPlayCache(vid, info.url);
    return info;
  }

  // Stage 4: Check iframe embeds (src or data-src) if stream is nested inside an iframe player
  const iframeMatch = html.match(/<iframe[^>]+(?:src|data-src)=["']([^"']+)["']/i);
  if (iframeMatch && iframeMatch[1]) {
    const iframeUrl = resolveUrl(unescapeUrlString(iframeMatch[1]), finalPageUrl);
    const unwrappedIframe = unwrapNestedPlayerUrl(iframeUrl);
    if (isDirectMediaUrl(unwrappedIframe)) {
      setPlayCache(targetUrl, unwrappedIframe);
      if (vid) setPlayCache(vid, unwrappedIframe);
      return { url: unwrappedIframe, requiresProxy: false };
    }
    const iframeRes = await fetchHtml(iframeUrl, finalPageUrl);
    if (iframeRes.text) {
      const iframeInfo = extractStreamInfoFromHtml(iframeRes.text, iframeRes.finalUrl || iframeUrl);
      if (iframeInfo && iframeInfo.url && isDirectMediaUrl(iframeInfo.url)) {
        setPlayCache(targetUrl, iframeInfo.url);
        if (vid) setPlayCache(vid, iframeInfo.url);
        return iframeInfo;
      }
    }
  }

  // Stage 5: Try alternative play route if default play-<vid>-1-.html had no direct stream
  const routeMatch = finalPageUrl.match(/play-(\d+)-(\d+)-\.html/i);
  const activeVid = vid || (routeMatch ? routeMatch[1] : '');
  if (activeVid) {
    const altLinks = [];
    const linkRegex = new RegExp(`href=["']([^"']*play-${activeVid}-(\\d+)-\\.html)["']`, 'gi');
    let lm;
    while ((lm = linkRegex.exec(html)) !== null) {
      if (lm[2] !== '1') {
        altLinks.push(lm[1]);
      }
    }
    if (altLinks.length === 0 && (!routeMatch || routeMatch[2] === '1')) {
      altLinks.push(`/?play-${activeVid}-2-.html`);
    }
    for (const altRaw of altLinks.slice(0, 2)) {
      const altRes = await fetchHtml(altRaw, finalPageUrl);
      if (altRes.text) {
        const altInfo = extractStreamInfoFromHtml(altRes.text, altRes.finalUrl || resolveUrl(altRaw, finalPageUrl));
        if (altInfo && altInfo.url && isDirectMediaUrl(altInfo.url)) {
          setPlayCache(targetUrl, altInfo.url);
          setPlayCache(activeVid, altInfo.url);
          return altInfo;
        }
      }
    }
  }

  return { url: '', requiresProxy: false };
}

function parseCards(htmlTxt) {
  const cardList = [];
  if (!htmlTxt) return cardList;
  const rawItems = htmlTxt.split('<div class="thumb">');
  if (rawItems.length <= 1) return cardList;

  const byVid = new Map();
  for (let i = 1; i < rawItems.length; i++) {
    const chunk = rawItems[i];
    const hrefM = chunk.match(/href=["']([^"']*play-(\d+)-1-\.html)["']/i);
    if (!hrefM) continue;

    const vid = hrefM[2];
    const existing = byVid.get(vid) || { vid, pic: '', title: '', dur: '', streamUrl: '' };

    if (!existing.pic) {
      for (const pat of [/data-original=["']([^"']+)["']/i, /data-src=["']([^"']+)["']/i, /src=["']([^"']+)["']/i]) {
        const pM = chunk.match(pat);
        if (pM && pM[1]) {
          const cand = pM[1].trim();
          if (cand && !cand.endsWith('logo.png') && !cand.endsWith('favicon.ico')) {
            existing.pic = resolveUrl(cand);
            break;
          }
        }
      }
    }

    if (!existing.title) {
      const altM = chunk.match(/<img[^>]+alt=["']([^"']+)["']/i);
      if (altM && altM[1].trim()) {
        existing.title = altM[1].trim();
      } else {
        const infoM = chunk.match(/<div class="thumb-info">([\s\S]*?)<\/div>/i);
        if (infoM && infoM[1].trim()) {
          existing.title = infoM[1].trim();
        }
      }
      if (existing.title) {
        existing.title = existing.title.replace(/<[^>]+>/g, '').trim();
      }
    }

    if (!existing.dur) {
      const durM = chunk.match(/fa-clock[^>]*><\/i>&nbsp;([^<]+)<\/div>/i);
      if (durM && durM[1].trim()) existing.dur = durM[1].trim();
    }

    if (!existing.streamUrl) {
      const prevM = chunk.match(/data-preview=["']([^"']+)["']/i);
      if (prevM) {
        const cleaned = cleanM3u8Url(prevM[1].trim());
        if (cleaned) {
          existing.streamUrl = cleaned;
          setPlayCache(vid, cleaned);
        }
      }
    }

    byVid.set(vid, existing);
  }

  for (const item of byVid.values()) {
    const title = item.title || `正片_${item.vid}`;
    const remarks = formatRemarks('蝴蝶影视', item.dur || 'HD');
    const rawPayload = `${item.vid}@@@${encodeURIComponent(item.streamUrl)}@@@${encodeURIComponent(title)}`;
    cardList.push({
      vod_id: rawPayload,
      vod_name: title,
      vod_pic: item.pic,
      vod_remarks: remarks,
      style: CARD_STYLE,
    });
  }
  return cardList;
}

async function home(inReq, _outResp) {
  const res = await fetchHtml('/?video=1.html');
  const list = parseCards(res.text);
  return {
    class: CATEGORIES,
    filters: {},
    list,
    style: CARD_STYLE,
  };
}

async function category(inReq, _outResp) {
  const params = parseParams(inReq);
  const tid = String(params.id ?? params.tid ?? CATEGORIES[0]?.type_id ?? '').replace(/^\/+|\/+$/g, '');
  let page = parseInt(String(params.page ?? params.pg ?? '1').trim(), 10);
  if (!Number.isFinite(page) || page < 1) page = 1;

  let paramKey = 'fenlei';
  let paramVal = tid;
  if (tid.includes('/')) {
    const idx = tid.indexOf('/');
    paramKey = tid.slice(0, idx);
    paramVal = tid.slice(idx + 1);
  }

  const encVal = encodeURIComponent(paramVal);
  const targetUrl = page === 1
    ? `/?${paramKey}=${encVal}`
    : `/?${paramKey}=${encVal}-${page}.html`;

  const res = await fetchHtml(targetUrl);
  const cards = parseCards(res.text);
  const cardCount = cards.length;
  const hasMore = cardCount >= 10;
  const totalCount = hasMore ? page * cardCount + 100 : page * cardCount;

  return {
    page,
    pagecount: hasMore ? page + 1 : page,
    limit: cardCount > 0 ? cardCount : 20,
    total: totalCount,
    list: cards,
    style: CARD_STYLE,
  };
}

async function detail(inReq, _outResp) {
  const params = parseParams(inReq);
  const rawInput = params.ids ?? params.id ?? params.url ?? '';
  const rawId = Array.isArray(rawInput) ? String(rawInput[0] ?? '').trim() : String(rawInput).trim();

  let vid = rawId;
  let presetStreamUrl = '';
  let vodTitle = `${META.siteName} · 精彩正片`;

  if (rawId.includes('@@@')) {
    const parts = rawId.split('@@@');
    vid = parts[0];
    if (parts.length > 1 && parts[1]) {
      presetStreamUrl = multiPassDecodeUri(parts[1], 2);
    }
    if (parts.length > 2 && parts[2]) {
      vodTitle = multiPassDecodeUri(parts[2], 2);
    }
  } else {
    const mVid = rawId.match(/play-(\d+)-/i);
    if (mVid) vid = mVid[1];
  }

  const detailPath = /^https?:\/\//i.test(vid) ? vid : `/?play-${vid}-1-.html`;
  const res = await fetchHtml(detailPath);
  const htmlTxt = res.text || '';
  const mainSection = htmlTxt.includes('<div class="thumb">')
    ? htmlTxt.slice(0, htmlTxt.indexOf('<div class="thumb">'))
    : htmlTxt;

  if (vodTitle === `${META.siteName} · 精彩正片` && mainSection) {
    const h1M = mainSection.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || mainSection.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (h1M && h1M[1]) {
      const cleanT = h1M[1].replace(/<[^>]+>/g, '').trim();
      if (cleanT) vodTitle = cleanT;
    }
  }

  let streamUrl = '';
  const resolvedInfo = await resolvePlayStreamInfo(detailPath, vid, htmlTxt);
  if (resolvedInfo && resolvedInfo.url && isDirectMediaUrl(resolvedInfo.url)) {
    streamUrl = resolvedInfo.url;
  } else if (presetStreamUrl && isDirectMediaUrl(presetStreamUrl)) {
    streamUrl = presetStreamUrl;
    setPlayCache(vid, streamUrl);
  } else {
    streamUrl = detailPath;
  }

  let pic = '';
  const picSearchArea = mainSection || htmlTxt;
  for (const pat of [/data-original=["']([^"']+)["']/i, /data-src=["']([^"']+)["']/i, /poster=["']([^"']+)["']/i, /src=["']([^"']+)["']/i]) {
    const pM = picSearchArea.match(pat);
    if (pM && pM[1]) {
      const cand = pM[1].trim();
      if (cand && !cand.endsWith('logo.png') && !cand.endsWith('favicon.ico') && !cand.endsWith('.js')) {
        pic = resolveUrl(cand);
        break;
      }
    }
  }

  const episodes = [`正片$${streamUrl}@@@${encodeURIComponent(vodTitle)}`];

  const recItems = htmlTxt.split('<div class="thumb">');
  if (recItems.length > 1) {
    const seenRec = new Set([String(vid)]);
    let recIdx = 1;
    for (let i = 1; i < recItems.length; i++) {
      const chunk = recItems[i];
      const hrefM = chunk.match(/href=["']([^"']*play-(\d+)-1-\.html)["']/i);
      if (!hrefM) continue;
      const recVid = hrefM[2];
      if (seenRec.has(recVid)) continue;
      seenRec.add(recVid);

      let recTitle = '';
      const altM = chunk.match(/<img[^>]+alt=["']([^"']+)["']/i);
      if (altM && altM[1].trim()) {
        recTitle = altM[1].trim();
      } else {
        const infoM = chunk.match(/<div class="thumb-info">([\s\S]*?)<\/div>/i);
        recTitle = infoM ? infoM[1].trim() : `推荐${String(recIdx).padStart(2, '0')}`;
      }
      recTitle = recTitle.replace(/<[^>]+>/g, '').replace(/[\$#\r\n\t]+/g, '').trim().slice(0, 18);

      const prevM = chunk.match(/data-preview=["']([^"']+)["']/i);
      const recStream = prevM ? cleanM3u8Url(prevM[1].trim()) : '';
      if (recStream) {
        setPlayCache(recVid, recStream);
      }
      const targetPlay = recStream || `/?play-${recVid}-1-.html`;
      const prefix = String(recIdx).padStart(2, '0');
      episodes.push(`${prefix}·${recTitle}$${targetPlay}@@@${encodeURIComponent(recTitle)}`);
      recIdx++;
      if (recIdx > 24) break;
    }
  }

  const contentDesc = `🦋 蝴蝶影视专线直连 | ${vodTitle} | 官方交流群: @tvshare23`;
  const vod = {
    vod_id: rawId,
    vod_name: vodTitle,
    vod_pic: pic,
    vod_bg: pic,
    vod_background: pic,
    vod_banner: pic,
    vod_actor: META.brandActor,
    vod_director: META.brandDirector,
    vod_remarks: formatRemarks('蝴蝶影视', `全${episodes.length}部连播`),
    vod_content: contentDesc,
    vod_play_from: '蝴蝶专线',
    vod_play_url: episodes.join('#'),
  };

  return { list: [vod] };
}

function buildFastifyProxyUrl(inReq, targetStreamUrl, sid = '') {
  const host = inReq?.headers?.host || '127.0.0.1:9978';
  const proto = inReq?.headers?.['x-forwarded-proto'] || 'http';
  let prefix = inReq?.server?.prefix || '';
  if (!prefix) {
    const rawUrl = String(inReq?.raw?.url || inReq?.url || '').split('?')[0];
    prefix = rawUrl.replace(/\/play\/?$/i, '');
  }
  const cleanPrefix = String(prefix).replace(/\/+$/, '');
  const sp = new URLSearchParams();
  sp.set('url', targetStreamUrl);
  if (sid) sp.set('sid', sid);
  return `${proto}://${host}${cleanPrefix}/ssnnav_proxy?${sp.toString()}`;
}

async function play(inReq, _outResp) {
  const params = parseParams(inReq);
  const rawVal = String(params.id ?? params.url ?? '').trim();
  const forceProxy = params.proxy === '1' || params.proxy === true || params.proxy === 1;

  const { vid, target, descTitle } = sanitizeEpisodeTarget(rawVal);

  const playHeaders = {
    'User-Agent': DEFAULT_UA,
    'Referer': activeDomain.replace(/\/+$/, '') + '/',
  };

  const resolvedInfo = await resolvePlayStreamInfo(target, vid);
  if (resolvedInfo && resolvedInfo.url && isDirectMediaUrl(resolvedInfo.url)) {
    const finalUrl =
      resolvedInfo.requiresProxy || forceProxy
        ? buildFastifyProxyUrl(inReq, resolvedInfo.url, resolvedInfo.sid || '')
        : resolvedInfo.url;
    const out = {
      parse: 0,
      jx: 0,
      playUrl: '',
      url: finalUrl,
      header: playHeaders,
      headers: playHeaders,
    };
    if (descTitle) out.desc = descTitle;
    return out;
  }

  const fallbackUrl = resolveUrl(target);
  const out = {
    parse: 1,
    jx: 0,
    playUrl: '',
    url: fallbackUrl,
    header: playHeaders,
    headers: playHeaders,
  };
  if (descTitle) out.desc = descTitle;
  return out;
}

async function search(inReq, _outResp) {
  const params = parseParams(inReq);
  const key = String(params.wd ?? params.key ?? params.keyword ?? '').trim();
  let page = parseInt(String(params.page ?? params.pg ?? '1').trim(), 10);
  if (!Number.isFinite(page) || page < 1) page = 1;

  if (!key) {
    return { page: 1, pagecount: 1, limit: 20, total: 0, list: [] };
  }

  const encKey = encodeURIComponent(key);
  const searchUrl = page === 1
    ? `/?search=${encKey}`
    : `/?search=${encKey}-${page}.html`;

  const res = await fetchHtml(searchUrl);
  const cards = parseCards(res.text);
  const cardCount = cards.length;
  const hasMore = cardCount >= 10;
  const totalCount = hasMore ? page * cardCount + 100 : page * cardCount;

  return {
    page,
    pagecount: hasMore ? page + 1 : page,
    limit: cardCount > 0 ? cardCount : 20,
    total: totalCount,
    list: cards,
    style: CARD_STYLE,
  };
}

async function proxyPicHandler(query) {
  const picUrl = query?.url || '';
  if (!picUrl) return { mime: 'text/plain', data: 'Missing url' };
  try {
    const fullUrl = resolveUrl(picUrl);
    const resp = await req.get(fullUrl, {
      headers: buildHeaders(fullUrl),
      timeout: 10000,
      responseType: 'arraybuffer',
    });
    const data = resp?.data ?? resp?.body ?? Buffer.alloc(0);
    const mime = resp?.headers?.['content-type'] || 'image/jpeg';
    return { mime, data: Buffer.isBuffer(data) ? data : Buffer.from(data) };
  } catch (_) {
    return { mime: 'text/plain', data: 'Proxy error' };
  }
}

async function proxyStreamHandler(request, reply) {
  const query = request?.query || {};
  const rawUrl = query.url || '';
  const sid = query.sid || '';
  const segType = query.type || '';
  if (!rawUrl) {
    return reply.code(400).type('text/plain').send('Missing stream url');
  }

  const session = sid ? STREAM_SESSION_CACHE.get(sid) : null;
  const targetUrl = resolveUrl(rawUrl);
  const headers = buildHeaders(targetUrl);
  if (request?.headers?.range) {
    headers.Range = request.headers.range;
  }

  try {
    const resp = await req.get(targetUrl, {
      headers,
      timeout: 15000,
      responseType: 'arraybuffer',
    });
    let buf = Buffer.isBuffer(resp?.data) ? resp.data : Buffer.from(resp?.data ?? '');

    if (segType === 'ts' || /\.ts(?:$|\?)/i.test(targetUrl)) {
      return reply.type('video/mp2t').send(buf);
    }

    if (/\.m3u8(?:$|\?)/i.test(targetUrl)) {
      const text = buf.toString('utf-8');
      const host = request?.headers?.host || '127.0.0.1:9978';
      const proto = request?.headers?.['x-forwarded-proto'] || 'http';
      const prefix = String(request?.raw?.url || request?.url || '').split('?')[0];
      const rewritten = text
        .split(/\r?\n/)
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          const absSeg = resolveUrl(trimmed, targetUrl);
          return `${proto}://${host}${prefix}?url=${encodeURIComponent(absSeg)}&type=ts`;
        })
        .join('\n');
      return reply.type('application/vnd.apple.mpegurl').send(rewritten);
    }

    if (session && session.key) {
      let offset = 0;
      const rangeHeader = request?.headers?.range || '';
      const rm = rangeHeader.match(/bytes=(\d+)-/i);
      if (rm) offset = parseInt(rm[1], 10) || 0;
      const blockIndex = Math.floor(offset / 16);
      const byteOffsetInBlock = offset % 16;
      const counterBuf = Buffer.alloc(16, 0);
      counterBuf.writeBigUInt64BE(BigInt(blockIndex), 8);
      const decipher = crypto.createDecipheriv('aes-128-ctr', session.key, counterBuf);
      if (byteOffsetInBlock > 0) {
        decipher.update(Buffer.alloc(byteOffsetInBlock, 0));
      }
      buf = Buffer.concat([decipher.update(buf), decipher.final()]);
    }

    return reply.type('video/mp4').send(buf);
  } catch (_) {
    return reply.code(502).type('text/plain').send('Stream proxy error');
  }
}

export default {
  meta: {
    key: 'ssnnav',
    name: META.siteName,
    type: 3,
  },
  api: async (fastify) => {
    fastify.post('/init', async () => ({}));
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/ssnnav_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
    fastify.get('/ssnnav_proxy', proxyStreamHandler);
  },
};