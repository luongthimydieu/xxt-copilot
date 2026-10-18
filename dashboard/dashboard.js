/*
 * XXT Copilot · dashboard 控制台逻辑
 * ------------------------------------------------------------
 * 纯原生 JS（IIFE，无 ES module、无构建、无内联事件、无 eval）。
 * 通过 chrome.runtime / chrome.tabs 与 background、content script 通信；
 * 打开 dashboard.html?demo=1 时使用内置示例数据，不发送任何真实消息。
 */
(function (global) {
  'use strict';

  /* ================================================================
   * 常量
   * ================================================================ */

  var POLL_INTERVAL = 800;
  var POLL_TIMEOUT_MS = 6000;
  var POLL_MAX_FAILURES = 3;
  var MAX_LOG_ROWS = 300;
  var PAGE_SIZE = 50;
  var RESULT_PAGE_LIMIT = 200;
  var STORAGE_KEY = 'xxtSettings';
  var GENERATOR = 'XXT Copilot v0.1';

  var DEFAULT_SETTINGS = {
    minDelay: 600,
    maxDelay: 1500,
    timeout: 20000,
    retries: 2,
    maxCards: 80
  };

  var TYPE_LABELS = {
    single: '单选题',
    multiple: '多选题',
    judge: '判断题',
    fill: '填空题',
    short: '简答题',
    unknown: '未知题型'
  };

  var TYPE_ORDER = { single: 1, multiple: 2, judge: 3, fill: 4, short: 5, unknown: 6 };

  var SECTIONS = ['card-scan', 'card-run', 'card-logs', 'card-tasks', 'card-results', 'card-export'];

  var PAUSED_REASON_TEXT = {
    captcha: '检测到验证码，采集已暂停。请在学习通页面完成验证后点击「继续」。',
    login: '登录状态可能已失效，采集已暂停。请重新登录学习通后点击「继续」。',
    network: '网络请求异常，采集已暂停。请检查网络后点击「继续」。'
  };

  /* ================================================================
   * demo 模式内置数据（禁止进入真实逻辑）
   * ================================================================ */

  var DEMO_COURSE = {
    courseId: 'demo-267267643',
    clazzId: 'demo-155149418',
    cpi: 'demo-4850085533',
    title: '组织行为学（演示课程）',
    url: 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=demo-267267643&clazzid=demo-155149418'
  };

  var DEMO_ENTRIES = [
    {
      knowledgeId: 'demo-k-001',
      title: '第一章 组织行为学导论',
      index: 1,
      taskCount: 2,
      doneTasks: 2,
      status: 'done'
    },
    {
      knowledgeId: 'demo-k-002',
      title: '第二章 群体行为基础',
      index: 2,
      taskCount: 2,
      doneTasks: 1,
      status: 'failed'
    }
  ];

  var DEMO_TASKS = [
    {
      knowledgeId: 'demo-k-001',
      chapterTitle: '第一章 组织行为学导论',
      workId: 'demo-w-001',
      jobId: 'demo-job-1',
      status: 'done',
      questionCount: 2,
      error: null,
      sourceUrl: 'https://mooc1.chaoxing.com/mooc-ans/work/view?workId=demo-w-001'
    },
    {
      knowledgeId: 'demo-k-001',
      chapterTitle: '第一章 组织行为学导论',
      workId: 'demo-w-002',
      jobId: 'demo-job-1',
      status: 'done',
      questionCount: 2,
      error: null,
      sourceUrl: 'https://mooc1.chaoxing.com/mooc-ans/work/view?workId=demo-w-002'
    },
    {
      knowledgeId: 'demo-k-002',
      chapterTitle: '第二章 群体行为基础',
      workId: 'demo-w-003',
      jobId: 'demo-job-1',
      status: 'done',
      questionCount: 2,
      error: null,
      sourceUrl: 'https://mooc1.chaoxing.com/mooc-ans/work/view?workId=demo-w-003'
    },
    {
      knowledgeId: 'demo-k-002',
      chapterTitle: '第二章 群体行为基础',
      workId: 'demo-w-004',
      jobId: 'demo-job-1',
      status: 'failed',
      questionCount: 0,
      error: '请求超时（20000ms），已重试 2 次',
      sourceUrl: 'https://mooc1.chaoxing.com/mooc-ans/work/view?workId=demo-w-004'
    }
  ];

  var DEMO_QUESTIONS = [
    {
      id: 'demo-q-0001',
      knowledgeId: 'demo-k-001',
      chapterTitle: '第一章 组织行为学导论',
      workId: 'demo-w-001',
      type: 'single',
      typeLabel: '单选题',
      stem: '组织行为学主要研究的是（　）。',
      options: [
        { letter: 'A', text: '个体、群体以及组织结构对组织内部行为的影响' },
        { letter: 'B', text: '企业财务报表的编制方法' },
        { letter: 'C', text: '宏观经济政策的制定过程' },
        { letter: 'D', text: '产品生产工艺流程的优化' }
      ],
      myAnswer: 'A',
      correctAnswer: 'A',
      analysis: '组织行为学关注个体、群体与组织三个层面的行为规律，并研究这些规律对组织绩效的影响。',
      knowledgePoint: '组织行为学的定义',
      images: [],
      sourceUrl: 'https://mooc1.chaoxing.com/mooc-ans/work/view?workId=demo-w-001&questionId=demo-q-0001',
      adapter: 'review',
      warnings: [],
      answered: true,
      reviewed: false,
      hash: 'demo-hash-0001'
    },
    {
      id: 'demo-q-0002',
      knowledgeId: 'demo-k-001',
      chapterTitle: '第一章 组织行为学导论',
      workId: 'demo-w-001',
      type: 'judge',
      typeLabel: '判断题',
      stem: '组织文化一旦形成，就不会再发生任何变化。',
      options: [],
      myAnswer: '对',
      correctAnswer: '错',
      analysis: '组织文化会随外部环境变化、成员更替和重大事件而演变。',
      knowledgePoint: '组织文化',
      images: [],
      sourceUrl: 'https://mooc1.chaoxing.com/mooc-ans/work/view?workId=demo-w-001&questionId=demo-q-0002',
      adapter: 'timu',
      warnings: ['判断题原始选项缺失，已按题干语义补全'],
      answered: true,
      reviewed: false,
      hash: 'demo-hash-0002'
    },
    {
      id: 'demo-q-0003',
      knowledgeId: 'demo-k-001',
      chapterTitle: '第一章 组织行为学导论',
      workId: 'demo-w-002',
      type: 'multiple',
      typeLabel: '多选题',
      stem: '组织行为学研究的三个基本层次包括（　）。',
      options: [
        { letter: 'A', text: '个体水平' },
        { letter: 'B', text: '群体水平' },
        { letter: 'C', text: '组织水平' },
        { letter: 'D', text: '行业水平' }
      ],
      myAnswer: 'ABC',
      correctAnswer: 'ABC',
      analysis: '',
      knowledgePoint: '研究层次',
      images: [],
      sourceUrl: 'https://mooc1.chaoxing.com/mooc-ans/work/view?workId=demo-w-002&questionId=demo-q-0003',
      adapter: 'timu',
      warnings: [],
      answered: true,
      reviewed: false,
      hash: 'demo-hash-0003'
    },
    {
      id: 'demo-q-0004',
      knowledgeId: 'demo-k-001',
      chapterTitle: '第一章 组织行为学导论',
      workId: 'demo-w-002',
      type: 'single',
      typeLabel: '单选题',
      stem: '以下哪一项属于群体规范的非正式来源？（　）',
      options: [
        { letter: 'A', text: '公司章程明文规定' },
        { letter: 'B', text: '成员在长期互动中形成的默契' },
        { letter: 'C', text: '部门规章制度' },
        { letter: 'D', text: '劳动合同条款' }
      ],
      myAnswer: '',
      correctAnswer: '',
      analysis: '',
      knowledgePoint: '群体规范',
      images: [],
      sourceUrl: 'https://mooc1.chaoxing.com/mooc-ans/work/view?workId=demo-w-002&questionId=demo-q-0004',
      adapter: 'timu',
      warnings: [],
      answered: false,
      reviewed: false,
      hash: 'demo-hash-0004'
    },
    {
      id: 'demo-q-0005',
      knowledgeId: 'demo-k-002',
      chapterTitle: '第二章 群体行为基础',
      workId: 'demo-w-003',
      type: 'fill',
      typeLabel: '填空题',
      stem: '组织行为学的三大基本研究方法是____、____和____。',
      options: [],
      myAnswer: '观察法；实验法；调查法',
      correctAnswer: '观察法；实验法；调查法',
      analysis: '',
      knowledgePoint: '研究方法',
      images: [],
      sourceUrl: 'https://mooc1.chaoxing.com/mooc-ans/work/view?workId=demo-w-003&questionId=demo-q-0005',
      adapter: 'review',
      warnings: ['填空题包含多个空，答案分隔符未经平台标准化，需人工复核'],
      answered: true,
      reviewed: false,
      hash: 'demo-hash-0005'
    },
    {
      id: 'demo-q-0006',
      knowledgeId: 'demo-k-002',
      chapterTitle: '第二章 群体行为基础',
      workId: 'demo-w-003',
      type: 'short',
      typeLabel: '简答题',
      stem: '简述群体规范的形成过程。',
      options: [],
      myAnswer: '',
      correctAnswer: '',
      analysis: '',
      knowledgePoint: '群体规范',
      images: [],
      sourceUrl: 'https://mooc1.chaoxing.com/mooc-ans/work/view?workId=demo-w-003&questionId=demo-q-0006',
      adapter: 'review',
      warnings: ['简答题无标准答案，请以课程资料为准'],
      answered: false,
      reviewed: false,
      hash: 'demo-hash-0006'
    }
  ];

  var DEMO_LOGS = [
    { time: '09:12:03', level: 'info', message: '已连接学习通课程页（演示）：组织行为学（演示课程）' },
    { time: '09:12:04', level: 'info', message: '扫描目录完成：2 个章节，4 个任务点' },
    { time: '09:12:05', level: 'ok', message: '第一章 组织行为学导论：任务点 1 解析完成（2 题，适配器 review）' },
    { time: '09:12:06', level: 'ok', message: '第一章 组织行为学导论：任务点 2 解析完成（2 题，适配器 timu）' },
    { time: '09:12:08', level: 'ok', message: '第二章 群体行为基础：任务点 1 解析完成（2 题，适配器 review）' },
    { time: '09:12:10', level: 'warn', message: '第二章 群体行为基础：任务点 2 首次请求超时，正在重试（1/2）' },
    { time: '09:12:12', level: 'error', message: '第二章 群体行为基础：任务点 2 请求超时（20000ms），已重试 2 次，记录失败任务' },
    { time: '09:12:13', level: 'warn', message: '采集结束：3 个任务成功，1 个任务失败，共 6 题' }
  ];

  // demo 模拟采集时的 4 个任务点计划（与 DEMO_QUESTIONS 索引对应）。
  var DEMO_TASK_PLAN = [
    { entryIndex: 0, questions: [0, 1], ok: true, log: '第一章 组织行为学导论：任务点 1 解析完成（2 题）' },
    { entryIndex: 0, questions: [2, 3], ok: true, log: '第一章 组织行为学导论：任务点 2 解析完成（2 题）' },
    { entryIndex: 1, questions: [4, 5], ok: true, log: '第二章 群体行为基础：任务点 1 解析完成（2 题）' },
    { entryIndex: 1, questions: [], ok: false, log: '第二章 群体行为基础：任务点 2 请求超时（20000ms），已重试 2 次' }
  ];

  // demo 模式「提取当前页」示例数据（与批量结果互相独立）。
  var DEMO_EXTRACT_ADAPTER = 'timu';
  var DEMO_EXTRACT_WARNINGS = ['当前页面为旧版答题页，选项缺少 A–D 标号，已按顺序补齐'];
  var DEMO_EXTRACT_QUESTIONS = [
    {
      id: 'demo-extract-0001',
      knowledgeId: 'demo-k-002',
      chapterTitle: '第二章 群体行为基础',
      workId: 'demo-w-003',
      type: 'single',
      typeLabel: '单选题',
      stem: '群体凝聚力越高，群体绩效一定越好。（　）',
      options: [
        { letter: 'A', text: '正确' },
        { letter: 'B', text: '错误' }
      ],
      myAnswer: 'B',
      correctAnswer: 'B',
      analysis: '凝聚力与绩效的关系受绩效规范影响，高凝聚力也可能带来低绩效。',
      knowledgePoint: '群体凝聚力',
      images: [],
      sourceUrl: 'https://mooc1.chaoxing.com/mooc-ans/work/view?workId=demo-w-003&questionId=demo-extract-0001',
      adapter: 'timu',
      warnings: [],
      answered: true,
      reviewed: false,
      hash: 'demo-extract-hash-0001'
    },
    {
      id: 'demo-extract-0002',
      knowledgeId: 'demo-k-002',
      chapterTitle: '第二章 群体行为基础',
      workId: 'demo-w-003',
      type: 'judge',
      typeLabel: '判断题',
      stem: '群体中的从众行为只可能带来消极结果。',
      options: [],
      myAnswer: '',
      correctAnswer: '',
      analysis: '',
      knowledgePoint: '从众行为',
      images: [],
      sourceUrl: 'https://mooc1.chaoxing.com/mooc-ans/work/view?workId=demo-w-003&questionId=demo-extract-0002',
      adapter: 'timu',
      warnings: DEMO_EXTRACT_WARNINGS,
      answered: false,
      reviewed: false,
      hash: 'demo-extract-hash-0002'
    },
    {
      id: 'demo-extract-0003',
      knowledgeId: 'demo-k-002',
      chapterTitle: '第二章 群体行为基础',
      workId: 'demo-w-003',
      type: 'multiple',
      typeLabel: '多选题',
      stem: '影响群体凝聚力的因素包括（　）。',
      options: [
        { letter: 'A', text: '群体目标的吸引力' },
        { letter: 'B', text: '成员之间的相似性' },
        { letter: 'C', text: '外部竞争压力' },
        { letter: 'D', text: '群体规模' }
      ],
      myAnswer: 'ABC',
      correctAnswer: 'ABC',
      analysis: '',
      knowledgePoint: '群体凝聚力',
      images: [],
      sourceUrl: 'https://mooc1.chaoxing.com/mooc-ans/work/view?workId=demo-w-003&questionId=demo-extract-0003',
      adapter: 'timu',
      warnings: [],
      answered: true,
      reviewed: false,
      hash: 'demo-extract-hash-0003'
    }
  ];

  /* ================================================================
   * 应用状态与 DOM 引用
   * ================================================================ */

  var app = {
    demo: false,
    demoRunning: false,
    demoStep: 0,
    demoTimer: null,
    tabId: null,
    connected: false,
    connecting: false,
    linkLost: false,
    hasCatalog: false,
    course: null,
    state: null,
    entries: [],
    questions: [],
    tasks: [],
    // 单页提取（XXT_EXTRACT_CURRENT）使用独立数据集，避免与批量结果混淆。
    bulkQuestions: [],
    bulkTasks: [],
    extractMode: false,
    extractAdapter: '',
    extractWarnings: [],
    selected: {},
    settings: normalizeSettings(DEFAULT_SETTINGS),
    busyAction: null,
    filters: { chapter: '', type: '', answered: '', search: '' },
    page: 1,
    pollTimer: null,
    polling: false,
    pollFailures: 0,
    lastStartAt: 0,
    lastFetchDoneAt: 0,
    resultsFetching: false,
    logsSig: null,
    entriesSig: null,
    logsPinnedOnce: false,
    searchTimer: null
  };

  var refs = {};

  /* ================================================================
   * 通用工具
   * ================================================================ */

  function $(id) {
    return document.getElementById(id);
  }

  function pad2(value) {
    return value < 10 ? '0' + value : String(value);
  }

  function nowTime() {
    var date = new Date();
    return pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds());
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function setText(node, value) {
    if (node && node.textContent !== String(value)) {
      node.textContent = String(value);
    }
  }

  function setDisabled(node, disabled) {
    if (node) {
      node.disabled = !!disabled;
    }
  }

  function numberOr(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : (isFinite(fallback) ? fallback : 0);
  }

  function normalizeSettings(input) {
    var source = input || {};

    function readNumber(value, fallback) {
      var number = Number(value);
      return isFinite(number) ? number : fallback;
    }

    function readInteger(value, fallback, min, max) {
      var number = Math.round(readNumber(value, fallback));
      if (number < min) {
        number = min;
      }
      if (number > max) {
        number = max;
      }
      return number;
    }

    var settings = {
      minDelay: readInteger(source.minDelay, DEFAULT_SETTINGS.minDelay, 0, 60000),
      maxDelay: readInteger(source.maxDelay, DEFAULT_SETTINGS.maxDelay, 0, 60000),
      timeout: readInteger(source.timeout, DEFAULT_SETTINGS.timeout, 1000, 120000),
      retries: readInteger(source.retries, DEFAULT_SETTINGS.retries, 0, 10),
      maxCards: readInteger(source.maxCards, DEFAULT_SETTINGS.maxCards, 1, 500)
    };
    if (settings.minDelay > settings.maxDelay) {
      settings.maxDelay = settings.minDelay;
    }
    return settings;
  }

  function errorText(response) {
    if (!response) {
      return '未知错误';
    }
    if (response.error) {
      return String(response.error);
    }
    if (response.timeout) {
      return '请求超时';
    }
    return '未知错误';
  }

  function typeLabel(type) {
    return TYPE_LABELS[type] || '未知题型';
  }

  function statusLabel(status) {
    switch (status) {
      case 'pending':
        return '待处理';
      case 'running':
        return '采集中';
      case 'done':
        return '完成';
      case 'failed':
        return '失败';
      case 'no-task':
        return '无任务';
      default:
        return status || '待处理';
    }
  }

  function statusBadgeClass(status) {
    switch (status) {
      case 'running':
        return 'badge-running';
      case 'done':
        return 'badge-done';
      case 'failed':
        return 'badge-failed';
      case 'no-task':
        return 'badge-notask';
      default:
        return 'badge-pending';
    }
  }

  function countTasks(entries) {
    return (entries || []).reduce(function (total, entry) {
      return total + (Number(entry.taskCount) || 0);
    }, 0);
  }

  function mergeCourse(base, patch) {
    var merged = {};
    var sourceBase = base || {};
    var sourcePatch = patch || {};
    Object.keys(sourceBase).forEach(function (key) {
      merged[key] = sourceBase[key];
    });
    Object.keys(sourcePatch).forEach(function (key) {
      var value = sourcePatch[key];
      if (value !== undefined && value !== null && value !== '') {
        merged[key] = value;
      }
    });
    return merged;
  }

  function courseTitle() {
    if (app.course && app.course.title) {
      return String(app.course.title);
    }
    return app.demo ? DEMO_COURSE.title : '未命名课程';
  }

  function isDemoMode() {
    try {
      return new URLSearchParams(global.location.search).get('demo') === '1';
    } catch (error) {
      return /[?&]demo=1(?:&|$)/.test(global.location.search || '');
    }
  }

  /* ================================================================
   * 浏览器能力检测
   * ================================================================ */

  function hasRuntime() {
    try {
      return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
    } catch (error) {
      return false;
    }
  }

  function hasTabs() {
    try {
      return typeof chrome !== 'undefined' && !!chrome.tabs && typeof chrome.tabs.sendMessage === 'function';
    } catch (error) {
      return false;
    }
  }

  function hasStorage() {
    try {
      return typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;
    } catch (error) {
      return false;
    }
  }

  /* ================================================================
   * 消息通信（协议见 docs/INTERFACE.md 第 3 节）
   * ================================================================ */

  function sendToBackground(message, callback, timeoutMs) {
    var finished = false;
    var timer = null;

    function finish(response) {
      if (finished) {
        return;
      }
      finished = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      callback(response);
    }

    if (!hasRuntime()) {
      finish({ ok: false, error: '扩展 API 不可用，请通过扩展页面打开本页' });
      return;
    }
    timer = setTimeout(function () {
      finish({ ok: false, error: '请求后台超时' });
    }, timeoutMs || 15000);
    try {
      chrome.runtime.sendMessage(message, function (response) {
        var lastError = chrome.runtime.lastError;
        if (lastError) {
          finish({ ok: false, error: lastError.message || '后台没有响应' });
          return;
        }
        finish(response || { ok: false, error: '后台返回空响应' });
      });
    } catch (error) {
      finish({ ok: false, error: error && error.message ? error.message : String(error) });
    }
  }

  function sendToTab(message, callback, timeoutMs) {
    var finished = false;
    var timer = null;

    function finish(response) {
      if (finished) {
        return;
      }
      finished = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      callback(response);
    }

    if (app.demo) {
      finish({ ok: false, error: 'demo 模式不会发送真实消息' });
      return;
    }
    if (!app.tabId) {
      finish({ ok: false, error: '未连接学习通标签页' });
      return;
    }
    if (!hasTabs()) {
      finish({ ok: false, error: '扩展 tabs API 不可用' });
      return;
    }
    timer = setTimeout(function () {
      finish({ ok: false, error: '请求超时', timeout: true });
    }, timeoutMs || 15000);
    try {
      chrome.tabs.sendMessage(app.tabId, message, function (response) {
        var lastError = chrome.runtime && chrome.runtime.lastError;
        if (lastError) {
          finish({ ok: false, error: lastError.message || '与页面通信失败' });
          return;
        }
        finish(response || { ok: false, error: '页面返回空响应' });
      });
    } catch (error) {
      finish({ ok: false, error: error && error.message ? error.message : String(error) });
    }
  }

  /* ================================================================
   * Toast / 横幅 / 连接状态
   * ================================================================ */

  function toast(message, level) {
    var container = refs.toastContainer;
    if (!container) {
      return;
    }
    while (container.children.length >= 5) {
      container.removeChild(container.firstChild);
    }
    var item = document.createElement('div');
    item.className = 'toast toast-' + (level || 'info');
    item.setAttribute('role', 'status');
    item.textContent = message;
    container.appendChild(item);
    setTimeout(function () {
      item.classList.add('toast-hide');
      setTimeout(function () {
        if (item.parentNode) {
          item.parentNode.removeChild(item);
        }
      }, 220);
    }, 4200);
  }

  function showBanner(message, level) {
    if (!refs.alertBanner) {
      return;
    }
    refs.alertBanner.textContent = message;
    refs.alertBanner.className = 'banner banner-' + (level || 'error');
    refs.alertBanner.hidden = false;
  }

  function clearBanner() {
    if (!refs.alertBanner) {
      return;
    }
    refs.alertBanner.hidden = true;
    refs.alertBanner.textContent = '';
  }

  function setConnection(kind, label) {
    if (!refs.connPill) {
      return;
    }
    refs.connPill.className = 'pill pill-' + kind;
    refs.connPill.textContent = label;
  }

  function setButtonBusy(button, busy, busyText) {
    if (!button) {
      return;
    }
    if (busy) {
      if (!button.hasAttribute('data-orig-text')) {
        button.setAttribute('data-orig-text', button.textContent);
      }
      button.textContent = busyText || '处理中…';
      button.classList.add('is-loading');
      button.disabled = true;
    } else {
      if (button.hasAttribute('data-orig-text')) {
        button.textContent = button.getAttribute('data-orig-text');
        button.removeAttribute('data-orig-text');
      }
      button.classList.remove('is-loading');
      button.disabled = false;
    }
  }

  function showEmptyState(title, hint) {
    setText(refs.emptyTitle, title);
    setText(refs.emptyHint, hint);
    setSectionsVisible();
  }

  function setSectionsVisible() {
    var showSections = app.demo || app.connected;
    SECTIONS.forEach(function (id) {
      var node = refs[id];
      if (node) {
        node.hidden = !showSections;
      }
    });
    if (refs.emptyState) {
      refs.emptyState.hidden = showSections;
    }
  }

  /* ================================================================
   * 状态机：STATE 的最小骨架
   * ================================================================ */

  function ensureState() {
    if (!app.state || typeof app.state !== 'object') {
      app.state = {
        status: app.demo ? 'done' : 'idle',
        course: app.course || null,
        entries: app.entries || [],
        progress: { entryIndex: 0, entryTotal: app.entries.length, tasksDone: 0, tasksFailed: 0, questions: 0 },
        stats: { chapters: app.entries.length, tasks: countTasks(app.entries), questions: 0, failedTasks: 0, duplicateQuestions: 0 },
        logs: [],
        lastError: null,
        pausedReason: null,
        options: app.settings
      };
    }
    if (!Array.isArray(app.state.logs)) {
      app.state.logs = [];
    }
    return app.state;
  }

  function addLog(level, message) {
    var state = ensureState();
    state.logs.push({ time: nowTime(), level: level || 'info', message: message || '' });
    if (state.logs.length > MAX_LOG_ROWS) {
      state.logs.splice(0, state.logs.length - MAX_LOG_ROWS);
    }
    app.logsSig = null;
  }

  /* ================================================================
   * 连接流程
   * ================================================================ */

  function connect() {
    if (app.demo) {
      initDemo();
      return;
    }
    if (app.connecting) {
      return;
    }
    stopPolling();
    app.connected = false;
    app.connecting = true;
    app.linkLost = false;
    app.tabId = null;
    app.busyAction = null;
    app.resultsFetching = false;
    clearBanner();
    setConnection('connecting', '连接中…');
    showEmptyState('正在连接学习通页面…', '正在查找当前课程标签页，请保持学习通课程章节页处于打开状态。');
    renderRunButtons();

    if (!hasRuntime()) {
      app.connecting = false;
      setDisconnected('当前页面不是扩展环境，无法连接学习通。可打开 dashboard.html?demo=1 预览界面。');
      return;
    }

    sendToBackground({ type: 'XXT_GET_TARGET' }, function (response) {
      if (!response || !response.ok || !response.tabId) {
        app.connecting = false;
        setDisconnected(
          '没有找到学习通课程标签页。请先打开学习通课程章节页，再点击「重新连接」。' +
          (response && response.error ? '（' + response.error + '）' : '')
        );
        return;
      }
      app.tabId = response.tabId;
      sendToTab({ type: 'XXT_PING' }, function (ping) {
        app.connecting = false;
        if (!ping || !ping.ok) {
          setDisconnected(
            '已找到标签页，但页面内容脚本未响应。请刷新学习通页面（必要时重新加载扩展）后点击「重新连接」。' +
            (ping && ping.error ? '（' + ping.error + '）' : '')
          );
          return;
        }
        app.connected = true;
        app.linkLost = false;
        if (ping.context && (ping.context.title || ping.context.courseId)) {
          app.course = mergeCourse(app.course, ping.context);
        }
        app.hasCatalog = !!ping.hasCatalog;
        setConnection('ok', '已连接');
        renderAll();
        renderResults();
        if (!app.hasCatalog) {
          showBanner('页面已连接，但未检测到课程目录。请进入具体课程的章节页后再扫描目录。', 'warn');
        } else {
          clearBanner();
        }
        toast('已连接学习通页面', 'ok');
        requestStateOnce();
      }, 12000);
    }, 15000);
  }

  function setDisconnected(message) {
    app.connected = false;
    app.connecting = false;
    app.linkLost = false;
    setConnection('idle', '未连接');
    showEmptyState('请先打开学习通课程章节页', message || '打开学习通课程的章节页面后，回到本页点击「重新连接」。');
    renderRunButtons();
  }

  function requestStateOnce() {
    if (app.demo) {
      return;
    }
    sendToTab({ type: 'XXT_GET_STATE' }, function (response) {
      if (app.demo || !response || !response.ok || !response.state) {
        return;
      }
      applyState(response.state, { restore: true });
    }, 8000);
  }

  function applyState(state, options) {
    var opts = options || {};
    if (!state || typeof state !== 'object') {
      return;
    }
    var previousStatus = app.state ? app.state.status : null;
    app.state = state;
    if (state.course && (state.course.title || state.course.courseId)) {
      app.course = mergeCourse(app.course, state.course);
    }
    if (Array.isArray(state.entries) && state.entries.length) {
      app.entries = state.entries;
      app.entriesSig = null;
    }
    renderAll();

    var status = state.status;
    if (status === 'done') {
      stopPolling();
      if (Date.now() - (app.lastFetchDoneAt || 0) > 1500) {
        fetchAllResults();
      }
    } else if (status === 'error') {
      stopPolling();
      showBanner('采集出错：' + (state.lastError || '未知错误'), 'error');
      setTimeout(function () {
        fetchAllResults({ silent: true });
      }, 400);
    } else if (status === 'paused') {
      showBanner(
        state.pausedReason
          ? (PAUSED_REASON_TEXT[state.pausedReason] || '采集已暂停，可点击「继续」恢复。')
          : '采集已暂停，可点击「继续」恢复采集。',
        'warn'
      );
      if (previousStatus !== 'paused' || opts.restore) {
        fetchAllResults({ silent: true });
      }
      ensurePolling();
    } else if (status === 'running' || status === 'scanning' || status === 'stopping') {
      clearBanner();
      ensurePolling();
    } else if (status === 'ready' || status === 'idle') {
      // 刚下发启动指令时状态可能短暂停留在 ready，留 2.5s 宽限期避免误停轮询。
      if (app.polling && Date.now() - app.lastStartAt > 2500) {
        stopPolling();
      }
    }
  }

  /* ================================================================
   * 轮询 XXT_GET_STATE（运行/暂停期间每 800ms）
   * ================================================================ */

  function startPolling(immediate) {
    stopPolling();
    app.polling = true;
    app.pollFailures = 0;
    app.pollTimer = setTimeout(pollOnce, immediate ? 300 : POLL_INTERVAL);
  }

  function ensurePolling() {
    if (!app.polling && !app.demo) {
      startPolling(false);
    }
  }

  function schedulePoll() {
    if (!app.polling) {
      return;
    }
    if (app.pollTimer) {
      clearTimeout(app.pollTimer);
    }
    app.pollTimer = setTimeout(pollOnce, POLL_INTERVAL);
  }

  function stopPolling() {
    app.polling = false;
    if (app.pollTimer) {
      clearTimeout(app.pollTimer);
      app.pollTimer = null;
    }
  }

  function pollOnce() {
    app.pollTimer = null;
    if (!app.polling || app.demo) {
      return;
    }
    sendToTab({ type: 'XXT_GET_STATE' }, function (response) {
      if (!app.polling) {
        return;
      }
      if (!response || !response.ok || !response.state) {
        app.pollFailures += 1;
        if (app.pollFailures >= POLL_MAX_FAILURES) {
          handleConnectionLost('与页面的连接断开，请刷新学习通页面后重新连接。');
          return;
        }
        schedulePoll();
        return;
      }
      app.pollFailures = 0;
      applyState(response.state);
      if (app.polling) {
        schedulePoll();
      }
    }, POLL_TIMEOUT_MS);
  }

  function handleConnectionLost(message) {
    stopPolling();
    app.linkLost = true;
    setConnection('error', '连接断开');
    showBanner(message, 'error');
    toast(message, 'error');
    renderRunButtons();
  }

  /* ================================================================
   * 目录扫描
   * ================================================================ */

  function requireConnection() {
    if (app.demo) {
      return true;
    }
    if (!app.connected || app.linkLost) {
      toast('尚未连接学习通页面，请先点击「重新连接」', 'error');
      return false;
    }
    return true;
  }

  function scanCatalog() {
    if (app.demo) {
      demoScan();
      return;
    }
    if (!requireConnection() || app.busyAction) {
      return;
    }
    app.busyAction = 'scan';
    setButtonBusy(refs.btnScan, true, '扫描中…');
    renderRunButtons();
    sendToTab({ type: 'XXT_SCAN' }, function (response) {
      app.busyAction = null;
      setButtonBusy(refs.btnScan, false);
      if (!response || !response.ok) {
        renderRunButtons();
        showBanner('扫描课程目录失败：' + errorText(response), 'error');
        toast('扫描失败：' + errorText(response), 'error');
        return;
      }
      if (response.course) {
        app.course = mergeCourse(app.course, response.course);
      }
      var entries = Array.isArray(response.entries) ? response.entries.slice() : [];
      entries.sort(function (a, b) {
        return (Number(a.index) || 0) - (Number(b.index) || 0);
      });
      app.entries = entries;
      app.selected = {};
      app.entriesSig = null;
      var state = ensureState();
      state.status = 'ready';
      state.course = app.course;
      state.entries = app.entries;
      state.progress = { entryIndex: 0, entryTotal: entries.length, tasksDone: 0, tasksFailed: 0, questions: 0 };
      state.stats = {
        chapters: entries.length,
        tasks: countTasks(entries),
        questions: 0,
        failedTasks: 0,
        duplicateQuestions: 0
      };
      state.lastError = null;
      state.pausedReason = null;
      app.logsSig = null;
      addLog('ok', '目录扫描完成：' + entries.length + ' 个章节，' + countTasks(entries) + ' 个任务点');
      clearBanner();
      renderAll();
      toast('扫描完成：' + entries.length + ' 个章节', 'ok');
      if (!entries.length) {
        showBanner('未扫描到章节。请确认学习通课程目录已加载完成后重试。', 'warn');
      }
    }, 40000);
  }

  /* ================================================================
   * 开始 / 暂停 / 继续 / 停止
   * ================================================================ */

  function getSelectedEntries() {
    return app.entries.filter(function (entry) {
      return app.selected[entry.knowledgeId] !== false;
    });
  }

  function buildStartOptions() {
    var settings = app.settings;
    return {
      minDelay: settings.minDelay,
      maxDelay: settings.maxDelay,
      timeout: settings.timeout,
      retries: settings.retries,
      maxCards: settings.maxCards,
      skipAnsweredOnly: false
    };
  }

  function startCollection() {
    if (app.demo) {
      demoStart();
      return;
    }
    if (!requireConnection() || app.busyAction) {
      return;
    }
    if (!app.entries.length) {
      toast('请先扫描课程目录', 'warn');
      return;
    }
    var selectedEntries = getSelectedEntries();
    if (!selectedEntries.length) {
      toast('请至少勾选一个章节', 'warn');
      return;
    }
    app.busyAction = 'start';
    app.lastStartAt = Date.now();
    setButtonBusy(refs.btnStart, true, '启动中…');
    renderRunButtons();
    sendToTab({
      type: 'XXT_START',
      options: buildStartOptions(),
      // v0.1：dashboard 下发当前勾选的 entries；实际采集范围仍由 content 决定。
      entries: selectedEntries
    }, function (response) {
      app.busyAction = null;
      setButtonBusy(refs.btnStart, false);
      if (!response || !response.ok) {
        renderRunButtons();
        showBanner('开始采集失败：' + errorText(response), 'error');
        toast('开始采集失败：' + errorText(response), 'error');
        return;
      }
      var state = ensureState();
      state.status = 'running';
      state.course = app.course;
      state.entries = app.entries;
      state.lastError = null;
      state.pausedReason = null;
      app.questions = [];
      app.tasks = [];
      app.extractMode = false;
      app.extractAdapter = '';
      app.extractWarnings = [];
      app.bulkQuestions = [];
      app.bulkTasks = [];
      app.page = 1;
      app.logsSig = null;
      resetFilters();
      addLog('info', '已下发采集任务（jobId: ' + (response.jobId || '未知') + '）');
      clearBanner();
      renderAll();
      renderResults();
      startPolling(true);
      toast('已开始采集', 'ok');
    }, 15000);
  }

  function pauseCollection() {
    if (app.demo) {
      demoPause();
      return;
    }
    if (!requireConnection() || app.busyAction) {
      return;
    }
    app.busyAction = 'pause';
    setButtonBusy(refs.btnPause, true, '暂停中…');
    renderRunButtons();
    sendToTab({ type: 'XXT_PAUSE' }, function (response) {
      app.busyAction = null;
      setButtonBusy(refs.btnPause, false);
      if (!response || !response.ok) {
        renderRunButtons();
        toast('暂停失败：' + errorText(response), 'error');
        return;
      }
      addLog('warn', '已请求暂停采集');
      ensurePolling();
      renderRunButtons();
      toast('暂停指令已发送', 'warn');
    }, 12000);
  }

  function resumeCollection() {
    if (app.demo) {
      demoResume();
      return;
    }
    if (!requireConnection() || app.busyAction) {
      return;
    }
    app.busyAction = 'resume';
    setButtonBusy(refs.btnResume, true, '继续中…');
    renderRunButtons();
    sendToTab({ type: 'XXT_RESUME' }, function (response) {
      app.busyAction = null;
      setButtonBusy(refs.btnResume, false);
      if (!response || !response.ok) {
        renderRunButtons();
        toast('继续失败：' + errorText(response), 'error');
        return;
      }
      addLog('info', '已请求继续采集');
      clearBanner();
      startPolling(false);
      renderRunButtons();
      toast('继续指令已发送', 'ok');
    }, 12000);
  }

  function stopCollection() {
    if (app.demo) {
      demoStop();
      return;
    }
    if (!requireConnection() || app.busyAction) {
      return;
    }
    app.busyAction = 'stop';
    setButtonBusy(refs.btnStop, true, '停止中…');
    renderRunButtons();
    sendToTab({ type: 'XXT_STOP' }, function (response) {
      app.busyAction = null;
      setButtonBusy(refs.btnStop, false);
      if (!response || !response.ok) {
        renderRunButtons();
        toast('停止失败：' + errorText(response), 'error');
        return;
      }
      addLog('warn', '用户停止采集');
      stopPolling();
      var state = ensureState();
      if (state.status === 'running' || state.status === 'paused' || state.status === 'stopping') {
        state.status = 'ready';
      }
      renderAll();
      toast('已停止采集', 'warn');
      setTimeout(function () {
        fetchAllResults({ silent: true });
      }, 400);
    }, 15000);
  }

  /* ================================================================
   * 单页提取（XXT_EXTRACT_CURRENT）
   * 单页结果使用独立数据集显示，不覆盖批量结果；可随时返回批量结果。
   * ================================================================ */

  function renderResultsMode() {
    if (refs.resultsMode) {
      if (app.extractMode) {
        refs.resultsMode.hidden = false;
        refs.resultsMode.textContent = '单页提取 · 适配器 ' + (app.extractAdapter || '未知');
      } else {
        refs.resultsMode.hidden = true;
        refs.resultsMode.textContent = '';
      }
    }
    if (refs.btnShowBulk) {
      refs.btnShowBulk.hidden = !app.extractMode;
    }
  }

  function showExtractedQuestions(questions, adapter, warnings) {
    if (!app.extractMode) {
      app.bulkQuestions = app.questions.slice();
      app.bulkTasks = app.tasks.slice();
    }
    app.extractMode = true;
    app.extractAdapter = adapter || '未知';
    app.extractWarnings = Array.isArray(warnings) ? warnings.slice() : [];
    app.questions = Array.isArray(questions) ? questions.slice() : [];
    app.tasks = [];
    app.page = 1;
    resetFilters();
    refreshFilters();
    renderResults();
    if (!app.questions.length) {
      setText(refs.resultsMeta, '单页提取 · 适配器 ' + app.extractAdapter + ' · 未提取到题目');
    }
    renderResultsMode();
    renderExportState();
  }

  function showBulkResults() {
    if (!app.extractMode) {
      return;
    }
    app.extractMode = false;
    app.extractAdapter = '';
    app.extractWarnings = [];
    app.questions = app.bulkQuestions || [];
    app.tasks = app.bulkTasks || [];
    app.bulkQuestions = [];
    app.bulkTasks = [];
    app.page = 1;
    refreshFilters();
    renderResults();
    renderResultsMode();
    renderExportState();
    if (!app.questions.length) {
      toast('暂无批量结果，可先扫描目录并开始采集', 'info');
    } else {
      toast('已返回批量结果（' + app.questions.length + ' 题）', 'info');
    }
  }

  function extractCurrentPage() {
    if (app.demo) {
      demoExtractCurrent();
      return;
    }
    if (!requireConnection() || app.busyAction) {
      return;
    }
    if (!app.tabId) {
      toast('尚未连接学习通标签页，请先点击「重新连接」', 'error');
      return;
    }
    app.busyAction = 'extract';
    setButtonBusy(refs.btnExtractCurrent, true, '提取中…');
    renderRunButtons();
    sendToTab({ type: 'XXT_EXTRACT_CURRENT' }, function (response) {
      app.busyAction = null;
      setButtonBusy(refs.btnExtractCurrent, false);
      if (!response || !response.ok) {
        renderRunButtons();
        showBanner('提取当前页失败：' + errorText(response), 'error');
        toast('提取当前页失败：' + errorText(response), 'error');
        return;
      }
      var questions = Array.isArray(response.questions) ? response.questions : [];
      var adapter = response.adapter || '未知';
      var warnings = Array.isArray(response.warnings) ? response.warnings : [];
      showExtractedQuestions(questions, adapter, warnings);
      addLog(
        warnings.length ? 'warn' : 'ok',
        '单页提取完成：' + questions.length + ' 题（适配器 ' + adapter + '）' +
        (warnings.length ? '；警告：' + warnings.join('；') : '')
      );
      if (warnings.length) {
        showBanner('单页提取有 ' + warnings.length + ' 条警告：' + warnings.join('；'), 'warn');
      } else {
        clearBanner();
      }
      renderAll();
      renderResultsMode();
      toast('提取 ' + questions.length + ' 题（适配器 ' + adapter + '）', questions.length ? 'ok' : 'warn');
    }, 30000);
  }

  function demoExtractCurrent() {
    if (app.busyAction) {
      return;
    }
    if (app.demoRunning || (app.state && (app.state.status === 'running' || app.state.status === 'paused'))) {
      toast('演示采集运行中，请先「停止」采集后再提取当前页', 'warn');
      return;
    }
    app.busyAction = 'extract';
    setButtonBusy(refs.btnExtractCurrent, true, '提取中…');
    renderAll();
    app.demoTimer = setTimeout(function () {
      app.demoTimer = null;
      app.busyAction = null;
      setButtonBusy(refs.btnExtractCurrent, false);
      var questions = clone(DEMO_EXTRACT_QUESTIONS);
      var warnings = clone(DEMO_EXTRACT_WARNINGS);
      showExtractedQuestions(questions, DEMO_EXTRACT_ADAPTER, warnings);
      addLog(
        'warn',
        '单页提取完成（演示）：' + questions.length + ' 题（适配器 ' + DEMO_EXTRACT_ADAPTER + '）；警告：' + warnings.join('；')
      );
      showBanner('单页提取有 ' + warnings.length + ' 条警告：' + warnings.join('；'), 'warn');
      renderAll();
      renderResultsMode();
      toast('提取 ' + questions.length + ' 题（适配器 ' + DEMO_EXTRACT_ADAPTER + '）', 'ok');
    }, 450);
  }

  /* ================================================================
   * 结果加载（分页 offset/limit=200 拉全量）
   * ================================================================ */

  function fetchAllResults(options) {
    var opts = options || {};
    if (app.demo) {
      renderResults();
      return;
    }
    if (app.resultsFetching || !app.connected || app.linkLost) {
      return;
    }
    app.resultsFetching = true;
    setText(refs.resultsMeta, '正在加载结果…');
    var all = [];
    var total = null;
    var resultCourse = null;
    var resultTasks = null;
    var loops = 0;

    function finish(response) {
      app.resultsFetching = false;
      app.lastFetchDoneAt = Date.now();
      if (response && response.ok) {
        setResults(resultCourse, all, resultTasks);
        if (!opts.silent) {
          toast('结果已加载：共 ' + all.length + ' 题', 'ok');
        }
      } else {
        setText(refs.resultsMeta, defaultResultsMeta());
        if (!opts.silent) {
          toast('加载结果失败：' + errorText(response), 'error');
        }
      }
    }

    function next() {
      loops += 1;
      if (loops > 60) {
        finish({ ok: false, error: '结果数量异常，已停止分页加载' });
        return;
      }
      sendToTab({ type: 'XXT_GET_RESULTS', offset: all.length, limit: RESULT_PAGE_LIMIT }, function (response) {
        if (!response || !response.ok) {
          finish(response);
          return;
        }
        if (response.course) {
          resultCourse = response.course;
        }
        if (Array.isArray(response.tasks)) {
          resultTasks = response.tasks;
        }
        if (typeof response.total === 'number') {
          total = response.total;
        }
        var chunk = Array.isArray(response.questions) ? response.questions : [];
        all = all.concat(chunk);
        var hasMore = total !== null ? all.length < total : chunk.length >= RESULT_PAGE_LIMIT;
        if (hasMore) {
          next();
        } else {
          finish({ ok: true });
        }
      }, 25000);
    }

    next();
  }

  function setResults(course, questions, tasks) {
    if (course && (course.title || course.courseId)) {
      app.course = mergeCourse(app.course, course);
    }
    // 批量结果回到前台：退出单页提取模式，并缓存批量数据集。
    app.extractMode = false;
    app.extractAdapter = '';
    app.extractWarnings = [];
    app.questions = Array.isArray(questions) ? questions : [];
    if (Array.isArray(tasks)) {
      app.tasks = tasks;
    }
    app.bulkQuestions = app.questions.slice();
    app.bulkTasks = app.tasks.slice();
    app.page = 1;
    refreshFilters();
    renderResults();
    renderCourse();
    renderTasks();
    renderStats();
  }

  function defaultResultsMeta() {
    if (!app.questions.length) {
      return '采集完成或暂停后自动加载结果。';
    }
    return '已加载 ' + app.questions.length + ' 题';
  }

  /* ================================================================
   * 结果筛选 / 分页 / 表格渲染
   * ================================================================ */

  function resetFilters() {
    app.filters = { chapter: '', type: '', answered: '', search: '' };
    if (refs.filterChapter) {
      refs.filterChapter.value = '';
    }
    if (refs.filterType) {
      refs.filterType.value = '';
    }
    if (refs.filterAnswered) {
      refs.filterAnswered.value = '';
    }
    if (refs.searchStem) {
      refs.searchStem.value = '';
    }
  }

  function fillFilterSelect(select, values, allLabel, selectedValue) {
    if (!select) {
      return;
    }
    select.textContent = '';
    var all = document.createElement('option');
    all.value = '';
    all.textContent = allLabel;
    select.appendChild(all);
    values.forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    select.value = values.indexOf(selectedValue) >= 0 ? selectedValue : '';
  }

  function chapterValues() {
    var seen = {};
    var values = [];
    app.questions.forEach(function (question) {
      var title = question.chapterTitle || '未分章节';
      if (!seen[title]) {
        seen[title] = true;
        values.push(title);
      }
    });
    return values;
  }

  function typeValues() {
    var map = {};
    app.questions.forEach(function (question) {
      var label = question.typeLabel || typeLabel(question.type);
      if (!map[label]) {
        map[label] = question.type || 'unknown';
      }
    });
    return Object.keys(map).sort(function (a, b) {
      return (TYPE_ORDER[map[a]] || 9) - (TYPE_ORDER[map[b]] || 9);
    });
  }

  function refreshFilters() {
    fillFilterSelect(refs.filterChapter, chapterValues(), '全部章节', app.filters.chapter);
    fillFilterSelect(refs.filterType, typeValues(), '全部题型', app.filters.type);
  }

  function isAnswered(question) {
    if (typeof question.answered === 'boolean') {
      return question.answered;
    }
    return !!String(question.correctAnswer || '').trim();
  }

  function filteredQuestions() {
    var filters = app.filters;
    var keyword = String(filters.search || '').toLowerCase();
    return app.questions.filter(function (question) {
      if (filters.chapter && (question.chapterTitle || '未分章节') !== filters.chapter) {
        return false;
      }
      if (filters.type && (question.typeLabel || typeLabel(question.type)) !== filters.type) {
        return false;
      }
      if (filters.answered === 'yes' && !isAnswered(question)) {
        return false;
      }
      if (filters.answered === 'no' && isAnswered(question)) {
        return false;
      }
      if (keyword && String(question.stem || '').toLowerCase().indexOf(keyword) === -1) {
        return false;
      }
      return true;
    });
  }

  function makeCell(value, className) {
    var cell = document.createElement('td');
    if (className) {
      cell.className = className;
    }
    cell.textContent = value == null ? '' : String(value);
    return cell;
  }

  function optionLetter(option, index) {
    if (option && option.letter) {
      return String(option.letter);
    }
    return String.fromCharCode(65 + index);
  }

  function buildResultRow(question, displayIndex) {
    var row = document.createElement('tr');

    row.appendChild(makeCell(String(displayIndex), 'col-idx'));
    row.appendChild(makeCell(question.chapterTitle || '未分章节', 'col-chapter'));

    var typeCell = document.createElement('td');
    var typeBadge = document.createElement('span');
    typeBadge.className = 'badge badge-type';
    typeBadge.textContent = question.typeLabel || typeLabel(question.type);
    typeCell.appendChild(typeBadge);
    row.appendChild(typeCell);

    var stemCell = document.createElement('td');
    stemCell.className = 'col-stem';
    stemCell.textContent = question.stem || '（无题干）';
    stemCell.title = question.stem || '';
    row.appendChild(stemCell);

    var optionsCell = document.createElement('td');
    optionsCell.className = 'col-options';
    var options = Array.isArray(question.options) ? question.options : [];
    if (options.length) {
      options.forEach(function (option, index) {
        var line = document.createElement('div');
        line.className = 'opt-line';
        line.textContent = optionLetter(option, index) + '. ' + String(option.text || '');
        optionsCell.appendChild(line);
      });
    } else {
      optionsCell.textContent = '—';
      optionsCell.classList.add('quality-empty');
    }
    row.appendChild(optionsCell);

    row.appendChild(makeCell(question.myAnswer || '—', 'col-my'));

    var answerCell = document.createElement('td');
    answerCell.className = 'col-answer';
    var answerInput = document.createElement('input');
    answerInput.type = 'text';
    answerInput.className = 'answer-input';
    answerInput.value = question.correctAnswer || '';
    answerInput.placeholder = '未填写';
    answerInput.setAttribute('data-qid', question.id);
    answerInput.setAttribute('data-original', question.correctAnswer || '');
    answerInput.setAttribute('aria-label', '正确答案（可编辑）');
    answerInput.setAttribute('title', '编辑后按回车或失焦保存（XXT_UPDATE_ANSWER）');
    answerCell.appendChild(answerInput);
    row.appendChild(answerCell);

    var sourceCell = document.createElement('td');
    sourceCell.className = 'col-source';
    if (question.sourceUrl) {
      var link = document.createElement('a');
      link.href = question.sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'source-link';
      link.textContent = '打开';
      link.title = question.sourceUrl;
      sourceCell.appendChild(link);
    } else {
      sourceCell.textContent = '—';
      sourceCell.classList.add('quality-empty');
    }
    row.appendChild(sourceCell);

    var qualityCell = document.createElement('td');
    qualityCell.className = 'col-quality';
    var adapter = document.createElement('span');
    adapter.className = 'adapter-tag';
    adapter.textContent = question.adapter || '未知';
    qualityCell.appendChild(adapter);
    (Array.isArray(question.warnings) ? question.warnings : []).forEach(function (warning) {
      var chip = document.createElement('span');
      chip.className = 'warn-chip';
      chip.textContent = '⚠ ' + warning;
      chip.title = warning;
      qualityCell.appendChild(chip);
    });
    row.appendChild(qualityCell);

    return row;
  }

  function renderResults() {
    if (!refs.resultsTbody) {
      return;
    }
    var filtered = filteredQuestions();
    var totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (app.page > totalPages) {
      app.page = totalPages;
    }
    if (app.page < 1) {
      app.page = 1;
    }
    var start = (app.page - 1) * PAGE_SIZE;
    var pageItems = filtered.slice(start, start + PAGE_SIZE);

    refs.resultsTbody.textContent = '';
    var fragment = document.createDocumentFragment();
    pageItems.forEach(function (question, index) {
      fragment.appendChild(buildResultRow(question, start + index + 1));
    });
    refs.resultsTbody.appendChild(fragment);

    var hasQuestions = app.questions.length > 0;
    setText(
      refs.resultsCount,
      app.questions.length + ' 题' + (filtered.length !== app.questions.length ? ' · 筛选 ' + filtered.length : '')
    );
    setText(refs.pageInfo, '第 ' + app.page + ' / ' + totalPages + ' 页');
    setDisabled(refs.pagePrev, app.page <= 1);
    setDisabled(refs.pageNext, app.page >= totalPages);
    if (refs.pager) {
      refs.pager.hidden = !hasQuestions;
    }
    if (refs.tableWrap) {
      refs.tableWrap.hidden = !hasQuestions || !filtered.length;
    }
    if (refs.resultsEmpty) {
      if (!hasQuestions) {
        refs.resultsEmpty.hidden = false;
        refs.resultsEmpty.textContent = app.extractMode
          ? '当前页面未提取到题目。请确认学习通页面处于题目详情/作答页后点击「提取当前页」重试。'
          : '暂无题目结果。完成采集后会自动加载；在地址后加 ?demo=1 可预览示例数据。';
      } else if (!filtered.length) {
        refs.resultsEmpty.hidden = false;
        refs.resultsEmpty.textContent = '当前筛选条件下没有题目，请调整筛选或搜索关键字。';
      } else {
        refs.resultsEmpty.hidden = true;
      }
    }
    if (app.questions.length) {
      if (app.extractMode) {
        setText(
          refs.resultsMeta,
          '单页提取 · 适配器 ' + (app.extractAdapter || '未知') +
          ' · 已加载 ' + app.questions.length + ' 题' +
          (app.extractWarnings.length ? ' · ' + app.extractWarnings.length + ' 条警告' : '') +
          (app.demo ? '（演示）' : '')
        );
      } else {
        setText(refs.resultsMeta, (app.demo ? '演示数据 · ' : '') + '已加载 ' + app.questions.length + ' 题');
      }
    }
    renderResultsMode();
    renderExportState();
  }

  function findQuestion(questionId) {
    for (var index = 0; index < app.questions.length; index += 1) {
      if (app.questions[index].id === questionId) {
        return app.questions[index];
      }
    }
    return null;
  }

  function commitAnswerInput(input) {
    if (!input || input.disabled) {
      return;
    }
    var questionId = input.getAttribute('data-qid');
    var question = findQuestion(questionId);
    if (!question) {
      return;
    }
    var original = input.getAttribute('data-original') || '';
    var value = String(input.value || '').trim();
    if (value === original.trim()) {
      return;
    }
    if (app.demo) {
      question.correctAnswer = value;
      question.answered = !!value;
      input.setAttribute('data-original', value);
      input.classList.remove('is-error');
      toast('演示模式：答案已更新到本地示例数据（不会发送消息）', 'info');
      renderResults();
      return;
    }
    if (!app.connected || app.linkLost) {
      input.value = original;
      toast('当前未连接学习通页面，无法保存答案', 'error');
      return;
    }
    input.disabled = true;
    input.classList.add('is-saving');
    sendToTab({ type: 'XXT_UPDATE_ANSWER', questionId: questionId, correctAnswer: value }, function (response) {
      input.disabled = false;
      input.classList.remove('is-saving');
      if (response && response.ok) {
        question.correctAnswer = value;
        question.answered = !!value;
        input.setAttribute('data-original', value);
        input.classList.remove('is-error');
        toast('答案已保存', 'ok');
        renderResults();
      } else {
        input.value = original;
        input.classList.add('is-error');
        toast('保存答案失败：' + errorText(response), 'error');
      }
    }, 12000);
  }

  /* ================================================================
   * 渲染：连接 / 目录 / 进度 / 统计 / 日志 / 任务
   * ================================================================ */

  function renderAll() {
    setSectionsVisible();
    renderConnection();
    renderCourse();
    renderEntries();
    renderRunButtons();
    renderProgress();
    renderStats();
    renderLogs();
    renderTasks();
    updateScanHint();
    renderExportState();
  }

  function renderConnection() {
    if (app.demo) {
      setConnection('info', '演示模式');
      return;
    }
    if (app.linkLost) {
      setConnection('error', '连接断开');
    } else if (app.connected) {
      setConnection('ok', '已连接');
    } else if (app.connecting) {
      setConnection('connecting', '连接中…');
    } else {
      setConnection('idle', '未连接');
    }
  }

  function renderCourse() {
    var title = courseTitle();
    setText(refs.courseName, title);
    if (refs.courseName) {
      refs.courseName.title = (app.course && app.course.url) ? app.course.url : title;
    }
  }

  function updateScanHint() {
    if (!refs.scanHint) {
      return;
    }
    var status = app.state && app.state.status;
    if (status === 'scanning') {
      refs.scanHint.textContent = '正在扫描课程目录（约需 2–5 秒）…';
      return;
    }
    if (!app.entries.length) {
      refs.scanHint.textContent = '尚未扫描目录。点击「扫描课程目录」获取章节列表；v0.1 会按勾选章节下发，实际范围由 content 决定。';
      return;
    }
    var selected = getSelectedEntries().length;
    refs.scanHint.textContent =
      '共 ' + app.entries.length + ' 个章节 · 已勾选 ' + selected + ' 个 · 任务点 ' + countTasks(app.entries) + ' 个';
  }

  function renderEntries() {
    var list = refs.entriesList;
    if (!list) {
      return;
    }
    var signature = JSON.stringify(app.entries.map(function (entry) {
      return [
        entry.knowledgeId,
        entry.title,
        entry.index,
        entry.taskCount,
        entry.doneTasks,
        entry.status,
        app.selected[entry.knowledgeId] !== false
      ];
    }));
    if (signature === app.entriesSig) {
      updateScanHint();
      return;
    }
    app.entriesSig = signature;
    list.textContent = '';

    if (!app.entries.length) {
      var placeholder = document.createElement('div');
      placeholder.className = 'entries-empty';
      placeholder.textContent = '尚未扫描目录。点击「扫描课程目录」获取章节列表（约需 2–5 秒）。';
      list.appendChild(placeholder);
      updateScanHint();
      return;
    }

    app.entries.forEach(function (entry, position) {
      var row = document.createElement('div');
      row.className = 'entry-row';

      var checkLabel = document.createElement('label');
      checkLabel.className = 'entry-check';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = app.selected[entry.knowledgeId] !== false;
      checkbox.setAttribute('data-kid', entry.knowledgeId);
      checkbox.setAttribute('aria-label', '选择章节：' + (entry.title || entry.knowledgeId || '未命名章节'));
      checkLabel.appendChild(checkbox);
      row.appendChild(checkLabel);

      var indexNode = document.createElement('span');
      indexNode.className = 'entry-index';
      indexNode.textContent = String(entry.index != null ? entry.index : position + 1);
      row.appendChild(indexNode);

      var main = document.createElement('div');
      main.className = 'entry-main';
      var title = document.createElement('span');
      title.className = 'entry-title';
      title.textContent = entry.title || entry.knowledgeId || '未命名章节';
      title.title = title.textContent;
      var sub = document.createElement('span');
      sub.className = 'entry-sub';
      sub.textContent =
        '任务 ' + (Number(entry.doneTasks) || 0) + '/' + (Number(entry.taskCount) || 0) +
        ' · ' + (entry.knowledgeId || '—');
      main.appendChild(title);
      main.appendChild(sub);
      row.appendChild(main);

      var status = entry.status || 'pending';
      var badge = document.createElement('span');
      badge.className = 'badge ' + statusBadgeClass(status);
      badge.textContent = statusLabel(status);
      row.appendChild(badge);

      list.appendChild(row);
    });
    updateScanHint();
  }

  function renderRunButtons() {
    var status = (app.state && app.state.status) || (app.demo ? 'done' : 'idle');
    var link = app.demo || (app.connected && !app.linkLost);
    var idleAction = !app.busyAction;
    var hasEntries = app.entries.length > 0;
    var selected = getSelectedEntries().length;

    var canStart = link && idleAction && hasEntries && selected > 0 &&
      (status === 'idle' || status === 'ready' || status === 'done' || status === 'error');
    setDisabled(refs.btnStart, !canStart);
    setDisabled(refs.btnPause, !(link && idleAction && status === 'running'));
    setDisabled(refs.btnResume, !(link && idleAction && status === 'paused'));
    setDisabled(refs.btnStop, !(link && idleAction && (status === 'running' || status === 'paused' || status === 'stopping')));
    setDisabled(refs.btnScan, !(link && idleAction && status !== 'running' && status !== 'paused' && status !== 'stopping' && status !== 'scanning'));
    setDisabled(refs.btnSelectAll, !hasEntries);
    setDisabled(refs.btnSelectNone, !hasEntries);
    setDisabled(refs.btnSnapshot, !(link && idleAction));
    setDisabled(refs.btnExtractCurrent, !(link && idleAction));

    if (refs.btnStart && !refs.btnStart.classList.contains('is-loading')) {
      refs.btnStart.textContent = selected > 0 ? '开始采集（' + selected + ' 章）' : '开始采集';
    }
  }

  function renderProgress() {
    var state = app.state || {};
    var progress = state.progress || {};
    var entries = app.entries || [];
    var entryTotal = numberOr(progress.entryTotal, entries.length);
    var entryIndex = numberOr(progress.entryIndex, 0);
    if (entryIndex > entryTotal) {
      entryIndex = entryTotal;
    }
    var taskTotal = countTasks(entries);
    var tasksDone = numberOr(progress.tasksDone, 0);
    var tasksFailed = numberOr(progress.tasksFailed, 0);
    var processed = tasksDone + tasksFailed;
    var entryPercent = entryTotal > 0 ? Math.min(100, Math.round((entryIndex / entryTotal) * 100)) : 0;
    var taskPercent = taskTotal > 0
      ? Math.min(100, Math.round((processed / taskTotal) * 100))
      : (numberOr(progress.questions, 0) > 0 ? 100 : 0);

    if (refs.progressEntryBar) {
      refs.progressEntryBar.style.width = entryPercent + '%';
    }
    if (refs.progressTaskBar) {
      refs.progressTaskBar.style.width = taskPercent + '%';
    }
    setText(refs.progressEntryText, entryIndex + ' / ' + entryTotal);
    setText(
      refs.progressTaskText,
      processed + ' / ' + taskTotal + (tasksFailed ? '（失败 ' + tasksFailed + '）' : '')
    );
  }

  function renderStats() {
    var state = app.state || {};
    var stats = state.stats || {};
    var progress = state.progress || {};
    var entries = app.entries || [];
    setText(refs.statChapters, numberOr(stats.chapters, entries.length));
    setText(refs.statTasks, numberOr(stats.tasks, countTasks(entries)));
    setText(refs.statQuestions, numberOr(stats.questions, numberOr(progress.questions, app.questions.length)));
    setText(refs.statFailed, numberOr(stats.failedTasks, numberOr(progress.tasksFailed, 0)));
  }

  function renderLogs() {
    var list = refs.logList;
    if (!list) {
      return;
    }
    var logs = (app.state && Array.isArray(app.state.logs)) ? app.state.logs : [];
    var visible = logs.length > MAX_LOG_ROWS ? logs.slice(logs.length - MAX_LOG_ROWS) : logs;
    var signature = visible.length + '|' +
      (visible.length
        ? (visible[0].time + '|' + visible[visible.length - 1].message)
        : '');
    if (signature === app.logsSig) {
      return;
    }
    app.logsSig = signature;

    var nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    var fragment = document.createDocumentFragment();
    if (!visible.length) {
      var empty = document.createElement('div');
      empty.className = 'log-empty';
      empty.textContent = '暂无日志。扫描目录或开始采集后会显示运行日志。';
      fragment.appendChild(empty);
    }
    visible.forEach(function (entry) {
      var level = entry.level || 'info';
      var row = document.createElement('div');
      row.className = 'log-row log-' + level;
      var time = document.createElement('span');
      time.className = 'log-time';
      time.textContent = entry.time || '';
      var badge = document.createElement('span');
      badge.className = 'log-level';
      badge.textContent = String(level).toUpperCase();
      var message = document.createElement('span');
      message.className = 'log-msg';
      message.textContent = entry.message || '';
      row.appendChild(time);
      row.appendChild(badge);
      row.appendChild(message);
      fragment.appendChild(row);
    });
    list.textContent = '';
    list.appendChild(fragment);

    var shouldStick = nearBottom || !app.logsPinnedOnce;
    app.logsPinnedOnce = true;
    if (shouldStick) {
      list.scrollTop = list.scrollHeight;
    }
    setText(refs.logsMeta, '显示最近 ' + visible.length + ' 条（上限 ' + MAX_LOG_ROWS + ' 条，自动滚动）。');
  }

  function renderTasks() {
    var list = refs.taskList;
    if (!list) {
      return;
    }
    list.textContent = '';
    var entries = app.entries || [];
    if (!entries.length) {
      var empty = document.createElement('div');
      empty.className = 'task-empty';
      empty.textContent = '扫描目录后显示章节任务状态。';
      list.appendChild(empty);
      return;
    }
    var failedTasks = (app.tasks || []).filter(function (task) {
      return task && task.status === 'failed';
    });
    entries.forEach(function (entry) {
      var row = document.createElement('div');
      row.className = 'task-row';

      var head = document.createElement('div');
      head.className = 'task-head';
      var title = document.createElement('span');
      title.className = 'task-title';
      title.textContent = entry.title || entry.knowledgeId || '未命名章节';
      title.title = title.textContent;
      var status = entry.status || 'pending';
      var badge = document.createElement('span');
      badge.className = 'badge ' + statusBadgeClass(status);
      badge.textContent = statusLabel(status);
      head.appendChild(title);
      head.appendChild(badge);
      row.appendChild(head);

      var meta = document.createElement('div');
      meta.className = 'task-meta';
      meta.textContent =
        '任务 ' + (Number(entry.doneTasks) || 0) + ' / ' + (Number(entry.taskCount) || 0) +
        (entry.knowledgeId ? ' · ' + entry.knowledgeId : '');
      row.appendChild(meta);

      var failure = null;
      for (var index = 0; index < failedTasks.length; index += 1) {
        if (failedTasks[index].knowledgeId === entry.knowledgeId) {
          failure = failedTasks[index];
          break;
        }
      }
      if (failure) {
        var error = document.createElement('div');
        error.className = 'task-error';
        error.textContent = '失败原因：' + (failure.error || '未知错误') +
          (failure.sourceUrl ? ' · ' + failure.sourceUrl : '');
        row.appendChild(error);
      }
      list.appendChild(row);
    });
    setText(refs.tasksMeta, '共 ' + entries.length + ' 个章节 · 失败任务 ' +
      (Number((app.state && app.state.stats && app.state.stats.failedTasks)) || 0) + ' 个');
  }

  function renderExportState() {
    var disabled = !app.questions.length;
    (refs.exportButtons || []).forEach(function (button) {
      button.disabled = disabled;
    });
  }

  /* ================================================================
   * 导出（Markdown / JSON / CSV / 打印）与页面存档
   * ================================================================ */

  function exportPayload() {
    return {
      course: app.course || {},
      questions: app.questions,
      tasks: app.tasks,
      demo: app.demo,
      settings: app.settings
    };
  }

  function requireExportData() {
    if (!app.questions.length) {
      toast('暂无可导出的题目，请先完成采集或使用 demo 模式', 'warn');
      return null;
    }
    if (!global.XXTExport) {
      toast('导出模块未加载（export.js）', 'error');
      return null;
    }
    return exportPayload();
  }

  function handleExportMarkdown(includeAnswers) {
    var data = requireExportData();
    if (!data) {
      return;
    }
    try {
      var filename = global.XXTExport.exportMarkdown(data, includeAnswers);
      toast('已导出：' + filename, 'ok');
    } catch (error) {
      toast('导出 Markdown 失败：' + (error && error.message ? error.message : error), 'error');
    }
  }

  function handleExportJson() {
    var data = requireExportData();
    if (!data) {
      return;
    }
    try {
      var filename = global.XXTExport.exportJson(data);
      toast('已导出：' + filename, 'ok');
    } catch (error) {
      toast('导出 JSON 失败：' + (error && error.message ? error.message : error), 'error');
    }
  }

  function handleExportCsv() {
    var data = requireExportData();
    if (!data) {
      return;
    }
    try {
      var filename = global.XXTExport.exportCsv(data);
      toast('已导出：' + filename, 'ok');
    } catch (error) {
      toast('导出 CSV 失败：' + (error && error.message ? error.message : error), 'error');
    }
  }

  function handleExportPrint() {
    var data = requireExportData();
    if (!data) {
      return;
    }
    var includeAnswers = refs.printWithAnswers ? !!refs.printWithAnswers.checked : true;
    try {
      var result = global.XXTExport.openPrintView(data, includeAnswers);
      if (!result.ok) {
        toast(result.error, 'error');
      } else {
        toast('已打开打印视图：' + result.title, 'ok');
      }
    } catch (error) {
      toast('打开打印视图失败：' + (error && error.message ? error.message : error), 'error');
    }
  }

  function exportSnapshot() {
    if (!global.XXTExport) {
      toast('导出模块未加载（export.js）', 'error');
      return;
    }
    if (app.busyAction) {
      return;
    }
    if (app.demo) {
      var demoPayload = {
        generator: GENERATOR,
        exportedAt: new Date().toISOString(),
        demo: true,
        course: app.course || null,
        state: app.state || null,
        snapshot: {
          capturedAt: new Date().toISOString(),
          url: DEMO_COURSE.url,
          context: app.course,
          frames: [],
          entries: app.entries,
          logs: (app.state && app.state.logs) || []
        }
      };
      var demoFilename = global.XXTExport.makeFileName('xxt-snapshot', courseTitle(), '', 'json');
      global.XXTExport.downloadJson(demoFilename, demoPayload);
      toast('页面存档已导出（演示）：' + demoFilename, 'ok');
      return;
    }
    if (!app.connected || !app.tabId || app.linkLost) {
      toast('尚未连接学习通页面，无法导出页面存档', 'error');
      return;
    }
    app.busyAction = 'snapshot';
    setButtonBusy(refs.btnSnapshot, true, '导出中…');
    renderRunButtons();
    sendToTab({ type: 'XXT_SNAPSHOT' }, function (response) {
      app.busyAction = null;
      setButtonBusy(refs.btnSnapshot, false);
      renderRunButtons();
      if (!response || !response.ok || !response.snapshot) {
        toast('页面存档导出失败：' + errorText(response), 'error');
        return;
      }
      var payload = {
        generator: GENERATOR,
        exportedAt: new Date().toISOString(),
        course: app.course || null,
        state: app.state || null,
        snapshot: response.snapshot
      };
      var filename = global.XXTExport.makeFileName('xxt-snapshot', courseTitle(), '', 'json');
      global.XXTExport.downloadJson(filename, payload);
      toast('页面存档已导出：' + filename, 'ok');
    }, 30000);
  }

  /* ================================================================
   * 设置弹窗（chrome.storage.local）
   * ================================================================ */

  function fillSettingsForm(settings) {
    if (refs.inputMinDelay) {
      refs.inputMinDelay.value = settings.minDelay;
    }
    if (refs.inputMaxDelay) {
      refs.inputMaxDelay.value = settings.maxDelay;
    }
    if (refs.inputTimeout) {
      refs.inputTimeout.value = settings.timeout;
    }
    if (refs.inputRetries) {
      refs.inputRetries.value = settings.retries;
    }
    if (refs.inputMaxCards) {
      refs.inputMaxCards.value = settings.maxCards;
    }
  }

  function openSettings() {
    fillSettingsForm(app.settings);
    if (refs.settingsError) {
      refs.settingsError.hidden = true;
      refs.settingsError.textContent = '';
    }
    if (refs.settingsModal) {
      refs.settingsModal.hidden = false;
    }
    setTimeout(function () {
      if (refs.inputMinDelay) {
        refs.inputMinDelay.focus();
      }
    }, 30);
  }

  function closeSettings() {
    if (refs.settingsModal) {
      refs.settingsModal.hidden = true;
    }
  }

  function readFormNumber(input) {
    if (!input) {
      return NaN;
    }
    var raw = String(input.value || '').trim();
    if (raw === '') {
      return NaN;
    }
    var value = Number(raw);
    return isFinite(value) ? value : NaN;
  }

  function showSettingsError(message) {
    if (!refs.settingsError) {
      return;
    }
    refs.settingsError.textContent = message;
    refs.settingsError.hidden = false;
  }

  function validateAndReadSettings() {
    var values = {
      minDelay: readFormNumber(refs.inputMinDelay),
      maxDelay: readFormNumber(refs.inputMaxDelay),
      timeout: readFormNumber(refs.inputTimeout),
      retries: readFormNumber(refs.inputRetries),
      maxCards: readFormNumber(refs.inputMaxCards)
    };
    var errors = [];
    if (!isFinite(values.minDelay) || values.minDelay < 0 || values.minDelay > 60000) {
      errors.push('minDelay 需为 0–60000 之间的数字');
    }
    if (!isFinite(values.maxDelay) || values.maxDelay < 0 || values.maxDelay > 60000) {
      errors.push('maxDelay 需为 0–60000 之间的数字');
    }
    if (isFinite(values.minDelay) && isFinite(values.maxDelay) && values.minDelay > values.maxDelay) {
      errors.push('minDelay 不能大于 maxDelay');
    }
    if (!isFinite(values.timeout) || values.timeout < 1000 || values.timeout > 120000) {
      errors.push('timeout 需为 1000–120000 之间的数字（毫秒）');
    }
    if (!isFinite(values.retries) || values.retries < 0 || values.retries > 10) {
      errors.push('retries 需为 0–10 之间的整数');
    }
    if (!isFinite(values.maxCards) || values.maxCards < 1 || values.maxCards > 500) {
      errors.push('maxCards 需为 1–500 之间的整数');
    }
    if (errors.length) {
      showSettingsError(errors.join('；'));
      return null;
    }
    return normalizeSettings({
      minDelay: Math.round(values.minDelay),
      maxDelay: Math.round(values.maxDelay),
      timeout: Math.round(values.timeout),
      retries: Math.round(values.retries),
      maxCards: Math.round(values.maxCards)
    });
  }

  function saveSettings() {
    var settings = validateAndReadSettings();
    if (!settings) {
      return;
    }
    app.settings = settings;
    if (refs.settingsError) {
      refs.settingsError.hidden = true;
    }
    if (app.demo) {
      closeSettings();
      toast('demo 模式：设置仅保存在内存中', 'warn');
      return;
    }
    if (!hasStorage()) {
      closeSettings();
      toast('当前环境不支持 chrome.storage，设置仅在本次会话生效', 'warn');
      return;
    }
    try {
      chrome.storage.local.set((function () {
        var payload = {};
        payload[STORAGE_KEY] = settings;
        return payload;
      })(), function () {
        var lastError = chrome.runtime && chrome.runtime.lastError;
        if (lastError) {
          showSettingsError('保存设置失败：' + (lastError.message || '未知错误'));
          toast('保存设置失败：' + (lastError.message || '未知错误'), 'error');
          return;
        }
        closeSettings();
        toast('设置已保存', 'ok');
      });
    } catch (error) {
      showSettingsError('保存设置失败：' + (error && error.message ? error.message : error));
    }
  }

  function loadSettings(callback) {
    if (app.demo || !hasStorage()) {
      app.settings = normalizeSettings(DEFAULT_SETTINGS);
      callback();
      return;
    }
    try {
      chrome.storage.local.get([STORAGE_KEY], function (items) {
        if (chrome.runtime && chrome.runtime.lastError) {
          // 读取失败不影响主流程，退回默认值。
        }
        var stored = items && items[STORAGE_KEY];
        app.settings = normalizeSettings(stored || DEFAULT_SETTINGS);
        callback();
      });
    } catch (error) {
      app.settings = normalizeSettings(DEFAULT_SETTINGS);
      callback();
    }
  }

  /* ================================================================
   * demo 模式：初始化与模拟采集
   * ================================================================ */

  function buildDemoState(status) {
    return {
      status: status || 'done',
      course: clone(DEMO_COURSE),
      entries: clone(DEMO_ENTRIES),
      progress: { entryIndex: 2, entryTotal: 2, tasksDone: 3, tasksFailed: 1, questions: 6 },
      stats: { chapters: 2, tasks: 4, questions: 6, failedTasks: 1, duplicateQuestions: 0 },
      logs: clone(DEMO_LOGS),
      lastError: null,
      pausedReason: null,
      options: clone(app.settings)
    };
  }

  function stopDemoTimer() {
    if (app.demoTimer) {
      clearTimeout(app.demoTimer);
      app.demoTimer = null;
    }
  }

  function demoLog(level, message) {
    addLog(level, message);
  }

  function initDemo() {
    stopPolling();
    stopDemoTimer();
    app.demo = true;
    app.connected = true;
    app.connecting = false;
    app.linkLost = false;
    app.tabId = null;
    app.busyAction = null;
    app.demoRunning = false;
    app.demoStep = 0;
    app.resultsFetching = false;
    app.lastFetchDoneAt = 0;
    app.course = clone(DEMO_COURSE);
    app.entries = clone(DEMO_ENTRIES);
    app.tasks = clone(DEMO_TASKS);
    app.state = buildDemoState('done');
    app.questions = clone(DEMO_QUESTIONS);
    app.extractMode = false;
    app.extractAdapter = '';
    app.extractWarnings = [];
    app.bulkQuestions = [];
    app.bulkTasks = [];
    app.selected = {};
    app.page = 1;
    app.logsSig = null;
    app.entriesSig = null;
    app.logsPinnedOnce = false;
    resetFilters();
    if (refs.demoBanner) {
      refs.demoBanner.hidden = false;
    }
    if (refs.printWithAnswers) {
      refs.printWithAnswers.checked = true;
    }
    closeSettings();
    clearBanner();
    refreshFilters();
    setSectionsVisible();
    renderAll();
    renderResults();
    renderResultsMode();
    toast('demo 模式：使用内置示例数据，不会连接学习通页面', 'info');
  }

  function demoScan() {
    if (app.busyAction) {
      return;
    }
    stopDemoTimer();
    app.busyAction = 'scan';
    var state = ensureState();
    state.status = 'scanning';
    demoLog('info', '正在扫描课程目录（演示）…');
    setButtonBusy(refs.btnScan, true, '扫描中…');
    renderAll();
    app.demoTimer = setTimeout(function () {
      app.demoTimer = null;
      app.busyAction = null;
      setButtonBusy(refs.btnScan, false);
      app.entries = clone(DEMO_ENTRIES).map(function (entry) {
        return Object.assign({}, entry, { doneTasks: 0, status: 'pending' });
      });
      app.selected = {};
      app.entriesSig = null;
      var nextState = ensureState();
      nextState.status = 'ready';
      nextState.course = app.course;
      nextState.entries = app.entries;
      nextState.progress = { entryIndex: 0, entryTotal: 2, tasksDone: 0, tasksFailed: 0, questions: 0 };
      nextState.stats = { chapters: 2, tasks: 4, questions: 0, failedTasks: 0, duplicateQuestions: 0 };
      nextState.lastError = null;
      nextState.pausedReason = null;
      demoLog('ok', '目录扫描完成（演示）：2 个章节，4 个任务点');
      renderAll();
      toast('扫描完成：2 个章节（演示）', 'ok');
    }, 650);
  }

  function demoStart() {
    if (app.busyAction || app.demoRunning) {
      return;
    }
    var currentStatus = app.state && app.state.status;
    if (currentStatus === 'running' || currentStatus === 'paused') {
      return;
    }
    stopDemoTimer();
    app.demoStep = 0;
    app.demoRunning = true;
    app.busyAction = 'start';
    var state = ensureState();
    state.status = 'running';
    state.course = app.course;
    app.entries = clone(DEMO_ENTRIES).map(function (entry) {
      return Object.assign({}, entry, { doneTasks: 0, status: 'pending' });
    });
    app.entriesSig = null;
    state.entries = app.entries;
    state.progress = { entryIndex: 0, entryTotal: 2, tasksDone: 0, tasksFailed: 0, questions: 0 };
    state.stats = { chapters: 2, tasks: 4, questions: 0, failedTasks: 0, duplicateQuestions: 0 };
    state.lastError = null;
    state.pausedReason = null;
    app.questions = [];
    app.tasks = [];
    app.extractMode = false;
    app.extractAdapter = '';
    app.extractWarnings = [];
    app.bulkQuestions = [];
    app.bulkTasks = [];
    app.page = 1;
    app.logsSig = null;
    resetFilters();
    demoLog('info', '开始采集（演示模式）：串行请求 + 随机延迟');
    clearBanner();
    renderAll();
    renderResults();
    toast('开始采集（演示）', 'ok');
    app.demoTimer = setTimeout(function () {
      app.demoTimer = null;
      app.busyAction = null;
      demoTick();
    }, 700);
  }

  function demoTick() {
    if (!app.demoRunning) {
      return;
    }
    var plan = DEMO_TASK_PLAN[app.demoStep];
    if (!plan) {
      demoFinish();
      return;
    }
    var state = ensureState();
    if (state.status !== 'running') {
      return;
    }
    var entry = state.entries[plan.entryIndex];
    if (entry) {
      entry.status = 'running';
    }
    state.progress.entryIndex = plan.entryIndex + 1;
    if (plan.ok) {
      plan.questions.forEach(function (questionIndex) {
        state.progress.questions += 1;
        if (DEMO_QUESTIONS[questionIndex]) {
          app.questions.push(clone(DEMO_QUESTIONS[questionIndex]));
        }
      });
      if (entry) {
        entry.doneTasks = (entry.doneTasks || 0) + 1;
        entry.status = 'done';
      }
      state.progress.tasksDone += 1;
      demoLog('ok', plan.log);
    } else {
      if (entry) {
        entry.status = 'failed';
      }
      state.progress.tasksFailed += 1;
      demoLog('error', plan.log);
    }
    app.demoStep += 1;
    app.tasks = clone(DEMO_TASKS).slice(0, app.demoStep);
    state.stats.chapters = 2;
    state.stats.tasks = 4;
    state.stats.questions = state.progress.questions;
    state.stats.failedTasks = state.progress.tasksFailed;
    renderAll();
    refreshFilters();
    renderResults();
    if (app.demoStep >= DEMO_TASK_PLAN.length) {
      app.demoTimer = setTimeout(function () {
        app.demoTimer = null;
        demoFinish();
      }, 700);
      return;
    }
    app.demoTimer = setTimeout(function () {
      app.demoTimer = null;
      demoTick();
    }, 800);
  }

  function demoFinish() {
    if (!app.demoRunning) {
      return;
    }
    stopDemoTimer();
    app.demoRunning = false;
    var state = ensureState();
    state.status = 'done';
    state.entries = app.entries;
    state.progress = { entryIndex: 2, entryTotal: 2, tasksDone: 3, tasksFailed: 1, questions: 6 };
    state.stats = { chapters: 2, tasks: 4, questions: 6, failedTasks: 1, duplicateQuestions: 0 };
    state.entries.forEach(function (entry) {
      if (entry.knowledgeId === 'demo-k-001') {
        entry.status = 'done';
        entry.doneTasks = 2;
      } else {
        entry.status = 'failed';
        entry.doneTasks = 1;
      }
    });
    app.questions = clone(DEMO_QUESTIONS);
    app.tasks = clone(DEMO_TASKS);
    demoLog('ok', '采集完成（演示）：6 题，1 个任务失败');
    refreshFilters();
    renderAll();
    renderResults();
    toast('采集完成（演示）：共 6 题，1 个任务失败', 'ok');
  }

  function demoPause() {
    if (!app.demoRunning) {
      toast('当前没有正在运行的演示任务', 'warn');
      return;
    }
    stopDemoTimer();
    app.demoRunning = false;
    var state = ensureState();
    state.status = 'paused';
    demoLog('warn', '用户暂停（演示）');
    renderAll();
    toast('已暂停（演示），可点击「继续」', 'warn');
  }

  function demoResume() {
    var state = ensureState();
    if (state.status !== 'paused') {
      toast('当前没有暂停中的演示任务', 'warn');
      return;
    }
    app.demoRunning = true;
    state.status = 'running';
    demoLog('info', '继续采集（演示）');
    clearBanner();
    renderAll();
    toast('已继续（演示）', 'ok');
    app.demoTimer = setTimeout(function () {
      app.demoTimer = null;
      demoTick();
    }, 600);
  }

  function demoStop() {
    var state = ensureState();
    var wasActive = app.demoRunning || state.status === 'running' || state.status === 'paused';
    stopDemoTimer();
    app.demoRunning = false;
    if (state.status === 'running' || state.status === 'paused' || state.status === 'stopping') {
      state.status = 'ready';
    }
    if (wasActive) {
      demoLog('warn', '用户停止采集（演示）');
    }
    renderAll();
    toast(wasActive ? '已停止（演示）' : '没有正在运行的演示任务', wasActive ? 'warn' : 'info');
  }

  /* ================================================================
   * 事件绑定
   * ================================================================ */

  function bindRefs() {
    refs.connPill = $('conn-pill');
    refs.courseName = $('course-name');
    refs.demoBanner = $('demo-banner');
    refs.alertBanner = $('alert-banner');
    refs.emptyState = $('empty-state');
    refs.emptyTitle = $('empty-title');
    refs.emptyHint = $('empty-hint');
    refs.btnReconnect = $('btn-reconnect');
    refs.btnSettings = $('btn-settings');
    refs.btnSnapshot = $('btn-snapshot');
    refs.btnExtractCurrent = $('btn-extract-current');
    refs.btnScan = $('btn-scan');
    refs.btnSelectAll = $('btn-select-all');
    refs.btnSelectNone = $('btn-select-none');
    refs.entriesList = $('entries-list');
    refs.scanHint = $('scan-hint');
    refs.btnStart = $('btn-start');
    refs.btnPause = $('btn-pause');
    refs.btnResume = $('btn-resume');
    refs.btnStop = $('btn-stop');
    refs.progressEntryBar = $('progress-entry-bar');
    refs.progressEntryText = $('progress-entry-text');
    refs.progressTaskBar = $('progress-task-bar');
    refs.progressTaskText = $('progress-task-text');
    refs.statChapters = $('stat-chapters');
    refs.statTasks = $('stat-tasks');
    refs.statQuestions = $('stat-questions');
    refs.statFailed = $('stat-failed');
    refs.logList = $('log-list');
    refs.logsMeta = $('logs-meta');
    refs.taskList = $('task-list');
    refs.tasksMeta = $('tasks-meta');
    refs.resultsMeta = $('results-meta');
    refs.resultsCount = $('results-count');
    refs.resultsMode = $('results-mode');
    refs.btnShowBulk = $('btn-show-bulk');
    refs.resultsTbody = $('results-tbody');
    refs.resultsEmpty = $('results-empty');
    refs.tableWrap = document.querySelector('#card-results .table-wrap');
    refs.pager = document.querySelector('#card-results .pager');
    refs.pagePrev = $('page-prev');
    refs.pageNext = $('page-next');
    refs.pageInfo = $('page-info');
    refs.filterChapter = $('filter-chapter');
    refs.filterType = $('filter-type');
    refs.filterAnswered = $('filter-answered');
    refs.searchStem = $('search-stem');
    refs.printWithAnswers = $('print-with-answers');
    refs.exportButtons = Array.prototype.slice.call(document.querySelectorAll('[data-export]'));
    refs.settingsModal = $('settings-modal');
    refs.settingsError = $('settings-error');
    refs.inputMinDelay = $('set-min-delay');
    refs.inputMaxDelay = $('set-max-delay');
    refs.inputTimeout = $('set-timeout');
    refs.inputRetries = $('set-retries');
    refs.inputMaxCards = $('set-max-cards');
    refs.toastContainer = $('toast-container');
    refs.sections = {};
    SECTIONS.forEach(function (id) {
      refs[id] = $(id);
    });
  }

  function findActionTarget(node) {
    var current = node;
    while (current && current !== document.body) {
      if (current.getAttribute && current.getAttribute('data-action')) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  function handleAction(action) {
    switch (action) {
      case 'reconnect':
        connect();
        break;
      case 'open-settings':
        openSettings();
        break;
      case 'close-settings':
        closeSettings();
        break;
      case 'snapshot':
        exportSnapshot();
        break;
      case 'extract-current':
        extractCurrentPage();
        break;
      case 'show-bulk':
        showBulkResults();
        break;
      case 'scan':
        scanCatalog();
        break;
      case 'select-all':
        setAllSelected(true);
        break;
      case 'select-none':
        setAllSelected(false);
        break;
      case 'start':
        startCollection();
        break;
      case 'pause':
        pauseCollection();
        break;
      case 'resume':
        resumeCollection();
        break;
      case 'stop':
        stopCollection();
        break;
      case 'page-prev':
        if (app.page > 1) {
          app.page -= 1;
          renderResults();
        }
        break;
      case 'page-next':
        app.page += 1;
        renderResults();
        break;
      case 'export-md-answers':
        handleExportMarkdown(true);
        break;
      case 'export-md-plain':
        handleExportMarkdown(false);
        break;
      case 'export-json':
        handleExportJson();
        break;
      case 'export-csv':
        handleExportCsv();
        break;
      case 'export-print':
        handleExportPrint();
        break;
      case 'save-settings':
        saveSettings();
        break;
      default:
        break;
    }
  }

  function onDocumentClick(event) {
    var target = findActionTarget(event.target);
    if (!target) {
      return;
    }
    event.preventDefault();
    handleAction(target.getAttribute('data-action'));
  }

  function onDocumentKeydown(event) {
    if (event.key === 'Escape' && refs.settingsModal && !refs.settingsModal.hidden) {
      closeSettings();
      return;
    }
    if (event.key === 'Enter' && event.target && event.target.classList &&
        event.target.classList.contains('answer-input')) {
      event.preventDefault();
      event.target.blur();
    }
  }

  function onDocumentFocusOut(event) {
    var target = event.target;
    if (!target || !target.classList || !target.classList.contains('answer-input')) {
      return;
    }
    commitAnswerInput(target);
  }

  function setAllSelected(checked) {
    app.selected = {};
    app.entries.forEach(function (entry) {
      app.selected[entry.knowledgeId] = !!checked;
    });
    app.entriesSig = null;
    renderEntries();
    renderRunButtons();
  }

  function bindEvents() {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKeydown);
    document.addEventListener('focusout', onDocumentFocusOut);

    if (refs.entriesList) {
      refs.entriesList.addEventListener('change', function (event) {
        var target = event.target;
        if (!target || target.type !== 'checkbox') {
          return;
        }
        var knowledgeId = target.getAttribute('data-kid');
        if (!knowledgeId) {
          return;
        }
        app.selected[knowledgeId] = !!target.checked;
        updateScanHint();
        renderRunButtons();
      });
    }

    if (refs.filterChapter) {
      refs.filterChapter.addEventListener('change', function () {
        app.filters.chapter = refs.filterChapter.value;
        app.page = 1;
        renderResults();
      });
    }
    if (refs.filterType) {
      refs.filterType.addEventListener('change', function () {
        app.filters.type = refs.filterType.value;
        app.page = 1;
        renderResults();
      });
    }
    if (refs.filterAnswered) {
      refs.filterAnswered.addEventListener('change', function () {
        app.filters.answered = refs.filterAnswered.value;
        app.page = 1;
        renderResults();
      });
    }
    if (refs.searchStem) {
      refs.searchStem.addEventListener('input', function () {
        if (app.searchTimer) {
          clearTimeout(app.searchTimer);
        }
        app.searchTimer = setTimeout(function () {
          app.searchTimer = null;
          app.filters.search = String(refs.searchStem.value || '').trim();
          app.page = 1;
          renderResults();
        }, 200);
      });
    }
    if (refs.settingsModal) {
      refs.settingsModal.addEventListener('click', function (event) {
        if (event.target === refs.settingsModal) {
          closeSettings();
        }
      });
    }
    global.addEventListener('beforeunload', function () {
      stopPolling();
      stopDemoTimer();
    });
  }

  function bindContentEvents() {
    if (app.demo || !hasRuntime() || !chrome.runtime.onMessage) {
      return;
    }
    try {
      chrome.runtime.onMessage.addListener(function (message) {
        if (!message || message.type !== 'XXT_EVENT' || !message.state) {
          return;
        }
        if (app.demo) {
          return;
        }
        applyState(message.state);
      });
    } catch (error) {
      // 事件监听失败时仅依赖轮询兜底。
    }
  }

  /* ================================================================
   * 启动
   * ================================================================ */

  function init() {
    bindRefs();
    app.demo = isDemoMode();
    bindEvents();

    if (app.demo) {
      if (refs.demoBanner) {
        refs.demoBanner.hidden = false;
      }
      app.settings = normalizeSettings(DEFAULT_SETTINGS);
      setConnection('info', '演示模式');
      initDemo();
      return;
    }

    setConnection('connecting', '连接中…');
    renderAll();
    loadSettings(function () {
      renderAll();
      connect();
    });
    bindContentEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
