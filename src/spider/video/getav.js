import req from '../../util/req.js'

const NAV_SITE = 'https://getav.info/zh/'
const DEFAULT_HOSTS = [
    'https://getav.net',
    'https://getav.me',
    'https://getav.live',
    'https://getav.co',
    'https://getav.top',
]
const STATIC_HOST = 'https://static.worldstatic.com'
const UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const DB_KEY = '/getav'

let _db = null
let _hosts = DEFAULT_HOSTS.slice()
let _baseHost = _hosts[0]
let _hostIdx = 0

// ===================== 工具 =====================
function trim(s) {
    return s == null ? '' : String(s).replace(/^\s+|\s+$/g, '')
}

function safeJson(text) {
    try {
        return JSON.parse(text)
    } catch {
        return null
    }
}

function cleanHtmlText(raw) {
    return String(raw || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/[\r\n\t\s]+/g, ' ')
        .trim()
}

function formatSeconds(secs) {
    const s = parseInt(secs, 10)
    if (!Number.isFinite(s) || s <= 0) return ''
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    const pad = (n) => String(n).padStart(2, '0')
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

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
        customHeaders: JSON.stringify({ Referer: _baseHost + '/', 'User-Agent': UA }),
    })
    return `${clientBaseOf(inReq)}/imageProxy?${params}`
}

function formatPoster(inReq, rawUrl) {
    if (!rawUrl) return ''
    let pic = trim(rawUrl)
    if (pic.startsWith('//')) pic = 'https:' + pic
    else if (pic.startsWith('/')) pic = STATIC_HOST + pic
    return imageUrl(inReq, pic)
}

async function loadCachedHost() {
    if (!_db) return
    try {
        const stored = await _db.getData(DB_KEY)
        const cached = stored && typeof stored.liveHost === 'string' ? stored.liveHost : ''
        if (cached.startsWith('http')) {
            if (!_hosts.includes(cached)) _hosts.unshift(cached)
            _baseHost = _hosts[0]
            _hostIdx = 0
        }
    } catch {
        /* ignore */
    }
}

async function saveLiveHost(host) {
    if (!_db) return
    try {
        await _db.push(DB_KEY, { liveHost: host, updatedAt: Date.now() })
    } catch {
        /* ignore */
    }
}

function apiHeaders(host) {
    return {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Connection: 'keep-alive',
        Referer: host + '/zh',
        Origin: host,
    }
}

// 動態域名更新（Python _update_live_host）：抓 getav.info 換出最新 live host 並落 DB。
// 目前 hosts 輪換已足夠，預設不呼叫；需要時解除 fetchApi 尾端註釋。
async function updateLiveHost() {
    try {
        const resp = await req.get(NAV_SITE, {
            headers: {
                'User-Agent': UA,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            timeout: 5000,
            validateStatus: () => true,
        })
        const html = typeof resp.data === 'string' ? resp.data : String(resp.data || '')
        const domains = html.match(/getav\.(?:net|me|live|co|top|[a-z0-9]+)/gi) || []
        const clean = []
        for (const d of domains) {
            const h = ('https://' + d.toLowerCase()).trim()
            if (!h.includes('info') && !clean.includes(h)) clean.push(h)
        }
        if (clean.length) {
            for (const ch of clean.reverse()) {
                if (!_hosts.includes(ch)) _hosts.unshift(ch)
            }
            _baseHost = _hosts[0]
            _hostIdx = 0
            await saveLiveHost(_baseHost)
            return true
        }
    } catch {
        /* ignore */
    }
    return false
}

async function fetchApi(apiPath, timeout = 10000) {
    const n = _hosts.length
    for (let i = 0; i < n; i++) {
        const idx = (_hostIdx + i) % n
        const curHost = _hosts[idx]
        const url = /^https?:\/\//i.test(apiPath)
            ? apiPath.replace(/^https?:\/\/[^/]+/i, curHost)
            : curHost + '/' + String(apiPath).replace(/^\/+/, '')
        const headers = apiHeaders(curHost)
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const resp = await req.get(url, {
                    headers,
                    timeout,
                    responseType: 'json',
                    validateStatus: () => true,
                })
                if (resp.status < 200 || resp.status >= 400) throw new Error('HTTP ' + resp.status)
                const data = typeof resp.data === 'string' ? safeJson(resp.data) : resp.data
                if (data) {
                    _hostIdx = idx
                    _baseHost = curHost
                    return data
                }
            } catch {
                /* 換 host / 重試 */
            }
        }
    }
    // 全部 host 失敗 → 動態更新後再試（預設關閉）
    // if (await updateLiveHost()) return fetchApi(apiPath, timeout);
    return {}
}

