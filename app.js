const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const API_KEY_STORAGE_KEY = "gh-pages-pagespeed-api-key";

const state = {
  pagespeedResults: [],
  crawledUrls: [],
  crawlErrors: []
};

const elements = {
  apiKey: document.getElementById("apiKey"),
  saveApiKeyBtn: document.getElementById("saveApiKeyBtn"),
  pagespeedUrls: document.getElementById("pagespeedUrls"),
  analyzeBtn: document.getElementById("analyzeBtn"),
  copyPagespeedCsvBtn: document.getElementById("copyPagespeedCsvBtn"),
  pagespeedStatus: document.getElementById("pagespeedStatus"),
  pagespeedResults: document.getElementById("pagespeedResults"),
  crawlUrl: document.getElementById("crawlUrl"),
  crawlLimit: document.getElementById("crawlLimit"),
  crawlBtn: document.getElementById("crawlBtn"),
  useCrawledUrlsBtn: document.getElementById("useCrawledUrlsBtn"),
  crawlStatus: document.getElementById("crawlStatus"),
  crawlResults: document.getElementById("crawlResults"),
  tabs: Array.from(document.querySelectorAll(".tab")),
  tabPanels: {
    pagespeed: document.getElementById("pagespeedTab"),
    crawl: document.getElementById("crawlTab")
  }
};

