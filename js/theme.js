// ─────────────────────────────────────────────
// LAGER//APP – Theme Manager
// ─────────────────────────────────────────────

export function initTheme() {
  const saved = localStorage.getItem('lager-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  applyTheme(theme);
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  updateToggleIcon(next);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('lager-theme', theme);
  updateToggleIcon(theme);
  document.querySelectorAll('.app-logo').forEach(img => {
    img.src = theme === 'dark' ? img.dataset.srcDark : img.dataset.srcLight;
  });
}

function updateToggleIcon(theme) {
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}
