import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import router, { spiders } from './router.js';
import defaultConfig from './index.config.js';

class LightweightJsonDB {
  constructor(filePath = './db.json') {
    this.filePath = filePath;
    this.store = {};
    try {
      if (fs.existsSync(filePath)) {
        this.store = JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
      }
    } catch (_) {
      this.store = {};
    }
  }

  _normalizeParts(dataPath) {
    return String(dataPath || '/')
      .split('/')
      .filter(Boolean);
  }

  async getData(dataPath) {
    const parts = this._normalizeParts(dataPath);
    let cur = this.store;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object' || !(p in cur)) {
        return undefined;
      }
      cur = cur[p];
    }
    return cur;
  }

  async getObjectDefault(dataPath, defaultValue = {}) {
    const val = await this.getData(dataPath);
    return val !== undefined ? val : defaultValue;
  }

  async push(dataPath, value, override = true) {
    const parts = this._normalizeParts(dataPath);
    if (parts.length === 0) {
      this.store = override ? value : Object.assign({}, this.store, value);
    } else {
      let cur = this.store;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (cur[p] == null || typeof cur[p] !== 'object') {
          cur[p] = {};
        }
        cur = cur[p];
      }
      const last = parts[parts.length - 1];
      if (!override && typeof cur[last] === 'object' && typeof value === 'object') {
        cur[last] = Object.assign({}, cur[last], value);
      } else {
        cur[last] = value;
      }
    }
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.store, null, 2), 'utf8');
    } catch (_) {}
  }
}

