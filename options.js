import { SECTIONS, getSettings, fetchViewer, signOut } from './github.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function renderAccount() {
  const s = await getSettings();
  const box = $('account');
  if (!s.token) {
    box.innerHTML = '<span class="who hint">Not signed in. Use <b>Sign in with GitHub</b> in the sidebar, or paste a token below.</span>';
    return;
  }
  box.innerHTML = '<span class="who hint">Checking…</span>';
  try {
    const v = await fetchViewer(s.token);
    box.innerHTML = `<img src="${esc(v.avatarUrl)}" alt="" /><span class="who">Signed in as <b>@${esc(v.login)}</b>
      <span class="hint">· ${s.authMethod === 'oauth' ? 'Sign in with GitHub' : 'personal access token'}</span></span>
      <button id="signout" class="secondary">Sign out</button>`;
  } catch (err) {
    box.innerHTML = `<span class="who" style="color:var(--red)">${esc(err.message)}</span><button id="signout" class="secondary">Sign out</button>`;
  }
  $('signout').addEventListener('click', async () => {
    await signOut();
    $('token').value = '';
    renderAccount();
  });
}

(async () => {
  const s = await getSettings();
  $('token').value = s.authMethod === 'oauth' ? '' : s.token;
  $('interval').value = String(s.intervalMinutes);
  $('color').value = s.groupColor;
  $('notify').checked = s.notify;
  (s.customFolders || []).forEach(addFolderRow);
  $('sections').innerHTML = `<label class="check"><span class="name">Needs your attention
      <span class="hint" style="display:block;font-weight:400">Review requests, changes requested, failing checks, ready to merge and your other open PRs, from any date</span></span>
      <input type="checkbox" id="show-attention" ${s.showAttention ? 'checked' : ''}/></label>` + Object.entries(SECTIONS)
    .map(([k, v]) => `<label class="check"><span class="name">${v.title}</span><input type="checkbox" data-key="${k}" ${s.sections[k] ? 'checked' : ''}/></label>`)
    .join('');
  renderAccount();
})();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) {
    const o = changes.settings.oldValue?.token, n = changes.settings.newValue?.token;
    if (o !== n) renderAccount();
  }
});

function addFolderRow(f = {}) {
  const row = document.createElement('div');
  row.className = 'cf';
  row.dataset.id = f.id || Math.random().toString(36).slice(2, 10);
  row.innerHTML = `<input class="t" placeholder="Folder name" /><input class="q" placeholder="repo:owner/name is:open" />
    <button title="Remove">×</button>`;
  row.querySelector('.t').value = f.title || '';
  row.querySelector('.q').value = f.query || '';
  row.querySelector('button').addEventListener('click', () => row.remove());
  $('custom').appendChild(row);
}
$('add-folder').addEventListener('click', () => { addFolderRow(); $('custom').lastElementChild.querySelector('.t').focus(); });

$('save').addEventListener('click', async () => {
  const msg = $('msg');
  msg.className = '';
  msg.textContent = 'Saving settings…';
  const pasted = $('token').value.trim();
  try {
    const prev = await getSettings();
    // A pasted token replaces the current sign-in; an empty box keeps whatever is signed in.
    const auth = pasted ? { token: pasted, authMethod: 'pat' } : { token: prev.token, authMethod: prev.authMethod };
    if (pasted) await fetchViewer(pasted);
    const sections = {};
    document.querySelectorAll('[data-key]').forEach((el) => (sections[el.dataset.key] = el.checked));
    await chrome.storage.local.set({
      settings: {
        ...prev, ...auth, sections,
        notify: $('notify').checked,
        showAttention: $('show-attention').checked,
        customFolders: [...document.querySelectorAll('.cf')]
          .map((r) => ({ id: r.dataset.id, title: r.querySelector('.t').value.trim(), query: r.querySelector('.q').value.trim() }))
          .filter((f) => f.query),
        intervalMinutes: Number($('interval').value), intervalChosen: true, groupColor: $('color').value },
    });
    await chrome.runtime.sendMessage({ type: 'settingsChanged' });
    msg.className = 'ok';
    msg.textContent = 'Settings saved.';
  } catch (err) {
    msg.className = 'err';
    msg.textContent = err.message;
  }
});
