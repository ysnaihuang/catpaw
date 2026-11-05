import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

const SITE_DOMAINS = [
  'https://www.kuaigan47.top',
  'https://kuaigan47.top',
];

let activeDomain = SITE_DOMAINS[0];

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const BRAND_NAME = '蝴蝶影视';
const BRAND_ACTOR = '🦋 TG群: @tvshare23';
const BRAND_DIRECTOR = '🦋 蝴蝶影视';
const BRAND_CONTENT = '🦋 蝴蝶影视专线直连 | 4K原生超清秒播 | 官方交流群: @tvshare23';
const BRAND_PLAY_FROM = '蝴蝶专线';
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

const catIdMap = {
  chuanmei: '454',
};

const PLAY_CACHE = new Map();
const PLAY_CACHE_TTL_MS = 10 * 60 * 1000;

const CLASSES = [
  { type_name: '国产传媒', type_id: 'chuanmei' },
  { type_name: '探花交友', type_id: 'tanhua' },
  { type_name: '网曝黑料', type_id: 'heiliao' },
  { type_name: '绿帽出轨', type_id: 'lvmao' },
  { type_name: '国产乱伦', type_id: 'gcluanlun' },
  { type_name: '主播自拍', type_id: 'zhubo' },
  { type_name: '户外露出', type_id: 'huwai' },
  { type_name: '福利姬', type_id: 'fuliji' },
  { type_name: '中文字幕', type_id: 'zhongwen' },
  { type_name: '无码破解', type_id: 'wuma' },
  { type_name: '熟女人妻', type_id: 'renqi' },
  { type_name: '巨乳美乳', type_id: 'juru' },
  { type_name: '少女萝莉', type_id: 'luoli' },
  { type_name: '强奸乱伦', type_id: 'qiangjian' },
  { type_name: 'SM调教', type_id: 'smtiaojiao' },
  { type_name: 'VR视角', type_id: 'vr' },
  { type_name: '剧情演绎', type_id: 'juqing' },
  { type_name: '制服诱惑', type_id: 'zhifu' },
  { type_name: '欧美视频', type_id: 'oumei' },
  { type_name: '成人动漫', type_id: 'dongman' },
  { type_name: '三级伦理', type_id: 'lunli' },
  { type_name: 'AI换脸', type_id: 'huanlian' },
  { type_name: 'AV解说', type_id: 'jieshuo' },
  { type_name: '女同性恋', type_id: 'nvtong' },
];

const ROLE_TAGS = [
  '探花', '学生', '人妻', '老师', '少妇', '阿姨', '学妹', '护士', '空姐', '校花',
  '姐姐', '女友', '主播', '技师', '足浴店', '妈妈', '闺蜜', '老婆', '同事', '处女',
  '母子', '兄妹', '父女', '熟女', '萝莉', '少女', '妹妹', '女上司', '按摩师', '女神',
  '秘书', '美容师', '后妈', '丈母娘', '儿媳', '女仆', '兔女郎', '外围', '楼凤', '绿茶',
  '厂妹', '模特', '嫩模', '保姆', '辅导员', '伴娘',
];

const ACTION_TAGS = [
  '乱伦', '调教', '绿帽', '偷情', '勾引', '乳交', '内射', '颜射', '口爆', '双飞',
  '强推', '吞精', '出轨', '多p', '深喉', '自慰', '打飞机', '嫖娼', '失禁', '足交',
  '露出', '户外', '偷拍', '野战', '约炮', '面试', '潜规则', '强制', '按摩', '骑乘',
  '3p', '口交', '淫语', '凌辱', '跳蛋', '轮奸', '潮吹', '羞耻', '迷奸', '下药',
  '灌醉', '仙人跳', '绿奴', '字母圈', '冰火', '毒龙', '门事件', '裸贷', '磕炮', '连麦',
];

const BODY_TAGS = [
  '巨乳', '长腿', '美乳', '丰满', '大奶', '大屁股', '蜜桃臀', '娇小', '翘臀', '苗条',
  '白嫩', '微胖', '高挑', '粉嫩', '肥臀', '紧致', '平乳', '爆乳', 'e奶', '美臀',
  '巨臀', '孕妇', '无毛', '一线天', '名器', '极品', '骨感', '水多', '紧逼', '黑木耳',
  '蝴蝶唇', '白虎', '反差',
];

const CLOTH_TAGS = [
  '黑丝', 'JK', '眼镜', '丝袜', '蕾丝', '女仆', '白丝', '双马尾', '肉丝', '高跟',
  '瑜伽裤', '短裙', '免脱', '兔女郎', '紧身裤', '包臀裙', '开档', '吊带袜', '丁字裤', '情趣内衣',
  '校服', '内裤', '紧身裙', '泳装', '迷你裙', '长靴', '制服', '旗袍', '运动服', '汉服',
  '厂服', '护士服', '空姐服', '吊带', '网袜', '渔网袜', '职业装', '睡衣', '肚兜',
];

const SCENE_TAGS = [
  '酒店', '浴室', '车载', '教室', '办公室', '厕所', '电梯', '公园', '电影院', '宿舍',
  '医院', '阳台', '公交车', '地铁', '更衣室', '出租屋', '宾馆', '民宿', '车震', '野外',
  '楼梯间', 'KTV', '会所', '洗浴中心', '按摩店', '试衣间', '网吧', '厂房', '库房', '厨房',
];

function buildFilterGroup(keyName, labelName, tagsList) {
  const opts = [{ n: '全部', v: '' }];
  for (const t of tagsList) {
    opts.push({ n: t, v: t });
  }
  return {
    key: keyName,
    name: labelName,
    init: '',
    value: opts,
  };
}

