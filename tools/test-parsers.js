/*
 * 解析器回归测试（Node + jsdom）
 * 运行：node tools/test-parsers.js
 * 依赖 jsdom（若环境中没有，会打印 SKIP 并以 0 退出）。
 *
 * 覆盖：
 *  1. 截图同款「章节测验已批阅」页面 → 1 道判断题，答案“错”；
 *  2. display:none 的旧题目不应该被采集（旧脚本出现 3 道题、题干是“1”的回归）；
 *  3. 多选题页面 → 题型/选项/答案正确；
 *  4. 题号单独成行（"1" 一行、题干下一行）也能解析。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let JSDOM = null;
try {
  ({ JSDOM } = require('jsdom'));
} catch (error) {
  console.log('SKIP: 当前环境没有安装 jsdom，跳过解析器测试（不影响扩展运行）。');
  process.exit(0);
}

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  URL,
  URLSearchParams,
  TextEncoder,
  TextDecoder,
  location: { href: 'https://mooc1.chaoxing.com/' },
  navigator: { userAgent: 'node-test' }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'content', 'parsers.js'), 'utf8'),
  sandbox,
  { filename: 'parsers.js' }
);
const P = sandbox.XXT.parsers;

function parse(html, meta) {
  const dom = new JSDOM(html, {
    url: (meta && meta.sourceUrl) || 'https://mooc1.chaoxing.com/mooc-ans/work/view?workId=1'
  });
  sandbox.location = dom.window.location;
  sandbox.document = dom.window.document;
  return P.parseDocument(dom.window.document, meta || {});
}

let failed = 0;
function assert(condition, message) {
  if (!condition) {
    failed++;
    console.error('  ✗ ' + message);
  } else {
    console.log('  ✓ ' + message);
  }
}

// ---------------- 用例 1：截图同款已批阅判断题页 ----------------
console.log('用例 1：章节测验已批阅页（判断题）');
const case1 = parse(
  `
  <div class="mark_item">
    <div class="type_tit">一、判断题（共1题）</div>
    <div class="questionLi">
      <div class="Zy_TItle"><span class="qtContent">1 【判断题】群体规范是明文规定的规章制度。</span></div>
      <div class="mark_answer">
        <div class="mark_key"><span class="colorDeep"><span class="stuAnswerContent">错</span></span></div>
        <div class="mark_key"><span class="colorGreen">正确答案：错</span></div>
      </div>
      <div class="knowledgePoint">知识点：群体规范</div>
    </div>
  </div>
  `,
  { chapterTitle: '群体规范', knowledgeId: '1001', workId: 'w1', sourceUrl: 'https://mooc1.chaoxing.com/mooc-ans/work/view?workId=w1' }
);
assert(case1.questions.length === 1, '解析出 1 道题，实际 ' + case1.questions.length);
if (case1.questions[0]) {
  const q = case1.questions[0];
  assert(q.type === 'judge', '题型为判断，实际 ' + q.type);
  assert(q.stem.indexOf('群体规范是明文规定的规章制度') >= 0, '题干完整，实际：' + q.stem);
  assert(q.correctAnswer === '错', '正确答案为“错”，实际：' + q.correctAnswer);
  assert(q.myAnswer === '错', '我的答案为“错”，实际：' + q.myAnswer);
  assert(q.knowledgePoint.indexOf('群体规范') >= 0, '知识点已提取，实际：' + q.knowledgePoint);
}

// ---------------- 用例 2：隐藏的旧题目不应污染结果（旧脚本回归） ----------------
console.log('用例 2：隐藏旧题目 + 可见题目');
const case2 = parse(
  `
  <div class="mark_item">
    <div class="type_tit">一、判断题（共1题）</div>
    <div class="questionLi">
      <div class="Zy_TItle"><span class="qtContent">1 【判断题】可见的题目。</span></div>
      <div class="mark_answer"><div class="mark_key"><span class="colorGreen">正确答案：对</span></div></div>
    </div>
  </div>
  <div class="aiArea" style="display:none">
    <div class="newTestType">一、判断题（共2题）</div>
    <div class="TiMu"><div class="Zy_TItle"><span class="qtContent">1</span></div></div>
    <div class="TiMu"><div class="Zy_TItle"><span class="qtContent">2</span></div></div>
  </div>
  `,
  { chapterTitle: '隐藏页', knowledgeId: '1002', workId: 'w2' }
);
assert(case2.questions.length === 1, '只解析可见的 1 道题，实际 ' + case2.questions.length);
assert(case2.questions.every((q) => q.stem !== '1' && q.stem !== '2'), '题干不是题号“1/2”');

// ---------------- 用例 3：多选题 ----------------
console.log('用例 3：多选题（选项 + 答案）');
const case3 = parse(
  `
  <div class="aiArea">
    <div class="newTestType">二、多选题（共1题）</div>
    <div class="TiMu">
      <div class="Zy_TItle"><i class="fl">1</i><span class="qtContent">下列属于正式规范的有？</span></div>
      <ul class="mark_letter">
        <li><span class="num_option" data="A">A</span><p>规章制度</p></li>
        <li><span class="num_option" data="B">B</span><p>风俗习惯</p></li>
        <li><span class="num_option" data="C">C</span><p>法律条文</p></li>
      </ul>
      <div class="mark_answer"><div class="rightAnswerContent">正确答案：AC</div></div>
    </div>
  </div>
  `,
  { chapterTitle: '规范', knowledgeId: '1003', workId: 'w3' }
);
assert(case3.questions.length === 1, '解析出 1 道题，实际 ' + case3.questions.length);
if (case3.questions[0]) {
  const q = case3.questions[0];
  assert(q.type === 'multiple', '题型为多选，实际 ' + q.type);
  assert(q.options.length === 3, '选项 3 个，实际 ' + q.options.length);
  assert(q.correctAnswer === 'AC', '答案 AC，实际 ' + q.correctAnswer);
}

// ---------------- 用例 4：题号单独一行 ----------------
console.log('用例 4：题号单独成行');
const case4 = parse(
  `
  <div class="aiArea">
    <div class="newTestType">一、单选题（共1题）</div>
    <div class="TiMu">
      <div class="Zy_TItle"><span class="qtContent">1</span></div>
      <p>以下哪个是正式规范？</p>
      <ul class="mark_letter">
        <li><span class="num_option" data="A">A</span><p>公司制度</p></li>
        <li><span class="num_option" data="B">B</span><p>打招呼</p></li>
      </ul>
      <div class="mark_answer"><div class="rightAnswerContent">正确答案：A</div></div>
    </div>
  </div>
  `,
  { chapterTitle: '单独题号', knowledgeId: '1004', workId: 'w4' }
);
assert(case4.questions.length === 1, '解析出 1 道题，实际 ' + case4.questions.length);
if (case4.questions[0]) {
  const q = case4.questions[0];
  assert(q.stem.indexOf('正式规范') >= 0, '题干来自下一行，实际：' + q.stem);
  assert(q.correctAnswer === 'A', '答案 A，实际：' + q.correctAnswer);
}

console.log('');
if (failed > 0) {
  console.error(`FAIL: ${failed} 个断言失败`);
  process.exit(1);
}
console.log('PASS: 全部解析器断言通过');
