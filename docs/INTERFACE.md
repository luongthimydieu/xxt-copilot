# XXT Copilot 扩展内部接口约定（v0.1）

> 本文件由 Lead 维护，是 content script、dashboard、文档三方共同遵守的契约。
> 任何一方修改接口，必须先通知 Lead。

## 1. 项目目标

Edge/Chromium Manifest V3 扩展：在学习通课程页上，**只读**采集整门课的章节测验/作业题目与官方答案，本地整理、校对、导出。

三条硬性设计原则：

1. **不做模拟点击翻页**。整门课的任务发现走平台自己的接口（`/mooc-ans/knowledge/cards`），题目页用 `fetch` 拉 HTML 后用 `DOMParser` 解析，避免“点下一节/找底部任务栏”这种脆弱逻辑。
2. **失败可诊断**。每个任务失败都必须记录到日志（原因分类 + URL），并支持导出页面 HTML 存档，方便后续写适配器。
3. **反爬优先**。串行请求 + 随机延迟 + 超时（AbortController）+ 有限重试 + 指数退避；识别验证码/登录失效时暂停并提示，不硬闯。

## 2. 目录与负责人

```text
xxt-copilot/
  manifest.json                 [Lead]
  background.js                 [Lead]
  content/frames.js             [Lead]   帧遍历、目录扫描、页面快照
  content/net.js                [Lead]   带超时/重试/限速的请求、cards API、URL 构造
  content/parsers.js            [Lead]   多适配器题目解析 + 质量校验
  content/content.js            [Lead]   任务编排、消息协议、单页提取
  dashboard/dashboard.html      [dashboard-dev]
  dashboard/dashboard.css       [dashboard-dev]
  dashboard/dashboard.js        [dashboard-dev]
  dashboard/export.js           [dashboard-dev]
  README.md                     [docs-writer]
  INSTALL.md                    [docs-writer]
  docs/SNAPSHOT.md              [docs-writer]
  docs/QA-CHECKLIST.md          [docs-writer]
  tools/package.ps1             [Lead]
```

**写权限隔离**：dashboard-dev 只写 `dashboard/`；docs-writer 只写 `README.md`、`INSTALL.md`、`docs/`（不含 `docs/INTERFACE.md`）；Lead 写其余文件。任何人不要修改别人的文件。

## 3. 消息协议

### 3.1 dashboard → 后台 service worker

```js
chrome.runtime.sendMessage({ type: 'XXT_GET_TARGET' })
// => { ok: true, tabId: 123 } 或 { ok: false, error: '请先打开学习通课程页面' }
```

### 3.2 dashboard → content script（用 chrome.tabs.sendMessage(tabId, msg)）

所有请求顶层 frame 才响应，返回 Promise 风格回调结果。

```js
// 连通性 + 当前课程上下文
{ type: 'XXT_PING' }
// => { ok: true, context: { courseId, clazzId, cpi, title, url }, hasCatalog: true }

// 扫描课程目录（可能 2~5 秒）
{ type: 'XXT_SCAN' }
// => { ok: true, course: { courseId, clazzId, cpi, title }, entries: [Entry] }
// Entry: { knowledgeId: string, title: string, index: number }

// 开始采集整门课
{ type: 'XXT_START', options: {
    minDelay: 600,        // ms，相邻两次请求最小间隔
    maxDelay: 1500,       // ms，随机上限
    timeout: 20000,       // 单请求超时
    retries: 2,           // 失败重试次数
    maxCards: 80,         // 单个任务点最多翻多少张卡
    skipAnsweredOnly: false
  } }
// => { ok: true, jobId: 'job-...' }

{ type: 'XXT_PAUSE' }   // => { ok: true }
{ type: 'XXT_RESUME' }  // => { ok: true }
{ type: 'XXT_STOP' }    // => { ok: true }

// 轮询状态（运行中每 800ms 一次）
{ type: 'XXT_GET_STATE' }
// => { ok: true, state: State }

// 分页取结果
{ type: 'XXT_GET_RESULTS', offset: 0, limit: 200 }
// => { ok: true, total: 123, questions: [Question], course: Course, tasks: [Task] }

// 在线修改某题答案（校对用）
{ type: 'XXT_UPDATE_ANSWER', questionId: '...', correctAnswer: 'AB' }
// => { ok: true }

// 单页提取：从当前已打开的页面（含同源 iframe）提取题目
{ type: 'XXT_EXTRACT_CURRENT' }
// => { ok: true, questions: [Question], adapter: 'review'|'timu'|'generic'|..., warnings: [] }

// 导出页面结构存档（排障用）。由 dashboard 下载为 JSON 文件
{ type: 'XXT_SNAPSHOT' }
// => { ok: true, snapshot: { capturedAt, url, context, frames: [{url, title, html}], entries, logs } }
```

### 3.3 content → dashboard 进度事件（可选，dashboard 可只轮询）

