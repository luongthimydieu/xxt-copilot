/* XXT Copilot - 题目解析层
 *
 * 设计：多适配器 + 质量评分 + 文本行兜底。
 *  - 类名适配器负责学习通常见模板（作业详情/章节测验/新版阅卷/手机页）；
 *  - 文本行适配器负责“所有模板都能读”的兜底：把页面按块转成带换行的纯文本，
 *    再用“题型小标题 / 题号 / 选项字母 / 我的答案 / 正确答案 / 知识点”这些稳定文案
 *    切分题目。旧脚本把题号“1”当题干的问题，会被这里的质量评分淘汰。
 *  - 解析结果必须经过校验（题干有效、选择题至少 2 个选项、答案归一化），
 *    解析不到就返回空并附带 warnings，交给上层记录日志/提示导出存档。
 */
(() => {
  'use strict';
  const XXT = (globalThis.XXT = globalThis.XXT || {});
  const P = (XXT.parsers = {});

  const TYPE_LABEL = {
    single: '单选题',
    multiple: '多选题',
    judge: '判断题',
    fill: '填空题',
    short: '简答题',
    unknown: '未知题型'
  };
  P.TYPE_LABEL = TYPE_LABEL;

  const IMG_PREFIX = '\u0001IMG:';
  const TYPE_LABELS_PATTERN = '(?:单选题|多选题|判断题|填空题|简答题|论述题|问答题|计算题|分析题|名词解释|选择题)';

  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BODY', 'DD', 'DIV', 'DL', 'DT',
    'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4',
    'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION',
    'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL'
  ]);

  function normalizeSpace(value) {
    return String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/[\t\r\f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeMultiline(value) {
    return String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t\f]+/g, ' ')
      .trim();
  }

  function isHiddenByMarkup(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hasAttribute && el.hasAttribute('hidden')) return true;
    const style = String((el.getAttribute && el.getAttribute('style')) || '');
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) return true;
    const className = typeof el.className === 'string' ? el.className : '';
    if (/(^|\s)(xxt-hidden|hidden|hide|d-none)(\s|$)/i.test(className)) return true;
    return false;
  }

  /** DOM → 带换行的纯文本；图片输出为 \u0001IMG:url\u0001 占位符。 */
  function domToText(root) {
    const parts = [];
    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === 3) {
        parts.push(node.nodeValue || '');
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'SVG' || tag === 'TEMPLATE') return;
      if (isHiddenByMarkup(node)) return;
      if (tag === 'BR') {
        parts.push('\n');
        return;
      }
      if (tag === 'IMG') {
        const src = node.getAttribute('src') || node.getAttribute('data-src') || node.getAttribute('data-original') || '';
        if (src) parts.push(`\n${IMG_PREFIX}${src}\u0001\n`);
        return;
      }
      const isBlock = BLOCK_TAGS.has(tag);
      if (isBlock) parts.push('\n');
      const children = node.childNodes;
      for (let i = 0; i < children.length; i++) walk(children[i]);
      if (isBlock) parts.push('\n');
    };
    try {
      walk(root);
    } catch (e) {
      /* ignore malformed DOM */
    }
    return normalizeMultiline(parts.join(''));
  }
  P.domToText = domToText;

  function textOf(el) {
    if (!el) return '';
    return normalizeSpace(el.textContent || '');
  }

  function resolveImages(root, baseUrl) {
    const images = [];
    if (!root || !root.querySelectorAll) return images;
    let nodes = [];
    try {
      nodes = Array.from(root.querySelectorAll('img'));
    } catch (e) {
      return images;
    }
    for (const img of nodes) {
      const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original') || '';
      if (!src) continue;
      try {
        images.push(new URL(src, baseUrl || location.href).href);
      } catch (e) {
        images.push(src);
      }
    }
    return [...new Set(images)];
  }

  function classifyType(text) {
    const value = String(text || '');
    if (!value) return '';
    if (/多选|多项选择|multiple\s*choice|checkbox|多选型/i.test(value)) return 'multiple';
    if (/单选|单项选择|single\s*choice|radio|单项/i.test(value)) return 'single';
    if (/判断|正误|是非|true\s*[-/]?\s*false|judg/i.test(value)) return 'judge';
    if (/填空|fill\s*(?:in)?\s*blank/i.test(value)) return 'fill';
    if (/简答|论述|问答|计算|分析|名词解释|essay|subjective/i.test(value)) return 'short';
    if (/选择/.test(value)) return 'single';
    return '';
  }
  P.classifyType = classifyType;

  function extractTypeFromBlock(text) {
    const matched = String(text || '').match(new RegExp(`[【\\[（(]\\s*(${TYPE_LABELS_PATTERN})\\s*[】\\]）)]`));
    if (matched) return classifyType(matched[1]);
    return '';
  }

  function stripTypeLabel(text) {
    return String(text || '')
      .replace(new RegExp(`^\\s*[【\\[（(]\\s*${TYPE_LABELS_PATTERN}\\s*[】\\]）)]\\s*`), '')
      .trim();
  }

  function normalizeChoiceAnswer(raw) {
    const value = String(raw || '').toUpperCase();
    const letters = value.match(/[A-H]/g);
    if (letters && letters.length) {
      return [...new Set(letters)].sort().join('');
    }
    return normalizeSpace(raw);
  }

  function normalizeAnswer(raw, type) {
    let value = normalizeSpace(raw).replace(/^[\s：:]+/, '');
    value = value.replace(/^(我的答案|我的作答|我的回答|正确答案|参考答案|标准答案)\s*[:：]\s*/, '').trim();
    if (!value) return '';
    if (type === 'single' || type === 'multiple') return normalizeChoiceAnswer(value);
    if (type === 'judge') {
      const negative = /不正确|错误|不对|错|×|✕|✖|否|false|^F$/i.test(value);
      const positive = /正确|对|√|✓|是|true|^T$/i.test(value);
      if (negative) return '错';
      if (positive) return '对';
      return value;
    }
    return value;
  }
  P.normalizeAnswer = normalizeAnswer;

  function inferType(rawType, options, answer) {
    if (rawType) return rawType;
    if (options && options.length >= 2) {
      const letters = String(answer || '').toUpperCase().match(/[A-H]/g) || [];
      if (letters.length > 1) return 'multiple';
      return 'single';
    }
    if (answer && /^(对|错|正确|错误|√|×|✓|✕|true|false)$/i.test(String(answer).trim())) return 'judge';
    if (answer) return 'fill';
    return 'unknown';
  }

  function cleanStem(raw) {
    let value = String(raw || '')
      .replace(/\u0001IMG:[^\u0001]*\u0001/g, ' ')
      .replace(/\u001f/g, ' ');
    value = normalizeSpace(value);
    value = value.replace(/^\s*\d{1,3}\s*[.、．)）]\s*/, '');
    value = value.replace(/^\s*\d{1,3}\s+(?=[\u4e00-\u9fff【\[（(])/, '');
    value = value.replace(/^\s*[（(]\s*\d+(?:\.\d+)?\s*分\s*[）)]\s*/, '');
    value = stripTypeLabel(value);
    value = value.replace(/^\s*[【\[]\s*[^】\]]{0,10}题\s*[】\]]\s*/, '');
    value = value.replace(/[（(]\s*\d+(?:\.\d+)?\s*分\s*[）)]\s*$/, '');
    value = value.replace(/\s*[-—]\s*\d+(?:\.\d+)?\s*分\s*$/, '');
    value = value.replace(/^\s*[（(]\s*[)）]\s*/, '');
    return value.trim();
  }
  P.cleanStem = cleanStem;

  function isValidStem(stem) {
    if (!stem) return false;
    if (stem.length < 2) return false;
    if (/^\d+$/.test(stem)) return false;
    if (!/[\u4e00-\u9fffA-Za-z]/.test(stem)) return false;
    return true;
  }

  function fnv1a(input) {
    let hash = 0x811c9dc5;
    const text = String(input == null ? '' : input);
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
  P.fnv1a = fnv1a;

  function contentHash(type, stem, options) {
    const optionText = (options || [])
      .map((option) => `${option.letter || ''}:${normalizeSpace(option.text)}`)
      .join('|');
    return fnv1a(`${type}|${normalizeSpace(stem)}|${optionText}`);
  }

  function uniqueLetters(list) {
    const seen = new Set();
    const result = [];
    for (const item of list) {
      if (!item || !item.letter || seen.has(item.letter)) continue;
      seen.add(item.letter);
      result.push(item);
    }
    return result.sort((a, b) => a.letter.localeCompare(b.letter));
  }

  /**
   * 构造统一题目对象。
   * partial: {type, stem, options, myAnswer, correctAnswer, analysis, knowledgePoint, images, warnings}
   */
  function makeQuestion(partial, meta = {}, sequence = 0) {
    const rawStem = cleanStem(partial.stem);
    if (!isValidStem(rawStem)) return null;

    const options = [];
    const seenLetters = new Set();
    for (const option of partial.options || []) {
      const letter = String(option.letter || '').toUpperCase();
      if (!/^[A-H]$/.test(letter) || seenLetters.has(letter)) continue;
      const text = normalizeSpace(option.text);
      if (!text) continue;
      seenLetters.add(letter);
      options.push({ letter, text });
    }
    options.sort((a, b) => a.letter.localeCompare(b.letter));

    const type = inferType(partial.type, options, partial.correctAnswer);
    const warnings = Array.isArray(partial.warnings) ? [...new Set(partial.warnings)] : [];
    if ((type === 'single' || type === 'multiple') && options.length < 2) {
      warnings.push('选择题选项不足 2 个');
    }
    if (type === 'unknown') warnings.push('题型无法识别');
    if (!normalizeSpace(partial.correctAnswer)) warnings.push('页面未显示答案');

    const myAnswer = normalizeAnswer(partial.myAnswer, type);
    const correctAnswer = normalizeAnswer(partial.correctAnswer, type);
    const hash = contentHash(type, rawStem, options);
    const workId = meta.workId ? String(meta.workId) : '';
    const id = `q-${contentHash(type, rawStem, options)}-${workId ? fnv1a(workId) : 'live'}-${sequence}`;

    return {
      id,
      hash,
      knowledgeId: meta.knowledgeId || '',
      chapterTitle: meta.chapterTitle || '',
      workId,
      type,
      typeLabel: TYPE_LABEL[type] || TYPE_LABEL.unknown,
      stem: rawStem,
      options,
      myAnswer,
      correctAnswer,
      analysis: normalizeSpace(partial.analysis || ''),
      knowledgePoint: normalizeSpace(partial.knowledgePoint || '').replace(/^(?:知识点|考点)\s*[:：]\s*/, ''),
      images: Array.isArray(partial.images) ? [...new Set(partial.images)] : [],
      sourceUrl: meta.sourceUrl || '',
      adapter: meta.adapter || 'unknown',
      warnings,
      answered: !!correctAnswer,
      reviewed: false
    };
  }

  // ============================== 文本字段工具 ==============================

  const FIELD_PATTERN =
    '(我的答案|我的作答|我的回答|正确答案|参考答案|标准答案|答案解析|解析|知识点)\\s*[:：]\\s*';

  const FIELD_NAMES = {
    我的答案: 'myAnswer',
    我的作答: 'myAnswer',
    我的回答: 'myAnswer',
    正确答案: 'correctAnswer',
    参考答案: 'correctAnswer',
    标准答案: 'correctAnswer',
    答案解析: 'analysis',
    解析: 'analysis',
    知识点: 'knowledgePoint'
  };

  function parseFieldSegments(line) {
    const result = {};
    const regex = new RegExp(FIELD_PATTERN + '([\\s\\S]*?)(?=(?:' + FIELD_PATTERN + ')|$)', 'g');
    let matched;
    let matchedAny = false;
    while ((matched = regex.exec(line))) {
      matchedAny = true;
      const target = FIELD_NAMES[matched[1]];
      if (target) {
        const value = normalizeSpace(matched[2] || '');
        if (value) result[target] = result[target] ? `${result[target]}；${value}` : value;
      }
      if (regex.lastIndex <= matched.index) break;
    }
    return matchedAny ? result : null;
  }

  function stripFieldSegments(line) {
    const regex = new RegExp(FIELD_PATTERN + '[\\s\\S]*?(?=(?:' + FIELD_PATTERN + ')|$)', 'g');
    return normalizeSpace(String(line || '').replace(regex, ' '));
  }

  function extractImagesFromText(text) {
    const images = [];
    const regex = /\u0001IMG:([^\u0001]+)\u0001/g;
    let matched;
    while ((matched = regex.exec(String(text || '')))) {
      const url = matched[1].trim();
      if (url) images.push(url);
    }
    return images;
  }

  function stripImageTokens(text) {
    return String(text || '')
      .replace(/\u0001IMG:[^\u0001]*\u0001/g, ' ')
      .replace(/\u0001/g, ' ');
  }

  // ============================== 文本行解析（兜底，但最稳） ==============================

  const SECTION_HEADER_RES = [
    /^[（(]?\s*[一二三四五六七八九十]+\s*[、.．]\s*(.+?)\s*(?:[（(]\s*共\s*(\d+)\s*题\s*[）)])?\s*$/,
    /^[（(]\s*[一二三四五六七八九十]+\s*[）)]\s*(.+?)\s*(?:[（(]\s*共\s*(\d+)\s*题\s*[）)])?\s*$/,
    /^\s*(单项选择题|多项选择题|单选题|多选题|判断题|填空题|简答题|论述题|问答题)\s*[（(]?\s*(?:共\s*(\d+)\s*题)?\s*[）)]?\s*$/
  ];

  function matchSectionHeader(line) {
    const text = normalizeSpace(line);
    if (!text || text.length > 80) return null;
    for (const regex of SECTION_HEADER_RES) {
      const matched = text.match(regex);
      if (!matched) continue;
      const title = matched[1] || '';
      const type = classifyType(title);
      if (!type && !/题/.test(title)) continue;
      return {
        raw: text,
        title,
        type,
        expected: matched[2] ? Number(matched[2]) : 0
      };
    }
    return null;
  }

  const QUESTION_START_RE = /^\s*(\d{1,3})\s*[.、．)）]\s*(.*)$/;
  const QUESTION_START_SPACE_RE = /^\s*(\d{1,3})\s+(?=[【\[（(])/;

  function splitInlineOptions(line) {
    const text = String(line || '');
    const markerRegex = /(^|[\s；;，,])([A-H])\s*[.、．)）]\s*/g;
    const positions = [];
    let matched;
    while ((matched = markerRegex.exec(text))) {
      positions.push({
        start: matched.index + (matched[1] ? matched[1].length : 0),
        letter: matched[2],
        contentStart: markerRegex.lastIndex
      });
      if (markerRegex.lastIndex <= matched.index) break;
    }
    if (positions.length < 2) return null;
    const parts = [];
    for (let i = 0; i < positions.length; i++) {
      const current = positions[i];
      const next = positions[i + 1];
      const end = next ? next.start : text.length;
      parts.push({
        letter: current.letter,
        text: normalizeSpace(text.slice(current.contentStart, end))
      });
    }
    return parts;
  }

  /** 题干和选项写在同一行时：返回题干 + 选项数组。 */
  function splitStemAndOptions(line) {
    const text = String(line || '');
    const markerRegex = /(^|[\s；;，,])([A-H])\s*[.、．)）]\s*/g;
    const positions = [];
    let matched;
    while ((matched = markerRegex.exec(text))) {
      positions.push({
        start: matched.index + (matched[1] ? matched[1].length : 0),
        letter: matched[2],
        contentStart: markerRegex.lastIndex
      });
      if (markerRegex.lastIndex <= matched.index) break;
    }
    if (positions.length < 2) return null;
    const options = [];
    for (let i = 0; i < positions.length; i++) {
      const current = positions[i];
      const next = positions[i + 1];
      options.push({
        letter: current.letter,
        text: normalizeSpace(text.slice(current.contentStart, next ? next.start : text.length))
      });
    }
    return {
      stem: normalizeSpace(text.slice(0, positions[0].start)),
      options
    };
  }

  function isCatalogNoiseLine(line) {
    const text = normalizeSpace(line);
    if (!text) return true;
    // 课程目录/任务列表常见行：1.1 章节名 已完成、章节详情、任务状态等。
    if (/(?:已完成|未完成|待完成|进行中|已锁定)\s*$/.test(text)) return true;
    if (/^\d{1,2}\.\d{1,2}\s+/.test(text)) return true;
    if (/^章节详情$/.test(text)) return true;
    if (/^(?:任务点|章节测验|作业|考试)\s*$/.test(text)) return true;
    return false;
  }

  function parseTextLines(doc, meta = {}) {
    const rawText = domToText(doc.body || doc.documentElement);
    if (!rawText) return null;
    const lines = rawText
      .split('\n')
      .map((line) => line.replace(/\u001f/g, ' ').trim())
      .filter((line) => !!line);

    const questions = [];
    const warnings = [];
    let sectionType = '';
    let expectedTotal = 0;
    let current = null;
    let sectionIndex = 0;
    let droppedNoEvidence = 0;

    const flush = () => {
      if (!current) return;
      const stemText = normalizeSpace(current.stemLines.join(' '));
      const options = uniqueLetters(current.options);
      let stem = cleanStem(stemText);
      if (!stem && current.number) stem = cleanStem(stripImageTokens(current.fallbackText || ''));
      if (!isValidStem(stem)) {
        // 题干无效（例如只剩题号），丢弃并记一条警告。
        if (current.number || current.options.length) warnings.push(`第 ${current.number || '?'} 题题干无法识别，已跳过`);
        current = null;
        return;
      }
      const answerText = current.fields.correctAnswer || '';
      const type = inferType(current.type || sectionType, options, answerText);
      // 证据门槛：目录行、状态行很容易被“1.”开头的正则误判成题目。
      // 必须至少具备一种题目特征，否则直接丢弃。
      const hasEvidence =
        !!type ||
        options.length >= 2 ||
        !!current.type ||
        !!sectionType ||
        !!answerText ||
        !!current.fields.myAnswer ||
        !!current.fields.analysis ||
        !!current.fields.knowledgePoint;
      if (!hasEvidence) {
        droppedNoEvidence++;
        current = null;
        return;
      }
      const question = makeQuestion(
        {
          type,
          stem,
          options,
          myAnswer: current.fields.myAnswer,
          correctAnswer: answerText,
          analysis: current.fields.analysis,
          knowledgePoint: current.fields.knowledgePoint,
          images: current.images,
          warnings: []
        },
        { ...meta, adapter: 'text' },
        questions.length
      );
      if (question) {
        if (expectedTotal && questions.length >= expectedTotal * 3 + 10) {
          // 防止把答案选项误识别成大量题目。
          warnings.push('题目数量异常，可能识别有误');
        }
        questions.push(question);
      }
      current = null;
    };

    for (const rawLine of lines) {
      let line = normalizeSpace(rawLine);

      // 图片占位符：挂到当前题目上
      const images = extractImagesFromText(line);
      line = normalizeSpace(stripImageTokens(line));
      if (!line) {
        if (current && images.length) current.images.push(...images);
        continue;
      }

      // 目录/任务状态噪声行：不参与题干，也不当作新题号。
      if (isCatalogNoiseLine(line)) continue;

      // 题型小标题
      const header = matchSectionHeader(line);
      if (header && (!current || current.stemLines.length || current.options.length || current.fields.correctAnswer)) {
        flush();
        sectionIndex++;
        sectionType = header.type || '';
        if (header.expected) expectedTotal += header.expected;
        continue;
      }

      // 字段行
      const fields = parseFieldSegments(line);
      if (fields) {
        if (current) {
          for (const [key, value] of Object.entries(fields)) {
            if (!value) continue;
            current.fields[key] = current.fields[key] ? `${current.fields[key]}；${value}` : value;
          }
          if (images.length) current.images.push(...images);
        }
        continue;
      }

      // 题干大纲视图里题号可能单独成行（"1" 一行，题干在下一行）。
      if (!current) {
        const numberOnly = line.match(/^(\d{1,3})$/);
        if (numberOnly) {
          current = {
            number: numberOnly[1],
            type: sectionType || '',
            stemLines: [],
            fallbackText: '',
            options: [],
            fields: {},
            images: images.slice()
          };
          continue;
        }
      }

      // 题号开头：支持 "1." / "1、" / "1 【判断题】题干" 三种常见写法
      const lineType = extractTypeFromBlock(line);
      let startMatched = line.match(QUESTION_START_RE);
      let questionNumber = '';
      let rest = '';
      if (startMatched && !lineType && /^\s*\d+(?:\.\d+)?\s*分/.test(startMatched[2] || '')) {
        // “2.0 分”之类的分值行不是新题
        startMatched = null;
      }
      if (startMatched) {
        questionNumber = startMatched[1];
        rest = startMatched[2];
      } else {
        const spaced = line.match(QUESTION_START_SPACE_RE);
        if (spaced && lineType) {
          questionNumber = spaced[1];
          rest = normalizeSpace(line.slice(spaced[0].length));
        }
      }

      const typeOnlyLine = !!lineType && line.length <= 14 && /^[【\[（(]/.test(line);
      if (
        questionNumber ||
        (lineType && (!current || typeOnlyLine || current.options.length || current.fields.correctAnswer))
      ) {
        flush();
        const type = lineType || '';
        const sourceText = rest || line;
        current = {
          number: questionNumber,
          type,
          stemLines: [],
          fallbackText: sourceText,
          options: [],
          fields: {},
          images: images.slice()
        };
        const stripped = stripTypeLabel(normalizeSpace(sourceText));
        if (stripped) {
          // 题干和选项写在同一行的情况："下列哪个…… A. 甲 B. 乙"
          const split = splitStemAndOptions(stripped);
          if (split && isValidStem(cleanStem(split.stem))) {
            current.stemLines.push(split.stem);
            current.options.push(...split.options);
          } else {
            current.stemLines.push(stripped);
          }
        }
        continue;
      }

      if (!current) continue;

      // 选项行 / 一行多个选项
      const inline = splitInlineOptions(line);
      if (inline && inline.length >= 2) {
        current.options.push(...inline);
        continue;
      }
      const optionMatched = line.match(/^([A-H])\s*[.、．)）]\s*(.*)$/);
      if (optionMatched) {
        current.options.push({ letter: optionMatched[1], text: optionMatched[2] });
        continue;
      }

      // 其余文本：题干续行；若已有选项/答案，则作为解析补充
      if (!current.options.length && !current.fields.correctAnswer && !current.fields.myAnswer) {
        current.stemLines.push(line);
        if (images.length) current.images.push(...images);
      } else if (images.length) {
        current.images.push(...images);
      }
    }
    flush();

    if (!questions.length) return null;
    if (droppedNoEvidence > 0) warnings.push(`已跳过 ${droppedNoEvidence} 段缺少题目特征的内容`);
    return {
      questions,
      adapter: 'text',
      warnings,
      expectedTotal
    };
  }

  // ============================== 类名适配器 ==============================

  function optionFromNode(node, index, doc) {
    if (!node) return null;
    const attrs = ['data-letter', 'data-option', 'data-value', 'data-key'];
    let letter = '';
    for (const attr of attrs) {
      const value = String(node.getAttribute(attr) || '').trim();
      const matched = value.match(/^([A-H])(?:[.、．)）])?$/i);
      if (matched) {
        letter = matched[1].toUpperCase();
        break;
      }
    }
    if (!letter) {
      const letterEl = node.querySelector('.num_option, .option-letter, .optionLetter, .letter, .num');
      if (letterEl) {
        const value = normalizeSpace(letterEl.textContent || letterEl.getAttribute('data') || '');
        const matched = value.match(/^([A-H])/i);
        if (matched) letter = matched[1].toUpperCase();
      }
    }

    let text = normalizeSpace(domToText(node)).replace(/\u001f/g, ' ').trim();
    const leading = text.match(/^([A-H])\s*[.、．)）]\s*(.*)$/s);
    if (leading) {
      letter = letter || leading[1].toUpperCase();
      text = leading[2];
    }
    if (!letter) letter = String.fromCharCode(65 + index);
    text = normalizeSpace(stripImageTokens(text));
    // 选项字母常单独放在 .num_option 里，文本会变成“A 规章制度”，这里去掉重复字母。
    if (text && text.charAt(0).toUpperCase() === letter && /^[A-H](\s|[.、．)）])/.test(text)) {
      text = normalizeSpace(text.replace(/^[A-H]\s*[.、．)）]?\s*/, ''));
    }
    if (!text) return null;
    return { letter, text };
  }

  function extractOptionsFromRoot(root, doc, selectors) {
    const options = [];
    const seenNodes = new Set();
    const seenLetters = new Set();
    for (const selector of selectors) {
      let nodes = [];
      try {
        nodes = Array.from(root.querySelectorAll(selector));
      } catch (e) {
        nodes = [];
      }
      for (const node of nodes) {
        if (seenNodes.has(node) || isHiddenByMarkup(node)) continue;
        seenNodes.add(node);
        const parsed = optionFromNode(node, options.length, doc);
        if (!parsed || seenLetters.has(parsed.letter)) continue;
        seenLetters.add(parsed.letter);
        options.push(parsed);
      }
    }
    return options.sort((a, b) => a.letter.localeCompare(b.letter));
  }

  function findFirstText(root, selectors) {
    for (const selector of selectors) {
      let node = null;
      try {
        node = root.querySelector(selector);
      } catch (e) {
        node = null;
      }
      if (node && !isHiddenByMarkup(node)) {
        const text = normalizeSpace(domToText(node)).replace(/\u001f/g, ' ');
        if (normalizeSpace(text)) return text;
      }
    }
    return '';
  }

  function extractFieldsFromRoot(root) {
    const text = domToText(root);
    const fields = {};
    const lines = text.split('\n').map((line) => normalizeSpace(line)).filter(Boolean);
    for (const line of lines) {
      const parsed = parseFieldSegments(line);
      if (!parsed) continue;
      for (const [key, value] of Object.entries(parsed)) {
        if (!value) continue;
        fields[key] = fields[key] ? `${fields[key]}；${value}` : value;
      }
    }
    return fields;
  }

  function questionFromItem(item, doc, fallbackType, meta, adapter) {
    if (!item || isHiddenByMarkup(item)) return null;
    const stemEl = (() => {
      for (const selector of ['.qtContent', '.mark_name', '.questionTitle', '.question_title', '.question-title', '.q_title', '.stem', '.Py-m1-title', '.seeTitle .ql-editor', '.seeTitle']) {
        let node = null;
        try {
          node = item.querySelector(selector);
        } catch (e) {
          node = null;
        }
        if (node && normalizeSpace(domToText(node))) return node;
      }
      return null;
    })();

    let stem = stemEl ? cleanStem(domToText(stemEl)) : '';
    const itemText = domToText(item);
    if (!isValidStem(stem)) {
      // 有些模板题干直接放在容器里，没有专属 class：从整块文本里取第一行。
      const lines = itemText.split('\n').map((line) => normalizeSpace(line)).filter(Boolean);
      const candidate = lines.find((line) => {
        const cleaned = cleanStem(line);
        return isValidStem(cleaned) && !(new RegExp(`^${TYPE_LABELS_PATTERN}`).test(cleaned));
      });
      stem = candidate ? cleanStem(candidate) : '';
    }
    if (!isValidStem(stem)) return null;

    const typeFromLabel = extractTypeFromBlock(itemText) || extractTypeFromBlock(stem);
    const type = typeFromLabel || fallbackType || classifyType(stem);
    const options = extractOptionsFromRoot(item, doc, [
      '.mark_letter > li',
      '.mark_letter li',
      '.Zy_ulTop.qtDetail > li',
      '.Zy_ulTop > li',
      '.answerBg',
      '.answer_bg',
      '.option-list > li',
      '.optionList label',
      '.answer-option',
      '.option',
      'label.option',
      'label.answer',
      'li[data-letter]',
      'li[data-option]'
    ]);

    const fields = extractFieldsFromRoot(item);
    const correctDom =
      findFirstText(item, [
        '.rightAnswerContent',
        '.mark_key .colorGreen',
        '.mark_fill.colorGreen dd',
        '.correctAnswer .answerCon',
        '.correctAnswerBx .answerCon',
        '.correctAnswer',
        '.correct-answer',
        '.rightAnswer',
        '.right-answer'
      ]) || '';
    const myDom =
      findFirstText(item, [
        '.mark_key .colorDeep .stuAnswerContent',
        '.mark_fill.colorDeep .stuAnswerContent',
        '.stuAnswerContent',
        '.myAnswer .answerCon',
        '.myAnswerBx .answerCon',
        '.myAnswer'
      ]) || '';
    const knowledgeDom =
      findFirstText(item, [
        '.knowledgePointBx .answerCon',
        '.knowledgePointBx .knowledgeList',
        '.knowledgePointBx',
        '.knowledgePoint',
        '.knowledge_point',
        '.knowledge'
      ]) || '';
    const analysisDom =
      findFirstText(item, ['.answerAnalysis', '.analysis', '.teacherComments', '.jiexi']) || '';

    const question = makeQuestion(
      {
        type,
        stem,
        options,
        myAnswer: myDom || fields.myAnswer,
        correctAnswer: correctDom || fields.correctAnswer,
        analysis: fields.analysis || analysisDom,
        knowledgePoint: fields.knowledgePoint || knowledgeDom,
        images: resolveImages(item, doc.baseURI || meta.sourceUrl || location.href)
      },
      { ...meta, adapter },
      0
    );
    return question;
  }

  function parseBySections(doc, meta, config) {
    const sectionRoots = [];
    for (const selector of config.sectionSelectors) {
      let nodes = [];
      try {
        nodes = Array.from(doc.querySelectorAll(selector));
      } catch (e) {
        nodes = [];
      }
      if (nodes.length) {
        sectionRoots.push({ selector, nodes });
        break;
      }
    }

    const questions = [];
    if (sectionRoots.length) {
      for (const { nodes } of sectionRoots) {
        for (const section of nodes) {
          if (isHiddenByMarkup(section)) continue;
          const sectionType = classifyType(textOf(section.querySelector(config.typeSelectors.join(','))) || '');
          let items = [];
          try {
            items = Array.from(section.querySelectorAll(config.itemSelectors.join(',')));
          } catch (e) {
            items = [];
          }
          for (const item of items) {
            const question = questionFromItem(item, doc, sectionType, meta, config.adapter);
            if (question) questions.push(question);
          }
          if (!items.length && section.matches && section.matches(config.itemSelectors.join(','))) {
            const question = questionFromItem(section, doc, sectionType, meta, config.adapter);
            if (question) questions.push(question);
          }
        }
      }
    }

    if (!questions.length && config.fallbackRootSelectors) {
      let roots = [];
      for (const selector of config.fallbackRootSelectors) {
        try {
          roots = Array.from(doc.querySelectorAll(selector));
        } catch (e) {
          roots = [];
        }
        if (roots.length) break;
      }
      for (const root of roots) {
        if (isHiddenByMarkup(root)) continue;
        const question = questionFromItem(root, doc, '', meta, config.adapter);
        if (question) questions.push(question);
      }
    }

    if (!questions.length) return null;
    return { questions, adapter: config.adapter, warnings: [], expectedTotal: 0 };
  }

  function parseMarkItem(doc, meta) {
    return parseBySections(doc, meta, {
      adapter: 'markitem',
      sectionSelectors: ['.mark_item'],
      typeSelectors: ['.type_tit', '.typeTitle', '.mark_type', '.type'],
      itemSelectors: ['.questionLi', '.TiMu', '.questionItem'],
      fallbackRootSelectors: []
    });
  }

  function parseTiMu(doc, meta) {
    return parseBySections(doc, meta, {
      adapter: 'timu',
      sectionSelectors: ['#ZyBottom .aiArea', '.aiArea'],
      typeSelectors: ['.newTestType', '.newZy_TItle', '.typeName', '.questionType'],
      itemSelectors: ['.TiMu', '.questionLi'],
      fallbackRootSelectors: ['.TiMu.newTiMu', '.TiMu']
    });
  }

  function parseQuestionLi(doc, meta) {
    return parseBySections(doc, meta, {
      adapter: 'questionli',
      sectionSelectors: [],
      typeSelectors: [],
      itemSelectors: [],
      fallbackRootSelectors: ['.questionLi']
    });
  }

  function parseScoreReview(doc, meta) {
    const roots = Array.from(doc.querySelectorAll('.u-questionItem'));
    if (!roots.length) return null;
    const questions = [];
    for (const root of roots) {
      if (isHiddenByMarkup(root)) continue;
      const titleEl = root.querySelector('.seeTitle, .titleBox, .question-title');
      const titleText = titleEl ? textOf(titleEl) : textOf(root);
      const type = classifyType(titleText);
      let stemEl = root.querySelector('.seeTitle .ql-editor, .seeTitle, .titleBox');
      const stem = cleanStem(domToText(stemEl || root));
      if (!isValidStem(stem)) continue;

      const options = extractOptionsFromRoot(root, doc, [
        '.optionList .el-radio-group label',
        '.optionList .el-checkbox-group label',
        '.optionList label',
        '.option-list label',
        '.optionList .el-radio',
        '.optionList .el-checkbox'
      ]);
      const fields = extractFieldsFromRoot(root);
      const correct =
        findFirstText(root, ['.answerDet .answer', '.correctAnswer', '.correct-answer', '.rightAnswer']) ||
        fields.correctAnswer ||
        '';
      const my =
        findFirstText(root, ['.myAnswer', '.my-answer', '.is-checked']) ||
        fields.myAnswer ||
        '';
      const question = makeQuestion(
        {
          type,
          stem,
          options,
          myAnswer: my,
          correctAnswer: correct,
          analysis: fields.analysis,
          knowledgePoint: fields.knowledgePoint,
          images: resolveImages(root, doc.baseURI || meta.sourceUrl || location.href)
        },
        { ...meta, adapter: 'score-review' },
        0
      );
      if (question) questions.push(question);
    }
    return questions.length ? { questions, adapter: 'score-review', warnings: [], expectedTotal: 0 } : null;
  }

  function parsePhoneWork(doc, meta) {
    const roots = Array.from(doc.querySelectorAll('.Py-mian1'));
    if (!roots.length) return null;
    const typeMap = { 0: 'single', 1: 'multiple', 2: 'fill', 3: 'judge' };
    const questions = [];
    for (const root of roots) {
      if (isHiddenByMarkup(root)) continue;
      const typeInput = root.querySelector('input[name*="answertype"], input[id*="answertype"]');
      const typeValue = typeInput ? String(typeInput.value || typeInput.getAttribute('value') || '') : '';
      const type = typeMap[typeValue] || classifyType(textOf(root.querySelector('.Py-m1-title') || root));
      const stemEl = root.querySelector('.Py-m1-title') || root;
      const stem = cleanStem(domToText(stemEl));
      if (!isValidStem(stem)) continue;
      const options = extractOptionsFromRoot(root, doc, ['.answerList li', '.answerList .answerItem', '.optionList label']);
      const fields = extractFieldsFromRoot(root);
      const question = makeQuestion(
        {
          type,
          stem,
          options,
          myAnswer: fields.myAnswer,
          correctAnswer: fields.correctAnswer,
          analysis: fields.analysis,
          knowledgePoint: fields.knowledgePoint,
          images: resolveImages(root, doc.baseURI || meta.sourceUrl || location.href)
        },
        { ...meta, adapter: 'phone' },
        0
      );
      if (question) questions.push(question);
    }
    if (!questions.length) return null;
    if (questions[0] && !questions[0].correctAnswer) {
      // 手机页经常只显示题目，没有答案；不视为错误。
    }
    return { questions, adapter: 'phone', warnings: [], expectedTotal: 0 };
  }

  // ============================== 评分与选择 ==============================

  function detectExpectedTotal(doc) {
    const text = domToText(doc.body || doc.documentElement);
    let total = 0;
    const regex = /共\s*(\d{1,4})\s*题/g;
    let matched;
    while ((matched = regex.exec(text))) total += Number(matched[1]) || 0;
    return total;
  }

  function scoreCandidate(candidate, expectedTotal) {
    let score = 0;
    let validCount = 0;
    for (const question of candidate.questions || []) {
      if (!isValidStem(question.stem)) continue;
      validCount++;
      score += 2;
      if (question.options.length >= 2) score += question.type === 'single' || question.type === 'multiple' ? 2 : 0.5;
      if (question.correctAnswer) score += 1.5;
      if (question.myAnswer) score += 0.3;
      if (question.analysis) score += 0.3;
      if (question.knowledgePoint) score += 0.2;
      if (question.type !== 'unknown') score += 0.4;
      score -= Math.min(4, (question.warnings || []).length) * 0.25;
    }
    const expected = expectedTotal || candidate.expectedTotal || 0;
    if (expected) {
      if (validCount === expected) score += 8;
      else score -= Math.min(10, Math.abs(validCount - expected) * 1.5);
    }
    return { score, validCount, expected };
  }

  function dedupeQuestions(questions) {
    const seen = new Set();
    const result = [];
    for (const question of questions) {
      if (!question) continue;
      const key = question.hash || contentHash(question.type, question.stem, question.options);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(question);
    }
    return result;
  }

  /**
   * 判断一个文档是否“像题目页”。
   * 课程目录/任务列表页也包含“1.1 …”“已完成”这类文本，文本解析器很容易误判，
   * 所以先做页面级证据门槛：有题目容器、答案/题型文案、或至少两行选项，才继续解析。
   */
  function looksLikeQuestionDocument(doc) {
    if (!doc || !doc.body) return false;
    try {
      if (
        doc.querySelector(
          '.questionLi, .TiMu, .mark_item, .Py-mian1, .u-questionItem, .mark_letter, .answerBg, .mark_answer'
        )
      ) {
        return true;
      }
    } catch (e) {
      /* ignore */
    }
    const text = domToText(doc.body).slice(0, 300000);
    if (!text) return false;
    if (
      /我的答案|我的作答|正确答案|参考答案|标准答案|题量\s*[:：]|满分\s*[:：]|【\s*(?:单选|多选|判断|填空|简答|论述|问答)题\s*】/.test(
        text
      )
    ) {
      return true;
    }
    const optionLines = text.match(/(?:^|\n)\s*[A-H]\s*[.、．)）]\s*\S/g);
    return !!(optionLines && optionLines.length >= 2);
  }
  P.looksLikeQuestionDocument = looksLikeQuestionDocument;

  /**
   * 解析一个文档，返回 {questions, adapter, warnings, quality, expectedTotal}。
   * meta: {chapterTitle, knowledgeId, workId, sourceUrl}
   */
  P.parseDocument = function parseDocument(doc, meta = {}) {
    if (!doc || !doc.body) {
      return { questions: [], adapter: 'none', warnings: ['文档为空'], quality: 0, expectedTotal: 0 };
    }
    const warnings = [];
    if (doc.querySelector && doc.querySelector('.font-cxsecret')) {
      warnings.push('页面使用了加密字体，部分文字可能是乱码；可导出页面存档反馈');
    }
    const expectedTotal = detectExpectedTotal(doc);

    if (!looksLikeQuestionDocument(doc)) {
      return {
        questions: [],
        adapter: 'none',
        warnings: [...warnings, '当前页面不像题目页（缺少题干、选项或答案特征）。请先打开具体的章节测验/作业页面再提取。'],
        quality: 0,
        expectedTotal
      };
    }

    const candidates = [];
    const runAdapter = (fn, name) => {
      try {
        const result = fn(doc, meta);
        if (result && Array.isArray(result.questions) && result.questions.length) {
          candidates.push(result);
        }
      } catch (error) {
        // 单个适配器失败不影响其它适配器。
        warnings.push(`${name} 解析异常：${error && error.message ? error.message : error}`);
      }
    };

    runAdapter(parseMarkItem, 'markitem');
    runAdapter(parseTiMu, 'timu');
    runAdapter(parseScoreReview, 'score-review');
    runAdapter(parsePhoneWork, 'phone');
    runAdapter(parseQuestionLi, 'questionli');
    runAdapter(parseTextLines, 'text');

    if (!candidates.length) {
      return {
        questions: [],
        adapter: 'none',
        warnings: [...warnings, '未识别到题目结构；建议导出页面存档反馈，以便补充模板适配器'],
        quality: 0,
        expectedTotal
      };
    }

    let best = null;
    for (const candidate of candidates) {
      const scored = scoreCandidate(candidate, expectedTotal);
      if (!best || scored.score > best.scored.score || (scored.score === best.scored.score && candidate.adapter === 'text' && best.candidate.adapter !== 'text')) {
        best = { candidate, scored };
      }
    }

    const questions = dedupeQuestions((best.candidate.questions || []).filter((question) => question && isValidStem(question.stem)));
    const finalWarnings = [...new Set([...warnings, ...(best.candidate.warnings || [])])];
    if (best.scored.expected && questions.length !== best.scored.expected) {
      finalWarnings.push(`标题显示共 ${best.scored.expected} 题，实际解析 ${questions.length} 题，可能有遗漏或模板不匹配`);
    }

    return {
      questions,
      adapter: best.candidate.adapter,
      warnings: finalWarnings,
      quality: Math.round(best.scored.score),
      expectedTotal: best.scored.expected || expectedTotal
    };
  };

  /** 解析实时页面（可以是 iframe document），自动挑选质量最好的文档。 */
  P.parseLiveDocuments = function parseLiveDocuments(docs, meta = {}) {
    let best = null;
    const warnings = [];
    for (const doc of docs || []) {
      try {
        const result = P.parseDocument(doc, meta);
        if (!result.questions.length) continue;
        if (!best || result.quality > best.result.quality) best = { doc, result };
      } catch (e) {
        warnings.push(String((e && e.message) || e));
      }
    }
    if (!best) return { questions: [], adapter: 'none', warnings, quality: 0 };
    return {
      ...best.result,
      warnings: [...new Set([...warnings, ...(best.result.warnings || [])])],
      documentUrl: best.doc.URL || ''
    };
  };
})();