// ===================== 列表映射 =====================
function moviesToList(inReq, res) {
    const movies = (res && res.data && res.data.movies) || []
    const list = []
    for (const m of movies) {
        const cid = trim(m.id).toLowerCase()
        if (!cid || /^\d+$/.test(cid)) continue
        const dur = formatSeconds(m.videoLength)
        list.push({
            vod_id: cid,
            vod_name: m.title || cid.toUpperCase(),
            vod_pic: formatPoster(inReq, m.localImg || m.img),
            vod_remarks: dur ? dur : '',
        })
    }
    return list
}

// 上游分頁欄位不統一：movies/studios 用 data.totalPages，stars/genres/codes 用 data.pagination.totalPages
function totalPagesOf(data, pg, fallbackLen, step) {
    const tp = (data && data.pagination && data.pagination.totalPages) || (data && data.totalPages)
    return tp || (fallbackLen >= step ? pg + 1 : pg)
}

// ===================== 分類 / 篩選（/home） =====================
// 註：上游各分類可用的 sortBy 不同（取自站點前端 sortByOptions）：
//   一般分類 f = latest / popular / favorites / rating / releaseDate / duration
//   latest 分類 g = releaseDate / uploadDate / contentUpdatedAt
//   hot    分類 x = daily / weekly / monthly / total
function sortFilter(values) {
    return [{ key: 'sortBy', name: '排序', init: values[0].v, value: values }]
}

const SORT_GENERAL = [
    { n: '最新', v: 'latest' },
    { n: '最热', v: 'popular' },
    { n: '收藏', v: 'favorites' },
    { n: '评分', v: 'rating' },
    { n: '发行日期', v: 'releaseDate' },
    { n: '时长', v: 'duration' },
]
const SORT_LATEST = [
    { n: '发行日期', v: 'releaseDate' },
    { n: '上传日期', v: 'uploadDate' },
    { n: '内容更新', v: 'contentUpdatedAt' },
]
const SORT_HOT = [
    { n: '今日人气', v: 'daily' },
    { n: '本周人气', v: 'weekly' },
    { n: '本月人气', v: 'monthly' },
    { n: '总人气', v: 'total' },
]
const SORT_GENERAL_FILTER = sortFilter(SORT_GENERAL)
const SORT_LATEST_FILTER = sortFilter(SORT_LATEST)
const SORT_HOT_FILTER = sortFilter(SORT_HOT)

const FOLDER_SORT_FILTERS = [
    {
        key: 'sort',
        name: '排序',
        init: 'popular',
        value: [
            { n: '最热', v: 'popular' },
            { n: '名称', v: 'name' },
            { n: '数量', v: 'movies' },
        ],
    },
]

const STAR_FILTERS = [
    {
        key: 'gender',
        name: '性别',
        init: '2',
        value: [
            { n: '女优', v: '2' },
            { n: '男优', v: '1' },
        ],
    },
    {
        key: 'sort',
        name: '排序',
        init: 'popular',
        value: [
            { n: '最热', v: 'popular' },
            { n: '最新', v: 'latest' },
            { n: '数量', v: 'movies' },
            { n: '名称', v: 'name' },
        ],
    },
]

const CLASSES = [
    { type_id: 'api@@latest', type_name: '最新' },
    { type_id: 'api@@hot', type_name: '热门' },
    { type_id: 'api@@new-releases', type_name: '新片' },
    { type_id: 'api@@uncensored', type_name: '无码' },
    { type_id: 'api@@censored', type_name: '有码' },
    { type_id: 'api@@subtitle', type_name: '字幕' },
    { type_id: 'api@@4k', type_name: '4K' },
    { type_id: 'folder@@genres', type_name: '类型' },
    { type_id: 'folder@@stars', type_name: '演员' },
    { type_id: 'folder@@studios', type_name: '片商' },
    { type_id: 'folder@@codes', type_name: '番号系列' },
]

