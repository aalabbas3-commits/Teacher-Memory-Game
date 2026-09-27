'use strict';

const API_URL = 'https://script.google.com/macros/s/AKfycbyfeSB3gvBHTfHuCwozfPG-GUflo6AmJmer8HJSUStmY_IdCutZWJdnHTsVfIfdpHfc/exec';

const state = {
  pin: '',
  lessons: [],
  themes: [],
  displayModes: [],
  settings: [],
  levels: [],
  topics: [],
  cards: [],
  questions: [],
  results: [],
  levelResults: [],
  teamResults: [],
  answerLogs: [],
  notes: [],
  selectedResultIds: new Set(),
  activeTab: 'lessons',
  editingType: '',
  editingRecord: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const loginView = $('#loginView');
const dashboardView = $('#dashboardView');
const loginForm = $('#loginForm');
const teacherPin = $('#teacherPin');
const loginButton = $('#loginButton');
const loginMessage = $('#loginMessage');
const recordDialog = $('#recordDialog');
const recordForm = $('#recordForm');
const formFields = $('#formFields');
const formMessage = $('#formMessage');

async function api(action, payload = {}) {
  const response = await fetch(API_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, teacher_pin: state.pin, ...payload })
  });
  if (!response.ok) throw new Error('تعذر الاتصال بقاعدة البيانات.');
  const result = await response.json();
  if (!result.ok) throw new Error(result.error || 'لم تكتمل العملية.');
  return result.data;
}

function setBusy(button, busy, text) {
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? text : button.dataset.label;
}

function showToast(text) {
  const toast = $('#toast');
  toast.textContent = text;
  toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { toast.hidden = true; }, 3500);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function activeValue(value) {
  if (value === false || value === 0) return false;
  return !['false', '0', 'no', 'لا', 'غير مفعل'].includes(String(value ?? '').trim().toLowerCase());
}

function explicitlyEnabled(value) {
  if (value === true || value === 1) return true;
  return ['true', '1', 'yes', 'نعم', 'مفعل', 'مفعّل'].includes(String(value ?? '').trim().toLowerCase());
}

const LEVEL_LAYOUT_SUGGESTIONS = Object.freeze({
  2: [[2]],
  4: [[2, 2], [4]],
  6: [[3, 3], [2, 2, 2]],
  8: [[4, 4], [3, 3, 2]],
  10: [[4, 3, 3], [5, 5]],
  12: [[4, 4, 4], [5, 4, 3], [6, 6]],
  14: [[4, 5, 5], [5, 5, 4], [5, 4, 3, 2]],
  16: [[5, 6, 5], [4, 4, 4, 4], [6, 5, 5]],
  18: [[6, 5, 4, 3], [6, 6, 6], [5, 5, 4, 4]],
  20: [[5, 5, 5, 5], [6, 5, 5, 4]]
});

function parseLevelLayout(value) {
  const rows = String(value || '').trim().split(/[^0-9]+/).filter(Boolean).map(Number);
  if (!rows.length || rows.some((count) => !Number.isInteger(count) || count < 1 || count > 10)) return null;
  return rows;
}

function balancedLevelRows(cardCount, rowCount) {
  const base = Math.floor(cardCount / rowCount);
  const remainder = cardCount % rowCount;
  return Array.from({ length: rowCount }, (_, index) => base + (index < remainder ? 1 : 0)).filter(Boolean);
}

function suggestedLevelLayouts(cardCount) {
  if (LEVEL_LAYOUT_SUGGESTIONS[cardCount]) return LEVEL_LAYOUT_SUGGESTIONS[cardCount].map((rows) => [...rows]);
  const targetRows = cardCount <= 8 ? 2 : cardCount <= 16 ? 3 : cardCount <= 24 ? 4 : Math.ceil(cardCount / 6);
  const candidates = [targetRows, targetRows + 1, Math.max(1, targetRows - 1)]
    .map((rows) => balancedLevelRows(cardCount, rows))
    .filter((rows) => Math.max(...rows) <= 10 && Math.min(...rows) >= 2);
  const unique = new Map(candidates.map((rows) => [rows.join('-'), rows]));
  return [...unique.values()].slice(0, 3);
}

function defaultLevelLayout(cardCount) {
  return suggestedLevelLayouts(cardCount)[0] || balancedLevelRows(cardCount, Math.max(1, Math.ceil(cardCount / 6)));
}

function levelLayoutText(level) {
  const count = Number(level.card_count || 0);
  const rows = parseLevelLayout(level.row_layout);
  return rows && rows.reduce((sum, value) => sum + value, 0) === count
    ? rows.join('–')
    : defaultLevelLayout(count).join('–');
}

function statusBadge(value) {
  const active = activeValue(value);
  return `<span class="status-pill ${active ? 'active' : 'inactive'}">${active ? 'مفعّل' : 'معطّل'}</span>`;
}

function visibilityBadge(value) {
  const visible = activeValue(value);
  return `<span class="status-pill ${visible ? 'active' : 'inactive'}">${visible ? 'ظاهر' : 'مخفي'}</span>`;
}