```js
chrome.runtime.sendMessage({ type: 'XXT_EVENT', event: 'progress' | 'log' | 'done' | 'error', state: State })
```

dashboard 监听 `chrome.runtime.onMessage`，收到 `XXT_EVENT` 时直接刷新界面（轮询作为兜底）。

## 4. 数据结构

### Course

```js
{ courseId: '267267643', clazzId: '155149418', cpi: '4850085533', title: '组织行为学', url: 'https://mooc1.chaoxing.com/...' }
```

### State（GET_STATE 返回）

```js
{
  status: 'idle' | 'scanning' | 'ready' | 'running' | 'paused' | 'stopping' | 'done' | 'error',
  course: Course | null,
  entries: [{
    knowledgeId: string, title: string, index: number,
    taskCount: number,          // 发现的测验任务数，未发现时 0
    doneTasks: number,
    status: 'pending' | 'running' | 'done' | 'failed' | 'no-task'
  }],
  progress: { entryIndex: number, entryTotal: number, tasksDone: number, tasksFailed: number, questions: number },
  stats: { chapters: number, tasks: number, questions: number, failedTasks: number, duplicateQuestions: number },
  logs: [{ time: 'HH:MM:SS', level: 'info'|'warn'|'error'|'ok', message: string }],
  lastError: string | null,
  pausedReason: string | null,   // 'captcha' | 'login' | 'network' | null
  options: { minDelay, maxDelay, timeout, retries, maxCards }
}
```

### Task

```js
{ knowledgeId, chapterTitle, workId, jobId, status: 'done'|'failed', questionCount, error, sourceUrl }
```

### Question

```js
{
  id: 'q-...',                 // 稳定 hash
  knowledgeId: '...',
  chapterTitle: '群体规范',
  workId: '...',
  type: 'single' | 'multiple' | 'judge' | 'fill' | 'short' | 'unknown',
  typeLabel: '单选题' | '多选题' | '判断题' | '填空题' | '简答题' | '未知题型',
  stem: '群体规范是明文规定的规章制度。',
  options: [{ letter: 'A', text: '...' }, ...],   // 判断/填空/简答为 []
  myAnswer: '错',
  correctAnswer: '错',
  analysis: '',
  knowledgePoint: '群体规范',
  images: ['https://...'],
  sourceUrl: 'https://mooc1.chaoxing.com/mooc-ans/work/view?...',
  adapter: 'review' | 'timu' | 'questionli' | 'phone' | 'generic' | 'live',
  warnings: ['选项缺失'],
  answered: true,              // correctAnswer 非空
  reviewed: false,             // 用户是否已校对
  hash: '...'
}
```

## 5. dashboard 实现要求

- 纯原生 JS + HTML + CSS，**无构建步骤、无外部 CDN**（MV3 CSP 限制）。所有文件放在 `dashboard/`，通过 `../content/...` 不需要访问。
- 打开页面地址：`chrome-extension://<id>/dashboard/dashboard.html`。由背景脚本在点击扩展图标时打开。
- 加载后：向后台取目标 tab → 发送 `XXT_PING`；失败显示空状态页“请先打开学习通课程章节页，再回到本页点击重新连接”。
- 主要区块：
  1. 顶栏：logo、连接状态、课程名、重新连接、设置、导出页面存档（排障）。
  2. 扫描区：`扫描课程目录` 按钮 → 展示 entries 列表（按 index 排序，显示 taskCount），支持全选/取消全选。
  3. 运行区：`开始采集` / `暂停` / `继续` / `停止`；进度条（entry 维度 + 任务维度）、统计卡片（章节/任务/题目/失败）。
  4. 日志区：自动滚动，按 level 着色，保留最近 200 条。
  5. 任务状态区：entries 每行的状态、任务数、失败原因。
  6. 结果区：题目表格（分页 50/页），可按章节/题型/是否已答筛选，可搜索题干；行内编辑“正确答案”，失去焦点/回车触发 `XXT_UPDATE_ANSWER`；显示答案来源（官方/空）与 warnings。
  7. 导出：Markdown（按章节、题型分组，含/不含答案两种）、JSON、CSV（带 BOM，Excel 可打开）、打印视图（新窗口 HTML，用户可打印为 PDF/Word）。
  8. 设置弹窗：minDelay/maxDelay/timeout/retries/maxCards，保存到 `chrome.storage.local`。
- **demo 模式**：URL 加 `?demo=1` 时使用内置示例 State/结果渲染全部界面，方便无学习通环境时开发预览。禁止 demo 数据进入真实逻辑。
- 状态轮询：`running`/`paused` 期间每 800ms 发送 `XXT_GET_STATE`；收到 `done`/`error` 后停止轮询。轮询失败 3 次显示“与页面的连接断开，请刷新学习通页面后重新连接”。
- 导出存档：`XXT_SNAPSHOT` 结果 + 当前 state 合成一个 JSON，用 `URL.createObjectURL` + `<a download>` 下载，文件名 `xxt-snapshot-<课程>-<时间>.json`。
- 所有用户可见文案用简体中文。样式要求：干净、密度适中、支持 1280 宽屏幕，深色/浅色跟随系统（`prefers-color-scheme`）。
- JS 必须能通过 `node --check`（纯 ES2020 语法，无 import/export；可用 IIFE 或全局函数）。