const FILTER_TEMPLATE = [
  {
    key: 'sort',
    name: '排序',
    init: 'latest',
    value: [
      { n: '最新', v: 'latest' },
      { n: '热门', v: 'daily' },
    ],
  },
  buildFilterGroup('role', '角色', ROLE_TAGS),
  buildFilterGroup('action', '行为', ACTION_TAGS),
  buildFilterGroup('body', '身材', BODY_TAGS),
  buildFilterGroup('cloth', '服饰', CLOTH_TAGS),
  buildFilterGroup('scene', '场景', SCENE_TAGS),
];

const FILTERS = {};
for (const c of CLASSES) {
  FILTERS[c.type_id] = FILTER_TEMPLATE;
}

function formatRemarks(brand = BRAND_NAME, meta = '') {
  const cleanMeta = String(meta || '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  if (cleanMeta) {
    return `${brand} | ${cleanMeta}`;
  }
  return brand;
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return _;
      }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return _;
      }
    });
}

function unescapeJsString(str) {
  if (!str) return '';
  return decodeHtmlEntities(
    String(str)
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      )
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      )
      .replace(/\\\//g, '/')
  );
}

function legacyUnescape(str) {
  if (!str) return '';
  return String(str)
    .replace(/%u([0-9a-fA-F]{4})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/%([0-9a-fA-F]{2})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

function safeDecodeURIComponent(str) {
  if (!str) return '';
  try {
    return decodeURIComponent(str);
  } catch {
    return legacyUnescape(str);
  }
}

function getKnownHosts() {
  const hosts = new Set();
  for (const d of [activeDomain, ...SITE_DOMAINS]) {
    try {
      hosts.add(new URL(d).hostname.toLowerCase());
    } catch {
      // ignore
    }
  }
  return hosts;
}

function getUniqueCandidateDomains() {
  const seen = new Set();
  const list = [];
  for (const d of [activeDomain, ...SITE_DOMAINS]) {
    const clean = String(d || '').replace(/\/+$/, '');
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      list.push(clean);
    }
  }
  return list;
}

function normalizeUrlWithBase(rawUrl, baseDomain = activeDomain) {
  if (!rawUrl) return '';
  const u = decodeHtmlEntities(String(rawUrl).trim());
  if (!u) return '';
  if (u.startsWith('//')) return `https:${u}`;
  if (/^https?:\/\//i.test(u)) return u;
  let base = String(baseDomain || activeDomain).replace(/\/+$/, '');
  try {
    base = new URL(base).origin;
  } catch {
    // keep base
  }
  return u.startsWith('/') ? `${base}${u}` : `${base}/${u}`;
}

function expandCandidateUrls(targetUrl) {
  if (!targetUrl) return [];
  const raw = decodeHtmlEntities(String(targetUrl).trim());
  if (!raw) return [];
  const candidates = getUniqueCandidateDomains();
  if (raw.startsWith('//')) {
    return [`https:${raw}`];
  }
  if (!/^https?:\/\//i.test(raw)) {
    const rel = raw.startsWith('/') ? raw : `/${raw}`;
    return candidates.map((d) => `${d}${rel}`);
  }
  try {
    const parsed = new URL(raw);
    const knownHosts = getKnownHosts();
    if (knownHosts.has(parsed.hostname.toLowerCase())) {
      const suffix = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      const urls = candidates.map((d) => `${d}${suffix}`);
      if (!urls.includes(raw)) urls.unshift(raw);
      return [...new Set(urls)];
    }
  } catch {
    // ignore
  }
  return [raw];
}

function syncRefererWithUrl(targetUrl, customReferer = '') {
  try {
    const targetOrigin = new URL(targetUrl).origin;
    if (!customReferer) return `${targetOrigin}/`;
    const refUrl = new URL(customReferer, targetOrigin);
    const knownHosts = getKnownHosts();
    if (knownHosts.has(refUrl.hostname.toLowerCase())) {
      return `${targetOrigin}${refUrl.pathname}${refUrl.search}`;
    }
    return refUrl.href;
  } catch {
    return `${activeDomain}/`;
  }
}

function decodeResponseBuffer(rawBuf, contentEncoding = '') {
  if (!rawBuf) return '';
  if (typeof rawBuf === 'string') return rawBuf;
  let buf = Buffer.isBuffer(rawBuf)
    ? rawBuf
    : rawBuf instanceof Uint8Array
      ? Buffer.from(rawBuf)
      : Buffer.from(String(rawBuf));

  const enc = String(contentEncoding || '').toLowerCase();
  try {
    if (
      (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) ||
      enc.includes('gzip')
    ) {
      buf = zlib.gunzipSync(buf);
    } else if (enc.includes('deflate')) {
      try {
        buf = zlib.inflateSync(buf);
      } catch {
        buf = zlib.inflateRawSync(buf);
      }
    }
  } catch {
    // keep raw buffer if decompression fails
  }

  const utf8Text = buf.toString('utf8');
  if (utf8Text.includes('\ufffd')) {
    try {
      const gbkDecoder = new TextDecoder('gbk');
      return gbkDecoder.decode(buf);
    } catch {
      return utf8Text;
    }
  }
  return utf8Text;
}

async function fetchUrl(targetUrl, referer = '') {
  if (!targetUrl) {
    return { code: 0, text: '', finalUrl: '' };
  }
  const candidates = expandCandidateUrls(targetUrl);
  let lastError = '';

  for (const candidateUrl of candidates) {
    const syncedReferer = syncRefererWithUrl(candidateUrl, referer);
    const headers = {
      'User-Agent': DEFAULT_UA,
      Referer: syncedReferer,
      Accept: 'application/json, text/html, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await req(candidateUrl, {
          method: 'GET',
          headers,
          timeout: 8000,
        });

        const status = Number(resp?.status ?? resp?.statusCode ?? 200);
        const respHeaders = resp?.headers || {};
        const contentEncoding =
          respHeaders['content-encoding'] || respHeaders['Content-Encoding'] || '';

        let text = '';
        if (typeof resp?.data === 'string') {
          text = resp.data;
        } else if (
          Buffer.isBuffer(resp?.data) ||
          resp?.data instanceof Uint8Array
        ) {
          text = decodeResponseBuffer(resp.data, contentEncoding);
        } else if (resp?.data && typeof resp.data === 'object') {
          text = JSON.stringify(resp.data);
        } else if (typeof resp === 'string') {
          text = resp;
        }

        if (status >= 200 && status < 400 && text) {
          try {
            const origin = new URL(candidateUrl).origin;
            if (getKnownHosts().has(new URL(candidateUrl).hostname.toLowerCase())) {
              activeDomain = origin;
            }
          } catch {
            // ignore
          }
          return {
            code: status,
            text,
            finalUrl: resp?.url || candidateUrl,
            headers: respHeaders,
          };
        }

        if ([403, 429, 451].includes(status) && attempt === 0) {
          continue;
        }
        lastError = `HTTP ${status}`;
      } catch (err) {
        lastError = String(err?.message || err);
        if (attempt === 0) continue;
      }
    }
  }

  return { code: -1, text: '', finalUrl: targetUrl, err: lastError };
}

