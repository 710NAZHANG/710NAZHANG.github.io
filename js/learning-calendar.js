'use strict';

(() => {
  const DAY = 86400000;
  const dateKey = date => date.toISOString().slice(0, 10);
  const dateFromKey = key => new Date(key + 'T12:00:00Z');
  const todayInZone = (zone, now = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-US', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(now);
    const get = type => parts.find(part => part.type === type).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  };
  const calendarYear = year => {
    const first = new Date(Date.UTC(year, 0, 1));
    const last = new Date(Date.UTC(year, 11, 31));
    const start = new Date(first.getTime() - first.getUTCDay() * DAY);
    const days = [];
    for (let value = first.getTime(); value <= last.getTime(); value += DAY) {
      const date = new Date(value);
      days.push({key: dateKey(date), month: date.getUTCMonth(), day: date.getUTCDate(), row: date.getUTCDay(), week: Math.floor((value - start.getTime()) / DAY / 7)});
    }
    return {days, weeks: days[days.length - 1].week + 1};
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = {calendarYear, todayInZone};
  if (typeof document === 'undefined') return;
  const panel = document.querySelector('#learning');
  if (!panel) return;

  const $ = selector => document.querySelector(selector);
  const grid = $('#learning-calendar');
  const yearSelect = $('#learning-year');
  const summary = $('#learning-summary');
  const dialog = $('#learning-dialog');
  const message = $('#learning-dialog-message');
  const loginForm = $('#learning-login');
  const entryForm = $('#learning-entry');
  const notes = $('#learning-notes');
  const checked = $('#learning-checked');
  const saveButton = $('#learning-save');
  const saveStatus = $('#learning-save-status');
  const signInButton = $('#learning-signin');
  const signOutButton = $('#learning-signout');
  const zone = panel.dataset.timeZone || 'America/New_York';
  const startDate = panel.dataset.startDate;
  const startYear = Number(startDate.slice(0, 4));
  let today = todayInZone(zone);
  let year = Number(today.slice(0, 4));
  let checkins = new Set();
  let publicLoaded = false;
  let isOwner = false;
  let selectedDate = today;
  let savedEntry = null;
  let entryLoaded = false;
  let saving = false;
  let calendarRequest = 0;
  let entryRequest = 0;
  let authRequest = 0;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const longDate = key => new Intl.DateTimeFormat('en-US', {timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric'}).format(dateFromKey(key));
  $('#learning-start-date').textContent = longDate(startDate);
  const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(panel.dataset.supabaseUrl) && /^sb_publishable_[A-Za-z0-9_-]+$/.test(panel.dataset.publishableKey);
  const client = configured && window.supabase ? window.supabase.createClient(panel.dataset.supabaseUrl, panel.dataset.publishableKey, {
    auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'na-english-journal-auth'}
  }) : null;

  for (let optionYear = year + 1; optionYear >= startYear; optionYear--) {
    const option = document.createElement('option');
    option.value = String(optionYear);
    option.textContent = String(optionYear);
    option.selected = optionYear === year;
    yearSelect.append(option);
  }
  const dirty = () => entryLoaded && (notes.value !== (savedEntry ? savedEntry.notes : '') || checked.checked !== (savedEntry ? savedEntry.checked_in : true));
  const mayDiscard = () => !dirty() || window.confirm('Discard your unsaved changes?');
  const clearPrivateEntry = () => {
    entryRequest++;
    entryLoaded = false;
    savedEntry = null;
    notes.value = '';
    checked.checked = false;
    entryForm.hidden = true;
    saveStatus.textContent = '';
  };
  const openDialog = () => { if (!dialog.open) dialog.showModal(); };
  const closeDialog = () => {
    if (saving || !mayDiscard()) return;
    dialog.close();
    clearPrivateEntry();
  };
  $('#learning-close').addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  window.addEventListener('beforeunload', event => {
    if (dirty() || saving) { event.preventDefault(); event.returnValue = ''; }
  });

  function renderCalendar() {
    const calendar = calendarYear(year);
    grid.replaceChildren();
    grid.style.setProperty('--weeks', calendar.weeks);
    [['Mon', 3], ['Wed', 5], ['Fri', 7]].forEach(([label, row]) => {
      const element = document.createElement('span');
      element.className = 'learning-weekday';
      element.textContent = label;
      element.style.gridColumn = 1;
      element.style.gridRow = row;
      grid.append(element);
    });
    calendar.days.forEach(day => {
      if (day.day === 1) {
        const label = document.createElement('span');
        label.className = 'learning-month';
        label.textContent = monthNames[day.month];
        label.style.gridColumn = day.week + 2;
        label.style.gridRow = 1;
        grid.append(label);
      }
      const button = document.createElement('button');
      const future = day.key > today;
      const beforeStart = day.key < startDate;
      const marked = !beforeStart && publicLoaded && checkins.has(day.key);
      const status = beforeStart ? 'Before tracking started' : future ? 'Future date' : !publicLoaded ? 'Status unavailable' : marked ? 'Checked in' : 'Not checked in';
      button.type = 'button';
      button.className = 'learning-day' + (beforeStart ? ' is-before-start' : '') + (marked ? ' is-checked' : '') + (day.key === today ? ' is-today' : '') + (!beforeStart && !publicLoaded ? ' is-unknown' : '');
      button.style.gridColumn = day.week + 2;
      button.style.gridRow = day.row + 2;
      button.dataset.date = day.key;
      button.title = `${longDate(day.key)} · ${status}`;
      button.setAttribute('aria-label', button.title + (isOwner && !future && !beforeStart ? '. Edit private entry' : ''));
      button.disabled = future || beforeStart;
      grid.append(button);
    });
  }

  async function refreshCalendar() {
    const request = ++calendarRequest;
    const targetYear = year;
    if (!client) {
      publicLoaded = false;
      renderCalendar();
      summary.textContent = 'Calendar setup in progress.';
      return;
    }
    summary.textContent = 'Loading check-ins…';
    try {
      const firstDate = `${targetYear}-01-01` < startDate ? startDate : `${targetYear}-01-01`;
      const {data, error} = await client.from('learning_checkins').select('study_date').gte('study_date', firstDate).lte('study_date', `${targetYear}-12-31`).order('study_date');
      if (error) throw error;
      if (request !== calendarRequest || targetYear !== year) return;
      checkins = new Set(data.map(row => row.study_date));
      publicLoaded = true;
      renderCalendar();
      summary.textContent = `${checkins.size} ${checkins.size === 1 ? 'day' : 'days'} of learning in ${year}`;
    } catch (_) {
      if (request !== calendarRequest) return;
      publicLoaded = false;
      renderCalendar();
      summary.textContent = 'Check-ins could not load. Please refresh to try again.';
    }
  }

  function showLogin() {
    if (saving || !mayDiscard()) return;
    clearPrivateEntry();
    $('#learning-dialog-title').textContent = 'My journal';
    loginForm.hidden = !client;
    message.textContent = client ? 'Journal access is restricted to the owner.' : 'The private journal is not connected yet. Editing will be available after setup.';
    openDialog();
  }

  async function loadEntry(key) {
    if (!client || !isOwner || key < startDate || key > today || saving || !mayDiscard()) return;
    clearPrivateEntry();
    const request = ++entryRequest;
    selectedDate = key;
    loginForm.hidden = true;
    $('#learning-dialog-title').textContent = longDate(key);
    message.textContent = 'Loading your private entry…';
    openDialog();
    try {
      const {data, error} = await client.from('learning_entries').select('study_date,notes,checked_in,version').eq('study_date', key).maybeSingle();
      if (error) throw error;
      if (request !== entryRequest || !isOwner || !dialog.open) return;
      savedEntry = data;
      notes.value = data ? data.notes : '';
      checked.checked = data ? data.checked_in : true;
      entryLoaded = true;
      entryForm.hidden = false;
      message.textContent = '';
      saveStatus.textContent = data ? 'Saved entry loaded.' : 'No entry yet.';
      notes.focus();
    } catch (_) {
      if (request !== entryRequest) return;
      message.textContent = 'Your entry could not load. Close this window and try again; no changes have been saved.';
    }
  }

  grid.addEventListener('click', event => {
    const day = event.target.closest('.learning-day');
    if (!day || day.disabled) return;
    selectedDate = day.dataset.date;
    if (isOwner) { void loadEntry(selectedDate); return; }
    clearPrivateEntry();
    loginForm.hidden = true;
    $('#learning-dialog-title').textContent = longDate(selectedDate);
    message.textContent = !publicLoaded ? 'Check-in status is currently unavailable.' : checkins.has(selectedDate) ? 'Checked in for learning. Journal entries are private.' : 'No public check-in for this day. Journal entries are private.';
    openDialog();
  });
  yearSelect.addEventListener('change', () => {
    year = Number(yearSelect.value);
    checkins.clear();
    publicLoaded = false;
    renderCalendar();
    void refreshCalendar();
  });
  signInButton.addEventListener('click', () => { if (isOwner) void loadEntry(today); else showLogin(); });
  $('#learning-reload').addEventListener('click', () => { void loadEntry(selectedDate); });

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!client) return;
    const email = $('#learning-email').value.trim();
    if (email.toLowerCase() !== panel.dataset.ownerEmail.toLowerCase()) {
      message.textContent = 'Please use the owner email address.';
      return;
    }
    const button = $('#learning-send-link');
    button.disabled = true;
    message.textContent = 'Sending your sign-in link…';
    try {
      const {error} = await client.auth.signInWithOtp({email, options: {shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname}});
      if (error) throw error;
      message.textContent = 'Check your email and open the sign-in link to continue. You can open it on your computer or phone.';
    } catch (_) {
      message.textContent = 'The sign-in link could not be sent. Check the owner account and email setup, or try again later.';
    } finally { button.disabled = false; }
  });

  entryForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!client || !isOwner || !entryLoaded || saving) return;
    saving = true;
    saveButton.disabled = true;
    $('#learning-reload').disabled = true;
    $('#learning-close').disabled = true;
    notes.disabled = true;
    checked.disabled = true;
    saveStatus.textContent = 'Saving…';
    const draft = {notes: notes.value, checked_in: checked.checked};
    try {
      const {data, error} = await client.rpc('save_learning_entry', {p_date: selectedDate, p_notes: draft.notes, p_checked_in: draft.checked_in, p_expected_version: savedEntry ? savedEntry.version : 0});
      if (error) throw error;
      savedEntry = {...draft, study_date: selectedDate, version: data};
      saveStatus.textContent = 'Saved. Your journal is synced; only the check-in status is public.';
      void refreshCalendar();
    } catch (error) {
      saveStatus.textContent = error.code === '40001' ? 'This entry changed on another device. Your draft is still here. Copy it before reloading the saved entry.' : 'Not saved. Your draft is still here. Check your connection and sign-in, then try again.';
    } finally {
      saving = false;
      saveButton.disabled = false;
      $('#learning-reload').disabled = false;
      $('#learning-close').disabled = false;
      notes.disabled = false;
      checked.disabled = false;
    }
  });

  async function syncIdentity() {
    if (!client) return;
    const request = ++authRequest;
    let owner = false;
    try {
      const {data: {user}, error} = await client.auth.getUser();
      // A temporary connectivity failure must not erase an unsaved draft.
      if (error && error.name !== 'AuthSessionMissingError' && error.status !== 401 && error.status !== 403) return;
      if (!error && user) {
        const result = await client.rpc('is_learning_owner');
        if (result.error) return;
        owner = result.data === true;
      }
    } catch (_) { return; }
    if (request !== authRequest) return;
    const wasOwner = isOwner;
    isOwner = owner;
    signOutButton.hidden = !isOwner;
    signInButton.textContent = isOwner ? 'Edit my journal' : 'My journal';
    if (!isOwner && wasOwner) {
      clearPrivateEntry();
      message.textContent = 'Your session ended. Sign in again to read or edit your journal.';
      loginForm.hidden = false;
    }
    renderCalendar();
  }
  signOutButton.addEventListener('click', async () => {
    if (!client || saving || !mayDiscard()) return;
    signOutButton.disabled = true;
    const {error} = await client.auth.signOut({scope: 'local'});
    signOutButton.disabled = false;
    if (error) { summary.textContent = 'Sign-out failed. Please try again.'; return; }
    isOwner = false;
    clearPrivateEntry();
    if (dialog.open) dialog.close();
    await syncIdentity();
  });
  if (client) client.auth.onAuthStateChange(() => { window.setTimeout(() => { void syncIdentity(); }, 0); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      today = todayInZone(zone);
      void refreshCalendar();
      void syncIdentity();
    }
  });
  renderCalendar();
  void refreshCalendar();
  void syncIdentity();
})();
