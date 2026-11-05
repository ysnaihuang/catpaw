// 蝴蝶影视·18JSPA —— catBridge 單檔 cat 源（後台「Cat 源」→ 上傳導入，熱重載）
// 由 18jspa.py（tvbox python 源）移植，格式對齊 getav.js。六介面契約見 docs/spider.md。
// 沙箱內 import 會被改寫為 __CAT_JS_UTIL：'../../util/req.js' 走宿主 HTTP 客戶端。
import req from '../../util/req.js'

const HOST = 'https://t3.18j61.cc'
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const HEADERS = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Connection': 'keep-alive',
}

// ===================== 工具 =====================
function trim(s) {
    return s == null ? '' : String(s).replace(/^\s+|\s+$/g, '')
}

function htmlUnescape(s) {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
    return trim(s).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g, (m, ent) => {
        if (ent[0] === '#') {
            const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10)
            if (!Number.isNaN(code)) {
                try {
                    return String.fromCodePoint(code)
                } catch {
                    return m
                }
            }
            return m
        }
        return Object.prototype.hasOwnProperty.call(named, ent) ? named[ent] : m
    })
}

function cleanText(raw) {
    return htmlUnescape(String(raw || '').replace(/<[^>]+>/g, '')).trim()
}

// 對應 Python urllib.parse.urljoin
function urljoin(base, rel) {
    if (!rel) return ''
    try {
        return new URL(rel, base).href
    } catch {
        return rel
    }
}

// 篩選值可能是陣列，取第一個（對應 getav.js 的用法習慣）
function firstVal(v) {
    if (Array.isArray(v)) return v.length ? String(v[0]) : ''
    return v == null ? '' : String(v)
}

// 對應 Python _fetch：文本請求（gzip/跳轉/編碼由宿主客戶端處理）
async function fetchText(url, headers = null) {
    try {
        const resp = await req.get(url, {
            headers: headers || HEADERS,
            timeout: 10000,
            validateStatus: () => true,
        })
        if (resp.status < 200 || resp.status >= 400) return ''
        const data = resp.data
        return typeof data === 'string' ? data : String(data || '')
    } catch {
        return ''
    }
}

// ===================== 圖片代理（對齊 getav.js 格式） =====================
function clientBaseOf(inReq) {
    try {
        const proto = inReq.headers?.['x-forwarded-proto'] || 'http'
        const host = inReq.headers?.host || `127.0.0.1:${inReq.server?.server?.address?.()?.port || 9988}`
        return `${proto}://${host}`
    } catch {
        return 'http://127.0.0.1:9988'
    }
}

function imageUrl(inReq, pic) {
    const params = new URLSearchParams({
        url: pic,
        cache: '86400',
        customHeaders: JSON.stringify({ Referer: HOST + '/', 'User-Agent': UA }),
    })
    return `${clientBaseOf(inReq)}/imageProxy?${params}`
}

