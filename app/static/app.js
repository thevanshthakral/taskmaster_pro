/* TaskMaster Pro – single-page frontend for the Flask API. No build step. */
(() => {
  'use strict';

  const PER_PAGE = 20;
  const BOARD_LIMIT = 100;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  function reportError(err) {
    if (!err.signedOut) toast(err.message, { type: 'error' });
  }

  // ---------- DOM helpers ----------
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'style') node.style.cssText = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function icon(id, cls) {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('aria-hidden', 'true');
    if (cls) s.setAttribute('class', cls);
    const use = document.createElementNS(ns, 'use');
    use.setAttribute('href', `#i-${id}`);
    s.append(use);
    return s;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function showTopLayer(node) {
    // Popovers render in the top layer, above open modal dialogs
    if (!node.showPopover) return;
    try { node.hidePopover(); } catch { /* not open */ }
    try { node.showPopover(); } catch { /* unsupported */ }
  }

  function setFormError(form, message) {
    $('.form-error', form).textContent = message || '';
  }

  async function withBusy(button, fn) {
    button.disabled = true;
    const spinner = button.firstElementChild?.tagName === 'SPAN';
    if (spinner) button.classList.add('is-loading');
    try { return await fn(); } finally {
      button.disabled = false;
      button.classList.remove('is-loading');
    }
  }

  function animateNumber(node, to) {
    const from = Number(node.dataset.value ?? node.textContent) || 0;
    node.dataset.value = to;
    if (from === to || reducedMotion()) { node.textContent = to; return; }
    const start = performance.now();
    const duration = 600;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      node.textContent = Math.round(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function setCount(node, value) {
    const old = node.textContent;
    node.textContent = value;
    if (old !== String(value) && old !== '') {
      node.classList.remove('bump');
      void node.offsetWidth; // restart animation
      node.classList.add('bump');
    }
  }

  // ---------- Dates ----------
  const DAY = 86400000;
  function isoDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  function todayPlus(days) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return isoDate(d);
  }
  function parseLocalDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function daysFromToday(iso) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((parseLocalDate(iso) - today) / DAY);
  }
  function shortDate(iso) {
    const date = parseLocalDate(iso);
    const opts = { month: 'short', day: 'numeric' };
    if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return date.toLocaleDateString(undefined, opts);
  }
  function dueText(iso) {
    const days = daysFromToday(iso);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days === -1) return 'Yesterday';
    if (days > 1 && days < 7) return parseLocalDate(iso).toLocaleDateString(undefined, { weekday: 'long' });
    return shortDate(iso);
  }
  function serverDate(value) {
    if (!value) return null;
    // Timestamps from SQLite come back without a zone; they are UTC
    return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
  }
  function timeAgo(value) {
    const date = serverDate(value);
    if (!date) return '';
    const s = Math.round((Date.now() - date) / 1000);
    if (s < 45) return 'just now';
    const units = [[60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month'], [Infinity, 'year']];
    let n = s / 60;
    for (const [limit, unit] of units) {
      if (n < limit) {
        const v = Math.max(1, Math.round(n));
        return `${v} ${unit}${v === 1 ? '' : 's'} ago`;
      }
      n /= limit;
    }
    return '';
  }

  // ---------- Toasts ----------
  function toast(message, { type = 'info', action, duration = 3800 } = {}) {
    const container = $('#toasts');
    const node = el('div', { class: `toast${type === 'error' ? ' toast-error' : ''}`, role: 'status' },
      type === 'success' ? icon('done', 'toast-icon') : null,
      type === 'error' ? icon('alert', 'toast-icon') : null,
      el('span', {}, message));
    let timer;
    const dismiss = () => {
      clearTimeout(timer);
      node.classList.add('out');
      node.addEventListener('animationend', () => {
        node.remove();
        if (!container.children.length && container.hidePopover) {
          try { container.hidePopover(); } catch { /* not open */ }
        }
      }, { once: true });
    };
    if (action) {
      node.append(el('button', {
        type: 'button', class: 'toast-action',
        onclick: () => { dismiss(); action.onClick(); },
      }, action.label));
      duration = Math.max(duration, 5500);
    }
    node.append(el('span', { class: 'toast-timer', style: `animation-duration:${duration}ms` }));
    container.append(node);
    while (container.children.length > 3) container.firstElementChild.remove();
    showTopLayer(container);
    timer = setTimeout(dismiss, duration);
  }

  // ---------- Effects ----------
  const CONFETTI_COLORS = ['#6366f1', '#a855f7', '#ec4899', '#f59e0b', '#10b981', '#38bdf8'];
  function burst(x, y, { count = 16, power = 70, spread = Math.PI * 2, angle = -Math.PI / 2, gravity = 40 } = {}) {
    if (reducedMotion()) return;
    const layer = $('#fx-layer');
    if (layer.showPopover && !layer.matches(':popover-open')) showTopLayer(layer);
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const dist = power * (0.5 + Math.random() * 0.8);
      const p = el('i', {
        class: `confetti${Math.random() > 0.6 ? ' round' : ''}`,
        style: [
          `left:${x}px`, `top:${y}px`,
          `background:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]}`,
          `--dx:${Math.cos(a) * dist}px`,
          `--dy:${Math.sin(a) * dist + gravity * (0.5 + Math.random())}px`,
          `--rot:${(Math.random() - 0.5) * 720}deg`,
          `--dur:${700 + Math.random() * 600}ms`,
        ].join(';'),
      });
      p.addEventListener('animationend', () => {
        p.remove();
        if (!layer.children.length && layer.hidePopover) {
          try { layer.hidePopover(); } catch { /* not open */ }
        }
      });
      layer.append(p);
    }
  }
  function burstFrom(node, opts) {
    const r = node.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, opts);
  }
  function celebrate() {
    const w = window.innerWidth;
    [0.15, 0.35, 0.5, 0.65, 0.85].forEach((fx, i) => {
      setTimeout(() => burst(w * fx, window.innerHeight * 0.35, {
        count: 28, power: 260, spread: Math.PI * 1.2, gravity: 260,
      }), i * 120);
    });
    toast('All caught up! Enjoy your free time.', { type: 'success' });
  }

  // ---------- Theme (with circular reveal) ----------
  function applyTheme(theme) {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }
  applyTheme(store.get('tm_theme'));
  function currentTheme() {
    return document.documentElement.dataset.theme
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  function toggleTheme(origin) {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    store.set('tm_theme', next);
    if (!document.startViewTransition || reducedMotion()) return applyTheme(next);
    const r = origin?.getBoundingClientRect();
    const x = r ? r.left + r.width / 2 : window.innerWidth / 2;
    const y = r ? r.top + r.height / 2 : 0;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const transition = document.startViewTransition(() => applyTheme(next));
    transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 550, easing: 'cubic-bezier(.2,.8,.2,1)', pseudoElement: '::view-transition-new(root)' },
      );
    }).catch(() => { /* transition skipped */ });
  }
  $('#theme-toggle').addEventListener('click', (e) => toggleTheme(e.currentTarget));

  // ---------- Segmented controls ----------
  function updateThumb(group) {
    const active = $('.seg.active', group);
    const thumb = $('.seg-thumb', group);
    if (!active || !thumb || !active.offsetWidth) return;
    thumb.style.setProperty('--thumb-w', `${active.offsetWidth}px`);
    thumb.style.setProperty('--thumb-x', `${active.offsetLeft - 3}px`);
  }
  const updateAllThumbs = () => $$('.segmented').forEach(updateThumb);
  window.addEventListener('resize', debounce(updateAllThumbs, 100));
  document.fonts?.ready.then(updateAllThumbs);

  // ---------- Password inputs ----------
  $$('.pw-toggle').forEach((btn) => btn.addEventListener('click', () => {
    const input = btn.previousElementSibling;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    btn.replaceChildren(icon(show ? 'eye-off' : 'eye'));
    input.focus();
  }));

  function passwordScore(pw) {
    if (!pw) return 0;
    let score = pw.length >= 6 ? 1 : 0;
    if (pw.length >= 10) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
    return Math.max(1, Math.min(4, score));
  }
  const STRENGTH = ['', 'Too weak', 'Fair', 'Good', 'Strong'];
  $('#register-form [name=password]').addEventListener('input', (e) => {
    const meter = $('#register-form .strength');
    const pw = e.target.value;
    const level = pw.length < 6 ? (pw ? 1 : 0) : passwordScore(pw);
    meter.dataset.level = level;
    $('.strength-label', meter).textContent = STRENGTH[level];
  });

  // ---------- Views ----------
  const ACTIVE = 'pending,in_progress';
  const VIEWS = {
    active: {
      title: 'My tasks', sort: 'due_date:asc',
      params: () => ({ status: ACTIVE }),
      empty: ['Nothing on your plate', 'Add a task above, or enjoy the calm.'],
    },
    today: {
      title: 'Today', sort: 'priority:desc',
      params: () => ({ status: ACTIVE, due_after: todayPlus(0), due_before: todayPlus(0) }),
      empty: ['Nothing due today', 'Tasks due today will show up here. Try “… today” in quick add.'],
    },
    upcoming: {
      title: 'Upcoming', sort: 'due_date:asc',
      params: () => ({ status: ACTIVE, due_after: todayPlus(1) }),
      empty: ['No upcoming tasks', 'Give tasks a due date to plan ahead.'],
    },
    overdue: {
      title: 'Overdue', sort: 'due_date:asc',
      params: () => ({ overdue: 'true' }),
      empty: ['You’re all caught up', 'No overdue tasks — nice work!'],
    },
    in_progress: {
      title: 'In progress', sort: 'updated_at:desc',
      params: () => ({ status: 'in_progress' }),
      empty: ['Nothing in progress', 'Move a task to “In progress” to see it here.'],
    },
    completed: {
      title: 'Completed', sort: 'updated_at:desc',
      params: () => ({ status: 'completed' }),
      empty: ['No completed tasks yet', 'Finished tasks will appear here.'],
    },
    all: {
      title: 'All tasks', sort: 'created_at:desc',
      params: () => ({}),
      empty: ['No tasks yet', 'Add your first task above to get started.'],
    },
  };
  const VIEW_KEYS = Object.keys(VIEWS);

  // ---------- State & preferences ----------
  const prefs = (() => {
    const defaults = { view: 'active', layout: 'list', sort: 'default', priority: '' };
    try { return { ...defaults, ...JSON.parse(store.get('tm_prefs') || '{}') }; } catch { return defaults; }
  })();
  if (!VIEWS[prefs.view]) prefs.view = 'active';
  const savePrefs = () => store.set('tm_prefs', JSON.stringify(prefs));

  const state = {
    user: null,
    page: 1,
    totalPages: 1,
    tasks: new Map(),
    editing: null,
    lastActive: null,
    celebrateArmed: false,
  };

  // ---------- Auth ----------
  function showAuth() {
    $('#app-view').hidden = true;
    $('#auth-view').hidden = false;
    updateAllThumbs();
    $('#login-form').hidden ? $('#register-form [name=username]').focus() : $('#login-form [name=email]').focus();
  }

  function showApp() {
    $('#auth-view').hidden = true;
    $('#app-view').hidden = false;
    renderUser();
    renderHeroDate();
    syncControls();
    loadAll({ animate: true, skeleton: true });
  }

  function signOut(message) {
    tokens.clear();
    state.user = null;
    state.page = 1;
    state.lastActive = null;
    $$('dialog[open]').forEach((d) => d.close());
    closeDrawer();
    $('#task-list').replaceChildren();
    showAuth();
    if (message) toast(message, { type: 'error' });
  }

  $$('[data-auth-tab]').forEach((tab) => tab.addEventListener('click', () => {
    const which = tab.dataset.authTab;
    $$('[data-auth-tab]').forEach((t) => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', String(t === tab));
    });
    updateThumb(tab.closest('.segmented'));
    $('#login-form').hidden = which !== 'login';
    $('#register-form').hidden = which !== 'register';
    $('#auth-title').textContent = which === 'login' ? 'Welcome back' : 'Create your account';
    $('#auth-sub').textContent = which === 'login'
      ? 'Sign in to continue to your tasks.'
      : 'Start organising your work in seconds.';
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
        $('#register-form .strength').dataset.level = 0;
        $('#register-form .strength-label').textContent = '';
        toast(`Welcome aboard, ${body.username}!`, { type: 'success' });
        setTimeout(() => burst(window.innerWidth / 2, window.innerHeight / 3, { count: 40, power: 220, gravity: 200 }), 250);
      } catch (err) {
        setFormError(form, err.message);
      }
    });
  });

  $('#logout-btn').addEventListener('click', () => signOut());

  // ---------- Header / user ----------
  function renderUser() {
    const name = state.user.username;
    const initial = name.slice(0, 1);
    $('#username-label').textContent = name;
    $('#email-label').textContent = state.user.email;
    $('#avatar').textContent = initial;
    $('#avatar-sm').textContent = initial;
    $('#hero-name').textContent = name.charAt(0).toUpperCase() + name.slice(1);
  }

  function renderHeroDate() {
    const now = new Date();
    const h = now.getHours();
    $('#greeting').textContent = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    $('#today-label').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  // ---------- Counts & progress ----------
  async function countOf(params) {
    const qs = new URLSearchParams({ ...params, per_page: 1 });
    const { headers } = await api(`/tasks?${qs}`);
    return Number(headers.get('X-Total-Count')) || 0;
  }

  async function loadCounts() {
    const [{ data: stats }, today, upcoming] = await Promise.all([
      api('/tasks/stats'),
      countOf(VIEWS.today.params()),
      countOf(VIEWS.upcoming.params()),
    ]);
    const active = stats.by_status.pending + stats.by_status.in_progress;
    const counts = {
      active, today, upcoming,
      overdue: stats.overdue,
      in_progress: stats.by_status.in_progress,
      completed: stats.by_status.completed,
      all: stats.total,
    };
    for (const [key, value] of Object.entries(counts)) {
      const node = $(`[data-count="${key}"]`);
      setCount(node, value);
      node.classList.toggle('has', value > 0);
    }
    for (const key of ['active', 'today', 'overdue', 'completed']) {
      animateNumber($(`[data-stat="${key}"]`), counts[key]);
    }

    const pct = Math.round(stats.completion_rate * 100);
    $('#side-ring').style.strokeDashoffset = String(113.1 * (1 - stats.completion_rate));
    $('#side-ring-label').textContent = `${pct}%`;
    $('#side-progress-title').textContent = stats.total === 0 ? 'Let’s get started'
      : active === 0 ? 'All done!' : pct >= 75 ? 'Almost there' : pct >= 40 ? 'Making progress' : 'Keep going';
    $('#side-progress-text').textContent = stats.total === 0 ? 'No tasks yet'
      : `${stats.by_status.completed} of ${stats.total} tasks done`;

    const parts = [];
    if (today) parts.push(`${today} due today`);
    if (stats.overdue) parts.push(`${stats.overdue} overdue`);
    $('#hero-summary').textContent = stats.total === 0 ? 'Let’s plan something great today.'
      : active === 0 ? 'Everything is done. Time to relax! 🎉'
        : parts.length ? `You have ${parts.join(' and ')}.` : `You have ${active} open task${active === 1 ? '' : 's'}. Nothing urgent.`;

    $('#clear-completed-btn').disabled = stats.by_status.completed === 0;

    // Celebrate when completing the last open task
    if (state.celebrateArmed && state.lastActive > 0 && active === 0) celebrate();
    state.celebrateArmed = false;
    state.lastActive = active;
  }

  // ---------- Task rendering ----------
  function taskBadges(task, { board }) {
    const badges = [];
    if (!board && task.status === 'in_progress') {
      badges.push(el('span', { class: 'badge badge-progress' }, el('span', { class: 'dot dot-progress' }), 'In progress'));
    }
    if (task.priority !== 'medium' || board) {
      badges.push(el('span', { class: `badge badge-${task.priority}` }, icon('flag'), task.priority[0].toUpperCase() + task.priority.slice(1)));
    }
    if (task.due_date) {
      const days = daysFromToday(task.due_date);
      let cls = 'badge';
      let text = dueText(task.due_date);
      if (task.is_overdue) { cls += ' badge-overdue'; text = `Overdue · ${shortDate(task.due_date)}`; }
      else if (days === 0 && task.status !== 'completed') cls += ' badge-today';
      badges.push(el('span', { class: cls, title: shortDate(task.due_date) }, icon('cal'), text));
    }
    return badges;
  }

  function renderTask(task, { board = false, index = 0, animate = false } = {}) {
    const done = task.status === 'completed';
    const li = el('li', {
      class: `task${animate ? ' enter' : ''}`,
      tabindex: '0',
      draggable: board ? 'true' : null,
      style: `--i:${Math.min(index, 12)}`,
      dataset: { id: task.id, status: task.status, priority: task.priority },
      onclick: () => openTaskDialog(task),
      onkeydown: (e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter') openTaskDialog(task);
        if (e.key === ' ') { e.preventDefault(); toggleComplete(task, $('.check', li)); }
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteTask(task); }
      },
    },
    el('button', {
      type: 'button', class: 'check',
      title: done ? 'Mark as not done' : 'Mark as done',
      'aria-label': done ? `Mark “${task.title}” as not done` : `Mark “${task.title}” as done`,
      onclick: (e) => { e.stopPropagation(); toggleComplete(task, e.currentTarget); },
    }, icon('check')),
    el('div', { class: 'task-body' },
      el('div', { class: 'task-title' }, el('span', { class: 'task-title-text' }, task.title)),
      task.description ? el('div', { class: 'task-desc' }, task.description) : null,
      el('div', { class: 'task-meta' }, taskBadges(task, { board }))),
    board ? null : el('div', { class: 'task-actions' },
      el('button', {
        type: 'button', class: 'icon-btn', title: 'Delete', 'aria-label': `Delete “${task.title}”`,
        onclick: (e) => { e.stopPropagation(); deleteTask(task); },
      }, icon('trash'))));

    if (board) {
      li.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', String(task.id));
        e.dataTransfer.effectAllowed = 'move';
        requestAnimationFrame(() => li.classList.add('dragging'));
      });
      li.addEventListener('dragend', () => li.classList.remove('dragging'));
    }
    return li;
  }

  function skeletons(n = 3) {
    return Array.from({ length: n }, () => el('li', { class: 'skeleton' }));
  }

  function currentSort() {
    const value = prefs.sort === 'default' ? VIEWS[prefs.view].sort : prefs.sort;
    const [sort, order] = value.split(':');
    return { sort, order };
  }

  function filterParams({ includeStatus = true } = {}) {
    const params = { ...VIEWS[prefs.view].params(), ...currentSort() };
    if (!includeStatus) delete params.status;
    const q = $('#search').value.trim();
    if (q) params.q = q;
    if (prefs.priority) params.priority = prefs.priority;
    return params;
  }

  function hasExtraFilters() {
    return Boolean($('#search').value.trim() || prefs.priority);
  }

  function showEmpty(show) {
    const empty = $('#empty-state');
    empty.hidden = !show;
    if (!show) return;
    const [title, text] = hasExtraFilters()
      ? ['No matching tasks', 'Try a different search or clear the priority filter.']
      : VIEWS[prefs.view].empty;
    $('#empty-title').textContent = title;
    $('#empty-text').textContent = text;
  }

  let loadSeq = 0;
  async function loadList({ animate, skeleton }) {
    const seq = ++loadSeq;
    const list = $('#task-list');
    if (skeleton) { list.replaceChildren(...skeletons()); $('#empty-state').hidden = true; }

    const params = new URLSearchParams({ ...filterParams(), page: state.page, per_page: PER_PAGE });
    const { data, headers } = await api(`/tasks?${params}`);
    if (seq !== loadSeq) return;

    state.totalPages = Math.max(1, Number(headers.get('X-Total-Pages')) || 1);
    const total = Number(headers.get('X-Total-Count')) || 0;
    if (data.length === 0 && state.page > 1) {
      state.page = Math.min(state.page - 1, state.totalPages);
      return loadList({ animate, skeleton: false });
    }

    state.tasks = new Map(data.map((t) => [t.id, t]));
    list.replaceChildren(...data.map((task, index) => renderTask(task, { index, animate })));
    showEmpty(data.length === 0);
    $('#view-count').textContent = total;

    $('#pagination').hidden = state.totalPages <= 1;
    $('#page-info').textContent = `Page ${state.page} of ${state.totalPages}`;
    $('#prev-page').disabled = state.page <= 1;
    $('#next-page').disabled = state.page >= state.totalPages;
  }

  async function loadBoard({ animate, skeleton }) {
    const seq = ++loadSeq;
    const columns = ['pending', 'in_progress', 'completed'];
    if (skeleton) columns.forEach((s) => $(`[data-drop="${s}"]`).replaceChildren(...skeletons(2)));
    $('#empty-state').hidden = true;

    const base = filterParams({ includeStatus: false });
    const results = await Promise.all(columns.map((status) => api(`/tasks?${new URLSearchParams({
      ...base, status, per_page: BOARD_LIMIT,
    })}`)));
    if (seq !== loadSeq) return;

    state.tasks = new Map();
    let total = 0;
    columns.forEach((status, ci) => {
      const { data, headers } = results[ci];
      const count = Number(headers.get('X-Total-Count')) || 0;
      total += count;
      data.forEach((t) => state.tasks.set(t.id, t));
      const body = $(`[data-drop="${status}"]`);
      body.replaceChildren(...(data.length
        ? data.map((task, index) => renderTask(task, { board: true, index, animate }))
        : [el('li', { class: 'column-empty' }, 'Drop tasks here')]));
      if (count > data.length) body.append(el('li', { class: 'column-empty' }, `+${count - data.length} more — use list view`));
      $(`[data-col-count="${status}"]`).textContent = count;
    });
    $('#view-count').textContent = total;
  }

  async function loadTasks(opts = {}) {
    const board = prefs.layout === 'board';
    $('#list-view').hidden = board;
    $('#board-view').hidden = !board;
    return board ? loadBoard(opts) : loadList(opts);
  }

  async function loadAll(opts = {}) {
    try {
      await Promise.all([loadTasks(opts), loadCounts()]);
    } catch (err) {
      reportError(err);
    }
  }

  function flashTask(id) {
    const node = $(`.task[data-id="${id}"]`);
    if (!node) return false;
    node.classList.add('flash');
    node.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
    return true;
  }

  // ---------- Controls ----------
  function syncControls() {
    $$('.nav-item').forEach((n) => {
      const active = n.dataset.view === prefs.view;
      n.classList.toggle('active', active);
      if (active) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
    });
    $('#view-title').textContent = VIEWS[prefs.view].title;
    $('#sort').value = prefs.sort;
    $('#filter-priority').value = prefs.priority;
    $$('[data-layout]').forEach((b) => {
      const active = b.dataset.layout === prefs.layout;
      b.classList.toggle('active', active);
      b.setAttribute('aria-checked', String(active));
    });
    requestAnimationFrame(updateAllThumbs);
  }

  function setView(view) {
    if (!VIEWS[view]) return;
    prefs.view = view;
    savePrefs();
    state.page = 1;
    syncControls();
    closeDrawer();
    loadAll({ animate: true });
  }

  function setLayout(layout) {
    prefs.layout = layout;
    savePrefs();
    syncControls();
    loadAll({ animate: true, skeleton: true });
  }

  $$('.nav-item').forEach((n) => n.addEventListener('click', () => setView(n.dataset.view)));
  $$('[data-layout]').forEach((b) => b.addEventListener('click', () => setLayout(b.dataset.layout)));
  $('#sort').addEventListener('change', (e) => { prefs.sort = e.target.value; savePrefs(); state.page = 1; loadAll({ animate: true }); });
  $('#filter-priority').addEventListener('change', (e) => { prefs.priority = e.target.value; savePrefs(); state.page = 1; loadAll({ animate: true }); });
  $('#search').addEventListener('input', debounce(() => { state.page = 1; loadTasks({ animate: true }).catch(reportError); }, 250));
  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && e.target.value) { e.target.value = ''; e.target.dispatchEvent(new Event('input')); }
  });
  $('#prev-page').addEventListener('click', () => { state.page -= 1; loadTasks({ animate: true }).catch(reportError); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  $('#next-page').addEventListener('click', () => { state.page += 1; loadTasks({ animate: true }).catch(reportError); window.scrollTo({ top: 0, behavior: 'smooth' }); });

  // ---------- Mobile drawer ----------
  function openDrawer() { $('#sidebar').classList.add('open'); $('#scrim').hidden = false; }
  function closeDrawer() { $('#sidebar').classList.remove('open'); $('#scrim').hidden = true; }
  $('#open-drawer').addEventListener('click', openDrawer);
  $('#close-drawer').addEventListener('click', closeDrawer);
  $('#scrim').addEventListener('click', closeDrawer);
  $('#fab').addEventListener('click', () => openTaskDialog());
  $('#mobile-account').addEventListener('click', () => openAccount());

  // ---------- Task actions ----------
  // Views that hide completed tasks – a completed task animates out of them
  const hidesCompleted = () => ['active', 'today', 'upcoming', 'overdue', 'in_progress'].includes(prefs.view);

  function animateOut(node) {
    return new Promise((resolve) => {
      if (!node || reducedMotion()) return resolve();
      node.style.height = `${node.offsetHeight}px`;
      node.classList.add('leave');
      node.addEventListener('animationend', resolve, { once: true });
      setTimeout(resolve, 500);
    });
  }

  async function setStatus(task, status) {
    await api(`/tasks/${task.id}`, { method: 'PATCH', body: { status } });
  }

  async function toggleComplete(task, check) {
    const completing = task.status !== 'completed';
    const previous = task.status;
    const node = check?.closest('.task');
    if (check) check.disabled = true;
    if (completing && check) {
      check.classList.add('checking');
      node?.classList.add('striking');
      burstFrom(check, { count: 14, power: 55, gravity: 30 });
    }
    try {
      await setStatus(task, completing ? 'completed' : 'pending');
      state.celebrateArmed = completing;
      if (prefs.layout === 'list' && (completing ? hidesCompleted() : prefs.view === 'completed')) {
        await new Promise((r) => setTimeout(r, completing ? 250 : 0));
        await animateOut(node);
      }
      await loadAll();
      toast(completing ? `Completed “${task.title}”` : `Reopened “${task.title}”`, {
        type: completing ? 'success' : 'info',
        action: {
          label: 'Undo',
          onClick: async () => {
            try { await setStatus(task, previous); await loadAll(); } catch (err) { reportError(err); }
          },
        },
      });
    } catch (err) {
      check?.classList.remove('checking');
      node?.classList.remove('striking');
      reportError(err);
    } finally {
      if (check) check.disabled = false;
    }
  }

  async function deleteTask(task) {
    const node = $(`.task[data-id="${task.id}"]`);
    try {
      await api(`/tasks/${task.id}`, { method: 'DELETE' });
      await animateOut(node);
      await loadAll();
      toast(`Deleted “${task.title}”`, {
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              const { data } = await api('/tasks', {
                method: 'POST',
                body: {
                  title: task.title, description: task.description, status: task.status,
                  priority: task.priority, due_date: task.due_date,
                },
              });
              await loadAll();
              flashTask(data.id);
            } catch (err) { reportError(err); }
          },
        },
      });
    } catch (err) {
      reportError(err);
    }
  }

  $('#clear-completed-btn').addEventListener('click', async () => {
    const ok = await confirmAction({
      title: 'Clear completed tasks?',
      text: 'All completed tasks will be permanently deleted. This can’t be undone.',
      ok: 'Clear tasks',
    });
    if (!ok) return;
    try {
      const { data } = await api('/tasks/completed', { method: 'DELETE' });
      await Promise.all($$('.task[data-status="completed"]').map(animateOut));
      toast(`Cleared ${data.deleted} completed task${data.deleted === 1 ? '' : 's'}`, { type: 'success' });
      await loadAll();
    } catch (err) {
      reportError(err);
    }
  });

  // ---------- Board drag & drop ----------
  $$('[data-drop]').forEach((zone) => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const id = Number(e.dataTransfer.getData('text/plain'));
      const task = state.tasks.get(id);
      const status = zone.dataset.drop;
      if (!task || task.status === status) return;
      // Optimistic move
      const node = $(`.task[data-id="${id}"]`);
      $('.column-empty', zone)?.remove();
      if (node) { node.dataset.status = status; zone.prepend(node); }
      if (status === 'completed') burst(e.clientX, e.clientY, { count: 18, power: 70 });
      try {
        await setStatus(task, status);
        state.celebrateArmed = status === 'completed';
      } catch (err) {
        reportError(err);
      }
      await loadAll();
    });
  });

  // ---------- Quick add (natural language) ----------
  const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const PRIORITY_TOKENS = { high: 'high', h: 'high', urgent: 'high', 1: 'high', medium: 'medium', med: 'medium', m: 'medium', 2: 'medium', low: 'low', l: 'low', 3: 'low' };

  function parseQuick(text) {
    let rest = ` ${text} `;
    const result = { priority: null, due_date: null };
    const take = (re, fn) => {
      const m = rest.match(re);
      if (!m) return;
      fn(m);
      rest = rest.replace(m[0], ' ');
    };

    take(/\s!(high|h|urgent|medium|med|m|low|l|[123])(?=\s)/i, (m) => { result.priority = PRIORITY_TOKENS[m[1].toLowerCase()]; });
    take(/\s(\d{4}-\d{2}-\d{2})(?=\s)/, (m) => { if (!Number.isNaN(parseLocalDate(m[1]).getTime())) result.due_date = m[1]; });
    if (!result.due_date) take(/\s(today|tod)(?=\s)/i, () => { result.due_date = todayPlus(0); });
    if (!result.due_date) take(/\s(tomorrow|tmrw?|tmr)(?=\s)/i, () => { result.due_date = todayPlus(1); });
    if (!result.due_date) take(/\snext week(?=\s)/i, () => { result.due_date = todayPlus(7); });
    if (!result.due_date) take(/\sin (\d{1,3}) days?(?=\s)/i, (m) => { result.due_date = todayPlus(Number(m[1])); });
    if (!result.due_date) {
      take(/\s(?:on|next) (sun|mon|tue|wed|thu|fri|sat)[a-z]*(?=\s)/i, (m) => {
        const target = WEEKDAYS.indexOf(m[1].toLowerCase());
        let diff = (target - new Date().getDay() + 7) % 7;
        if (diff === 0) diff = 7;
        result.due_date = todayPlus(diff);
      });
    }
    result.title = rest.replace(/\s+/g, ' ').trim();
    return result;
  }

  function renderQuickChips() {
    const value = $('#quick-input').value;
    const parsed = parseQuick(value);
    const chips = [];
    if (parsed.priority) {
      chips.push(el('span', { class: `badge badge-${parsed.priority}` }, icon('flag'), parsed.priority[0].toUpperCase() + parsed.priority.slice(1)));
    }
    if (parsed.due_date) chips.push(el('span', { class: 'badge badge-today' }, icon('cal'), dueText(parsed.due_date)));
    const container = $('#qa-chips');
    const signature = chips.map((c) => c.textContent).join('|');
    if (container.dataset.sig !== signature) {
      container.replaceChildren(...chips);
      container.dataset.sig = signature;
    }
    $('#quick-submit').disabled = !parsed.title;
    return parsed;
  }

  $('#quick-input').addEventListener('input', renderQuickChips);
  const narrow = matchMedia('(max-width: 640px)');
  const setQuickPlaceholder = () => {
    $('#quick-input').placeholder = narrow.matches ? 'Add a task… e.g. “Gym today !high”' : 'Add a task… try “Pay rent tomorrow !high”';
  };
  narrow.addEventListener('change', setQuickPlaceholder);
  setQuickPlaceholder();
  $('#quick-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.target.value = ''; renderQuickChips(); e.target.blur(); }
  });
  $('#quick-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#quick-input');
    const parsed = renderQuickChips();
    if (!parsed.title) return;
    const body = { title: parsed.title.slice(0, 150) };
    if (parsed.priority) body.priority = parsed.priority;
    if (parsed.due_date) body.due_date = parsed.due_date;
    // Adding from the "In progress" view starts the task right away
    if (prefs.view === 'in_progress') body.status = 'in_progress';
    const submit = $('#quick-submit');
    submit.disabled = true;
    try {
      const { data } = await api('/tasks', { method: 'POST', body });
      input.value = '';
      renderQuickChips();
      burstFrom($('.qa-icon'), { count: 10, power: 40, gravity: 20 });
      state.page = 1;
      await loadAll();
      if (!flashTask(data.id)) {
        const where = data.due_date && daysFromToday(data.due_date) === 0 ? 'today'
          : data.due_date && daysFromToday(data.due_date) > 0 ? 'upcoming' : 'active';
        toast(`Added “${data.title}”`, { type: 'success', action: { label: 'View', onClick: () => { setView(where); setTimeout(() => flashTask(data.id), 400); } } });
      }
    } catch (err) {
      reportError(err);
    } finally {
      renderQuickChips();
    }
  });

  // ---------- Dialog helpers ----------
  $$('[data-close]').forEach((btn) => btn.addEventListener('click', () => btn.closest('dialog').close()));
  // Click on the backdrop closes a dialog
  $$('dialog').forEach((d) => d.addEventListener('mousedown', (e) => {
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) d.close();
  }));

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
  const taskForm = $('#task-form');
  const autoGrow = (ta) => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight + 2, 260)}px`; };
  taskForm.description.addEventListener('input', (e) => autoGrow(e.target));

  function openTaskDialog(task = null) {
    state.editing = task;
    taskForm.reset();
    setFormError(taskForm, '');
    $('#task-dialog-kind').textContent = task ? 'Edit task' : 'New task';
    $('#task-save-btn').textContent = task ? 'Save changes' : 'Create task';
    $('#task-delete-btn').hidden = !task;
    taskForm.title.value = task?.title ?? '';
    taskForm.description.value = task?.description ?? '';
    const defaultStatus = !task && prefs.view === 'in_progress' ? 'in_progress' : 'pending';
    taskForm.querySelector(`[name=status][value="${task?.status ?? defaultStatus}"]`).checked = true;
    taskForm.querySelector(`[name=priority][value="${task?.priority ?? 'medium'}"]`).checked = true;
    taskForm.due_date.value = task?.due_date ?? (!task && prefs.view === 'today' ? todayPlus(0) : '');
    $('#task-meta-line').textContent = task
      ? `Created ${timeAgo(task.created_at)}${task.updated_at ? ` · Updated ${timeAgo(task.updated_at)}` : ''}`
      : '';
    $('#task-dialog').showModal();
    autoGrow(taskForm.description);
    taskForm.title.focus();
  }

  $$('[data-due]').forEach((chip) => chip.addEventListener('click', () => {
    taskForm.due_date.value = chip.dataset.due === '' ? '' : todayPlus(Number(chip.dataset.due));
  }));

  taskForm.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); taskForm.requestSubmit(); }
    if (e.key === 'Enter' && e.target === taskForm.title) { e.preventDefault(); taskForm.requestSubmit(); }
  });

  taskForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      title: taskForm.title.value.trim(),
      description: taskForm.description.value,
      status: taskForm.querySelector('[name=status]:checked').value,
      priority: taskForm.querySelector('[name=priority]:checked').value,
      due_date: taskForm.due_date.value || null,
    };
    if (!body.title) {
      setFormError(taskForm, 'Please give your task a title.');
      return taskForm.title.focus();
    }
    const editing = state.editing;
    await withBusy($('#task-save-btn'), async () => {
      try {
        const { data } = editing
          ? await api(`/tasks/${editing.id}`, { method: 'PATCH', body })
          : await api('/tasks', { method: 'POST', body });
        $('#task-dialog').close();
        if (!editing) state.page = 1;
        state.celebrateArmed = body.status === 'completed' && editing?.status !== 'completed';
        await loadAll();
        flashTask(data.id);
        const justCompleted = body.status === 'completed' && editing?.status !== 'completed';
        if (justCompleted) burst(window.innerWidth / 2, window.innerHeight / 2, { count: 24, power: 120 });
        toast(editing ? 'Task updated' : `Added “${data.title}”`, { type: 'success' });
      } catch (err) {
        if (!err.signedOut) setFormError(taskForm, err.message);
      }
    });
  });

  $('#task-delete-btn').addEventListener('click', () => {
    const task = state.editing;
    if (!task) return;
    $('#task-dialog').close();
    deleteTask(task);
  });

  // ---------- Account dialog ----------
  async function openAccount() {
    closeDrawer();
    try {
      state.user = (await api('/me')).data;
    } catch (err) {
      return reportError(err);
    }
    renderUser();
    $('#profile-avatar').textContent = state.user.username.slice(0, 1);
    $('#profile-username').textContent = state.user.username;
    $('#profile-email').textContent = state.user.email;
    const since = serverDate(state.user.created_at);
    $('#profile-since').textContent = since
      ? since.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '–';
    const form = $('#password-form');
    form.reset();
    setFormError(form, '');
    $('#account-dialog').showModal();
  }
  $('#account-btn').addEventListener('click', openAccount);

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
        toast('Password updated', { type: 'success' });
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
      reportError(err);
    }
  });

  $('#shortcuts-btn').addEventListener('click', () => $('#shortcuts-dialog').showModal());

  // ---------- Keyboard shortcuts ----------
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ($('#app-view').hidden || $('dialog[open]')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    const key = e.key;
    const actions = {
      n: () => openTaskDialog(),
      q: () => $('#quick-input').focus(),
      '/': () => $('#search').focus(),
      b: () => setLayout(prefs.layout === 'list' ? 'board' : 'list'),
      t: () => toggleTheme($('#theme-toggle')),
      '?': () => $('#shortcuts-dialog').showModal(),
      Escape: () => closeDrawer(),
    };
    if (/^[1-7]$/.test(key)) { e.preventDefault(); setView(VIEW_KEYS[Number(key) - 1]); return; }
    const action = actions[key] || actions[key.toLowerCase?.()];
    if (action) { e.preventDefault(); action(); }
  });

  // Refresh the greeting/date and relative due dates when the tab becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.user) { renderHeroDate(); loadAll(); }
  });

  // ---------- Boot ----------
  (async () => {
    if (!tokens.access && !tokens.refresh) return showAuth();
    try {
      state.user = (await api('/me')).data;
      showApp();
    } catch (err) {
      if (!err.signedOut) {
        toast(err.message, { type: 'error' });
        showAuth();
      }
    }
  })();
})();
