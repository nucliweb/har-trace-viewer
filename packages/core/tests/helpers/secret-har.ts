// A Chrome-style HAR that carries every kind of secret the redaction removes. Each secret is
// a distinctive marker, so tests (and a grep) can prove that none survives.

// A JWT: header {"alg":"HS256","typ":"JWT"}, payload {"sub":"jane"}, a made-up signature.
export const JWT_HEADER = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
const jwt = (signature: string) => `${JWT_HEADER}.eyJzdWIiOiJqYW5lIn0.${signature}`;

export const SECRETS = {
  pageToken: "PAGE_TOKEN_SECRET_1",
  session: "SESSION_SECRET_2",
  cookieSid: "COOKIE_SID_SECRET_3",
  setCookie: "SET_COOKIE_SECRET_4",
  bearer: "BEARER_SECRET_5",
  apiKey: "API_KEY_SECRET_6",
  accessToken: "ACCESS_TOKEN_SECRET_7",
  password: "POST_PASSWORD_SECRET_8",
  userId: "USER_ID_SECRET_9",
  initiatorKey: "INITIATOR_KEY_SECRET_10",
  htmlBody: "HTML_BODY_SECRET_11",
  csrf: "CSRF_SECRET_12",
  email: "jane.doe@example.org",
  headerJwt: jwt("SEFERVJfSldUX1NJR05BVFVSRQ"),
  bodyJwt: jwt("Qk9EWV9KV1RfU0lHTkFUVVJF"),
  hexSignature: "0123456789abcdef0123456789abcdef",
  proxyAuth: "PROXY_AUTH_SECRET_13",
  ssoCode: "SSO_CODE_SECRET_14",
  sessionHeader: "SESSION_HEADER_SECRET_15",
  serverTiming: "SERVER_TIMING_SECRET_16",
  // A reset token as a whole path segment: 34 letters and digits of mixed case.
  resetPath: "ResetPathSecret17XyZ0123456789AbCd",
  traceStyle: "TRACE_STYLE_SECRET_18",
  lcpImage: "LCP_IMAGE_SECRET_19",
  traceScript: "TRACE_SCRIPT_SECRET_20",
};

// Secrets that only headers carry: a report without --redact leaves none of them either.
export const HEADER_SECRETS = [
  SECRETS.cookieSid,
  SECRETS.setCookie,
  SECRETS.bearer,
  SECRETS.apiKey,
  SECRETS.csrf,
  SECRETS.headerJwt,
  SECRETS.proxyAuth,
  SECRETS.ssoCode,
  SECRETS.sessionHeader,
];

export const DOCUMENT_URL = `https://shop.example.com/account?email=${SECRETS.email}&token=${SECRETS.pageToken}&lang=en`;
const LOGIN_URL = `https://shop.example.com/login?session=${SECRETS.session}&next=%2Faccount`;
// A sign-in page on another site, never requested: only the login request's Referer names it.
export const SSO_URL = `https://sso.vendor-three.example/callback?code=${SECRETS.ssoCode}&lang=en`;
const API_URL = `https://api.example.com/v1/profile?access_token=${SECRETS.accessToken}&lang=en`;
export const PIXEL_URL = `https://tracker.vendor-one.io/pixel.gif?uid=${SECRETS.userId}&sig=${SECRETS.hexSignature}&page=home`;
export const FONT_URL = "https://assets.vendor-two.net/fonts/brand.woff2";
const AVATAR_URL = "https://shop.example.com/avatars/jane.doe%40example.org/logo@2x.png";
export const GTAG_URL = "https://www.googletagmanager.com/gtag/js?id=G-ABC123";
const APP_JS_URL = `https://shop.example.com/app.js?key=${SECRETS.initiatorKey}`;
// Requested by the HAR and named by the trace: the render-blocking stylesheet and the LCP image.
const STYLE_URL = `https://shop.example.com/styles.css?token=${SECRETS.traceStyle}`;
const HERO_URL = `https://shop.example.com/hero.jpg?auth=${SECRETS.lcpImage}&w=1200`;
const RESET_URL = `https://shop.example.com/reset/${SECRETS.resetPath}`;
// A script only initiators and the trace name: it ran the main thread's long task.
const CHUNK_URL = `https://shop.example.com/chunk.js?sig=${SECRETS.traceScript}`;

const header = (name: string, value: string) => ({ name, value });

