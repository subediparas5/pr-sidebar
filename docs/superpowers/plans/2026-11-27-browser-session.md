# Browser session and Arc Live Folder

User-approved scope: replace OAuth with the existing GitHub session; match Arc's Live Folder layout and behavior.

1. Parse GitHub's signed-in pull dashboard; read-only credentialed requests, session validation, pagination, explicit parse/network/SSO failures. Tests first, synthetic fixtures only.
2. Replace OAuth lifecycle, migrate saved settings without tokens, isolate cached private data on logout/account switch, retain pins/unread and notifications for the same account.
3. Match observed Arc: one flat collapsible Pull Requests folder, compact rows, category and repository filters in its context menu, unread peek while collapsed. Keep search/settings accessible; default to all dates. Chrome tab groups provide tab organization.
4. Verify parser, transport and account changes; verify UI and package; perform a separate final review.

Evidence: installed Arc 1.174.3 context menu; GitHub authored dashboard HTML on 2026-11-27. Dashboard result route: pullsDashboardSurfaceContentRoute; identity/SSO: pullsDashboardSurfaceLayoutRoute. Current Arc itself displays Failed to update; do not copy that failure.

Implementation decisions: work on feat/arc-browser-session in the existing checkout so the user's unpacked extension can reload. Preserve user-defined custom queries/settings; migrate the default layout to a flat Live Folder and all dates. No cookie reads, tokens, GitHub API host, or remote script execution.

Progress: implementation and verification complete.

Completed:
- Browser-session transport, offscreen parser, pagination, review/check enrichment, credential removal, account cache isolation.
- Arc-style flat folder, menu filters, unread peek; user-requested visible time filter and relationship tags restored.
- Live Chrome verification: existing signed-in account loaded private organization PRs, review labels and CI; date filtering changed the result set; restoring all dates worked; collapsed folder exposed unread PR; no OAuth flow occurred.
- Independent review found dropped refresh requests during an active sync and stale account pin menus. Both were reproduced with failing tests, fixed, then verified green.
- Live date-filter testing uncovered loss of read history for temporarily hidden PRs. Regression test failed, retention was fixed, suite passed. Existing read markers were restored after testing; the newly arrived PR remained unread.
- Final validation: 16 tests passed; script syntax checks, file references, git diff --check and ZIP inspection passed. Package: dist/pr-sidebar-v1.2.0.zip. Installed unpacked extension reloaded into Chrome.

Decisions: five-page cap per folder with visible warning; unknown check/review state is shown as unknown with a warning; GitHub HTML changes fail visibly. Same-profile web session and organization SSO remain the access boundary. Browser-wide Arc Spaces and native tab chrome cannot be reproduced by a Chrome side-panel extension. No reviewer findings remain deferred.