const HOME_FILTERS = {
    'api@@latest': SORT_LATEST_FILTER,
    'api@@hot': SORT_HOT_FILTER,
    'api@@new-releases': SORT_GENERAL_FILTER,
    'api@@uncensored': SORT_GENERAL_FILTER,
    'api@@censored': SORT_GENERAL_FILTER,
    'api@@subtitle': SORT_GENERAL_FILTER,
    'api@@4k': SORT_GENERAL_FILTER,
    'folder@@genres': FOLDER_SORT_FILTERS,
    'folder@@studios': FOLDER_SORT_FILTERS,
    'folder@@codes': FOLDER_SORT_FILTERS,
    'folder@@stars': STAR_FILTERS,
}

async function home(inReq) {
    let list = []
    try {
        const res = await fetchApi('/api/movies?category=latest&sortBy=latest&limit=20&page=1&locale=zh')
        list = moviesToList(inReq, res)
    } catch (e) {
        console.error('[getav] home list error:', e.message)
    }
    return { class: CLASSES, filters: HOME_FILTERS, list }
}

// ===================== /category =====================
async function categoryCore(inReq, tid, page, filters) {
    let pg = Number(page) || 1
    if (pg === 0) pg = 1
    const flt = filters || {}

    // ---- 第一層 folder：類型 / 演員 / 片商 / 番號 ----
    if (tid.startsWith('folder@@')) {
        const fType = tid.slice('folder@@'.length)

        if (fType === 'stars') {
            const gender = flt.gender || '2'
            const sortType = flt.sort || 'popular'
            const qp = ['page=' + pg, 'limit=24', 'sort=' + sortType, 'locale=zh']
            if (gender) qp.push('gender=' + gender)
            const res = await fetchApi('/api/stars?' + qp.join('&'))
            const data = res.data || {}
            const stars = Array.isArray(data) ? data : data.stars || []
            const list = []
            for (const s of stars) {
                const sId = trim(s.id)
                const baseName = s.name || s.originalName || s.nameJp || ''
                if (!baseName) continue
                const count = s.movieCount || s.movie_count || ''
                const displayName = count ? `${baseName} (${count}部)` : baseName
                const remarks = count ? `${count}部` : ''
                const rawAvatar = s.localAvatar || s.avatar || s.localImg || s.img
                const avatar = rawAvatar ? formatPoster(inReq, rawAvatar) : ''
                list.push({
                    vod_id: `subfolder@@star@@${sId}@@sortBy=popular@@name=${encodeURIComponent(baseName)}`,
                    vod_name: displayName,
                    vod_pic: avatar,
                    vod_remarks: remarks,
                    vod_tag: 'folder',
                    style: { type: 'oval', ratio: 1.0 },
                })
            }
            const pagecount = totalPagesOf(data, pg, list.length, 24)
            return { page: pg, pagecount, limit: list.length, total: 5487, list }
        }

        if (fType === 'genres') {
            const sortType = flt.sort || 'popular'
            const res = await fetchApi(`/api/genres?limit=100&sort=${encodeURIComponent(sortType)}&locale=zh-CN`)
            const data = res.data || {}
            const items = data.genres || []
            const list = []
            for (const g of items) {
                const gId = String(g.id || '')
                const name = g.name || g.originalName || ''
                const count = g.movieCount || ''
                list.push({
                    vod_id: `subfolder@@genre@@${gId}@@sortBy=latest@@name=${encodeURIComponent(name)}`,
                    vod_name: name,
                    vod_pic: '',
                    vod_remarks: count ? `${count}部` : '',
                    vod_tag: 'folder',
                    style: { type: 'rect', ratio: 1.78 },
                })
            }
            return { page: 1, pagecount: 1, limit: list.length, total: list.length, list }
        }

        if (fType === 'studios') {
            const sortType = flt.sort || 'popular'
            const res = await fetchApi(`/api/studios?limit=100&sort=${encodeURIComponent(sortType)}&locale=zh-CN`)
            const data = res.data || {}
            const studios = data.studios || []
            const list = []
            for (const st of studios) {
                const stId = String(st.id || '')
                const name = st.name || ''
                const count = st.movieCount || st.movie_count || ''
                list.push({
                    vod_id: `subfolder@@studio@@${stId}@@sortBy=latest@@name=${encodeURIComponent(name)}`,
                    vod_name: name,
                    vod_pic: '',
                    vod_remarks: count ? `${count}部` : '',
                    vod_tag: 'folder',
                    style: { type: 'rect', ratio: 1.78 },
                })
            }
            return { page: 1, pagecount: 1, limit: list.length, total: list.length, list }
        }

        if (fType === 'codes') {
            const sortType = flt.sort || 'popular'
            const res = await fetchApi(`/api/codes?limit=100&sort=${encodeURIComponent(sortType)}&locale=zh-CN`)
            const data = res.data || {}
            const codes = data.codes || []
            const list = []
            for (const cd of codes) {
                const cdCode = trim(cd.code || cd.name).toUpperCase()
                const count = cd.movieCount || cd.movie_count || ''
                list.push({
                    vod_id: `subfolder@@code@@${cdCode}@@sortBy=latest@@name=${encodeURIComponent(cdCode)}`,
                    vod_name: cdCode,
                    vod_pic: '',
                    vod_remarks: count ? `${count}部` : '',
                    vod_tag: 'folder',
                    style: { type: 'rect', ratio: 1.78 },
                })
            }
            return { page: 1, pagecount: 1, limit: list.length, total: list.length, list }
        }

        return { page: pg, pagecount: pg, list: [] }
    }

    // ---- 第二層 subfolder：某演員 / 類型 / 片商 / 番號下的影片 ----
    if (tid.startsWith('subfolder@@')) {
        const parts = tid.split('@@')
        const subType = parts[1]
        const targetId = parts[2]

        const p = {
            sortBy: subType === 'star' ? 'popular' : 'latest',
            name: targetId,
        }
        for (let i = 3; i < parts.length; i++) {
            const seg = parts[i]
            const eq = seg.indexOf('=')
            if (eq >= 0) {
                const k = seg.slice(0, eq)
                let v = seg.slice(eq + 1)
                try {
                    v = decodeURIComponent(v)
                } catch {
                    /* 保留原值 */
                }
                if (k === 'sortBy' || k === 'name') p[k] = v
            }
        }

        const currSort = p.sortBy
        const subName = p.name

        const plural = { star: 'stars', genre: 'genres', studio: 'studios', code: 'codes' }[subType] || 'movies'
        const apiPath = `/api/${plural}/${encodeURIComponent(targetId)}?page=${pg}&limit=20&sortBy=${currSort}&locale=zh`
        const res = await fetchApi(apiPath)
        const data = res.data || {}
        const movies = data.movies || []

        const list = []

        if (pg === 1) {
            const sortNextMap = {
                popular: ['latest', '最热', '最新'],
                latest: ['duration', '最新', '时长'],
                duration: ['popular', '时长', '最热'],
            }
            const [nextSort, curSN, nextSN] = sortNextMap[currSort] || ['popular', currSort, '最热']
            list.push({
                vod_id: `subfolder@@${subType}@@${targetId}@@sortBy=${nextSort}@@name=${encodeURIComponent(subName)}`,
                vod_name: `🔀 排序: ${curSN} (点击切换)`,
                vod_pic: '',
                vod_remarks: `切至 ${nextSN}`,
                vod_tag: 'folder',
                style: { type: 'rect', ratio: 1.42 },
            })
        }

        list.push(...moviesToList(inReq, res))

        const pagecount = totalPagesOf(data, pg, movies.length, 20)
        return { page: pg, pagecount, limit: list.length, total: 9999, list }
    }

    // ---- 頂層 api@@ 分類 ----
    const cat = tid.startsWith('api@@') ? tid.slice('api@@'.length) : 'latest'
    // 各分類預設排序對齊站點：latest 用上傳日期、hot 用本週人氣、其餘用最新
    const defaultSort = cat === 'hot' ? 'weekly' : cat === 'latest' ? 'uploadDate' : 'latest'
    const params = ['page=' + pg, 'limit=20', 'locale=zh', 'sortBy=' + (flt.sortBy || defaultSort)]
    const res = await fetchApi(`/api/movies?category=${encodeURIComponent(cat)}&${params.join('&')}`)
    const data = res.data || {}
    const movies = data.movies || []
    const list = moviesToList(inReq, res)
    const pagecount = totalPagesOf(data, pg, movies.length, 20)
    return { page: pg, pagecount, limit: list.length, total: 9999, list }
}