function entry(
  url: string,
  options: {
    startMs: number;
    status?: number;
    mimeType: string;
    resourceType: string;
    method?: string;
    requestHeaders?: { name: string; value: string }[];
    responseHeaders?: { name: string; value: string }[];
    requestCookies?: { name: string; value: string }[];
    responseCookies?: { name: string; value: string }[];
    text?: string;
    postData?: Record<string, unknown>;
    redirectURL?: string;
    initiator?: Record<string, unknown>;
    queryString?: { name: string; value: string }[];
  }
) {
  return {
    pageref: "page_1",
    startedDateTime: new Date(
      Date.parse("2026-01-01T00:00:00.000Z") + options.startMs
    ).toISOString(),
    time: 40,
    _resourceType: options.resourceType,
    _priority: "High",
    _transferSize: 1500,
    _connectionId: "1",
    ...(options.initiator ? { _initiator: options.initiator } : {}),
    request: {
      method: options.method ?? "GET",
      url,
      httpVersion: "h2",
      headers: [header(":authority", new URL(url).host), ...(options.requestHeaders ?? [])],
      queryString:
        options.queryString ??
        [...new URL(url).searchParams].map(([name, value]) => ({ name, value })),
      cookies: options.requestCookies ?? [],
      headersSize: -1,
      bodySize: options.postData ? 80 : 0,
      ...(options.postData ? { postData: options.postData } : {}),
    },
    response: {
      status: options.status ?? 200,
      statusText: "",
      httpVersion: "h2",
      headers: options.responseHeaders ?? [],
      cookies: options.responseCookies ?? [],
      content: {
        size: 4000,
        mimeType: options.mimeType,
        ...(options.text !== undefined ? { text: options.text } : {}),
      },
      redirectURL: options.redirectURL ?? "",
      headersSize: -1,
      bodySize: 1400,
    },
    cache: {},
    timings: { blocked: 1, dns: -1, connect: -1, ssl: -1, send: 1, wait: 30, receive: 8 },
    serverIPAddress: "203.0.113.10",
  };
}

/** The raw HAR, as a browser exports it. A fresh object on every call. */
export function secretHar() {
  return {
    log: {
      version: "1.2",
      creator: { name: "WebInspector", version: "537.36" },
      pages: [
        {
          id: "page_1",
          title: DOCUMENT_URL,
          startedDateTime: "2026-01-01T00:00:00.000Z",
          pageTimings: { onContentLoad: 300, onLoad: 500 },
        },
      ],
      entries: [
        entry(LOGIN_URL, {
          startMs: 0,
          status: 302,
          mimeType: "text/html",
          resourceType: "document",
          redirectURL: DOCUMENT_URL,
          requestHeaders: [
            header("referer", SSO_URL),
            header("origin", "https://sso.vendor-three.example"),
          ],
          responseHeaders: [header("location", DOCUMENT_URL), header("cache-control", "no-store")],
        }),
        entry(DOCUMENT_URL, {
          startMs: 50,
          mimeType: "text/html",
          resourceType: "document",
          requestHeaders: [
            header("cookie", `sid=${SECRETS.cookieSid}; theme=dark`),
            header("authorization", `Bearer ${SECRETS.bearer}`),
            header("proxy-authorization", `Basic ${SECRETS.proxyAuth}`),
            header("x-api-key", SECRETS.apiKey),
            header("x-csrf-token", SECRETS.csrf),
            header("x-request-context", `user=${SECRETS.headerJwt}`),
            header("referer", LOGIN_URL),
            header("accept", "text/html"),
          ],
          requestCookies: [
            { name: "sid", value: SECRETS.cookieSid },
            { name: "theme", value: "dark" },
          ],
          responseHeaders: [
            header("set-cookie", `sid=${SECRETS.setCookie}; Path=/; HttpOnly; Secure`),
            header("set-cookie", "theme=dark; Path=/"),
            header("x-session-id", SECRETS.sessionHeader),
            header("server-timing", `app;dur=25;desc="/account?session=${SECRETS.serverTiming}"`),
            header("cache-control", "private, no-store"),
            header("content-type", "text/html; charset=utf-8"),
            header("server", "Vercel"),
            header("x-vercel-cache", "MISS"),
            header("x-vercel-id", "cdg1::iad1::abcde-1767225600000-0123456789ab"),
            header(
              "link",
              `<${FONT_URL}>; rel=preload; as=font, <https://assets.vendor-two.net>; rel=preconnect`
            ),
          ],
          responseCookies: [{ name: "sid", value: SECRETS.setCookie }],
          text: `<html><body>Hello ${SECRETS.htmlBody}</body></html>`,
        }),
        entry(API_URL, {
          startMs: 120,
          method: "POST",
          mimeType: "application/json",
          resourceType: "fetch",
          requestHeaders: [header("referer", DOCUMENT_URL)],
          postData: {
            mimeType: "application/json",
            text: JSON.stringify({ jwt: SECRETS.bodyJwt, password: SECRETS.password }),
          },
          text: JSON.stringify({ user: SECRETS.email, token: SECRETS.bodyJwt }),
          initiator: {
            type: "script",
            stack: { callFrames: [{ functionName: "load", url: APP_JS_URL, lineNumber: 3 }] },
          },
        }),
        entry(PIXEL_URL, {
          startMs: 150,
          mimeType: "image/gif",
          resourceType: "image",
          responseHeaders: [
            header("cache-control", "no-cache"),
            header("cf-ray", "8f1e2d3c4b5a6978-MAD"),
            header("cf-cache-status", "DYNAMIC"),
          ],
          initiator: { type: "script", url: APP_JS_URL, lineNumber: 7 },
        }),
        entry(FONT_URL, {
          startMs: 160,
          mimeType: "font/woff2",
          resourceType: "font",
          requestHeaders: [header("referer", DOCUMENT_URL)],
          responseHeaders: [header("cache-control", "public, max-age=31536000, immutable")],
          initiator: { type: "parser", url: DOCUMENT_URL },
        }),
        entry(AVATAR_URL, {
          startMs: 170,
          mimeType: "image/png",
          resourceType: "image",
          responseHeaders: [header("cache-control", "public, max-age=600")],
          initiator: { type: "parser", url: DOCUMENT_URL },
        }),
        entry(GTAG_URL, {
          startMs: 180,
          mimeType: "application/javascript",
          resourceType: "script",
          responseHeaders: [header("cache-control", "private, max-age=900")],
        }),
        entry(STYLE_URL, {
          startMs: 190,
          mimeType: "text/css",
          resourceType: "stylesheet",
          responseHeaders: [header("cache-control", "public, max-age=600")],
          initiator: { type: "parser", url: DOCUMENT_URL },
        }),
        entry(HERO_URL, {
          startMs: 200,
          mimeType: "image/jpeg",
          resourceType: "image",
          responseHeaders: [header("cache-control", "public, max-age=600")],
          initiator: { type: "parser", url: DOCUMENT_URL },
        }),
        entry(RESET_URL, {
          startMs: 210,
          mimeType: "application/json",
          resourceType: "fetch",
          initiator: {
            type: "script",
            stack: {
              callFrames: [],
              parent: { callFrames: [{ functionName: "reset", url: CHUNK_URL, lineNumber: 1 }] },
            },
          },
        }),
      ],
    },
  };
}