function createFastifyCompatibleServer(options = {}) {
  const routes = new Map(); // key: `${METHOD}:${pathname}` -> { handler, prefix, serverScope }
  let httpServer = null;
  let boundAddress = { address: '127.0.0.1', port: 0 };

  const normalizeRoutePath = (prefix, subPath) => {
    const p1 = String(prefix || '').replace(/\/+$/, '');
    const p2 = String(subPath || '').startsWith('/') ? String(subPath) : '/' + String(subPath || '');
    const combined = (p1 + p2).replace(/\/+/g, '/');
    return combined.length > 1 ? combined.replace(/\/+$/, '') : combined || '/';
  };

  const buildScope = (prefix = '') => {
    const scope = {
      prefix,
      config: rootServer.config,
      db: rootServer.db,
      get server() {
        return httpServer;
      },
      address() {
        return httpServer?.address?.() || boundAddress;
      },
      post(subPath, handler) {
        const fullPath = normalizeRoutePath(prefix, subPath);
        routes.set(`POST:${fullPath}`, { handler, prefix, scope });
        return scope;
      },
      get(subPath, handler) {
        const fullPath = normalizeRoutePath(prefix, subPath);
        routes.set(`GET:${fullPath}`, { handler, prefix, scope });
        routes.set(`HEAD:${fullPath}`, { handler, prefix, scope });
        return scope;
      },
      all(subPath, handler) {
        const fullPath = normalizeRoutePath(prefix, subPath);
        for (const m of ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
          routes.set(`${m}:${fullPath}`, { handler, prefix, scope });
        }
        return scope;
      },
      async register(pluginFn, opts = {}) {
        const nextPrefix = opts.prefix ? normalizeRoutePath(prefix, opts.prefix) : prefix;
        const childScope = buildScope(nextPrefix);
        await pluginFn(childScope, opts);
        return scope;
      },
      async inject(injectOpts = {}) {
        const method = String(injectOpts.method || 'GET').toUpperCase();
        const rawUrl = String(injectOpts.url || '/');
        const parsed = new URL(rawUrl, `http://${boundAddress.address || '127.0.0.1'}:${boundAddress.port || 80}`);
        const pathname = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : parsed.pathname;
        const routeEntry = routes.get(`${method}:${pathname}`) || routes.get(`ALL:${pathname}`);
        if (!routeEntry) {
          return {
            statusCode: 404,
            payload: JSON.stringify({ error: 'Not Found', path: pathname }),
            json: () => ({ error: 'Not Found', path: pathname }),
          };
        }
        const query = Object.fromEntries(parsed.searchParams.entries());
        const body = injectOpts.payload ?? injectOpts.body ?? {};
        let statusCode = 200;
        const respHeaders = {};
        let sentPayload;
        let isSent = false;

        const reply = {
          code(c) {
            statusCode = Number(c) || 200;
            return reply;
          },
          status(c) {
            statusCode = Number(c) || 200;
            return reply;
          },
          type(mime) {
            respHeaders['content-type'] = mime;
            return reply;
          },
          header(k, v) {
            respHeaders[String(k).toLowerCase()] = v;
            return reply;
          },
          headers(obj = {}) {
            for (const [k, v] of Object.entries(obj)) {
              respHeaders[String(k).toLowerCase()] = v;
            }
            return reply;
          },
          redirect(codeOrUrl, maybeUrl) {
            if (typeof codeOrUrl === 'number') {
              statusCode = codeOrUrl;
              respHeaders.location = maybeUrl;
            } else {
              statusCode = 302;
              respHeaders.location = codeOrUrl;
            }
            isSent = true;
            return reply;
          },
          send(data) {
            sentPayload = data;
            isSent = true;
            return reply;
          },
        };

        const reqObj = {
          method,
          url: rawUrl,
          query,
          params: {},
          body,
          headers: Object.assign({ host: `${boundAddress.address}:${boundAddress.port}` }, injectOpts.headers || {}),
          hostname: boundAddress.address || '127.0.0.1',
          protocol: 'http',
          server: routeEntry.scope,
          raw: { url: rawUrl, method, headers: injectOpts.headers || {} },
          getProxyUrl: () => `http://${boundAddress.address}:${boundAddress.port}${routeEntry.prefix}/proxy`,
        };

        const ret = await routeEntry.handler(reqObj, reply);
        const finalData = isSent ? sentPayload : ret;
        const payloadStr =
          typeof finalData === 'string'
            ? finalData
            : Buffer.isBuffer(finalData)
              ? finalData.toString('utf8')
              : JSON.stringify(finalData ?? {});

        return {
          statusCode,
          headers: respHeaders,
          payload: payloadStr,
          body: finalData,
          json: () => {
            if (typeof finalData === 'object' && finalData !== null && !Buffer.isBuffer(finalData)) {
              return finalData;
            }
            return JSON.parse(payloadStr || '{}');
          },
        };
      },
    };
    return scope;
  };

  const rootServer = {
    config: defaultConfig,
    db: new LightweightJsonDB(),
    prefix: '',
  };

  const rootScope = buildScope('');
  Object.assign(rootServer, rootScope);

  rootServer.listen = async (listenOpts = {}) => {
    const port = Number(listenOpts.port ?? 0);
    const host = listenOpts.host || '127.0.0.1';

    httpServer = http.createServer(async (reqIncoming, resOutgoing) => {
      try {
        const method = String(reqIncoming.method || 'GET').toUpperCase();
        if (method === 'OPTIONS') {
          resOutgoing.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': '*',
          });
          resOutgoing.end();
          return;
        }

        const hostHeader = reqIncoming.headers.host || `${boundAddress.address}:${boundAddress.port}`;
        const parsed = new URL(reqIncoming.url || '/', `http://${hostHeader}`);
        const pathname = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : parsed.pathname;
        const routeEntry = routes.get(`${method}:${pathname}`) || routes.get(`GET:${pathname}`);

        if (!routeEntry) {
          resOutgoing.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          resOutgoing.end(JSON.stringify({ code: 404, message: `Route ${method}:${pathname} not found` }));
          return;
        }

        const chunks = [];
        for await (const chunk of reqIncoming) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const rawBodyBuf = Buffer.concat(chunks);
        const rawBodyStr = rawBodyBuf.toString('utf8');
        let parsedBody = {};
        if (rawBodyStr) {
          const ct = String(reqIncoming.headers['content-type'] || '').toLowerCase();
          if (ct.includes('application/json') || rawBodyStr.trim().startsWith('{')) {
            try {
              parsedBody = JSON.parse(rawBodyStr);
            } catch (_) {
              parsedBody = rawBodyStr;
            }
          } else if (ct.includes('application/x-www-form-urlencoded')) {
            parsedBody = Object.fromEntries(new URLSearchParams(rawBodyStr).entries());
          } else {
            try {
              parsedBody = JSON.parse(rawBodyStr);
            } catch (_) {
              parsedBody = rawBodyStr;
            }
          }
        }

        const query = Object.fromEntries(parsed.searchParams.entries());
        let statusCode = 200;
        const respHeaders = {
          'access-control-allow-origin': '*',
        };
        let sentPayload;
        let isSent = false;

        const reply = {
          code(c) {
            statusCode = Number(c) || 200;
            return reply;
          },
          status(c) {
            statusCode = Number(c) || 200;
            return reply;
          },
          type(mime) {
            respHeaders['content-type'] = mime;
            return reply;
          },
          header(k, v) {
            respHeaders[String(k).toLowerCase()] = v;
            return reply;
          },
          headers(obj = {}) {
            for (const [k, v] of Object.entries(obj)) {
              respHeaders[String(k).toLowerCase()] = v;
            }
            return reply;
          },
          redirect(codeOrUrl, maybeUrl) {
            if (typeof codeOrUrl === 'number') {
              statusCode = codeOrUrl;
              respHeaders.location = maybeUrl;
            } else {
              statusCode = 302;
              respHeaders.location = codeOrUrl;
            }
            isSent = true;
            return reply;
          },
          send(data) {
            sentPayload = data;
            isSent = true;
            return reply;
          },
        };

        const reqObj = {
          method,
          url: reqIncoming.url || '/',
          query,
          params: {},
          body: parsedBody,
          headers: reqIncoming.headers || {},
          hostname: parsed.hostname || '127.0.0.1',
          protocol: 'http',
          server: routeEntry.scope,
          raw: reqIncoming,
          getProxyUrl: () => `http://${hostHeader}${routeEntry.prefix}/proxy`,
        };

        const ret = await routeEntry.handler(reqObj, reply);
        const finalData = isSent ? sentPayload : ret;

        if (statusCode >= 300 && statusCode < 400 && respHeaders.location) {
          resOutgoing.writeHead(statusCode, respHeaders);
          resOutgoing.end();
          return;
        }

        if (Buffer.isBuffer(finalData) || finalData instanceof Uint8Array) {
          const buf = Buffer.from(finalData);
          if (!respHeaders['content-type']) {
            respHeaders['content-type'] = 'application/octet-stream';
          }
          if (!respHeaders['content-length']) {
            respHeaders['content-length'] = String(buf.length);
          }
          resOutgoing.writeHead(statusCode, respHeaders);
          if (method === 'HEAD') {
            resOutgoing.end();
          } else {
            resOutgoing.end(buf);
          }
          return;
        }

        if (typeof finalData === 'string') {
          const buf = Buffer.from(finalData, 'utf8');
          if (!respHeaders['content-type']) {
            respHeaders['content-type'] = 'text/plain; charset=utf-8';
          }
          resOutgoing.writeHead(statusCode, respHeaders);
          resOutgoing.end(method === 'HEAD' ? undefined : buf);
          return;
        }

        const jsonBuf = Buffer.from(JSON.stringify(finalData ?? {}), 'utf8');
        if (!respHeaders['content-type']) {
          respHeaders['content-type'] = 'application/json; charset=utf-8';
        }
        resOutgoing.writeHead(statusCode, respHeaders);
        resOutgoing.end(method === 'HEAD' ? undefined : jsonBuf);
      } catch (err) {
        resOutgoing.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        resOutgoing.end(JSON.stringify({ code: 500, error: String(err?.message || err) }));
      }
    });

    return new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, host, () => {
        const addr = httpServer.address();
        boundAddress = typeof addr === 'object' && addr ? addr : { address: host, port };
        resolve(`http://${boundAddress.address}:${boundAddress.port}`);
      });
    });
  };

  rootServer.close = async () => {
    if (!httpServer) return;
    return new Promise((resolve) => {
      httpServer.close(() => {
        httpServer = null;
        resolve();
      });
    });
  };

  return rootServer;
}

