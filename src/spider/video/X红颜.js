import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

const SITE_NAME = 'X红颜';
const SITE_KEY = 'xhongyan';
const SITE_DOMAINS = [
  'https://xhongyan.com',
  'https://www.xhongyan.com',
];
let activeDomain = SITE_DOMAINS[0];

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const BRAND_NAME = '蝴蝶影视';
const BRAND_ACTOR = '🦋 TG群: @tvshare23';
const BRAND_DIRECTOR = '🦋 蝴蝶影视';
const DESC_CONTENT = '🦋 蝴蝶影视专线直连 | 极速硬解秒播 | 官方交流群: @tvshare23';
const CARD_STYLE = { type: 'rect', ratio: 1.78 };

const STREAM_EXTS = ['.m3u8', '.mp4', '.flv', '.mkv', '.avi', '.ts', '.mpd'];
const BAD_STREAM_KEYWORDS = [
  'preview.mp4',
  'sample.mp4',
  'trailer.mp4',
  'top_banner',
  'native-ad',
  'stat.php',
];
const NOISE_TITLES = new Set([
  '上一集',
  '下一集',
  '上集',
  '下集',
  '上一页',
  '下一页',
  '影片收藏',
  '下载视频',
  '立即播放',
  '播放',
  '收藏',
  '首页',
]);

const ALL_TAGS_RAW = [
  '后入', '高颜值', '骑乘', '口交', '巨乳', '黑丝', '反差', '少妇', '大屁股', '自慰',
  '情侣', '女大学生', '人妻', '吃鸡', '粉嫩', '御姐', '内射', '假屁股', '白虎', '开裆',
  '美鲍', '清纯', '母狗', '玩具', '足交', '白丝', '白浆', '开苞', '露脸', '深喉',
  '3P', '调教', '群P', '吞精', '潮吹', '熟女', '女优', '高潮', 'JK', '偷拍',
  '制服', '女同', '女奴', '幼女', '户外', '无套', '极品', '混血', '直播', '紧致',
  '网袜', '肛交', '自拍', '肥臀', '萝莉', '迷奸', '野战', '金发', '双飞', '嫩妹',
  '学生', '家庭', '强奸', '拘束', '捆绑', '援交', '极品尤物', '水多', '泄密', '漫展',
  '狗趴', '猫娘', '眼镜', '短裙', '空姐', '粗口', '纯情', '绑架', '网吧', '美乳',
  '美腿', '肉丝', '肛塞', '肥美', '自慰流白浆', '舞蹈', '蕾丝', '虐待', '虐恋', '被草',
  '裹胸', '裙底', '西装', '诱惑', '车震', '轮奸', '迷倒', '透视', '针管', '销魂',
  '阴蒂', '隔壁', '露奶', '露点', '青涩', '飞机', '马尾', '高跟', '高跟鞋', '黄播',
  '黑人', '黑皮', 'SM', 'SWAG', 'andmlove', 'cosplay', 'chinese_bunny', 'jk_0571',
  'littlesula', 'npxvip', 'saku_j', 'miulino', 'kiki', 'Lin', '19cmfuck18girl',
  'Hime_Tsu', 'LizyhS', 'Miuzxc', 'sunwall95', 'yui_xin_tw', 'Nami-OP', 'Suxuuul7',
  'Candlelight', 'HongKongDoll', 'love_n_s', 'RemuKira', 'Selen_S', 'XJX191',
  '上门', '下面有根棒棒糖', '不穿学姐', '乳交', '乳射', '交友', '代驾', '体型差',
  '体验生', '保洁', '假身', '侦探', '前女友', '包养', '北京小猫', '原神', '双性恋',
  '可爱', '台湾', '叫声小妹', '喷水', '喷射', '外国', '大奶', '女仆', '女教师',
  '女老师', '女神童童', '嫂子', '客房', '宿舍', '密友', '小Q小K', '小可爱', '小姨子',
  '小摇钱树', '小极品', '小猫', '少女', '尤物', '巨臀', '性爱魔盒', '情窦初开', '恋爱',
  '恶魔', '截击', '打拳', '找乐子', '报恩', '护士', '抽插', '按摩', '捷克', '探花',
  '接客', '教师', '撕烂', '新婚', '旅拍', '旅馆', '日韩', '早泄', '明星', '暗访',
  '木下日和', '极品女大', '极品女神', '极品少妇', '极品萝莉', '极品身材', '档案', '模特',
  '母子', '水疗', '求饶', '汗蒸', '沙发', '泰妹', '洋妞', '洗澡', '洛丽塔', '润滑',
  '清纯小妹', '温泉', '浴室', '满足', '潜规则', '激战', '激情', '潮喷', '爆乳', '爱液',
  '父女', '特殊', '狂操', '猛男', '玄关', '玩偶姐姐', '珍珠', '瑜伽', '男模', '痴女',
  '硬汉', '神似', '私拍', '穿刺', '童颜', '精灵', '糖心', '红唇', '约炮', '纽扣',
  '绳艺', '缅甸', '网拍', '美容院', '群交', '考研', '聘请', '胖次', '肉便器', '背德',
  '脱衣', '自曝', '舌吻', '艳母', '艾薇', '花魁', '苗条', '萌妹', '蓝天', '藤森里穗',
  '虐杀', '表妹', '裂帛', '裸聊', '警花', '诱人', '课后', '调情', '豪乳', '轮番',
  '迷醉', '透光', '酷刑', '醉酒', '野外', '金丝雀', '金莲', '钓鱼', '钢琴', '锁精',
  '闺蜜', '阳光', '阴毛', '隐秘', '雨衣', '韩漫', '音乐', '风情', '首尔', '香艳',
  '骚母狗', '魅魔', '麻豆', '黑吊', '黑帮', '黑料',
];

