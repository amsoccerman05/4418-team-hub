/* Hub-only, synchronous bootstrap: apply before paint, without an account or API. */
(() => {
  const key = '4418-team-hub-theme';
  const valid = value => ['light', 'dark', 'system'].includes(value) ? value : 'system';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const read = () => { try { return valid(localStorage.getItem(key)); } catch { return 'system'; } };
  let preference = read();
  function apply() {
    const resolved = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    document.querySelectorAll('hub-theme-control select').forEach(select => { select.value = preference; });
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#111923' : '#f4f6f8');
  }
  apply();
  system.addEventListener('change', apply);
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) { preference = read(); apply(); }
  });
  customElements.define('hub-theme-control', class extends HTMLElement {
    connectedCallback() {
      if (this.firstChild) return;
      const label = document.createElement('label');
      label.append('Theme ');
      const select = document.createElement('select');
      for (const value of ['system', 'light', 'dark']) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value[0].toUpperCase() + value.slice(1);
        select.append(option);
      }
      select.value = preference;
      select.addEventListener('change', () => {
        preference = valid(select.value);
        try { localStorage.setItem(key, preference); } catch { /* Still works for this page if storage is unavailable. */ }
        apply();
      });
      label.append(select);
      this.append(label);
    }
  });
})();