function unwrapParams(inReq) {
  const merged = {};
  const sources = [inReq?.params, inReq?.query, inReq?.body];
  for (const src of sources) {
    if (!src) continue;
    if (typeof src === 'string') {
      const trimmed = src.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          Object.assign(merged, parsed);
          continue;
        }
      } catch {
        const sp = new URLSearchParams(trimmed);
        for (const [k, v] of sp.entries()) {
          merged[k] = v;
        }
      }
    } else if (typeof src === 'object') {
      Object.assign(merged, src);
    }
  }
  return merged;
}

function extractExtendObject(params) {
  let ext = params?.extend ?? params?.filters ?? params?.ext ?? {};
  if (typeof ext === 'string') {
    const trimmed = ext.trim();
    if (!trimmed) {
      ext = {};
    } else {
      try {
        ext = JSON.parse(trimmed);
      } catch {
        try {
          const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
          ext = JSON.parse(decoded);
        } catch {
          ext = {};
        }
      }
    }
  }
  if (!ext || typeof ext !== 'object') {
    ext = {};
  }
  const combined = { ...ext };
  for (const k of ['sort', 'role', 'action', 'body', 'cloth', 'scene']) {
    if (params?.[k] !== undefined && combined[k] === undefined) {
      combined[k] = params[k];
    }
  }
  return combined;
}

function isBadMediaUrl(url) {
  if (!url) return true;
  const low = String(url).toLowerCase();
  if (low.includes('localhost') || low.includes('127.0.0.1')) return true;
  if (
    low.startsWith('javascript:') ||
    low.startsWith('about:') ||
    low.startsWith('data:')
  ) {
    return true;
  }
  return BAD_MEDIA_KEYWORDS.some((bad) => low.includes(bad));
}

