# PR Sidebar: Chrome Web Store listing (draft)

## Name
PR Sidebar: GitHub Pull Requests

## Short description (manifest, max 132 characters)
Arc-style live folders for your GitHub pull requests in Chrome's side panel. Reviews, CI status and unread dots at a glance.

## Category
Developer Tools

## Detailed description

Keep every pull request you care about one click away, without living in GitHub notifications.

PR Sidebar adds a pull request space to Chrome's side panel, inspired by Arc's live folders. Your review requests, your own PRs and anything assigned to you stay in tidy folders that refresh on their own, so you always know what needs you next.

**See what needs you at a glance**
• A Needs your attention folder with every PR waiting on you, from any date: review requests, changes requested, failing checks, ready to merge, assigned to you and your other open PRs
• Live folders: Review requested, Created by me, Assigned to me, Mentioned, Reviewed by me and Recently merged
• Quick filters for Review, Changes, Failing and Ready, with live counts
• CI status on every PR (passing, failing, running), plus Approved, Changes requested, Draft and Merged labels
• Blue unread dots for new PRs, and an unread count on the toolbar icon

**Work the way you want**
• Time filter: last 24 hours, 3 days, week (default), 2 weeks, month, 3 months or any time
• Custom folders from any GitHub search, like `repo:acme/api is:open` or `team-review-requested:acme/backend`
• Pin important PRs to the top
• Group by repository, hide drafts, and search instantly (press `/`)
• Desktop notifications when a new review request lands, or your PR gets changes requested or starts failing checks

**A real space for PRs**
Clicking a PR opens it in a "Pull Requests" tab group, so your reviews stay together and away from the rest of your tabs. If the PR is already open, PR Sidebar switches to that tab instead of opening a duplicate.

**Sign in your way**
Sign in with GitHub in a few clicks, or paste a personal access token. If your organization hasn't approved the app yet, PR Sidebar tells you which org is blocked and how to request access.

**Private by design**
PR Sidebar talks only to GitHub. Your token and PR data stay in your browser. Nothing is sent to any other server, and there's no tracking or analytics.

Keyboard: `Alt+Shift+P` opens the sidebar, `/` searches, `R` refreshes.

## Permission justifications (for the review form)
- **sidePanel**: shows the pull request list in Chrome's side panel.
- **storage**: saves your settings, sign-in token, pinned PRs and read/unread state locally.
- **alarms**: refreshes your pull requests in the background every few minutes.
- **tabs**: opens PRs, switches to a PR that's already open, and highlights the PR you're viewing.
- **tabGroups**: keeps opened PRs together in a "Pull Requests" tab group.
- **notifications**: optional alerts when a new PR needs your review.
- **Host access to api.github.com**: reads your pull requests from GitHub's API.
- **Host access to github.com**: completes "Sign in with GitHub" (OAuth device flow).

## Single purpose statement
Shows the user's GitHub pull requests in Chrome's side panel and opens them in a dedicated tab group.

## Assets
- Icon: `icons/icon128.png` (Rail mark). Sources: `icons/icon.svg` (48px and up), `icons/icon-small.svg` (16 and 32px)
- Small promo tile, 440×280: `design/store/promo-tile-440x280.png`
- One-colour marks: `design/mark-black.svg`, `design/mark-white.svg`

Still needed:
- Screenshots, 1280×800 (light and dark sidebar next to a GitHub PR page)
- A privacy policy URL (required because the extension handles an auth token)
