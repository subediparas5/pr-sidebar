// Parse inert HTML only. Never insert GitHub markup into the extension's document.
export function parseGitHubPage(html, Parser = DOMParser) {
  const doc = new Parser().parseFromString(html, 'text/html');
  let payload;
  for (const script of doc.querySelectorAll('script[type="application/json"]')) {
    try {
      const candidate = JSON.parse(script.textContent).payload;
      if (candidate?.pullsDashboardSurfaceLayoutRoute) { payload = candidate; break; }
    } catch { /* Other JSON scripts aren't dashboard data. */ }
  }
  const layout = payload?.pullsDashboardSurfaceLayoutRoute;
  const login = layout?.currentUser?.login || doc.querySelector('meta[name="user-login"]')?.content;
  if (!login && (doc.querySelector('input[name="login"]') || doc.querySelector('a[href^="/login"]'))) {
    throw Object.assign(new Error('Sign in to GitHub in this Chrome profile, then refresh.'), { code: 'SIGNED_OUT' });
  }
  if (!login || !layout) throw new Error('GitHub’s page format changed. Open GitHub and try refreshing again.');
  const route = payload.pullsDashboardSurfaceContentRoute;
  if (route?.error) throw new Error(`GitHub search: ${typeof route.error === 'string' ? route.error : 'Could not run this query.'}`);
  if (!Array.isArray(route?.results)) throw new Error('GitHub’s page format changed. Pull request results were not found.');
  const prs = route.results.map(toPR);
  const ssoOrgs = (layout.sso?.sso_organizations || []).map(o => typeof o === 'string' ? o : o.login)
    .filter(login => /^[\w-]+$/.test(login)).map(login => ({ login, reason: 'sso' }));
  return {
    viewer: { login, avatarUrl: avatar(layout.currentUser?.avatarUrl, login) },
    prs, ssoOrgs,
    totalPages: Math.max(1, Number(route.pageInfo?.totalPages) || 1),
    totalCount: Number(route.pageInfo?.totalCount) || prs.length,
  };
}

function avatar(url, login) {
  try { if (new URL(url).origin === 'https://avatars.githubusercontent.com') return url; } catch {}
  return `https://github.com/${encodeURIComponent(login)}.png?size=40`;
}

function toPR(n) {
  const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)$/.exec(n.permalink || '');
  if (!match || !n.id || typeof n.title !== 'string' || match[1] !== n.repoNameWithOwner ||
      Number(match[2]) !== n.number || !Number.isFinite(Date.parse(n.updatedAt)) || !Number.isFinite(Date.parse(n.createdAt))) {
    throw new Error('GitHub returned an unrecognized pull request. Refresh or open GitHub to check the results.');
  }
  const author = n.author?.displayLogin || 'ghost';
  return {
    id: String(n.globalId || n.id), number: n.number, title: n.title, url: n.permalink,
    updatedAt: n.updatedAt, createdAt: n.createdAt, isDraft: !!n.isDraft,
    state: n.mergedAt || n.state === 'MERGED' ? 'MERGED' : n.state === 'CLOSED' ? 'CLOSED' : 'OPEN',
    reviewDecision: null, ci: null, repo: n.repoNameWithOwner,
    repoAvatar: avatar(null, match[1].split('/')[0]), author, authorAvatar: avatar(null, author),
  };
}

export function applyDeferred(prs, json) {
  const rows = json?.payload?.pullsDashboardSurfaceContentDeferredData?.results;
  if (!Array.isArray(rows)) throw new Error('GitHub’s review and check status data is unavailable.');
  const byId = new Map(rows.map(r => [String(r.globalId || r.id), r]));
  return prs.map(pr => {
    const row = byId.get(pr.id);
    return { ...pr,
      reviewDecision: ['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'].includes(row?.reviewDecisionState) ? row.reviewDecisionState : null,
      ci: ['SUCCESS', 'FAILURE', 'ERROR', 'PENDING', 'EXPECTED'].includes(row?.statusCheckRollup?.state) ? row.statusCheckRollup.state : null,
    };
  });
}
