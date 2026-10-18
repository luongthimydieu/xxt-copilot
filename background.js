/* XXT Copilot - 后台 service worker
 * 职责：
 *  1. 点击扩展图标时打开 dashboard；
 *  2. 记录当前可用的学习通标签页（由 content script 注册），供 dashboard 查询；
 *  3. 为 content script 提供跨域 fetch 兜底（带 host_permissions 和 cookie）。
 */

const DASHBOARD_PAGE = 'dashboard/dashboard.html';
const TARGET_KEY = 'xxt_target_tab';

let dashboardTabId = null;
let targetTab = null; // { tabId, context, updatedAt }

function rememberTarget(tabId, context) {
  targetTab = { tabId, context: context || null, updatedAt: Date.now() };
  try {
    const pending = chrome.storage.session.set({ [TARGET_KEY]: targetTab });
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  } catch (e) {
    /* storage.session 不可用时仅用内存 */
  }
}

async function readTarget() {
  if (targetTab && Date.now() - targetTab.updatedAt < 6 * 60 * 60 * 1000) return targetTab;
  try {
    const data = await chrome.storage.session.get(TARGET_KEY);
    const saved = data && data[TARGET_KEY];
    if (saved && saved.tabId != null) {
      targetTab = saved;
      return saved;
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

async function tabExists(tabId) {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch (e) {
    return false;
  }
}

async function openDashboard() {
  if (dashboardTabId != null && (await tabExists(dashboardTabId))) {
    try {
      await chrome.tabs.update(dashboardTabId, { active: true });
      return;
    } catch (e) {
      dashboardTabId = null;
    }
  }
  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(DASHBOARD_PAGE) });
  dashboardTabId = tab.id;
}

chrome.action.onClicked.addListener(() => {
  openDashboard().catch((e) => console.error('[XXT] 打开控制台失败', e));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  if (message.type === 'XXT_REGISTER_TAB') {
    const tabId = sender && sender.tab && sender.tab.id;
    if (tabId != null) {
      rememberTarget(tabId, message.context || null);
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: '没有标签页信息' });
    }
    return false;
  }

  if (message.type === 'XXT_GET_TARGET') {
    readTarget()
      .then(async (target) => {
        if (!target || target.tabId == null) {
          sendResponse({ ok: false, error: '还没有发现学习通页面。请先打开学习通课程章节页，再回来重试。' });
          return;
        }
        if (!(await tabExists(target.tabId))) {
          sendResponse({ ok: false, error: '之前的学习通标签页已关闭。请重新打开课程页面。' });
          return;
        }
        sendResponse({ ok: true, tabId: target.tabId, context: target.context || null });
      })
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true;
  }

  // content script 的跨域 fetch 兜底（例如页面在 *.edu.cn 而接口在 mooc1.chaoxing.com）。
  if (message.type === 'XXT_FETCH') {
    const url = String(message.url || '');
    if (!/^https?:\/\//i.test(url)) {
      sendResponse({ ok: false, error: '非法 URL' });
      return false;
    }
    const timeout = Math.max(3000, Math.min(120000, Number(message.timeout) || 20000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    })
      .then(async (res) => {
        const text = await res.text();
        sendResponse({ ok: true, status: res.status, url: res.url, text });
      })
      .catch((e) => {
        const aborted = e && (e.name === 'AbortError' || /aborted/i.test(String(e.message)));
        sendResponse({ ok: false, error: aborted ? '请求超时' : String(e && e.message ? e.message : e) });
      })
      .finally(() => clearTimeout(timer));
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // 首次安装时给出一次性提示，不自动打开页面，避免打扰。
    console.info('[XXT Copilot] 已安装。打开任意学习通课程章节页后，点击扩展图标进入控制台。');
  }
});
