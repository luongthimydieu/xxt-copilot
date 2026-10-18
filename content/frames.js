/* XXT Copilot - 帧与页面结构工具
 * 只做只读的 DOM 遍历/扫描，不点击、不提交任何东西。
 */
(() => {
  'use strict';
  const XXT = (globalThis.XXT = globalThis.XXT || {});
  const frames = (XXT.frames = {});

  const MAX_HTML_CHARS = 2000000;

  function normalize(text) {
    return String(text == null ? '' : text)
      .replace(/\u00a0/g, ' ')
      .replace(/[\t\r\f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  frames.normalize = normalize;

  /** 递归收集同源文档（含当前文档），跨域 iframe 自动跳过。 */
  function collectDocuments(rootDoc = document, out = [], seen = new Set(), depth = 0) {
    if (!rootDoc || seen.has(rootDoc) || depth > 8) return out;
    seen.add(rootDoc);
    out.push(rootDoc);
    let iframes = [];
    try {
      iframes = Array.from(rootDoc.querySelectorAll('iframe'));
    } catch (e) {
      return out;
    }
    for (const frame of iframes) {
      let doc = null;
      try {
        doc = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
      } catch (e) {
        doc = null;
      }
      if (doc) collectDocuments(doc, out, seen, depth + 1);
    }
    return out;
  }
  frames.collectDocuments = collectDocuments;

  function readParamsFromUrl(url) {
    const result = {};
    if (!url) return result;
    let params;
    try {
      params = new URL(url).searchParams;
    } catch (e) {
      return result;
    }
    const map = {
      courseId: ['courseId', 'courseid', 'course_id'],
      clazzId: ['clazzid', 'clazzId', 'classId', 'classid', 'class_id'],
      cpi: ['cpi']
    };
    for (const [key, names] of Object.entries(map)) {
      for (const name of names) {
        const value = params.get(name);
        if (value) {
          result[key] = value;
          break;
        }
      }
    }
    return result;
  }
  frames.readParamsFromUrl = readParamsFromUrl;

  const COURSE_TITLE_SELECTORS = [
    '.courseName',
    '#courseName',
    '.course-name',
    '.courseTitle',
    '.course_title',
    '.course-title'
  ];

  /** 当前课程的 courseId / clazzId / cpi / 标题，尽量从所有帧里找。 */
  function getContext() {
    const docs = collectDocuments();
    const context = { courseId: '', clazzId: '', cpi: '', title: '', url: '' };
    const docTitles = [];

    for (const doc of docs) {
      const url = doc.URL || (doc.defaultView && doc.defaultView.location.href) || '';
      if (!context.url) context.url = url;
      const params = readParamsFromUrl(url);
      for (const key of ['courseId', 'clazzId', 'cpi']) {
        if (!context[key] && params[key]) context[key] = params[key];
      }
      let docTitle = '';
      try {
        docTitle = normalize(doc.title || '');
      } catch (e) {
        docTitle = '';
      }
      if (docTitle) docTitles.push(docTitle);
      for (const selector of COURSE_TITLE_SELECTORS) {
        let el = null;
        try {
          el = doc.querySelector(selector);
        } catch (e) {
          el = null;
        }
        if (el && normalize(el.textContent)) {
          context.title = normalize(el.textContent).slice(0, 120);
          break;
        }
      }
    }

    if (!context.title) {
      // 顶层标题经常是“学生学习页面/章节详情”，优先用更具体的子帧标题或课程名。
      const goodTitle = docTitles.find(
        (title) => title && !/学习页面|章节详情|课程首页|^\s*学生/.test(title)
      );
      context.title = goodTitle || docTitles[0] || '未命名课程';
    }
    context.title = context.title
      .replace(/\s*[-_|—]\s*(超星|学习通|泛雅).*$/i, '')
      .replace(/^(学生学习页面|章节详情)\s*/, '')
      .trim();
    if (!context.title) context.title = '未命名课程';
    return context;
  }
  frames.getContext = getContext;

  function isOurNode(node) {
    try {
      return !!(node.closest && node.closest('#xxt-panel, #xxt-settings-modal, #xxt-bank-modal, [data-xxt-ui]'));
    } catch (e) {
      return false;
    }
  }

  /** 从目录节点的 onclick / 属性 / 链接里提取 knowledgeId（第三个参数）。 */
  function extractKnowledgeId(node) {
    if (!node || !node.getAttribute) return '';
    let el = node;
    for (let depth = 0; el && depth < 5; el = el.parentElement, depth++) {
      const onclick = String(el.getAttribute('onclick') || '');
      let matched = onclick.match(
        /getTeacherAjax\s*\(\s*(?:'[^']*'|"[^"]*"|[^,]+)\s*,\s*(?:'[^']*'|"[^"]*"|[^,]+)\s*,\s*['"]?(\d{3,})/i
      );
      if (matched) return matched[1];

      for (const attr of ['data-knowledgeid', 'data-knowledge-id', 'data-chapterid', 'data-chapter-id']) {
        const value = String(el.getAttribute(attr) || '');
        if (/^\d{3,}$/.test(value)) return value;
      }

      const id = String(el.id || '');
      matched = id.match(/^cur(\d{3,})$/i);
      if (matched) return matched[1];

      const source = `${String(el.getAttribute('href') || '')} ${onclick}`;
      matched = source.match(/(?:chapterId|chapterid|knowledgeId|knowledgeid)\s*(?:=|:|%3D)\s*['"]?(\d{3,})/i);
      if (matched) return matched[1];
    }
    return '';
  }
  frames.extractKnowledgeId = extractKnowledgeId;

  function extractTitle(node) {
    let el = node;
    // 找到带目录文本的最近节点，避免把整个章节点当标题。
    for (let depth = 0; el && depth < 4; el = el.parentElement, depth++) {
      const text = normalize(el.textContent);
      if (text && text.length <= 120) return text;
      if (text && depth >= 3) return text.slice(0, 120);
    }
    return '';
  }

  /** 扫描课程目录中所有任务点（getTeacherAjax 节点），按 DOM 顺序去重。 */
  function scanCatalog() {
    const docs = collectDocuments();
    const entries = [];
    const seen = new Set();

    for (const doc of docs) {
      let nodes = [];
      try {
        nodes = Array.from(doc.querySelectorAll('[onclick*="getTeacherAjax"]'));
      } catch (e) {
        nodes = [];
      }
      for (const node of nodes) {
        if (isOurNode(node)) continue;
        const knowledgeId = extractKnowledgeId(node);
        if (!knowledgeId || seen.has(knowledgeId)) continue;
        seen.add(knowledgeId);
        entries.push({
          knowledgeId,
          title: extractTitle(node) || `任务点 ${knowledgeId}`,
          index: entries.length
        });
      }
    }
    return entries;
  }
  frames.scanCatalog = scanCatalog;

  /** DOM 兜底：从当前已打开页面里找测验/作业入口（cards 接口失败时用）。 */
  function scanDomWorkLinks() {
    const docs = collectDocuments();
    const tasks = [];
    const seen = new Set();

    const push = (workId, jobId, knowledgeId, title, sourceUrl) => {
      if (!workId) return;
      const key = `${workId}|${jobId || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      tasks.push({
        workId: String(workId).replace(/^work-/, ''),
        jobId: String(jobId || `work-${workId}`),
        knowledgeId: String(knowledgeId || ''),
        title: normalize(title) || `测验 ${workId}`,
        sourceUrl: sourceUrl || ''
      });
    };

    for (const doc of docs) {
      let links = [];
      try {
        links = Array.from(doc.querySelectorAll('a[href*="/work/"], a[href*="workId="], a[href*="workid="]'));
      } catch (e) {
        links = [];
      }
      for (const link of links) {
        let url;
        try {
          url = new URL(link.getAttribute('href') || '', doc.URL || location.href);
        } catch (e) {
          continue;
        }
        const workId = url.searchParams.get('workId') || url.searchParams.get('workid') || '';
        const jobId = url.searchParams.get('jobId') || url.searchParams.get('jobid') || '';
        const knowledgeId = url.searchParams.get('knowledgeId') || url.searchParams.get('chapterId') || '';
        push(workId, jobId, knowledgeId, link.textContent, url.href);
      }

      // 底部任务栏 / 任务卡上的 changeDisplayContent(jobid) 入口
      let tabs = [];
      try {
        tabs = Array.from(doc.querySelectorAll('#prev_tab .prev_ul li, .prev_ul li, [onclick*="changeDisplayContent"]'));
      } catch (e) {
        tabs = [];
      }
      for (const tab of tabs) {
        const onclick = String(tab.getAttribute('onclick') || '');
        const jobMatch =
          onclick.match(/changeDisplayContent\s*\([^)]*?['"]?([\w-]*work[\w-]+)['"]?/i) ||
          onclick.match(/(?:jobid|_jobid)\s*[=:]\s*['"]?([^,'"\s)]+)/i) ||
          String(tab.outerHTML).match(/\b(work-[a-z0-9-]{8,})\b/i);
        const jobId = jobMatch ? jobMatch[1] : '';
        if (!jobId) continue;
        const workId = jobId.replace(/^work-/, '');
        push(workId, jobId, '', tab.textContent, '');
      }
    }
    return tasks;
  }
  frames.scanDomWorkLinks = scanDomWorkLinks;

  /** 导出页面结构存档：所有同源帧的 URL 与 HTML，用于排查解析失败的页面。 */
  function snapshot() {
    const docs = collectDocuments();
    const result = [];
    for (const doc of docs) {
      let html = '';
      try {
        html = doc.documentElement ? doc.documentElement.outerHTML : '';
      } catch (e) {
        html = '';
      }
      const truncated = html.length > MAX_HTML_CHARS;
      result.push({
        url: doc.URL || '',
        title: normalize(doc.title || ''),
        length: html.length,
        truncated,
        html: truncated ? html.slice(0, MAX_HTML_CHARS) : html
      });
    }
    return { capturedAt: new Date().toISOString(), url: location.href, frames: result };
  }
  frames.snapshot = snapshot;

  /** 页面主标题（章节名/作业名），多处兜底。 */
  function getPageTitle() {
    const docs = collectDocuments();
    const selectors = [
      '.mark_title',
      '.chapter_title',
      '.chapter-title',
      '.newTestTitle',
      '.TestTitle_name',
      '.title_name',
      '.article-title',
      'h1',
      'h2'
    ];
    for (const doc of docs) {
      for (const selector of selectors) {
        let el = null;
        try {
          el = doc.querySelector(selector);
        } catch (e) {
          el = null;
        }
        if (el) {
          const text = normalize(el.textContent);
          if (text && text.length <= 120) return text;
        }
      }
    }
    const docTitle = normalize(document.title || '');
    return docTitle.replace(/\s*[-–—|].*$/, '').slice(0, 120) || '未命名页面';
  }
  frames.getPageTitle = getPageTitle;

  /** 等待某个条件成立（带超时），批量/单页流程里的兜底等待。 */
  function waitFor(predicate, timeout = 10000, interval = 250) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const tick = () => {
        let value = null;
        try {
          value = predicate();
        } catch (e) {
          value = null;
        }
        if (value) return resolve(value);
        if (Date.now() - startedAt >= timeout) return resolve(null);
        setTimeout(tick, interval);
      };
      tick();
    });
  }
  frames.waitFor = waitFor;
})();
