import req from '../../util/req.js';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

const SITE_DOMAINS = [
  'https://www.haijiaolove.xyz',
  'https://haijiaolove.xyz',
];
const PLAYER_DOMAINS = [
  'https://v.haijiaolove.xyz',
  'https://player.abyssplayer.com',
];
let activeDomain = SITE_DOMAINS[0];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const DEFAULT_HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Accept-Encoding': 'identity',
};

const CATEGORIES = {
  zjgx: '最近更新',
  hjmz: '海角母子',
  hjjd: '海角姐弟',
  hjfn: '海角父女',
  hjsz: '海角嫂子',
  hjwf: '海角人妻',
  origin: '海角原创',
  hjsets: '海角合集',
  hjhj: '合集大全',
  hjrq: '热剧推荐',
  hjyc: '原创精选',
};

const WP_CAT = {
  hjhj: 357,
  hjrq: 355,
  hjyc: 323,
};

const ENCRYPT_HEAD = 65536; // 前 64KB 为 AES-CTR 加密, 其余明文
const UPSTREAM_CHUNK = 512 * 1024; // 单次分片拉取 512KB
const MAX_OPEN_RANGE_BYTES = 2 * 1024 * 1024; // 开放式 Range (如 bytes=0-) 单次返回 2MB 窗口，避免整片拉取阻塞首屏
const PLAY_CACHE = new Map();
const PLAY_CACHE_TTL = 10 * 60 * 1000;
const SIZE_CACHE = new Map();
const STREAM_KEY_CACHE = new Map();

let proxyServer = null;
let proxyPort = 0;

// ---------------- AES-CTR 解密工具 (支持 128/192/256 位密钥与纯算法回退) ----------------

const SBOX = new Uint8Array([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
  0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
  0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
  0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
  0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
  0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
  0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
  0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
  0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
  0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16,
]);

function xtime(a) {
  return a & 0x80 ? ((a << 1) ^ 0x1b) & 0xff : (a << 1) & 0xff;
}

function nrFor(klen) {
  return klen === 16 ? 10 : klen === 24 ? 12 : 14;
}

function aesKeyExpand(key) {
  const nk = key.length >>> 2;
  const nr = nrFor(key.length);
  const totalWords = 4 * (nr + 1);
  const w = new Uint32Array(totalWords);
  const rcon = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
  for (let i = 0; i < nk; i++) {
    w[i] =
      ((key[4 * i] << 24) |
        (key[4 * i + 1] << 16) |
        (key[4 * i + 2] << 8) |
        key[4 * i + 3]) >>>
      0;
  }
  for (let i = nk; i < totalWords; i++) {
    let t = w[i - 1];
    if (i % nk === 0) {
      t = ((t << 8) | (t >>> 24)) >>> 0;
      t =
        (((SBOX[(t >>> 24) & 0xff] << 24) |
          (SBOX[(t >>> 16) & 0xff] << 16) |
          (SBOX[(t >>> 8) & 0xff] << 8) |
          SBOX[t & 0xff]) ^
          (rcon[(i / nk - 1) | 0] << 24)) >>>
        0;
    } else if (nk > 6 && i % nk === 4) {
      t =
        ((SBOX[(t >>> 24) & 0xff] << 24) |
          (SBOX[(t >>> 16) & 0xff] << 16) |
          (SBOX[(t >>> 8) & 0xff] << 8) |
          SBOX[t & 0xff]) >>>
        0;
    }
    w[i] = (w[i - nk] ^ t) >>> 0;
  }
  return w;
}

function aesEncBlock(w, nr, block) {
  const s = [
    [block[0], block[1], block[2], block[3]],
    [block[4], block[5], block[6], block[7]],
    [block[8], block[9], block[10], block[11]],
    [block[12], block[13], block[14], block[15]],
  ];
  const ark = (rnd) => {
    for (let c = 0; c < 4; c++) {
      const word = w[rnd * 4 + c];
      s[c][0] ^= (word >>> 24) & 0xff;
      s[c][1] ^= (word >>> 16) & 0xff;
      s[c][2] ^= (word >>> 8) & 0xff;
      s[c][3] ^= word & 0xff;
    }
  };
  const sb = () => {
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        s[c][r] = SBOX[s[c][r]];
      }
    }
  };
  const sr = () => {
    for (let r = 1; r < 4; r++) {
      const tmp = [s[0][r], s[1][r], s[2][r], s[3][r]];
      for (let c = 0; c < 4; c++) {
        s[c][r] = tmp[(c + r) % 4];
      }
    }
  };
  const mc = () => {
    for (let c = 0; c < 4; c++) {
      const a0 = s[c][0],
        a1 = s[c][1],
        a2 = s[c][2],
        a3 = s[c][3];
      s[c][0] = xtime(a0) ^ (a1 ^ xtime(a1)) ^ a2 ^ a3;
      s[c][1] = a0 ^ xtime(a1) ^ (a2 ^ xtime(a2)) ^ a3;
      s[c][2] = a0 ^ a1 ^ xtime(a2) ^ (a3 ^ xtime(a3));
      s[c][3] = (a0 ^ xtime(a0)) ^ a1 ^ a2 ^ xtime(a3);
    }
  };
  ark(0);
  for (let rnd = 1; rnd < nr; rnd++) {
    sb();
    sr();
    mc();
    ark(rnd);
  }
  sb();
  sr();
  ark(nr);
  const out = new Uint8Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = s[c][r];
    }
  }
  return out;
}

function addCounterOffset(ivBuf, blockOffset) {
  const counter = Buffer.from(ivBuf.subarray(0, 16));
  let carry = BigInt(blockOffset);
  for (let i = 15; i >= 0 && carry > 0n; i--) {
    const sum = BigInt(counter[i]) + (carry & 0xffn);
    counter[i] = Number(sum & 0xffn);
    carry = (carry >> 8n) + (sum >> 8n);
  }
  return counter;
}

export function aesCtrDecrypt(keyInput, counterInput, dataInput) {
  const key = Buffer.isBuffer(keyInput) ? keyInput : Buffer.from(keyInput);
  const rawCounter = Buffer.isBuffer(counterInput) ? counterInput : Buffer.from(counterInput);
  const counter = Buffer.alloc(16);
  rawCounter.copy(counter, 0, 0, Math.min(16, rawCounter.length));
  const data = Buffer.isBuffer(dataInput) ? dataInput : Buffer.from(dataInput);

  const algo =
    key.length === 16
      ? 'aes-128-ctr'
      : key.length === 24
        ? 'aes-192-ctr'
        : key.length === 32
          ? 'aes-256-ctr'
          : '';

  if (algo) {
    try {
      const decipher = crypto.createDecipheriv(algo, key, counter);
      return Buffer.concat([decipher.update(data), decipher.final()]);
    } catch (_) {
      // Fallback to pure JS implementation below
    }
  }

  const normKey =
    key.length === 16 || key.length === 24 || key.length === 32
      ? key
      : key.length > 32
        ? key.subarray(0, 32)
        : key.length > 16
          ? key.subarray(0, 16)
          : (() => {
              const b = Buffer.alloc(16);
              key.copy(b);
              return b;
            })();

  const w = aesKeyExpand(normKey);
  const nr = nrFor(normKey.length);
  const out = Buffer.allocUnsafe(data.length);
  const ctr = new Uint8Array(counter);
  for (let i = 0; i < data.length; i += 16) {
    const ks = aesEncBlock(w, nr, ctr);
    const rem = Math.min(16, data.length - i);
    for (let j = 0; j < rem; j++) {
      out[i + j] = data[i + j] ^ ks[j];
    }
    for (let k = 15; k >= 0; k--) {
      ctr[k] = (ctr[k] + 1) & 0xff;
      if (ctr[k] !== 0) break;
    }
  }
  return out;
}

function tryParseJson(str) {
  if (!str || typeof str !== 'string') return null;
  const cleaned = str.replace(/^\uFEFF/, '').replace(/\0+$/g, '').trim();
  if (!cleaned) return null;
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (_) {}
  return null;
}