## 6. 文档要求

- `README.md`：项目定位（只读、不提交、不刷课）、功能列表、架构图（ASCII）、安装方式、使用流程、限速/超时说明、常见问题、隐私说明、已知限制、后续计划。
- `INSTALL.md`：Edge 加载解压缩步骤（edge://extensions → 开发人员模式 → 加载解压缩的扩展 → 选择 xxt-copilot 目录），以及首次使用检查清单。
- `docs/SNAPSHOT.md`：教用户如何导出页面存档并反馈；截图建议；说明存档可能包含课程内容，仅私下发给开发者。
- `docs/QA-CHECKLIST.md`：第一次真实环境验证清单（目录扫描数量、单独章节采集、断网/超时、暂停恢复、导出格式检查等）。
- 文档中的文件名、按钮名、消息名必须与源码一致；不确定时先读 `dashboard/dashboard.html` 与 `content/content.js`（Lead 完成后会存在）。

## 7. 验收

- 所有 JS 通过 `node --check`。
- dashboard 在 demo 模式能完整渲染并走完导出流程。
- 文档覆盖安装、使用、排障。
- 无任何远程脚本、无 eval、无内联事件处理器（CSP 友好）。

## 8. v0.1 落地差异（以本节为准）

本节记录实际实现与前面理想协议的差异，后续改接口时同步更新。

### 8.1 权限（manifest.json 实际值）

```json
"permissions": ["storage"],
"host_permissions": [
  "*://*.chaoxing.com/*",
  "*://*.xuexitong.com/*",
  "*://*.edu.cn/*"
]
```

没有 `downloads` / `tabs` / `scripting`。导出通过扩展页面的 `<a download>` 完成。

### 8.2 实际消息清单

dashboard → background：
- `XXT_GET_TARGET` → `{ ok, tabId, context }`

content script → background：
- `XXT_REGISTER_TAB` `{ context }`（顶层 frame 在加载/重新可见时注册，background 记住最近的学习通标签页）
- `XXT_FETCH` `{ url, timeout }` → `{ ok, status, url, text }`（同源 fetch 失败时的跨域兜底，带 cookie）

dashboard → content（`chrome.tabs.sendMessage`）：
- `XXT_PING` → `{ ok, context, hasCatalog, catalogCount, status, running }`
- `XXT_SCAN` → `{ ok, course, entries }`
- `XXT_START` `{ options, entries }` → `{ ok, jobId }`；**content 会按 `entries[].knowledgeId` 过滤采集范围**，未传 `entries` 时采集全部
- `XXT_PAUSE` / `XXT_RESUME` / `XXT_STOP`
- `XXT_GET_STATE` → `{ ok, state }`
- `XXT_GET_RESULTS` `{ offset, limit }` → `{ ok, total, offset, limit, questions, course, tasks }`
- `XXT_UPDATE_ANSWER` `{ questionId, correctAnswer }`
- `XXT_EXTRACT_CURRENT` → `{ ok, questions, adapter, warnings, expectedTotal, documentUrl }`
- `XXT_SNAPSHOT` → `{ ok, snapshot }`（含 `context/pageTitle/catalog/state/frames`）

content → dashboard（可选推送，dashboard 以 800ms 轮询为主）：
- `XXT_EVENT` `{ event, state }`

### 8.3 UI 实际文案 / 控件

- 顶栏：`重新连接`、`提取当前页`（`id=btn-extract-current`）、`设置`、`导出页面存档`
- 扫描区：`扫描课程目录`、`全选`、`取消选择`
- 控制区：`开始采集`、`暂停`、`继续`、`停止`
- 导出区：`Markdown（含答案）`、`Markdown（不含答案）`、`JSON`、`CSV（Excel）`、`打印视图`（勾选“打印包含答案”）
- 设置弹窗标题：`采集设置`；字段 `minDelay / maxDelay / timeout / retries / maxCards`
- 运行日志最多保留 300 条（内容层同样 300 条）

### 8.4 解析适配器实际名称

`markitem`、`timu`、`score-review`、`phone`、`questionli`、`text`（文本行兜底）。结果表“质量 / 适配器”列显示实际适配器名。

### 8.5 开发自测（不随扩展发布）

- `tools/parser-test.html`：在真实 Chromium DOM 下跑解析器断言（判断题截图同款页、隐藏旧题目回归、多选、题号单独成行）。
- `tools/dashboard-test.html`：`?demo=1` 的 dashboard 端到端断言（扫描、采集、单页提取、返回批量、导出函数）。
- 运行方式：用 Edge/Chrome 打开对应 HTML（或 headless `--dump-dom`），页面标题为 `PASS` 即通过。
