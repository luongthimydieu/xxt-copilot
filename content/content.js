/* XXT Copilot - content script 任务编排与消息协议
 * 只在顶层 frame 响应 dashboard；所有操作只读。
 */
(() => {
  'use strict';

  let isTop = false;
  try {
    isTop = window.top === window.self;
  } catch (e) {
    isTop = false;
  }
  if (!isTop) {
    // 顶层的隐藏 iframe 兜底通道：跨域（如 mooc2-ans.chaoxing.com）时，由本帧的
    // content script 把当前 DOM 回传给父窗口解析。只回传 HTML，不执行任何操作。
    window.addEventListener('message', (event) => {
      if (!event.data || event.data.type !== 'XXT_IFRAME_PROBE') return;
      if (event.source !== window.parent) return;
      const requestId = String(event.data.requestId || '');
      let html = '';
      try {
        html = document.documentElement ? document.documentElement.outerHTML : '';
      } catch (e) {
        html = '';
      }
      let url = '';
      try {
        url = location.href;
      } catch (e) {
        url = '';
      }
      try {
        window.parent.postMessage(
          {
            type: 'XXT_IFRAME_PROBE_RESULT',
            requestId,
            url,
            title: document.title || '',
            readyState: document.readyState,
            html: String(html).slice(0, 2000000)
          },
          '*'
        );
      } catch (e) {
        /* ignore */
      }
    });
    return;
  }

  const XXT = (globalThis.XXT = globalThis.XXT || {});
  const frames = XXT.frames;
  const net = XXT.net;
  const parsers = XXT.parsers;
  if (!frames || !net || !parsers) return;

  const MAX_LOGS = 300;

  const state = {
    status: 'idle',
    course: null,
    entries: [],
    progress: { entryIndex: 0, entryTotal: 0, tasksDone: 0, tasksFailed: 0, questions: 0 },
    stats: { chapters: 0, tasks: 0, questions: 0, failedTasks: 0, duplicateQuestions: 0 },
    logs: [],
    lastError: null,
    pausedReason: null,
    options: net.getOptions()
  };

  let results = [];
  let resultIndex = new Map();
  let taskRecords = [];
  let job = null;
  let pauseWaiters = [];
  let seenTaskKeys = new Set();

  // ============================== 基础工具 ==============================

  function nowTime() {
    const date = new Date();
    return [date.getHours(), date.getMinutes(), date.getSeconds()]
      .map((value) => String(value).padStart(2, '0'))
      .join(':');
  }

  function addLog(level, message) {
    state.logs.push({ time: nowTime(), level: level || 'info', message: String(message || '') });
    if (state.logs.length > MAX_LOGS) state.logs.splice(0, state.logs.length - MAX_LOGS);
  }

  function publicState() {
    return {
      status: state.status,
      course: state.course,
      entries: state.entries.map((entry) => ({
        knowledgeId: entry.knowledgeId,
        title: entry.title,
        index: entry.index,
        taskCount: entry.taskCount || 0,
        doneTasks: entry.doneTasks || 0,
        status: entry.status || 'pending',
        error: entry.error || ''
      })),
      progress: { ...state.progress },
      stats: { ...state.stats },
      logs: state.logs.slice(-MAX_LOGS),
      lastError: state.lastError,
      pausedReason: state.pausedReason,
      options: state.options
    };
  }

  function notify(eventName) {
    try {
      chrome.runtime.sendMessage({ type: 'XXT_EVENT', event: eventName || 'progress', state: publicState() }, () => {
        // 没有 dashboard 监听时会报 lastError，忽略即可。
        void chrome.runtime.lastError;
      });
    } catch (e) {
      /* ignore */
    }
  }

  function refreshProgress() {
    state.progress.entryIndex = job
      ? job.entryIndex
      : state.status === 'done'
        ? state.entries.length
        : 0;
    state.progress.entryTotal = state.entries.length;
    state.progress.questions = results.length;
    state.stats.chapters = state.entries.length;
    state.stats.questions = results.length;
    state.stats.failedTasks = taskRecords.filter((task) => task.status === 'failed').length;
    state.progress.tasksDone = taskRecords.filter((task) => task.status === 'done').length;
    state.progress.tasksFailed = state.stats.failedTasks;
    state.stats.tasks = taskRecords.length;
  }

  function looksLikeXxtPage() {
    try {
      const host = location.hostname || '';
      if (/chaoxing\.com$|xuexitong\.com$/i.test(host)) return true;
      if (
        document.querySelector(
          '#coursetree, .posCatalog, #curChapterId, #curCourseId, #curClazzId, iframe[src*="chaoxing.com"], iframe[src*="xuexitong"]'
        )
      ) {
        return true;
      }
      return /\/mooc-ans\/|\/mycourse\/|\/knowledge\//.test(location.pathname || '');
    } catch (e) {
      return false;
    }
  }

  function registerSelf() {
    // 只注册真正的学习通页面：*.edu.cn 范围较宽，避免普通学校站点覆盖“最近学习通标签页”。
    if (!looksLikeXxtPage()) return;
    try {
      chrome.runtime.sendMessage(
        { type: 'XXT_REGISTER_TAB', context: frames.getContext() },
        () => {
          void chrome.runtime.lastError;
        }
      );
    } catch (e) {
      /* ignore */
    }
  }

  // ============================== 扫描 ==============================

  async function scanCourse() {
    state.status = 'scanning';
    state.lastError = null;
    state.pausedReason = null;
    addLog('info', '开始扫描课程目录…');
    notify('scan-start');

    // 目录可能在 iframe 里，而且页面刚打开时还没渲染完；最多等 4 秒。
    let entries = frames.scanCatalog();
    if (!entries.length) {
      await frames.waitFor(() => frames.scanCatalog().length > 0, 4000, 300);
      entries = frames.scanCatalog();
    }

    const context = frames.getContext();
    state.course = context;
    state.entries = entries.map((entry) => ({
      knowledgeId: entry.knowledgeId,
      title: entry.title,
      index: entry.index,
      taskCount: 0,
      doneTasks: 0,
      status: 'pending',
      error: ''
    }));
    // 保留完整目录：用户只勾选部分章节时，下一次仍可重新全选。
    state.allEntries = state.entries.map((entry) => ({ ...entry }));
    state.stats.chapters = entries.length;
    state.status = 'ready';

    if (!entries.length) {
      addLog(
        'warn',
        '没有扫描到课程目录。请确认：已进入具体课程（不是课程列表页）、右侧目录已加载，然后点“重新连接/扫描课程目录”。'
      );
    } else {
      addLog('ok', `扫描完成：识别到 ${entries.length} 个课程任务点。`);
    }
    refreshProgress();
    notify('scan-done');
    return { ok: true, course: context, entries: publicState().entries };
  }

  // ============================== 暂停 / 停止 ==============================

  function waitWhilePaused() {
    return new Promise((resolve) => {
      if (!job) return resolve(false);
      if (job.stopped) return resolve(false);
      if (!job.paused) return resolve(true);
      pauseWaiters.push(resolve);
    });
  }

  function releasePauseWaiters(value) {
    const waiters = pauseWaiters;
    pauseWaiters = [];
    for (const waiter of waiters) waiter(value);
  }

  function pauseJob(reason, message) {
    if (!job || job.finished) return;
    job.paused = true;
    state.status = 'paused';
    state.pausedReason = reason || 'network';
    state.lastError = message || null;
    addLog('error', `${message || '任务已暂停'}（原因：${state.pausedReason}）。处理后点“继续采集”。`);
    refreshProgress();
    notify('paused');
  }

  function resumeJob() {
    if (!job || job.finished) return { ok: false, error: '没有可继续的任务' };
    job.paused = false;
    state.status = 'running';
    state.pausedReason = null;
    state.lastError = null;
    addLog('info', '继续采集…');
    refreshProgress();
    releasePauseWaiters(true);
    notify('resumed');
    return { ok: true };
  }

  function stopJob() {
    if (!job || job.finished) return { ok: false, error: '没有正在运行的任务' };
    job.stopped = true;
    job.paused = false;
    addLog('warn', '已请求停止：当前请求结束后会安全停下，已完成的结果会保留。');
    releasePauseWaiters(false);
    notify('stopping');
    return { ok: true };
  }

  // ============================== 请求题目 ==============================

  function fatalError(error) {
    return !!(
      error &&
      (error.code === 'LOGIN_REQUIRED' || error.code === 'CAPTCHA' || error.code === 'RATE_LIMITED')
    );
  }

  function fatalReason(error) {
    if (!error) return 'network';
    if (error.code === 'CAPTCHA') return 'captcha';
    if (error.code === 'LOGIN_REQUIRED') return 'login';
    return 'network';
  }

  function describeAttemptError(error) {
    if (!error) return 'UNKNOWN';
    return `${error.code || 'ERROR'}: ${error.message || String(error)}`;
  }

  function isLoginUrl(url) {
    try {
      const parsed = new URL(url);
      if (/passport/i.test(parsed.hostname)) return true;
      return /^\/(login|cas|sso|passport)/i.test(parsed.pathname);
    } catch (e) {
      return false;
    }
  }

  function inspectBlockingPage(doc, url) {
    if (url && isLoginUrl(url)) {
      return new net.XError('学习通登录状态已失效，请重新登录后继续', 'LOGIN_REQUIRED');
    }
    const title = String((doc && doc.title) || '');
    const bodySample = String((doc && doc.body && doc.body.textContent) || '').slice(0, 30000);
    if (/请输入验证码|输入验证码|安全验证|滑动验证|拖动滑块|人机验证/.test(title + bodySample)) {
      return new net.XError('页面要求验证码/安全验证，请手动完成验证后点“继续”', 'CAPTCHA');
    }
    if (/请先登录|登录已过期|您还未登录|重新登录/.test(bodySample) && !/退出登录/.test(bodySample)) {
      return new net.XError('学习通登录状态已失效，请重新登录后继续', 'LOGIN_REQUIRED');
    }
    return null;
  }

  /** 跨域 iframe：请求 iframe 内的 content script 回传当前 DOM 的 HTML。 */
  function probeIframeContent(iframe, requestId, waitMs) {
    return new Promise((resolve) => {
      let done = false;
      let timer = null;
      let poller = null;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (poller) clearInterval(poller);
        window.removeEventListener('message', onMessage);
      };
      const finish = (data) => {
        if (done) return;
        done = true;
        cleanup();
        resolve(data || null);
      };
      const onMessage = (event) => {
        if (event.source !== iframe.contentWindow) return;
        const data = event.data;
        if (!data || data.type !== 'XXT_IFRAME_PROBE_RESULT' || data.requestId !== requestId) return;
        finish(data);
      };
      window.addEventListener('message', onMessage);
      const send = () => {
        try {
          iframe.contentWindow.postMessage({ type: 'XXT_IFRAME_PROBE', requestId }, '*');
        } catch (e) {
          /* iframe 可能已经销毁 */
        }
      };
      send();
      poller = setInterval(send, 450);
      timer = setTimeout(() => finish(null), Math.max(2500, waitMs || 6000));
    });
  }

  /**
   * 用隐藏 iframe 真实导航到题目页再读 DOM。
   * - 同源页面：直接读 contentDocument；
   * - 跨域页面（如 mooc2-ans.chaoxing.com）：通过 iframe 内的 content script 探测回传 HTML。
   * 只读、不提交任何内容。
   */
  function loadDocViaIframe(url, timeout) {
    return new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe');
      iframe.setAttribute('data-xxt-readonly-frame', '1');
      iframe.style.cssText =
        'position:fixed;left:-20000px;top:0;width:1100px;height:800px;border:0;opacity:0;pointer-events:none;';
      let settled = false;
      let timer = null;
      let handlingLoad = false;

      const cleanup = () => {
        try {
          iframe.remove();
        } catch (e) {
          /* ignore */
        }
      };
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        cleanup();
        if (error) reject(error);
        else resolve(result);
      };

      timer = setTimeout(() => finish(new net.XError('iframe 加载超时', 'TIMEOUT')), Math.max(6000, timeout || 15000));

      iframe.onload = async () => {
        if (settled || handlingLoad) return;
        handlingLoad = true;
        try {
          let href = '';
          let doc = null;
          try {
            href = iframe.contentWindow && iframe.contentWindow.location.href;
            doc = iframe.contentDocument;
          } catch (e) {
            href = '';
            doc = null;
          }
          if (!href || href === 'about:blank') return; // 初始空白页，等真正的 load。

          if (doc && doc.body) {
            await net.sleep(700);
            const blocking = inspectBlockingPage(doc, href);
            if (blocking) {
              finish(blocking);
              return;
            }
            finish(null, { doc, url: href });
            return;
          }

          // 跨域：探测 iframe 内的 content script
          const requestId = `xxt-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const data = await probeIframeContent(iframe, requestId, 6000);
          if (!data) {
            finish(new net.XError('iframe 跳转到其它域且探测超时（目标页面没有可用的读取脚本）', 'IFRAME_CROSS_ORIGIN'));
            return;
          }
          const targetUrl = String(data.url || url);
          if (isLoginUrl(targetUrl)) {
            finish(new net.XError('学习通登录状态已失效，请重新登录后继续', 'LOGIN_REQUIRED'));
            return;
          }
          let html = String(data.html || '');
          if (!html) {
            finish(new net.XError('iframe 跨域探测返回空页面', 'IFRAME_CROSS_ORIGIN'));
            return;
          }
          if (!/<base\s/i.test(html.slice(0, 4000))) {
            html = `<base href="${targetUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">` + html;
          }
          const parsedDoc = new DOMParser().parseFromString(html, 'text/html');
          if (!parsedDoc || !parsedDoc.body) {
            finish(new net.XError('iframe 跨域页面解析失败', 'IFRAME_CROSS_ORIGIN'));
            return;
          }
          await net.sleep(200);
          const blocking = inspectBlockingPage(parsedDoc, targetUrl);
          if (blocking) {
            finish(blocking);
            return;
          }
          finish(null, { doc: parsedDoc, url: targetUrl });
        } catch (error) {
          finish(new net.XError('iframe 读取失败：' + String((error && error.message) || error), 'NETWORK'));
        } finally {
          handlingLoad = false;
        }
      };
      iframe.onerror = () => finish(new net.XError('iframe 加载失败', 'NETWORK'));

      try {
        document.body.appendChild(iframe);
        iframe.src = url;
      } catch (error) {
        finish(new net.XError('无法创建 iframe：' + String((error && error.message) || error), 'NETWORK'));
      }
    });
  }

  function parseFetchedPage(doc, pageUrl, entry, task) {
    const meta = {
      chapterTitle: entry.title,
      knowledgeId: entry.knowledgeId,
      workId: task.workId,
      sourceUrl: pageUrl
    };
    return parsers.parseDocument(doc, meta);
  }

  function extractWorkRedirectUrls(text) {
    const urls = new Set();
    const source = String(text || '').replace(/&amp;/gi, '&');
    const regex = /\/mooc-ans\/(?:work|api\/work)[^"'<>\s]+/g;
    let matched;
    while ((matched = regex.exec(source))) {
      const raw = matched[0];
      if (!/workId=/i.test(raw) && !/workid=/i.test(raw)) continue;
      const absolute = net.toAbsoluteUrl(raw);
      if (absolute) urls.add(absolute);
    }
    return [...urls];
  }

  async function fetchTaskQuestions(context, entry, task, options) {
    const candidateUrls = net.buildWorkUrls({ ...context, knowledgeId: entry.knowledgeId }, task);
    const attempts = [];

    const checkPause = async () => {
      if (!job || job.stopped) throw new net.XError('任务已停止', 'STOPPED');
      if (job.paused) {
        const keepGoing = await waitWhilePaused();
        if (!keepGoing) throw new net.XError('任务已停止', 'STOPPED');
      }
    };

    const acceptPage = (doc, pageUrl, via) => {
      const parsed = parseFetchedPage(doc, pageUrl, entry, task);
      attempts.push({
        url: pageUrl,
        via,
        status: 'ok',
        count: parsed.questions.length,
        adapter: parsed.adapter
      });
      if (!parsed.questions.length) return null;
      return {
        questions: parsed.questions,
        adapter: parsed.adapter,
        warnings: parsed.warnings,
        sourceUrl: pageUrl,
        attempts
      };
    };

    // 第一阶段：用 fetch 逐个尝试候选地址（403 不重试，速度很快）。
    // 如果拿到的是 JS/iframe 跳转壳，会把里面的真实题目页 URL 继续加进队列。
    let networkFailures = 0;
    let forbiddenFailures = 0;
    let fetchAttempts = 0;
    const pending = [...candidateUrls];
    const tried = new Set();
    while (pending.length && fetchAttempts < 12) {
      const url = pending.shift();
      if (!url || tried.has(url)) continue;
      tried.add(url);
      fetchAttempts++;
      await checkPause();
      try {
        const page = await net.fetchHtmlDoc(url, options);
        const accepted = acceptPage(page.doc, page.url, 'fetch');
        if (accepted) return accepted;
        const redirects = extractWorkRedirectUrls(page.text);
        for (const redirect of redirects.reverse()) {
          if (!tried.has(redirect)) pending.unshift(redirect);
        }
      } catch (error) {
        if (fatalError(error) || (error && error.code === 'STOPPED')) throw error;
        attempts.push({ url, via: 'fetch', error: describeAttemptError(error) });
        if (error && error.code === 'FORBIDDEN') {
          forbiddenFailures++;
          // 前 3 个候选都被 403，大概率是 WAF/登录策略拒绝了 fetch，直接进 iframe 兜底。
          if (forbiddenFailures >= 3) break;
        }
        if (error && (error.code === 'TIMEOUT' || error.code === 'NETWORK')) {
          networkFailures++;
          // 连续两个网络超时就不要再把候选地址都试一遍了。
          if (networkFailures >= 2) break;
        }
      }
    }

    // 第二阶段：隐藏 iframe 真实导航兜底（前两个候选地址足够覆盖主路由）。
    // 只读页面、不发提交请求；某些风控策略会放行导航请求但拒绝 fetch。
    for (const url of candidateUrls.slice(0, 2)) {
      await checkPause();
      try {
        const page = await loadDocViaIframe(url, Math.min(options.timeout || 15000, 10000));
        const accepted = acceptPage(page.doc, page.url, 'iframe');
        if (accepted) return accepted;
        // 有些新版页面会在 iframe load 之后才异步填题目，再等一会儿重试一次。
        await net.sleep(800);
        const retried = acceptPage(page.doc, page.url, 'iframe-retry');
        if (retried) return retried;
      } catch (error) {
        if (fatalError(error) || (error && error.code === 'STOPPED')) throw error;
        attempts.push({ url, via: 'iframe', error: describeAttemptError(error) });
      }
    }

    // 第三阶段：如果用户此刻正好打开着该任务对应的页面，直接用当前 DOM 兜底。
    // 只在 workId 能在当前页面找到时使用，避免把别的章节题目混进来。
    try {
      const liveDocs = frames.collectDocuments();
      const liveWorkLinks = frames.scanDomWorkLinks();
      const liveMatch =
        liveWorkLinks.some((item) => String(item.workId) === String(task.workId)) ||
        liveDocs.some((doc) => {
          try {
            return String(doc.URL || '').indexOf(String(task.workId)) >= 0;
          } catch (e) {
            return false;
          }
        });
      if (liveMatch) {
        const liveMeta = {
          chapterTitle: entry.title,
          knowledgeId: entry.knowledgeId,
          workId: task.workId,
          sourceUrl: location.href
        };
        const live = parsers.parseLiveDocuments(liveDocs, liveMeta);
        if (live.questions.length) {
          attempts.push({ url: location.href, via: 'live-dom', status: 'ok', count: live.questions.length, adapter: live.adapter });
          return {
            questions: live.questions,
            adapter: live.adapter,
            warnings: [...new Set([...(live.warnings || []), '使用了当前已打开页面的 DOM 提取'])],
            sourceUrl: location.href,
            attempts
          };
        }
      }
    } catch (error) {
      /* live 兜底失败不影响主流程 */
    }

    const errorEntries = attempts.filter((attempt) => attempt.error);
    const allForbidden =
      errorEntries.length > 0 &&
      attempts.every((attempt) => !attempt.status && /FORBIDDEN|403/.test(attempt.error || ''));
    const allNetwork =
      errorEntries.length > 0 &&
      attempts.every((attempt) => !attempt.status && /TIMEOUT|NETWORK/.test(attempt.error || ''));
    let message = '题目页解析为空（所有候选地址都没解析出题目）';
    let code = 'PARSE_EMPTY';
    if (allForbidden) {
      message = '所有候选地址都被拒绝（403），可能触发了风控';
      code = 'FORBIDDEN';
    } else if (allNetwork) {
      message = '无法访问题目页（网络超时）';
      code = 'NETWORK';
    }
    const failure = new net.XError(message, code);
    failure.attempts = attempts;
    throw failure;
  }

  // ============================== 结果合并 / 去重 ==============================

  function mergeQuestions(questions, entry, task, sourceUrl, adapter, warnings) {
    let added = 0;
    let duplicates = 0;
    let answersFilled = 0;

    for (const question of questions) {
      const copy = { ...question };
      copy.knowledgeId = entry.knowledgeId;
      copy.chapterTitle = entry.title;
      copy.workId = task.workId;
      copy.sourceUrl = sourceUrl || copy.sourceUrl;
      copy.adapter = adapter || copy.adapter;
      copy.warnings = [...new Set([...(copy.warnings || []), ...(warnings || [])])];

      const existing = resultIndex.get(copy.hash);
      if (existing) {
        duplicates++;
        if (!existing.correctAnswer && copy.correctAnswer) {
          existing.correctAnswer = copy.correctAnswer;
          existing.answered = true;
          answersFilled++;
        }
        if (!existing.myAnswer && copy.myAnswer) existing.myAnswer = copy.myAnswer;
        if (!existing.analysis && copy.analysis) existing.analysis = copy.analysis;
        if (!existing.knowledgePoint && copy.knowledgePoint) existing.knowledgePoint = copy.knowledgePoint;
        if ((!existing.options || !existing.options.length) && copy.options.length) existing.options = copy.options;
        continue;
      }
      results.push(copy);
      resultIndex.set(copy.hash, copy);
      added++;
    }

    state.stats.duplicateQuestions += duplicates;
    return { added, duplicates, answersFilled };
  }

  // ============================== 任务主流程 ==============================

  async function discoverTasks(context, entry) {
    const options = net.getOptions();
    const cardsResult = await net.fetchTaskAttachments(context, entry.knowledgeId, options);
    let tasks = net.tasksFromAttachments(cardsResult.attachments, cardsResult.apiWorkUrls, cardsResult.defaults);

    entry.cardScan = {
      scanned: cardsResult.scanned,
      attachments: cardsResult.attachments.length,
      apiWorkUrls: Array.isArray(cardsResult.apiWorkUrls) ? cardsResult.apiWorkUrls.length : 0,
      stopReason: cardsResult.stopReason
    };

    if (!tasks.length) {
      // cards 接口没拿到任务时才用 DOM 兜底（只对当前已打开的章节有效）。
      const domTasks = frames.scanDomWorkLinks().filter((task) => {
        if (!task.knowledgeId) return true;
        return String(task.knowledgeId) === String(entry.knowledgeId);
      });
      tasks = domTasks;
      if (tasks.length) addLog('warn', `cards 接口没有返回任务，改用页面 DOM 兜底发现 ${tasks.length} 个任务。`);
    }

    // 不同任务点可能返回同一批任务，整体去重。
    return tasks.filter((task) => {
      const key = `${task.workId}|${task.jobId}`;
      if (seenTaskKeys.has(key)) return false;
      seenTaskKeys.add(key);
      return true;
    });
  }

  async function runJob() {
    const context = state.course;
    const options = net.getOptions();
    let abortedForPause = false;
    let forbiddenStreak = 0;

    try {
      outer: while (job && !job.stopped && job.entryIndex < state.entries.length) {
        const entry = state.entries[job.entryIndex];

        if (entry.status === 'done' || entry.status === 'failed' || entry.status === 'no-task') {
          job.entryIndex++;
          job.taskIndex = 0;
          continue;
        }

        if (!(await waitWhilePaused())) break;

        entry.status = 'running';
        state.progress.entryIndex = job.entryIndex;
        refreshProgress();
        notify('progress');

        if (!Array.isArray(entry._tasks)) {
          addLog('info', `第 ${job.entryIndex + 1}/${state.entries.length} 个任务点：${entry.title}（读取任务卡…）`);
          try {
            entry._tasks = await discoverTasks(context, entry);
            entry.taskCount = entry._tasks.length;
            entry._taskIndex = 0;
            if (!entry._tasks.length) {
              entry.status = 'no-task';
              entry.error = '未发现测验任务';
              addLog(
                'warn',
                `第 ${job.entryIndex + 1} 个任务点未发现测验任务（cards 扫描 ${entry.cardScan ? entry.cardScan.scanned : 0} 张卡，返回 ${entry.cardScan ? entry.cardScan.attachments : 0} 个附件，停止原因 ${entry.cardScan ? entry.cardScan.stopReason : 'unknown'}）。如果该章节确实有测验，请打开该章节后用“提取当前页”，并导出页面存档反馈。`
              );
              refreshProgress();
              notify('progress');
              job.entryIndex++;
              job.taskIndex = 0;
              continue;
            }
            addLog(
              'ok',
              `发现 ${entry._tasks.length} 个测验任务（cards 扫描 ${entry.cardScan ? entry.cardScan.scanned : 0} 张卡 / ${entry.cardScan ? entry.cardScan.attachments : 0} 个附件）。`
            );
          } catch (error) {
            if (fatalError(error)) {
              entry.status = 'pending';
              entry.error = '';
              pauseJob(fatalReason(error), String((error && error.message) || error));
              abortedForPause = true;
              break outer;
            }
            entry.status = 'failed';
            entry.error = String((error && error.message) || error);
            addLog('error', `第 ${job.entryIndex + 1} 个任务点读取失败：${entry.error}`);
            if (error && error.code === 'FORBIDDEN') {
              forbiddenStreak++;
            } else {
              forbiddenStreak = 0;
            }
            if (forbiddenStreak >= 3) {
              pauseJob(
                'network',
                '学习通连续 3 个任务点都返回 403（可能触发了风控或登录状态异常），已自动暂停。请先在浏览器里手动打开一个章节测验确认能正常访问，必要时重新登录学习通，再点“继续采集”。'
              );
              abortedForPause = true;
              break outer;
            }
            refreshProgress();
            notify('progress');
            job.entryIndex++;
            job.taskIndex = 0;
            continue;
          }
        }

        let failedInEntry = 0;
        let doneInEntry = 0;

        for (; job.taskIndex < entry._tasks.length; job.taskIndex++) {
          if (!(await waitWhilePaused())) break outer;
          const task = entry._tasks[job.taskIndex];
          const taskKey = `${entry.knowledgeId}|${task.workId}|${task.jobId}`;
          addLog(
            'info',
            `第 ${job.entryIndex + 1} 个任务点 · 第 ${job.taskIndex + 1}/${entry._tasks.length} 个任务：${task.title}（workId ${task.workId}）`
          );
          refreshProgress();
          notify('progress');

          const record = {
            id: taskKey,
            knowledgeId: entry.knowledgeId,
            chapterTitle: entry.title,
            workId: task.workId,
            jobId: task.jobId,
            title: task.title,
            status: 'running',
            questionCount: 0,
            adapter: '',
            error: '',
            sourceUrl: '',
            warnings: []
          };
          taskRecords.push(record);

          try {
            const fetched = await fetchTaskQuestions(context, entry, task, options);
            const merged = mergeQuestions(
              fetched.questions,
              entry,
              task,
              fetched.sourceUrl,
              fetched.adapter,
              fetched.warnings
            );
            record.status = 'done';
            record.questionCount = fetched.questions.length;
            record.adapter = fetched.adapter;
            record.sourceUrl = fetched.sourceUrl;
            record.warnings = fetched.warnings || [];
            record.error = '';
            doneInEntry++;
            forbiddenStreak = 0;
            addLog(
              'ok',
              `  获取 ${fetched.questions.length} 题（新 ${merged.added}，重复 ${merged.duplicates}，适配器 ${fetched.adapter}）` +
                (fetched.warnings && fetched.warnings.length ? `；提示：${fetched.warnings[0]}` : '')
            );
          } catch (error) {
            if (fatalError(error)) {
              // 把这个任务的占位记录撤掉：继续时会重新抓取它，避免任务记录重复。
              const recordIndex = taskRecords.indexOf(record);
              if (recordIndex >= 0) taskRecords.splice(recordIndex, 1);
              pauseJob(fatalReason(error), String((error && error.message) || error));
              abortedForPause = true;
              break outer;
            }
            if (error && error.code === 'STOPPED') {
              record.status = 'failed';
              record.error = '已停止';
              break;
            }
            failedInEntry++;
            record.status = 'failed';
            record.error = String((error && error.message) || error);
            record.warnings = error && Array.isArray(error.attempts)
              ? error.attempts.map((item) => `${item.via || 'fetch'}:${item.error || (item.count != null ? 'ok(' + item.count + '题)' : '')}`)
              : [];
            const attemptSummary = error && Array.isArray(error.attempts) && error.attempts.length
              ? `（尝试 ${error.attempts.length} 个地址；${error.attempts.slice(0, 2).map((item) => `${item.via || 'fetch'}:${item.error || '空'} `).join('').trim()}）`
              : '';
            addLog('warn', `  本任务失败：${record.error}${attemptSummary}`);

            if (error && error.code === 'FORBIDDEN') {
              forbiddenStreak++;
            } else {
              forbiddenStreak = 0;
            }
            if (forbiddenStreak >= 3) {
              pauseJob(
                'network',
                '学习通连续 3 个任务都返回 403（可能触发了风控或登录状态异常），已自动暂停。请先在浏览器里手动打开一个章节测验确认能正常访问，必要时重新登录学习通，再点“继续采集”。'
              );
              abortedForPause = true;
              break outer;
            }
          }

          entry.doneTasks = doneInEntry;
          refreshProgress();
          notify('progress');
          await net.sleep(net.jitter(120, 320));
        }

        entry.doneTasks = doneInEntry;
        if (doneInEntry > 0) entry.status = 'done';
        else entry.status = 'failed';
        if (failedInEntry > 0 && doneInEntry > 0) entry.error = `${failedInEntry} 个任务失败`;
        if (!entry.error) entry.error = '';

        refreshProgress();
        notify('progress');
        job.entryIndex++;
        job.taskIndex = 0;
      }
    } catch (error) {
      state.lastError = String((error && error.message) || error);
      addLog('error', `任务编排异常：${state.lastError}`);
    } finally {
      if (abortedForPause && job) {
        // 因登录失效/验证码/风控暂停：保留 job 与已完成的进度，等待“继续”。
        job.finished = false;
        state.status = 'paused';
        refreshProgress();
        notify('paused');
        return;
      }
      const stopped = !!(job && job.stopped);
      if (job) job.finished = true;
      job = null;
      state.status = 'done';
      state.progress.entryIndex = state.entries.length;
      refreshProgress();
      addLog(
        stopped ? 'warn' : 'ok',
        `${stopped ? '采集已停止' : '采集完成'}：${state.stats.chapters} 个任务点、${taskRecords.length} 个测验、${results.length} 道题、失败 ${state.stats.failedTasks} 个任务。`
      );
      notify('done');
    }
  }

  async function startJob(rawOptions, selectedEntries) {
    if (job && !job.finished) return { ok: false, error: '已有任务在运行，请先停止' };
    if (!state.entries.length) {
      await scanCourse();
      if (!state.entries.length) {
        return { ok: false, error: '没有可采集的任务点。请先扫描课程目录。' };
      }
    }

    // 支持 dashboard 只勾选部分章节：优先按勾选的 knowledgeId 过滤。
    const baseEntries =
      Array.isArray(state.allEntries) && state.allEntries.length ? state.allEntries : state.entries;
    let jobEntries = baseEntries;
    if (Array.isArray(selectedEntries) && selectedEntries.length) {
      const selectedIds = new Set(selectedEntries.map((entry) => String(entry && entry.knowledgeId)));
      const filtered = baseEntries.filter((entry) => selectedIds.has(String(entry.knowledgeId)));
      if (filtered.length) jobEntries = filtered;
    }
    state.entries = jobEntries.map((entry, index) => ({
      knowledgeId: entry.knowledgeId,
      title: entry.title,
      index,
      taskCount: 0,
      doneTasks: 0,
      status: 'pending',
      error: ''
    }));

    net.setOptions(rawOptions || {});
    state.options = net.getOptions();
    state.status = 'running';
    state.lastError = null;
    state.pausedReason = null;
    state.logs = [];
    results = [];
    resultIndex = new Map();
    taskRecords = [];
    seenTaskKeys = new Set();
    state.stats = { chapters: state.entries.length, tasks: 0, questions: 0, failedTasks: 0, duplicateQuestions: 0 };
    state.entries.forEach((entry) => {
      entry.status = 'pending';
      entry.error = '';
      entry.taskCount = 0;
      entry.doneTasks = 0;
      delete entry._tasks;
      entry._taskIndex = 0;
    });

    job = { entryIndex: 0, taskIndex: 0, paused: false, stopped: false, startedAt: Date.now(), finished: false };
    addLog('info', `开始采集：${state.entries.length} 个任务点，请求间隔 ${state.options.minDelay}~${state.options.maxDelay}ms，超时 ${state.options.timeout}ms，重试 ${state.options.retries} 次。`);
    refreshProgress();
    notify('start');

    runJob().catch((error) => {
      addLog('error', `采集流程崩溃：${String((error && error.message) || error)}`);
      state.status = 'done';
      state.lastError = String((error && error.message) || error);
      notify('error');
    });

    return { ok: true, jobId: `job-${Date.now()}` };
  }

  // ============================== 单页提取 ==============================

  async function extractCurrent() {
    const docs = frames.collectDocuments();
    const meta = {
      chapterTitle: frames.getPageTitle(),
      sourceUrl: location.href
    };
    const result = parsers.parseLiveDocuments(docs, meta);
    return {
      ok: true,
      questions: result.questions,
      adapter: result.adapter,
      warnings: result.warnings,
      expectedTotal: result.expectedTotal || 0,
      documentUrl: result.documentUrl || ''
    };
  }

  // ============================== 消息处理 ==============================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;
    const type = message.type;

    try {
      switch (type) {
        case 'XXT_PING': {
          let catalogCount = 0;
          try {
            catalogCount = frames.scanCatalog().length;
          } catch (e) {
            catalogCount = 0;
          }
          sendResponse({
            ok: true,
            context: frames.getContext(),
            hasCatalog: catalogCount > 0,
            catalogCount,
            status: state.status,
            running: !!(job && !job.finished)
          });
          return false;
        }
        case 'XXT_SCAN': {
          scanCourse()
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ ok: false, error: String((error && error.message) || error) }));
          return true;
        }
        case 'XXT_START': {
          startJob(message.options, message.entries)
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ ok: false, error: String((error && error.message) || error) }));
          return true;
        }
        case 'XXT_PAUSE': {
          if (!job || job.finished) {
            sendResponse({ ok: false, error: '没有正在运行的任务' });
            return false;
          }
          job.paused = true;
          state.status = 'paused';
          state.pausedReason = 'manual';
          addLog('warn', '已暂停采集。');
          refreshProgress();
          notify('paused');
          sendResponse({ ok: true });
          return false;
        }
        case 'XXT_RESUME': {
          sendResponse(resumeJob());
          return false;
        }
        case 'XXT_STOP': {
          sendResponse(stopJob());
          return false;
        }
        case 'XXT_GET_STATE': {
          refreshProgress();
          sendResponse({ ok: true, state: publicState() });
          return false;
        }
        case 'XXT_GET_RESULTS': {
          const offset = Math.max(0, Number(message.offset) || 0);
          const limit = Math.max(1, Math.min(500, Number(message.limit) || 200));
          sendResponse({
            ok: true,
            total: results.length,
            offset,
            limit,
            questions: results.slice(offset, offset + limit),
            course: state.course,
            tasks: taskRecords.slice()
          });
          return false;
        }
        case 'XXT_UPDATE_ANSWER': {
          const question = results.find((item) => item.id === message.questionId);
          if (!question) {
            sendResponse({ ok: false, error: '题目不存在' });
            return false;
          }
          question.correctAnswer = parsers.normalizeAnswer(message.correctAnswer, question.type);
          question.answered = !!question.correctAnswer;
          question.reviewed = true;
          sendResponse({ ok: true, question });
          return false;
        }
        case 'XXT_EXTRACT_CURRENT': {
          extractCurrent()
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({ ok: false, error: String((error && error.message) || error) }));
          return true;
        }
        case 'XXT_SNAPSHOT': {
          const snapshot = frames.snapshot();
          snapshot.context = frames.getContext();
          snapshot.pageTitle = frames.getPageTitle();
          snapshot.catalog = frames.scanCatalog();
          snapshot.state = publicState();
          snapshot.extensionVersion = chrome.runtime.getManifest ? chrome.runtime.getManifest().version : '0.1.0';
          snapshot.userAgent = navigator.userAgent;
          sendResponse({ ok: true, snapshot });
          return false;
        }
        default:
          return false;
      }
    } catch (error) {
      sendResponse({ ok: false, error: String((error && error.message) || error) });
      return false;
    }
  });

  // ============================== 初始化 ==============================

  registerSelf();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') registerSelf();
  });
  window.addEventListener('focus', registerSelf);

  console.info('[XXT Copilot] content script 已注入：', location.href);
})();