function formatPoster(inReq, rawUrl) {
    if (!rawUrl) return ''
    let pic = trim(rawUrl)
    if (pic.startsWith('//')) pic = 'https:' + pic
    else if (pic.startsWith('/')) pic = HOST + pic
    else if (!/^https?:\/\//i.test(pic)) pic = HOST + '/' + pic
    return imageUrl(inReq, pic)
}

// ===================== 列表解析 =====================
// 對應 Python _parse_vod_list
function parseVodList(inReq, htmlData) {
    const cards = []
    if (!htmlData) return cards

    let blocks = [...htmlData.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1])
    if (!blocks.length) {
        blocks = [...htmlData.matchAll(/<div[^>]*class=["'][^"']*(?:vodlist_item|video-item|box-item|item)[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi)].map((m) => m[1])
    }

    const seenIds = new Set()
    const NAV_WORDS = ['首页', '短视频', '演员', '标签', '图文', '黑料']

    for (const block of blocks) {
        const vLink = /href=["'](\/v\/[^"']+)["']/i.exec(block)
        if (!vLink) continue
        const cleanHref = vLink[1].trim()
        if (seenIds.has(cleanHref)) continue

        let title = ''
        const tMatch = /<(?:a|div|span|h\d)[^>]*class=["'][^"']*(?:vodlist_title|title|name)[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div|span|h\d)>/i.exec(block)
        if (tMatch) title = cleanText(tMatch[1])

        if (!title) {
            for (const tm of block.matchAll(/title=["']([^"']+)["']/gi)) {
                const tC = tm[1].trim()
                if (tC.length > title.length && !NAV_WORDS.includes(tC)) title = tC
            }
        }

        if (!title) {
            for (const am of block.matchAll(/<a[^>]+href=["']\/v\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi)) {
                const atClean = cleanText(am[1])
                if (atClean.length > title.length) title = atClean
            }
        }

        if (!title) continue
        title = htmlUnescape(title)

        let pic = ''
        const picMatch = /(?:data-original|data-src|src)=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i.exec(block)
        if (picMatch) pic = urljoin(HOST, picMatch[1].trim())

        let remarksRaw = ''
        const remMatch = /<span[^>]*class=["'][^"']*(?:pic-text|duration|remarks|tag)[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(block)
        if (remMatch) remarksRaw = cleanText(remMatch[1])
        const remarks = remarksRaw ? `蝴蝶影视 | ${remarksRaw}` : '蝴蝶影视'

        seenIds.add(cleanHref)
        cards.push({
            vod_id: cleanHref,
            vod_name: title,
            vod_pic: formatPoster(inReq, pic),
            vod_remarks: remarks,
            vod_actor: '🦋 TG群: @tvshare23',
            vod_director: '🦋 蝴蝶影视',
            style: { type: 'rect', ratio: 1.78 },
        })
    }

    // 兜底：直接抓帶 title 屬性的 /v/ 連結
    if (!cards.length) {
        for (const fm of htmlData.matchAll(/<a[^>]+href=["'](\/v\/[^"']+)["'][^>]*title=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
            const cleanHref = fm[1].trim()
            if (seenIds.has(cleanHref)) continue
            const tClean = htmlUnescape(fm[2].trim())
            if (!tClean || tClean.length <= 4) continue

            let pic = ''
            const pM = /(?:data-original|data-src|src)=["']([^"']+)["']/i.exec(fm[3])
            if (pM) pic = urljoin(HOST, pM[1].trim())

            seenIds.add(cleanHref)
            cards.push({
                vod_id: cleanHref,
                vod_name: tClean,
                vod_pic: formatPoster(inReq, pic),
                vod_remarks: '蝴蝶影视',
                vod_actor: '🦋 TG群: @tvshare23',
                vod_director: '🦋 蝴蝶影视',
                style: { type: 'rect', ratio: 1.78 },
            })
        }
    }

    return cards
}

// ===================== 分類 / 篩選（/home） =====================
const CLASSES = [
    { type_id: '1', type_name: '国产' },
    { type_id: '2', type_name: '日韩' },
    { type_id: '3', type_name: '欧美' },
    { type_id: '4', type_name: '伦理' },
    { type_id: '5', type_name: '动漫' },
    { type_id: '6', type_name: '另类' },
    { type_id: '9', type_name: '成人AI' },
]

const SORT_VALUES = [
    { n: '最近更新', v: 'time' },
    { n: '今日热播', v: 'hits_day' },
    { n: '今日点赞', v: 'up_day' },
    { n: '好评榜', v: 'up' },
]

const subFilter = (values) => ({ key: 'sub_id', name: '子分类', value: values })
const byFilter = () => ({ key: 'by', name: '排序', value: SORT_VALUES })

const HOME_FILTERS = {
    1: [
        subFilter([
            { n: '全部', v: '1' },
            { n: '国产自拍', v: '11' },
            { n: '吃瓜黑料', v: '12' },
            { n: '探花现场', v: '13' },
            { n: '乱伦系列', v: '14' },
            { n: '国产av', v: '15' },
            { n: '福利姬', v: '16' },
            { n: '自慰诱惑', v: '17' },
            { n: '成人主播', v: '18' },
        ]),
        byFilter(),
    ],
    2: [
        subFilter([
            { n: '全部', v: '2' },
            { n: '无码中字', v: '19' },
            { n: 'JAV自拍', v: '20' },
            { n: '中文字幕', v: '21' },
            { n: 'jav无码', v: '22' },
            { n: 'AV解说', v: '23' },
        ]),
        byFilter(),
    ],
    3: [
        subFilter([
            { n: '全部', v: '3' },
            { n: '欧美大片', v: '24' },
            { n: '黑人专区', v: '25' },
            { n: '留学生', v: '26' },
        ]),
        byFilter(),
    ],
    4: [
        subFilter([
            { n: '全部', v: '4' },
            { n: '港台三级', v: '27' },
            { n: '日韩三级', v: '28' },
            { n: '欧美三级', v: '29' },
        ]),
        byFilter(),
    ],
    5: [
        subFilter([
            { n: '全部', v: '5' },
            { n: '3D动漫', v: '30' },
            { n: '次元动漫', v: '31' },
        ]),
        byFilter(),
    ],
    6: [
        subFilter([
            { n: '全部', v: '6' },
            { n: '男同GAY', v: '32' },
            { n: '女同百合', v: '33' },
            { n: '伪娘', v: '34' },
            { n: 'SM重口', v: '35' },
            { n: '东南亚', v: '45' },
        ]),
        byFilter(),
    ],
    9: [
        subFilter([
            { n: '全部', v: '9' },
            { n: 'AI短剧', v: '36' },
            { n: '明星脸', v: '37' },
            { n: '成人漫剧', v: '46' },
        ]),
        byFilter(),
    ],
}

async function home() {
    // 對應 Python homeVideoContent：無推薦列表
    return { class: CLASSES, filters: HOME_FILTERS, list: [] }
}

// ===================== /category =====================
async function category(inReq) {
    const body = inReq.body || {}
    const tid = String(body.id || '')
    const extend = body.filters || {}

    let actualTid = tid
    const subId = firstVal(extend.sub_id)
    if (subId) actualTid = subId

    const sortBy = firstVal(extend.by) || 'time'

    let pg = Number(body.page) || 1
    if (pg === 0) pg = 1

    let reqUrl
    if (sortBy === 'time') {
        reqUrl = pg <= 1 ? `${HOST}/t/${actualTid}/` : `${HOST}/show/${actualTid}/page/${pg}/`
    } else {
        reqUrl = pg <= 1 ? `${HOST}/show/${actualTid}/by/${sortBy}/` : `${HOST}/show/${actualTid}/by/${sortBy}/page/${pg}/`
    }

    try {
        const htmlData = await fetchText(reqUrl)
        const cards = parseVodList(inReq, htmlData)
        return {
            list: cards,
            page: pg,
            pagecount: cards.length >= 15 ? pg + 1 : pg,
            limit: cards.length,
            total: 9999,
        }
    } catch (e) {
        console.error('[18jspa] category error:', e.message)
        return { page: pg, pagecount: pg, list: [] }
    }
}

// ===================== /detail =====================
async function detail(inReq) {
    const raw = inReq.body?.id
    const vodId = Array.isArray(raw) ? String(raw[0] || '') : String(raw || '')
    if (!vodId) return { list: [] }

    try {
        const detailUrl = urljoin(HOST, vodId)
        const htmlData = await fetchText(detailUrl)

        let title = ''
        const tM = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(htmlData)
        if (tM) title = cleanText(tM[1])

        let pic = ''
        const pM = /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i.exec(htmlData)
        if (pM) {
            pic = pM[1].trim()
        } else {
            const pM2 = /<img[^>]+(?:data-original|data-src|src)=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i.exec(htmlData)
            if (pM2) pic = pM2[1].trim()
        }
        if (pic) pic = urljoin(HOST, pic)

        // 直鏈提取：m3u8 -> mp4 -> url:"..." -> poster 推導 index.m3u8（過濾 sample/test）
        let directPlayUrl = ''
        for (const m of htmlData.matchAll(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi)) {
            if (!m[1].includes('sample') && !m[1].includes('test')) {
                directPlayUrl = m[1]
                break
            }
        }
        if (!directPlayUrl) {
            for (const m of htmlData.matchAll(/["'](https?:\/\/[^"']+\.mp4[^"']*)["']/gi)) {
                if (!m[1].includes('sample') && !m[1].includes('test')) {
                    directPlayUrl = m[1]
                    break
                }
            }
        }
        if (!directPlayUrl) {
            const artMatch = /url\s*:\s*["']([^"']+)["']/i.exec(htmlData)
            if (artMatch) {
                const candidate = artMatch[1].trim()
                if (!candidate.includes('sample') && !candidate.includes('test')) directPlayUrl = candidate
            }
        }
        if (!directPlayUrl && pic) {
            const inferred = pic.replace(/poster\d*\.(?:webp|jpg|png)/, 'index.m3u8')
            if (inferred !== pic) directPlayUrl = inferred
        }

        const playUrl = '正片$' + (directPlayUrl || detailUrl)

        return {
            list: [
                {
                    vod_id: vodId,
                    vod_name: title || '蝴蝶影视',
                    vod_pic: formatPoster(inReq, pic),
                    type_name: '蝴蝶精选',
                    vod_year: '',
                    vod_area: '',
                    vod_remarks: '蝴蝶影视',
                    vod_actor: '🦋 TG群: @tvshare23',
                    vod_director: '蝴蝶影视',
                    vod_content: '🦋 官方交流群: @tvshare23 | 请勿相信视频内任何广告！',
                    vod_play_from: '蝴蝶专线',
                    vod_play_url: playUrl,
                },
            ],
        }
    } catch (e) {
        console.error('[18jspa] detail error:', e.message)
        return { list: [] }
    }
}

// ===================== /play =====================
async function play(inReq) {
    // 詳情頁已給出直鏈，這裡直接透傳（對應 Python playerContent）
    const id = String(inReq.body?.id || '')
    return {
        parse: 0,
        url: id,
        header: {
            'User-Agent': UA,
            Referer: HOST + '/',
        },
    }
}

// ===================== /search =====================
async function search(inReq) {
    const body = inReq.body || {}
    const key = trim(body.wd ?? body.key)
    let pg = Number(body.page) || 1
    if (pg === 0) pg = 1
    if (!key) return { page: pg, pagecount: pg, list: [] }

    try {
        const encoded = encodeURIComponent(key)
        const searchUrl = pg <= 1 ? `${HOST}/s/wd/${encoded}/` : `${HOST}/s/wd/${encoded}/page/${pg}/`
        const htmlData = await fetchText(searchUrl)
        const cards = parseVodList(inReq, htmlData)
        return {
            list: cards,
            page: pg,
            pagecount: cards.length >= 15 ? pg + 1 : pg,
            limit: cards.length,
            total: 9999,
        }
    } catch (e) {
        console.error('[18jspa] search error:', e.message)
        return { page: pg, pagecount: pg, list: [] }
    }
}

export default {
    meta: { key: '18jspa', name: '蝴蝶影视·18JSPA', type: 3 },
    api: async (fastify, { db } = {}) => {
        fastify.post('/init', async () => ({}))
        fastify.post('/home', home)
        fastify.post('/category', category)
        fastify.post('/detail', detail)
        fastify.post('/play', play)
        fastify.post('/search', search)
    },
}