async function category(inReq) {
    const tid = String(inReq.body?.id || '')
    try {
        return await categoryCore(inReq, tid, inReq.body?.page, inReq.body?.filters || {})
    } catch (e) {
        console.error('[getav] category error:', e.message)
        const pg = Number(inReq.body?.page) || 1
        return { page: pg, pagecount: pg, list: [] }
    }
}

// ===================== /detail =====================
const LABEL_MAP = {
    raw_1080p: '1080P',
    raw_720p: '720P',
    raw_480p: '480P',
    raw_240p: '240P',
}

// 由標籤推導畫質分數（4K=2160），用於播放線路由高到低排序
function qualityRank(label) {
    const l = String(label || '').toLowerCase()
    if (l.includes('4k')) return 2160
    const m = l.match(/(\d{3,4})/)
    return m ? parseInt(m[1], 10) : 0
}

// 從 detail.subtitles 挑最佳中文字幕：優先 zh/zh-hans/zh-cn，其次 zhtw/zh-tw/zh-hk；同語言取 qualityScore 高者
const SUB_LANG_PREF = ['zh', 'zh-hans', 'zh-cn', 'zhtw', 'zh-tw', 'zh-hk', 'zh-hant']
function pickSubtitle(subs) {
    if (!Array.isArray(subs) || !subs.length) return ''
    const rank = (s) => SUB_LANG_PREF.indexOf(String((s && s.language) || '').toLowerCase())
    const cands = subs.filter((s) => s && s.filePath && rank(s) >= 0)
    if (!cands.length) return ''
    cands.sort((a, b) => rank(a) - rank(b) || (Number(b.qualityScore) || 0) - (Number(a.qualityScore) || 0))
    return cands[0].filePath
}