function setStatus(node, message, type = "") {
  node.textContent = message;
  node.className = `status ${type}`.trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseLines(rawValue) {
  return rawValue
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function buildPageSpeedReportUrl(url, strategy) {
  const reportUrl = new URL("https://pagespeed.web.dev/report");
  reportUrl.searchParams.set("url", url);
  reportUrl.searchParams.set("form_factor", strategy);
  return reportUrl.toString();
}

function buildCsv(rows) {
  const lines = [
    [
      "input_url",
      "mobile_score",
      "mobile_report_url",
      "mobile_error",
      "desktop_score",
      "desktop_report_url",
      "desktop_error"
    ].join(",")
  ];

  for (const row of rows) {
    lines.push(
      [
        row.inputUrl,
        row.mobile.score ?? "",
        row.mobile.reportUrl ?? "",
        row.mobile.error ?? "",
        row.desktop.score ?? "",
        row.desktop.reportUrl ?? "",
        row.desktop.error ?? ""
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(",")
    );
  }

  return lines.join("\n");
}

async function copyCurrentCsv() {
  if (state.pagespeedResults.length === 0) {
    setStatus(elements.pagespeedStatus, "No PageSpeed results to copy yet.", "error");
    return;
  }

  await navigator.clipboard.writeText(buildCsv(state.pagespeedResults));
  setStatus(elements.pagespeedStatus, "Copied current results as CSV.", "success");
}

function renderPageSpeedResults() {
  if (state.pagespeedResults.length === 0) {
    elements.pagespeedResults.innerHTML = "";
    return;
  }

  const rows = state.pagespeedResults
    .map(
      (result) => `
        <tr>
          <td><a href="${escapeHtml(result.inputUrl)}" target="_blank" rel="noreferrer"><code>${escapeHtml(result.inputUrl)}</code></a></td>
          <td>${renderScoreCell(result.mobile)}</td>
          <td>${renderScoreCell(result.desktop)}</td>
        </tr>
      `
    )
    .join("");

  elements.pagespeedResults.innerHTML = `
    <div class="results">
      <table>
        <thead>
          <tr>
            <th>Input URL</th>
            <th>Mobile</th>
            <th>Desktop</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderScoreCell(result) {
  if (result.error) {
    return `<span class="status error">${escapeHtml(result.error)}</span>`;
  }

  return `<a href="${escapeHtml(result.reportUrl)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(result.score)}</strong></a>`;
}

async function fetchPageSpeed(url, strategy, apiKey) {
  const requestUrl = new URL(PSI_ENDPOINT);
  requestUrl.searchParams.set("url", url);
  requestUrl.searchParams.set("strategy", strategy);
  requestUrl.searchParams.set("category", "performance");
  requestUrl.searchParams.set("key", apiKey);

  const response = await fetch(requestUrl);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error?.message || `${response.status} ${response.statusText}`);
  }

  const score = data?.lighthouseResult?.categories?.performance?.score;
  if (typeof score !== "number") {
    throw new Error("Performance score missing from PageSpeed response.");
  }

  const finalUrl = data?.lighthouseResult?.finalUrl || url;
  return {
    score: Math.round(score * 100),
    reportUrl: buildPageSpeedReportUrl(finalUrl, strategy),
    error: null
  };
}

async function analyzeOneUrl(url, apiKey) {
  if (!isValidHttpUrl(url)) {
    const error = "Invalid URL. Use an absolute http:// or https:// URL.";
    return {
      inputUrl: url,
      mobile: { score: null, reportUrl: null, error },
      desktop: { score: null, reportUrl: null, error }
    };
  }

  const [mobile, desktop] = await Promise.all(
    ["mobile", "desktop"].map(async (strategy) => {
      try {
        return await fetchPageSpeed(url, strategy, apiKey);
      } catch (error) {
        return {
          score: null,
          reportUrl: null,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    })
  );

  return { inputUrl: url, mobile, desktop };
}

async function runPageSpeedAnalysis() {
  const apiKey = elements.apiKey.value.trim();
  if (!apiKey) {
    setStatus(elements.pagespeedStatus, "Add and save a Google API key first.", "error");
    return;
  }

  const urls = parseLines(elements.pagespeedUrls.value);
  if (urls.length === 0) {
    setStatus(elements.pagespeedStatus, "Paste at least one URL to analyze.", "error");
    return;
  }

  elements.analyzeBtn.disabled = true;
  setStatus(elements.pagespeedStatus, `Analyzing ${urls.length} URL(s)...`);

  try {
    const results = [];
    for (const [index, url] of urls.entries()) {
      setStatus(elements.pagespeedStatus, `Analyzing ${index + 1} of ${urls.length}: ${url}`);
      results.push(await analyzeOneUrl(url, apiKey));
    }

    state.pagespeedResults = results;
    renderPageSpeedResults();
    setStatus(elements.pagespeedStatus, `Finished analyzing ${results.length} URL(s).`, "success");
  } catch (error) {
    setStatus(
      elements.pagespeedStatus,
      error instanceof Error ? error.message : String(error),
      "error"
    );
  } finally {
    elements.analyzeBtn.disabled = false;
  }
}

function setActiveTab(tabName) {
  for (const tab of elements.tabs) {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  }

  Object.entries(elements.tabPanels).forEach(([name, panel]) => {
    panel.classList.toggle("active", name === tabName);
  });
}

function extractLinksFromHtml(html, baseUrl) {
  const links = [];
  const anchorPattern = /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match;

  while ((match = anchorPattern.exec(html)) !== null) {
    const href = match[1] || match[2] || match[3] || "";

    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("javascript:")
    ) {
      continue;
    }

    try {
      const resolved = new URL(href, baseUrl);
      resolved.hash = "";
      links.push(resolved.toString());
    } catch {
      continue;
    }
  }

  return links;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.text();
}

function parseSitemapUrls(xmlText, origin) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlText, "application/xml");
  const urls = Array.from(xml.querySelectorAll("url > loc"))
    .map((node) => node.textContent?.trim())
    .filter(Boolean)
    .map((value) => {
      const url = new URL(value);
      url.hash = "";
      return url.toString();
    })
    .filter((value) => new URL(value).origin === origin);

  return [...new Set(urls)];
}

