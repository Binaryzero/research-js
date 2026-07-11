/**
 * Interactive report renderer.
 *
 * One renderer, two hosts:
 *   - the app's report page (embedded mode) feeds it the payload from
 *     GET /api/reports/:name/data
 *   - standalone .html exports inline this file and boot it from an embedded
 *     JSON script block (kept free of literal script tags: this source is
 *     inlined into HTML, where a nested closing tag would end the block)
 *
 * Security model: every string in the payload (finding titles, evidence,
 * matchHighlight, endpoint URLs, metadata, executive summary) is
 * attacker-controlled — it comes from scanned third-party extension code.
 * Rendering is exclusively DOM-API based (createElement/textContent); no
 * innerHTML is ever used with payload data, so hostile strings cannot become
 * markup. Keep it that way.
 */
(function () {
  'use strict';

  var SEVERITIES = ['critical', 'high', 'medium', 'low'];
  var SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
  var SEV_COLORS = {
    critical: 'var(--rv-sev-critical)',
    high: 'var(--rv-sev-high)',
    medium: 'var(--rv-sev-medium)',
    low: 'var(--rv-sev-low)',
  };
  // matchHighlight is attacker-controlled: bound the number of <mark> nodes so
  // a 1-char highlight over a big evidence blob cannot flood the DOM.
  var MAX_HIGHLIGHTS = 100;
  var MIN_HIGHLIGHT_LEN = 3;
  var EP_RENDER_LIMIT = 200;

  // ── tiny DOM helper: el(tag, props, ...children). Strings become text nodes. ──
  function el(tag, props) {
    var node = document.createElement(tag);
    if (props) {
      for (var k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
        var v = props[k];
        if (k === 'class') node.className = v;
        else if (k === 'dataset') { for (var d in v) node.dataset[d] = v[d]; }
        else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      appendChild(node, arguments[i]);
    }
    return node;
  }
  function appendChild(node, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { for (var i = 0; i < c.length; i++) appendChild(node, c[i]); return; }
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }

  function catLabel(c) {
    return String(c).replace(/_/g, ' ').replace(/\b\w/g, function (s) { return s.toUpperCase(); });
  }
  // Category names are analyzer-owned (patterns.yaml keys), but the persisted
  // JSON on disk could be edited: keep ids selector-safe regardless.
  function catId(c) {
    return 'rv-cat-' + String(c).replace(/[^a-zA-Z0-9_-]/g, '_');
  }
  function fmtSize(b) {
    var units = ['B', 'KB', 'MB', 'GB'];
    var size = Number(b) || 0;
    var idx = 0;
    while (size >= 1024 && idx < units.length - 1) { size /= 1024; idx++; }
    return size.toFixed(1) + ' ' + units[idx];
  }
  function sevOf(f) {
    var r = String(f.riskLevel || 'low').toLowerCase();
    return SEVERITIES.indexOf(r) >= 0 ? r : 'low';
  }
  function scrollBehavior() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto' : 'smooth';
  }

  function render(root, payload, opts) {
    opts = opts || {};
    var mode = opts.mode === 'standalone' ? 'standalone' : 'embedded';

    // Normalize structure so a malformed payload degrades to empty sections
    // instead of aborting the whole render.
    payload = payload || {};
    var R = payload.result || {};
    var findings = Array.isArray(R.findings) ? R.findings : [];
    var endpoints = Array.isArray(R.endpoints) ? R.endpoints : [];
    var binaryHashes = Array.isArray(R.binaryHashes) ? R.binaryHashes : [];
    var fileStats = (R.fileStats && typeof R.fileStats === 'object') ? R.fileStats : {};

    root.textContent = '';
    root.classList.add('report-view');
    root.classList.add('rv-' + mode);

    // ── group findings by category, worst-severity categories first ──
    var groups = {};
    var order = [];
    findings.forEach(function (f) {
      var cat = String(f.category || 'uncategorized');
      if (!groups[cat]) { groups[cat] = []; order.push(cat); }
      groups[cat].push(f);
    });
    order.sort(function (a, b) {
      var ra = Math.min.apply(null, groups[a].map(function (f) { return SEV_RANK[sevOf(f)]; }));
      var rb = Math.min.apply(null, groups[b].map(function (f) { return SEV_RANK[sevOf(f)]; }));
      return (ra - rb) || (groups[b].length - groups[a].length);
    });
    order.forEach(function (cat) {
      groups[cat].sort(function (a, b) {
        return (a.isFalsePositive - b.isFalsePositive) || (SEV_RANK[sevOf(a)] - SEV_RANK[sevOf(b)]);
      });
    });

    var fpCount = findings.filter(function (f) { return f.isFalsePositive; }).length;
    var sevCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    findings.forEach(function (f) { sevCounts[sevOf(f)]++; });

    // Severity filtering is OPT-IN: an empty selection shows everything;
    // selecting chips narrows the view to just those severities.
    var state = {
      search: '',
      sev: {}, // e.g. { critical: true } — empty means "no severity filter"
      fpMode: fpCount > 0 ? 'hide' : 'all', // hide | dim | all | only
    };
    function anySevSelected() {
      for (var k in state.sev) { if (state.sev[k]) return true; }
      return false;
    }

    // ═══ Sidebar ═══
    var sidebar = el('nav', { class: 'rv-sidebar', 'aria-label': 'Report sections' });
    if (mode === 'standalone') {
      sidebar.append(el('div', { class: 'rv-brand' },
        buildShieldIcon(),
        el('span', null, 'Extension Security Analyzer')));
    }
    var main = el('div', { class: 'rv-main' });
    root.append(sidebar, main);

    // ═══ Header ═══
    var verdict = R.verdict || 'NONE';
    var verdictDesc = {
      MALICIOUS: 'Patterns consistent with malicious behavior detected by automated analysis',
      SUSPICIOUS: 'Elevated risk indicators detected by automated analysis',
      CLEAN: 'No risk indicators detected by automated analysis',
      NONE: 'Static analysis only — no LLM verdict available',
    }[verdict] || '';

    var overview = el('header', { id: 'rv-overview', class: 'rv-card' },
      el('h1', { class: 'rv-title' }, String(R.extensionName || R.extensionId || 'Unknown extension')),
      el('div', { class: 'rv-sub' },
        el('span', null, el('code', null, String(R.extensionId || '?') + '@' + String(R.version || '?'))),
        el('span', null, 'Publisher: ' + String(R.publisher || 'unknown')),
        el('span', null, 'Analyzed: ' + String(R.analysisDate || '?')),
        payload.score !== null && payload.score !== undefined
          ? el('span', null, 'Suspicion score: ' + payload.score) : null
      ),
      el('div', { class: 'rv-verdict ' + verdict },
        el('span', { class: 'rv-verdict-pill ' + verdict }, verdict === 'NONE' ? 'NO VERDICT' : verdict),
        el('span', { class: 'rv-verdict-desc' }, verdictDesc)
      ),
      el('div', { class: 'rv-stats' },
        stat(String(findings.length), 'Findings', '', 'Show all findings', function () {
          setFilters({ search: '', sev: [], fpMode: 'all' });
        }),
        stat(String(findings.length - fpCount), 'True positives', '', 'Show only true positives', function () {
          setFilters({ sev: [], fpMode: 'hide' });
        }),
        stat(String(fpCount), 'False positives', 'fp', 'Show only false positives', function () {
          setFilters({ sev: [], fpMode: 'only' });
        }),
        stat(String(sevCounts.critical), 'Critical', 'critical', 'Show only critical findings', function () {
          setFilters({ sev: ['critical'], fpMode: 'all' });
        }),
        stat(String(sevCounts.high), 'High', 'high', 'Show only high findings', function () {
          setFilters({ sev: ['high'], fpMode: 'all' });
        }),
        stat(String(endpoints.length), 'Endpoints', '', 'Jump to endpoints', function () {
          var t = root.querySelector('#rv-endpoints');
          if (t) t.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
        })
      )
    );
    main.append(overview);

    // Stat cards double as filter shortcuts: clicking one applies the matching
    // filter and jumps to the findings list.
    function stat(value, label, cls, hint, onActivate) {
      return el('button', {
        class: 'rv-stat ' + cls, type: 'button', title: hint,
        onclick: function () {
          onActivate();
          if (label !== 'Endpoints') {
            var t = root.querySelector('#rv-findings');
            if (t) t.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
          }
        },
      }, el('div', { class: 'v' }, value), el('div', { class: 'l' }, label));
    }

    // ═══ Executive summary ═══
    if (R.executiveSummary) {
      main.append(el('section', { class: 'rv-card', id: 'rv-exec-summary' },
        el('h2', null, 'Executive Summary'),
        el('div', { class: 'rv-exec' }, String(R.executiveSummary)),
        el('p', { class: 'rv-note' }, 'Generated by the analysis model from scanned extension content — treat as untrusted input, not analyst conclusions.')
      ));
    }

    // ═══ Metadata ═══
    var categories = Array.isArray(R.categories) ? R.categories : [];
    var activationEvents = Array.isArray(R.activationEvents) ? R.activationEvents : [];
    var bundledDeps = Array.isArray(R.bundledDependencies) ? R.bundledDependencies : [];
    var metaRows = [
      ['Publisher', String(R.publisher || 'Not specified')],
      ['Description', String(R.description || 'Not specified')],
      ['Repository', String(R.repository || 'Not specified')],
      ['Categories', categories.join(', ') || 'None'],
      ['Activation Events', activationEvents.join(', ') || 'Implicit / startup'],
    ];
    if (bundledDeps.length) metaRows.push(['Bundled Dependencies', bundledDeps.join(', ')]);
    main.append(el('section', { class: 'rv-card', id: 'rv-metadata' },
      el('h2', null, 'Metadata'),
      el('table', null, el('tbody', null, metaRows.map(function (row) {
        return el('tr', null,
          el('td', { style: 'color:var(--rv-fg-muted);width:180px' }, row[0]),
          el('td', null, row[1]));
      })))
    ));

    // ═══ File inventory ═══
    var fileCatNames = { js: 'JavaScript', binary: 'Native Binaries', config: 'Configuration', asset: 'Assets', text: 'Text Files', agent_config: 'Agent Config' };
    var fileRows = [];
    for (var fc in fileCatNames) {
      var st = fileStats[fc];
      if (st && st.count > 0) {
        fileRows.push(el('tr', null,
          el('td', null, fileCatNames[fc]),
          el('td', null, String(st.count)),
          el('td', null, fmtSize(st.totalSize))));
      }
    }
    fileRows.push(el('tr', null,
      el('td', null, el('b', null, 'Total')), el('td', null, ''),
      el('td', null, el('b', null, fmtSize(R.totalSize || 0)))));
    main.append(el('section', { class: 'rv-card', id: 'rv-files' },
      el('h2', null, 'File Inventory'),
      el('table', null,
        el('thead', null, el('tr', null, el('th', null, 'Category'), el('th', null, 'Count'), el('th', null, 'Size'))),
        el('tbody', null, fileRows))
    ));

    // ═══ Binary hashes ═══
    if (binaryHashes.length) {
      main.append(el('section', { class: 'rv-card', id: 'rv-binaries' },
        el('h2', null, 'Binary Hashes (' + binaryHashes.length + ')'),
        el('table', null,
          el('thead', null, el('tr', null, el('th', null, 'File'), el('th', null, 'Architecture'), el('th', null, 'Size'), el('th', null, 'SHA256'))),
          el('tbody', null, binaryHashes.map(function (b) {
            return el('tr', null,
              el('td', null, el('code', null, String(b.path || ''))),
              el('td', null, String(b.architecture || '-')),
              el('td', null, fmtSize(b.size || 0)),
              el('td', null, el('code', null, String(b.sha256 || ''))));
          })))
      ));
    }

    // ═══ Endpoints ═══
    var epRows = endpoints.slice(0, EP_RENDER_LIMIT).map(function (e) {
      return el('tr', null,
        el('td', null, el('code', null, String(e.url || ''))),
        el('td', null, String(e.method || '-')),
        el('td', null, el('span', { class: 'rv-tag ' + (e.operational ? 'active' : 'ref') }, e.operational ? 'active' : 'ref')),
        el('td', null, el('code', null, String(e.file || '') + ':' + String(e.line || ''))));
    });
    if (endpoints.length > EP_RENDER_LIMIT) {
      epRows.push(el('tr', null, el('td', { colspan: '4', style: 'color:var(--rv-warning)' },
        'Showing first ' + EP_RENDER_LIMIT + ' of ' + endpoints.length + ' endpoints — see the markdown/JSON report for the full list.')));
    }
    var excludedNote = R.endpointExcludedCount
      ? el('p', { class: 'rv-note' }, R.endpointExcludedCount + ' URL(s) excluded (standard infrastructure domains and package metadata).')
      : null;
    main.append(el('section', { class: 'rv-card', id: 'rv-endpoints' },
      el('h2', null, 'External Endpoints (' + endpoints.length + ')'),
      endpoints.length === 0
        ? el('p', { class: 'rv-empty' }, 'No notable external URLs found in code.')
        : el('table', null,
            el('thead', null, el('tr', null, el('th', null, 'URL'), el('th', null, 'Method'), el('th', null, 'Usage'), el('th', null, 'Location'))),
            el('tbody', null, epRows)),
      excludedNote
    ));

    // ═══ Findings toolbar ═══
    var searchInput = el('input', {
      class: 'rv-search', type: 'search', 'aria-label': 'Search findings',
      placeholder: 'Search findings…  ( / )',
      oninput: function (e) { state.search = e.target.value.toLowerCase(); applyFilters(); },
    });
    // Opt-in severity chips: none selected = show all; a selected chip narrows
    // the view to that severity (multi-select adds more).
    var chipEls = {};
    var sevChips = SEVERITIES.map(function (sev) {
      var chip = el('button', {
        class: 'rv-chip ' + sev, 'aria-pressed': 'false', type: 'button',
        title: 'Show only ' + sev + ' findings',
        onclick: function () {
          state.sev[sev] = !state.sev[sev];
          syncControls();
          applyFilters();
        },
      }, el('span', { class: 'rv-dot', style: 'background:' + SEV_COLORS[sev] }), sev + ' ' + sevCounts[sev]);
      chipEls[sev] = chip;
      return chip;
    });
    function syncControls() {
      SEVERITIES.forEach(function (sev) {
        var on = !!state.sev[sev];
        chipEls[sev].classList.toggle('on', on);
        chipEls[sev].setAttribute('aria-pressed', String(on));
      });
      fpSelect.value = state.fpMode;
      if (searchInput.value.toLowerCase() !== state.search) searchInput.value = state.search;
    }
    function setFilters(opts) {
      if (opts.search !== undefined) state.search = opts.search.toLowerCase();
      if (opts.sev !== undefined) {
        state.sev = {};
        opts.sev.forEach(function (s) { state.sev[s] = true; });
      }
      if (opts.fpMode !== undefined) state.fpMode = opts.fpMode;
      syncControls();
      applyFilters();
    }
    var fpSelect = el('select', {
      class: 'rv-fp-mode', 'aria-label': 'False positive display mode',
      onchange: function (e) { state.fpMode = e.target.value; applyFilters(); },
    },
      el('option', { value: 'hide' }, 'Hide false positives (' + fpCount + ')'),
      el('option', { value: 'dim' }, 'Dim false positives'),
      el('option', { value: 'all' }, 'Show everything'),
      el('option', { value: 'only' }, 'Only false positives'));
    fpSelect.value = state.fpMode;
    var resultCount = el('span', { class: 'rv-result-count', 'aria-live': 'polite' });
    var toolbar = el('div', { class: 'rv-toolbar', id: 'rv-findings' },
      searchInput, sevChips, fpSelect,
      el('button', { class: 'rv-btn', type: 'button', onclick: function () { toggleAll(true); } }, 'Expand all'),
      el('button', { class: 'rv-btn', type: 'button', onclick: function () { toggleAll(false); } }, 'Collapse all'),
      resultCount);
    main.append(toolbar);

    // ═══ Findings ═══
    var findingEls = [];
    var categoryEls = {};

    order.forEach(function (category) {
      var items = groups[category];

      // Static totals: what the category CONTAINS never changes with filters;
      // a dynamic "N hidden" badge signals when filters are suppressing items.
      var totals = { c: 0, h: 0, m: 0, l: 0, fp: 0 };
      items.forEach(function (f) {
        totals[sevOf(f)[0]]++;
        if (f.isFalsePositive) totals.fp++;
      });
      var hiddenBadge = el('span', { class: 'rv-cat-badge hidden-count rv-hidden' });
      var countsBar = el('div', { class: 'rv-cat-counts' },
        el('span', { class: 'rv-cat-badge total' }, items.length + (items.length === 1 ? ' finding' : ' findings')),
        totals.c ? el('span', { class: 'rv-cat-badge c' }, totals.c + ' crit') : null,
        totals.h ? el('span', { class: 'rv-cat-badge h' }, totals.h + ' high') : null,
        totals.m ? el('span', { class: 'rv-cat-badge m' }, totals.m + ' med') : null,
        totals.l ? el('span', { class: 'rv-cat-badge l' }, totals.l + ' low') : null,
        totals.fp ? el('span', { class: 'rv-cat-badge fp' }, totals.fp + ' fp') : null,
        hiddenBadge);

      var summary = el('summary', null,
        el('span', { class: 'rv-chevron', 'aria-hidden': 'true' }, '▸'),
        el('h2', null, catLabel(category)),
        countsBar);
      var body = el('div', { class: 'rv-cat-body' });
      var details = el('details', { class: 'rv-category', open: '', id: catId(category) });
      details.append(summary, body);

      items.forEach(function (f) {
        var fEl = buildFinding(f, body);
        findingEls.push(fEl);
      });

      main.append(details);
      categoryEls[category] = { details: details, hiddenBadge: hiddenBadge, total: items.length };
    });

    if (findings.length === 0) {
      main.append(el('section', { class: 'rv-card' },
        el('p', { class: 'rv-empty' }, 'No significant security findings detected.')));
    }

    function buildFinding(f, body) {
      var sev = sevOf(f);
      // 'none' is a legitimate LLM risk level — bucket with low for filtering,
      // but keep the honest label on the badge.
      var sevLabel = String(f.riskLevel || '').toLowerCase() === 'none' ? 'none' : sev;
      var summary = el('summary', null,
        el('span', { class: 'rv-sev-badge ' + sev }, sevLabel),
        el('span', { class: 'rv-f-title' }, String(f.title || 'Untitled finding')),
        f.isFalsePositive ? el('span', { class: 'rv-mini-tag fp' }, 'FALSE POSITIVE') : null,
        f.injectionDetected ? el('span', { class: 'rv-mini-tag injection' }, 'INJECTION') : null,
        f.recommendation === 'investigate' ? el('span', { class: 'rv-mini-tag investigate' }, 'INVESTIGATE') : null,
        f.consensus ? el('span', { class: 'rv-mini-tag consensus' },
          f.consensus.unanimous ? 'UNANIMOUS' : (f.consensus.splitDecision ? 'SPLIT VOTE' : 'MAJORITY')) : null,
        el('span', { class: 'rv-f-loc' }, String(f.location || '')));

      var pre = el('pre', { class: 'rv-evidence' });
      var ev = String(f.evidence || '');
      var mh = f.matchHighlight;
      if (mh && mh.length >= MIN_HIGHLIGHT_LEN && ev.indexOf(mh) >= 0) {
        var parts = ev.split(mh);
        parts.forEach(function (part, i) {
          pre.append(document.createTextNode(part));
          if (i < parts.length - 1) {
            if (i < MAX_HIGHLIGHTS) pre.append(el('mark', null, mh));
            else pre.append(document.createTextNode(mh));
          }
        });
      } else {
        pre.textContent = ev;
      }
      if (f.evidenceTruncated) {
        pre.append(document.createTextNode(
          '\n… evidence truncated for display (' + (f.evidenceFullLength || 'full') + ' chars total)'));
      }

      var metaBits = [
        el('span', null, 'Risk: ', el('b', null, sevLabel.toUpperCase())),
        f.probableOrigin && f.probableOrigin !== 'unknown'
          ? el('span', null, 'Origin: ', el('b', null, f.probableOrigin === 'extension_code' ? 'Extension code' : 'Bundled dependency'))
          : null,
        f.patternName ? el('span', null, 'Pattern: ', el('b', null, String(f.patternName))) : null,
        f.isMinified ? el('span', null, el('b', null, 'Minified source')) : null,
      ];

      var fBody = el('div', { class: 'rv-f-body' },
        el('p', { class: 'rv-f-obs' }, String(f.observation || '')),
        el('div', { class: 'rv-f-meta' }, metaBits),
        f.isFalsePositive && f.falsePositiveReason
          ? el('div', { class: 'rv-fp-reason' }, el('b', null, 'Why false positive: '), String(f.falsePositiveReason))
          : null,
        f.consensus && Array.isArray(f.consensus.votes)
          ? el('div', { class: 'rv-consensus' }, el('b', null, 'Consensus: '),
              (f.consensus.unanimous ? 'Unanimous' : f.consensus.splitDecision ? 'Split decision' : 'Majority')
              + ' — votes: ' + f.consensus.votes.map(function (v) {
                return String(v.riskLevel) + (v.isFalsePositive ? ' (FP)' : '');
              }).join(', '))
          : null,
        ev ? pre : null);

      // Findings start expanded — the report should read top to bottom without
      // per-item clicking; collapsing is the opt-in action.
      var elDetails = el('details', {
        class: 'rv-finding' + (f.isFalsePositive ? ' is-fp' : ''),
        dataset: { sev: sev },
        open: '',
      });
      elDetails.append(summary, fBody);
      body.append(elDetails);

      return {
        elem: elDetails,
        finding: f,
        sev: sev,
        category: String(f.category || 'uncategorized'),
        text: [f.title, f.location, f.observation, f.evidence, f.patternName, f.falsePositiveReason, catLabel(f.category || '')]
          .map(function (s) { return String(s || ''); }).join(' ').toLowerCase(),
      };
    }

    // ═══ Sidebar nav ═══
    var navButtons = [];
    function navItem(label, targetId, extra) {
      var btn = el('button', { class: 'rv-nav-item', type: 'button', onclick: function () {
        var t = root.querySelector('#' + targetId);
        if (t) {
          if (t.tagName === 'DETAILS') t.open = true;
          t.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
        }
      } }, el('span', null, label), extra || null);
      navButtons.push(btn);
      return btn;
    }
    var catNavItems = {};
    sidebar.append(
      el('div', null,
        el('div', { class: 'rv-nav-label' }, 'Report'),
        navItem('Overview', 'rv-overview'),
        R.executiveSummary ? navItem('Executive Summary', 'rv-exec-summary') : null,
        navItem('Metadata', 'rv-metadata'),
        navItem('File Inventory', 'rv-files'),
        binaryHashes.length ? navItem('Binary Hashes', 'rv-binaries', el('span', { class: 'rv-count' }, String(binaryHashes.length))) : null,
        navItem('Endpoints', 'rv-endpoints', el('span', { class: 'rv-count' }, String(endpoints.length)))));
    if (order.length) {
      var catGroup = el('div', null, el('div', { class: 'rv-nav-label' }, 'Findings'));
      order.forEach(function (category) {
        var items = groups[category];
        var worst = SEVERITIES[Math.min.apply(null, items.map(function (f) { return SEV_RANK[sevOf(f)]; }))];
        var count = el('span', { class: 'rv-count' }, String(items.length));
        var item = navItem(catLabel(category), catId(category),
          [el('span', { class: 'rv-sev-dot', 'aria-hidden': 'true', style: 'background:' + SEV_COLORS[worst] }), count]);
        catGroup.append(item);
        catNavItems[category] = { item: item, count: count };
      });
      sidebar.append(catGroup);
    }

    // ═══ Filtering ═══
    function findingVisible(rec, sevFilterActive) {
      if (sevFilterActive && !state.sev[rec.sev]) return false;
      var isFp = !!rec.finding.isFalsePositive;
      if (state.fpMode === 'hide' && isFp) return false;
      if (state.fpMode === 'only' && !isFp) return false;
      if (state.search && rec.text.indexOf(state.search) < 0) return false;
      return true;
    }

    function applyFilters() {
      var sevFilterActive = anySevSelected();
      var visiblePerCat = {};
      var visible = 0;
      findingEls.forEach(function (rec) {
        var show = findingVisible(rec, sevFilterActive);
        rec.elem.classList.toggle('rv-hidden', !show);
        rec.elem.classList.toggle('dimmed', state.fpMode === 'dim' && !!rec.finding.isFalsePositive);
        if (!show) return;
        visible++;
        visiblePerCat[rec.category] = (visiblePerCat[rec.category] || 0) + 1;
      });
      for (var category in categoryEls) {
        var entry = categoryEls[category];
        var shown = visiblePerCat[category] || 0;
        var hidden = entry.total - shown;
        entry.details.classList.toggle('rv-hidden', shown === 0);
        entry.hiddenBadge.textContent = hidden + ' hidden';
        entry.hiddenBadge.classList.toggle('rv-hidden', hidden === 0);
        var nav = catNavItems[category];
        if (nav) nav.item.classList.toggle('rv-hidden', shown === 0);
      }
      var totalHidden = findings.length - visible;
      resultCount.textContent = totalHidden > 0
        ? findings.length + ' findings · ' + totalHidden + ' hidden by filters'
        : findings.length + ' findings';
    }

    function toggleAll(open) {
      findingEls.forEach(function (rec) { rec.elem.open = open; });
      // Only force categories open when expanding; collapsing should leave
      // manually-collapsed categories alone.
      if (open) {
        for (var category in categoryEls) categoryEls[category].details.open = true;
      }
    }

    // keyboard: "/" focuses search
    function onKeydown(e) {
      if (e.key === '/' && document.activeElement !== searchInput
          && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName)) {
        e.preventDefault();
        searchInput.focus();
      } else if (e.key === 'Escape' && document.activeElement === searchInput) {
        searchInput.blur();
      }
    }
    document.addEventListener('keydown', onKeydown);

    // ═══ Scrollspy ═══
    var spyTargets = Array.prototype.slice.call(
      root.querySelectorAll('#rv-overview, #rv-exec-summary, #rv-metadata, #rv-files, #rv-binaries, #rv-endpoints, .rv-category'));
    var spyButtons = navButtons; // built in the same conditional order as spyTargets
    var observer = null;
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var idx = spyTargets.indexOf(entry.target);
          if (idx < 0 || !spyButtons[idx]) return;
          spyButtons.forEach(function (b) { b.classList.remove('active'); });
          spyButtons[idx].classList.add('active');
        });
      }, { rootMargin: '-10% 0px -70% 0px' });
      spyTargets.forEach(function (t) { observer.observe(t); });
    }

    applyFilters();

    return {
      applyFilters: applyFilters,
      destroy: function () {
        document.removeEventListener('keydown', onKeydown);
        if (observer) observer.disconnect();
      },
    };
  }

  function buildShieldIcon() {
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    var p1 = document.createElementNS(svgNS, 'path');
    p1.setAttribute('d', 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z');
    var p2 = document.createElementNS(svgNS, 'path');
    p2.setAttribute('d', 'M9 12l2 2 4-4');
    svg.append(p1, p2);
    return svg;
  }

  window.ReportView = { render: render };
})();