// 播放 id：有字幕時用 GA1.<base64url(JSON{u,s})>，避免 play_url 的 $ / # 分隔符衝突
function encodePlayId(url, subt) {
    if (!subt) return url
    return 'GA1.' + Buffer.from(JSON.stringify({ u: url, s: subt }), 'utf8').toString('base64url')
}

function decodePlayId(id) {
    if (!id.startsWith('GA1.')) return { url: id, subt: '' }
    try {
        const o = JSON.parse(Buffer.from(id.slice(4), 'base64url').toString('utf8'))
        if (o && o.u) return { url: String(o.u), subt: String(o.s || '') }
    } catch {
        /* fallthrough */
    }
    return { url: id, subt: '' }
}

async function detail(inReq) {
    const rawId = String(inReq.body?.id || '')

    // 卡片層被直接打開時，交給 category 處理
    if (rawId.startsWith('subfolder@@') || rawId.startsWith('folder@@')) {
        const r = await categoryCore(inReq, rawId, 1, {})
        return { list: r.list || [] }
    }

    const code = trim(rawId).toLowerCase()
    if (!code) return { list: [] }

    try {
        const res = await fetchApi('/api/movies/' + encodeURIComponent(code))
        const data = res.data || {}

        const title = data.title || code.toUpperCase()
        const poster = formatPoster(inReq, data.localImg || data.img)

        const actorsList = data.stars || []
        const actorNames = actorsList.filter((a) => a && a.name).map((a) => cleanHtmlText(a.name))
        const actorStr = actorNames.length ? actorNames.join(', ') : '暂无'

        const genresList = data.genres || []
        const genreNames = genresList.filter((g) => g && g.name).map((g) => cleanHtmlText(g.name))
        const typeStr = genreNames.length ? genreNames.join(' / ') : '情色'

        const durStr = formatSeconds(data.videoLength)
        const remarks = durStr ? durStr : ''

        const desc = data.description || title
        const fullContent =
            '番号: ' +
            code.toUpperCase() +
            '\n' +
            '片名: ' +
            title +
            '\n' +
            '时长: ' +
            durStr +
            '\n' +
            '发行: ' +
            String(data.date || '').slice(0, 10) +
            '\n' +
            '简介: ' +
            desc

        const videoSources = data.videoSources || []
        const playLines = []
        for (const vs of videoSources) {
            const sUrl = vs.url || ''
            const sType = vs.type || ''
            if (sUrl) {
                const label = LABEL_MAP[sType] || sType || '默认线路'
                playLines.push({ label, url: sUrl })
            }
        }

        if (!playLines.length) {
            if (data.localM3u8Path4k) playLines.push({ label: '4K', url: data.localM3u8Path4k })
            if (data.localM3u8Path) playLines.push({ label: '1080P', url: data.localM3u8Path })
            if (data.localM3u8PathUc) playLines.push({ label: '无码', url: data.localM3u8PathUc })
        }

        // 播放線路依畫質由高到低（4K > 1080P > 720P > 480P > …）
        playLines.sort((a, b) => qualityRank(b.label) - qualityRank(a.label))

        const subUrl = pickSubtitle(data.subtitles)
        const playUrlStr = playLines.length
            ? playLines.map((p) => p.label + '$' + encodePlayId(p.url, subUrl)).join('#')
            : '暂无可用线路$https://dummyimage.com/1x1/000/000.png'

        return {
            list: [
                {
                    vod_id: code,
                    vod_name: title,
                    vod_pic: poster,
                    type_name: typeStr,
                    vod_year: String(data.date || '').slice(0, 4),
                    vod_area: '日本',
                    vod_remarks: remarks,
                    vod_actor: actorStr,
                    vod_content: fullContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
                    vod_play_from: '播放',
                    vod_play_url: playUrlStr,
                },
            ],
        }
    } catch (e) {
        console.error('[getav] detail error:', e.message)
        return { list: [] }
    }
}