function displayImageUrl(value) {
  const url = String(value || '').trim();
  if (!url || !url.includes('drive.google.com')) return url;
  const idMatch = url.match(/[?&]id=([^&]+)/) || url.match(/\/d\/([^/]+)/);
  if (!idMatch) return url;
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(idMatch[1])}&sz=w1200`;
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginMessage.textContent = '';
  state.pin = teacherPin.value.trim();
  if (state.pin.length < 6) {
    loginMessage.textContent = 'أدخل رمز المعلم المكوّن من 6 خانات على الأقل.';
    return;
  }
  setBusy(loginButton, true, 'جارٍ التحقق…');
  try {
    await api('teacher_auth');
    sessionStorage.setItem('plants_teacher_pin', state.pin);
    loginView.hidden = true;
    dashboardView.hidden = false;
    await loadAll();
  } catch (error) {
    state.pin = '';
    loginMessage.textContent = error.message.includes('رمز') ? 'رمز المعلم غير صحيح.' : error.message;
  } finally {
    setBusy(loginButton, false, '');
  }
});

$('#togglePin').addEventListener('click', () => {
  const hidden = teacherPin.type === 'password';
  teacherPin.type = hidden ? 'text' : 'password';
  $('#togglePin').textContent = hidden ? 'إخفاء' : 'إظهار';
});

$('#logoutButton').addEventListener('click', () => {
  sessionStorage.removeItem('plants_teacher_pin');
  state.pin = '';
  dashboardView.hidden = true;
  loginView.hidden = false;
  teacherPin.value = '';
  teacherPin.focus();
});

async function loadAll() {
  await Promise.all([
    loadLessons(),
    loadLevels(),
    loadTopics(),
    loadAppearanceData()
  ]);
  updateLessonFilter();
  updateAppearanceLessonFilter();
  renderAppearancePanel();
  renderLevels();

  Promise.all([
    loadCards(),
    loadQuestions(),
    loadResults(),
    loadNotes()
  ]).then(() => {
    renderCards();
    updateQuestionTopicFilter();
    renderQuestions();
    renderResults();
    renderNotes();
  });
}

async function loadLessons() {
  const status = $('#lessonsStatus');
  status.textContent = 'جارٍ تحميل الدروس…';
  try {
    const data = await api('teacher_list', { params: { sheet: 'lessons', limit: 500 } });
    state.lessons = data.rows || [];
    renderLessons();
    updateLessonFilter();
    updateAppearanceLessonFilter();
    status.textContent = `${state.lessons.length} درس`;
  } catch (error) {
    status.textContent = error.message;
  }
}

async function loadLevels() {
  const status = $('#levelsStatus');
  status.textContent = 'جارٍ تحميل المستويات…';
  try {
    const data = await api('teacher_list', { params: { sheet: 'levels', limit: 500 } });
    state.levels = data.rows || [];
    renderLevels();
    status.textContent = `${state.levels.length} مستوى`;
  } catch (error) {
    status.textContent = error.message;
  }
}

function renderLessons() {
  const tbody = $('#lessonsTable');
  $('#lessonsEmpty').hidden = state.lessons.length > 0;
  tbody.innerHTML = state.lessons.map((lesson) => `
    <tr>
      <td><strong>${escapeHtml(lesson.lesson_name)}</strong><br><small>${escapeHtml(lesson.lesson_id)}</small></td>
      <td>${escapeHtml(lesson.subject || '—')}</td>
      <td>${escapeHtml(lesson.grade || '—')}</td>
      <td>${visibilityBadge(lesson.group_mode_enabled)}</td>
      <td>${statusBadge(lesson.active)}</td>
      <td><div class="row-actions">
        <button class="row-button" type="button" data-edit-lesson="${escapeHtml(lesson.lesson_id)}">تعديل</button>
        <button class="row-button ${activeValue(lesson.group_mode_enabled) ? 'danger' : 'activate'}" type="button" data-toggle-group-mode="${escapeHtml(lesson.lesson_id)}">${activeValue(lesson.group_mode_enabled) ? 'إخفاء الجماعي' : 'إظهار الجماعي'}</button>
        <button class="row-button ${activeValue(lesson.active) ? 'danger' : 'activate'}" type="button" data-toggle-lesson="${escapeHtml(lesson.lesson_id)}">${activeValue(lesson.active) ? 'تعطيل' : 'تفعيل'}</button>
      </div></td>
    </tr>`).join('');
}

async function loadAppearanceData() {
  const [themeData, modeData, settingData] = await Promise.all([
    api('teacher_list', { params: { sheet: 'themes', limit: 100 } }),
    api('teacher_list', { params: { sheet: 'display_modes', limit: 100 } }),
    api('teacher_list', { params: { sheet: 'settings', limit: 1000 } })
  ]);
  state.themes = (themeData.rows || []).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  state.displayModes = (modeData.rows || []).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  state.settings = settingData.rows || [];
}

function appearanceSettingRow(lessonId, key) {
  return state.settings.find((row) => String(row.lesson_id) === String(lessonId) && String(row.setting_key) === key);
}

function appearanceSettingValue(lessonId, keys, fallback) {
  for (const key of keys) {
    const row = appearanceSettingRow(lessonId, key);
    if (row && activeValue(row.active)) return row.setting_value;
  }
  return fallback;
}

function updateAppearanceLessonFilter() {
  const filter = $('#appearanceLessonFilter');
  const selected = filter.value;
  filter.innerHTML = state.lessons.map((lesson) => `<option value="${escapeHtml(lesson.lesson_id)}">${escapeHtml(lesson.lesson_name)}</option>`).join('');
  filter.value = state.lessons.some((lesson) => String(lesson.lesson_id) === String(selected)) ? selected : (state.lessons[0]?.lesson_id || '');
}

function appearanceAsset(themeId) {
  return ({
    THEME_02: 'assets/theme-02-preview.webp',
    THEME_04: 'assets/theme-04-preview.webp',
    THEME_05: 'assets/theme-05-preview.webp',
    THEME_08: 'assets/theme-08-preview.webp'
  })[themeId] || 'assets/theme-05-preview.webp';
}

function renderAppearancePanel() {
  const lessonId = $('#appearanceLessonFilter').value || state.lessons[0]?.lesson_id || '';
  const lesson = state.lessons.find((row) => String(row.lesson_id) === String(lessonId));
  if (!lesson) {
    $('#appearanceForm').hidden = true;
    $('#appearanceStatus').textContent = 'لا توجد دروس لإعداد مظهرها.';
    return;
  }
  $('#appearanceForm').hidden = false;
  const firstActiveTheme = state.themes.find((theme) => activeValue(theme.active)) || state.themes[0];
  const firstActiveMode = state.displayModes.find((mode) => activeValue(mode.active)) || state.displayModes[0];
  const defaultTheme = String(appearanceSettingValue(lessonId, ['default_theme'], firstActiveTheme?.theme_id || 'THEME_05'));
  const defaultMode = String(appearanceSettingValue(lessonId, ['default_display_mode', 'default_card_display_mode', 'display_mode_id'], firstActiveMode?.display_mode_id || 'normal'));

  $('#appearancePanelEnabled').checked = activeValue(lesson.appearance_panel_enabled);
  $('#allowStudentThemeChoice').checked = activeValue(appearanceSettingValue(lessonId, ['allow_student_theme_choice'], true));
  $('#allowStudentModeChoice').checked = activeValue(appearanceSettingValue(lessonId, ['allow_student_display_mode_choice'], true));

  $('#adminThemeChoices').innerHTML = state.themes.map((theme) => {
    const id = String(theme.theme_id);
    return `<article class="admin-appearance-option theme-admin-option${id === defaultTheme ? ' selected' : ''}" data-theme-option="${escapeHtml(id)}">
      <span class="admin-theme-preview"><img src="${escapeHtml(appearanceAsset(id))}" alt="معاينة ${escapeHtml(theme.theme_name || id)}"></span>
      <label class="admin-option-title"><input type="radio" name="default_theme" value="${escapeHtml(id)}" ${id === defaultTheme ? 'checked' : ''}> <strong>${escapeHtml(theme.theme_name || id)}</strong></label>
      <small>${escapeHtml(theme.description || '')}</small>
      <label class="availability-check"><input type="checkbox" data-theme-active="${escapeHtml(id)}" ${activeValue(theme.active) ? 'checked' : ''}> متاح للطلاب</label>
    </article>`;
  }).join('');

  $('#adminModeChoices').innerHTML = state.displayModes.map((mode) => {
    const id = String(mode.display_mode_id);
    return `<article class="admin-appearance-option mode-admin-option${id === defaultMode ? ' selected' : ''}" data-mode-option="${escapeHtml(id)}">
      <span class="mode-miniature mode-${escapeHtml(id)}" aria-hidden="true"><i></i><i></i><i></i></span>
      <label class="admin-option-title"><input type="radio" name="default_display_mode" value="${escapeHtml(id)}" ${id === defaultMode ? 'checked' : ''}> <strong>${escapeHtml(mode.display_mode_name || id)}</strong></label>
      <small>${escapeHtml(mode.description || '')}</small>
      <label class="availability-check"><input type="checkbox" data-mode-active="${escapeHtml(id)}" ${activeValue(mode.active) ? 'checked' : ''}> متاح للطلاب</label>
    </article>`;
  }).join('');
  $('#appearanceStatus').textContent = '';
  updateAppearancePreview();
}

function updateAppearancePreview() {
  const themeId = document.querySelector('input[name="default_theme"]:checked')?.value || 'THEME_05';
  const modeId = document.querySelector('input[name="default_display_mode"]:checked')?.value || 'normal';
  const theme = state.themes.find((row) => String(row.theme_id) === themeId);
  const mode = state.displayModes.find((row) => String(row.display_mode_id) === modeId);
  $('#appearancePreviewImage').src = appearanceAsset(themeId);
  $('#appearancePreviewTitle').textContent = theme?.theme_name || 'الدفيئة المرحة';
  $('#appearancePreviewMode').textContent = mode?.display_mode_name || 'عادي';
  $('#appearanceLivePreview').dataset.mode = modeId;
  document.querySelectorAll('[data-theme-option]').forEach((option) => option.classList.toggle('selected', option.dataset.themeOption === themeId));
  document.querySelectorAll('[data-mode-option]').forEach((option) => option.classList.toggle('selected', option.dataset.modeOption === modeId));
}

async function saveAppearanceSettings(event) {
  event.preventDefault();
  const lessonId = $('#appearanceLessonFilter').value;
  const lesson = state.lessons.find((row) => String(row.lesson_id) === String(lessonId));
  const defaultTheme = document.querySelector('input[name="default_theme"]:checked')?.value;
  const defaultMode = document.querySelector('input[name="default_display_mode"]:checked')?.value;
  const activeThemeIds = Array.from(document.querySelectorAll('[data-theme-active]:checked')).map((input) => input.dataset.themeActive);
  const activeModeIds = Array.from(document.querySelectorAll('[data-mode-active]:checked')).map((input) => input.dataset.modeActive);
  if (!lesson || !defaultTheme || !defaultMode) return;
  if (!activeThemeIds.includes(defaultTheme)) activeThemeIds.push(defaultTheme);
  if (!activeModeIds.includes(defaultMode)) activeModeIds.push(defaultMode);

  const button = $('#saveAppearanceButton');
  setBusy(button, true, 'جارٍ الحفظ…');
  $('#appearanceStatus').textContent = 'جارٍ حفظ الإعدادات…';
  try {
    const panelEnabled = $('#appearancePanelEnabled').checked;
    const saved = await api('teacher_save_appearance', { data: {
      lesson_id: lessonId,
      appearance_panel_enabled: panelEnabled,
      active_theme_ids: activeThemeIds,
      active_mode_ids: activeModeIds,
      default_theme: defaultTheme,
      allow_student_theme_choice: $('#allowStudentThemeChoice').checked,
      default_display_mode: defaultMode,
      allow_student_display_mode_choice: $('#allowStudentModeChoice').checked
    } });

    lesson.appearance_panel_enabled = saved.appearance_panel_enabled;
    state.themes.forEach((theme) => {
      theme.active = saved.active_theme_ids.includes(String(theme.theme_id));
    });
    state.displayModes.forEach((mode) => {
      mode.active = saved.active_mode_ids.includes(String(mode.display_mode_id));
    });
    (saved.settings || []).forEach((record) => {
      const index = state.settings.findIndex((current) => String(current.setting_id) === String(record.setting_id)
        || (String(current.lesson_id) === lessonId && String(current.setting_key) === String(record.setting_key)));
      if (index === -1) state.settings.push(record);
      else state.settings[index] = { ...state.settings[index], ...record };
    });
    updateAppearanceLessonFilter();
    $('#appearanceLessonFilter').value = lessonId;
    renderAppearancePanel();
    $('#appearanceStatus').textContent = 'تم حفظ إعدادات المظهر بنجاح.';
    showToast('تم حفظ إعدادات المظهر.');
  } catch (error) {
    $('#appearanceStatus').textContent = error.message;
  } finally {
    setBusy(button, false, '');
  }
}

function updateLessonFilter() {
  const filter = $('#lessonFilter');
  const selected = filter.value;
  filter.innerHTML = state.lessons.map((lesson) => `<option value="${escapeHtml(lesson.lesson_id)}">${escapeHtml(lesson.lesson_name)}</option>`).join('');
  filter.value = state.lessons.some((row) => row.lesson_id === selected) ? selected : (state.lessons[0]?.lesson_id || '');

  const cardFilter = $('#cardLessonFilter');
  const selectedCardLesson = cardFilter.value;
  cardFilter.innerHTML = state.lessons.map((lesson) => `<option value="${escapeHtml(lesson.lesson_id)}">${escapeHtml(lesson.lesson_name)}</option>`).join('');
  cardFilter.value = state.lessons.some((row) => row.lesson_id === selectedCardLesson) ? selectedCardLesson : (state.lessons[0]?.lesson_id || '');

  const questionFilter = $('#questionLessonFilter');
  const selectedQuestionLesson = questionFilter.value;
  questionFilter.innerHTML = state.lessons.map((lesson) => `<option value="${escapeHtml(lesson.lesson_id)}">${escapeHtml(lesson.lesson_name)}</option>`).join('');
  questionFilter.value = state.lessons.some((row) => row.lesson_id === selectedQuestionLesson) ? selectedQuestionLesson : (state.lessons[0]?.lesson_id || '');

  const resultFilter = $('#resultLessonFilter');
  const selectedResultLesson = resultFilter.value;
  resultFilter.innerHTML = state.lessons.map((lesson) => `<option value="${escapeHtml(lesson.lesson_id)}">${escapeHtml(lesson.lesson_name)}</option>`).join('');
  resultFilter.value = state.lessons.some((row) => row.lesson_id === selectedResultLesson) ? selectedResultLesson : (state.lessons[0]?.lesson_id || '');

  const noteFilter = $('#noteLessonFilter');
  const selectedNoteLesson = noteFilter.value;
  noteFilter.innerHTML = state.lessons.map((lesson) => `<option value="${escapeHtml(lesson.lesson_id)}">${escapeHtml(lesson.lesson_name)}</option>`).join('');
  noteFilter.value = state.lessons.some((row) => row.lesson_id === selectedNoteLesson) ? selectedNoteLesson : (state.lessons[0]?.lesson_id || '');
}

function renderLevels() {
  const lessonId = $('#lessonFilter').value || state.lessons[0]?.lesson_id || '';
  renderLevelSequenceSetting(lessonId);
  const rows = state.levels.filter((level) => !lessonId || String(level.lesson_id) === String(lessonId));
  const tbody = $('#levelsTable');
  $('#levelsEmpty').hidden = rows.length > 0;
  tbody.innerHTML = rows.map((level) => `
    <tr>
      <td><strong>${escapeHtml(level.level_name)}</strong><br><small>${escapeHtml(level.level_id)}</small></td>
      <td>${escapeHtml(level.card_count)}</td>
      <td>${escapeHtml(levelLayoutText(level))}</td>
      <td>${escapeHtml(level.min_difficulty)} – ${escapeHtml(level.max_difficulty)}</td>
      <td>${escapeHtml(level.question_time_seconds)} ثانية</td>
      <td>${statusBadge(level.active)}</td>
      <td><div class="row-actions">
        <button class="row-button" type="button" data-edit-level="${escapeHtml(level.level_id)}">تعديل</button>
        <button class="row-button ${activeValue(level.active) ? 'danger' : 'activate'}" type="button" data-toggle-level="${escapeHtml(level.level_id)}">${activeValue(level.active) ? 'تعطيل' : 'تفعيل'}</button>
      </div></td>
    </tr>`).join('');
}

function renderLevelSequenceSetting(lessonId = $('#lessonFilter').value) {
  const lesson = state.lessons.find((row) => String(row.lesson_id) === String(lessonId));
  const input = $('#sequentialLevelsEnabled');
  const button = $('#saveLevelSequenceButton');
  input.checked = explicitlyEnabled(lesson?.sequential_levels_enabled);
  input.disabled = !lesson;
  button.disabled = !lesson;
  $('#levelSequenceStatus').textContent = lesson
    ? (input.checked ? 'التتابع مفعّل لهذا الدرس.' : 'جميع المستويات المفعلة متاحة.')
    : 'اختر درسًا أولًا.';
}

async function saveLevelSequenceSetting() {
  const lessonId = $('#lessonFilter').value || '';
  const lesson = state.lessons.find((row) => String(row.lesson_id) === String(lessonId));
  if (!lesson) return;
  const button = $('#saveLevelSequenceButton');
  const status = $('#levelSequenceStatus');
  const enabled = $('#sequentialLevelsEnabled').checked;
  status.textContent = 'جارٍ حفظ الإعداد…';
  setBusy(button, true, 'جارٍ الحفظ…');
  try {
    const updated = { ...lesson, sequential_levels_enabled: enabled };
    await api('teacher_upsert', { sheet: 'lessons', record: updated });
    Object.assign(lesson, updated);
    status.textContent = enabled ? 'تم تفعيل فتح المستويات بالتتابع.' : 'أصبحت جميع المستويات المفعلة متاحة.';
    showToast('تم حفظ إعداد المستويات.');
  } catch (error) {
    status.textContent = error.message;
  } finally {
    setBusy(button, false, '');
  }
}

async function loadTopics() {
  try {
    const data = await api('teacher_list', { params: { sheet: 'topics', limit: 1000 } });
    state.topics = data.rows || [];
  } catch (error) {
    state.topics = [];
    $('#cardsStatus').textContent = error.message;
  }
}

async function loadCards() {
  const status = $('#cardsStatus');
  status.textContent = 'جارٍ تحميل البطاقات…';
  try {
    const data = await api('teacher_list', { params: { sheet: 'cards', limit: 2000 } });
    state.cards = data.rows || [];
    renderCards();
    status.textContent = `${state.cards.length} زوج بطاقات`;
  } catch (error) {
    status.textContent = error.message;
  }
}

function topicName(topicId) {
  return state.topics.find((topic) => String(topic.topic_id) === String(topicId))?.topic_name || topicId || '—';
}

function renderCards() {
  const lessonId = $('#cardLessonFilter').value || state.lessons[0]?.lesson_id || '';
  const rows = state.cards.filter((card) => !lessonId || String(card.lesson_id) === String(lessonId));
  const tbody = $('#cardsTable');
  $('#cardsEmpty').hidden = rows.length > 0;
  tbody.innerHTML = rows.map((card) => `
    <tr>
      <td>${card.image_url ? `<img class="card-thumb" src="${escapeHtml(displayImageUrl(card.image_url))}" alt="${escapeHtml(card.image_description || card.card_title)}" loading="lazy">` : '<span class="card-thumb placeholder">بلا صورة</span>'}</td>
      <td><strong>${escapeHtml(card.card_title)}</strong><br><small>${escapeHtml(card.card_id)}</small></td>
      <td>${escapeHtml(topicName(card.topic_id))}</td>
      <td>${escapeHtml(card.copies_per_pair || 2)}</td>
      <td>${statusBadge(card.active)}</td>
      <td><div class="row-actions">
        <button class="row-button" type="button" data-edit-card="${escapeHtml(card.card_id)}">تعديل</button>
        <button class="row-button ${activeValue(card.active) ? 'danger' : 'activate'}" type="button" data-toggle-card="${escapeHtml(card.card_id)}">${activeValue(card.active) ? 'تعطيل' : 'تفعيل'}</button>
      </div></td>
    </tr>`).join('');
}

async function loadQuestions() {
  const status = $('#questionsStatus');
  status.textContent = 'جارٍ تحميل الأسئلة…';
  try {
    const data = await api('teacher_list', { params: { sheet: 'questions', limit: 2000 } });
    state.questions = data.rows || [];
    updateQuestionTopicFilter();
    renderQuestions();
  } catch (error) {
    status.textContent = error.message;
  }
}

function updateQuestionTopicFilter() {
  const lessonId = $('#questionLessonFilter').value || state.lessons[0]?.lesson_id || '';
  const filter = $('#questionTopicFilter');
  const selected = filter.value;
  const topics = state.topics.filter((topic) => !lessonId || String(topic.lesson_id) === String(lessonId));
  filter.innerHTML = '<option value="">كل الموضوعات</option>' + topics.map((topic) => `<option value="${escapeHtml(topic.topic_id)}">${escapeHtml(topic.topic_name)}</option>`).join('');
  if (topics.some((topic) => String(topic.topic_id) === String(selected))) filter.value = selected;
}

function questionTypeName(type) {
  const names = { multiple_choice: 'اختيار من متعدد', true_false: 'صح أو خطأ', short_answer: 'إجابة قصيرة' };
  return names[type] || type || '—';
}

function renderQuestions() {
  const lessonId = $('#questionLessonFilter').value || state.lessons[0]?.lesson_id || '';
  const topicId = $('#questionTopicFilter').value;
  const difficulty = $('#questionDifficultyFilter').value;
  const cognitive = $('#questionCognitiveFilter').value;
  const search = $('#questionSearch').value.trim().toLowerCase();
  const rows = state.questions.filter((question) => {
    if (lessonId && String(question.lesson_id) !== String(lessonId)) return false;
    if (topicId && String(question.topic_id) !== String(topicId)) return false;
    if (difficulty && String(question.difficulty) !== String(difficulty)) return false;
    if (cognitive && String(question.cognitive_level) !== String(cognitive)) return false;
    if (search && !String(question.question_text || '').toLowerCase().includes(search)) return false;
    return true;
  });
  $('#questionsStatus').textContent = `${rows.length} من ${state.questions.length} سؤال`;
  $('#questionsEmpty').hidden = rows.length > 0;
  $('#questionsTable').innerHTML = rows.map((question) => `
    <tr>
      <td class="question-cell">${escapeHtml(question.question_text)}<span class="question-meta">${escapeHtml(question.question_id)}</span></td>
      <td>${escapeHtml(topicName(question.topic_id))}</td>
      <td>${escapeHtml(questionTypeName(question.question_type))}</td>
      <td>${escapeHtml(question.difficulty || '—')}</td>
      <td>${activeValue(question.higher_order) ? '<span class="hots-pill">نعم</span>' : 'لا'}</td>
      <td>${statusBadge(question.active)}</td>
      <td><div class="row-actions">
        <button class="row-button" type="button" data-preview-question="${escapeHtml(question.question_id)}">معاينة</button>
        <button class="row-button" type="button" data-edit-question="${escapeHtml(question.question_id)}">تعديل</button>
        <button class="row-button" type="button" data-copy-question="${escapeHtml(question.question_id)}">نسخ</button>
        <button class="row-button ${activeValue(question.active) ? 'danger' : 'activate'}" type="button" data-toggle-question="${escapeHtml(question.question_id)}">${activeValue(question.active) ? 'تعطيل' : 'تفعيل'}</button>
      </div></td>
    </tr>`).join('');
}

function questionUsageStats() {
  const stats = new Map(state.questions.map((question) => [String(question.question_id), {
    question,
    shown: 0,
    correct: 0,
    wrong: 0
  }]));
  state.answerLogs.forEach((answer) => {
    const item = stats.get(String(answer.question_id));
    if (!item) return;
    item.shown += 1;
    if (activeValue(answer.is_correct)) item.correct += 1;
    else item.wrong += 1;
  });
  return [...stats.values()];
}

function renderQuestionUsageStats() {
  const lessonId = $('#questionLessonFilter').value || state.lessons[0]?.lesson_id || '';
  const rows = questionUsageStats()
    .filter((item) => !lessonId || String(item.question.lesson_id) === String(lessonId))
    .sort((a, b) => b.shown - a.shown || b.wrong - a.wrong || String(a.question.question_id).localeCompare(String(b.question.question_id), 'ar'));
  const unused = rows.filter((item) => item.shown === 0).length;
  const totalShown = rows.reduce((sum, item) => sum + item.shown, 0);
  const totalWrong = rows.reduce((sum, item) => sum + item.wrong, 0);
  $('#questionUsageSummary').innerHTML = [
    ['الأسئلة', rows.length],
    ['لم تُستخدم', unused],
    ['مرات الظهور', totalShown],
    ['الإجابات الخاطئة', totalWrong]
  ].map(([label, value]) => `<div class="summary-card"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  $('#questionUsageTable').innerHTML = rows.map((item) => {
    const correctRate = item.shown ? Math.round((item.correct / item.shown) * 100) : 0;
    const wrongRate = item.shown ? Math.round((item.wrong / item.shown) * 100) : 0;
    return `<tr class="${item.shown === 0 ? 'unused-question-row' : ''}">
      <td class="question-cell"><strong>${escapeHtml(item.question.question_id)}</strong><br>${escapeHtml(item.question.question_text || '—')}</td>
      <td>${item.shown ? escapeHtml(item.shown) : '<span class="usage-unused">لم يُستخدم</span>'}</td>
      <td>${escapeHtml(item.correct)}${item.shown ? ` <small>(${correctRate}٪)</small>` : ''}</td>
      <td>${escapeHtml(item.wrong)}${item.shown ? ` <small>(${wrongRate}٪)</small>` : ''}</td>
      <td><button class="row-button" type="button" data-usage-edit-question="${escapeHtml(item.question.question_id)}">تعديل السؤال</button></td>
    </tr>`;
  }).join('');
  $('#questionUsageEmpty').hidden = rows.length > 0;
}