async function crawlSite() {
  const homepageUrl = elements.crawlUrl.value.trim();
  const maxPages = Number(elements.crawlLimit.value || 25);

  if (!isValidHttpUrl(homepageUrl)) {
    setStatus(elements.crawlStatus, "Enter a valid home page URL.", "error");
    return;
  }

  const startUrl = new URL(homepageUrl);
  startUrl.hash = "";
  const normalizedStart = startUrl.toString();

  elements.crawlBtn.disabled = true;
  state.crawledUrls = [];
  state.crawlErrors = [];
  setStatus(elements.crawlStatus, "Attempting crawl...", "");

  try {
    const discovered = new Set();
    const queue = [normalizedStart];
    const visited = new Set();

    try {
      const sitemapText = await fetchText(new URL("/sitemap.xml", normalizedStart).toString());
      for (const url of parseSitemapUrls(sitemapText, startUrl.origin)) {
        if (discovered.size >= maxPages) {
          break;
        }

        discovered.add(url);
        if (!queue.includes(url) && !visited.has(url)) {
          queue.push(url);
        }
      }
    } catch (error) {
      state.crawlErrors.push(`Sitemap fetch skipped: ${error instanceof Error ? error.message : String(error)}`);
    }

    while (queue.length > 0 && discovered.size < maxPages) {
      const currentUrl = queue.shift();
      if (visited.has(currentUrl)) {
        continue;
      }

      visited.add(currentUrl);
      discovered.add(currentUrl);
      setStatus(elements.crawlStatus, `Crawling ${discovered.size} / ${maxPages}: ${currentUrl}`);

      let html;
      try {
        html = await fetchText(currentUrl);
      } catch (error) {
        state.crawlErrors.push(`${currentUrl}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      const links = extractLinksFromHtml(html, currentUrl);
      for (const link of links) {
        if (discovered.size + queue.length >= maxPages) {
          break;
        }

        const url = new URL(link);
        if (url.origin !== startUrl.origin) {
          continue;
        }

        if (!visited.has(link) && !queue.includes(link)) {
          queue.push(link);
        }
      }
    }

    state.crawledUrls = [...discovered];
    renderCrawlResults();
    setStatus(
      elements.crawlStatus,
      `Collected ${state.crawledUrls.length} URL(s).`,
      "success"
    );
  } catch (error) {
    setStatus(
      elements.crawlStatus,
      error instanceof Error ? error.message : String(error),
      "error"
    );
  } finally {
    elements.crawlBtn.disabled = false;
  }
}

function renderCrawlResults() {
  const urls = state.crawledUrls;
  if (urls.length === 0) {
    elements.crawlResults.innerHTML = "";
    return;
  }

  const list = urls
    .map((url) => `<li><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer"><code>${escapeHtml(url)}</code></a></li>`)
    .join("");

  const errors = state.crawlErrors.length
    ? `<div class="status error">${state.crawlErrors.map(escapeHtml).join("<br>")}</div>`
    : "";

  elements.crawlResults.innerHTML = `
    <div class="results">
      <p><strong>${urls.length}</strong> URL(s) discovered.</p>
      <ol class="crawl-list">${list}</ol>
      ${errors}
    </div>
  `;
}

function useCrawledUrlsInPagespeed() {
  if (state.crawledUrls.length === 0) {
    setStatus(elements.crawlStatus, "No crawled URLs available yet.", "error");
    return;
  }

  elements.pagespeedUrls.value = state.crawledUrls.join("\n");
  setActiveTab("pagespeed");
  setStatus(elements.pagespeedStatus, `Loaded ${state.crawledUrls.length} crawled URL(s) into PageSpeed.`, "success");
}

function saveApiKey() {
  const value = elements.apiKey.value.trim();
  localStorage.setItem(API_KEY_STORAGE_KEY, value);
  setStatus(elements.pagespeedStatus, value ? "API key saved." : "API key cleared.", "success");
}

function init() {
  const savedKey = localStorage.getItem(API_KEY_STORAGE_KEY) || "";
  elements.apiKey.value = savedKey;

  elements.saveApiKeyBtn.addEventListener("click", saveApiKey);
  elements.analyzeBtn.addEventListener("click", runPageSpeedAnalysis);
  elements.copyPagespeedCsvBtn.addEventListener("click", copyCurrentCsv);
  elements.crawlBtn.addEventListener("click", crawlSite);
  elements.useCrawledUrlsBtn.addEventListener("click", useCrawledUrlsInPagespeed);

  for (const tab of elements.tabs) {
    tab.addEventListener("click", () => {
      setActiveTab(tab.dataset.tab);
    });
  }
}

init();
