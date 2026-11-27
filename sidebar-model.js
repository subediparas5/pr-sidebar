export function livePRs(state, pinned = {}) {
  const all = new Map(Object.values(pinned)
    .filter(p => !p.accountLogin || p.accountLogin === state?.viewer?.login)
    .map(p => [p.id, { ...p, relations: [] }]));
  for (const [key, prs] of Object.entries(state?.sections || {})) {
    if (!key.startsWith('custom:')) prs.forEach(p => all.set(p.id, { ...p, relations: [...(all.get(p.id)?.relations || []), key] }));
  }
  return [...all.values()].sort((a, b) =>
    Number(!!pinned[b.id]) - Number(!!pinned[a.id]) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}