export function decryptDatas(htmlOrBase64, externalKey = '', externalIv = '') {
  if (!htmlOrBase64) return null;
  const rawInput = String(htmlOrBase64).trim();
  let b64 = rawInput;
  let scriptKey = externalKey ? String(externalKey) : '';
  let scriptIv = externalIv ? String(externalIv) : '';

  const inlineCallMatch = rawInput.match(
    /decryptDatas\s*\(\s*["'`]([A-Za-z0-9+/=_-]{16,})["'`]\s*(?:,\s*["'`]([^"'`]+)["'`])?\s*(?:,\s*["'`]([^"'`]+)["'`])?\s*\)/
  );
  const datasVarMatch =
    rawInput.match(/(?:(?:const|let|var)\s+|window\.)?datas\s*=\s*["'`]([^"'`]+)["'`]/) ||
    rawInput.match(/decryptDatas\s*\(\s*["'`]([^"'`]+)["'`]/);

  if (inlineCallMatch) {
    b64 = inlineCallMatch[1].trim();
    if (!scriptKey && inlineCallMatch[2]) scriptKey = inlineCallMatch[2];
    if (!scriptIv && inlineCallMatch[3]) scriptIv = inlineCallMatch[3];
  } else if (datasVarMatch) {
    b64 = datasVarMatch[1].trim();
  }

  if (!scriptKey) {
    const varCallMatch =
      rawInput.match(/decryptDatas\s*\(\s*[A-Za-z0-9_$]+\s*,\s*["'`]([^"'`]+)["'`](?:\s*,\s*["'`]([^"'`]+)["'`])?/) ||
      rawInput.match(/(?:Utf8\.parse|TextEncoder\(\)\.encode)\s*\(\s*["'`]([^"'`]{8,64})["'`]\s*\)/) ||
      rawInput.match(/(?:const|let|var)\s+(?:key|secret|aesKey)\s*=\s*["'`]([^"'`]{8,64})["'`]/i);
    if (varCallMatch) {
      scriptKey = varCallMatch[1];
      if (!scriptIv && varCallMatch[2]) scriptIv = varCallMatch[2];
    }
  }

  const rawBuf = Buffer.from(b64.replace(/\s+/g, ''), 'base64');
  const decodeModes = ['latin1', 'utf8'];

  for (const mode of decodeModes) {
    const obj = tryParseJson(rawBuf.toString(mode));
    if (!obj) continue;

    if (obj.media !== undefined && obj.user_id !== undefined) {
      const keyStr = `${obj.user_id}:${obj.slug ?? ''}:${obj.md5_id ?? ''}`;
      const md5Hex = crypto.createHash('md5').update(keyStr, 'utf8').digest('hex');
      const md5Raw = crypto.createHash('md5').update(keyStr, 'utf8').digest();
      const fullKey = Buffer.from(md5Hex, 'utf8'); // 32 bytes (AES-256-CTR)
      const shortKey = fullKey.subarray(0, 16); // 16 bytes (AES-128-CTR)
      const iv = fullKey.subarray(0, 16);

      const mediaStr = String(obj.media);
      const mediaCandidates = [
        Buffer.from(mediaStr, 'latin1'),
        Buffer.from(mediaStr, 'base64'),
      ];
      if (/^[0-9a-fA-F]+$/.test(mediaStr) && mediaStr.length % 2 === 0) {
        mediaCandidates.push(Buffer.from(mediaStr, 'hex'));
      }

      const keyIvPairs = [
        [fullKey, iv],
        [shortKey, iv],
        [md5Raw, md5Raw],
      ];
      if (scriptKey) {
        const sk = Buffer.from(scriptKey, 'utf8');
        const siv = scriptIv ? Buffer.from(scriptIv, 'utf8') : sk.subarray(0, 16);
        keyIvPairs.unshift([sk, siv]);
      }

      for (const mediaBuf of mediaCandidates) {
        if (!mediaBuf || mediaBuf.length === 0) continue;
        for (const [k, counterIv] of keyIvPairs) {
          try {
            const plain = aesCtrDecrypt(k, counterIv, mediaBuf);
            const parsed =
              tryParseJson(plain.toString('utf8')) ||
              tryParseJson(plain.toString('latin1'));
            if (parsed) return parsed;
          } catch (_) {}
        }
      }
    }

    const effectiveKey = obj.key || scriptKey;
    if (obj.encryptedData && effectiveKey) {
      const kBuf = Buffer.from(String(effectiveKey), 'utf8');
      const ivSource = obj.iv || scriptIv;
      const ivBuf = ivSource ? Buffer.from(String(ivSource), 'utf8') : kBuf.subarray(0, 16);
      const cipherCandidates = [
        Buffer.from(String(obj.encryptedData), 'base64'),
        Buffer.from(String(obj.encryptedData), 'latin1'),
      ];
      for (const cipherBuf of cipherCandidates) {
        for (const candidateKey of [kBuf, kBuf.subarray(0, 16)]) {
          try {
            const plain = aesCtrDecrypt(candidateKey, ivBuf, cipherBuf);
            const parsed =
              tryParseJson(plain.toString('utf8')) ||
              tryParseJson(plain.toString('latin1'));
            if (parsed) return parsed;
          } catch (_) {}
        }
      }
    }

    if (obj.mp4 || obj.m3u8 || obj.url || obj.playUrl || obj.videoUrl || obj.sources) {
      return obj;
    }
  }

  // 若外层直接是 Base64 密文并携带外部密钥 scriptKey
  if (scriptKey && rawBuf.length > 0) {
    const kBuf = Buffer.from(scriptKey, 'utf8');
    const ivBuf = scriptIv ? Buffer.from(scriptIv, 'utf8') : kBuf.subarray(0, 16);
    for (const candidateKey of [kBuf, kBuf.subarray(0, 16)]) {
      try {
        const plain = aesCtrDecrypt(candidateKey, ivBuf, rawBuf);
        const parsed =
          tryParseJson(plain.toString('utf8')) ||
          tryParseJson(plain.toString('latin1'));
        if (parsed) return parsed;
      } catch (_) {}
    }
  }

  return null;
}

// ---------------- 工具与网络请求层 ----------------

function decodeHtmlEntities(str = '') {
  return String(str)
    .replace(/&amp;/gi, '&')
    .replace(/&#038;/gi, '&')
    .replace(/&#38;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&#8211;/gi, '–')
    .replace(/&#8217;/gi, '’')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function unescapeJsUrl(str = '') {
  if (!str) return '';
  let s = String(str).trim();
  s = s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\//g, '/');
  return decodeHtmlEntities(s);
}

function customUnescape(str = '') {
  return String(str)
    .replace(/%u([0-9a-fA-F]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/%([0-9a-fA-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function unwrapParams(inReq) {
  const merged = {};
  const sources = [inReq?.params, inReq?.query, inReq?.body];
  for (const src of sources) {
    if (!src) continue;
    if (typeof src === 'string') {
      const s = src.trim();
      if (!s) continue;
      if (s.startsWith('{')) {
        try {
          Object.assign(merged, JSON.parse(s));
          continue;
        } catch (_) {}
      }
      try {
        const sp = new URLSearchParams(s);
        for (const [k, v] of sp.entries()) merged[k] = v;
      } catch (_) {}
    } else if (typeof src === 'object') {
      Object.assign(merged, src);
    }
  }
  return merged;
}

function isKnownSiteHost(hostname) {
  if (!hostname) return false;
  const lower = String(hostname).toLowerCase();
  if (lower.includes('haijiaolove')) return true;
  return SITE_DOMAINS.some((d) => {
    try {
      return new URL(d).hostname.toLowerCase() === lower;
    } catch (_) {
      return false;
    }
  });
}

function normalizePicUrl(url) {
  if (!url) return '';
  let u = decodeHtmlEntities(String(url).trim());
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('http://')) {
    try {
      const parsed = new URL(u);
      if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
        u = u.replace(/^http:\/\//i, 'https://');
      }
    } catch (_) {}
  }
  if (u.startsWith('/')) return `${activeDomain}${u}`;
  try {
    const parsed = new URL(u);
    if (isKnownSiteHost(parsed.hostname)) {
      return `${activeDomain.replace(/\/$/, '')}${parsed.pathname}${parsed.search}`;
    }
  } catch (_) {}
  return u;
}

function buildCandidateUrls(urlOrPath) {
  const raw = decodeHtmlEntities(String(urlOrPath || '').trim());
  if (!raw) return [];
  const domains = [activeDomain, ...SITE_DOMAINS.filter((d) => d !== activeDomain)];
  const addUnique = (arr, item) => {
    if (item && !arr.includes(item)) arr.push(item);
  };

  if (raw.startsWith('/')) {
    const out = [];
    if (raw.startsWith('/?v=')) {
      for (const pd of PLAYER_DOMAINS) addUnique(out, `${pd.replace(/\/$/, '')}${raw}`);
    }
    for (const d of domains) addUnique(out, `${d.replace(/\/$/, '')}${raw}`);
    return out;
  }

  try {
    const parsed = new URL(raw);
    const suffix = `${parsed.pathname}${parsed.search}`;
    const isPlayerQuery =
      parsed.search.includes('v=') ||
      parsed.hostname.toLowerCase().startsWith('v.haijiaolove') ||
      parsed.hostname.toLowerCase().includes('abyssplayer');

    if (isPlayerQuery && (parsed.pathname === '/' || parsed.pathname === '')) {
      const out = [];
      // 若原地址明确指向站点主域名 (如测试桩或站点直出播放器)，同时将 v. 子域与主域加入候选池
      if (parsed.hostname.toLowerCase().startsWith('v.haijiaolove')) {
        addUnique(out, raw);
        for (const d of domains) addUnique(out, `${d.replace(/\/$/, '')}${suffix}`);
      } else {
        addUnique(out, `https://v.haijiaolove.xyz${suffix}`);
        addUnique(out, raw);
        for (const d of domains) addUnique(out, `${d.replace(/\/$/, '')}${suffix}`);
      }
      return out;
    }

    if (isKnownSiteHost(parsed.hostname)) {
      const out = [];
      for (const d of domains) addUnique(out, `${d.replace(/\/$/, '')}${suffix}`);
      addUnique(out, raw);
      return out;
    }
  } catch (_) {}
  return [raw];
}

function isLikelyValidSiteContent(text, urlStr) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch (_) {}
  }
  const lower = trimmed.toLowerCase();
  if (
    lower.includes('domain parked') ||
    lower.includes('buy this domain') ||
    lower.includes('this domain is for sale')
  ) {
    return false;
  }
  const isPlayerUrl =
    urlStr.includes('?v=') ||
    urlStr.includes('v.haijiaolove') ||
    urlStr.includes('abyssplayer');
  if (isPlayerUrl) {
    return (
      trimmed.includes('datas') ||
      trimmed.includes('decryptDatas') ||
      trimmed.includes('.m3u8') ||
      trimmed.includes('.mp4') ||
      trimmed.includes('player_') ||
      trimmed.includes('playUrl') ||
      trimmed.includes('videoUrl') ||
      trimmed.includes('eval(function(p,a,c,k,e,d)') ||
      lower.includes('<video') ||
      lower.includes('<iframe')
    );
  }
  return (
    lower.includes('pt-cv-') ||
    lower.includes('entry-title') ||
    lower.includes('post-') ||
    lower.includes('<article') ||
    lower.includes('<iframe') ||
    lower.includes('<video') ||
    lower.includes('<h1') ||
    lower.includes('datas') ||
    lower.includes('decryptdatas') ||
    lower.includes('player_') ||
    lower.includes('.m3u8') ||
    lower.includes('.mp4')
  );
}

function rawHttpRequest(urlStr, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (err) {
      return reject(err);
    }
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const headers = {
      ...DEFAULT_HEADERS,
      Host: parsed.host,
      Referer: options.referer || `${parsed.protocol}//${parsed.host}/`,
      ...(options.headers || {}),
    };
    if (options.range) {
      headers.Range = options.range;
    }

    const reqOpts = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method: options.method || 'GET',
      headers,
      timeout: options.timeout || 15000,
      rejectUnauthorized: false,
    };

    const clientReq = lib.request(reqOpts, (res) => {
      const status = res.statusCode || 0;
      const loc = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && loc && redirectCount < 5) {
        res.resume();
        const nextUrl = new URL(loc, urlStr).toString();
        return rawHttpRequest(nextUrl, options, redirectCount + 1).then(resolve, reject);
      }

      if (options.method === 'HEAD') {
        res.resume();
        return resolve({
          status,
          headers: res.headers,
          body: Buffer.alloc(0),
          finalUrl: urlStr,
        });
      }

      const chunks = [];
      let received = 0;
      const expectedLen = res.headers['content-length']
        ? parseInt(res.headers['content-length'], 10)
        : null;

      res.on('data', (chunk) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(buf);
        received += buf.length;
        if (expectedLen !== null && !Number.isNaN(expectedLen) && received >= expectedLen) {
          res.destroy();
        }
      });

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        let body = Buffer.concat(chunks);
        if (expectedLen !== null && !Number.isNaN(expectedLen) && body.length > expectedLen) {
          body = body.subarray(0, expectedLen);
        }
        const enc = String(res.headers['content-encoding'] || '').toLowerCase();
        if (enc.includes('gzip') && body.length > 0) {
          try {
            body = zlib.gunzipSync(body);
          } catch (_) {}
        }
        resolve({
          status,
          headers: res.headers,
          body,
          finalUrl: urlStr,
        });
      };

      res.on('end', finish);
      res.on('close', finish);
      res.on('error', (err) => {
        if (chunks.length > 0) finish();
        else reject(err);
      });
    });

    clientReq.on('timeout', () => {
      clientReq.destroy(new Error('Request timeout'));
    });
    clientReq.on('error', reject);
    clientReq.end();
  });
}

function synchronizeReferer(refererOpt, targetOrigin) {
  if (!refererOpt) return `${targetOrigin}/`;
  try {
    const parsedRef = new URL(refererOpt);
    if (isKnownSiteHost(parsedRef.hostname)) {
      const target = new URL(targetOrigin);
      return `${target.protocol}//${target.host}${parsedRef.pathname}${parsedRef.search}`;
    }
  } catch (_) {}
  return refererOpt;
}

async function fetchUrl(urlOrPath, options = {}) {
  const candidates = buildCandidateUrls(urlOrPath);
  let lastErr = null;
  let fallbackResult = null;

  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      const origin = `${parsed.protocol}//${parsed.host}`;
      const referer = synchronizeReferer(options.referer, origin);

      if (!options.range && !options.binary && req && typeof req.get === 'function') {
        try {
          const r = await req.get(candidate, {
            headers: {
              ...DEFAULT_HEADERS,
              Referer: referer,
              ...(options.headers || {}),
            },
          });
          if (r && (r.data !== undefined || r.body !== undefined)) {
            const rawData = r.data !== undefined ? r.data : r.body;
            const status = r.status || r.statusCode || 200;
            if (status < 400 && rawData !== undefined && rawData !== '') {
              const text =
                typeof rawData === 'string'
                  ? rawData
                  : Buffer.isBuffer(rawData)
                    ? rawData.toString('utf8')
                    : JSON.stringify(rawData);
              const resultObj = {
                status,
                headers: r.headers || {},
                text,
                body: Buffer.isBuffer(rawData) ? rawData : Buffer.from(text, 'utf8'),
                finalUrl: r.url || candidate,
              };
              if (isLikelyValidSiteContent(text, candidate)) {
                if (SITE_DOMAINS.includes(origin)) activeDomain = origin;
                return resultObj;
              }
              if (!fallbackResult) fallbackResult = resultObj;
            }
          }
        } catch (err) {
          lastErr = err;
        }
      }

      const res = await rawHttpRequest(candidate, {
        ...options,
        referer,
      });
      if (res.status > 0 && res.status < 400) {
        const text = res.body.toString('utf8');
        const resultObj = {
          ...res,
          text,
        };
        if (isLikelyValidSiteContent(text, candidate)) {
          try {
            const finalOrigin = new URL(res.finalUrl || candidate).origin;
            if (SITE_DOMAINS.includes(finalOrigin)) {
              activeDomain = finalOrigin;
            } else if (SITE_DOMAINS.includes(origin)) {
              activeDomain = origin;
            }
          } catch (_) {
            if (SITE_DOMAINS.includes(origin)) activeDomain = origin;
          }
          return resultObj;
        }
        if (!fallbackResult && text.length > 0) fallbackResult = resultObj;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  if (fallbackResult) return fallbackResult;
  if (lastErr) throw lastErr;
  return { status: 500, headers: {}, text: '', body: Buffer.alloc(0), finalUrl: '' };
}

function captureSizeFromHeaders(urlStr, headers) {
  if (!headers) return 0;
  const cr = String(headers['content-range'] || headers['Content-Range'] || '');
  const m = cr.match(/\/(\d+)\s*$/);
  if (m) {
    const total = parseInt(m[1], 10);
    if (total > 0) {
      SIZE_CACHE.set(urlStr, total);
      return total;
    }
  }
  return 0;
}

async function fetchBinaryRange(urlStr, rangeHeader, referer = '', tries = 3) {
  const effectiveReferer = referer || 'https://player.abyssplayer.com/';
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await rawHttpRequest(urlStr, {
        range: rangeHeader,
        referer: effectiveReferer,
        headers: { 'Accept-Encoding': 'identity' },
        timeout: 20000,
      });
      if (res.status === 416) {
        captureSizeFromHeaders(urlStr, res.headers);
        return res;
      }
      if (res.status > 0 && res.status < 400 && res.body.length > 0) {
        captureSizeFromHeaders(urlStr, res.headers);
        return res;
      }
    } catch (_) {}

    if (req && typeof req.get === 'function') {
      try {
        const r = await req.get(urlStr, {
          headers: {
            ...DEFAULT_HEADERS,
            Referer: effectiveReferer,
            ...(rangeHeader ? { Range: rangeHeader } : {}),
          },
          responseType: 'arraybuffer',
        });
        const status = r?.status || r?.statusCode || 200;
        const rawData = r?.data !== undefined ? r.data : r?.body;
        if (status < 400 && rawData !== undefined) {
          const body = Buffer.isBuffer(rawData)
            ? rawData
            : rawData instanceof ArrayBuffer
              ? Buffer.from(rawData)
              : ArrayBuffer.isView(rawData)
                ? Buffer.from(rawData.buffer, rawData.byteOffset, rawData.byteLength)
                : Buffer.from(String(rawData), 'latin1');
          if (body.length > 0) {
            captureSizeFromHeaders(urlStr, r.headers);
            return {
              status,
              headers: r.headers || {},
              body,
              finalUrl: r.url || urlStr,
            };
          }
        }
      } catch (_) {}
    }

    if (attempt < tries) {
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
  return { status: 502, headers: {}, body: Buffer.alloc(0), finalUrl: urlStr };
}

async function probeUpstreamSize(urlStr, referer = '') {
  if (SIZE_CACHE.has(urlStr)) return SIZE_CACHE.get(urlStr);
  const effectiveReferer = referer || 'https://player.abyssplayer.com/';
  try {
    const res = await rawHttpRequest(urlStr, {
      range: 'bytes=0-1',
      referer: effectiveReferer,
      timeout: 10000,
    });
    const fromCr = captureSizeFromHeaders(urlStr, res.headers);
    if (fromCr > 0) return fromCr;
    const cl = String(res.headers['content-length'] || '');
    if (res.status === 200 && cl) {
      const total = parseInt(cl, 10);
      if (total > 0) {
        SIZE_CACHE.set(urlStr, total);
        return total;
      }
    }
  } catch (_) {}
  try {
    const headRes = await rawHttpRequest(urlStr, {
      method: 'HEAD',
      referer: effectiveReferer,
      timeout: 8000,
    });
    const cl = String(headRes.headers['content-length'] || '');
    if (cl) {
      const total = parseInt(cl, 10);
      if (total > 0) {
        SIZE_CACHE.set(urlStr, total);
        return total;
      }
    }
  } catch (_) {}
  return 0;
}

// ---------------- 流式范围解密与代理层 ----------------

const MP4_FOURCC = new Set(['ftyp', 'moov', 'styp', 'free', 'wide', 'mdat', 'skip', 'pdin']);

function hasMp4BoxSignature(buf) {
  if (!buf || buf.length < 8) return false;
  const boxType = buf.subarray(4, 8).toString('latin1');
  return MP4_FOURCC.has(boxType);
}

function buildStreamKeyCandidates(kStr) {
  const cleanK = String(kStr || '');
  const md5Hex = crypto.createHash('md5').update(cleanK, 'utf8').digest('hex');
  const fullKey32 = Buffer.from(md5Hex, 'utf8'); // 默认标准 32-byte ASCII hex key
  const shortKey16 = fullKey32.subarray(0, 16);
  const rawMd5 = crypto.createHash('md5').update(cleanK, 'utf8').digest();

  const candidates = [
    { mode: 'aes', key: fullKey32, iv: fullKey32.subarray(0, 16) },
    { mode: 'aes', key: shortKey16, iv: shortKey16 },
    { mode: 'aes', key: rawMd5, iv: rawMd5 },
  ];

  const baseNoExt = cleanK.replace(/\.[a-z0-9]{2,5}$/i, '');
  if (baseNoExt && baseNoExt !== cleanK) {
    const noExtHex = crypto.createHash('md5').update(baseNoExt, 'utf8').digest('hex');
    const noExtKey32 = Buffer.from(noExtHex, 'utf8');
    candidates.push({ mode: 'aes', key: noExtKey32, iv: noExtKey32.subarray(0, 16) });
    candidates.push({ mode: 'aes', key: noExtKey32.subarray(0, 16), iv: noExtKey32.subarray(0, 16) });
  }

  if (cleanK.length === 16 || cleanK.length === 32) {
    const rawKey = Buffer.from(cleanK, 'utf8');
    candidates.push({ mode: 'aes', key: rawKey, iv: rawKey.subarray(0, 16) });
  }

  candidates.push({ mode: 'plain' });
  return candidates;
}

function selectStreamKeyConfig(u, kStr, blockZeroCipher) {
  const cacheKey = `${u}|${kStr}`;
  if (STREAM_KEY_CACHE.has(cacheKey)) {
    return STREAM_KEY_CACHE.get(cacheKey);
  }
  const candidates = buildStreamKeyCandidates(kStr);
  if (blockZeroCipher && blockZeroCipher.length >= 8) {
    const probeSlice = blockZeroCipher.subarray(0, Math.min(16, blockZeroCipher.length));
    for (const cand of candidates) {
      if (cand.mode === 'plain') {
        if (hasMp4BoxSignature(probeSlice)) {
          STREAM_KEY_CACHE.set(cacheKey, cand);
          return cand;
        }
      } else {
        const dec = aesCtrDecrypt(cand.key, cand.iv, probeSlice);
        if (hasMp4BoxSignature(dec)) {
          STREAM_KEY_CACHE.set(cacheKey, cand);
          return cand;
        }
      }
    }
  }
  return candidates[0];
}

async function fetchDecryptedSlice(u, k, ref, s, e) {
  const parts = [];
  let reachedEof = false;

  if (s < ENCRYPT_HEAD) {
    const a0 = Math.floor(s / 16) * 16;
    const a1 = e === null || e >= ENCRYPT_HEAD - 1 ? ENCRYPT_HEAD - 1 : e;
    const res = await fetchBinaryRange(u, `bytes=${a0}-${a1}`, ref);
    if (res.body.length > 0) {
      let encryptedChunk = res.body;
      // 若上游忽略 Range 返回 200 全量数据，截取对应对齐区间
      if (res.status === 200 && a0 > 0 && res.body.length > a0) {
        encryptedChunk = res.body.subarray(a0, a1 + 1);
      } else if (encryptedChunk.length > a1 - a0 + 1) {
        encryptedChunk = encryptedChunk.subarray(0, a1 - a0 + 1);
      }

      const keyCfg = selectStreamKeyConfig(
        u,
        k,
        a0 === 0 ? encryptedChunk : null
      );

      let plain;
      if (keyCfg.mode === 'plain') {
        plain = encryptedChunk;
      } else {
        const counter = addCounterOffset(keyCfg.iv, Math.floor(a0 / 16));
        plain = aesCtrDecrypt(keyCfg.key, counter, encryptedChunk);
      }

      const startOff = s - a0;
      const endOff = Math.min(plain.length, a1 - a0 + 1);
      if (endOff > startOff) {
        parts.push(plain.subarray(startOff, endOff));
      }
      if (encryptedChunk.length < a1 - a0 + 1) {
        reachedEof = true;
      }
    } else {
      reachedEof = true;
    }
  }

  if (reachedEof || (e !== null && e < ENCRYPT_HEAD)) {
    return Buffer.concat(parts);
  }

  let cur = Math.max(s, ENCRYPT_HEAD);
  const knownTotal = SIZE_CACHE.get(u) || 0;
  const effectiveEnd =
    e !== null
      ? e
      : knownTotal > 0
        ? Math.min(knownTotal - 1, s + MAX_OPEN_RANGE_BYTES - 1)
        : s + MAX_OPEN_RANGE_BYTES - 1;

  while (cur <= effectiveEnd) {
    const end =
      effectiveEnd - cur < UPSTREAM_CHUNK ? effectiveEnd : cur + UPSTREAM_CHUNK - 1;
    const res = await fetchBinaryRange(u, `bytes=${cur}-${end}`, ref);
    if (!res.body || res.body.length === 0 || res.status === 416) break;
    const needed = end - cur + 1;
    let slice = res.body;
    if (res.status === 200 && cur > 0 && res.body.length > cur) {
      slice = res.body.subarray(cur, end + 1);
    } else if (slice.length > needed) {
      slice = slice.subarray(0, needed);
    }
    parts.push(slice);
    cur += slice.length;
    if (slice.length < needed) break;
  }

  return Buffer.concat(parts);
}

function parseRangeHeader(rangeHeader, total) {
  if (!rangeHeader || !String(rangeHeader).startsWith('bytes=')) {
    return {
      hasRange: false,
      hasExplicitEnd: false,
      start: 0,
      end: total > 0 ? total - 1 : null,
    };
  }
  const spec = String(rangeHeader).replace(/^bytes=/i, '').split(',')[0].trim();
  const m = spec.match(/^(\d*)-(\d*)$/);
  if (!m) {
    return {
      hasRange: false,
      hasExplicitEnd: false,
      start: 0,
      end: total > 0 ? total - 1 : null,
    };
  }
  if (m[1] === '' && m[2] !== '') {
    const suffix = parseInt(m[2], 10);
    if (total > 0 && suffix > 0) {
      return {
        hasRange: true,
        hasExplicitEnd: true,
        start: Math.max(0, total - suffix),
        end: total - 1,
      };
    }
  }
  const start = m[1] ? parseInt(m[1], 10) : 0;
  const hasExplicitEnd = m[2] !== '';
  let end = total > 0 ? total - 1 : null;
  if (hasExplicitEnd) {
    const e2 = parseInt(m[2], 10);
    end = end === null ? e2 : Math.min(end, e2);
  }
  return { hasRange: true, hasExplicitEnd, start, end };
}

function rewriteM3u8Manifest(m3u8Text, baseUrl, proxyBasePath, ref) {
  const lines = String(m3u8Text || '').split(/\r?\n/);
  const rewritten = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      return line.replace(/URI=["']([^"']+)["']/gi, (_, uri) => {
        try {
          const absKey = new URL(uri, baseUrl).toString();
          const proxiedKey = `${proxyBasePath}?u=${encodeURIComponent(absKey)}&r=${encodeURIComponent(ref)}&type=key`;
          return `URI="${proxiedKey}"`;
        } catch (_) {
          return `URI="${uri}"`;
        }
      });
    }
    try {
      const absUrl = new URL(trimmed, baseUrl).toString();
      const lowerPath = new URL(absUrl).pathname.toLowerCase();
      const segType = lowerPath.endsWith('.m3u8') ? 'm3u8' : 'ts';
      return `${proxyBasePath}?u=${encodeURIComponent(absUrl)}&r=${encodeURIComponent(ref)}&type=${segType}`;
    } catch (_) {
      return line;
    }
  });
  return rewritten.join('\n');
}

async function handleStreamProxy(queryParams, reqHeaders, method = 'GET', proxyBasePath = '/proxy') {
  const u = decodeURIComponent(String(queryParams.u || queryParams.url || ''));
  const k = decodeURIComponent(String(queryParams.k || ''));
  const ref = decodeURIComponent(String(queryParams.r || queryParams.ref || 'https://player.abyssplayer.com/'));
  const explicitType = String(queryParams.type || '').toLowerCase();
  let total = parseInt(String(queryParams.s || '0'), 10) || 0;

  if (!u) {
    return {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: Buffer.from('Missing u parameter'),
    };
  }

  // 支持标准 HLS (.m3u8) 与伪装 TS 切片 (.jpg/.png/无后缀 + type=ts) 代理
  let pathnameLower = '';
  try {
    pathnameLower = new URL(u).pathname.toLowerCase();
  } catch (_) {
    pathnameLower = u.split('?')[0].toLowerCase();
  }

  if (!k && (explicitType === 'ts' || pathnameLower.endsWith('.ts'))) {
    const res = await fetchBinaryRange(u, '', ref, 2);
    return {
      status: res.status < 400 ? 200 : res.status,
      headers: {
        'Content-Type': 'video/mp2t',
        'Content-Length': String(res.body.length),
      },
      body: res.body,
    };
  }

  if (!k && (explicitType === 'key' || pathnameLower.endsWith('.key'))) {
    const res = await fetchBinaryRange(u, '', ref, 2);
    return {
      status: res.status < 400 ? 200 : res.status,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(res.body.length),
      },
      body: res.body,
    };
  }

  if (!k && (explicitType === 'm3u8' || pathnameLower.endsWith('.m3u8'))) {
    const res = await fetchUrl(u, { referer: ref });
    const rewritten = rewriteM3u8Manifest(res.text || '', res.finalUrl || u, proxyBasePath, ref);
    const body = Buffer.from(rewritten, 'utf8');
    return {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Content-Length': String(body.length),
      },
      body,
    };
  }

  if (!k) {
    return {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: Buffer.from('Missing u or k parameter'),
    };
  }

  if (!total) {
    total = await probeUpstreamSize(u, ref);
  } else {
    SIZE_CACHE.set(u, total);
  }

  const rngStr = reqHeaders?.range || reqHeaders?.Range || '';
  const { hasRange, hasExplicitEnd, start, end } = parseRangeHeader(rngStr, total);

  if (total > 0 && (start >= total || (end !== null && start > end))) {
    return {
      status: 416,
      headers: {
        'Content-Range': `bytes */${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: Buffer.from('Range Not Satisfiable'),
    };
  }

  let finalEnd = end === null && total > 0 ? total - 1 : end;
  // 若客户端发送开放式 Range: bytes=start- 且总大小超过单次窗口阈值，裁剪窗口以实现秒开
  if (hasRange && !hasExplicitEnd && total > MAX_OPEN_RANGE_BYTES) {
    finalEnd = Math.min(total - 1, start + MAX_OPEN_RANGE_BYTES - 1);
  }

  const status = hasRange ? 206 : 200;
  const respHeaders = {
    'Accept-Ranges': 'bytes',
    'Content-Type': 'video/mp4',
  };

  if (String(method).toUpperCase() === 'HEAD') {
    if (hasRange && total > 0 && finalEnd !== null) {
      respHeaders['Content-Range'] = `bytes ${start}-${finalEnd}/${total}`;
      respHeaders['Content-Length'] = String(finalEnd - start + 1);
    } else if (!hasRange && total > 0) {
      respHeaders['Content-Length'] = String(total);
    }
    return { status, headers: respHeaders, body: Buffer.alloc(0) };
  }

  const body = await fetchDecryptedSlice(u, k, ref, start, finalEnd);
  const discoveredTotal = total || SIZE_CACHE.get(u) || 0;

  if (hasRange) {
    const actualEnd = body.length > 0 ? start + body.length - 1 : finalEnd ?? start;
    const totalForHeader = discoveredTotal > 0 ? discoveredTotal : actualEnd + 1;
    respHeaders['Content-Range'] = `bytes ${start}-${actualEnd}/${totalForHeader}`;
    respHeaders['Content-Length'] = String(body.length);
  } else {
    respHeaders['Content-Length'] = String(body.length);
  }

  return { status, headers: respHeaders, body };
}

async function ensureLocalProxyServer() {
  if (proxyServer && proxyPort > 0) return proxyPort;

  const createHandler = () => async (reqObj, resObj) => {
    try {
      const parsed = new URL(reqObj.url || '/', 'http://127.0.0.1');
      if (
        !parsed.pathname.startsWith('/fd') &&
        !parsed.pathname.startsWith('/proxy')
      ) {
        resObj.writeHead(404);
        resObj.end('Not Found');
        return;
      }
      const q = Object.fromEntries(parsed.searchParams.entries());
      const result = await handleStreamProxy(
        q,
        reqObj.headers || {},
        reqObj.method || 'GET',
        parsed.pathname
      );
      resObj.writeHead(result.status, result.headers);
      if (reqObj.method === 'HEAD') {
        resObj.end();
      } else {
        resObj.end(result.body);
      }
    } catch (err) {
      if (!resObj.headersSent) {
        resObj.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      resObj.end(String(err?.message || err));
    }
  };

  for (let p = 9979; p <= 9989; p++) {
    try {
      await new Promise((resolve, reject) => {
        const srv = http.createServer(createHandler());
        srv.once('error', reject);
        srv.listen(p, '127.0.0.1', () => {
          srv.unref();
          proxyServer = srv;
          proxyPort = p;
          resolve(p);
        });
      });
      return proxyPort;
    } catch (_) {
      continue;
    }
  }
  return 0;
}

// ---------------- HTML 与分类/详情/播放解析逻辑 ----------------

function extractAttr(tag, attrNames) {
  if (!tag) return '';
  for (const attr of attrNames) {
    const escapedAttr = attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:^|[\\s"'/>])${escapedAttr}\\s*=\\s*["']([^"']*)["']`, 'gi');
    let m;
    while ((m = re.exec(tag)) !== null) {
      const val = decodeHtmlEntities((m[1] || '').trim());
      if (
        val &&
        !val.startsWith('about:blank') &&
        !val.startsWith('javascript:') &&
        !val.startsWith('data:') &&
        val !== '#'
      ) {
        return val;
      }
    }
  }
  return '';
}

function canonicalizeVodLink(rawLink) {
  if (!rawLink) return '';
  const link = decodeHtmlEntities(String(rawLink).trim());
  if (!link) return '';
  if (link.startsWith('/')) {
    return `${activeDomain.replace(/\/$/, '')}${link}`;
  }
  try {
    const parsed = new URL(link);
    if (isKnownSiteHost(parsed.hostname)) {
      return `${activeDomain.replace(/\/$/, '')}${parsed.pathname}${parsed.search}`;
    }
  } catch (_) {}
  return link;
}

function parseCategoryHtml(html) {
  const vods = [];
  const vodMap = new Map();

  const upsertVod = (rawLink, patch) => {
    const link = canonicalizeVodLink(rawLink);
    if (!link) return;
    let mapKey = link;
    try {
      const parsed = new URL(link);
      if (isKnownSiteHost(parsed.hostname)) {
        mapKey = `${parsed.pathname}${parsed.search}`;
      }
    } catch (_) {}

    if (!vodMap.has(mapKey)) {
      const mid = link.split('/').filter(Boolean).pop() || link;
      const item = {
        vod_id: link,
        vod_name: mid,
        vod_pic: '',
        vod_remarks: '',
      };
      vodMap.set(mapKey, item);
      vods.push(item);
    }
    const cur = vodMap.get(mapKey);
    if (patch.vod_name) cur.vod_name = decodeHtmlEntities(patch.vod_name.trim());
    if (patch.vod_pic) cur.vod_pic = normalizePicUrl(patch.vod_pic);
    if (patch.vod_remarks) cur.vod_remarks = decodeHtmlEntities(patch.vod_remarks.trim());
  };

  const thumbRe =
    /<a\s+[^>]*href=["']([^"']+?\.html)["'][^>]*class=["'][^"']*pt-cv-href-thumbnail[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = thumbRe.exec(html)) !== null) {
    const link = m[1];
    const inner = m[2];
    const imgMatch = inner.match(/<img\s+[^>]+>/i);
    const pic = imgMatch
      ? extractAttr(imgMatch[0], [
          'data-cvpsrc',
          'data-litespeed-src',
          'data-lazy-src',
          'data-src',
          'src',
        ])
      : '';
    upsertVod(link, { vod_pic: pic });
  }

  const titleRe =
    /class=["'][^"']*pt-cv-title[^"']*["'][^>]*>\s*<a\s+[^>]*href=["']([^"']+?\.html)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = titleRe.exec(html)) !== null) {
    const link = m[1];
    const title = m[2].replace(/<[^>]+>/g, '').trim();
    upsertVod(link, { vod_name: title });
  }

  let pagecount = 1;
  const tp = html.match(/data-totalpages=["'](\d+)["']/i);
  if (tp) {
    pagecount = Math.max(1, parseInt(tp[1], 10));
  }

  return { vods, pagecount };
}

function isIgnoredIframeUrl(urlStr) {
  const lower = String(urlStr || '').toLowerCase();
  return (
    lower.includes('googletagmanager.com') ||
    lower.includes('doubleclick.net') ||
    lower.includes('googlesyndication.com') ||
    lower.includes('facebook.com') ||
    lower.includes('disqus.com') ||
    lower.includes('wp-login.php') ||
    lower.includes('/ads/') ||
    lower.includes('stat.php')
  );
}

function isPreferredPlayerIframe(urlStr) {
  const lower = String(urlStr || '').toLowerCase();
  return (
    lower.includes('abyssplayer') ||
    lower.includes('v.haijiaolove') ||
    lower.includes('?v=') ||
    lower.includes('&v=') ||
    lower.includes('player') ||
    lower.includes('embed') ||
    lower.includes('dplayer') ||
    lower.includes('.m3u8') ||
    lower.includes('.mp4')
  );
}

function extractIframes(html) {
  const preferred = [];
  const others = [];
  const iframeRe = /<iframe\b[^>]*>/gi;
  let m;
  while ((m = iframeRe.exec(html)) !== null) {
    let f = extractAttr(m[0], [
      'data-litespeed-src',
      'data-lazy-src',
      'data-src',
      'data-original',
      'src',
    ]);
    if (!f) continue;
    f = unescapeJsUrl(f);
    if (f.startsWith('//')) f = 'https:' + f;
    else if (f.startsWith('/')) f = `${activeDomain.replace(/\/$/, '')}${f}`;
    else if (!f.startsWith('http')) f = 'https://' + f.replace(/^:+/, '');
    if (isIgnoredIframeUrl(f)) continue;
    if (isPreferredPlayerIframe(f)) {
      if (!preferred.includes(f)) preferred.push(f);
    } else {
      if (!others.includes(f)) others.push(f);
    }
  }

  // 若页面脚本中内联了播放器地址但被延迟渲染而未生成 <iframe> 标签，补充提取
  if (preferred.length === 0) {
    const normalized = unescapeJsUrl(html);
    const scriptPlayerRe =
      /https?:\/\/(?:v\.haijiaolove\.xyz|player\.abyssplayer\.com|(?:www\.)?haijiaolove\.xyz)\/\?v=[A-Za-z0-9_-]+/gi;
    while ((m = scriptPlayerRe.exec(normalized)) !== null) {
      const candidate = m[0];
      if (!preferred.includes(candidate)) preferred.push(candidate);
    }
  }

  return [...preferred, ...others];
}

function sanitizeEpisodeId(rawId) {
  let u = String(rawId || '').trim();
  if (u.includes('@@@')) u = u.split('@@@')[0].trim();
  if (u.includes('$')) {
    const idx = u.indexOf('$');
    const prefix = u.slice(0, idx);
    if (!prefix.startsWith('http') && !prefix.startsWith('/')) {
      u = u.slice(idx + 1).trim();
    }
  }
  return decodeHtmlEntities(u.split('#')[0].trim());
}

const DECOY_MEDIA_PATTERNS = [
  /preview\.mp4/i,
  /sample\.mp4/i,
  /trailer\.mp4/i,
  /top_banner/i,
  /native-ad/i,
  /stat\.php/i,
];

function isDecoyMediaUrl(urlStr) {
  const s = String(urlStr || '');
  return DECOY_MEDIA_PATTERNS.some((re) => re.test(s));
}

function isDirectMediaUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  const cleaned = unescapeJsUrl(urlStr.trim()).split('#')[0];
  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) return false;
  if (isDecoyMediaUrl(cleaned)) return false;
  try {
    const parsed = new URL(cleaned);
    const pathLower = parsed.pathname.toLowerCase();
    return /\.(?:m3u8|mp4|flv|m4s)(?:$|\?)/i.test(pathLower);
  } catch (_) {
    return /^https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:$|\?)/i.test(cleaned);
  }
}

function unwrapNestedMediaUrl(rawUrl, baseUrl = activeDomain) {
  if (!rawUrl) return '';
  let cur = unescapeJsUrl(String(rawUrl).trim());
  if (cur.startsWith('//')) cur = 'https:' + cur;
  else if (cur.startsWith('/')) {
    try {
      cur = new URL(cur, baseUrl).toString();
    } catch (_) {
      cur = `${activeDomain.replace(/\/$/, '')}${cur}`;
    }
  }

  if (isDirectMediaUrl(cur)) return cur;

  for (let pass = 0; pass < 2; pass++) {
    try {
      const parsed = new URL(cur, baseUrl);
      const innerRaw =
        parsed.searchParams.get('url') ||
        parsed.searchParams.get('vurl') ||
        parsed.searchParams.get('src') ||
        parsed.searchParams.get('file') ||
        '';
      if (!innerRaw) break;
      let decoded = innerRaw;
      for (let i = 0; i < 2; i++) {
        try {
          const next = decodeURIComponent(decoded);
          if (next === decoded) break;
          decoded = next;
        } catch (_) {
          decoded = customUnescape(decoded);
        }
      }
      decoded = unescapeJsUrl(decoded);
      if (decoded.startsWith('//')) decoded = 'https:' + decoded;
      else if (decoded.startsWith('/')) decoded = new URL(decoded, parsed.origin).toString();
      if (isDirectMediaUrl(decoded)) return decoded;
      cur = decoded;
    } catch (_) {
      break;
    }
  }

  return isDirectMediaUrl(cur) ? cur : '';
}

function unpackDeanEdwardsPacker(html) {
  if (!html || !html.includes('eval(function(p,a,c,k,e,')) return '';
  const unpackedBlocks = [];
  const packerRe =
    /eval\(function\(p,a,c,k,e,[dr]\)\{[\s\S]*?\}\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)/g;
  let m;
  while ((m = packerRe.exec(html)) !== null) {
    try {
      const payload = m[2];
      const radix = parseInt(m[3], 10);
      const count = parseInt(m[4], 10);
      const symtab = m[6].split('|');
      if (!radix || Number.isNaN(count)) continue;

      const encodeToken = (num) => {
        const prefix = num < radix ? '' : encodeToken(Math.floor(num / radix));
        const rem = num % radix;
        const ch =
          rem > 35 ? String.fromCharCode(rem + 29) : rem.toString(36);
        return prefix + ch;
      };

      const dict = new Map();
      for (let i = count - 1; i >= 0; i--) {
        const token = encodeToken(i);
        dict.set(token, symtab[i] || token);
      }

      const unpacked = payload.replace(/\b[0-9a-zA-Z_]+\b/g, (word) =>
        dict.has(word) ? dict.get(word) : word
      );
      unpackedBlocks.push(unpacked);
    } catch (_) {}
  }
  return unpackedBlocks.join('\n');
}

function extractBalancedJsonObject(text, varNames) {
  for (const name of varNames) {
    const re = new RegExp(`(?:var|let|const|window\\.)?\\s*${name}\\s*=\\s*\\{`, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      const startIdx = m.index + m[0].length - 1;
      let depth = 0;
      let inStr = false;
      let quoteChar = '';
      let escaped = false;
      for (let i = startIdx; i < text.length; i++) {
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
            const rawJson = text.slice(startIdx, i + 1);
            try {
              return JSON.parse(rawJson);
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

function decodeCmsPlayerUrl(rawUrl, encryptMode = 0) {
  let u = String(rawUrl || '').trim();
  if (!u) return '';
  const enc = Number(encryptMode || 0);
  if (enc === 1) {
    try {
      u = decodeURIComponent(customUnescape(u));
    } catch (_) {
      u = customUnescape(u);
    }
  } else if (enc === 2) {
    try {
      const b64Decoded = Buffer.from(u, 'base64').toString('utf8');
      try {
        u = decodeURIComponent(customUnescape(b64Decoded));
      } catch (_) {
        u = customUnescape(b64Decoded);
      }
    } catch (_) {}
  }
  return unescapeJsUrl(u);
}

function extractSourceFromManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return null;

  // 检查顶层是否直接返回了未加密流地址 (如 { url: "https://.../index.m3u8" })
  const directCandidates = [
    manifest.url,
    manifest.playUrl,
    manifest.videoUrl,
    manifest.m3u8,
    manifest.hls,
    manifest.file,
  ];
  for (const dc of directCandidates) {
    if (typeof dc === 'string') {
      const unwrapped = unwrapNestedMediaUrl(dc);
      if (unwrapped) {
        return { type: 'direct', url: unwrapped };
      }
    }
  }

  const mp4 = manifest.mp4 || manifest;
  const sources = Array.isArray(mp4.sources) ? mp4.sources : [];
  const firstDatas = Array.isArray(mp4.fristDatas)
    ? mp4.fristDatas
    : Array.isArray(mp4.firstDatas)
      ? mp4.firstDatas
      : [];

  let fallbackSize = 0;
  let fallbackPath = '';
  for (const fd of firstDatas) {
    if (fd && Number(fd.size) > 0 && !fallbackSize) {
      fallbackSize = Number(fd.size);
    }
    if (fd && fd.url && !fallbackPath) {
      try {
        const p = new URL(String(fd.url), 'https://v.haijiaolove.xyz');
        fallbackPath = `${p.pathname}${p.search}`;
      } catch (_) {
        fallbackPath = String(fd.url);
      }
    }
  }

  let use = null;
  for (const s0 of sources) {
    if (!s0 || !s0.url) continue;
    if (s0.status === false || s0.status === 0 || s0.status === '0') continue;
    const rawS0Url = String(s0.url);
    const rawS0Path = s0.path ? String(s0.path) : fallbackPath;
    if (rawS0Path) {
      use = {
        url: rawS0Url,
        path: rawS0Path,
        size: Number(s0.size || fallbackSize || 0),
        key: s0.key || mp4.key || manifest.key || '',
      };
      break;
    } else if (isDirectMediaUrl(rawS0Url)) {
      const parsed = new URL(rawS0Url);
      const segments = parsed.pathname.split('/').filter(Boolean);
      const fileName = segments.pop() || '';
      const dirPath = '/' + segments.join('/');
      use = {
        url: `${parsed.protocol}//${parsed.host}${dirPath}`,
        path: `${fileName}${parsed.search}`,
        size: Number(s0.size || fallbackSize || 0),
        key: s0.key || mp4.key || manifest.key || '',
      };
      break;
    }
  }

  if (!use && firstDatas.length > 0 && firstDatas[0]?.url) {
    const fu0 = String(firstDatas[0].url);
    try {
      const parsed = new URL(fu0);
      const segments = parsed.pathname.split('/').filter(Boolean);
      const fileName = segments.pop() || '';
      const dirPath = '/' + segments.join('/');
      use = {
        url: `${parsed.protocol}//${parsed.host}${dirPath}`,
        path: `${fileName}${parsed.search}`,
        size: Number(firstDatas[0].size || 0),
        key: firstDatas[0].key || mp4.key || manifest.key || '',
      };
    } catch (_) {
      const lastSlash = fu0.lastIndexOf('/');
      use = {
        url: lastSlash >= 0 ? fu0.slice(0, lastSlash) : activeDomain,
        path: lastSlash >= 0 ? fu0.slice(lastSlash + 1) : fu0,
        size: Number(firstDatas[0].size || 0),
        key: firstDatas[0].key || mp4.key || manifest.key || '',
      };
    }
  }

  if (!use) return null;

  const fu = `${use.url.replace(/\/+$/, '')}/${use.path.replace(/^\/+/, '')}`;
  // 若解析出的是 .m3u8 流，直接走直连播放而非 MP4 范围解密
  try {
    if (new URL(fu).pathname.toLowerCase().endsWith('.m3u8')) {
      return { type: 'direct', url: fu };
    }
  } catch (_) {}

  let fk = use.key ? String(use.key) : '';
  if (!fk) {
    try {
      const parsedFu = new URL(fu);
      fk = parsedFu.pathname.split('/').filter(Boolean).pop() || '';
    } catch (_) {
      fk = use.path.split('?')[0].split('/').pop() || '';
    }
  }
  const fs = String(use.size || 0);
  return { type: 'encrypted_mp4', fu, fk, fs };
}

function extractPlayStreamFromHtml(html, baseUrl = activeDomain) {
  if (!html || typeof html !== 'string') return null;

  const unpacked = unpackDeanEdwardsPacker(html);
  const combinedHtml = unpacked ? `${html}\n${unpacked}` : html;

  // 1. 优先解析 decryptDatas 加密 Manifest
  const manifest = decryptDatas(combinedHtml);
  const fromManifest = extractSourceFromManifest(manifest);
  if (fromManifest) {
    return fromManifest;
  }

  // 2. 解析 CMS player_aaaa / player_data / player_config
  const cmsObj = extractBalancedJsonObject(combinedHtml, [
    'player_aaaa',
    'player_data',
    'player_config',
  ]);
  if (cmsObj && cmsObj.url) {
    const decodedUrl = decodeCmsPlayerUrl(cmsObj.url, cmsObj.encrypt);
    const unwrapped = unwrapNestedMediaUrl(decodedUrl, baseUrl);
    if (unwrapped) {
      return { type: 'direct', url: unwrapped };
    }
  }

  const normalized = unescapeJsUrl(combinedHtml);

  // 3. 高优先级播放器配置变量 (过滤 freePlayUrl / preview.mp4 等试看诱饵)
  const priorityVarPatterns = [
    /(?:realPlayUrl|vipPlayUrl|authPlayUrl|m3u8Url|hlsUrl|streamUrl)\s*[:=]\s*["'`]([^"'`]+)["'`]/gi,
    /(?:video|dplayer|artplayer)\s*[:=]\s*\{[^{}]*?\burl\s*:\s*["'`]([^"'`]+)["'`]/gi,
    /(?:playUrl|videoUrl|normalPlayUrl)\s*[:=]\s*["'`]([^"'`]+)["'`]/gi,
  ];
  for (const re of priorityVarPatterns) {
    let m;
    while ((m = re.exec(normalized)) !== null) {
      const mediaUrl = unwrapNestedMediaUrl(m[1], baseUrl);
      if (mediaUrl) {
        return { type: 'direct', url: mediaUrl };
      }
    }
  }

  // 4. <video> 与 <source> 标签直链提取
  const videoTagRe = /<(?:video|source)\b[^>]*>/gi;
  let vm;
  while ((vm = videoTagRe.exec(normalized)) !== null) {
    const srcVal = extractAttr(vm[0], ['data-src', 'src']);
    const mediaUrl = unwrapNestedMediaUrl(srcVal, baseUrl);
    if (mediaUrl) {
      return { type: 'direct', url: mediaUrl };
    }
  }

  // 5. 全文直接匹配 .m3u8 / .mp4 (优先 .m3u8，且排除试看与诱饵)
  const m3u8Re = /https?:\/\/[^\s"'<>\\]+?\.m3u8(?:\?[^\s"'<>\\]*)?/gi;
  let mm;
  while ((mm = m3u8Re.exec(normalized)) !== null) {
    const candidate = unwrapNestedMediaUrl(mm[0], baseUrl);
    if (candidate) {
      return { type: 'direct', url: candidate };
    }
  }

  const mp4Re = /https?:\/\/[^\s"'<>\\]+?\.mp4(?:\?[^\s"'<>\\]*)?/gi;
  while ((mm = mp4Re.exec(normalized)) !== null) {
    const candidate = unwrapNestedMediaUrl(mm[0], baseUrl);
    if (candidate) {
      return { type: 'direct', url: candidate };
    }
  }

  return null;
}

function buildProxyPlayUrl(inReq, fu, fk, fs, ref, extraType = '') {
  const params = new URLSearchParams();
  params.set('u', fu);
  if (fk) params.set('k', fk);
  if (fs !== undefined && fs !== null && String(fs) !== '') params.set('s', String(fs));
  if (ref) params.set('r', ref);
  if (extraType) params.set('type', extraType);
  const q = params.toString();

  const hostHeader = String(inReq?.headers?.host || inReq?.headers?.Host || '').trim();
  const isLoopbackHost =
    !hostHeader ||
    hostHeader.startsWith('127.0.0.1') ||
    hostHeader.startsWith('localhost') ||
    hostHeader.startsWith('[::1]');

  const prefix =
    inReq?.server?.prefix ||
    String(inReq?.raw?.url || inReq?.url || '')
      .split('?')[0]
      .replace(/\/play\/?$/i, '');

  const endpointName = fk ? 'fd.mp4' : 'proxy.mp4';

  // 若请求来自局域网/Docker 远程客户端，优先走 Fastify 同源代理路由，避免 9979 端口未映射
  if (!isLoopbackHost && hostHeader && prefix) {
    const proto =
      inReq?.headers?.['x-forwarded-proto'] || inReq?.protocol || 'http';
    return `${proto}://${hostHeader}${prefix.replace(/\/$/, '')}/${endpointName}?${q}`;
  }

  // 若本地 Fastify 正在真实 TCP 端口上监听且携带路由前缀，也可通过本地代理端口或同源路由访问
  if (proxyPort > 0) {
    return `http://127.0.0.1:${proxyPort}/${endpointName}?${q}`;
  }

  if (prefix) {
    const host = hostHeader || '127.0.0.1';
    return `http://${host}${prefix.replace(/\/$/, '')}/${endpointName}?${q}`;
  }

  return `proxy://do=js&${q}`;
}

async function resolvePlayerUrl(rawUrl, depth = 0) {
  const cleanKey = sanitizeEpisodeId(rawUrl);
  if (!cleanKey) {
    return { type: 'sniff', url: '', ref: `${activeDomain}/` };
  }

  const cached = PLAY_CACHE.get(cleanKey) || PLAY_CACHE.get(rawUrl);
  if (cached && Date.now() - cached.ts < PLAY_CACHE_TTL) {
    return cached.data;
  }

  const cacheAndReturn = (data) => {
    const entry = { ts: Date.now(), data };
    PLAY_CACHE.set(cleanKey, entry);
    PLAY_CACHE.set(rawUrl, entry);
    return data;
  };

  let u = cleanKey;
  if (u.startsWith('//')) u = 'https:' + u;
  else if (!u.startsWith('http')) {
    u = `${activeDomain.replace(/\/$/, '')}/${u.replace(/^\/+/, '')}`;
  }

  // 若传入的已经是直接媒体流地址或包含外层 ?url= 包装器的地址，优先解包
  const unwrappedDirect = unwrapNestedMediaUrl(u, activeDomain);
  if (unwrappedDirect) {
    return cacheAndReturn({
      type: 'direct',
      url: unwrappedDirect,
      ref: `${activeDomain}/`,
    });
  }

  if (depth > 3) {
    return { type: 'sniff', url: u, ref: `${activeDomain}/` };
  }

  const res = await fetchUrl(u, {
    referer: `${activeDomain}/`,
  });

  if (res.text) {
    const effectiveRef = res.finalUrl || u;
    const extracted = extractPlayStreamFromHtml(res.text, effectiveRef);
    if (extracted) {
      if (extracted.type === 'encrypted_mp4') {
        return cacheAndReturn({
          type: 'encrypted_mp4',
          fu: extracted.fu,
          fk: extracted.fk,
          fs: extracted.fs,
          ref: effectiveRef,
        });
      }
      if (extracted.type === 'direct' && extracted.url) {
        return cacheAndReturn({
          type: 'direct',
          url: extracted.url,
          ref: effectiveRef,
        });
      }
    }

    // 若当前页面未直接命中流，继续追踪内嵌的 <iframe> 播放器地址
    const frames = extractIframes(res.text);
    for (const frameUrl of frames) {
      if (frameUrl === u) continue;
      try {
        const subResolved = await resolvePlayerUrl(frameUrl, depth + 1);
        if (subResolved && subResolved.type !== 'sniff') {
          return cacheAndReturn(subResolved);
        }
      } catch (_) {}
    }

    if (frames.length > 0) {
      return { type: 'sniff', url: frames[0], ref: effectiveRef };
    }
  }

  return { type: 'sniff', url: u, ref: `${activeDomain}/` };
}

// ---------------- CatBridge / 猫爪 Fastify 接口实现 ----------------

async function init(inReq) {
  const cfg = unwrapParams(inReq);
  const ext = cfg.extend || cfg.ext || '';
  if (typeof ext === 'string' && ext.startsWith('http')) {
    const clean = ext.replace(/\/+$/, '');
    activeDomain = clean;
    if (!SITE_DOMAINS.includes(clean)) {
      SITE_DOMAINS.unshift(clean);
    }
  }
  await ensureLocalProxyServer();
  return {};
}

async function home() {
  const classes = Object.entries(CATEGORIES).map(([type_id, type_name]) => ({
    type_id,
    type_name,
  }));
  let list = [];
  try {
    const firstCat = await fetchCategoryList('zjgx', 1);
    list = firstCat.list || [];
  } catch (_) {}
  return {
    class: classes,
    filters: {},
    type: '影视',
    list,
    style: { type: 'rect', ratio: 1.78 },
  };
}

async function fetchWpJsonCategory(cid, pn) {
  const path = `/wp-json/wp/v2/posts?categories=${cid}&per_page=20&page=${pn}&_embed`;
  const res = await fetchUrl(path);
  const vods = [];
  try {
    const posts = JSON.parse(res.text);
    if (Array.isArray(posts)) {
      for (const p of posts) {
        const emb = p?._embedded || {};
        const fm = (emb['wp:featuredmedia'] || [{}])[0] || {};
        const pic = fm.source_url ? normalizePicUrl(fm.source_url) : '';
        vods.push({
          vod_id: canonicalizeVodLink(p?.link || ''),
          vod_name: decodeHtmlEntities(p?.title?.rendered || ''),
          vod_pic: pic,
          vod_remarks: '',
        });
      }
    }
  } catch (_) {}
  let pc = 1;
  try {
    pc = parseInt(String(res.headers['x-wp-totalpages'] || '1'), 10) || 1;
  } catch (_) {}
  const pagecount = Math.max(pc, 1);
  return {
    list: vods,
    page: pn,
    pagecount,
    limit: 20,
    total: pagecount * 20,
  };
}

async function fetchCategoryList(tid, pg = 1) {
  const pn = Math.max(1, parseInt(String(pg || '1'), 10) || 1);
  if (Object.prototype.hasOwnProperty.call(WP_CAT, tid)) {
    return fetchWpJsonCategory(WP_CAT[tid], pn);
  }
  const path = pn === 1 ? `/${tid}/` : `/${tid}/?_page=${pn}`;
  const res = await fetchUrl(path);
  if (!res.text) {
    return { list: [], page: pn, pagecount: pn, limit: 20, total: 0 };
  }
  const { vods, pagecount } = parseCategoryHtml(res.text);
  const finalPageCount = Math.max(pn, pagecount);
  return {
    list: vods,
    page: pn,
    pagecount: finalPageCount,
    limit: 20,
    total: finalPageCount * 20,
  };
}

async function category(inReq) {
  const params = unwrapParams(inReq);
  const tid = params.id || params.tid || params.type_id || 'zjgx';
  const pg = params.page || params.pg || 1;
  return fetchCategoryList(tid, pg);
}

async function detail(inReq) {
  const params = unwrapParams(inReq);
  const rawId = params.id || params.ids || params.vod_id || params.url || '';
  const vid = Array.isArray(rawId) ? rawId[0] : String(rawId || '');
  const vod = {
    vod_id: vid,
    vod_name: vid ? vid.split('/').filter(Boolean).pop() || vid : '',
    vod_pic: '',
    vod_remarks: '',
    vod_year: '',
    vod_area: '',
    vod_director: '',
    vod_actor: '',
    vod_content: '',
    vod_play_from: '',
    vod_play_url: '',
  };
  if (!vid) return { list: [vod] };

  const res = await fetchUrl(vid);
  const text = res.text || '';
  if (!text) {
    vod.vod_play_from = '线路1';
    vod.vod_play_url = `1集$${vid}`;
    return { list: [vod] };
  }

  const titleMatch = text.match(/<h1[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
  if (titleMatch) {
    vod.vod_name = decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, '').trim());
  }

  const picMatch =
    text.match(/class=["'][^"']*attachment-large[^"']*["'][^>]*src=["']([^"']+)["']/i) ||
    text.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
    text.match(/wp-post-image[^>]*src=["']([^"']+)["']/i);
  if (picMatch) {
    vod.vod_pic = normalizePicUrl(picMatch[1]);
  }

  const descMatch =
    text.match(/name=["']description["']\s+content=["']([^"']+)["']/i) ||
    text.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  if (descMatch) {
    vod.vod_content = decodeHtmlEntities(descMatch[1]);
  }

  const effectiveDetailUrl = res.finalUrl || canonicalizeVodLink(vid) || vid;
  const frames = extractIframes(text);

  // 若详情页内本身已内嵌可解析的视频流，立即预热缓存
  const inlineStream = extractPlayStreamFromHtml(text, effectiveDetailUrl);
  if (inlineStream) {
    const resolvedInline = {
      ...inlineStream,
      ref: effectiveDetailUrl,
    };
    const cacheEntry = { ts: Date.now(), data: resolvedInline };
    PLAY_CACHE.set(sanitizeEpisodeId(vid), cacheEntry);
    PLAY_CACHE.set(effectiveDetailUrl, cacheEntry);
  }

  if (frames.length > 0) {
    vod.vod_play_from = frames.map((_, i) => `线路${i + 1}`).join('$$$');
    vod.vod_play_url = frames.map((u, i) => `${i + 1}集$${u}`).join('$$$');
    // 预热第一集流地址并缓存，避免点击播放时二次解析延迟或失败
    try {
      const preResolved = await resolvePlayerUrl(frames[0], 1);
      if (preResolved && preResolved.type !== 'sniff') {
        const entry = { ts: Date.now(), data: preResolved };
        PLAY_CACHE.set(sanitizeEpisodeId(vid), entry);
        PLAY_CACHE.set(effectiveDetailUrl, entry);
      }
    } catch (_) {}
  } else if (inlineStream) {
    const playTarget =
      inlineStream.type === 'direct' && inlineStream.url
        ? inlineStream.url
        : effectiveDetailUrl;
    vod.vod_play_from = '线路1';
    vod.vod_play_url = `1集$${playTarget}`;
  } else {
    vod.vod_play_from = '线路1';
    vod.vod_play_url = `1集$${effectiveDetailUrl}`;
  }

  return { list: [vod] };
}

async function search(inReq) {
  const params = unwrapParams(inReq);
  const key = params.wd || params.key || params.keyword || '';
  if (!key) return { list: [] };

  const res = await fetchUrl(`/?s=${encodeURIComponent(String(key))}`);
  const text = res.text || '';
  if (!text) return { list: [] };

  const vods = [];
  const vodMap = new Map();

  const articleRe =
    /<article[^>]*id=["']post-\d+["'][^>]*>[\s\S]*?<a\s+[^>]*href=["']([^"']+?\.html)["'][^>]*>[\s\S]*?(<img\s+[^>]+>)/gi;
  let m;
  while ((m = articleRe.exec(text)) !== null) {
    const link = canonicalizeVodLink(m[1]);
    const pic = extractAttr(m[2], [
      'data-cvpsrc',
      'data-litespeed-src',
      'data-lazy-src',
      'data-src',
      'src',
    ]);
    if (!vodMap.has(link)) {
      const item = {
        vod_id: link,
        vod_name: link.split('/').filter(Boolean).pop() || link,
        vod_pic: normalizePicUrl(pic),
        vod_remarks: '',
      };
      vodMap.set(link, item);
      vods.push(item);
    }
  }

  const h2Re =
    /<h2[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>\s*<a\s+[^>]*href=["']([^"']+?\.html)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = h2Re.exec(text)) !== null) {
    const link = canonicalizeVodLink(m[1]);
    const name = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, '').trim());
    if (vodMap.has(link)) {
      vodMap.get(link).vod_name = name;
    } else {
      const item = {
        vod_id: link,
        vod_name: name,
        vod_pic: '',
        vod_remarks: '',
      };
      vodMap.set(link, item);
      vods.push(item);
    }
  }

  return { list: vods };
}

async function play(inReq) {
  await ensureLocalProxyServer();
  const params = unwrapParams(inReq);
  const rawId = params.id || params.url || '';
  const forceProxy =
    params.proxy === '1' || params.proxy === 1 || params.proxy === true || params.proxy === 'true';
  const playHeaders = {
    'User-Agent': UA,
    Referer: `${activeDomain}/`,
  };

  if (!rawId) {
    return { parse: 0, jx: 0, url: '', header: playHeaders, headers: playHeaders };
  }

  try {
    const resolved = await resolvePlayerUrl(rawId);
    if (resolved.type === 'encrypted_mp4') {
      const proxyUrl = buildProxyPlayUrl(
        inReq,
        resolved.fu,
        resolved.fk,
        resolved.fs,
        resolved.ref
      );
      return {
        parse: 0,
        jx: 0,
        url: proxyUrl,
        header: { 'User-Agent': UA, Referer: resolved.ref },
        headers: { 'User-Agent': UA, Referer: resolved.ref },
      };
    }

    if (resolved.type === 'direct') {
      const h = { 'User-Agent': UA, Referer: resolved.ref || `${activeDomain}/` };
      if (forceProxy) {
        const isM3u8 = resolved.url.toLowerCase().includes('.m3u8');
        const proxyUrl = buildProxyPlayUrl(
          inReq,
          resolved.url,
          '',
          '',
          resolved.ref || `${activeDomain}/`,
          isM3u8 ? 'm3u8' : ''
        );
        return {
          parse: 0,
          jx: 0,
          url: proxyUrl,
          header: h,
          headers: h,
        };
      }
      return {
        parse: 0,
        jx: 0,
        url: resolved.url,
        header: h,
        headers: h,
      };
    }

    return {
      parse: 1,
      jx: 0,
      url: resolved.url,
      header: playHeaders,
      headers: playHeaders,
    };
  } catch (_) {
    const u = sanitizeEpisodeId(rawId);
    return {
      parse: 1,
      jx: 0,
      url: u.startsWith('http') ? u : `${activeDomain}/${u.replace(/^\/+/, '')}`,
      header: playHeaders,
      headers: playHeaders,
    };
  }
}

async function localProxy(inReq, outResp) {
  const params = unwrapParams(inReq);
  const headers = inReq?.headers || {};
  const method = inReq?.method || 'GET';
  const rawUrlPath = String(inReq?.raw?.url || inReq?.url || '/proxy').split('?')[0];
  const result = await handleStreamProxy(params, headers, method, rawUrlPath);

  if (outResp && typeof outResp.code === 'function') {
    outResp.code(result.status);
    for (const [k, v] of Object.entries(result.headers)) {
      outResp.header(k, v);
    }
    return outResp.send(result.body);
  }

  return [
    result.status,
    result.headers['Content-Type'] || 'video/mp4',
    result.body,
    result.headers,
    0,
  ];
}

export default {
  meta: {
    key: 'haijiaolove',
    name: '海角爱',
    type: 3,
  },
  api: async (fastify) => {
    fastify.post('/init', init);
    fastify.post('/home', home);
    fastify.post('/category', category);
    fastify.post('/detail', detail);
    fastify.post('/play', play);
    fastify.post('/search', search);
    fastify.get('/fd', localProxy);
    fastify.get('/fd.mp4', localProxy);
    fastify.get('/proxy', localProxy);
    fastify.get('/proxy.mp4', localProxy);
    if (typeof fastify.head === 'function') {
      fastify.head('/fd', localProxy);
      fastify.head('/fd.mp4', localProxy);
      fastify.head('/proxy', localProxy);
      fastify.head('/proxy.mp4', localProxy);
    }
  },
  proxy: localProxy,
};