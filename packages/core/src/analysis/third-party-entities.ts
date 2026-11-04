import { getHostname, getRootDomain } from "../utils/domain.js";
import type { ThirdPartyCategory } from "../types.js";

/** What a URL's host belongs to: a known service, or its registrable domain. */
export interface ThirdPartyIdentity {
  name: string;
  category: ThirdPartyCategory;
  known: boolean;
}

interface CatalogueEntry {
  name: string;
  category: ThirdPartyCategory;
  // Hostnames (a subdomain of one matches too) or "host/path" prefixes for services that
  // share a host with others (reCAPTCHA on www.google.com).
  hosts: string[];
}

// The services most pages load, by what they do. A host missing here is reported by its
// registrable domain, so the catalogue only has to know the services worth naming.
const CATALOGUE: CatalogueEntry[] = [
  // Tag managers
  { name: "Google Tag Manager", category: "tag-manager", hosts: ["googletagmanager.com"] },
  { name: "Tealium", category: "tag-manager", hosts: ["tiqcdn.com", "tealiumiq.com"] },
  { name: "Adobe Launch", category: "tag-manager", hosts: ["adobedtm.com"] },
  { name: "Segment", category: "tag-manager", hosts: ["segment.com", "segment.io"] },
  {
    name: "Commanders Act",
    category: "tag-manager",
    hosts: ["commander1.com", "tagcommander.com"],
  },
  // Analytics and monitoring
  {
    name: "Google Analytics",
    category: "analytics",
    hosts: ["google-analytics.com", "analytics.google.com", "stats.g.doubleclick.net"],
  },
  { name: "Hotjar", category: "analytics", hosts: ["hotjar.com", "hotjar.io"] },
  { name: "Microsoft Clarity", category: "analytics", hosts: ["clarity.ms"] },
  { name: "Mixpanel", category: "analytics", hosts: ["mixpanel.com", "mxpnl.com"] },
  { name: "Amplitude", category: "analytics", hosts: ["amplitude.com"] },
  { name: "Plausible", category: "analytics", hosts: ["plausible.io"] },
  { name: "Matomo", category: "analytics", hosts: ["matomo.cloud", "matomo.org"] },
  { name: "DebugBear", category: "analytics", hosts: ["debugbear.com"] },
  { name: "SpeedCurve", category: "analytics", hosts: ["speedcurve.com"] },
  { name: "New Relic", category: "analytics", hosts: ["newrelic.com", "nr-data.net"] },
  {
    name: "Datadog",
    category: "analytics",
    hosts: ["datadoghq.com", "datadoghq-browser-agent.com"],
  },
  { name: "Sentry", category: "analytics", hosts: ["sentry.io", "sentry-cdn.com"] },
  { name: "FullStory", category: "analytics", hosts: ["fullstory.com"] },
  { name: "Heap", category: "analytics", hosts: ["heap.io", "heapanalytics.com"] },
  {
    name: "Contentsquare",
    category: "analytics",
    hosts: ["contentsquare.net", "contentsquare.com"],
  },
  { name: "Optimizely", category: "analytics", hosts: ["optimizely.com"] },
  {
    name: "Vercel Analytics",
    category: "analytics",
    hosts: ["vercel-insights.com", "vercel-scripts.com"],
  },
  { name: "Cloudflare Insights", category: "analytics", hosts: ["cloudflareinsights.com"] },
  {
    name: "Adobe Analytics",
    category: "analytics",
    hosts: ["omtrdc.net", "demdex.net", "2o7.net"],
  },
  // Advertising
  {
    name: "Google Ads",
    category: "advertising",
    hosts: [
      "doubleclick.net",
      "googlesyndication.com",
      "googleadservices.com",
      "adtrafficquality.google",
    ],
  },
  { name: "Meta Pixel", category: "advertising", hosts: ["facebook.net", "facebook.com/tr"] },
  { name: "Criteo", category: "advertising", hosts: ["criteo.net", "criteo.com"] },
  { name: "Xandr", category: "advertising", hosts: ["adnxs.com"] },
  { name: "Microsoft Advertising", category: "advertising", hosts: ["bat.bing.com"] },
  { name: "LinkedIn Insight", category: "advertising", hosts: ["licdn.com", "ads.linkedin.com"] },
  { name: "Pinterest Tag", category: "advertising", hosts: ["ct.pinterest.com", "pinimg.com"] },
  { name: "TikTok Pixel", category: "advertising", hosts: ["analytics.tiktok.com", "tiktok.com"] },
  { name: "Snap Pixel", category: "advertising", hosts: ["sc-static.net", "tr.snapchat.com"] },
  { name: "X Ads", category: "advertising", hosts: ["ads-twitter.com", "t.co"] },
  { name: "Taboola", category: "advertising", hosts: ["taboola.com"] },
  { name: "Outbrain", category: "advertising", hosts: ["outbrain.com"] },
  { name: "Amazon Ads", category: "advertising", hosts: ["amazon-adsystem.com"] },
  { name: "Magnite", category: "advertising", hosts: ["rubiconproject.com"] },
  { name: "PubMatic", category: "advertising", hosts: ["pubmatic.com"] },
  { name: "OpenX", category: "advertising", hosts: ["openx.net"] },
  { name: "Index Exchange", category: "advertising", hosts: ["casalemedia.com"] },
  { name: "The Trade Desk", category: "advertising", hosts: ["adsrvr.org"] },
  // Consent managers
  { name: "OneTrust", category: "consent", hosts: ["cookielaw.org", "onetrust.com"] },
  { name: "Cookiebot", category: "consent", hosts: ["cookiebot.com"] },
  { name: "Didomi", category: "consent", hosts: ["didomi.io", "privacy-center.org"] },
  {
    name: "Sourcepoint",
    category: "consent",
    hosts: ["sourcepoint.mgr.consensu.org", "privacy-mgmt.com", "sp-prod.net"],
  },
  {
    name: "Quantcast Choice",
    category: "consent",
    hosts: ["quantcast.mgr.consensu.org", "cmp.quantcast.com"],
  },
  { name: "Usercentrics", category: "consent", hosts: ["usercentrics.eu", "usercentrics.com"] },
  { name: "TrustArc", category: "consent", hosts: ["trustarc.com", "truste.com"] },
  { name: "iubenda", category: "consent", hosts: ["iubenda.com"] },
  { name: "Osano", category: "consent", hosts: ["osano.com"] },
  { name: "CookieYes", category: "consent", hosts: ["cookieyes.com", "cdn-cookieyes.com"] },
  { name: "Axeptio", category: "consent", hosts: ["axept.io"] },
  { name: "CookieFirst", category: "consent", hosts: ["cookiefirst.com"] },
  { name: "Cookie Script", category: "consent", hosts: ["cookie-script.com"] },
  { name: "Termly", category: "consent", hosts: ["termly.io"] },
  {
    name: "consentmanager",
    category: "consent",
    hosts: ["consentmanager.net", "consentmanager.mgr.consensu.org"],
  },
  { name: "Cookie Information", category: "consent", hosts: ["cookieinformation.com"] },
  { name: "Klaro", category: "consent", hosts: ["klaro.app", "kiprotect.com"] },
  // Social
  {
    name: "X embeds",
    category: "social",
    hosts: ["platform.twitter.com", "syndication.twitter.com", "twimg.com"],
  },
  { name: "Facebook embeds", category: "social", hosts: ["facebook.com"] },
  { name: "Instagram embeds", category: "social", hosts: ["instagram.com", "cdninstagram.com"] },
  { name: "LinkedIn embeds", category: "social", hosts: ["platform.linkedin.com"] },
  { name: "AddThis", category: "social", hosts: ["addthis.com"] },
  { name: "ShareThis", category: "social", hosts: ["sharethis.com"] },
  // Video
  {
    name: "YouTube",
    category: "video",
    hosts: ["youtube.com", "youtube-nocookie.com", "ytimg.com", "googlevideo.com"],
  },
  { name: "Vimeo", category: "video", hosts: ["vimeo.com", "vimeocdn.com"] },
  { name: "Wistia", category: "video", hosts: ["wistia.com", "wistia.net"] },
  // Fonts
  { name: "Google Fonts", category: "fonts", hosts: ["fonts.googleapis.com", "fonts.gstatic.com"] },
  { name: "Adobe Fonts", category: "fonts", hosts: ["typekit.net", "typekit.com"] },
  { name: "Bunny Fonts", category: "fonts", hosts: ["fonts.bunny.net"] },
  { name: "Font Awesome", category: "fonts", hosts: ["fontawesome.com"] },
  // Customer success: chat, support, marketing automation
  { name: "Intercom", category: "customer-success", hosts: ["intercom.io", "intercomcdn.com"] },
  {
    name: "Zendesk",
    category: "customer-success",
    hosts: ["zendesk.com", "zdassets.com", "zopim.com"],
  },
  { name: "Drift", category: "customer-success", hosts: ["drift.com", "driftt.com"] },
  {
    name: "HubSpot",
    category: "customer-success",
    hosts: [
      "hubspot.com",
      "hs-scripts.com",
      "hsforms.net",
      "hsforms.com",
      "hs-analytics.net",
      "hscollectedforms.net",
      "hubspotusercontent.com",
    ],
  },
  { name: "Crisp", category: "customer-success", hosts: ["crisp.chat"] },
  { name: "tawk.to", category: "customer-success", hosts: ["tawk.to"] },
  { name: "LiveChat", category: "customer-success", hosts: ["livechatinc.com", "livechat.com"] },
  {
    name: "Salesforce",
    category: "customer-success",
    hosts: ["salesforce.com", "force.com", "pardot.com"],
  },
  {
    name: "Mailchimp",
    category: "customer-success",
    hosts: ["mailchimp.com", "list-manage.com", "chimpstatic.com"],
  },
  // Public CDNs and image services
  { name: "cdnjs", category: "cdn", hosts: ["cdnjs.cloudflare.com"] },
  { name: "jsDelivr", category: "cdn", hosts: ["jsdelivr.net"] },
  { name: "unpkg", category: "cdn", hosts: ["unpkg.com"] },
  { name: "jQuery CDN", category: "cdn", hosts: ["code.jquery.com"] },
  { name: "Google Hosted Libraries", category: "cdn", hosts: ["ajax.googleapis.com"] },
  { name: "Cloudinary", category: "cdn", hosts: ["cloudinary.com"] },
  { name: "imgix", category: "cdn", hosts: ["imgix.net"] },
  {
    name: "Cloudflare Polyfill",
    category: "cdn",
    hosts: ["polyfill.io", "cdnjs.cloudflare.com/polyfill"],
  },
  // Utilities: captchas, payments, maps
  {
    name: "reCAPTCHA",
    category: "utility",
    hosts: ["www.google.com/recaptcha", "www.gstatic.com/recaptcha", "recaptcha.net"],
  },
  { name: "hCaptcha", category: "utility", hosts: ["hcaptcha.com"] },
  { name: "Cloudflare Turnstile", category: "utility", hosts: ["challenges.cloudflare.com"] },
  { name: "Stripe", category: "utility", hosts: ["stripe.com", "stripe.network"] },
  { name: "PayPal", category: "utility", hosts: ["paypal.com", "paypalobjects.com"] },
  {
    name: "Google Maps",
    category: "utility",
    hosts: ["maps.googleapis.com", "maps.gstatic.com", "maps.google.com"],
  },
  {
    name: "Google Sign-In",
    category: "utility",
    hosts: ["accounts.google.com", "apis.google.com"],
  },
];

