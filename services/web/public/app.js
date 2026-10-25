const TOKEN_KEY = 'token';
const $ = (id) => document.getElementById(id);

let token = localStorage.getItem(TOKEN_KEY);

// ---------- Helpers ----------

function showMessage(text, isError = false) {
  const el = $('message');
  el.textContent = text;
  el.className = isError ? 'error' : '';
  el.hidden = false;
}

function clearMessage() {
  $('message').hidden = true;
}

// The JWT payload contains the email; read it just to show who is signed in
function emailFromToken(t) {
  try {
    const b64 = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64)).email || '';
  } catch {
    return '';
  }
}

function setView() {
  const signedIn = Boolean(token);
  $('auth-view').hidden = signedIn;
  $('app-view').hidden = !signedIn;
  $('user-bar').hidden = !signedIn;
  $('user-email').textContent = signedIn ? emailFromToken(token) : '';
}

function signOut(message) {
  token = null;
  localStorage.removeItem(TOKEN_KEY);
  $('result').hidden = true;
  setView();
  if (message) {
    showMessage(message, true);
  } else {
    clearMessage();
  }
}

// ---------- API ----------

class UnauthorizedError extends Error {}

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (auth && token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // empty or non-JSON body
  }

  if (res.status === 401 && auth) {
    signOut('Your session expired. Please log in again.');
    throw new UnauthorizedError('unauthorized');
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

function handleError(err) {
  if (!(err instanceof UnauthorizedError)) showMessage(err.message, true);
}

// ---------- Sign in / register ----------

async function login(email, password) {
  const data = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
  token = data.token;
  localStorage.setItem(TOKEN_KEY, token);
  $('password').value = '';
  setView();
  await loadLinks();
}

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearMessage();
  try {
    await login($('email').value, $('password').value);
  } catch (err) {
    handleError(err);
  }
});

$('register').addEventListener('click', async () => {
  clearMessage();
  if (!$('auth-form').reportValidity()) return;
  const email = $('email').value;
  const password = $('password').value;
  try {
    await api('/api/auth/register', { method: 'POST', body: { email, password }, auth: false });
    await login(email, password);
  } catch (err) {
    handleError(err);
  }
});

$('logout').addEventListener('click', () => signOut());

// ---------- Links ----------

// Build table cells with textContent, never innerHTML: the original URL is
// user input, and this keeps it from ever being interpreted as markup
function cell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

async function loadClicks(code, td) {
  try {
    const stats = await api(`/api/stats/${encodeURIComponent(code)}`, { auth: false });
    td.textContent = stats.totalClicks;
  } catch {
    td.textContent = '?';
  }
}

async function loadLinks() {
  const links = await api('/api/urls');
  const tbody = $('links');
  tbody.replaceChildren();
  $('empty').hidden = links.length > 0;

  for (const link of links) {
    // Built from the page's own address, so it is correct on any host
    const shortUrl = `${location.origin}/${link.shortCode}`;

    const linkCell = document.createElement('td');
    const a = document.createElement('a');
    a.href = shortUrl;
    a.textContent = shortUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    linkCell.appendChild(a);

    const originalCell = cell(link.originalUrl);
    originalCell.title = link.originalUrl;

    const clicksCell = cell('…');
    loadClicks(link.shortCode, clicksCell);

    const tr = document.createElement('tr');
    tr.append(linkCell, originalCell, clicksCell);
    tbody.appendChild(tr);
  }
}

$('shorten-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearMessage();
  try {
    const data = await api('/api/urls', { method: 'POST', body: { url: $('long-url').value } });
    const shortUrl = `${location.origin}/${data.shortCode}`;
    $('result-link').href = shortUrl;
    $('result-link').textContent = shortUrl;
    $('result').hidden = false;
    $('long-url').value = '';
    await loadLinks();
  } catch (err) {
    handleError(err);
  }
});

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('result-link').href);
    showMessage('Copied to clipboard.');
  } catch {
    // The clipboard API needs HTTPS (or localhost)
    showMessage('Could not copy automatically. Select the link and copy it manually.', true);
  }
});

$('refresh').addEventListener('click', () => {
  clearMessage();
  loadLinks().catch(handleError);
});

// ---------- Start ----------

setView();
if (token) loadLinks().catch(handleError);