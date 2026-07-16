/**
 * Shared client-side logic for the Extension Security Analyzer.
 *
 * Provides: Toast notifications, SSE-based scan tracking, and utility functions.
 */

// ---------------------------------------------------------------------------
// Utility helpers (must be defined first)
// ---------------------------------------------------------------------------

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatInstalls(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
}

// ---------------------------------------------------------------------------
// Toast Notification System
// ---------------------------------------------------------------------------

const ToastManager = {
    container: null,

    init() {
        if (this.container) return;
        this.container = document.createElement('div');
        this.container.id = 'toast-container';
        this.container.setAttribute('role', 'alert');
        this.container.setAttribute('aria-live', 'polite');
        document.body.appendChild(this.container);
    },

    show(message, type = 'info', duration = 3000) {
        this.init();
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<span class="toast-icon">${this._getIcon(type)}</span><span class="toast-message">${escapeHtml(message)}</span>`;
        this.container.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add('show'));

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    _getIcon(type) {
        const icons = { success: '&#10003;', error: '&#10007;', warning: '&#9888;', info: '&#8505;' };
        return icons[type] || icons.info;
    },

    success(msg, duration) { this.show(msg, 'success', duration); },
    error(msg, duration) { this.show(msg, 'error', duration); },
    warning(msg, duration) { this.show(msg, 'warning', duration); },
    info(msg, duration) { this.show(msg, 'info', duration); }
};

// Expose toast functions globally for use in inline template scripts
window.toastSuccess = function(msg, duration) { ToastManager.success(msg, duration); };
window.toastError = function(msg, duration) { ToastManager.error(msg, duration); };
window.toastWarning = function(msg, duration) { ToastManager.warning(msg, duration); };
window.toastInfo = function(msg, duration) { ToastManager.info(msg, duration); };

// ---------------------------------------------------------------------------
// Button Loading State Helper
// ---------------------------------------------------------------------------

window.setButtonLoading = function(btn, isLoading, loadingText = 'Loading...') {
    if (!btn) return;
    if (isLoading) {
        btn.dataset.originalText = btn.textContent;
        btn.disabled = true;
        btn.classList.add('loading');
        btn.textContent = loadingText;
    } else {
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.textContent = btn.dataset.originalText || btn.textContent;
        delete btn.dataset.originalText;
    }
}

// ---------------------------------------------------------------------------
// Scan Tracker Class
// ---------------------------------------------------------------------------

class ScanTracker {
    constructor(scanId, options = {}) {
        this.scanId = scanId;
        this.options = options;
        this.eventSource = null;
        this._cancelled = false;
        this._done = false;
    }

    start() {
        const { progressBar, logArea, titleEl, progressArea, onProgress, onComplete, onError } = this.options;

        if (progressArea) progressArea.style.display = '';
        if (progressBar) progressBar.value = 0;
        if (logArea) logArea.textContent = '';
        if (titleEl) titleEl.textContent = 'Analyzing...';

        this.eventSource = new EventSource(`/api/scan/${this.scanId}/progress`);

        this.eventSource.addEventListener('progress', (e) => {
            if (this._cancelled) return;
            const info = JSON.parse(e.data);
            if (progressBar) progressBar.value = Math.round(info.progress * 100);
            if (logArea) this._addLogEntry(logArea, info.message);
            if (onProgress) onProgress(info);
        });

        this.eventSource.addEventListener('done', (e) => {
            this._done = true;
            this.eventSource.close();
            this.eventSource = null;
            const info = JSON.parse(e.data);
            if (progressBar) progressBar.value = 100;
            if (this._cancelled) {
                if (titleEl) titleEl.textContent = 'Cancelled';
                return;
            }
            if (titleEl) titleEl.textContent = info.status === 'complete' ? 'Complete' : `Status: ${info.status}`;
            // Hide cancel button once scan is done — keep log visible
            const cancelBtn = progressArea?.querySelector('#cancel-btn');
            if (cancelBtn) cancelBtn.style.display = 'none';
            if (info.status === 'complete' && onComplete) {
                onComplete(info.result);
            } else if (info.status !== 'complete' && onError) {
                onError(info);
            }
        });

        this.eventSource.addEventListener('error', () => {
            if (this.eventSource) { this.eventSource.close(); this.eventSource = null; }
            // Ignore the error the browser fires when the server closes the
            // stream after a normal 'done', and anything after an explicit cancel.
            if (this._done || this._cancelled) return;
            // Otherwise the SSE connection dropped mid-scan: surface it instead of
            // leaving the progress card frozen on "Analyzing..." forever.
            const { titleEl, progressArea, onError } = this.options;
            if (titleEl) titleEl.textContent = 'Connection lost';
            const cancelBtn = progressArea?.querySelector('#cancel-btn');
            if (cancelBtn) cancelBtn.style.display = 'none';
            if (onError) onError({ status: 'error', error: 'Lost connection to the scan progress stream' });
        });

        return this;
    }

    async cancel() {
        this._cancelled = true;
        try { await fetch(`/api/scan/${this.scanId}`, { method: 'DELETE' }); } catch (e) {}
        if (this.eventSource) { this.eventSource.close(); this.eventSource = null; }
        if (this.options.titleEl) this.options.titleEl.textContent = 'Cancelled';
    }

    _addLogEntry(logArea, message) {
        const line = document.createElement('div');
        line.textContent = message;
        logArea.appendChild(line);
        logArea.scrollTop = logArea.scrollHeight;
    }
}

// ---------------------------------------------------------------------------
// Global scan state
// ---------------------------------------------------------------------------

let _currentScanId = null;
let _currentEventSource = null;
let _currentScanTracker = null;

async function startScan(url, body, callbacks = {}) {
    const progressArea = document.getElementById('progress-area');
    const progressBar = document.getElementById('progress-bar');
    const progressLog = document.getElementById('progress-log');
    const titleEl = document.getElementById('progress-title');

    if (progressArea) progressArea.style.display = '';
    if (progressBar) progressBar.value = 0;
    if (progressLog) progressLog.textContent = '';

    try {
        const isFormData = body instanceof FormData;
        const resp = await fetch(url, {
            method: 'POST',
            body: isFormData ? body : JSON.stringify(body),
            headers: isFormData ? {} : { 'Content-Type': 'application/json' },
        });
        
        if (!resp.ok) {
            let errMsg = `Error ${resp.status}`;
            try {
                const errData = await resp.json();
                errMsg = errData.detail || errData.error || errMsg;
            } catch (e) {
                try {
                    const errText = await resp.text();
                    if (errText) errMsg = errText;
                } catch (e2) {}
            }
            throw new Error(errMsg);
        }
        
        const data = await resp.json();
        if (!data.scan_id) {
            throw new Error('No scan ID returned from server');
        }
        _currentScanId = data.scan_id;

        _currentScanTracker = new ScanTracker(data.scan_id, {
            progressBar, logArea: progressLog, titleEl, progressArea,
            onProgress: callbacks.onProgress,
            onComplete: callbacks.onComplete,
            onError: callbacks.onError
        }).start();
        _currentEventSource = _currentScanTracker.eventSource;

    } catch (err) {
        if (progressLog) {
            const line = document.createElement('div');
            line.textContent = `Error: ${err.message}`;
            line.style.color = 'var(--danger)';
            progressLog.appendChild(line);
        }
        if (titleEl) titleEl.textContent = 'Error';
        if (callbacks.onError) callbacks.onError({ error: err.message });
    }
}

async function cancelCurrentScan() {
    if (_currentScanTracker) {
        await _currentScanTracker.cancel();
        _currentScanTracker = null;
    }
    _currentScanId = null;
    _currentEventSource = null;
}

function createScanTracker(scanId, options) {
    return new ScanTracker(scanId, options);
}

// ---------------------------------------------------------------------------
// Additional utility helpers
// ---------------------------------------------------------------------------

function riskBadge(score, label, color) {
    const colorMap = {
        red: '#e74c3c',
        orange: '#e67e22',
        yellow: '#f1c40f',
        green: '#27ae60',
        gray: '#95a5a6',
    };
    const bg = colorMap[color] || colorMap.gray;
    return `<span class="risk-badge" style="background:${bg}">${score} — ${escapeHtml(label)}</span>`;
}

function renderMarkdown(markdown) {
    // Server now renders markdown to HTML, so this function just escapes HTML
    // for any legacy calls that might still pass markdown
    return '<pre>' + escapeHtml(markdown) + '</pre>';
}

// Expose utility functions globally for use in inline template scripts
window.escapeHtml = escapeHtml;
window.formatInstalls = formatInstalls;
window.riskBadge = riskBadge;
window.renderMarkdown = renderMarkdown;
window.startScan = startScan;
window.cancelCurrentScan = cancelCurrentScan;
window.createScanTracker = createScanTracker;

// ---------------------------------------------------------------
// Collapsible sidebar: pages using .analyze-layout (Batch, Analyze)
// get a floating edge handle; collapsing lets the content column
// flex into the freed space. State persists across visits.
// ---------------------------------------------------------------
(function () {
    const layout = document.querySelector('.analyze-layout');
    if (!layout || !layout.querySelector('.sidebar')) return;

    const STORAGE_KEY = 'sidebarCollapsed';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sidebar-toggle';
    btn.setAttribute('aria-label', 'Toggle sidebar');

    function apply(collapsed) {
        layout.classList.toggle('sidebar-collapsed', collapsed);
        btn.textContent = collapsed ? '❯' : '❮';
        btn.title = collapsed ? 'Show sidebar' : 'Hide sidebar';
    }

    btn.addEventListener('click', () => {
        const collapsed = !layout.classList.contains('sidebar-collapsed');
        try { localStorage.setItem(STORAGE_KEY, collapsed ? '1' : ''); } catch (e) { /* private mode */ }
        apply(collapsed);
    });

    let saved = false;
    try { saved = localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { /* private mode */ }
    apply(saved);
    document.body.appendChild(btn);
})();
