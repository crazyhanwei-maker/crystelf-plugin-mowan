(function () {
  const data = window.MowanSiteData || {};

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderFeatures() {
    const target = document.getElementById('feature-grid');
    if (!target) return;
    target.innerHTML = (data.features || []).map(item => `
      <article class="feature-card">
        <span class="icon">${escapeHtml(item.icon)}</span>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.text)}</p>
        <ul>${(item.tags || []).map(tag => `<li>${escapeHtml(tag)}</li>`).join('')}</ul>
      </article>
    `).join('');
  }

  function renderFeatureDetails() {
    const target = document.getElementById('feature-detail-list');
    if (!target) return;
    target.innerHTML = (data.features || []).map(item => `
      <article class="detail-card">
        <div class="detail-icon">${escapeHtml(item.icon)}</div>
        <div>
          <h2>${escapeHtml(item.title)}</h2>
          <p class="detail-lead">${escapeHtml(item.text)}</p>
          <div class="detail-tags">${(item.tags || []).map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
          <h3>用户能得到什么</h3>
          <p>${escapeHtml(item.userValue || '')}</p>
          <h3>主要能力</h3>
          <ul>${(item.detail || []).map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
        </div>
      </article>
    `).join('');
  }

  function renderConsoleItems() {
    const target = document.getElementById('console-list');
    if (!target) return;
    target.innerHTML = (data.consoleItems || []).map(([title, text]) => `
      <article class="console-item">
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(text)}</p>
      </article>
    `).join('');
  }

  function renderWorkflow() {
    const target = document.getElementById('workflow-list');
    if (!target) return;
    target.innerHTML = (data.workflow || []).map(([title, text], index) => `
      <div class="timeline-item">
        <b>${index + 1}</b>
        <div>
          <strong>${escapeHtml(title)}</strong>
          <p>${escapeHtml(text)}</p>
        </div>
      </div>
    `).join('');
  }

  function renderTags() {
    const target = document.getElementById('simulator-tags');
    if (!target) return;
    target.innerHTML = (data.simulatorTags || []).map(tag => `<span>${escapeHtml(tag)}</span>`).join('');
  }

  function renderChangelog() {
    const target = document.getElementById('changelog-list');
    if (!target) return;
    target.innerHTML = (data.changelog || []).map(item => `
      <article class="change-item">
        <div>
          <div class="change-version">${escapeHtml(item.version)}</div>
          <span class="change-date">${escapeHtml(item.date)}</span>
        </div>
        <ul>${(item.items || []).map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
      </article>
    `).join('');
  }

  function renderSecurity() {
    const target = document.getElementById('security-grid');
    if (!target) return;
    target.innerHTML = (data.security || []).map(([title, text, tone]) => `
      <article class="security-item" data-tone="${escapeHtml(tone)}">
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(text)}</p>
      </article>
    `).join('');
  }

  function renderFaq() {
    const target = document.getElementById('faq-list');
    if (!target) return;
    target.innerHTML = (data.faqs || []).map(([title, text]) => `
      <article class="faq-item">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(text)}</p>
      </article>
    `).join('');
  }

  function setupCodeTabs() {
    const code = document.getElementById('install-code');
    const buttons = Array.from(document.querySelectorAll('[data-tab]'));
    if (!code || buttons.length === 0) return;
    const setActive = tab => {
      code.textContent = data.codeBlocks?.[tab] || data.codeBlocks?.install || '';
      buttons.forEach(button => button.classList.toggle('is-active', button.dataset.tab === tab));
    };
    buttons.forEach(button => {
      button.addEventListener('click', () => setActive(button.dataset.tab));
    });
    setActive('install');
  }

  function setupNav() {
    const topbar = document.querySelector('.topbar');
    const toggle = document.querySelector('.nav-toggle');
    const mobileNav = document.getElementById('mobile-nav');
    if (!topbar) return;

    const syncElevated = () => {
      topbar.dataset.elevated = window.scrollY > 16 ? 'true' : 'false';
    };

    if (toggle && mobileNav) {
      toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!expanded));
        mobileNav.hidden = expanded;
      });

      mobileNav.addEventListener('click', event => {
        if (event.target instanceof HTMLAnchorElement) {
          toggle.setAttribute('aria-expanded', 'false');
          mobileNav.hidden = true;
        }
      });
    }

    window.addEventListener('scroll', syncElevated, { passive: true });
    syncElevated();
  }

  renderFeatures();
  renderFeatureDetails();
  renderConsoleItems();
  renderWorkflow();
  renderTags();
  renderChangelog();
  renderSecurity();
  renderFaq();
  setupCodeTabs();
  setupNav();
})();
