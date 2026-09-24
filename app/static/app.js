/* TaskMaster Pro – single-page frontend for the Flask API. No build step. */
(() => {
  'use strict';

  const PER_PAGE = 20;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // ---------- Storage (wrapped: may be unavailable in private mode) ----------
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
  };
  const tokens = {
    get access() { return store.get('tm_access'); },
    get refresh() { return store.get('tm_refresh'); },
    save({ access_token, refresh_token }) {
      if (access_token) store.set('tm_access', access_token);
      if (refresh_token) store.set('tm_refresh', refresh_token);
    },
    clear() { store.remove('tm_access'); store.remove('tm_refresh'); },
  };

  // ---------- API client ----------
  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  let refreshing = null;
  async function refreshAccessToken() {
    if (!tokens.refresh) return false;
    // Share one in-flight refresh between concurrent requests
    refreshing ??= fetch('/refresh', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.refresh}` },
    }).then(async (res) => {
      if (!res.ok) return false;
      tokens.save(await res.json());
      return true;
    }).catch(() => false).finally(() => { refreshing = null; });
    return refreshing;
  }

  async function api(path, { method = 'GET', body, auth = true, retry = true } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && tokens.access) headers.Authorization = `Bearer ${tokens.access}`;

    let res;
    try {
      res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError('Network error – is the server running?', 0);
    }

    let data = null;
    if ((res.headers.get('Content-Type') || '').includes('application/json')) {
      data = await res.json().catch(() => null);
    }

    // Token problems come from Flask-JWT-Extended as {"msg": ...}; app errors use {"error": ...}
    // (e.g. a wrong current password is a 401 that must not sign the user out).
    const tokenProblem = auth && (res.status === 401 || res.status === 422) && !data?.error;
    if (tokenProblem) {
      if (retry && await refreshAccessToken()) {
        return api(path, { method, body, auth, retry: false });
      }
      signOut('Your session has expired. Please sign in again.');
      throw Object.assign(new ApiError('Not signed in', 401), { signedOut: true });
    }

    if (!res.ok) {
      throw new ApiError(data?.error || data?.msg || `Request failed (${res.status})`, res.status);
    }
    return { data, headers: res.headers };
  }

  // ---------- Small helpers ----------
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function svg(pathD, viewBox = '0 0 24 24') {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', viewBox);
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', pathD);
    s.append(p);
    return s;
  }
  const ICON_CHECK = 'M5 12.5l4.5 4.5L19 7.5';
  const ICON_CAL = 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z';

  function toast(message, type = 'info') {
    const node = el('div', { class: `toast${type === 'error' ? ' toast-error' : ''}`, role: 'status' }, message);
    const container = $('#toasts');
    container.append(node);
    while (container.children.length > 3) container.firstElementChild.remove();
    // Re-show as a popover so toasts sit above any open modal dialog
    if (container.showPopover) {
      try { container.hidePopover(); } catch { /* not open */ }
      container.showPopover();
    }
    setTimeout(() => {
      node.remove();
      if (!container.children.length && container.hidePopover) {
        try { container.hidePopover(); } catch { /* not open */ }
      }
    }, 3500);
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  const STATUS_LABEL = { pending: 'Pending', in_progress: 'In progress', completed: 'Completed' };
  const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };

  function parseLocalDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function dueLabel(iso) {
    const due = parseLocalDate(iso);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((due - today) / 86400000);
    if (days === 0) return 'Due today';
    if (days === 1) return 'Due tomorrow';
    if (days === -1) return 'Due yesterday';
    const opts = { month: 'short', day: 'numeric' };
    if (due.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
    return `Due ${due.toLocaleDateString(undefined, opts)}`;
  }

  function formatServerDate(value) {
    if (!value) return '–';
    // Timestamps from SQLite come back without a zone; they are UTC
    const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function setFormError(form, message) {
    $('.form-error', form).textContent = message || '';
  }

  async function withBusy(button, fn) {
    button.disabled = true;
    try { return await fn(); } finally { button.disabled = false; }
  }

  // ---------- Theme ----------
  function applyTheme(theme) {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }
  applyTheme(store.get('tm_theme'));
  $('#theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    store.set('tm_theme', next);
  });

  // ---------- App state ----------
  const state = {
    user: null,
    page: 1,
    totalPages: 1,
    editing: null, // task being edited, or null for a new task
  };

  function currentFilters() {
    const [sort, order] = $('#sort').value.split(':');
    return {
      q: $('#search').value.trim(),
      status: $('#filter-status').value,
      priority: $('#filter-priority').value,
      overdue: $('#filter-overdue').checked,
      sort,
      order,
    };
  }

  function hasActiveFilters(f) {
    return Boolean(f.q || f.status || f.priority || f.overdue);
  }

  // ---------- Views ----------
  function showAuth() {
    $('#app-view').hidden = true;
    $('#auth-view').hidden = false;
    $('#login-form [name=email]').focus();
  }

  function showApp() {
    $('#auth-view').hidden = true;
    $('#app-view').hidden = false;
    $('#username-label').textContent = state.user.username;
    $('#avatar').textContent = state.user.username.slice(0, 1);
    refresh();
  }

  function signOut(message) {
    tokens.clear();
    state.user = null;
    state.page = 1;
    $$('dialog[open]').forEach((d) => d.close());
    $('#task-list').replaceChildren();
    showAuth();
    if (message) toast(message, 'error');
  }

  // ---------- Auth forms ----------
  $$('[data-auth-tab]').forEach((tab) => tab.addEventListener('click', () => {
    const which = tab.dataset.authTab;
    $$('[data-auth-tab]').forEach((t) => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', String(t === tab));
    });
    $('#login-form').hidden = which !== 'login';
    $('#register-form').hidden = which !== 'register';
    $(`#${which}-form input`).focus();
  }));

  async function signIn(email, password) {
    const { data } = await api('/login', { method: 'POST', body: { email, password }, auth: false });
    tokens.save(data);
    state.user = (await api('/me')).data;
    showApp();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email || !password) return setFormError(form, 'Please enter your email and password.');
    setFormError(form, '');
    await withBusy($('button[type=submit]', form), async () => {
      try {
        await signIn(email, password);
        form.reset();
      } catch (err) {
        setFormError(form, err.status === 401 ? 'Incorrect email or password.' : err.message);
      }
    });
  });

  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const body = {
      username: form.username.value.trim(),
      email: form.email.value.trim(),
      password: form.password.value,
    };
    if (!body.username || !body.email || !body.password) return setFormError(form, 'All fields are required.');
    if (body.password.length < 6) return setFormError(form, 'Password must be at least 6 characters.');
    setFormError(form, '');
    await withBusy($('button[type=submit]', form), async () => {
      try {
        await api('/register', { method: 'POST', body, auth: false });
        await signIn(body.email, body.password);
        form.reset();
        toast(`Welcome, ${body.username}!`);
      } catch (err) {
        setFormError(form, err.message);
      }
    });
  });

  $('#logout-btn').addEventListener('click', () => signOut());

  // ---------- Stats ----------
  async function loadStats() {
    const { data } = await api('/tasks/stats');
    const values = {
      total: data.total,
      pending: data.by_status.pending,
      in_progress: data.by_status.in_progress,
      completed: data.by_status.completed,
      overdue: data.overdue,
      completion_rate: `${Math.round(data.completion_rate * 100)}%`,
    };
    for (const [key, value] of Object.entries(values)) {
      $(`[data-stat="${key}"]`).textContent = value;
    }
    $('#progress-bar').style.width = `${Math.round(data.completion_rate * 100)}%`;
    $('#clear-completed-btn').disabled = data.by_status.completed === 0;
  }

  // ---------- Task list ----------
  function renderTask(task) {
    const meta = [];
    if (task.status !== 'pending') {
      meta.push(el('span', { class: `badge badge-status-${task.status}` }, STATUS_LABEL[task.status]));
    }
    meta.push(el('span', { class: `badge badge-${task.priority}` }, PRIORITY_LABEL[task.priority]));
    if (task.due_date) {
      meta.push(el('span', { class: `badge${task.is_overdue ? ' badge-overdue' : ''}` },
        svg(ICON_CAL), task.is_overdue ? `Overdue · ${dueLabel(task.due_date).replace('Due ', '')}` : dueLabel(task.due_date)));
    }

    const done = task.status === 'completed';
    const check = el('button', {
      type: 'button',
      class: 'task-check',
      title: done ? 'Mark as pending' : 'Mark as completed',
      'aria-label': done ? `Mark "${task.title}" as pending` : `Mark "${task.title}" as completed`,
      onclick: (e) => { e.stopPropagation(); toggleComplete(task, e.currentTarget); },
    }, svg(ICON_CHECK));

    return el('li', {
      class: `task is-${task.status}`,
      tabindex: '0',
      dataset: { id: task.id },
      onclick: () => openTaskDialog(task),
      onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openTaskDialog(task); },
    },
    check,
    el('div', { class: 'task-body' },
      el('div', { class: 'task-title' }, task.title),
      task.description ? el('div', { class: 'task-desc' }, task.description) : null,
      el('div', { class: 'task-meta' }, meta)));
  }

  function renderSkeleton() {
    $('#task-list').replaceChildren(...Array.from({ length: 3 }, () => el('li', { class: 'skeleton' })));
    $('#empty-state').hidden = true;
  }

  let loadSeq = 0;
  async function loadTasks({ showSkeleton = false } = {}) {
    const seq = ++loadSeq;
    const f = currentFilters();
    const params = new URLSearchParams({ page: state.page, per_page: PER_PAGE, sort: f.sort, order: f.order });
    if (f.q) params.set('q', f.q);
    if (f.status) params.set('status', f.status);
    if (f.priority) params.set('priority', f.priority);
    if (f.overdue) params.set('overdue', 'true');

    if (showSkeleton) renderSkeleton();
    const { data, headers } = await api(`/tasks?${params}`);
    if (seq !== loadSeq) return; // a newer request superseded this one

    state.totalPages = Math.max(1, Number(headers.get('X-Total-Pages')) || 1);
    const total = Number(headers.get('X-Total-Count')) || 0;

    // Deleting the last task on a page: step back a page
    if (data.length === 0 && state.page > 1) {
      state.page = Math.min(state.page - 1, state.totalPages);
      return loadTasks();
    }

    $('#task-list').replaceChildren(...data.map(renderTask));

    const empty = data.length === 0;
    $('#empty-state').hidden = !empty;
    if (empty) {
      const filtered = hasActiveFilters(f);
      $('#empty-title').textContent = filtered ? 'No matching tasks' : 'No tasks yet';
      $('#empty-text').textContent = filtered
        ? 'Try a different search or clear the filters.'
        : 'Create your first task to get started.';
    }

    $('#pagination').hidden = state.totalPages <= 1;
    $('#page-info').textContent = `Page ${state.page} of ${state.totalPages} · ${total} tasks`;
    $('#prev-page').disabled = state.page <= 1;
    $('#next-page').disabled = state.page >= state.totalPages;
  }

  async function refresh(opts) {
    try {
      await Promise.all([loadTasks(opts), loadStats()]);
    } catch (err) {
      if (!err.signedOut) toast(err.message, 'error');
    }
  }

  const onFilterChange = () => { state.page = 1; refresh(); };
  $('#search').addEventListener('input', debounce(onFilterChange, 250));
  ['#filter-status', '#filter-priority', '#sort', '#filter-overdue']
    .forEach((sel) => $(sel).addEventListener('change', onFilterChange));

  $('#prev-page').addEventListener('click', () => { state.page -= 1; refresh(); window.scrollTo({ top: 0 }); });
  $('#next-page').addEventListener('click', () => { state.page += 1; refresh(); window.scrollTo({ top: 0 }); });

  async function toggleComplete(task, button) {
    const status = task.status === 'completed' ? 'pending' : 'completed';
    await withBusy(button, async () => {
      try {
        await api(`/tasks/${task.id}`, { method: 'PATCH', body: { status } });
        await refresh();
      } catch (err) {
        if (!err.signedOut) toast(err.message, 'error');
      }
    });
  }

  // ---------- Dialog helpers ----------
  $$('[data-close]').forEach((btn) => btn.addEventListener('click', () => btn.closest('dialog').close()));

  function confirmAction({ title, text, ok = 'Confirm' }) {
    const dialog = $('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('#confirm-ok').textContent = ok;
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
    });
  }

  // ---------- Task dialog ----------
  function openTaskDialog(task = null) {
    state.editing = task;
    const form = $('#task-form');
    form.reset();
    setFormError(form, '');
    $('#task-dialog-title').textContent = task ? 'Edit task' : 'New task';
    $('#task-save-btn').textContent = task ? 'Save changes' : 'Create task';
    $('#task-delete-btn').hidden = !task;
    form.title.value = task?.title ?? '';
    form.description.value = task?.description ?? '';
    form.status.value = task?.status ?? 'pending';
    form.priority.value = task?.priority ?? 'medium';
    form.due_date.value = task?.due_date ?? '';
    $('#task-dialog').showModal();
    form.title.focus();
  }

  $('#new-task-btn').addEventListener('click', () => openTaskDialog());

  $('#task-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const body = {
      title: form.title.value.trim(),
      description: form.description.value,
      status: form.status.value,
      priority: form.priority.value,
      due_date: form.due_date.value || null,
    };
    if (!body.title) {
      setFormError(form, 'Title is required.');
      return form.title.focus();
    }
    const editing = state.editing;
    await withBusy($('#task-save-btn'), async () => {
      try {
        if (editing) {
          await api(`/tasks/${editing.id}`, { method: 'PATCH', body });
        } else {
          await api('/tasks', { method: 'POST', body });
          state.page = 1;
        }
        $('#task-dialog').close();
        toast(editing ? 'Task updated' : 'Task created');
        await refresh();
      } catch (err) {
        if (!err.signedOut) setFormError(form, err.message);
      }
    });
  });

  $('#task-delete-btn').addEventListener('click', async () => {
    const task = state.editing;
    if (!task) return;
    $('#task-dialog').close();
    const ok = await confirmAction({ title: 'Delete task?', text: `"${task.title}" will be permanently deleted.`, ok: 'Delete' });
    if (!ok) return;
    try {
      await api(`/tasks/${task.id}`, { method: 'DELETE' });
      toast('Task deleted');
      await refresh();
    } catch (err) {
      if (!err.signedOut) toast(err.message, 'error');
    }
  });

  $('#clear-completed-btn').addEventListener('click', async () => {
    const ok = await confirmAction({
      title: 'Clear completed tasks?',
      text: 'All completed tasks will be permanently deleted.',
      ok: 'Clear',
    });
    if (!ok) return;
    try {
      const { data } = await api('/tasks/completed', { method: 'DELETE' });
      toast(`Deleted ${data.deleted} completed task${data.deleted === 1 ? '' : 's'}`);
      await refresh();
    } catch (err) {
      if (!err.signedOut) toast(err.message, 'error');
    }
  });

  // ---------- Account dialog ----------
  $('#account-btn').addEventListener('click', async () => {
    try {
      state.user = (await api('/me')).data;
    } catch (err) {
      if (!err.signedOut) toast(err.message, 'error');
      return;
    }
    $('#profile-username').textContent = state.user.username;
    $('#profile-email').textContent = state.user.email;
    $('#profile-since').textContent = formatServerDate(state.user.created_at);
    const form = $('#password-form');
    form.reset();
    setFormError(form, '');
    $('#account-dialog').showModal();
  });

  $('#password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const body = { current_password: form.current_password.value, new_password: form.new_password.value };
    if (!body.current_password || !body.new_password) return setFormError(form, 'Both fields are required.');
    if (body.new_password.length < 6) return setFormError(form, 'New password must be at least 6 characters.');
    setFormError(form, '');
    await withBusy($('button[type=submit]', form), async () => {
      try {
        await api('/me/password', { method: 'PUT', body });
        form.reset();
        toast('Password updated');
      } catch (err) {
        if (!err.signedOut) setFormError(form, err.message);
      }
    });
  });

  $('#delete-account-btn').addEventListener('click', async () => {
    $('#account-dialog').close();
    const ok = await confirmAction({
      title: 'Delete your account?',
      text: 'Your account and all of your tasks will be permanently deleted. This cannot be undone.',
      ok: 'Delete account',
    });
    if (!ok) return;
    try {
      await api('/me', { method: 'DELETE' });
      signOut();
      toast('Your account has been deleted');
    } catch (err) {
      if (!err.signedOut) toast(err.message, 'error');
    }
  });

  // ---------- Keyboard shortcut: "n" for a new task ----------
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
    if ($('#app-view').hidden || $('dialog[open]')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    e.preventDefault();
    openTaskDialog();
  });

  // ---------- Boot ----------
  (async () => {
    if (!tokens.access && !tokens.refresh) return showAuth();
    try {
      state.user = (await api('/me')).data;
      showApp();
    } catch (err) {
      if (!err.signedOut) {
        toast(err.message, 'error');
        showAuth();
      }
    }
  })();
})();