function showQuestionUsageDialog() {
  renderQuestionUsageStats();
  $('#questionUsageDialog').showModal();
}

async function loadResults() {
  const status = $('#resultsStatus');
  const button = $('#refreshResultsButton');
  status.textContent = 'جارٍ تحميل النتائج…';
  setBusy(button, true, 'جارٍ التحديث…');
  try {
    const [resultsData, answersData, levelResultsData, teamResultsData] = await Promise.all([
      api('teacher_list', { params: { sheet: 'results', limit: 2000 } }),
      api('teacher_list', { params: { sheet: 'answer_log', limit: 2000 } }),
      api('teacher_list', { params: { sheet: 'level_results', limit: 2000 } }).catch(() => ({ rows: [] })),
      api('teacher_list', { params: { sheet: 'team_results', limit: 2000 } }).catch(() => ({ rows: [] }))
    ]);
    state.results = resultsData.rows || [];
    state.answerLogs = answersData.rows || [];
    state.levelResults = levelResultsData.rows || [];
    state.teamResults = teamResultsData.rows || [];
    updateResultClassFilter();
    if ($('#questionUsageDialog')?.open) renderQuestionUsageStats();
    renderResults();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    setBusy(button, false, '');
  }
}

function updateResultClassFilter() {
  const lessonId = $('#resultLessonFilter').value || state.lessons[0]?.lesson_id || '';
  const filter = $('#resultClassFilter');
  const selected = filter.value;
  const classes = [...new Set(state.results
    .filter((result) => !lessonId || String(result.lesson_id) === String(lessonId))
    .map((result) => String(result.class_name || '').trim())
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
  filter.innerHTML = '<option value="">كل الفصول</option>' + classes.map((className) => `<option value="${escapeHtml(className)}">${escapeHtml(className)}</option>`).join('');
  if (classes.includes(selected)) filter.value = selected;
}

function resultDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatResultDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '—';
  return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatDuration(value) {
  const total = Number(value || 0);
  if (!Number.isFinite(total) || total <= 0) return '—';
  const minutes = Math.floor(total / 60);
  const seconds = Math.round(total % 60);
  return minutes ? `${minutes} د ${seconds} ث` : `${seconds} ث`;
}

function levelName(levelId) {
  if (String(levelId) === 'LESSON_TOTAL') return 'الدرس كاملًا';
  return state.levels.find((level) => String(level.level_id) === String(levelId))?.level_name || levelId || '—';
}

function resultStageLabel(result) {
  if (String(result?.level_id) === 'LESSON_TOTAL') {
    return `الجولة ${activeValue(result.completed) ? 'مكتملة' : 'غير مكتملة'}`;
  }
  return levelName(result?.level_id);
}

function filteredResults() {
  const lessonId = $('#resultLessonFilter').value || state.lessons[0]?.lesson_id || '';
  const className = $('#resultClassFilter').value;
  const date = $('#resultDateFilter').value;
  const search = $('#resultSearch').value.trim().toLowerCase();
  return state.results.filter((result) => {
    if (lessonId && String(result.lesson_id) !== String(lessonId)) return false;
    if (className && String(result.class_name) !== String(className)) return false;
    if (date && resultDateKey(result.played_at) !== date) return false;
    if (search && !String(result.student_name || '').toLowerCase().includes(search)) return false;
    return true;
  }).sort((a, b) => new Date(b.played_at || 0) - new Date(a.played_at || 0));
}

function renderResults() {
  const rows = filteredResults();
  const existingIds = new Set(state.results.map((result) => String(result.result_id)));
  state.selectedResultIds = new Set([...state.selectedResultIds].filter((id) => existingIds.has(id)));
  const uniqueStudents = new Set(rows.map((result) => `${result.student_name}|${result.class_name}`)).size;
  const averageScore = rows.length ? Math.round(rows.reduce((sum, result) => sum + Number(result.score || 0), 0) / rows.length) : 0;
  const totalWrong = rows.reduce((sum, result) => sum + Number(result.wrong_answers || 0), 0);
  $('#resultSummary').innerHTML = [
    ['المحاولات', rows.length],
    ['الطلاب', uniqueStudents],
    ['متوسط الدرجة', averageScore],
    ['الإجابات الخاطئة', totalWrong]
  ].map(([label, value]) => `<div class="summary-card"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  $('#resultsStatus').textContent = `${rows.length} من ${state.results.length} نتيجة`;
  $('#resultsEmpty').hidden = rows.length > 0;
  $('#resultsTable').innerHTML = rows.map((result) => {
    const wrong = Number(result.wrong_answers || 0);
    const stars = Math.max(0, Math.min(5, Number(result.stars || 0)));
    return `<tr>
      <td class="select-column"><input class="result-checkbox" type="checkbox" data-select-result="${escapeHtml(result.result_id)}" aria-label="تحديد نتيجة ${escapeHtml(result.student_name || '')}" ${state.selectedResultIds.has(String(result.result_id)) ? 'checked' : ''}></td>
      <td><strong>${escapeHtml(result.student_name || '—')}</strong><br><small>${escapeHtml(result.result_id)}</small></td>
      <td>${escapeHtml(result.class_name || '—')}</td>
      <td>${escapeHtml(resultStageLabel(result))}</td>
      <td><strong>${escapeHtml(result.score ?? '—')}</strong></td>
      <td>${escapeHtml(result.correct_answers ?? 0)}</td>
      <td>${escapeHtml(wrong)}</td>
      <td aria-label="${stars} نجوم">${'★'.repeat(stars) || '—'}</td>
      <td>${escapeHtml(formatDuration(result.duration_seconds))}</td>
      <td>${escapeHtml(formatResultDate(result.played_at))}</td>
      <td><button class="row-button" type="button" data-view-result-errors="${escapeHtml(result.result_id)}">عرض التفاصيل</button></td>
    </tr>`;
  }).join('');
  updateResultSelectionUi(rows);
}

function updateResultSelectionUi(visibleRows = filteredResults()) {
  const visibleIds = visibleRows.map((result) => String(result.result_id));
  const visibleSelected = visibleIds.filter((id) => state.selectedResultIds.has(id)).length;
  const selectAll = $('#selectAllResults');
  selectAll.checked = visibleIds.length > 0 && visibleSelected === visibleIds.length;
  selectAll.indeterminate = visibleSelected > 0 && visibleSelected < visibleIds.length;
  const deleteButton = $('#deleteSelectedResultsButton');
  const count = state.selectedResultIds.size;
  deleteButton.disabled = count === 0;
  deleteButton.textContent = count ? `حذف المحدد (${count})` : 'حذف المحدد';
  $('#deleteAllResultsButton').disabled = state.results.length === 0;
}

async function deleteSelectedResults() {
  const resultIds = [...state.selectedResultIds];
  if (!resultIds.length) return;
  const message = `سيتم حذف ${resultIds.length} نتيجة، مع تفاصيل المستويات والإجابات المرتبطة بها. لا يمكن التراجع عن الحذف. هل تريد المتابعة؟`;
  if (!window.confirm(message)) return;

  const button = $('#deleteSelectedResultsButton');
  button.disabled = true;
  button.textContent = 'جارٍ الحذف…';
  try {
    const deleted = await api('teacher_delete_results', { result_ids: resultIds });
    state.selectedResultIds.clear();
    await loadResults();
    showToast(`تم حذف ${deleted.deleted_results || resultIds.length} نتيجة.`);
  } catch (error) {
    showToast(error.message);
    updateResultSelectionUi();
  }
}

async function deleteAllResults() {
  const count = state.results.length;
  if (!count) {
    showToast('لا توجد نتائج لحذفها.');
    return;
  }
  const message = `سيتم حذف جميع النتائج المسجلة وعددها ${count}، من جميع الدروس والفصول، مع تفاصيل المستويات والإجابات المرتبطة. لن تُحذف الأسئلة أو الملاحظات. لا يمكن التراجع عن الحذف. هل تريد المتابعة؟`;
  if (!window.confirm(message)) return;

  const button = $('#deleteAllResultsButton');
  button.disabled = true;
  button.textContent = 'جارٍ حذف الجميع…';
  try {
    const deleted = await api('teacher_delete_results', { delete_all: true });
    state.selectedResultIds.clear();
    await loadResults();
    showToast(`تم حذف جميع النتائج وعددها ${deleted.deleted_results || count}.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = state.results.length === 0;
    button.textContent = 'حذف جميع النتائج';
  }
}

function optionText(question, selected) {
  const raw = String(selected || '').trim().toUpperCase();
  const letter = ({ 1: 'A', 2: 'B', 3: 'C', 4: 'D' })[raw] || raw;
  const index = { A: 1, B: 2, C: 3, D: 4 }[letter];
  return index ? (question?.[`option_${index}`] || letter) : (selected || '—');
}

function showResultErrors(result) {
  if (!result) return;
  const answers = state.answerLogs.filter((answer) => String(answer.result_id) === String(result.result_id));
  const wrongAnswers = answers.filter((answer) => !activeValue(answer.is_correct));
  const levelRows = state.levelResults
    .filter((row) => String(row.result_id) === String(result.result_id))
    .sort((a, b) => {
      const aIndex = state.levels.findIndex((level) => String(level.level_id) === String(a.level_id));
      const bIndex = state.levels.findIndex((level) => String(level.level_id) === String(b.level_id));
      return aIndex - bIndex;
    });
  const teamRows = state.teamResults
    .filter((row) => String(row.result_id) === String(result.result_id))
    .sort((a, b) => Number(a.rank || 99) - Number(b.rank || 99));
  $('#resultErrorsTitle').textContent = result.student_name || 'تفاصيل المحاولة';
  $('#resultErrorsSummary').textContent = `${result.class_name || 'بلا فصل'} · ${resultStageLabel(result)} · الدرجة ${result.score ?? '—'} · ${formatResultDate(result.played_at)}`;
  $('#resultTeamBreakdown').hidden = teamRows.length === 0;
  $('#resultTeamBreakdown').innerHTML = teamRows.length ? `<h3>نتائج الفرق</h3><div class="team-result-grid">${teamRows.map((team) => `
    <article class="team-result-card ${Number(team.rank) === 1 ? 'winner' : ''}">
      <span>المركز ${escapeHtml(team.rank || '—')}</span>
      <strong>${escapeHtml(team.team_name || 'فريق')}</strong>
      <small>${escapeHtml(team.score ?? 0)} نقطة · ${escapeHtml(team.correct_answers ?? 0)} صحيحة · ${escapeHtml(team.wrong_answers ?? 0)} خاطئة</small>
      <small>${escapeHtml(team.matched_pairs ?? 0)} أزواج · ${escapeHtml(team.moves ?? 0)} محاولات</small>
    </article>`).join('')}</div>` : '';
  $('#resultLevelBreakdown').innerHTML = levelRows.map((row) => `
    <article class="level-result-card">
      <strong>${escapeHtml(levelName(row.level_id))}</strong>
      <span>الصحيحة: ${escapeHtml(row.correct_answers ?? 0)} · الخاطئة: ${escapeHtml(row.wrong_answers ?? 0)}</span>
      <span>المحاولات: ${escapeHtml(row.moves ?? 0)} · الأزواج: ${escapeHtml(row.matched_pairs ?? 0)}</span>
      <span>الدرجة: ${escapeHtml(row.score ?? 0)} · الوقت: ${escapeHtml(formatDuration(row.duration_seconds))}</span>
    </article>`).join('');
  $('#resultErrorsList').innerHTML = wrongAnswers.length ? wrongAnswers.map((answer, index) => {
    const question = state.questions.find((row) => String(row.question_id) === String(answer.question_id));
    const selected = optionText(question, answer.selected_option);
    const correct = question
      ? (question.correct_option ? optionText(question, question.correct_option) : (question.correct_answer || '—'))
      : '—';
    return `<article class="error-card">
      <h3>${index + 1}. ${answer.level_id ? `${escapeHtml(levelName(answer.level_id))}: ` : ''}${escapeHtml(question?.question_text || `السؤال ${answer.question_id}`)}</h3>
      ${answer.team_name ? `<p class="answer-line"><strong>الفريق:</strong> ${escapeHtml(answer.team_name)}${Number(answer.attempt_number) === 2 ? ' · محاولة أخذ السؤال' : ''}</p>` : ''}
      <p class="answer-line wrong"><strong>الإجابة المسجلة:</strong> ${escapeHtml(selected)}</p>
      <p class="answer-line correct"><strong>الإجابة الصحيحة:</strong> ${escapeHtml(correct || question?.correct_answer || '—')}</p>
      ${question?.feedback ? `<p class="answer-line"><strong>التغذية الراجعة:</strong> ${escapeHtml(question.feedback)}</p>` : ''}
    </article>`;
  }).join('') : '<div class="no-errors">لا توجد إجابات خاطئة مسجلة لهذه المحاولة.</div>';
  $('#resultErrorsDialog').showModal();
}

async function loadNotes() {
  const status = $('#notesStatus');
  const button = $('#refreshNotesButton');
  status.textContent = 'جارٍ تحميل الملاحظات…';
  setBusy(button, true, 'جارٍ التحديث…');
  try {
    const data = await api('teacher_list', { params: { sheet: 'notes', limit: 2000 } });
    state.notes = data.rows || [];
    updateNoteClassFilter();
    renderNotes();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    setBusy(button, false, '');
  }
}

function updateNoteClassFilter() {
  const lessonId = $('#noteLessonFilter').value || state.lessons[0]?.lesson_id || '';
  const filter = $('#noteClassFilter');
  const selected = filter.value;
  const classes = [...new Set(state.notes
    .filter((note) => !lessonId || String(note.lesson_id) === String(lessonId))
    .map((note) => String(note.class_name || '').trim())
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
  filter.innerHTML = '<option value="">كل الفصول</option>' + classes.map((className) => `<option value="${escapeHtml(className)}">${escapeHtml(className)}</option>`).join('');
  if (classes.includes(selected)) filter.value = selected;
}

function noteTypeName(value) {
  return ({ student: 'ملاحظة طالب', teacher: 'ملاحظة تعليمية', technical: 'بلاغ تقني' })[value] || value || '—';
}

function noteStatusName(value) {
  return ({ new: 'جديدة', reviewed: 'تمت المراجعة', archived: 'مؤرشفة' })[value] || value || '—';
}

function filteredNotes() {
  const lessonId = $('#noteLessonFilter').value || state.lessons[0]?.lesson_id || '';
  const className = $('#noteClassFilter').value;
  const type = $('#noteTypeFilter').value;
  const date = $('#noteDateFilter').value;
  const search = $('#noteSearch').value.trim().toLowerCase();
  return state.notes.filter((note) => {
    if (lessonId && String(note.lesson_id) !== String(lessonId)) return false;
    if (className && String(note.class_name) !== String(className)) return false;
    if (type && String(note.note_type) !== String(type)) return false;
    if (date && resultDateKey(note.submitted_at) !== date) return false;
    if (search) {
      const haystack = `${note.student_name || ''} ${note.note_text || ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  }).sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0));
}

function renderNotes() {
  const rows = filteredNotes();
  $('#notesStatus').textContent = `${rows.length} من ${state.notes.length} ملاحظة`;
  $('#notesEmpty').hidden = rows.length > 0;
  $('#notesTable').innerHTML = rows.map((note) => `<tr>
    <td><strong>${escapeHtml(note.student_name || '—')}</strong><br><small>${escapeHtml(note.note_id)}</small></td>
    <td>${escapeHtml(note.class_name || '—')}</td>
    <td>${escapeHtml(noteTypeName(note.note_type))}</td>
    <td class="note-cell">${escapeHtml(note.note_text || '—')}</td>
    <td>${escapeHtml(noteStatusName(note.status))}</td>
    <td>${escapeHtml(formatResultDate(note.submitted_at))}</td>
  </tr>`).join('');
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function trueValue(value) {
  return value === true || value === 1 || ['true', '1', 'yes', 'نعم'].includes(String(value ?? '').trim().toLowerCase());
}

function downloadCsv(fileName, headers, rows) {
  if (!rows.length) {
    showToast('لا توجد بيانات مطابقة لتصديرها.');
    return;
  }
  const text = [headers, ...rows].map((row) => row.map(csvCell).join('\t')).join('\r\n');
  const bytes = new Uint8Array(2 + (text.length * 2));
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes[2 + (index * 2)] = code & 0xff;
    bytes[3 + (index * 2)] = code >> 8;
  }
  const blob = new Blob([bytes], { type: 'text/tab-separated-values;charset=utf-16le' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportResults() {
  const rows = filteredResults();
  const headers = ['رقم النتيجة', 'اسم الطالب', 'الفصل', 'المدرسة', 'الدرس', 'المستوى', 'رقم المحاولة', 'الأزواج المتطابقة', 'الإجابات الصحيحة', 'الإجابات الخاطئة', 'الدرجة', 'النجوم', 'المدة بالثواني', 'مكتملة', 'تاريخ اللعب'];
  const data = rows.map((result) => [
    result.result_id, result.student_name, result.class_name, result.school_name, result.lesson_id,
    levelName(result.level_id), result.attempt_no, result.matched_pairs, result.correct_answers,
    result.wrong_answers, result.score, result.stars, result.duration_seconds,
    trueValue(result.completed) ? 'نعم' : 'لا', formatResultDate(result.played_at)
  ]);
  downloadCsv(`نتائج-لعبة-النباتات-${new Date().toISOString().slice(0, 10)}.csv`, headers, data);
}

function exportErrors() {
  const results = filteredResults();
  const resultMap = new Map(results.map((result) => [String(result.result_id), result]));
  const rows = state.answerLogs.filter((answer) => resultMap.has(String(answer.result_id)) && !activeValue(answer.is_correct));
  const headers = ['رقم النتيجة', 'اسم الطالب', 'الفصل', 'المستوى', 'رقم السؤال', 'نص السؤال', 'إجابة الطالب', 'الإجابة الصحيحة', 'زمن الإجابة بالثواني', 'تاريخ الإجابة'];
  const data = rows.map((answer) => {
    const result = resultMap.get(String(answer.result_id));
    const question = state.questions.find((row) => String(row.question_id) === String(answer.question_id));
    const correct = question?.correct_option ? optionText(question, question.correct_option) : (question?.correct_answer || '—');
    return [answer.result_id, result?.student_name, result?.class_name, levelName(answer.level_id || result?.level_id), answer.question_id,
      question?.question_text || '', optionText(question, answer.selected_option), correct,
      answer.response_time_seconds, formatResultDate(answer.answered_at)];
  });
  downloadCsv(`أخطاء-لعبة-النباتات-${new Date().toISOString().slice(0, 10)}.csv`, headers, data);
}

function exportNotes() {
  const rows = filteredNotes();
  const headers = ['رقم الملاحظة', 'اسم الطالب', 'الفصل', 'الدرس', 'نوع الملاحظة', 'نص الملاحظة', 'الحالة', 'تاريخ الإرسال'];
  const data = rows.map((note) => [note.note_id, note.student_name, note.class_name, note.lesson_id,
    noteTypeName(note.note_type), note.note_text, noteStatusName(note.status), formatResultDate(note.submitted_at)]);
  downloadCsv(`ملاحظات-لعبة-النباتات-${new Date().toISOString().slice(0, 10)}.csv`, headers, data);
}

$$('.tab').forEach((tab) => tab.addEventListener('click', () => {
  state.activeTab = tab.dataset.tab;
  $$('.tab').forEach((item) => item.classList.toggle('active', item === tab));
  $('#lessonsPanel').hidden = state.activeTab !== 'lessons';
  $('#appearancePanel').hidden = state.activeTab !== 'appearance';
  $('#levelsPanel').hidden = state.activeTab !== 'levels';
  $('#cardsPanel').hidden = state.activeTab !== 'cards';
  $('#questionsPanel').hidden = state.activeTab !== 'questions';
  $('#resultsPanel').hidden = state.activeTab !== 'results';
  $('#notesPanel').hidden = state.activeTab !== 'notes';
  if (state.activeTab === 'appearance') renderAppearancePanel();
  if (state.activeTab === 'levels') renderLevels();
  if (state.activeTab === 'cards') renderCards();
  if (state.activeTab === 'questions') renderQuestions();
  if (state.activeTab === 'results') renderResults();
  if (state.activeTab === 'notes') renderNotes();
}));

$('#lessonFilter').addEventListener('change', renderLevels);
$('#saveLevelSequenceButton').addEventListener('click', saveLevelSequenceSetting);
$('#appearanceLessonFilter').addEventListener('change', renderAppearancePanel);
$('#appearanceForm').addEventListener('change', (event) => {
  if (event.target.matches('input[name="default_theme"], input[name="default_display_mode"]')) updateAppearancePreview();
});
$('#appearanceForm').addEventListener('click', (event) => {
  const themeOption = event.target.closest('[data-theme-option]');
  const modeOption = event.target.closest('[data-mode-option]');
  if (themeOption && !event.target.closest('[data-theme-active]')) {
    themeOption.querySelector('input[name="default_theme"]').checked = true;
    updateAppearancePreview();
  }
  if (modeOption && !event.target.closest('[data-mode-active]')) {
    modeOption.querySelector('input[name="default_display_mode"]').checked = true;
    updateAppearancePreview();
  }
});
$('#appearanceForm').addEventListener('submit', saveAppearanceSettings);
$('#cardLessonFilter').addEventListener('change', renderCards);
$('#questionLessonFilter').addEventListener('change', () => { updateQuestionTopicFilter(); renderQuestions(); });
$('#questionTopicFilter').addEventListener('change', renderQuestions);
$('#questionDifficultyFilter').addEventListener('change', renderQuestions);
$('#questionCognitiveFilter').addEventListener('change', renderQuestions);
$('#questionSearch').addEventListener('input', renderQuestions);
$('#questionUsageButton').addEventListener('click', showQuestionUsageDialog);
$('#resultLessonFilter').addEventListener('change', () => { updateResultClassFilter(); renderResults(); });
$('#resultClassFilter').addEventListener('change', renderResults);
$('#resultDateFilter').addEventListener('change', renderResults);
$('#resultSearch').addEventListener('input', renderResults);
$('#refreshResultsButton').addEventListener('click', loadResults);
$('#exportResultsButton').addEventListener('click', exportResults);
$('#exportErrorsButton').addEventListener('click', exportErrors);
$('#deleteSelectedResultsButton').addEventListener('click', deleteSelectedResults);
$('#deleteAllResultsButton').addEventListener('click', deleteAllResults);
$('#selectAllResults').addEventListener('change', (event) => {
  filteredResults().forEach((result) => {
    const id = String(result.result_id);
    if (event.currentTarget.checked) state.selectedResultIds.add(id);
    else state.selectedResultIds.delete(id);
  });
  renderResults();
});
$('#noteLessonFilter').addEventListener('change', () => { updateNoteClassFilter(); renderNotes(); });
$('#noteClassFilter').addEventListener('change', renderNotes);
$('#noteTypeFilter').addEventListener('change', renderNotes);
$('#noteDateFilter').addEventListener('change', renderNotes);
$('#noteSearch').addEventListener('input', renderNotes);
$('#refreshNotesButton').addEventListener('click', loadNotes);
$('#exportNotesButton').addEventListener('click', exportNotes);
$('#addLessonButton').addEventListener('click', () => openEditor('lesson'));
$('#addLevelButton').addEventListener('click', () => openEditor('level'));
$('#addCardButton').addEventListener('click', () => openEditor('card'));
$('#addQuestionButton').addEventListener('click', () => openEditor('question'));

document.addEventListener('click', async (event) => {
  const editLesson = event.target.closest('[data-edit-lesson]');
  const editLevel = event.target.closest('[data-edit-level]');
  const toggleLesson = event.target.closest('[data-toggle-lesson]');
  const toggleGroupMode = event.target.closest('[data-toggle-group-mode]');
  const toggleLevel = event.target.closest('[data-toggle-level]');
  const editCard = event.target.closest('[data-edit-card]');
  const toggleCard = event.target.closest('[data-toggle-card]');
  const editQuestion = event.target.closest('[data-edit-question]');
  const copyQuestion = event.target.closest('[data-copy-question]');
  const previewQuestion = event.target.closest('[data-preview-question]');
  const toggleQuestion = event.target.closest('[data-toggle-question]');
  const viewResultErrors = event.target.closest('[data-view-result-errors]');
  const usageEditQuestion = event.target.closest('[data-usage-edit-question]');
  if (editLesson) openEditor('lesson', state.lessons.find((row) => row.lesson_id === editLesson.dataset.editLesson));
  if (toggleGroupMode) await toggleLessonGroupMode(toggleGroupMode.dataset.toggleGroupMode, toggleGroupMode);
  if (toggleLesson) await toggleEntityActive('lessons', toggleLesson.dataset.toggleLesson, toggleLesson);
  if (editLevel) openEditor('level', state.levels.find((row) => row.level_id === editLevel.dataset.editLevel));
  if (toggleLevel) await toggleLevelActive(toggleLevel.dataset.toggleLevel, toggleLevel);
  if (editCard) openEditor('card', state.cards.find((row) => row.card_id === editCard.dataset.editCard));
  if (toggleCard) await toggleEntityActive('cards', toggleCard.dataset.toggleCard, toggleCard);
  if (editQuestion) openEditor('question', state.questions.find((row) => row.question_id === editQuestion.dataset.editQuestion));
  if (copyQuestion) copyQuestionRecord(state.questions.find((row) => row.question_id === copyQuestion.dataset.copyQuestion));
  if (previewQuestion) showQuestionPreview(state.questions.find((row) => row.question_id === previewQuestion.dataset.previewQuestion));
  if (toggleQuestion) await toggleEntityActive('questions', toggleQuestion.dataset.toggleQuestion, toggleQuestion);
  if (viewResultErrors) showResultErrors(state.results.find((row) => String(row.result_id) === String(viewResultErrors.dataset.viewResultErrors)));
  if (usageEditQuestion) {
    $('#questionUsageDialog').close();
    openEditor('question', state.questions.find((row) => String(row.question_id) === String(usageEditQuestion.dataset.usageEditQuestion)));
  }
});

document.addEventListener('change', (event) => {
  const checkbox = event.target.closest('[data-select-result]');
  if (!checkbox) return;
  const id = String(checkbox.dataset.selectResult);
  if (checkbox.checked) state.selectedResultIds.add(id);
  else state.selectedResultIds.delete(id);
  updateResultSelectionUi();
});

function field(name, label, value = '', options = {}) {
  if (options.type === 'checkbox') {
    return `<label class="check-field"><input name="${name}" type="checkbox" ${activeValue(value) ? 'checked' : ''}> ${label}</label>`;
  }
  if (options.type === 'select') {
    const items = options.items.map((item) => `<option value="${escapeHtml(item.value)}" ${String(item.value) === String(value) ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('');
    return `<label class="field ${options.full ? 'full' : ''}">${label}<select name="${name}" ${options.required ? 'required' : ''}>${items}</select></label>`;
  }
  const type = options.type || 'text';
  const attrs = [options.required ? 'required' : '', options.min !== undefined ? `min="${options.min}"` : '', options.max !== undefined ? `max="${options.max}"` : ''].join(' ');
  return `<label class="field ${options.full ? 'full' : ''}">${label}<input name="${name}" type="${type}" value="${escapeHtml(value)}" ${attrs}></label>`;
}

function renderLevelLayoutPreview() {
  const countInput = recordForm.elements.card_count;
  const layoutInput = recordForm.elements.row_layout;
  const suggestionsBox = $('#layoutSuggestions');
  const preview = $('#layoutPreview');
  const hint = $('#layoutValidationHint');
  if (!countInput || !layoutInput || !suggestionsBox || !preview || !hint) return;
  const cardCount = Number(countInput.value || 0);
  const suggestions = suggestedLevelLayouts(cardCount);
  suggestionsBox.innerHTML = suggestions.map((rows) => `<button class="layout-suggestion" type="button" data-layout="${rows.join('-')}">${rows.join(' – ')}</button>`).join('');
  const rows = parseLevelLayout(layoutInput.value);
  const total = rows ? rows.reduce((sum, value) => sum + value, 0) : 0;
  const valid = Boolean(rows) && total === cardCount;
  preview.innerHTML = rows
    ? rows.map((rowLength) => `<div class="layout-preview-row">${Array.from({ length: rowLength }, () => '<span></span>').join('')}</div>`).join('')
    : '';
  preview.classList.toggle('invalid', !valid);
  hint.textContent = valid
    ? `التوزيع صحيح: ${rows.length} صفوف ومجموعها ${cardCount} بطاقة.`
    : `يجب أن يكون مجموع الصفوف ${cardCount} بطاقة.`;
  hint.classList.toggle('error', !valid);
}

function setupLevelLayoutEditor(savedLayout) {
  const countInput = recordForm.elements.card_count;
  const layoutInput = recordForm.elements.row_layout;
  if (!countInput || !layoutInput) return;
  const cardCount = Number(countInput.value || 6);
  const savedRows = parseLevelLayout(savedLayout);
  layoutInput.value = savedRows && savedRows.reduce((sum, value) => sum + value, 0) === cardCount
    ? savedRows.join('-')
    : defaultLevelLayout(cardCount).join('-');
  countInput.addEventListener('input', () => {
    const nextCount = Number(countInput.value || 0);
    layoutInput.value = defaultLevelLayout(nextCount).join('-');
    renderLevelLayoutPreview();
  });
  layoutInput.addEventListener('input', renderLevelLayoutPreview);
  $('#layoutSuggestions').addEventListener('click', (event) => {
    const button = event.target.closest('[data-layout]');
    if (!button) return;
    layoutInput.value = button.dataset.layout;
    renderLevelLayoutPreview();
  });
  renderLevelLayoutPreview();
}

function openEditor(type, record = null, copyMode = false) {
  state.editingType = type;
  state.editingRecord = record && !copyMode ? record : null;
  formMessage.textContent = '';
  const editing = Boolean(record) && !copyMode;
  if (type === 'lesson') {
    $('#dialogTitle').textContent = editing ? 'تعديل الدرس' : 'إضافة درس';
    formFields.innerHTML = [
      field('lesson_id', 'رمز الدرس', record?.lesson_id || '', { required: true }),
      field('lesson_name', 'اسم الدرس', record?.lesson_name || '', { required: true }),
      field('subject', 'المادة', record?.subject || 'العلوم', { required: true }),
      field('grade', 'الصف', record?.grade || 'الخامس الابتدائي', { required: true }),
      field('source_file', 'اسم ملف المصدر', record?.source_file || '', { full: true }),
      field('group_mode_enabled', 'إظهار اللعب الجماعي للطلاب', record ? record.group_mode_enabled : true, { type: 'checkbox' }),
      field('active', 'الدرس مفعّل', record ? record.active : true, { type: 'checkbox' })
    ].join('');
  } else if (type === 'level') {
    $('#dialogTitle').textContent = editing ? 'تعديل المستوى' : 'إضافة مستوى';
    const lessonItems = state.lessons.map((lesson) => ({ value: lesson.lesson_id, label: lesson.lesson_name }));
    formFields.innerHTML = [
      field('level_id', 'رمز المستوى', record?.level_id || '', { required: true }),
      field('lesson_id', 'الدرس', record?.lesson_id || $('#lessonFilter').value, { type: 'select', items: lessonItems, required: true }),
      field('level_name', 'اسم المستوى', record?.level_name || '', { required: true }),
      field('card_count', 'عدد البطاقات', record?.card_count || 6, { type: 'number', min: 2, max: 60, required: true }),
      `<div class="layout-field full">
        <label class="field">توزيع البطاقات على الصفوف<input name="row_layout" inputmode="numeric" value="${escapeHtml(record?.row_layout || '')}" placeholder="مثال: 6-5-4-3" required></label>
        <p class="field-hint">اختر اقتراحًا أو اكتب عدد البطاقات في كل صف. ستتكيف اللعبة تلقائيًا مع الشاشات الصغيرة.</p>
        <div id="layoutSuggestions" class="layout-suggestions" aria-label="توزيعات مقترحة"></div>
        <div id="layoutPreview" class="layout-preview" aria-label="معاينة توزيع البطاقات"></div>
        <p id="layoutValidationHint" class="field-hint"></p>
      </div>`,
      field('min_difficulty', 'أقل صعوبة', record?.min_difficulty || 1, { type: 'number', min: 1, max: 4, required: true }),
      field('max_difficulty', 'أعلى صعوبة', record?.max_difficulty || 1, { type: 'number', min: 1, max: 4, required: true }),
      field('question_time_seconds', 'زمن السؤال بالثواني', record?.question_time_seconds || 30, { type: 'number', min: 5, max: 300, required: true }),
      field('hints_allowed', 'عدد التلميحات', record?.hints_allowed || 0, { type: 'number', min: 0, max: 20, required: true }),
      field('unlock_rule', 'قاعدة فتح المستوى', record?.unlock_rule || 'always', { type: 'select', items: [{ value: 'always', label: 'مفتوح دائمًا' }, { value: 'complete_previous', label: 'بعد إكمال المستوى السابق' }], required: true, full: true }),
      field('sort_order', 'ترتيب المستوى', record?.sort_order || state.levels.length + 1, { type: 'number', min: 1, max: 100, required: true }),
      field('active', 'المستوى مفعّل', record ? record.active : true, { type: 'checkbox' })
    ].join('');
    setupLevelLayoutEditor(record?.row_layout || '');
  } else if (type === 'card') {
    $('#dialogTitle').textContent = editing ? 'تعديل البطاقة' : 'إضافة بطاقة';
    const lessonId = record?.lesson_id || $('#cardLessonFilter').value || state.lessons[0]?.lesson_id || '';
    const lessonItems = state.lessons.map((lesson) => ({ value: lesson.lesson_id, label: lesson.lesson_name }));
    const topicItems = state.topics
      .filter((topic) => !lessonId || String(topic.lesson_id) === String(lessonId))
      .map((topic) => ({ value: topic.topic_id, label: topic.topic_name }));
    formFields.innerHTML = [
      field('card_id', 'رمز البطاقة', record?.card_id || '', { required: true }),
      field('lesson_id', 'الدرس', lessonId, { type: 'select', items: lessonItems, required: true }),
      field('card_title', 'عنوان البطاقة', record?.card_title || '', { required: true }),
      field('topic_id', 'موضوع البطاقة', record?.topic_id || topicItems[0]?.value || '', { type: 'select', items: topicItems, required: true }),
      `<div class="image-field">
        <label for="cardImageFile">صورة البطاقة من الجهاز</label>
        <input id="cardImageFile" name="image_file" type="file" accept="image/jpeg,image/png,image/webp">
        <p class="field-hint">JPG أو PNG أو WebP، وبحجم لا يتجاوز 4 ميجابايت.</p>
        <label class="field">أو رابط صورة مباشر<input id="cardImageUrl" name="image_url" type="url" value="${escapeHtml(record?.image_url || '')}" placeholder="https://..."></label>
        <div id="cardImagePreview" class="image-preview">معاينة الصورة</div>
      </div>`,
      `<label class="field full">وصف الصورة<textarea name="image_description" required>${escapeHtml(record?.image_description || '')}</textarea></label>`,
      field('copies_per_pair', 'عدد النسخ المتطابقة', record?.copies_per_pair || 2, { type: 'number', min: 2, max: 4, required: true }),
      field('sort_order', 'ترتيب البطاقة', record?.sort_order || state.cards.length + 1, { type: 'number', min: 1, max: 500, required: true }),
      field('active', 'البطاقة مفعّلة', record ? record.active : true, { type: 'checkbox' }),
      `<label class="field full">ملاحظات<textarea name="notes">${escapeHtml(record?.notes || '')}</textarea></label>`
    ].join('');
    setupCardImagePreview(record?.image_url || '');
    setupTopicChoices(record?.topic_id || '');
  } else {
    $('#dialogTitle').textContent = copyMode ? 'نسخ السؤال' : (editing ? 'تعديل السؤال' : 'إضافة سؤال');
    const lessonId = record?.lesson_id || $('#questionLessonFilter').value || state.lessons[0]?.lesson_id || '';
    const lessonItems = state.lessons.map((lesson) => ({ value: lesson.lesson_id, label: lesson.lesson_name }));
    const topicItems = state.topics
      .filter((topic) => !lessonId || String(topic.lesson_id) === String(lessonId))
      .map((topic) => ({ value: topic.topic_id, label: topic.topic_name }));
    const questionTypes = [
      { value: 'multiple_choice', label: 'اختيار من متعدد' },
      { value: 'true_false', label: 'صح أو خطأ' },
      { value: 'short_answer', label: 'إجابة قصيرة' }
    ];
    const cognitiveLevels = ['تذكر', 'فهم', 'تطبيق', 'تحليل', 'استنتاج', 'تقويم'].map((value) => ({ value, label: value }));
    const correctOptions = ['A', 'B', 'C', 'D'].map((value) => ({ value, label: value }));
    formFields.innerHTML = [
      field('question_id', 'رمز السؤال', record?.question_id || '', { required: true }),
      field('lesson_id', 'الدرس', lessonId, { type: 'select', items: lessonItems, required: true }),
      field('topic_id', 'الموضوع', record?.topic_id || topicItems[0]?.value || '', { type: 'select', items: topicItems, required: true }),
      field('question_type', 'نوع السؤال', record?.question_type || 'multiple_choice', { type: 'select', items: questionTypes, required: true }),
      `<label class="field full">نص السؤال<textarea name="question_text" required>${escapeHtml(record?.question_text || '')}</textarea></label>`,
      field('option_1', 'الخيار A', record?.option_1 || ''),
      field('option_2', 'الخيار B', record?.option_2 || ''),
      field('option_3', 'الخيار C', record?.option_3 || ''),
      field('option_4', 'الخيار D', record?.option_4 || ''),
      field('correct_option', 'رمز الخيار الصحيح', record?.correct_option || 'A', { type: 'select', items: correctOptions, required: true }),
      field('correct_answer', 'الإجابة الصحيحة نصيًا', record?.correct_answer || ''),
      `<label class="field full">التغذية الراجعة<textarea name="feedback">${escapeHtml(record?.feedback || '')}</textarea></label>`,
      field('cognitive_level', 'المستوى المعرفي', record?.cognitive_level || 'تذكر', { type: 'select', items: cognitiveLevels, required: true }),
      field('difficulty', 'درجة الصعوبة', record?.difficulty || 1, { type: 'number', min: 1, max: 4, required: true }),
      field('source_page', 'صفحة المصدر', record?.source_page || ''),
      field('points', 'النقاط', record?.points || 1, { type: 'number', min: 0, max: 100, required: true }),
      field('time_seconds', 'زمن الإجابة بالثواني', record?.time_seconds || 30, { type: 'number', min: 5, max: 300, required: true }),
      field('higher_order', 'سؤال تفكير عالٍ', record ? record.higher_order : false, { type: 'checkbox' }),
      field('active', 'السؤال مفعّل', record ? record.active : true, { type: 'checkbox' }),
      `<label class="field full">ملاحظات<textarea name="notes">${escapeHtml(record?.notes || '')}</textarea></label>`
    ].join('');
    setupTopicChoices(record?.topic_id || '');
  }
  const idFields = { lesson: 'lesson_id', level: 'level_id', card: 'card_id', question: 'question_id' };
  const idField = idFields[type];
  const idInput = recordForm.elements[idField];
  if (editing) idInput.readOnly = true;
  recordDialog.showModal();
}

recordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  formMessage.textContent = '';
  const values = Object.fromEntries(new FormData(recordForm).entries());
  values.active = Boolean(recordForm.elements.active?.checked);
  if (state.editingType === 'lesson') values.group_mode_enabled = Boolean(recordForm.elements.group_mode_enabled?.checked);
  if (state.editingType === 'question') {
    values.higher_order = Boolean(recordForm.elements.higher_order?.checked);
    ['difficulty', 'points', 'time_seconds'].forEach((key) => { values[key] = Number(values[key]); });
    if (values.question_type === 'multiple_choice' && (!values.option_1 || !values.option_2)) {
      formMessage.textContent = 'أدخل خيارين على الأقل لسؤال الاختيار من متعدد.';
      return;
    }
    const optionByLetter = { A: values.option_1, B: values.option_2, C: values.option_3, D: values.option_4 };
    if (values.question_type !== 'short_answer' && !optionByLetter[values.correct_option]) {
      formMessage.textContent = 'الخيار المحدد كإجابة صحيحة فارغ.';
      return;
    }
    if (values.question_type === 'short_answer' && !values.correct_answer) {
      formMessage.textContent = 'أدخل نص الإجابة الصحيحة للسؤال القصير.';
      return;
    }
  }
  if (state.editingType === 'level') {
    ['card_count', 'min_difficulty', 'max_difficulty', 'question_time_seconds', 'hints_allowed', 'sort_order'].forEach((key) => { values[key] = Number(values[key]); });
    if (values.card_count % 2 !== 0) {
      formMessage.textContent = 'عدد البطاقات يجب أن يكون زوجيًا.';
      return;
    }
    const layoutRows = parseLevelLayout(values.row_layout);
    if (!layoutRows || layoutRows.reduce((sum, value) => sum + value, 0) !== values.card_count) {
      formMessage.textContent = `مجموع توزيع الصفوف يجب أن يساوي ${values.card_count} بطاقة.`;
      return;
    }
    values.row_layout = layoutRows.join('-');
    if (values.min_difficulty > values.max_difficulty) {
      formMessage.textContent = 'أقل صعوبة يجب ألا تتجاوز أعلى صعوبة.';
      return;
    }
  }
  if (state.editingType === 'card') {
    values.copies_per_pair = Number(values.copies_per_pair);
    values.sort_order = Number(values.sort_order);
    const imageFile = recordForm.elements.image_file?.files?.[0];
    if (!imageFile && !values.image_url) {
      formMessage.textContent = 'اختر صورة من الجهاز أو ضع رابط الصورة.';
      return;
    }
    if (imageFile) {
      if (imageFile.size > 4 * 1024 * 1024) {
        formMessage.textContent = 'حجم الصورة أكبر من 4 ميجابايت.';
        return;
      }
      try {
        setBusy($('#saveRecordButton'), true, 'جارٍ رفع الصورة…');
        const uploaded = await uploadImage(imageFile);
        values.image_url = displayImageUrl(uploaded.image_url);
      } catch (error) {
        formMessage.textContent = error.message;
        setBusy($('#saveRecordButton'), false, '');
        return;
      }
    }
    values.image_url = displayImageUrl(values.image_url);
    delete values.image_file;
  }
  const sheetNames = { lesson: 'lessons', level: 'levels', card: 'cards', question: 'questions' };
  const sheet = sheetNames[state.editingType];
  const record = { ...(state.editingRecord || {}), ...values };
  const saveButton = $('#saveRecordButton');
  setBusy(saveButton, true, 'جارٍ الحفظ…');
  try {
    await api('teacher_upsert', { sheet, record });
    recordDialog.close();
    if (sheet === 'lessons') await loadLessons();
    if (sheet === 'levels') await loadLevels();
    if (sheet === 'cards') await loadCards();
    if (sheet === 'questions') await loadQuestions();
    showToast('تم الحفظ بنجاح.');
  } catch (error) {
    formMessage.textContent = error.message;
  } finally {
    setBusy(saveButton, false, '');
  }
});

async function archiveRecord(sheet, id, label) {
  if (!window.confirm(`هل تريد تعطيل ${label}؟ ستبقى بياناته السابقة محفوظة.`)) return;
  try {
    await api('teacher_archive', { sheet, id });
    if (sheet === 'lessons') await loadLessons();
    if (sheet === 'levels') await loadLevels();
    if (sheet === 'cards') await loadCards();
    if (sheet === 'questions') await loadQuestions();
    showToast(`تم تعطيل ${label} مع الاحتفاظ ببياناته.`);
  } catch (error) {
    showToast(error.message);
  }
}

async function toggleLevelActive(levelId, button) {
  const level = state.levels.find((row) => String(row.level_id) === String(levelId));
  if (!level) return;
  const willActivate = !activeValue(level.active);
  if (!willActivate && !window.confirm('هل تريد تعطيل المستوى؟ سيختفي من لعبة الطالب وتبقى بياناته السابقة محفوظة.')) return;
  setBusy(button, true, willActivate ? 'جارٍ التفعيل…' : 'جارٍ التعطيل…');
  try {
    const cardCount = Number(level.card_count || 0);
    const parsedLayout = parseLevelLayout(level.row_layout);
    const validLayout = parsedLayout && parsedLayout.reduce((sum, value) => sum + value, 0) === cardCount;
    const updated = {
      ...level,
      row_layout: (validLayout ? parsedLayout : defaultLevelLayout(cardCount)).join('-'),
      active: willActivate
    };
    await api('teacher_upsert', { sheet: 'levels', record: updated });
    Object.assign(level, updated);
    renderLevels();
    showToast(willActivate ? 'تم تفعيل المستوى.' : 'تم تعطيل المستوى.');
  } catch (error) {
    showToast(error.message);
    setBusy(button, false, '');
  }
}

async function toggleEntityActive(sheet, id, button) {
  const configs = {
    lessons: { rows: state.lessons, idField: 'lesson_id', label: 'الدرس', render: renderLessons },
    cards: { rows: state.cards, idField: 'card_id', label: 'البطاقة', render: renderCards },
    questions: { rows: state.questions, idField: 'question_id', label: 'السؤال', render: renderQuestions }
  };
  const config = configs[sheet];
  const record = config?.rows.find((row) => String(row[config.idField]) === String(id));
  if (!record) return;
  const willActivate = !activeValue(record.active);
  if (!willActivate && !window.confirm(`هل تريد تعطيل ${config.label}؟ ستبقى بياناته السابقة محفوظة.`)) return;
  setBusy(button, true, willActivate ? 'جارٍ التفعيل…' : 'جارٍ التعطيل…');
  try {
    const updated = { ...record, active: willActivate };
    await api('teacher_upsert', { sheet, record: updated });
    Object.assign(record, updated);
    config.render();
    showToast(willActivate ? `تم تفعيل ${config.label}.` : `تم تعطيل ${config.label}.`);
  } catch (error) {
    showToast(error.message);
    setBusy(button, false, '');
  }
}

async function toggleLessonGroupMode(lessonId, button) {
  const lesson = state.lessons.find((row) => String(row.lesson_id) === String(lessonId));
  if (!lesson) return;
  const willShow = !activeValue(lesson.group_mode_enabled);
  if (!willShow && !window.confirm('هل تريد إخفاء اللعب الجماعي؟ سيختفي خياره من شاشة الطالب، وتبقى النتائج السابقة محفوظة.')) return;
  setBusy(button, true, willShow ? 'جارٍ الإظهار…' : 'جارٍ الإخفاء…');
  try {
    const updated = { ...lesson, group_mode_enabled: willShow };
    await api('teacher_upsert', { sheet: 'lessons', record: updated });
    Object.assign(lesson, updated);
    renderLessons();
    showToast(willShow ? 'تم إظهار اللعب الجماعي للطلاب.' : 'تم إخفاء اللعب الجماعي عن الطلاب.');
  } catch (error) {
    showToast(error.message);
    setBusy(button, false, '');
  }
}

function copyQuestionRecord(question) {
  if (!question) return;
  const copy = {
    ...question,
    question_id: `Q_COPY_${Date.now()}`,
    created_at: '',
    updated_at: ''
  };
  openEditor('question', copy, true);
}

function showQuestionPreview(question) {
  if (!question) return;
  $('#previewQuestionTitle').textContent = `${questionTypeName(question.question_type)} · ${question.question_id}`;
  $('#previewQuestionText').textContent = question.question_text || '—';
  const optionKeys = ['option_1', 'option_2', 'option_3', 'option_4'];
  const optionLetters = ['A', 'B', 'C', 'D'];
  const correctRaw = String(question.correct_option || '').trim().toUpperCase();
  const correct = ({ 1: 'A', 2: 'B', 3: 'C', 4: 'D' })[correctRaw] || correctRaw;
  const options = optionKeys.map((key, index) => ({ text: question[key], letter: optionLetters[index] })).filter((option) => String(option.text || '').trim());
  $('#previewOptions').innerHTML = options.length
    ? options.map((option) => `<div class="preview-option ${option.letter === correct ? 'correct' : ''}"><strong>${option.letter}</strong> ${escapeHtml(option.text)}</div>`).join('')
    : '<div class="preview-option">لا توجد خيارات لهذا النوع من الأسئلة.</div>';
  const correctText = options.find((option) => option.letter === correct)?.text || question.correct_answer || 'غير محددة';
  $('#previewFeedback').innerHTML = `<strong>الإجابة الصحيحة:</strong> ${escapeHtml(correctText)}${question.feedback ? `<br><strong>التغذية الراجعة:</strong> ${escapeHtml(question.feedback)}` : ''}`;
  $('#questionPreviewDialog').showModal();
}

function setupCardImagePreview(initialUrl) {
  const fileInput = $('#cardImageFile');
  const urlInput = $('#cardImageUrl');
  const preview = $('#cardImagePreview');
  const show = (url) => {
    preview.innerHTML = url ? `<img src="${escapeHtml(displayImageUrl(url))}" alt="معاينة صورة البطاقة">` : 'معاينة الصورة';
  };
  show(initialUrl);
  urlInput.addEventListener('input', () => show(urlInput.value.trim()));
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return show(urlInput.value.trim());
    const reader = new FileReader();
    reader.addEventListener('load', () => show(reader.result));
    reader.readAsDataURL(file);
  });
}

function setupTopicChoices(initialTopicId) {
  const lessonSelect = recordForm.elements.lesson_id;
  const topicSelect = recordForm.elements.topic_id;
  if (!lessonSelect || !topicSelect) return;
  const refresh = () => {
    const current = topicSelect.value || initialTopicId;
    const topics = state.topics.filter((topic) => String(topic.lesson_id) === String(lessonSelect.value));
    topicSelect.innerHTML = topics.map((topic) => `<option value="${escapeHtml(topic.topic_id)}">${escapeHtml(topic.topic_name)}</option>`).join('');
    if (topics.some((topic) => String(topic.topic_id) === String(current))) topicSelect.value = current;
  };
  lessonSelect.addEventListener('change', refresh);
  refresh();
}

function uploadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('error', () => reject(new Error('تعذر قراءة الصورة من الجهاز.')));
    reader.addEventListener('load', async () => {
      try {
        const base64Data = String(reader.result).split(',')[1] || '';
        const result = await api('teacher_upload_image', {
          data: { file_name: file.name, mime_type: file.type, base64_data: base64Data }
        });
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
    reader.readAsDataURL(file);
  });
}

$('#closeDialogButton').addEventListener('click', () => recordDialog.close());
$('#cancelDialogButton').addEventListener('click', () => recordDialog.close());
$('#closePreviewButton').addEventListener('click', () => $('#questionPreviewDialog').close());
$('#closeResultErrorsButton').addEventListener('click', () => $('#resultErrorsDialog').close());
$('#closeQuestionUsageButton').addEventListener('click', () => $('#questionUsageDialog').close());

const savedPin = sessionStorage.getItem('plants_teacher_pin');
if (savedPin) {
  state.pin = savedPin;
  teacherPin.value = savedPin;
}