// getav 直鏈是偽裝成 index.txt 的 HLS（上游 Content-Type: application/vnd.apple.mpegurl）
function isHlsUrl(url) {
    const u = String(url || '')
    return /\.m3u8(\?|#|$)/i.test(u) || /\/index\.txt(\?|#|$)/i.test(u)
}

// ===================== /play =====================
async function play(inReq) {
    const id = trim(inReq.body?.id)
    if (!id) return { url: '', header: { 'User-Agent': UA } }
    const { url, subt } = decodePlayId(id)
    const out = { url, header: { 'User-Agent': UA } }
    // 宣告此 url 為 HLS：無 .m3u8 副檔名，靠旗標讓播放優化管線捕獲
    // if (isHlsUrl(url)) {
    //     out.m3u8 = true;
    //     // TS 加速調參：關閉 Range 分段併發（parts=1 → 直取整片）、預取窗口 20、後台同時只預取 1 片
    //     out.accelParams = { parts: 1, window: 20, inflight: 1 };
    // }
    if (subt) out.extra = { subt }
    return out
}

// ===================== /search =====================
async function search(inReq) {
    let pg = Number(inReq.body?.page) || 1
    if (pg === 0) pg = 1
    const kw = trim(inReq.body?.wd)
    if (!kw) return { page: pg, pagecount: pg, list: [] }
    try {
        const res = await fetchApi(`/api/search?q=${encodeURIComponent(kw)}&page=${pg}&limit=20&locale=zh`)
        const data = res.data || {}
        const movies = data.movies || []
        const list = moviesToList(inReq, res)
        const pagecount = totalPagesOf(data, pg, movies.length, 20)
        return { page: pg, pagecount, limit: list.length, total: 9999, list }
    } catch (e) {
        console.error('[getav] search error:', e.message)
        return { page: pg, pagecount: pg, list: [] }
    }
}

function initGetav(db) {
    _db = db || null
    _hosts = DEFAULT_HOSTS.slice()
    _hostIdx = 0
    _baseHost = _hosts[0]
    // 讀回上次成功（或動態更新後）的 live host；尚未啟用動態更新時通常為空
    loadCachedHost().catch(() => {})
}

export default {
    meta: { key: 'getav', name: 'getav', type: 3 },
    api: async (fastify, { db } = {}) => {
        initGetav(db)
        fastify.post('/init', async () => ({}))
        fastify.post('/home', home)
        fastify.post('/category', category)
        fastify.post('/detail', detail)
        fastify.post('/play', play)
        fastify.post('/search', search)
    },
}
