# PR Sidebar: Chrome Web Store listing (draft)

## Name
PR Sidebar: GitHub Pull Requests

## Short description
Arc-style live folders for your GitHub pull requests in Chrome's side panel. Reviews, CI status and unread dots at a glance.

## Detailed description

Your GitHub pull requests, in a live folder beside your work.

PR Sidebar uses the GitHub session already signed into your Chrome profile. No OAuth app, personal access token, or organization-owner app approval is required. Your normal GitHub repository access and organization SSO still apply.

• A compact, collapsible Pull Requests folder inspired by Arc
• Labels for Needs your review, Opened by you, Team review, Assigned to you, and more
• Repository and category filters in the folder's context menu
• Visible time range and text search
• Review decisions and CI status when GitHub provides them
• Unread dots and a peek at new/current PRs while the folder is collapsed
• Pinned PRs, custom search folders, repository grouping and draft hiding
• Optional attention folder and desktop notifications
• PRs open in a dedicated tab group, reusing existing tabs
• Automatic refresh every two minutes by default

Your PR data and preferences remain in this browser. The extension reads GitHub's web dashboard and never reads or stores session cookies. No tracking, analytics, or external backend.

GitHub's web page format may change. The extension shows errors or warnings when data cannot be refreshed. Searches are limited to five pages per folder per refresh and show a warning when additional results exist. GitHub Enterprise Server is not supported.

Keyboard: Alt+Shift+P opens the sidebar, / searches, R refreshes.

## Permission justifications
- **sidePanel**: displays pull requests in Chrome's side panel.
- **storage**: saves preferences, cached PRs, pins, and read state locally.
- **alarms**: refreshes pull requests periodically.
- **tabs**: opens PRs, reuses existing tabs, and identifies the current PR.
- **tabGroups**: groups opened PRs in a Pull Requests tab group.
- **notifications**: optional alerts when PRs need attention.
- **offscreen**: parses fetched GitHub HTML with DOMParser in an inert document; does not run remote scripts.
- **Host access to github.com**: reads the pull-request web dashboard using the existing browser session. No cookie API permission or OAuth application is used.

## Single purpose
Shows the user's GitHub pull requests in Chrome's side panel and opens them in a dedicated tab group.

## Assets
- Icons: `icons/`
- Existing promotional assets: `design/store/`
- Existing `docs/screenshots/` images predate the browser-session layout and must be replaced before store publication.
- A public privacy policy URL is still needed before store submission.
