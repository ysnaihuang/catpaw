import req from '../../util/req.js';
import crypto from 'crypto';
import zlib from 'node:zlib';

const SITE_DOMAINS = [
  'https://ow63.com',
  'https://fagjil.asia',
  'https://www.izo440.sbs',
];
let activeDomain = SITE_DOMAINS[0];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PASS_COOKIE = '_slide_passed=1';
const TIMEOUT_MS = 10000;
const STYLE = { type: 'rect', ratio: 1.78 };

const CATS = [
  ['new-release', '最近更新'],
  ['trending', '热门'],
  ['browse/44041', '日本无码'],
  ['browse/44050', '日本有码'],
  ['browse/44002', '中文字幕'],
  ['browse/44006', '三级伦理'],
  ['browse/44090', '国产'],
  ['browse/44011', '麻豆传媒'],
  ['browse/44091', '主播视讯'],
  ['browse/44092', '蜜桃影像传媒'],
  ['browse/44093', '其他传媒'],
  ['browse/44094', '欧美性爱'],
  ['browse/44095', '黑料事件'],
  ['browse/44096', '91制片厂'],
  ['browse/44097', '台湾swag'],
  ['browse/44098', '精东影业'],
  ['browse/44099', '天美传媒'],
  ['browse/44100', '美女写真'],
  ['browse/44101', '糖心Vlog'],
  ['browse/44102', '星空无限传媒'],
  ['browse/44103', '葫芦影业'],
  ['browse/44104', '中字无码'],
  ['browse/44106', '中字有码'],
  ['browse/44107', '女同系列'],
  ['browse/44015', 'SM调教'],
  ['browse/43997', '卡通动漫'],
  ['browse/44300', '水果派解说'],
  ['browse/44315', '国产厂商'],
];

const PLAY_CACHE = new Map();
const PLAY_CACHE_TTL = 10 * 60 * 1000;

function setPlayCache(key, val) {
  if (!key || !val) return;
  PLAY_CACHE.set(key, { val, ts: Date.now() });
}

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

function unescapeHtml(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&#0*38;/gi, '&')
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

function getParams(inReq) {
  const out = {};
  if (!inReq) return out;
  const sources = [inReq.params, inReq.query, inReq.body];
  for (const src of sources) {
    if (!src) continue;
    if (typeof src === 'string') {
      const trimmed = src.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          Object.assign(out, JSON.parse(trimmed));
          continue;
        } catch {}
      }
      try {
        const sp = new URLSearchParams(trimmed);
        for (const [k, v] of sp.entries()) out[k] = v;
      } catch {}
    } else if (typeof src === 'object') {
      Object.assign(out, src);
    }
  }
  return out;
}

/**
 * 页面 hex 混淆解码：
 * 站点采用 document.write(FN1(unescape(FN2("HEX","%")))) 混淆，
 * 等价于将 >=500 字符的十六进制串转为 UTF-8 明文。
 */