// ── The trace of the same load ────────────────────────────────────────────────

const NAV_US = 1_000_000;
const MAIN = { pid: 1, tid: 2 };
const at = (ms: number) => NAV_US + ms * 1000;

function sendRequest(requestId: string, url: string, ms: number, data: Record<string, unknown>) {
  return {
    name: "ResourceSendRequest",
    ts: at(ms),
    ...MAIN,
    args: { data: { requestId, frame: "F1", url, priority: "High", ...data } },
  };
}

// A complete event on the main thread, at `ms` for `durMs`.
function task(name: string, ms: number, durMs: number, data: Record<string, unknown> = {}) {
  return { name, ph: "X", ts: at(ms), dur: durMs * 1000, ...MAIN, args: { data } };
}

/**
 * A Chrome trace of the same load, with a secret in every URL a parsed trace keeps: the
 * navigation's document, the requests and their initiators, the LCP image (and a node name
 * with an email), and the scripts of the main thread's tasks. A fresh object on every call.
 */
export function secretTrace() {
  return {
    traceEvents: [
      { name: "thread_name", ph: "M", ts: 0, ...MAIN, args: { name: "CrRendererMain" } },
      {
        name: "navigationStart",
        ph: "R",
        ts: NAV_US,
        ...MAIN,
        args: {
          frame: "F1",
          data: { isOutermostMainFrame: true, documentLoaderURL: DOCUMENT_URL, navigationId: "N" },
        },
      },
      sendRequest("r1", DOCUMENT_URL, 1, { resourceType: "Document", renderBlocking: "blocking" }),
      sendRequest("r2", STYLE_URL, 60, {
        resourceType: "Stylesheet",
        renderBlocking: "blocking",
        initiator: { type: "parser", url: DOCUMENT_URL },
      }),
      sendRequest("r3", HERO_URL, 70, {
        resourceType: "Image",
        renderBlocking: "non_blocking",
        initiator: { type: "script", stack: { callFrames: [{ url: CHUNK_URL, lineNumber: 4 }] } },
      }),
      task("RunTask", 100, 120),
      task("FunctionCall", 100, 110, { url: CHUNK_URL, functionName: "render" }),
      task("RunTask", 230, 80),
      task("EvaluateScript", 230, 70, { url: APP_JS_URL }),
      {
        name: "firstContentfulPaint",
        ts: at(300),
        ...MAIN,
        args: { frame: "F1", data: { navigationId: "N" } },
      },
      {
        name: "LargestImagePaint::Candidate",
        ts: at(400),
        ...MAIN,
        args: {
          frame: "F1",
          data: {
            DOMNodeId: 10,
            candidateIndex: 1,
            imageUrl: HERO_URL,
            nodeName: `IMG id='${SECRETS.email}'`,
            isOutermostMainFrame: true,
          },
        },
      },
      {
        name: "largestContentfulPaint::Candidate",
        ts: at(400),
        ...MAIN,
        args: {
          frame: "F1",
          data: {
            navigationId: "N",
            isOutermostMainFrame: true,
            nodeId: 10,
            candidateIndex: 1,
            type: "image",
            size: 50_000,
          },
        },
      },
    ],
  };
}