let activeServer = null;

export async function start(cfg = {}) {
  if (activeServer) {
    await stop();
  }
  const parsedCfg =
    typeof cfg === 'string'
      ? (() => {
          try {
            return JSON.parse(cfg);
          } catch (_) {
            return {};
          }
        })()
      : cfg || {};

  const server = createFastifyCompatibleServer();
  server.config = parsedCfg.config || defaultConfig;
  const dbPath = parsedCfg.rootDir ? path.join(parsedCfg.rootDir, 'db.json') : './db.json';
  server.db = new LightweightJsonDB(dbPath);

  await server.register(router);

  const port = Number(parsedCfg.port ?? process.env.PORT ?? 0);
  const host = parsedCfg.host || process.env.HOST || '127.0.0.1';
  const listenUrl = await server.listen({ port, host });
  activeServer = server;
  const actualPort = server.address()?.port || port;
  console.log(`[CatPaw] Server listening on ${listenUrl} (spiders: ${spiders.length})`);
  return {
    port: actualPort,
    url: listenUrl,
    server,
  };
}

export async function stop() {
  if (activeServer) {
    await activeServer.close();
    activeServer = null;
  }
}

export { spiders, router, defaultConfig as config };

export default {
  start,
  stop,
  spiders,
  router,
  register: router,
  config: defaultConfig,
};
