# XXT Copilot 隐私政策 / Privacy Policy

**生效日期：2026-10-18**
**开发者：XXT Copilot 开发者（请替换为你的发布者名称）**
**联系邮箱：请替换为你的联系邮箱**

## 中文

### 1. 这个扩展是什么
XXT Copilot（以下简称“本扩展”）是一个运行在 Microsoft Edge / Chromium 浏览器中的开发者模式扩展。它的用途是：在用户**已经正常登录**的学习通（超星/泛雅）课程页面中，**只读**整理用户自己有权访问的章节测验、作业题目与页面已展示的解析，并导出为用户本地的复习资料。

### 2. 我们处理哪些数据
本扩展在用户浏览器本地处理以下数据，**不会上传到任何服务器**：

- 用户主动操作时，当前学习通页面及其同源 iframe 中的课程名称、章节名称、题目、选项、页面已展示的答案/解析、知识点；
- 用户为排障主动导出的“页面存档”（其中可能包含上述课程内容与页面上的个人信息）；
- 用户在本扩展控制台中的设置（请求间隔、超时、重试次数等）。

本扩展**不收集**：账号密码、Cookies、通讯录、位置、浏览历史、剪贴板内容、支付信息。

### 3. 数据存储在哪里
- 采集结果保存在**当前页面的内存**中，刷新页面或关闭标签页即清空；
- 设置保存在浏览器本地存储（`chrome.storage.local`），卸载扩展或清除扩展数据后删除；
- 用户主动导出的 Markdown / JSON / CSV / 打印视图 / 页面存档文件，由浏览器下载到用户本机默认下载目录，完全由用户自行保管。

### 4. 数据是否共享给第三方
**不会。** 本扩展没有服务器、没有账号体系、没有遥测/统计/崩溃上报、没有广告，也不会把任何数据发送给开发者或第三方。

### 5. 权限说明
- `storage`：保存用户的采集设置；
- 对 `*.chaoxing.com`、`*.xuexitong.com`、`*.edu.cn` 的网站访问权限：仅用于在用户主动打开的学习通课程页面里读取页面内容、请求同一学习通站点的数据接口，实现“整理题目”这一单一用途；
- 本扩展不申请 `downloads`、`tabs`、`scripting` 等与核心功能无关的权限。

### 6. 用户控制
用户可以随时暂停/停止采集、关闭控制台、刷新页面清空内存数据、卸载扩展清除本地设置，并自行决定是否导出以及把导出的文件发给谁。本扩展**不会**自动提交作业、考试或修改平台上的任何数据。

### 7. 未成年人
本扩展不是面向 13 岁以下儿童的产品。

### 8. 安全
本扩展不使用远程代码，不加载外部脚本，符合 Manifest V3 的内容安全策略。所有代码都包含在扩展安装包中，可被审查。

### 9. 免责声明
本扩展与超星、学习通、泛雅及各学校**无任何隶属或合作关系**。用户应自行确认使用本工具符合所在学校规定与平台用户协议；因使用本工具产生的任何后果由用户自行承担。

### 10. 政策更新
如本政策发生变化，会更新本页面的“生效日期”。继续使用即表示接受更新后的政策。

---

## English (summary)

XXT Copilot is a local-only browser extension that organizes course questions and explanations **you already have access to** in Chaoxing/Xuexitong pages into local study documents. It does **not** collect, transmit, sell, or share personal data; it has no server, no telemetry, no ads, and no account system. Settings are stored locally via `chrome.storage.local`; extraction results live in page memory and are cleared on refresh. Exported files are saved by your browser to your own download folder. The extension does not auto-answer, submit assignments, or modify platform data. It is not affiliated with Chaoxing, Xuexitong, Fanya, or any school. Contact: [your email].
