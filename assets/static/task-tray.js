/**
 * Global task tray.
 *
 * Lives on every page (mounted from base.html) and polls /api/jobs so a running
 * scan is always visible and clickable regardless of where you navigate. This
 * is the durable, cross-page status surface — it does NOT depend on the SSE
 * stream of the page that started the scan, and it does not read the console.
 */
(function () {
  'use strict';

  var POLL_INTERVAL_MS = 2000;
  var ACTIVE = { pending: 1, running: 1 };
  var STATUS_META = {
    pending: { label: 'Queued', cls: 'pending' },
    running: { label: 'Running', cls: 'running' },
    complete: { label: 'Complete', cls: 'complete' },
    failed: { label: 'Failed', cls: 'failed' },
    cancelled: { label: 'Cancelled', cls: 'cancelled' },
    interrupted: { label: 'Interrupted', cls: 'interrupted' },
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function reportHref(job) {
    if (!job.reportName) return null;
    return '/report/' + encodeURIComponent(job.reportName);
  }

  function timeAgo(iso) {
    if (!iso) return '';
    var s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function TaskTray() {
    this.jobs = [];
    this.open = false;
    this.build();
    this.poll();
    // Refresh timestamps and re-poll on a steady cadence.
    setInterval(this.poll.bind(this), POLL_INTERVAL_MS);
    // Re-poll immediately when the tab regains focus (you were away).
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) this.poll();
    }.bind(this));
    // Let any page kick an immediate refresh right after starting a scan.
    window.addEventListener('task-tray-refresh', this.poll.bind(this));
  }

  TaskTray.prototype.build = function () {
    var root = el('div', 'task-tray');

    var btn = el('button', 'task-tray-toggle');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Task status');
    btn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>';
    var badge = el('span', 'task-tray-badge');
    badge.style.display = 'none';
    btn.appendChild(badge);
    btn.addEventListener('click', this.toggle.bind(this));

    var panel = el('div', 'task-tray-panel');
    panel.style.display = 'none';
    var header = el('div', 'task-tray-header');
    header.appendChild(el('span', null, 'Tasks'));
    var refresh = el('button', 'task-tray-refresh-btn', 'Refresh');
    refresh.type = 'button';
    refresh.addEventListener('click', this.poll.bind(this));
    header.appendChild(refresh);
    panel.appendChild(header);
    var listEl = el('div', 'task-tray-list');
    panel.appendChild(listEl);

    root.appendChild(panel);
    root.appendChild(btn);
    document.body.appendChild(root);

    this.badge = badge;
    this.panel = panel;
    this.listEl = listEl;
    this.toggleBtn = btn;
  };

  TaskTray.prototype.toggle = function () {
    this.open = !this.open;
    this.panel.style.display = this.open ? '' : 'none';
    this.toggleBtn.classList.toggle('open', this.open);
    if (this.open) this.poll();
  };

  TaskTray.prototype.poll = function () {
    fetch('/api/jobs')
      .then(function (r) { return r.ok ? r.json() : { jobs: [] }; })
      .then(function (data) {
        this.jobs = data.jobs || [];
        this.render(data.activeCount || 0);
      }.bind(this))
      .catch(function () { /* server briefly unreachable; keep last state */ });
  };

  TaskTray.prototype.render = function (activeCount) {
    // Badge shows the count of in-flight jobs and pulses while any is running.
    if (activeCount > 0) {
      this.badge.textContent = String(activeCount);
      this.badge.style.display = '';
      this.toggleBtn.classList.add('active');
    } else {
      this.badge.style.display = 'none';
      this.toggleBtn.classList.remove('active');
    }

    if (!this.open) return;

    this.listEl.textContent = '';
    if (this.jobs.length === 0) {
      this.listEl.appendChild(el('div', 'task-tray-empty', 'No tasks yet.'));
      return;
    }

    this.jobs.forEach(function (job) {
      var meta = STATUS_META[job.status] || { label: job.status, cls: 'pending' };
      var item = el('div', 'task-tray-item ' + meta.cls);

      var top = el('div', 'task-tray-item-top');
      var label = el('span', 'task-tray-item-label', job.label || job.target);
      top.appendChild(label);
      top.appendChild(el('span', 'task-tray-status ' + meta.cls, meta.label));
      item.appendChild(top);

      if (ACTIVE[job.status]) {
        var bar = el('div', 'task-tray-bar');
        var fill = el('div', 'task-tray-bar-fill');
        fill.style.width = Math.round((job.progress || 0) * 100) + '%';
        bar.appendChild(fill);
        item.appendChild(bar);
        if (job.message) item.appendChild(el('div', 'task-tray-msg', job.message));
      } else {
        var sub = el('div', 'task-tray-sub');
        var when = job.finishedAt || job.updatedAt;
        sub.appendChild(el('span', null, timeAgo(when)));
        if (job.error) {
          item.classList.add('has-error');
          sub.appendChild(el('span', 'task-tray-err', job.error));
        }
        item.appendChild(sub);
      }

      var href = reportHref(job);
      if (href && (job.status === 'complete')) {
        var link = el('a', 'task-tray-open', 'Open report →');
        link.href = href;
        item.appendChild(link);
      }

      this.listEl.appendChild(item);
    }.bind(this));
  };

  // Any page that POSTs to /api/scan gets an instant tray refresh, without
  // having to wire each call site: wrap fetch and watch for a scan_id reply.
  function hookScanStarts(tray) {
    var origFetch = window.fetch;
    if (!origFetch || origFetch.__taskTrayHooked) return;
    var wrapped = function (input, opts) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var isScanStart = /\/api\/(scan|batch-scan|llm-analyze|batch-llm-analyze)\b/.test(url) &&
        opts && (opts.method || '').toUpperCase() === 'POST';
      var p = origFetch.apply(this, arguments);
      if (isScanStart) {
        p.then(function () { setTimeout(tray.poll.bind(tray), 150); }).catch(function () {});
      }
      return p;
    };
    wrapped.__taskTrayHooked = true;
    window.fetch = wrapped;
  }

  function init() {
    if (window.__taskTray) return;
    window.__taskTray = new TaskTray();
    hookScanStarts(window.__taskTray);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
