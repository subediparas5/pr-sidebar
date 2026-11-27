# PR Sidebar

GitHub pull requests in Arc-style live folders, inside Chrome's side panel.

## Sign in once, on GitHub

PR Sidebar uses the **existing GitHub session in the same Chrome profile**. No OAuth app, app registration, client ID, authorization code, personal access token, or organization-owner app approval is required. Sign in at [github.com](https://github.com), open the sidebar, and refresh.

It can read the repositories your GitHub web session can access. Organization SSO still applies: complete SSO on GitHub if prompted, then refresh. Separate Chrome profiles have separate GitHub sessions. GitHub Enterprise Server is not supported.

## Live folders

- An account header, search toolbar, and collapsible folders with repository avatars, unread timeline dots, and review/CI badges. Light and dark themes follow your system.
- **Review**, **Changes**, **Failing**, and **Ready** quick filters narrow your category folders and pinned PRs. Their counts include each matching PR once.
- Tags explain why a PR appears: **Needs your review**, **Opened by you**, **Team review**, **Assigned to you**, and more.
- Use **View options** to filter repositories or group rows by repository; choose categories in Settings. A PR may appear in each relevant folder.
- Search and a visible time filter: 24 hours, 3 days, week, 2 weeks, month, 3 months, or **Any time** (default). Switching dates filters every folder, including pins, by the PR's last update immediately from the cache, without a network request.
- New PRs get unread dots. Up to three unread/current PRs peek out of a collapsed folder.
- Click a PR to open it in the **Pull Requests** tab group, reusing an existing tab. Cmd/Ctrl-click or middle-click opens in the background.
- Right-click a PR to pin it, change read status, copy its link, or open it in a new window. Pinned PRs remain available after leaving their original folder.
- Custom GitHub search folders, repository grouping, draft hiding, and optional desktop notifications.
- Refreshes the stored cache every two minutes by default, or on demand with the refresh button. Opening the sidebar reuses a fresh cache and refreshes a stale one. Completed PRs leave open categories on the next refresh; the optional Recently merged category retains merged PRs.

Keyboard: `Command+Shift+P` on macOS or `Ctrl+Shift+P` on Windows/Linux opens the sidebar, `/` searches, `↑`/`↓` navigate, `Enter` opens, `p` pins, `u` toggles read, `R` refreshes.

Chrome supplies the side-panel frame and tab groups. Arc's browser-wide Spaces and native tab management are not available to a Chrome side-panel extension.

## Install

1. Download and unzip a release, or clone the repository.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extension folder.
3. Sign in to GitHub in that Chrome profile, pin PR Sidebar, and click its icon.

Chrome 116 or later is required. After updating the code, click **Reload** on the extension card and reopen the panel.

Upgrading from the OAuth version removes the locally stored token, resets account-specific cached data, and keeps folder queries and other preferences. The sidebar starts with all dates. PRs appear in their category folders; the duplicate attention folder has been removed. Old OAuth grants on GitHub are not revoked automatically; they are no longer used by the extension.

## How it works

The extension sends read-only, credentialed GET requests to GitHub's own pull-request dashboard. Chrome attaches the existing session; the extension never reads, copies, or stores cookies. An offscreen document parses inert HTML. GitHub's deferred dashboard response provides review and CI status.

These web routes are not a stable public API. A GitHub page change can require a parser update. Unexpected HTML and failed searches produce an error rather than an empty list. Missing status data produces a warning rather than a guessed status. The cache loads all dates, subject to a maximum of five pages per folder per refresh, with a warning when it is truncated. Custom search queries keep their explicit date qualifiers. Refine the query when necessary.

Account changes and sign-out clear cached PRs, pins, and unread state on the next successful session check. A network error retains the last successful snapshot and displays an error. SSO prompts are shown separately.

## Develop and build

```sh
npm ci --ignore-scripts
npm test
./scripts/pack.sh
```

The package is written to `dist/pr-sidebar-v<version>.zip`. The GitHub Actions workflow installs test dependencies, runs tests, syntax-checks scripts, validates file references, and builds the zip. A push to main with a new manifest version creates a release.

| File | Purpose |
| --- | --- |
| `github-session.js` | Credentialed dashboard requests, pagination, status enrichment |
| `github-page.js`, `offscreen.*` | Inert page parsing and validation |
| `github.js` | Settings migration, session isolation, syncing, pins and unread state |
| `background.js` | Alarms, toolbar badge and notifications |
| `sidepanel.*` | Grouped folders, cached date filtering and controls |
| `options.*` | Account status, categories, custom searches and behavior |
| `tests/` | Synthetic parser, transport, account-switch and list tests |

## Privacy

Requests go only to GitHub; avatars are loaded from GitHub's avatar service. PR data and preferences stay in local extension storage. No analytics or external backend is used. No OAuth credential or session cookie is stored by the extension.
