import { applyDeferred } from './github-page.js';

let creating;
async function parseInOffscreen(html) {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL('offscreen.html')] });
  if (!contexts.length) {
    creating ||= chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['DOM_PARSER'], justification: 'Read GitHub pull request page data without executing page scripts.' }).finally(() => { creating = null; });
    await creating;
  }
  const response = await chrome.runtime.sendMessage({ target: 'github-parser', html });
  if (!response?.page) throw Object.assign(new Error(response?.error || 'Could not read the GitHub page.'), { code: response?.code });
  return response.page;
}

// All requests use the browser's existing session. No cookie API, token or API host.
export function createSessionClient({ fetchImpl = fetch, parse = parseInOffscreen } = {}) {
  let viewer;
  const sso = new Map();
  const warnings = new Set();
  const cache = new Map();
  async function request(path, json = false) {
    const url = new URL(path, 'https://github.com');
    if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/pulls')) throw new Error('Invalid GitHub dashboard URL.');
    let response;
    try {
      response = await fetchImpl(url.href, {
        credentials: 'include', cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(20000),
        headers: json ? { Accept: 'application/json', 'GitHub-Verified-Fetch': 'true', 'X-Requested-With': 'XMLHttpRequest' } : { Accept: 'text/html' },
      });
    } catch { throw new Error('Could not reach GitHub. Check your connection and refresh.'); }
    if (response.status === 401 || /\/login(?:\?|$)|\/session(?:\?|$)/.test(response.url)) {
      throw Object.assign(new Error('Sign in to GitHub in this Chrome profile, then refresh.'), { code: 'SIGNED_OUT' });
    }
    if (response.status === 429) throw new Error('GitHub is limiting requests. Wait a few minutes before refreshing.');
    if (!response.ok) throw new Error(`GitHub returned ${response.status}. Open GitHub to check your session, then refresh.`);
    return json ? response.json() : parse(await response.text());
  }
  function checkIdentity(page) {
    if (viewer && page.viewer.login !== viewer.login) throw Object.assign(new Error('Your GitHub account changed. Refresh to load the new account.'), { code: 'ACCOUNT_CHANGED' });
    viewer = page.viewer;
    page.ssoOrgs.forEach(o => sso.set(o.login, o));
    return page;
  }
  async function identify() { return checkIdentity(await request('/pulls/authored')).viewer; }
  async function search(query) {
    const prs = new Map();
    for (let page = 1; page <= 5; page++) {
      const params = new URLSearchParams({ q: query, page: String(page) });
      const result = checkIdentity(await request(`/pulls/authored?${params}`));
      result.prs.forEach(p => prs.set(p.id, p));
      if (page >= result.totalPages) break;
      if (page === 5) warnings.add('Some folders have more than 5 pages. Refine their filters to see all results.');
    }
    const values = [...prs.values()];
    // Match GitHub's own deferred dashboard request, in small URL-safe batches.
    for (let start = 0; start < values.length; start += 25) {
      const batch = values.slice(start, start + 25);
      const params = new URLSearchParams({ q: query, page: '1' });
      batch.forEach(p => params.append('ids[]', p.id));
      try {
        const enriched = applyDeferred(batch, await request(`/pulls/deferred?${params}`, true));
        values.splice(start, batch.length, ...enriched);
      } catch (error) {
        if (error.code === 'SIGNED_OUT') throw error;
        warnings.add('Review and check status could not be refreshed. PRs are shown without those indicators.');
      }
    }
    return values;
  }
  return {
    identify,
    async folders(folders) {
      const sections = {};
      // Sequential fetches avoid flooding GitHub; duplicate queries share results.
      for (const folder of folders) {
        if (!cache.has(folder.query)) cache.set(folder.query, await search(folder.query));
        sections[folder.key] = cache.get(folder.query);
      }
      return sections;
    },
    get blockedOrgs() { return [...sso.values()]; },
    get warnings() { return [...warnings]; },
  };
}