function isDirectMediaUrl(url) {
  if (!url || isBadMediaUrl(url)) return false;
  const cleaned = unescapeJsString(String(url).trim());
  if (!/^https?:\/\//i.test(cleaned)) return false;
  try {
    const parsed = new URL(cleaned);
    const pathname = parsed.pathname.toLowerCase();
    const search = parsed.search.toLowerCase();
    if (
      /\.(html?|php|asp|aspx|jsp)$/i.test(pathname) &&
      (search.includes('url=') ||
        search.includes('v=') ||
        search.includes('src=') ||
        search.includes('file='))
    ) {
      return false;
    }
    if (/\.(m3u8|mp4|flv|mpd)(\?|$)/i.test(pathname)) {
      return true;
    }
    if (
      pathname.includes('streamhls') ||
      pathname.includes('master.m3u8') ||
      search.includes('format=.m3u8') ||
      search.includes('.m3u8')
    ) {
      return !/\.(html?|php)$/i.test(pathname);
    }
  } catch {
    return false;
  }
  return false;
}

function unwrapNestedMediaUrl(rawUrl, baseUrl = activeDomain) {
  if (!rawUrl) return '';
  let candidate = unescapeJsString(String(rawUrl).trim());
  candidate = normalizeUrlWithBase(candidate, baseUrl);
  if (!candidate) return '';

  try {
    const parsed = new URL(candidate);
    const paramKeys = ['url', 'v', 'src', 'file', 'm3u8', 'mp4', 'play'];
    for (const key of paramKeys) {
      const val = parsed.searchParams.get(key);
      if (!val) continue;
      let inner = val.trim();
      for (let i = 0; i < 2; i++) {
        const next = safeDecodeURIComponent(inner);
        if (next === inner) break;
        inner = next;
      }
      inner = unescapeJsString(inner);
      const normalizedInner = normalizeUrlWithBase(inner, parsed.origin);
      if (isDirectMediaUrl(normalizedInner)) {
        return normalizedInner;
      }
    }
  } catch {
    // ignore
  }
  return '';
}

function extractBalancedJsonObject(source, varName) {
  if (!source || !varName) return null;
  const regex = new RegExp(`\\b${varName}\\s*=\\s*\\{`, 'g');
  let match;
  while ((match = regex.exec(source)) !== null) {
    const startIdx = match.index + match[0].length - 1;
    let depth = 0;
    let inString = false;
    let quoteChar = '';
    let escaped = false;

    for (let i = startIdx; i < source.length; i++) {
      const ch = source[i];
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
          const rawObj = source.slice(startIdx, i + 1);
          try {
            return JSON.parse(rawObj);
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

function decodeCmsPlayerUrl(rawUrl, encryptType = 0) {
  if (!rawUrl) return '';
  let url = String(rawUrl).trim();
  const enc = Number(encryptType || 0);
  if (enc === 1) {
    url = safeDecodeURIComponent(legacyUnescape(url));
  } else if (enc === 2) {
    try {
      const b64Decoded = Buffer.from(url, 'base64').toString('utf8');
      url = safeDecodeURIComponent(legacyUnescape(b64Decoded));
    } catch {
      url = safeDecodeURIComponent(legacyUnescape(url));
    }
  }
  url = unescapeJsString(url);
  return url.trim();
}

function unpackDeanEdwardsPacker(html) {
  if (!html || !html.includes('eval(function(p,a,c,k,e,')) return [];
  const results = [];
  const regex =
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;

  const encodeBase = (num, radix) => {
    const chars =
      '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (num === 0) return '0';
    let n = num;
    let out = '';
    while (n > 0) {
      out = chars[n % radix] + out;
      n = Math.floor(n / radix);
    }
    return out;
  };

  let m;
  while ((m = regex.exec(html)) !== null) {
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
    results.push(unpacked);
  }
  return results;
}

function extractEncryptedManifestStream(html, baseUrl = activeDomain) {
  if (!html) return '';
  let b64Data = '';
  let keyStr = '';

  const inlineMatch = html.match(
    /decryptDatas\s*\(\s*['"]([A-Za-z0-9+/=]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/
  );
  if (inlineMatch) {
    b64Data = inlineMatch[1];
    keyStr = inlineMatch[2];
  } else {
    const varMatch = html.match(
      /(?:const|let|var)\s+datas\s*=\s*['"]([A-Za-z0-9+/=]{24,})['"]/
    );
    const callMatch = html.match(
      /decryptDatas\s*\(\s*datas\s*,\s*['"]([^'"]+)['"]\s*\)/
    );
    if (varMatch && callMatch) {
      b64Data = varMatch[1];
      keyStr = callMatch[1];
    }
  }

  if (!b64Data || !keyStr) return '';

  for (const encoding of ['utf8', 'latin1']) {
    try {
      const outerStr = Buffer.from(b64Data, 'base64').toString(encoding);
      const envelope = JSON.parse(outerStr);
      if (envelope?.encryptedData && envelope?.iv) {
        const keyBuf = Buffer.from(keyStr, 'utf8');
        const ivBuf = Buffer.from(envelope.iv, 'base64');
        const cipherBuf = Buffer.from(envelope.encryptedData, 'base64');
        const algo =
          keyBuf.length === 16
            ? 'aes-128-cbc'
            : keyBuf.length === 24
              ? 'aes-192-cbc'
              : 'aes-256-cbc';
        const decipher = crypto.createDecipheriv(algo, keyBuf, ivBuf);
        const decrypted = Buffer.concat([
          decipher.update(cipherBuf),
          decipher.final(),
        ]).toString('utf8');
        const inner = JSON.parse(decrypted);
        const candidate =
          inner?.url ||
          inner?.file ||
          inner?.src ||
          inner?.sources?.[0]?.file ||
          inner?.sources?.[0]?.src ||
          '';
        if (candidate) {
          const norm = normalizeUrlWithBase(unescapeJsString(candidate), baseUrl);
          if (isDirectMediaUrl(norm)) return norm;
        }
      }
    } catch {
      // try next encoding or fall through
    }
  }
  return '';
}

function extractStreamFromSingleHtml(html, baseUrl = activeDomain) {
  if (!html) return { streamUrl: '', iframeUrl: '' };

  const blocksToScan = [html, ...unpackDeanEdwardsPacker(html)];

  for (const block of blocksToScan) {
    // 1. Check CMS player objects with balanced brace scanning
    for (const varName of [
      'player_aaaa',
      'player_data',
      'player_config',
      'video_info',
      'videoConfig',
    ]) {
      const cfg = extractBalancedJsonObject(block, varName);
      if (cfg && cfg.url) {
        const decoded = decodeCmsPlayerUrl(cfg.url, cfg.encrypt);
        const unwrapped = unwrapNestedMediaUrl(decoded, baseUrl);
        if (unwrapped) return { streamUrl: unwrapped, iframeUrl: '' };
        const norm = normalizeUrlWithBase(decoded, baseUrl);
        if (isDirectMediaUrl(norm)) {
          return { streamUrl: norm, iframeUrl: '' };
        }
      }
    }

    // 2. Check AES encrypted manifest blocks
    const decryptedStream = extractEncryptedManifestStream(block, baseUrl);
    if (decryptedStream) {
      return { streamUrl: decryptedStream, iframeUrl: '' };
    }

    // 3. Check high-priority JS player variables
    const priorityVarRegex =
      /\b(?:hlsUrl|m3u8Url|video_url|play_url|videoUrl|playUrl|streamUrl)\s*[:=]\s*['"]([^'"]+)['"]/gi;
    let pm;
    while ((pm = priorityVarRegex.exec(block)) !== null) {
      const candidateRaw = unescapeJsString(pm[1].trim());
      const unwrapped = unwrapNestedMediaUrl(candidateRaw, baseUrl);
      if (unwrapped) return { streamUrl: unwrapped, iframeUrl: '' };
      const norm = normalizeUrlWithBase(candidateRaw, baseUrl);
      if (isDirectMediaUrl(norm)) {
        return { streamUrl: norm, iframeUrl: '' };
      }
    }

    // 4. Normalize escaped slashes/unicode and scan for direct .m3u8 and .mp4 links
    const normalizedBlock = unescapeJsString(block);

    const m3u8Matches =
      normalizedBlock.match(
        /https?:\/\/(?:(?!localhost|127\.0\.0\.1)[^\s"'$<>\\])+\.m3u8[^\s"'$<>\\]*/gi
      ) || [];
    for (const rawLink of m3u8Matches) {
      const unwrapped = unwrapNestedMediaUrl(rawLink, baseUrl);
      if (unwrapped) return { streamUrl: unwrapped, iframeUrl: '' };
      let realM3u8 = rawLink.replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
      if (!isBadMediaUrl(realM3u8)) {
        if (!realM3u8.toLowerCase().includes('.m3u8')) {
          const sep = realM3u8.includes('?') ? '&' : '?';
          realM3u8 = `${realM3u8}${sep}format=.m3u8`;
        }
        return { streamUrl: realM3u8, iframeUrl: '' };
      }
    }

    const mp4Matches =
      normalizedBlock.match(
        /https?:\/\/(?:(?!localhost|127\.0\.0\.1)[^\s"'$<>\\])+\.mp4[^\s"'<>\\]*/gi
      ) || [];
    for (const rawLink of mp4Matches) {
      const unwrapped = unwrapNestedMediaUrl(rawLink, baseUrl);
      if (unwrapped) return { streamUrl: unwrapped, iframeUrl: '' };
      if (!isBadMediaUrl(rawLink)) {
        return { streamUrl: rawLink, iframeUrl: '' };
      }
    }
  }

  // 5. Extract iframe candidate (supporting lazy-load attributes and filtering about:blank)
  const iframeTagRegex = /<iframe\b[^>]*>/gi;
  let im;
  while ((im = iframeTagRegex.exec(html)) !== null) {
    const tag = im[0];
    const attrNames = [
      'data-litespeed-src',
      'data-lazy-src',
      'data-src',
      'src',
    ];
    for (const attr of attrNames) {
      const attrRegex = new RegExp(`${attr}\\s*=\\s*['"]([^'"]+)['"]`, 'i');
      const am = tag.match(attrRegex);
      if (am && am[1]) {
        const rawSrc = decodeHtmlEntities(am[1].trim());
        if (
          !rawSrc ||
          rawSrc.startsWith('about:') ||
          rawSrc.startsWith('javascript:') ||
          rawSrc.startsWith('data:')
        ) {
          continue;
        }
        const fullIframeUrl = normalizeUrlWithBase(rawSrc, baseUrl);
        const unwrapped = unwrapNestedMediaUrl(fullIframeUrl, baseUrl);
        if (unwrapped) {
          return { streamUrl: unwrapped, iframeUrl: fullIframeUrl };
        }
        return { streamUrl: '', iframeUrl: fullIframeUrl };
      }
    }
  }

  return { streamUrl: '', iframeUrl: '' };
}

function discoverAlternatePlayRoutes(html, currentPageUrl = '') {
  if (!html) return [];
  const routes = [];
  const routeRegex =
    /href\s*=\s*['"]([^'"]*(?:\/vodplay\/|\/play\/|sid\/\d+\/nid\/\d+)[^'"]*)['"]/gi;
  let m;
  while ((m = routeRegex.exec(html)) !== null) {
    const candidate = normalizeUrlWithBase(m[1], currentPageUrl || activeDomain);
    if (
      candidate &&
      candidate !== currentPageUrl &&
      !routes.includes(candidate)
    ) {
      routes.push(candidate);
    }
  }
  return routes.slice(0, 3);
}

async function resolvePlayStreamFromHtml(html, pageUrl = activeDomain) {
  const firstPass = extractStreamFromSingleHtml(html, pageUrl);
  if (firstPass.streamUrl) {
    return {
      streamUrl: firstPass.streamUrl,
      iframeUrl: firstPass.iframeUrl,
      referer: pageUrl,
    };
  }

  if (firstPass.iframeUrl) {
    const unwrapped = unwrapNestedMediaUrl(firstPass.iframeUrl, pageUrl);
    if (unwrapped) {
      return {
        streamUrl: unwrapped,
        iframeUrl: firstPass.iframeUrl,
        referer: pageUrl,
      };
    }

    const iframeRes = await fetchUrl(firstPass.iframeUrl, pageUrl);
    if (iframeRes.text) {
      const secondPass = extractStreamFromSingleHtml(
        iframeRes.text,
        iframeRes.finalUrl || firstPass.iframeUrl
      );
      if (secondPass.streamUrl) {
        return {
          streamUrl: secondPass.streamUrl,
          iframeUrl: firstPass.iframeUrl,
          referer: iframeRes.finalUrl || firstPass.iframeUrl,
        };
      }
    }

    return {
      streamUrl: '',
      iframeUrl: firstPass.iframeUrl,
      referer: pageUrl,
    };
  }

  // Fallback Stage 5: discover alternative play routes if primary route had no stream
  const altRoutes = discoverAlternatePlayRoutes(html, pageUrl);
  for (const altUrl of altRoutes) {
    const altRes = await fetchUrl(altUrl, pageUrl);
    if (altRes.text) {
      const altExtracted = extractStreamFromSingleHtml(
        altRes.text,
        altRes.finalUrl || altUrl
      );
      if (altExtracted.streamUrl) {
        return {
          streamUrl: altExtracted.streamUrl,
          iframeUrl: altExtracted.iframeUrl,
          referer: altRes.finalUrl || altUrl,
        };
      }
    }
  }

  return { streamUrl: '', iframeUrl: '', referer: pageUrl };
}

function setPlayCache(key, value) {
  if (!key || !value?.streamUrl) return;
  PLAY_CACHE.set(String(key), {
    ...value,
    timestamp: Date.now(),
  });
}

function getPlayCache(key) {
  if (!key) return null;
  const entry = PLAY_CACHE.get(String(key));
  if (!entry) return null;
  if (Date.now() - entry.timestamp > PLAY_CACHE_TTL_MS) {
    PLAY_CACHE.delete(String(key));
    return null;
  }
  return entry;
}

async function getCategoryId(slug) {
  const cleanSlug = String(slug || '').replace(/^\/+|\/+$/g, '');
  if (!cleanSlug) return '';
  if (catIdMap[cleanSlug]) {
    return catIdMap[cleanSlug];
  }
  const catPageUrl = `${activeDomain}/category/${cleanSlug}/`;
  const res = await fetchUrl(catPageUrl);
  const html = res.text || '';
  const m =
    html.match(/data-category-id\s*=\s*['"]?(\d+)['"]?/i) ||
    html.match(/category_id\s*[:=]\s*['"]?(\d+)['"]?/i);
  if (m && m[1]) {
    const catId = m[1].trim();
    catIdMap[cleanSlug] = catId;
    return catId;
  }
  return '';
}

function parseApiVideoCards(dataJson) {
  const cards = [];
  if (!dataJson || typeof dataJson !== 'object') return cards;
  const rawList = Array.isArray(dataJson.data)
    ? dataJson.data
    : Array.isArray(dataJson.list)
      ? dataJson.list
      : [];

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const rawUrl = String(item.url || item.vod_id || item.id || '').trim();
    const title = decodeHtmlEntities(item.title || item.vod_name || '');
    if (!rawUrl || !title) continue;
    const cover = normalizeUrlWithBase(
      item.cover_image_url || item.vod_pic || item.pic || '',
      activeDomain
    );
    cards.push({
      vod_id: rawUrl,
      vod_name: title,
      vod_pic: cover,
      vod_remarks: formatRemarks(BRAND_NAME, item.remarks || '正片'),
      style: { ...CARD_STYLE },
    });
  }
  return cards;
}

function parseHtmlVideoCards(html) {
  if (!html) return [];
  const cardsByHref = new Map();
  const anchorRegex = /<a\b[^>]*href\s*=\s*['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRegex.exec(html)) !== null) {
    const rawHref = decodeHtmlEntities(m[1].trim());
    const inner = m[2] || '';
    if (
      !rawHref ||
      rawHref.startsWith('#') ||
      rawHref.startsWith('javascript:') ||
      rawHref.includes('/category/') ||
      rawHref.includes('/tag/') ||
      rawHref.includes('search.php')
    ) {
      continue;
    }
    const existing = cardsByHref.get(rawHref) || {
      vod_id: rawHref,
      vod_name: '',
      vod_pic: '',
      vod_remarks: formatRemarks(BRAND_NAME, '正片'),
      style: { ...CARD_STYLE },
    };

    const imgMatch =
      inner.match(
        /<img\b[^>]*(?:data-litespeed-src|data-lazy-src|data-src|src)\s*=\s*['"]([^'"]+)['"]/i
      ) || [];
    if (imgMatch[1] && !existing.vod_pic) {
      existing.vod_pic = normalizeUrlWithBase(imgMatch[1], activeDomain);
    }

    const altMatch = inner.match(/<img\b[^>]*alt\s*=\s*['"]([^'"]+)['"]/i);
    const plainText = decodeHtmlEntities(
      inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    );
    const titleCandidate = plainText || decodeHtmlEntities(altMatch?.[1] || '');
    if (titleCandidate && !existing.vod_name) {
      existing.vod_name = titleCandidate;
    }

    if (existing.vod_pic || existing.vod_name) {
      cardsByHref.set(rawHref, existing);
    }
  }

  return [...cardsByHref.values()].filter((c) => c.vod_name && c.vod_id);
}

async function init(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const ext = params?.ext ?? params?.extend;
  if (typeof ext === 'string' && /^https?:\/\//i.test(ext.trim())) {
    activeDomain = ext.trim().replace(/\/+$/, '');
    if (!SITE_DOMAINS.includes(activeDomain)) {
      SITE_DOMAINS.unshift(activeDomain);
    }
  } else if (ext && typeof ext === 'object' && ext.siteUrl) {
    activeDomain = String(ext.siteUrl).trim().replace(/\/+$/, '');
  }
  return {};
}

async function home(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const includeFilter = params?.filter !== false && params?.filter !== '0';

  let homeList = [];
  try {
    const firstCatRes = await category(
      { body: { id: CLASSES[0].type_id, page: 1 } },
      _outResp
    );
    if (Array.isArray(firstCatRes?.list)) {
      homeList = firstCatRes.list;
    }
  } catch {
    homeList = [];
  }

  const result = {
    class: CLASSES,
    list: homeList,
    style: { ...CARD_STYLE },
  };
  if (includeFilter) {
    result.filters = FILTERS;
  }
  return result;
}

async function category(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const slug = String(params.id ?? params.tid ?? CLASSES[0].type_id)
    .replace(/^\/+|\/+$/g, '')
    .trim();
  const page = Math.max(1, parseInt(params.page ?? params.pg ?? '1', 10) || 1);

  const ext = extractExtendObject(params);
  const sort = String(ext.sort || 'latest').trim() || 'latest';

  const activeTags = [];
  for (const tagKey of ['role', 'action', 'body', 'cloth', 'scene']) {
    const val = String(ext[tagKey] || '').trim();
    if (val) {
      activeTags.push(val);
    }
  }

  const catId = await getCategoryId(slug);
  if (!catId) {
    return {
      page,
      pagecount: page,
      limit: 20,
      total: 0,
      list: [],
      style: { ...CARD_STYLE },
    };
  }

  let apiUrl = `${activeDomain}/factory/api/category.php?id=${encodeURIComponent(
    catId
  )}&field=category_id&sort=${encodeURIComponent(sort)}&page=${page}`;
  for (const tag of activeTags) {
    apiUrl += `&tags[]=${encodeURIComponent(tag)}`;
  }

  const catReferer = `${activeDomain}/category/${slug}/`;
  const res = await fetchUrl(apiUrl, catReferer);

  let cards = [];
  let pagecount = page;
  let total = 0;
  let limit = 20;

  if (res.text) {
    try {
      const dataJson = JSON.parse(res.text);
      if (dataJson?.status === 'success' || Array.isArray(dataJson?.data)) {
        cards = parseApiVideoCards(dataJson);
        const pagination = dataJson?.pagination || {};
        total = parseInt(pagination.totalHits ?? cards.length, 10) || 0;
        limit = parseInt(pagination.limit ?? 20, 10) || 20;
        pagecount = limit > 0 ? Math.ceil(total / limit) : 1;
      }
    } catch {
      cards = parseHtmlVideoCards(res.text);
      total = cards.length;
    }
  }

  return {
    page,
    pagecount: Math.max(1, pagecount),
    limit,
    total,
    list: cards,
    style: { ...CARD_STYLE },
  };
}

async function detail(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const rawIds = params.ids ?? params.id ?? params.url ?? '';
  const rawId = Array.isArray(rawIds) ? String(rawIds[0] || '') : String(rawIds || '');
  const detailUrl = normalizeUrlWithBase(rawId, activeDomain);

  const res = await fetchUrl(detailUrl);
  const detailHtml = res.text || '';
  const finalPageUrl = res.finalUrl || detailUrl;

  let title = '超清正片';
  const titleMatch = detailHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    title = decodeHtmlEntities(titleMatch[1].trim());
    if (title.includes(' - 快感研究所')) {
      title = title.replace(/\s*-\s*快感研究所/g, '').trim();
    }
  }

  let vodPic = '';
  const ogImageMatch =
    detailHtml.match(/<meta[^>]+property=['"]og:image['"][^>]+content=['"]([^'"]+)['"]/i) ||
    detailHtml.match(/<meta[^>]+content=['"]([^'"]+)['"][^>]+property=['"]og:image['"]/i) ||
    detailHtml.match(/poster\s*=\s*['"]([^'"]+)['"]/i);
  if (ogImageMatch && ogImageMatch[1]) {
    vodPic = normalizeUrlWithBase(ogImageMatch[1], finalPageUrl);
  }

  const resolved = await resolvePlayStreamFromHtml(detailHtml, finalPageUrl);
  let playUrl = '';
  if (resolved.streamUrl) {
    playUrl = `超清正片$${resolved.streamUrl}`;
    setPlayCache(rawId, resolved);
    setPlayCache(detailUrl, resolved);
    setPlayCache(finalPageUrl, resolved);
  } else if (resolved.iframeUrl) {
    playUrl = `解析播放$${resolved.iframeUrl}`;
  } else {
    playUrl = `直链直出$${finalPageUrl}`;
  }

  return {
    list: [
      {
        vod_id: rawId,
        vod_name: title,
        vod_pic: vodPic,
        vod_actor: BRAND_ACTOR,
        vod_director: BRAND_DIRECTOR,
        vod_remarks: formatRemarks(BRAND_NAME, '正片'),
        vod_content: BRAND_CONTENT,
        vod_play_from: BRAND_PLAY_FROM,
        vod_play_url: playUrl,
      },
    ],
  };
}

function sanitizePlayId(rawId) {
  let clean = String(rawId || '').trim();
  if (!clean) return '';

  if (clean.includes('@@@')) {
    clean = clean.split('@@@')[0].trim();
  }

  if (clean.includes('$')) {
    const dollarIdx = clean.indexOf('$');
    const prefix = clean.slice(0, dollarIdx).trim();
    const rest = clean.slice(dollarIdx + 1).trim();
    if (rest && !/^https?:\/\//i.test(prefix) && !prefix.startsWith('/')) {
      clean = rest;
    }
  }

  return unescapeJsString(clean);
}

async function play(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const rawInput = params.id ?? params.url ?? params.playUrl ?? '';
  let targetUrl = sanitizePlayId(rawInput);
  let referer = `${activeDomain}/`;

  const buildPlayResponse = (url, parseFlag, refUrl = referer) => {
    const headers = {
      'User-Agent': DEFAULT_UA,
      Referer: refUrl || `${activeDomain}/`,
    };
    return {
      parse: parseFlag,
      jx: 0,
      playUrl: '',
      url,
      header: headers,
      headers,
    };
  };

  if (!targetUrl) {
    return buildPlayResponse('', 1);
  }

  // 1. Unwrap wrapper URLs like dplayer.html?url=https%3A%2F%2F...m3u8
  const unwrapped = unwrapNestedMediaUrl(targetUrl, activeDomain);
  if (unwrapped) {
    return buildPlayResponse(unwrapped, 0, syncRefererWithUrl(targetUrl));
  }

  // 2. If already a direct .m3u8 or .mp4 stream URL, return directly with parse: 0
  if (isDirectMediaUrl(targetUrl)) {
    let finalMediaUrl = targetUrl;
    if (
      finalMediaUrl.toLowerCase().includes('m3u8') &&
      !finalMediaUrl.toLowerCase().includes('.m3u8')
    ) {
      const sep = finalMediaUrl.includes('?') ? '&' : '?';
      finalMediaUrl = `${finalMediaUrl}${sep}format=.m3u8`;
    }
    return buildPlayResponse(finalMediaUrl, 0, `${activeDomain}/`);
  }

  // 3. Check PLAY_CACHE if input is a detail/play page URL or video ID
  const fullTargetUrl = normalizeUrlWithBase(targetUrl, activeDomain);
  const cached = getPlayCache(targetUrl) || getPlayCache(fullTargetUrl);
  if (cached?.streamUrl) {
    return buildPlayResponse(
      cached.streamUrl,
      0,
      cached.referer || `${activeDomain}/`
    );
  }

  // 4. Fetch the page and run multi-stage stream extraction
  const pageRes = await fetchUrl(fullTargetUrl, referer);
  if (pageRes.text) {
    const resolved = await resolvePlayStreamFromHtml(
      pageRes.text,
      pageRes.finalUrl || fullTargetUrl
    );
    if (resolved.streamUrl) {
      setPlayCache(targetUrl, resolved);
      setPlayCache(fullTargetUrl, resolved);
      return buildPlayResponse(
        resolved.streamUrl,
        0,
        resolved.referer || pageRes.finalUrl || `${activeDomain}/`
      );
    }
    if (resolved.iframeUrl) {
      return buildPlayResponse(
        resolved.iframeUrl,
        1,
        pageRes.finalUrl || `${activeDomain}/`
      );
    }
  }

  const isDirectFallback =
    targetUrl.toLowerCase().includes('.m3u8') ||
    targetUrl.toLowerCase().includes('.mp4');
  return buildPlayResponse(
    fullTargetUrl || targetUrl,
    isDirectFallback ? 0 : 1,
    `${activeDomain}/`
  );
}

async function search(inReq, _outResp) {
  const params = unwrapParams(inReq);
  const key = String(params.wd ?? params.key ?? params.keyword ?? '').trim();
  const page = Math.max(1, parseInt(params.page ?? params.pg ?? '1', 10) || 1);

  if (!key) {
    return {
      page,
      pagecount: page,
      limit: 20,
      total: 0,
      list: [],
    };
  }

  const searchUrl = `${activeDomain}/search.php?q=${encodeURIComponent(key)}`;
  const searchPageRes = await fetchUrl(searchUrl);
  const html = searchPageRes.text || '';

  const catIdMatch = html.match(/data-category-id\s*=\s*['"]?(\d+)['"]?/i);
  const catId = catIdMatch?.[1]?.trim() || '1';

  const apiUrl = `${activeDomain}/factory/api/category.php?id=${encodeURIComponent(
    catId
  )}&field=search&keyword=${encodeURIComponent(key)}&page=${page}`;
  const apiRes = await fetchUrl(apiUrl, searchPageRes.finalUrl || searchUrl);

  let cards = [];
  if (apiRes.text) {
    try {
      const dataJson = JSON.parse(apiRes.text);
      if (dataJson?.status === 'success' || Array.isArray(dataJson?.data)) {
        cards = parseApiVideoCards(dataJson);
      }
    } catch {
      cards = parseHtmlVideoCards(apiRes.text);
    }
  }
  if (cards.length === 0 && html) {
    cards = parseHtmlVideoCards(html);
  }

  return {
    page,
    pagecount: cards.length === 0 ? page : page + 1,
    limit: 20,
    total: cards.length,
    list: cards,
    style: { ...CARD_STYLE },
  };
}

async function proxyPicHandler(query) {
  const picUrl = String(query?.url || query?.pic || '').trim();
  if (!picUrl) {
    return { mime: 'image/gif', data: Buffer.alloc(0) };
  }
  try {
    const fullUrl = normalizeUrlWithBase(picUrl, activeDomain);
    const resp = await req(fullUrl, {
      method: 'GET',
      headers: {
        'User-Agent': DEFAULT_UA,
        Referer: syncRefererWithUrl(fullUrl),
      },
      responseType: 'arraybuffer',
      timeout: 8000,
    });
    const headers = resp?.headers || {};
    const mime =
      headers['content-type'] || headers['Content-Type'] || 'image/jpeg';
    const data = Buffer.isBuffer(resp?.data)
      ? resp.data
      : Buffer.from(resp?.data || '');
    return { mime, data };
  } catch {
    return { mime: 'image/gif', data: Buffer.alloc(0) };
  }
}

export default {
  meta: {
    key: 'kuaigan',
    name: '快感研究所',
    type: 3,
  },
  api: async (fastify) => {
    fastify.post('/init', init);
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/kuaigan_pic', async (request, reply) => {
      const res = await proxyPicHandler(request.query || {});
      return reply.type(res.mime).send(res.data);
    });
  },
};