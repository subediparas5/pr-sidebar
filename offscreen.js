import { parseGitHubPage } from './github-page.js';

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg?.target !== 'github-parser' || sender.id !== chrome.runtime.id) return;
  try { respond({ page: parseGitHubPage(msg.html) }); }
  catch (error) { respond({ error: error.message, code: error.code }); }
});