const PLAY_CACHE = new Map();
const PLAY_CACHE_TTL = 10 * 60 * 1000;

let spiderOptions = {};

function setPlayCache(key, value) {
  if (!key || !value) return;
  PLAY_CACHE.set(String(key), { value, ts: Date.now() });
}

function getPlayCache(key) {
  if (!key) return '';
  const entry = PLAY_CACHE.get(String(key));
  if (!entry) return '';
  if (Date.now() - entry.ts > PLAY_CACHE_TTL) {
    PLAY_CACHE.delete(String(key));
    return '';
  }
  return entry.value;
}

function unescapeHtml(text) {
  let s = String(text || '');
  if (!s.includes('&') && !s.includes('\\u') && !s.includes('\\x')) return s;
  s = s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#0*38;/gi, '&')
    .replace(/&amp;/gi, '&');
  return s;
}

function formatRemarks(brand = BRAND_NAME, meta = '') {
  const cleanMeta = String(meta || '').replace(/[\r\n\t]+/g, ' ').trim();
  return cleanMeta ? `${brand} | ${cleanMeta}` : brand;
}

function cleanLabel(text) {
  let t = String(text || '').trim();
  t = t.replace(/<[^>]+>/g, ' ');
  t = unescapeHtml(t);
  t = t.replace(/[\r\n\t$#]+/g, ' ');
  t = t.replace(/\s{2,}/g, ' ');
  return t.trim();
}

function cleanPic(url) {
  const u = String(url || '').trim().replace(/\\\//g, '/');
  if (!u || u.startsWith('data:') || u.startsWith('about:') || u.startsWith('javascript:')) {
    return '';
  }
  const low = u.toLowerCase();
  const badList = ['lazyload', 'loading', 'placeholder', 'blank.gif', 'wechat-tip', '/logo'];
  for (const bad of badList) {
    if (low.includes(bad)) return '';
  }
  return u;
}

function fixedInt(value, defaultVal = 1) {
  const n = parseInt(String(value ?? defaultVal).trim(), 10);
  return Number.isFinite(n) && n >= 1 ? n : defaultVal;
}

function absUrl(url, baseDomain = activeDomain) {
  const u = String(url || '').trim().replace(/\\\//g, '/');
  if (!u) return '';
  if (u.startsWith('//')) return `https:${u}`;
  if (!/^https?:\/\//i.test(u)) {
    const base = String(baseDomain || activeDomain).replace(/\/+$/, '');
    return u.startsWith('/') ? `${base}${u}` : `${base}/${u}`;
  }
  return u;
}

function isKnownSiteHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return false;
  return SITE_DOMAINS.some((d) => {
    try {
      return new URL(d).hostname.toLowerCase() === h;
    } catch {
      return false;
    }
  });
}

function expandCandidateUrls(targetUrl) {
  const raw = String(targetUrl || '').trim().replace(/\\\//g, '/');
  if (!raw) return [];
  const domains = [activeDomain, ...SITE_DOMAINS.filter((d) => d !== activeDomain)];

  if (!/^https?:\/\//i.test(raw) && !raw.startsWith('//')) {
    const rel = raw.startsWith('/') ? raw : `/${raw}`;
    return domains.map((d) => `${d.replace(/\/+$/, '')}${rel}`);
  }

  const normalized = raw.startsWith('//') ? `https:${raw}` : raw;
  try {
    const parsed = new URL(normalized);
    if (isKnownSiteHost(parsed.hostname)) {
      const pathAndQuery = `${parsed.pathname}${parsed.search}`;
      const list = domains.map((d) => `${d.replace(/\/+$/, '')}${pathAndQuery}`);
      if (!list.includes(normalized)) list.unshift(normalized);
      return [...new Set(list)];
    }
  } catch {
    // ignore parse failure
  }
  return [normalized];
}

function decodeResponseBuffer(buf, headers = {}) {
  if (!buf) return '';
  if (typeof buf === 'string') return buf;
  let raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const enc = String(headers['content-encoding'] || headers['Content-Encoding'] || '').toLowerCase();

  try {
    if ((raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) || enc.includes('gzip')) {
      raw = zlib.gunzipSync(raw);
    } else if (enc.includes('deflate')) {
      try {
        raw = zlib.inflateSync(raw);
      } catch {
        raw = zlib.inflateRawSync(raw);
      }
    }
  } catch {
    // fallback to raw bytes
  }

  const utf8Text = raw.toString('utf8');
  if (utf8Text.includes('\ufffd')) {
    try {
      const gbkDecoder = new TextDecoder('gbk');
      return gbkDecoder.decode(raw);
    } catch {
      return utf8Text;
    }
  }
  return utf8Text;
}

function looksLikeValidSiteHtml(text) {
  if (!text || typeof text !== 'string') return false;
  return (
    /\/vod\/(?:play|detail|show|type|search)\//i.test(text) ||
    /player_[a-zA-Z0-9_]+|mac_player|player_data|player_config/i.test(text) ||
    /\.(?:m3u8|mp4|flv)\b/i.test(text) ||
    /<video\b|<iframe\b|id=["']Duration["']/i.test(text)
  );
}

async function fetchPage(targetUrl, options = {}) {
  const candidates = expandCandidateUrls(targetUrl);
  if (!candidates.length) {
    return { code: 0, text: '', bytes: Buffer.alloc(0), err: 'empty_url', finalUrl: '' };
  }

  let lastError = '';
  for (const candidate of candidates) {
    let origin = activeDomain;
    try {
      origin = new URL(candidate).origin;
    } catch {
      origin = activeDomain;
    }

    let referer = options.referer ? absUrl(options.referer, origin) : `${origin}/`;
    try {
      const refUrl = new URL(referer);
      if (isKnownSiteHost(refUrl.hostname)) {
        referer = `${origin}${refUrl.pathname}${refUrl.search}`;
      }
    } catch {
      referer = `${origin}/`;
    }

    const headers = {
      'User-Agent': DEFAULT_UA,
      Referer: referer,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Connection: 'keep-alive',
      ...(options.headers || {}),
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const reqOpts = {
          method: options.data ? 'POST' : 'GET',
          headers,
          timeout: options.timeout || 10000,
        };
        if (options.data) {
          if (typeof options.data === 'object' && !Buffer.isBuffer(options.data)) {
            reqOpts.data = new URLSearchParams(options.data).toString();
            reqOpts.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
            reqOpts.headers['X-Requested-With'] = 'XMLHttpRequest';
          } else {
            reqOpts.data = options.data;
          }
        }
        if (options.buffer) {
          reqOpts.buffer = 2;
        }

        const resp = await req(candidate, reqOpts);
        const status = Number(resp?.status ?? resp?.statusCode ?? 200);
        const rawData = resp?.data ?? resp?.body ?? '';
        const bytes = Buffer.isBuffer(rawData)
          ? rawData
          : typeof rawData === 'string'
            ? Buffer.from(rawData)
            : Buffer.from(JSON.stringify(rawData));
        const text =
          typeof rawData === 'string'
            ? rawData
            : decodeResponseBuffer(bytes, resp?.headers || {});

        if (status >= 200 && status < 400 && (options.buffer || text.trim().length > 0)) {
          if (isKnownSiteHost(new URL(candidate).hostname) && looksLikeValidSiteHtml(text)) {
            activeDomain = origin;
          }
          return {
            code: status,
            text,
            bytes,
            headers: resp?.headers || {},
            err: '',
            finalUrl: resp?.url || candidate,
          };
        }
        lastError = `HTTP ${status}`;
      } catch (err) {
        lastError = String(err?.message || err || 'request_error');
      }
    }
  }

  return {
    code: -1,
    text: '',
    bytes: Buffer.alloc(0),
    err: lastError || 'timeout',
    finalUrl: candidates[0] || '',
  };
}

function unwrapParams(inReq) {
  const merged = {};
  const sources = [inReq?.params, inReq?.query, inReq?.body];
  for (const src of sources) {
    if (!src) continue;
    if (typeof src === 'string') {
      const trimmed = src.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          Object.assign(merged, JSON.parse(trimmed));
          continue;
        } catch {
          // fall through to URLSearchParams
        }
      }
      try {
        for (const [k, v] of new URLSearchParams(trimmed).entries()) {
          merged[k] = v;
        }
      } catch {
        // ignore
      }
    } else if (typeof src === 'object') {
      Object.assign(merged, src);
    }
  }
  return merged;
}

function isDirectMediaUrl(url) {
  const raw = String(url || '').trim().replace(/\\\//g, '/');
  if (!raw) return false;
  const low = raw.toLowerCase();
  if (BAD_STREAM_KEYWORDS.some((bad) => low.includes(bad))) {
    return false;
  }
  if (low.includes('/upload/vod_file/')) {
    return true;
  }
  try {
    const parsed = new URL(raw.startsWith('//') ? `https:${raw}` : raw, activeDomain);
    const pathname = parsed.pathname.toLowerCase();
    if (STREAM_EXTS.some((ext) => pathname.endsWith(ext))) {
      return true;
    }
    // Check if pathname contains stream extension and query is not a wrapper player
    if (
      !/\.(?:html?|php|jsp|asp)$/i.test(pathname) &&
      STREAM_EXTS.some((ext) => low.includes(ext))
    ) {
      return true;
    }
    return false;
  } catch {
    return STREAM_EXTS.some((ext) => low.includes(ext));
  }
}

function jsUnescape(str) {
  let s = String(str || '');
  s = s.replace(/%u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  try {
    return decodeURIComponent(s);
  } catch {
    return s.replace(/%([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
}

function unwrapNestedPlayerUrl(rawUrl, baseDomain = activeDomain) {
  let u = unescapeHtml(String(rawUrl || '').trim().replace(/\\\//g, '/'));
  if (!u) return '';

  for (let pass = 0; pass < 2; pass++) {
    try {
      const parsed = new URL(u.startsWith('//') ? `https:${u}` : u, baseDomain);
      const pathname = parsed.pathname.toLowerCase();
      const isDirectPath =
        STREAM_EXTS.some((ext) => pathname.endsWith(ext)) ||
        pathname.includes('/upload/vod_file/');
      if (!isDirectPath) {
        for (const paramKey of ['url', 'v', 'vid', 'src', 'file', 'play_url']) {
          const inner = parsed.searchParams.get(paramKey);
          if (inner) {
            let decoded = inner.trim();
            for (let i = 0; i < 2; i++) {
              const next = jsUnescape(decoded);
              if (next === decoded) break;
              decoded = next;
            }
            if (
              /^https?:\/\//i.test(decoded) ||
              decoded.startsWith('//') ||
              decoded.startsWith('/') ||
              STREAM_EXTS.some((ext) => decoded.toLowerCase().includes(ext))
            ) {
              u = decoded;
              break;
            }
          }
        }
      }
    } catch {
      break;
    }
  }
  return u;
}

function sliceBalancedJson(text, startIdx) {
  let depth = 0;
  let inStr = false;
  let quoteChar = '';
  let esc = false;

  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (ch === '\\') {
        esc = true;
      } else if (ch === quoteChar) {
        inStr = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quoteChar = ch;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIdx, i + 1);
      }
    }
  }
  return '';
}

function tryBase64Decode(input) {
  try {
    let clean = String(input || '').trim().replace(/\s+/g, '');
    if (!clean) return '';
    const pad = clean.length % 4;
    if (pad) clean += '='.repeat(4 - pad);
    const decoded = Buffer.from(clean, 'base64').toString('utf8');
    return decoded;
  } catch {
    return '';
  }
}

function looksLikePlausibleStreamOrUrl(cand) {
  const s = String(cand || '').trim();
  if (!s) return false;
  if (/^(?:https?:)?\/\//i.test(s) || s.startsWith('/')) return true;
  return STREAM_EXTS.some((ext) => s.toLowerCase().includes(ext));
}

function decodeCmsPlayerUrl(rawUrl, encrypt = '0') {
  let u = unescapeHtml(String(rawUrl || '').trim().replace(/\\\//g, '/'));
  if (!u) return '';
  const enc = String(encrypt ?? '0').trim();

  if (enc === '1') {
    const unescaped = jsUnescape(u);
    if (looksLikePlausibleStreamOrUrl(unescaped)) {
      u = unescaped;
    } else {
      const b64 = jsUnescape(tryBase64Decode(u));
      if (looksLikePlausibleStreamOrUrl(b64)) {
        u = b64;
      } else {
        u = unescaped;
      }
    }
  } else if (enc === '2') {
    // Support both standard MacCMS v10 base64(escape(url)) and reversed-base64 from custom templates
    const stdDecoded = jsUnescape(tryBase64Decode(u));
    if (looksLikePlausibleStreamOrUrl(stdDecoded)) {
      u = stdDecoded;
    } else {
      const revStr = u.split('').reverse().join('');
      const revDecoded = jsUnescape(tryBase64Decode(revStr));
      if (looksLikePlausibleStreamOrUrl(revDecoded)) {
        u = revDecoded;
      } else if (stdDecoded) {
        u = stdDecoded;
      }
    }
  }

  u = unescapeHtml(u.replace(/\\\//g, '/')).trim();
  return unwrapNestedPlayerUrl(u);
}

function unpackDeanEdwards(htmlText) {
  const unpackedBlocks = [];
  const regex =
    /eval\(\s*function\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)\s*\{[\s\S]*?\}\s*\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;

  let m;
  while ((m = regex.exec(htmlText)) !== null) {
    const payload = m[2];
    const radix = parseInt(m[3], 10);
    const count = parseInt(m[4], 10);
    const symtab = m[6].split('|');
    if (!radix || !count || !symtab.length) continue;

    const encodeBase = (num, base) => {
      const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      if (num < base) return num < 36 ? num.toString(36) : chars[num];
      return encodeBase(Math.floor(num / base), base) + (num % base < 36 ? (num % base).toString(36) : chars[num % base]);
    };

    const dict = new Map();
    for (let i = count - 1; i >= 0; i--) {
      const key = encodeBase(i, radix);
      dict.set(key, symtab[i] || key);
    }

    const unpacked = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (word) =>
      dict.has(word) ? dict.get(word) : word
    );
    unpackedBlocks.push(unpacked);
  }
  return unpackedBlocks;
}

function extractStreamFromText(htmlText, baseDomain = activeDomain) {
  if (!htmlText) return '';

  const blocks = [htmlText, ...unpackDeanEdwards(htmlText)];
  for (const rawBlock of blocks) {
    const norm = unescapeHtml(
      rawBlock
        .replace(/\\\//g, '/')
        .replace(/\\u002F/gi, '/')
    );

    // Stage 1: Balanced-brace extraction for player_aaaa / mac_player / player_data / player_config
    const playerVarRegex = /(player_[a-zA-Z0-9_]+|mac_player|player_data|player_config)\s*=\s*\{/g;
    let pm;
    while ((pm = playerVarRegex.exec(norm)) !== null) {
      const braceStart = pm.index + pm[0].length - 1;
      const blob = sliceBalancedJson(norm, braceStart);
      if (!blob) continue;
      let cfg = null;
      try {
        cfg = JSON.parse(blob);
      } catch {
        try {
          const urlMatch = blob.match(/["']?(?:url|link)["']?\s*:\s*["']([^"']+)["']/i);
          const encMatch = blob.match(/["']?encrypt["']?\s*:\s*["']?(\d+)["']?/i);
          if (urlMatch) {
            cfg = { url: urlMatch[1], encrypt: encMatch ? encMatch[1] : '0' };
          }
        } catch {
          cfg = null;
        }
      }
      if (!cfg || typeof cfg !== 'object') continue;
      const cand = decodeCmsPlayerUrl(cfg.url || cfg.link || '', cfg.encrypt ?? '0');
      if (cand && (isDirectMediaUrl(cand) || cand.startsWith('/'))) {
        return absUrl(cand, baseDomain);
      }
    }

    // Stage 2: Priority JSON key patterns
    const relMediaMatch = norm.match(
      /["']url["']\s*:\s*["'](\/?[^"']+\.(?:mp4|m3u8|flv)[^"']*)["']/i
    );
    if (relMediaMatch && isDirectMediaUrl(relMediaMatch[1])) {
      return absUrl(unwrapNestedPlayerUrl(relMediaMatch[1], baseDomain), baseDomain);
    }

    const uploadMatch = norm.match(/["']url["']\s*:\s*["']([^"']+\/upload\/[^"']+)["']/i);
    if (uploadMatch) {
      const u = unwrapNestedPlayerUrl(uploadMatch[1], baseDomain);
      if (!BAD_STREAM_KEYWORDS.some((b) => u.toLowerCase().includes(b))) {
        return absUrl(u, baseDomain);
      }
    }

    const keyedMediaRegex =
      /["'](?:url|video|src|file|play_url|playUrl|videoUrl)["']\s*:\s*["']((?:https?:)?\/\/[^"']+?\.(?:m3u8|mp4|flv)[^"']*)["']/gi;
    let km;
    while ((km = keyedMediaRegex.exec(norm)) !== null) {
      const cand = unwrapNestedPlayerUrl(km[1], baseDomain);
      if (isDirectMediaUrl(cand)) {
        return absUrl(cand, baseDomain);
      }
    }

    // Stage 3: Full-text direct stream scan
    for (const ext of ['m3u8', 'mp4', 'flv']) {
      const extRegex = new RegExp(
        `((?:https?:)?\\/\\/[^\\s"'<>\\\\]+?\\.${ext}[^\\s"'<>\\\\]*)`,
        'gi'
      );
      let em;
      while ((em = extRegex.exec(norm)) !== null) {
        const cand = unwrapNestedPlayerUrl(em[1], baseDomain);
        if (isDirectMediaUrl(cand)) {
          return absUrl(cand, baseDomain);
        }
      }
    }
  }

  return '';
}

function extractIframeUrls(htmlText, baseDomain = activeDomain) {
  if (!htmlText) return [];
  const results = [];
  const iframeRegex = /<iframe\b([^>]*)>/gi;
  let m;
  while ((m = iframeRegex.exec(htmlText)) !== null) {
    const attrs = m[1] || '';
    for (const attr of ['data-litespeed-src', 'data-lazy-src', 'data-src', 'src']) {
      const am = attrs.match(new RegExp(`\\b${attr}=["']([^"']+)["']`, 'i'));
      if (am && am[1]) {
        const raw = unescapeHtml(am[1].trim());
        if (
          !raw ||
          raw.startsWith('about:') ||
          raw.startsWith('javascript:') ||
          raw.startsWith('data:')
        ) {
          continue;
        }
        results.push(absUrl(raw, baseDomain));
      }
    }
  }
  return [...new Set(results)];
}

async function resolveStreamFromHtml(htmlText, pageUrl, vid = '') {
  let baseDomain = activeDomain;
  try {
    baseDomain = new URL(pageUrl).origin;
  } catch {
    baseDomain = activeDomain;
  }

  // Direct / unpacked extraction from current HTML
  const direct = extractStreamFromText(htmlText, baseDomain);
  if (direct) return direct;

  // Check embedded iframe URLs (either wrapper query param or secondary fetch)
  const iframes = extractIframeUrls(htmlText, baseDomain);
  for (const iframeUrl of iframes) {
    const unwrapped = unwrapNestedPlayerUrl(iframeUrl, baseDomain);
    if (unwrapped !== iframeUrl && isDirectMediaUrl(unwrapped)) {
      return absUrl(unwrapped, baseDomain);
    }
    const iframeRes = await fetchPage(iframeUrl, { referer: pageUrl });
    if (iframeRes.text) {
      const iframeStream = extractStreamFromText(iframeRes.text, baseDomain);
      if (iframeStream) return iframeStream;
    }
  }

  // Fallback: discover alternative play routes from detail page if vid is known
  if (vid && /^\d+$/.test(String(vid))) {
    const altMatches = [
      ...htmlText.matchAll(
        new RegExp(`(?:/index\\.php)?/vod/play/id/${vid}/sid/(\\d+)/nid/(\\d+)\\.html`, 'gi')
      ),
    ];
    let routes = altMatches
      .map((m) => `/index.php/vod/play/id/${vid}/sid/${m[1]}/nid/${m[2]}.html`)
      .filter((r) => !pageUrl.endsWith(r));

    if (!routes.length) {
      const detailUrl = `/index.php/vod/detail/id/${vid}.html`;
      const detailRes = await fetchPage(detailUrl, { referer: pageUrl });
      if (detailRes.text) {
        const detailStream = extractStreamFromText(detailRes.text, baseDomain);
        if (detailStream) return detailStream;
        const dm = [
          ...detailRes.text.matchAll(
            new RegExp(`(?:/index\\.php)?/vod/play/id/${vid}/sid/(\\d+)/nid/(\\d+)\\.html`, 'gi')
          ),
        ];
        routes = dm
          .map((m) => `/index.php/vod/play/id/${vid}/sid/${m[1]}/nid/${m[2]}.html`)
          .filter((r) => !pageUrl.endsWith(r));
      }
    }

    const uniqueRoutes = [...new Set(routes)].slice(0, 3);
    for (const route of uniqueRoutes) {
      const altRes = await fetchPage(route, { referer: pageUrl });
      if (altRes.text) {
        const altStream = extractStreamFromText(altRes.text, baseDomain);
        if (altStream) return altStream;
      }
    }
  }

  return '';
}

function extractPicFromScope(scope, baseDomain = activeDomain) {
  if (!scope) return '';
  for (const attr of [
    'data-original',
    'data-src',
    'data-lazy-src',
    'data-litespeed-src',
    'data-echo',
    'src',
  ]) {
    const m = scope.match(new RegExp(`\\b${attr}=["']([^"']+)["']`, 'i'));
    if (m && m[1]) {
      const cand = cleanPic(unescapeHtml(m[1]));
      if (cand) return absUrl(cand, baseDomain);
    }
  }

  let bgMatch = scope.match(/background-image\s*:\s*url\(\s*(?:&quot;|['"])?([^'")&]+)/i);
  if (!bgMatch) {
    bgMatch = scope.match(/background-image\s*:\s*url\(\s*['"]?([^'")]+)/i);
  }
  if (bgMatch && bgMatch[1]) {
    let cand = bgMatch[1].trim().replace(/&quot;/gi, '').replace(/["']/g, '');
    if (cand.includes('%22')) {
      const seg = cand.split('%22');
      if (seg.length > 1 && seg[1].trim()) {
        cand = seg[1].trim();
      }
    }
    cand = cleanPic(unescapeHtml(cand));
    if (cand) return absUrl(cand, baseDomain);
  }
  return '';
}

function parseCardList(htmlText, baseDomain = activeDomain) {
  const cards = [];
  if (!htmlText) return cards;

  // Group anchors by video ID to support both single-anchor and split-anchor templates
  const grouped = new Map();
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRegex.exec(htmlText)) !== null) {
    const attrs = m[1] || '';
    const inner = m[2] || '';
    const scope = `${attrs} ${inner}`;

    let idMatch = scope.match(
      /href=["'](?:\S*?(?:\/index\.php)?\/vod\/play\/id\/(\d+)\/sid\/\d+\/nid\/\d+\.html)["']/i
    );
    if (!idMatch) {
      idMatch = scope.match(/\/vod\/(?:play|detail)\/id\/(\d+)/i);
    }
    if (!idMatch) continue;

    const vid = idMatch[1];
    if (!grouped.has(vid)) {
      grouped.set(vid, { vid, scopes: [] });
    }
    grouped.get(vid).scopes.push(scope);
  }

  for (const { vid, scopes } of grouped.values()) {
    const combinedScope = scopes.join(' ');
    const picUrl = extractPicFromScope(combinedScope, baseDomain);

    const alts = [];
    const altRegex = /\balt=["']([^"']*)["']/gi;
    let am;
    while ((am = altRegex.exec(combinedScope)) !== null) {
      const t = cleanLabel(am[1]);
      if (t && t.length >= 2 && !NOISE_TITLES.has(t)) {
        alts.push(t);
      }
    }

    let rawTitle = '';
    if (alts.length > 0) {
      rawTitle = alts.reduce((a, b) => (b.length > a.length ? b : a), '');
    }
    if (!rawTitle) {
      const spanMatch = combinedScope.match(
        /<span[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
      );
      if (spanMatch) {
        rawTitle = cleanLabel(spanMatch[1]);
      }
    }
    if (!rawTitle) {
      const titleAttrMatch = combinedScope.match(/\btitle=["']([^"']+)["']/i);
      if (titleAttrMatch) {
        const cand = cleanLabel(titleAttrMatch[1]);
        if (cand && !NOISE_TITLES.has(cand)) rawTitle = cand;
      }
    }
    if (!rawTitle) {
      for (const sc of scopes) {
        const innerText = cleanLabel(sc.replace(/^[^>]*>/, ''));
        if (innerText && innerText.length >= 2 && !NOISE_TITLES.has(innerText)) {
          rawTitle = innerText;
          break;
        }
      }
    }
    if (!rawTitle) continue;

    let durRem = '';
    const durSpanMatch = combinedScope.match(/id=["']Duration["'][^>]*>([\s\S]*?)<\/span>/i);
    if (durSpanMatch) {
      durRem = cleanLabel(durSpanMatch[1]);
    }
    if (!durRem) {
      const dm = combinedScope.match(/(\d{1,3}:\d{2}(?::\d{2})?)/);
      if (dm) durRem = dm[1];
    }
    if (!durRem) {
      const remMatch = combinedScope.match(/(\d{2}-\d{2})/);
      if (remMatch) durRem = remMatch[1];
    }

    cards.push({
      vod_id: vid,
      vod_name: rawTitle,
      vod_pic: picUrl,
      vod_remarks: formatRemarks(BRAND_NAME, durRem),
      style: { ...CARD_STYLE },
    });
  }

  return cards;
}

function buildHomeMetadata(includeFilters = true) {
  const classes = [
    { type_id: 'new', type_name: '🔥 最新上架' },
    { type_id: 'cat_4', type_name: '💃 素人业余' },
    { type_id: 'cat_1', type_name: '🌟 网红私房' },
    { type_id: 'cat_2', type_name: '🔞 网黄认证' },
    { type_id: 'cat_3', type_name: '🎬 品牌专区' },
    { type_id: 'tags', type_name: '🏷️ 标签大全' },
  ];

  const result = { class: classes, style: { ...CARD_STYLE } };
  if (!includeFilters) return result;

  const sortOptions = [
    { n: '最新上架', v: 'time' },
    { n: '人气最高', v: 'hits' },
  ];

  const tagOptions = [];
  const seenTags = new Set();
  for (const t of ALL_TAGS_RAW) {
    if (t && !seenTags.has(t)) {
      seenTags.add(t);
      tagOptions.push({ n: t, v: t });
    }
  }

  result.filters = {
    new: [{ key: 'by', name: '排序', value: sortOptions }],
    cat_4: [{ key: 'by', name: '排序', value: sortOptions }],
    cat_1: [{ key: 'by', name: '排序', value: sortOptions }],
    cat_2: [{ key: 'by', name: '排序', value: sortOptions }],
    cat_3: [{ key: 'by', name: '排序', value: sortOptions }],
    tags: [
      { key: 'tag', name: '标签', value: tagOptions },
      { key: 'by', name: '排序', value: sortOptions },
    ],
  };

  return result;
}

async function init(inReq) {
  const params = unwrapParams(inReq);
  const ext = params.extend ?? params.ext ?? {};
  if (typeof ext === 'string' && ext.trim()) {
    try {
      spiderOptions = JSON.parse(ext);
    } catch {
      spiderOptions = {};
    }
  } else if (ext && typeof ext === 'object') {
    spiderOptions = { ...ext };
  }
  return {};
}

async function home(inReq) {
  const params = unwrapParams(inReq);
  const includeFilter = params.filter !== false && params.filter !== 'false';
  const result = buildHomeMetadata(includeFilter);

  let res = await fetchPage('/index.php/label/new.html');
  let cards = parseCardList(res.text);
  if (!cards.length) {
    res = await fetchPage('/');
    cards = parseCardList(res.text);
  }
  result.list = cards.slice(0, 24);
  return result;
}

async function category(inReq) {
  const params = unwrapParams(inReq);
  const tidStr = String(params.id ?? params.tid ?? params.type_id ?? 'new').trim();
  const page = fixedInt(params.page ?? params.pg ?? 1, 1);

  let ext = params.filters ?? params.extend ?? params.ext ?? {};
  if (typeof ext === 'string' && ext.trim()) {
    try {
      ext = JSON.parse(ext);
    } catch {
      ext = {};
    }
  }
  const sortBy = String(ext?.by ?? params.by ?? '').trim();
  const selTag = String(ext?.tag ?? params.tag ?? '').trim();

  let url = '';
  if (tidStr === 'new') {
    if (page <= 1 && (!sortBy || sortBy === 'time')) {
      url = '/index.php/label/new.html';
    } else {
      const byVal = sortBy === 'hits' ? 'hits' : 'time';
      url =
        page <= 1
          ? `/index.php/vod/show/by/${byVal}/id/0.html`
          : `/index.php/vod/show/by/${byVal}/id/0/page/${page}.html`;
    }
  } else if (tidStr.startsWith('cat_')) {
    const cid = tidStr.replace('cat_', '');
    if (sortBy === 'time' || sortBy === 'hits') {
      url =
        page <= 1
          ? `/index.php/vod/show/by/${sortBy}/id/${cid}.html`
          : `/index.php/vod/show/by/${sortBy}/id/${cid}/page/${page}.html`;
    } else {
      url =
        page <= 1
          ? `/index.php/vod/type/id/${cid}.html`
          : `/index.php/vod/type/id/${cid}/page/${page}.html`;
    }
  } else if (tidStr === 'tags') {
    const targetTag = selTag || '后入';
    const tagQuoted = encodeURIComponent(targetTag);
    url =
      page <= 1
        ? `/index.php/vod/search/tag/${tagQuoted}.html`
        : `/index.php/vod/search/page/${page}/tag/${tagQuoted}.html`;
  } else {
    url =
      page <= 1
        ? `/index.php/vod/type/id/${tidStr}.html`
        : `/index.php/vod/type/id/${tidStr}/page/${page}.html`;
  }

  const res = await fetchPage(url);
  let cards = parseCardList(res.text);

  if (!cards.length && tidStr.startsWith('cat_')) {
    const cid = tidStr.replace('cat_', '');
    const altUrl =
      page <= 1
        ? `/index.php/vod/show/id/${cid}.html`
        : `/index.php/vod/show/id/${cid}/page/${page}.html`;
    const resAlt = await fetchPage(altUrl);
    cards = parseCardList(resAlt.text);
  }

  const totalPages = cards.length >= 15 ? page + 1 : page;
  return {
    page,
    pagecount: totalPages,
    limit: 20,
    total: cards.length >= 15 ? 999 : page * 20,
    list: cards,
  };
}

async function detail(inReq) {
  const params = unwrapParams(inReq);
  const rawIds = params.ids ?? params.id ?? params.url ?? '';
  const firstId = Array.isArray(rawIds) ? rawIds[0] : rawIds;
  let vid = String(firstId || '').trim();

  // Extract numeric ID if caller passed a path or full URL
  let playPagePath = '';
  const idFromPath = vid.match(/\/vod\/(?:play|detail)\/id\/(\d+)/i);
  if (idFromPath) {
    vid = idFromPath[1];
  }
  if (/^\d+$/.test(vid)) {
    playPagePath = `/index.php/vod/play/id/${vid}/sid/1/nid/1.html`;
  } else {
    playPagePath = vid;
  }

  const res = await fetchPage(playPagePath);
  const htmlText = res.text || '';
  const finalPageUrl = res.finalUrl || absUrl(playPagePath);

  const mainStream = await resolveStreamFromHtml(htmlText, finalPageUrl, vid);
  if (mainStream) {
    setPlayCache(vid, mainStream);
    setPlayCache(playPagePath, mainStream);
    setPlayCache(finalPageUrl, mainStream);
  }

  let rawTitle = '';
  const titleMatch = htmlText.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    rawTitle = cleanLabel(titleMatch[1].split('-')[0]);
  }
  if (!rawTitle) {
    rawTitle = `超清正片 ${vid}`;
  }

  const picUrl = extractPicFromScope(htmlText);

  const episodes = [];
  if (mainStream) {
    episodes.push(`正片$${mainStream}@@@${encodeURIComponent(rawTitle)}`);
  } else {
    episodes.push(`正片$${playPagePath}@@@${encodeURIComponent(rawTitle)}`);
  }

  const recRegex =
    /<a[^>]+href=["'](?:\S*?(?:\/index\.php)?\/vod\/play\/id\/(\d+)\/sid\/\d+\/nid\/\d+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const seenRec = new Set([String(vid)]);
  let recIdx = 1;
  let rm;

  while ((rm = recRegex.exec(htmlText)) !== null) {
    const rId = rm[1];
    const rInner = rm[2] || '';
    if (seenRec.has(rId)) continue;

    let recTitle = '';
    const altSub = rInner.match(/\balt=["']([^"']+)["']/i);
    if (altSub) recTitle = cleanLabel(altSub[1]);
    if (!recTitle) {
      const spanSub = rInner.match(
        /<span[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
      );
      if (spanSub) recTitle = cleanLabel(spanSub[1]);
    }
    if (!recTitle) {
      recTitle = cleanLabel(rInner);
    }
    if (!recTitle || NOISE_TITLES.has(recTitle)) continue;

    seenRec.add(rId);

    const durSub = rInner.match(/id=["']Duration["'][^>]*>([\s\S]*?)<\/span>/i);
    const durTag = durSub ? cleanLabel(durSub[1]) : '';
    const recTargetPath = `/index.php/vod/play/id/${rId}/sid/1/nid/1.html`;
    const idxStr = String(recIdx).padStart(2, '0');
    const label = durTag
      ? `${idxStr}·[${durTag}]${recTitle.slice(0, 14)}`
      : `${idxStr}·${recTitle.slice(0, 18)}`;

    episodes.push(`${label}$${recTargetPath}@@@${encodeURIComponent(recTitle)}`);
    recIdx += 1;
    if (recIdx > 24) break;
  }

  const vod = {
    vod_id: vid,
    vod_name: rawTitle,
    vod_pic: picUrl,
    vod_bg: picUrl,
    vod_background: picUrl,
    vod_banner: picUrl,
    vod_actor: BRAND_ACTOR,
    vod_director: BRAND_DIRECTOR,
    vod_remarks: formatRemarks(BRAND_NAME, `全${episodes.length}部连播`),
    vod_content: DESC_CONTENT,
    vod_play_from: '蝴蝶专线',
    vod_play_url: episodes.join('#'),
  };

  return { list: [vod] };
}

function sanitizeEpisodeInput(rawId) {
  let rawVal = String(rawId || '').trim();
  let descTitle = '';

  // Strip custom @@@ metadata suffix
  if (rawVal.includes('@@@')) {
    const idx = rawVal.indexOf('@@@');
    const suffix = rawVal.slice(idx + 3);
    rawVal = rawVal.slice(0, idx);
    try {
      descTitle = decodeURIComponent(suffix);
    } catch {
      descTitle = suffix;
    }
  }

  // Strip leading episode label prefix like "正片$" or "01·Title$"
  if (rawVal.includes('$')) {
    const dollarIdx = rawVal.indexOf('$');
    const prefix = rawVal.slice(0, dollarIdx).trim();
    if (!/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
      rawVal = rawVal.slice(dollarIdx + 1).trim();
    }
  }

  return { target: rawVal, descTitle };
}

async function play(inReq) {
  const params = unwrapParams(inReq);
  const rawInput = params.id ?? params.url ?? params.playUrl ?? '';
  const { target, descTitle } = sanitizeEpisodeInput(rawInput);

  let realUrl = '';
  const unwrappedTarget = unwrapNestedPlayerUrl(target);

  if (isDirectMediaUrl(unwrappedTarget)) {
    realUrl = absUrl(unwrappedTarget);
  } else {
    const cached = getPlayCache(target);
    if (cached && isDirectMediaUrl(cached)) {
      realUrl = absUrl(cached);
    } else {
      const idMatch = target.match(/\/vod\/(?:play|detail)\/id\/(\d+)/i);
      const vid = idMatch ? idMatch[1] : /^\d+$/.test(target) ? target : '';
      const cachedByVid = vid ? getPlayCache(vid) : '';
      if (cachedByVid && isDirectMediaUrl(cachedByVid)) {
        realUrl = absUrl(cachedByVid);
      } else {
        const fetchTarget = /^\d+$/.test(target)
          ? `/index.php/vod/play/id/${target}/sid/1/nid/1.html`
          : target;
        const res = await fetchPage(fetchTarget, { referer: fetchTarget });
        const resolved = await resolveStreamFromHtml(
          res.text || '',
          res.finalUrl || absUrl(fetchTarget),
          vid
        );
        if (resolved) {
          realUrl = absUrl(resolved);
          if (vid) setPlayCache(vid, realUrl);
          setPlayCache(target, realUrl);
        } else {
          realUrl = res.finalUrl || absUrl(fetchTarget);
        }
      }
    }
  }

  const isStream = isDirectMediaUrl(realUrl);
  const playHeaders = {
    'User-Agent': DEFAULT_UA,
    Referer: `${activeDomain}/`,
    Accept: '*/*',
    Connection: 'keep-alive',
  };

  const result = {
    parse: isStream ? 0 : 1,
    jx: 0,
    playUrl: '',
    url: realUrl,
    header: playHeaders,
    headers: playHeaders,
  };
  if (descTitle) {
    result.desc = descTitle;
  }
  return result;
}

async function search(inReq) {
  const params = unwrapParams(inReq);
  const key = String(params.wd ?? params.key ?? params.keyword ?? '').trim();
  const page = fixedInt(params.page ?? params.pg ?? 1, 1);
  if (!key) {
    return { page: 1, pagecount: 1, limit: 20, total: 0, list: [] };
  }

  const encodedKey = encodeURIComponent(key);
  const searchUrl = `/index.php/vod/search/page/${page}/wd/${encodedKey}.html`;
  let res = await fetchPage(searchUrl);
  let htmlText = res.text || '';

  if (!htmlText) {
    const altUrl = `/index.php/vod/search.html?wd=${encodedKey}&page=${page}`;
    res = await fetchPage(altUrl);
    htmlText = res.text || '';
  }

  const cards = parseCardList(htmlText);
  return {
    page,
    pagecount: cards.length >= 15 ? page + 1 : page,
    limit: 20,
    total: cards.length >= 15 ? 999 : page * 20,
    list: cards,
  };
}

async function proxyPicHandler(query = {}) {
  const rawUrl = String(query.url || query.pic || '').trim();
  if (!rawUrl) {
    return { mime: 'text/plain; charset=utf-8', data: 'Missing url' };
  }
  const res = await fetchPage(rawUrl, {
    buffer: true,
    headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
  });
  const mime =
    res.headers?.['content-type'] ||
    res.headers?.['Content-Type'] ||
    'image/jpeg';
  return { mime, data: res.bytes };
}

export default {
  meta: {
    key: SITE_KEY,
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
    fastify.get(`/${SITE_KEY}_pic`, async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
  },
};