// Exact hosts and host suffixes resolve in one lookup; "host/path" entries are checked apart.
const byHost = new Map<string, CatalogueEntry>();
const byPath: { host: string; path: string; entry: CatalogueEntry }[] = [];
for (const entry of CATALOGUE) {
  for (const pattern of entry.hosts) {
    const slash = pattern.indexOf("/");
    if (slash === -1) byHost.set(pattern, entry);
    else byPath.push({ host: pattern.slice(0, slash), path: pattern.slice(slash), entry });
  }
}

function lookup(hostname: string, pathname: string): CatalogueEntry | undefined {
  // The most specific host/path entry first: reCAPTCHA before the rest of google.com.
  const pathMatch = byPath.find((p) => p.host === hostname && pathname.startsWith(p.path));
  if (pathMatch) return pathMatch.entry;
  const labels = hostname.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const entry = byHost.get(labels.slice(i).join("."));
    if (entry) return entry;
  }
  return undefined;
}

/**
 * The service a URL belongs to, from the built-in catalogue (Google Tag Manager, OneTrust,
 * Cloudinary…), else its registrable domain in the "other" category.
 */
export function identifyThirdParty(url: string): ThirdPartyIdentity {
  const hostname = getHostname(url);
  if (hostname === null) return { name: url, category: "other", known: false };
  let pathname = "/";
  try {
    pathname = new URL(url).pathname;
  } catch {
    // keep "/"
  }
  const entry = lookup(hostname.toLowerCase(), pathname);
  if (entry) return { name: entry.name, category: entry.category, known: true };
  return { name: getRootDomain(url), category: "other", known: false };
}

export const THIRD_PARTY_CATEGORY_LABEL: Record<ThirdPartyCategory, string> = {
  "tag-manager": "Tag manager",
  analytics: "Analytics",
  advertising: "Advertising",
  consent: "Consent",
  social: "Social",
  video: "Video",
  fonts: "Fonts",
  "customer-success": "Customer success",
  cdn: "CDN",
  utility: "Utility",
  other: "Other",
};