export function decodePage(raw) {
  if (!raw || typeof raw !== 'string') return '';
  if (raw.includes('videoData') || raw.includes('/zh/screen/')) {
    return raw;
  }
  const m = raw.match(/["']([0-9a-fA-F]{500,})["']/);
  if (m && m[1]) {
    try {
      const hexStr = m[1].length % 2 === 0 ? m[1] : m[1].slice(0, -1);
      const dec = Buffer.from(hexStr, 'hex').toString('utf8');
      if (
        dec.length > 1000 ||
        dec.includes('videoData') ||
        dec.includes('/zh/screen/') ||
        dec.includes('<html') ||
        dec.includes('<div')
      ) {
        return dec;
      }
    } catch {}
  }
  return raw;
}

/**
 * 平衡括号扫描提取对象字面量（兼容字符串内含括号与转义字符）
 */
export function extractBalancedJson(text, marker = 'videoData') {
  if (!text || typeof text !== 'string') return null;
  const i = text.indexOf(marker);
  if (i < 0) return null;
  const j = text.indexOf('{', i);
  if (j < 0) return null;

  let depth = 0;
  let k = j;
  let inStr = false;
  let quoteChar = '"';
  let esc = false;
  const n = text.length;

  while (k < n) {
    const c = text[k];
    if (esc) {
      esc = false;
    } else if (c === '\\') {
      if (inStr) esc = true;
    } else if (inStr) {
      if (c === quoteChar) inStr = false;
    } else if (c === '"' || c === "'") {
      inStr = true;
      quoteChar = c;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) {
        const rawObj = text.slice(j, k + 1);
        try {
          return JSON.parse(rawObj);
        } catch {
          return null;
        }
      }
    }
    k++;
  }
  return null;
}

export function extractVideoData(text) {
  return extractBalancedJson(text, 'videoData');
}

function firstImg(v) {
  if (Array.isArray(v)) {
    if (!v.length) return '';
    v = v[0];
  }
  if (v && typeof v === 'object') {
    v = v.img || v.src || v.url || '';
  }
  return typeof v === 'string' ? v.trim() : '';
}

function isKnownSiteHost(urlStr) {
  try {
    const u = new URL(urlStr);
    return SITE_DOMAINS.some((d) => new URL(d).hostname === u.hostname);
  } catch {
    return false;
  }
}

function expandCandidateUrls(urlOrPath) {
  const orderedDomains = [
    activeDomain,
    ...SITE_DOMAINS.filter((d) => d !== activeDomain),
  ];
  if (!urlOrPath) return [];
  const str = String(urlOrPath).trim();
  if (str.startsWith('http://') || str.startsWith('https://')) {
    if (isKnownSiteHost(str)) {
      const u = new URL(str);
      const rel = u.pathname + u.search;
      return orderedDomains.map((d) => d.replace(/\/+$/, '') + rel);
    }
    return [str];
  }
  const rel = str.startsWith('/') ? str : '/' + str;
  return orderedDomains.map((d) => d.replace(/\/+$/, '') + rel);
}

function decodeResponseBuffer(buf, headers = {}) {
  if (!buf) return '';
  if (typeof buf === 'string') return buf;
  let raw = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const ctype = String(
    headers['content-encoding'] || headers['Content-Encoding'] || ''
  ).toLowerCase();
  try {
    if (
      ctype.includes('gzip') ||
      (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b)
    ) {
      raw = zlib.gunzipSync(raw);
    } else if (
      ctype.includes('deflate') ||
      (raw.length >= 2 &&
        raw[0] === 0x78 &&
        (raw[1] === 0x9c || raw[1] === 0x01 || raw[1] === 0xda))
    ) {
      raw = zlib.inflateSync(raw);
    }
  } catch {}

  let text = raw.toString('utf8');
  if (text.includes('\ufffd')) {
    try {
      const gbkDec = new TextDecoder('gbk').decode(raw);
      if (!gbkDec.includes('\ufffd')) text = gbkDec;
    } catch {}
  }
  return text;
}

async function rawHttpRequest(url, options = {}) {
  const { headers = {}, timeout = TIMEOUT_MS, limit = 0 } = options;
  try {
    const res = await req.get(url, {
      headers,
      timeout,
      responseType: 'arraybuffer',
    });
    const status = res?.status ?? res?.statusCode ?? 200;
    const rawData = res?.data ?? res?.body ?? '';
    let text = '';
    if (typeof rawData === 'string') {
      text = rawData;
    } else if (rawData && (Buffer.isBuffer(rawData) || rawData instanceof ArrayBuffer || ArrayBuffer.isView(rawData))) {
      const buf = Buffer.isBuffer(rawData)
        ? rawData
        : Buffer.from(rawData.buffer || rawData);
      const sliced = limit > 0 && buf.length > limit ? buf.subarray(0, limit) : buf;
      text = decodeResponseBuffer(sliced, res?.headers || {});
    } else if (rawData && typeof rawData === 'object') {
      text = JSON.stringify(rawData);
    }
    if (limit > 0 && text.length > limit) {
      text = text.slice(0, limit);
    }
    return { status, text, headers: res?.headers || {} };
  } catch (err) {
    return { status: null, text: '', error: String(err?.message || err) };
  }
}

async function fetchWithFailover(urlOrPath, { referer, timeout = TIMEOUT_MS, limit = 0 } = {}) {
  const isSiteRequest =
    !String(urlOrPath).startsWith('http') || isKnownSiteHost(urlOrPath);
  const candidates = expandCandidateUrls(urlOrPath);
  let lastErr = '';

  for (const u of candidates) {
    let origin = activeDomain;
    try {
      origin = new URL(u).origin;
    } catch {}
    const ref = referer
      ? isSiteRequest
        ? referer.replace(/^https?:\/\/[^/]+/i, origin)
        : referer
      : isSiteRequest
      ? `${origin}/zh/`
      : 'https://ow63.com/';

    const headers = {
      'User-Agent': UA,
      Referer: ref,
      Cookie: PASS_COOKIE,
      Accept: 'text/html,application/json,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    };

    const res = await rawHttpRequest(u, { headers, timeout, limit });
    if (res.status && res.status >= 200 && res.status < 400 && res.text) {
      if (isSiteRequest) {
        const decoded = decodePage(res.text);
        const looksValid =
          decoded.includes('/zh/screen/') ||
          decoded.includes('videoData') ||
          decoded.includes('video-duration') ||
          decoded.includes('<html') ||
          decoded.includes('<!DOCTYPE');
        if (looksValid) {
          activeDomain = origin;
          return { status: res.status, text: decoded, rawText: res.text, url: u };
        }
      } else {
        return { status: res.status, text: res.text, rawText: res.text, url: u };
      }
    }
    lastErr = res.error || `HTTP ${res.status}`;
  }
  return { status: null, text: '', error: lastErr };
}

async function getPage(path) {
  const res = await fetchWithFailover(path);
  return res.status ? res.text : '';
}

/**
 * 解析列表页视频卡片（兼容原版正则与常见属性顺序变化）
 */
export function parseCards(text) {
  const vods = [];
  if (!text || typeof text !== 'string') return vods;
  const seen = new Set();

  const cardRe =
    /<a\s+href="(\/zh\/screen\/[^"]+)"\s+title="([^"]*)">\s*<img\s+[^>]*?(?:data-src|data-lazy-src|src)="([^"]+)"[^>]*>\s*<\/a>([\s\S]*?)<\/div>/gi;
  const durationRe = /video-duration[^>]*>\s*([^<]+?)\s*</i;

  let m;
  while ((m = cardRe.exec(text)) !== null) {
    const [, href, rawTitle, pic, rest] = m;
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const durMatch = durationRe.exec(rest || '');
    vods.push({
      vod_id: href,
      vod_name: unescapeHtml(rawTitle).trim(),
      vod_pic: unescapeHtml(pic).trim(),
      vod_remarks: durMatch ? unescapeHtml(durMatch[1]).trim() : '',
    });
  }

  if (vods.length === 0) {
    const fallbackRe =
      /<a\s+[^>]*?href=["'](\/zh\/screen\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = fallbackRe.exec(text)) !== null) {
      const [fullMatch, href, inner] = m;
      if (!href || seen.has(href)) continue;
      const titleAttr = fullMatch.match(/title=["']([^"']*)["']/i);
      const imgAttr = inner.match(
        /<img\s+[^>]*?(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i
      );
      if (!titleAttr && !imgAttr) continue;
      seen.add(href);
      const afterSlice = text.slice(m.index, m.index + fullMatch.length + 400);
      const durMatch = durationRe.exec(afterSlice);
      vods.push({
        vod_id: href,
        vod_name: unescapeHtml(titleAttr ? titleAttr[1] : href.split('/').pop()).trim(),
        vod_pic: imgAttr ? unescapeHtml(imgAttr[1]).trim() : '',
        vod_remarks: durMatch ? unescapeHtml(durMatch[1]).trim() : '',
      });
    }
  }

  return vods;
}

async function getHomeVods() {
  try {
    const html = await getPage('/zh/new-release');
    return parseCards(html).slice(0, 20);
  } catch {
    return [];
  }
}

/**
 * 探测 m3u8 前 4096 字节判断是否为真多码率流（含 #EXT-X-STREAM-INF）还是仅 8 秒单分片 JPEG 预览
 */
async function probePlaylist(vurl) {
  if (!vurl) return { status: null, text: '' };
  try {
    const res = await fetchWithFailover(vurl, {
      referer: 'https://ow63.com/',
      limit: 4096,
    });
    return { status: res.status, text: res.text || '' };
  } catch {
    return { status: null, text: '' };
  }
}

function normalizeScreenPath(idOrUrl) {
  let vid = Array.isArray(idOrUrl) ? idOrUrl[0] : idOrUrl;
  vid = String(vid || '').trim();
  if (!vid) return '';

  if (vid.includes('@@@')) {
    vid = vid.split('@@@')[0].trim();
  }
  if (vid.includes('$')) {
    const prefix = vid.slice(0, vid.indexOf('$'));
    if (!prefix.startsWith('http') && !prefix.startsWith('/')) {
      vid = vid.slice(vid.indexOf('$') + 1).trim();
    }
  }

  if (vid.includes('/zh/screen/')) {
    return vid.slice(vid.indexOf('/zh/screen/'));
  }
  vid = vid.replace(/^\/+/, '');
  if (vid.startsWith('zh/screen/')) {
    vid = vid.slice('zh/screen/'.length);
  }
  return '/zh/screen/' + vid;
}

function stripEpisodeWrapper(rawId) {
  let s = Array.isArray(rawId) ? rawId[0] : rawId;
  s = String(s || '').trim();
  if (s.includes('@@@')) {
    s = s.split('@@@')[0].trim();
  }
  if (s.includes('$')) {
    const idx = s.indexOf('$');
    const prefix = s.slice(0, idx);
    if (!prefix.startsWith('http') && !prefix.startsWith('/')) {
      s = s.slice(idx + 1).trim();
    }
  }
  return s;
}

/**
 * 备用流地址解析：当页面未命中标准 videoData.video_url 时，尝试 CMS player_aaaa 或直链匹配
 */
function fallbackExtractStream(html) {
  if (!html || typeof html !== 'string') return '';
  const d = extractVideoData(html);
  if (d && d.video_url) return String(d.video_url).trim();

  for (const marker of ['player_aaaa', 'player_data', 'player_config']) {
    const cfg = extractBalancedJson(html, marker);
    if (cfg && cfg.url) {
      let u = String(cfg.url).replace(/\\\//g, '/').trim();
      if (cfg.encrypt === 1 || cfg.encrypt === '1') {
        try {
          u = unescape(u);
        } catch {}
      } else if (cfg.encrypt === 2 || cfg.encrypt === '2') {
        try {
          u = unescape(Buffer.from(u, 'base64').toString('utf8'));
        } catch {}
      }
      if (u.startsWith('http')) return u;
    }
  }

  const normalized = html.replace(/\\\//g, '/');
  const m3u8Match = normalized.match(
    /https?:\/\/[^\s"'<>\\]+\.m3u8(?:\?[^\s"'<>\\]*)?/i
  );
  if (m3u8Match) return m3u8Match[0];

  const mp4Match = normalized.match(
    /https?:\/\/[^\s"'<>\\]+\.mp4(?:\?[^\s"'<>\\]*)?/i
  );
  if (mp4Match && !/preview\.mp4|sample\.mp4|trailer\.mp4/i.test(mp4Match[0])) {
    return mp4Match[0];
  }
  return '';
}

async function init() {
  return {};
}

async function home() {
  const classes = CATS.map(([type_id, type_name]) => ({ type_id, type_name }));
  const list = await getHomeVods();
  return {
    class: classes,
    filters: {},
    list,
    style: STYLE,
  };
}

async function category(inReq) {
  const params = getParams(inReq);
  const tid = String(params.id || params.tid || params.type_id || 'new-release').trim();
  let pg = parseInt(params.page || params.pg || '1', 10);
  if (!Number.isFinite(pg) || pg <= 0) pg = 1;

  const path =
    pg <= 1
      ? `/zh/${tid}?order=latest`
      : `/zh/${tid}/page/${pg}?order=latest`;
  const text = await getPage(path);
  const vods = parseCards(text);

  return {
    list: vods,
    page: pg,
    pagecount: vods.length > 0 ? pg + 1 : pg,
    limit: vods.length,
    total: vods.length,
    style: STYLE,
  };
}

async function search(inReq) {
  const params = getParams(inReq);
  const key = String(params.wd || params.key || params.keyword || '').trim();
  if (!key) return { list: [] };
  const pg = parseInt(params.page || params.pg || '1', 10);
  const path =
    pg > 1
      ? `/zh/lookup/page/${pg}?keyword=${encodeURIComponent(key)}`
      : `/zh/lookup?keyword=${encodeURIComponent(key)}`;
  const text = await getPage(path);
  const vods = parseCards(text);
  return {
    list: vods,
    page: Number.isFinite(pg) && pg > 0 ? pg : 1,
  };
}

async function detail(inReq) {
  const params = getParams(inReq);
  const rawId = params.id || params.ids || params.url || '';
  if (!rawId) return { list: [] };

  const pagePath = normalizeScreenPath(rawId);
  const vidSlug = pagePath.replace(/^\/zh\/screen\//, '');
  const text = await getPage(pagePath);
  const d = text ? extractVideoData(text) : null;
  if (!d) return { list: [] };

  const title = String(d.title || vidSlug).trim();
  const pic = firstImg(d.thumbnail_loc || d.preview || d.images || '');
  const duration = String(d.duration || '').trim();
  const fanhao = String(d.fanhao || '').trim();
  const stype = String(d.sourceType || '').trim();

  const descLines = [];
  if (fanhao) descLines.push('番号：' + fanhao);
  const actors = d.actor || d.actors || [];
  if (Array.isArray(actors) && actors.length > 0) {
    descLines.push('演员：' + actors.slice(0, 6).map(String).join('、'));
  }
  const maker = d.makers || d.maker || d.studio || '';
  if (maker) descLines.push('厂商：' + String(maker));
  if (d.faxing) descLines.push('发行：' + String(d.faxing));
  if (d.release_date) descLines.push('发布：' + String(d.release_date));
  if (d.rating) descLines.push('评分：' + String(d.rating));
  if (d.view_count) descLines.push('播放：' + String(d.view_count));
  const tags = d.genres || d.tag || d.tags || [];
  if (Array.isArray(tags) && tags.length > 0) {
    descLines.push('标签：' + tags.slice(0, 10).map(String).join('、'));
  }
  const sdesc = d.s_description || '';
  if (sdesc) descLines.push('简介：' + String(sdesc));
  const vodContent = descLines.join('<br/>');

  const vurl = String(d.video_url || fallbackExtractStream(text) || '').trim();
  let playUrl = '';
  let remarkTag = '';

  if (vurl) {
    if (vurl.includes('playergo.top') || stype === 'missav') {
      const { status, text: m3u8Txt } = await probePlaylist(vurl);
      if (status === 200 && m3u8Txt.includes('#EXT-X-STREAM-INF')) {
        playUrl = `在线播放$${pagePath}`;
        remarkTag = '在线';
        setPlayCache(pagePath, vurl);
      } else if (status === 200) {
        remarkTag = '仅预览';
      } else {
        // 预检网络失败不阻拦，放行让播放器尝试
        playUrl = `在线播放$${pagePath}`;
        remarkTag = '在线';
        setPlayCache(pagePath, vurl);
      }
    } else {
      playUrl = `在线播放$${pagePath}`;
      remarkTag = '在线';
      setPlayCache(pagePath, vurl);
    }
  }

  const remarks = [duration, fanhao, remarkTag].filter(Boolean).join(' / ');
  const vod = {
    vod_id: pagePath,
    vod_name: title,
    vod_pic: pic,
    vod_remarks: remarks,
    vod_actor: Array.isArray(actors) ? actors.slice(0, 6).map(String).join('、') : '',
    vod_director: maker ? String(maker) : '',
    vod_year: d.release_date ? String(d.release_date) : '',
    vod_content: vodContent,
    vod_play_from: 'ow63',
    vod_play_url: playUrl,
  };

  return { list: [vod] };
}

async function play(inReq) {
  const params = getParams(inReq);
  const rawId = params.id || params.url || '';
  const url = stripEpisodeWrapper(rawId);

  const playHeaders = {
    Referer: 'https://ow63.com/',
    'User-Agent': UA,
  };

  let vurl = '';
  if (url.includes('/zh/screen/') || (!url.startsWith('http') && url)) {
    const path = normalizeScreenPath(url);
    const text = await getPage(path);
    if (text) {
      const d = extractVideoData(text);
      vurl = String((d && d.video_url) || fallbackExtractStream(text) || '').trim();
      if (vurl) setPlayCache(path, vurl);
    }
    if (!vurl) {
      vurl = getPlayCache(path) || '';
    }
  } else if (url) {
    vurl = url;
  }

  if (!vurl) {
    return {
      parse: 0,
      url: '',
      msg: '未找到播放地址',
      header: playHeaders,
      headers: playHeaders,
    };
  }

  if (vurl.includes('playergo.top')) {
    const { status, text: m3u8Txt } = await probePlaylist(vurl);
    if (status === 200 && !m3u8Txt.includes('#EXT-X-STREAM-INF')) {
      return {
        parse: 0,
        url: '',
        msg: '该条目暂无在线播放源（仅预览图）',
        header: playHeaders,
        headers: playHeaders,
      };
    }
  }

  return {
    parse: 0,
    jx: 0,
    url: vurl,
    header: playHeaders,
    headers: playHeaders,
  };
}

async function proxyPicHandler(query = {}) {
  const picUrl = String(query.url || query.pic || '').trim();
  if (!picUrl) {
    return { mime: 'text/plain', data: Buffer.from('') };
  }
  try {
    const res = await req.get(picUrl, {
      headers: {
        'User-Agent': UA,
        Referer: 'https://ow63.com/',
        Cookie: PASS_COOKIE,
      },
      timeout: TIMEOUT_MS,
      responseType: 'arraybuffer',
    });
    const mime =
      res?.headers?.['content-type'] ||
      res?.headers?.['Content-Type'] ||
      'image/jpeg';
    const data = Buffer.isBuffer(res?.data)
      ? res.data
      : Buffer.from(res?.data || '');
    return { mime, data };
  } catch {
    return { mime: 'text/plain', data: Buffer.from('') };
  }
}

export default {
  meta: {
    key: 'ow63',
    name: 'ow63',
    type: 3,
  },
  api: async (fastify) => {
    fastify.post('/init', init);
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/ow63_pic', async (request, reply) => {
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