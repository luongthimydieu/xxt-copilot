/* XXT Copilot - 网络层
 * 所有请求都经过这里：串行 + 随机间隔 + 超时 + 有限重试 + 风控识别。
 */
(() => {
  'use strict';
  const XXT = (globalThis.XXT = globalThis.XXT || {});
  const net = (XXT.net = {});

  const DEFAULT_OPTIONS = {
    minDelay: 700,
    maxDelay: 1700,
    timeout: 20000,
    retries: 2,
    maxCards: 80
  };

  let options = { ...DEFAULT_OPTIONS };
  let lastRequestAt = 0;

  class XError extends Error {
    constructor(message, code, extra) {
      super(message);
      this.name = 'XError';
      this.code = code || 'UNKNOWN';
      Object.assign(this, extra || {});
    }
  }
  net.XError = XError;

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.round(number)));
  }

  net.setOptions = function setOptions(input) {
    const source = input || {};
    options = {
      minDelay: clampNumber(source.minDelay, 0, 60000, options.minDelay),
      maxDelay: clampNumber(source.maxDelay, 0, 60000, options.maxDelay),
      timeout: clampNumber(source.timeout, 3000, 120000, options.timeout),
      retries: clampNumber(source.retries, 0, 5, options.retries),
      maxCards: clampNumber(source.maxCards, 1, 200, options.maxCards)
    };
    if (options.maxDelay < options.minDelay) options.maxDelay = options.minDelay;
    return net.getOptions();
  };

  net.getOptions = function getOptions() {
    return { ...options };
  };

  net.sleep = function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  };

  function jitter(min, max) {
    const low = Math.max(0, min);
    const high = Math.max(low, max);
    return low + Math.floor(Math.random() * (high - low + 1));
  }
  net.jitter = jitter;

  /** 串行节流：保证任意两次请求之间至少间隔 minDelay~maxDelay。 */
  async function pace() {
    if (!lastRequestAt) return;
    const gap = jitter(options.minDelay, options.maxDelay);
    const wait = lastRequestAt + gap - Date.now();
    if (wait > 0) await net.sleep(wait);
    lastRequestAt = Date.now();
  }
  net.pace = pace;

  function looksLikeLoginUrl(url) {
    try {
      const parsed = new URL(url);
      if (/passport/i.test(parsed.hostname)) return true;
      if (/^\/(login|cas|sso|passport)/i.test(parsed.pathname)) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  function looksLikeCaptcha(text) {
    const sample = String(text || '').slice(0, 200000);
    if (!sample) return false;
    return /请输入验证码|输入验证码|安全验证|滑动验证|拖动滑块|人机验证|完成验证/.test(sample);
  }

  function looksLikeLoginPage(text) {
    const sample = String(text || '').slice(0, 200000);
    if (!sample) return false;
    return /请先登录|登录已过期|您还未登录|重新登录/.test(sample) && !/退出登录/.test(sample);
  }

  async function fetchOnce(url, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timer);
      if (error && (error.name === 'AbortError' || /aborted/i.test(String(error.message)))) {
        throw new XError('请求超时', 'TIMEOUT', { retryable: true });
      }
      throw new XError('网络请求失败：' + String((error && error.message) || error), 'NETWORK', { retryable: true });
    }

    try {
      const text = await response.text();
      const finalUrl = response.url || url;

      if (looksLikeLoginUrl(finalUrl) || (response.status === 200 && looksLikeLoginPage(text))) {
        throw new XError('学习通登录状态已失效，请重新登录后继续', 'LOGIN_REQUIRED');
      }
      if (response.status === 429) {
        throw new XError('请求过于频繁（429），已触发限流', 'RATE_LIMITED', { retryable: true });
      }
      if (response.status === 401) {
        throw new XError('学习通登录状态已失效（401），请重新登录后继续', 'LOGIN_REQUIRED');
      }
      if (response.status === 403) {
        // 403 可能是某个候选 URL 不被接受，也可能是风控；先记为非致命的 FORBIDDEN，
        // 由上层尝试其它候选地址/iframe 加载，连续多次才暂停。
        throw new XError('请求被拒绝（403）', 'FORBIDDEN', { status: 403 });
      }
      if (looksLikeCaptcha(text)) {
        throw new XError('页面要求验证码/安全验证，请手动完成验证后点“继续”', 'CAPTCHA');
      }
      if (!response.ok) {
        throw new XError(`HTTP ${response.status}`, 'HTTP', {
          retryable: response.status >= 500,
          status: response.status
        });
      }
      return { url: finalUrl, status: response.status, text };
    } finally {
      clearTimeout(timer);
    }
  }

  function fetchViaBackground(url, timeout) {
    return new Promise((resolve, reject) => {
      let finished = false;
      const done = (fn) => {
        if (finished) return;
        finished = true;
        fn();
      };
      chrome.runtime.sendMessage({ type: 'XXT_FETCH', url, timeout }, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          done(() => reject(new XError('后台请求失败：' + lastError.message, 'NETWORK', { retryable: true })));
          return;
        }
        if (!response || !response.ok) {
          done(() => reject(new XError(response && response.error ? response.error : '后台请求失败', 'NETWORK', { retryable: true })));
          return;
        }
        if (looksLikeLoginUrl(response.url)) {
          done(() => reject(new XError('学习通登录状态已失效，请重新登录后继续', 'LOGIN_REQUIRED')));
          return;
        }
        if (looksLikeCaptcha(response.text)) {
          done(() => reject(new XError('页面要求验证码/安全验证，请手动完成验证后点“继续”', 'CAPTCHA')));
          return;
        }
        done(() => resolve({ url: response.url, status: response.status, text: response.text }));
      });
    });
  }

  /**
   * 读取一个页面/接口的文本。
   * 失败分类：TIMEOUT / NETWORK / RATE_LIMITED / CAPTCHA / LOGIN_REQUIRED / HTTP。
   * 超时、网络错误、5xx 会自动重试，重试间隔指数退避。
   */
  net.fetchText = async function fetchText(url, overrides = {}) {
    const target = new URL(url, location.href).href;
    const retries = overrides.retries != null ? clampNumber(overrides.retries, 0, 5, options.retries) : options.retries;
    const timeout = overrides.timeout != null ? clampNumber(overrides.timeout, 3000, 120000, options.timeout) : options.timeout;

    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      await pace();
      try {
        return await fetchOnce(target, timeout);
      } catch (error) {
        lastError = error;
        // 登录/验证码不重试，直接把控制权交给任务编排层暂停任务。
        if (error && (error.code === 'LOGIN_REQUIRED' || error.code === 'CAPTCHA')) throw error;

        // 同源请求理论上不该出现 CORS；万一课程域与接口域不同，用后台兜底一次。
        if (attempt === 0 && error && error.code === 'NETWORK') {
          try {
            return await fetchViaBackground(target, timeout);
          } catch (fallbackError) {
            lastError = fallbackError;
          }
        }
        const retryable = !!(error && (error.retryable || error.code === 'TIMEOUT' || error.code === 'NETWORK'));
        if (!retryable || attempt >= retries) break;
        const backoff = 1500 * Math.pow(2, attempt) + Math.floor(Math.random() * 800);
        await net.sleep(backoff);
      }
    }
    throw lastError || new XError('请求失败', 'UNKNOWN');
  };

  /** fetch 一个 HTML 页面并解析成 DOM（DOMParser；不要用 innerHTML 注入）。 */
  net.fetchHtmlDoc = async function fetchHtmlDoc(url, overrides = {}) {
    const result = await net.fetchText(url, overrides);
    const doc = new DOMParser().parseFromString(result.text, 'text/html');
    return { doc, url: result.url, status: result.status, text: result.text };
  };

  // ============================ 课程目录 / 任务发现接口 ============================

  function getOrigin() {
    try {
      const origin = location.origin;
      if (origin && origin !== 'null') return origin;
    } catch (e) {
      /* ignore */
    }
    // 局部测试/特殊页面兜底；正常学习通页面始终使用 location.origin。
    return 'https://mooc1.chaoxing.com';
  }
  net.getOrigin = getOrigin;

  function buildCardsUrl(context, knowledgeId, num) {
    const params = new URLSearchParams({
      clazzid: String(context.clazzId || ''),
      courseid: String(context.courseId || ''),
      knowledgeid: String(knowledgeId || ''),
      num: String(num),
      ut: 's',
      cpi: String(context.cpi || ''),
      v: '2025-0424-1038-4',
      mooc2: '1',
      isMicroCourse: 'false',
      editorPreview: '0',
      crossId: 'undefined',
      _t: String(Date.now())
    });
    return new URL(`/mooc-ans/knowledge/cards?${params.toString()}`, getOrigin()).href;
  }
  net.buildCardsUrl = buildCardsUrl;

  /** 从 cards 返回的 HTML 里提取真实的工作页入口（/mooc-ans/api/work?...）。 */
  function extractWorkApiUrls(html) {
    const urls = new Set();
    const source = String(html || '').replace(/&amp;/gi, '&');
    const regex = /\/mooc-ans\/api\/work\?[^"'<>\s]+/g;
    let matched;
    while ((matched = regex.exec(source))) {
      if (/workId=/i.test(matched[0])) urls.add(matched[0]);
    }
    return [...urls];
  }
  net.extractWorkApiUrls = extractWorkApiUrls;

  function toAbsoluteUrl(value) {
    try {
      const raw = String(value || '');
      if (!raw) return '';
      if (raw.startsWith('//')) return `${location.protocol}${raw}`;
      return new URL(raw, getOrigin()).href;
    } catch (e) {
      return '';
    }
  }
  net.toAbsoluteUrl = toAbsoluteUrl;

  function extractBalancedObject(source, startAt) {
    const start = String(source || '').indexOf('{', startAt);
    if (start < 0) return '';
    let depth = 0;
    let quote = '';
    let escaped = false;
    for (let i = start; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return source.slice(start, i + 1);
      }
    }
    return '';
  }

  /** 解析 /knowledge/cards 的响应，拿到 payload.attachments。 */
  function parseCardsPayload(text) {
    const source = String(text || '')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'");
    const candidates = [];

    const assignment = /\b\$?mArg(?:Json)?\s*=\s*/gi;
    let matched;
    while ((matched = assignment.exec(source))) {
      candidates.push(source.indexOf('{', matched.index + matched[0].length));
    }

    const attachmentsAt = source.indexOf('"attachments"');
    if (attachmentsAt >= 0) {
      let index = source.lastIndexOf('{', attachmentsAt);
      let guard = 0;
      while (index >= 0 && guard < 80) {
        candidates.push(index);
        index = source.lastIndexOf('{', index - 1);
        guard++;
      }
    }

    for (const start of [...new Set(candidates)].filter((value) => value >= 0)) {
      const jsonText = extractBalancedObject(source, start);
      if (!jsonText) continue;
      try {
        const payload = JSON.parse(jsonText);
        if (payload && Array.isArray(payload.attachments)) return payload;
      } catch (e) {
        /* 继续尝试下一个起点 */
      }
    }

    // 最后兜底：整个响应就是一个 JSON。
    try {
      const payload = JSON.parse(source);
      if (payload && Array.isArray(payload.attachments)) return payload;
    } catch (e) {
      /* ignore */
    }
    return null;
  }
  net.parseCardsPayload = parseCardsPayload;

  function attachmentSignature(attachments) {
    return (attachments || [])
      .map((attachment, index) => {
        const property = (attachment && attachment.property) || {};
        return [
          attachment && attachment.type,
          attachment && attachment.jobid,
          property.workid,
          property.objectid || property.mid || property.name || index,
          attachment && attachment.enc
        ]
          .map((value) => String(value == null ? '' : value))
          .join('\u001f');
      })
      .join('\u001e');
  }

  /**
   * 逐张读取某个任务点的 cards，收集 attachments。
   * 注意：cards 的 num 是“任务卡序号”，空卡不一定是结尾（例如 1.1 的学习目标卡为空、
   * 章节测验在第 3 张卡）。因此允许连续若干张空卡，避免漏掉后面的测验。
   * stopReason: empty | repeat | limit | error
   */
  net.fetchTaskAttachments = async function fetchTaskAttachments(context, knowledgeId, overrides = {}) {
    const maxCards = clampNumber(overrides.maxCards, 1, 200, options.maxCards);
    const attachments = [];
    const seen = new Set();
    const apiWorkUrls = new Set();
    let defaults = null;
    let scanned = 0;
    let emptyStreak = 0;
    let stopReason = 'limit';

    for (let num = 0; num < maxCards; num++) {
      const url = buildCardsUrl(context, knowledgeId, num);
      let payload = null;
      let responseText = '';
      try {
        const result = await net.fetchText(url, overrides);
        responseText = result.text;
        payload = parseCardsPayload(result.text);
        if (!payload) throw new XError('cards 响应中找不到 attachments（可能页面模板已变化）', 'PARSE');
      } catch (error) {
        if (error && (error.code === 'LOGIN_REQUIRED' || error.code === 'CAPTCHA' || error.code === 'RATE_LIMITED')) throw error;
        stopReason = 'error';
        if (num === 0) throw error;
        break;
      }

      if (payload.defaults && typeof payload.defaults === 'object') {
        defaults = defaults || payload.defaults;
      }
      extractWorkApiUrls(responseText).forEach((apiUrl) => apiWorkUrls.add(apiUrl));

      const list = payload.attachments;
      if (!list || !list.length) {
        emptyStreak++;
        // 还没找到任何附件时多给一张空卡的机会（1.1 的学习目标卡为空，测验在第 3 张卡）；
        // 已经找到附件后，连续 2 张空卡就认为到底了，减少无效请求。
        const emptyTolerance = scanned > 0 ? 2 : 3;
        if (emptyStreak >= emptyTolerance) {
          stopReason = 'empty';
          break;
        }
        continue;
      }
      emptyStreak = 0;
      const signature = attachmentSignature(list);
      if (!signature || seen.has(signature)) {
        stopReason = 'repeat';
        break;
      }
      seen.add(signature);
      scanned++;
      for (const attachment of list) attachments.push(attachment);
    }

    return { attachments, scanned, stopReason, defaults, apiWorkUrls: [...apiWorkUrls] };
  };

  /**
   * 用 cards 返回的 defaults（ktoken/cpi/clazzId 等）拼出真实工作页入口。
   * 学习通新版题目页是 /mooc-ans/api/work?needRedirect=true...，会 302 到阅卷/答题页。
   */
  function buildApiWorkUrl(context, workId, jobId, enc, defaults) {
    const extra = defaults || {};
    const params = new URLSearchParams({
      api: '1',
      workId: String(workId || ''),
      jobid: String(jobId || ''),
      originJobId: String(jobId || ''),
      needRedirect: 'true',
      skipHeader: 'true',
      knowledgeid: String(context.knowledgeId || extra.knowledgeid || ''),
      ktoken: String(extra.ktoken || ''),
      cpi: String(context.cpi || extra.cpi || ''),
      ut: 's',
      clazzId: String(context.clazzId || extra.clazzId || ''),
      type: '',
      enc: String(enc || ''),
      utenc: String(extra.utenc || ''),
      mooc2: '1',
      courseid: String(context.courseId || extra.courseid || '')
    });
    return new URL(`/mooc-ans/api/work?${params.toString()}`, getOrigin()).href;
  }
  net.buildApiWorkUrl = buildApiWorkUrl;

  /** attachments → 统一的任务结构（只保留 workid 类型）。 */
  net.tasksFromAttachments = function tasksFromAttachments(attachments, apiWorkUrls, defaults) {
    const tasks = [];
    const seen = new Set();
    const apiUrls = Array.isArray(apiWorkUrls) ? apiWorkUrls : [];

    for (const attachment of attachments || []) {
      if (!attachment || attachment.type !== 'workid') continue;
      const property = attachment.property || {};
      const rawJobId = attachment.jobid || property._jobid || property.jobid || '';
      const workId = String(property.workid || rawJobId || '').replace(/^work-/, '');
      if (!workId) continue;
      const jobId = String(rawJobId || `work-${workId}`);
      const key = `${workId}|${jobId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // 优先使用 cards HTML 里真实渲染出来的 api/work 入口（带 ktoken/utenc 等完整参数）。
      let apiWorkUrl = '';
      for (const candidate of apiUrls) {
        try {
          const parsed = new URL(candidate, getOrigin());
          const candidateWorkId = String(parsed.searchParams.get('workId') || '');
          const candidateJobId = String(parsed.searchParams.get('jobid') || '');
          if (
            (candidateWorkId && (candidateWorkId === workId || candidateWorkId === jobId)) ||
            (candidateJobId && (candidateJobId === jobId || candidateJobId === `work-${workId}`))
          ) {
            apiWorkUrl = toAbsoluteUrl(candidate);
            break;
          }
        } catch (e) {
          /* ignore */
        }
      }
      if (!apiWorkUrl) {
        apiWorkUrl = buildApiWorkUrl(
          { ...(defaults || {}), knowledgeId: defaults && defaults.knowledgeid },
          workId,
          jobId,
          attachment.enc || property.enc || '',
          defaults
        );
      }

      tasks.push({
        workId,
        jobId,
        enc: String(attachment.enc || property.enc || ''),
        apiWorkUrl,
        cardsDefaults: defaults || null,
        title:
          framesNormalize(property.title || property.name || attachment.title) ||
          `测验 ${workId}`,
        raw: attachment
      });
    }
    return tasks;
  };

  function framesNormalize(value) {
    return String(value == null ? '' : value)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  /** 题目页候选地址：不同学习通版本路由/参数不一样，逐个尝试。 */
  net.buildWorkUrls = function buildWorkUrls(context, task) {
    const origin = getOrigin();
    const base = {
      workId: task.workId,
      courseId: context.courseId,
      clazzId: context.clazzId,
      knowledgeId: context.knowledgeId,
      cpi: context.cpi,
      ut: 's'
    };
    const withJob = { ...base, jobId: task.jobId, enc: task.enc };
    const query = (source, extra) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries({ ...source, ...extra })) {
        if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
      }
      return params.toString();
    };

    const urls = [
      // 0. cards 页面真实渲染出来的工作页入口（最高优先级）
      task.apiWorkUrl || '',
      // 1. 用 cards 的 defaults/ktoken 拼出的新版入口（会 302 到阅卷/答题页）
      buildApiWorkUrl({ ...context, knowledgeId: context.knowledgeId || (task.cardsDefaults && task.cardsDefaults.knowledgeid) }, task.workId, task.jobId, task.enc, task.cardsDefaults || {}),
      // 2. 旧版作业详情/阅卷页（suyu 脚本验证过的路由）
      `${origin}/mooc-ans/work/view?${query(withJob, { mooc2: 1 })}`,
      `${origin}/mooc-ans/work/view?${query(withJob)}`,
      // 3. 去掉 jobId/enc 的简版，排除“加密参数不匹配导致 403”的可能
      `${origin}/mooc-ans/work/view?${query(base, { mooc2: 1 })}`,
      `${origin}/mooc-ans/work/view?${query(base)}`,
      // 4. 新版阅卷/答题页
      `${origin}/mooc-ans/mooc2/work/view?${query(withJob, { mooc2: 1 })}`,
      `${origin}/mooc-ans/mooc2/work/dowork?${query(withJob, { classId: context.clazzId })}`,
      `${origin}/mooc-ans/work/doHomeWorkNew?${query(withJob, { classId: context.clazzId })}`,
      `${origin}/mooc-ans/mooc2/work/dowork?${query(withJob, { clazzId: context.clazzId })}`,
      `${origin}/mooc-ans/work/doHomeWorkNew?${query(withJob, { clazzId: context.clazzId })}`,
      `${origin}/mooc-ans/mooc2/work/dowork?${query(base, { classId: context.clazzId })}`,
      `${origin}/mooc-ans/work/doHomeWorkNew?${query(base, { classId: context.clazzId })}`,
      `${origin}/mooc-ans/work/phone/work?${query(withJob, { mooc2: 1 })}`,
      `${origin}/mooc-ans/work/phone/work?${query(base, { mooc2: 1 })}`
    ].filter(Boolean);
    return [...new Set(urls)];
  };
})();
