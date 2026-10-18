/*
 * XXT Copilot · 导出模块
 * ------------------------------------------------------------
 * 纯原生 JS，无构建、无依赖、无 ES module（挂载 window.XXTExport）。
 * 提供 Markdown / JSON / CSV（UTF-8 BOM）/ 打印视图 四种导出能力，
 * 并统一处理文件名（带课程名与日期）与浏览器下载。
 */
(function (global) {
  'use strict';

  var GENERATOR = 'XXT Copilot v0.1';
  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var TYPE_ORDER = { single: 1, multiple: 2, judge: 3, fill: 4, short: 5, unknown: 6 };
  var TYPE_LABELS = {
    single: '单选题',
    multiple: '多选题',
    judge: '判断题',
    fill: '填空题',
    short: '简答题',
    unknown: '未知题型'
  };

  /* ---------------------------------------------------------------- 基础工具 */

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function formatDateTime(date) {
    var d = date || new Date();
    return (
      d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
    );
  }

  function fileStamp(date) {
    var d = date || new Date();
    return (
      String(d.getFullYear()) + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      '-' + pad2(d.getHours()) + pad2(d.getMinutes())
    );
  }

  function normalizeWhitespace(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function sanitizeFileNamePart(value, maxLength) {
    var text = normalizeWhitespace(value)
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    var limit = maxLength || 60;
    if (text.length > limit) {
      text = text.slice(0, limit).trim();
    }
    return text;
  }

  function makeFileName(prefix, courseTitle, kind, extension, date) {
    var parts = [prefix || 'xxt'];
    var coursePart = sanitizeFileNamePart(courseTitle, 50);
    if (coursePart) {
      parts.push(coursePart);
    }
    if (kind) {
      parts.push(kind);
    }
    parts.push(fileStamp(date));
    return parts.join('-') + '.' + (extension || 'txt');
  }

  function typeLabel(type) {
    return TYPE_LABELS[type] || '未知题型';
  }

  function letterAt(index) {
    return LETTERS.charAt(index) || String(index + 1);
  }

  function optionLetter(option, index) {
    if (option && option.letter) {
      return String(option.letter);
    }
    return letterAt(index);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function mdText(value) {
    var text = normalizeWhitespace(value);
    return text.replace(/\\/g, '\\\\').replace(/([`*_\[\]])/g, '\\$1');
  }

  function questionsOf(data) {
    return data && Array.isArray(data.questions) ? data.questions : [];
  }

  function tasksOf(data) {
    return data && Array.isArray(data.tasks) ? data.tasks : [];
  }

  function courseOf(data) {
    return (data && data.course) || {};
  }

  function courseTitleOf(data) {
    var course = courseOf(data);
    return normalizeWhitespace(course.title || course.name || '未命名课程');
  }

  /* ---------------------------------------------------------------- 分组与统计 */

  function groupByChapter(questions) {
    var chapters = [];
    var chapterMap = {};
    questions.forEach(function (question) {
      var chapterTitle = normalizeWhitespace(question.chapterTitle) || '未分章节';
      var chapter = chapterMap[chapterTitle];
      if (!chapter) {
        chapter = { title: chapterTitle, types: [], typeMap: {}, questions: [] };
        chapterMap[chapterTitle] = chapter;
        chapters.push(chapter);
      }
      chapter.questions.push(question);
      var label = question.typeLabel || typeLabel(question.type);
      var bucket = chapter.typeMap[label];
      if (!bucket) {
        bucket = { label: label, type: question.type || 'unknown', questions: [] };
        chapter.typeMap[label] = bucket;
        chapter.types.push(bucket);
      }
      bucket.questions.push(question);
    });
    chapters.forEach(function (chapter) {
      chapter.types.sort(function (a, b) {
        return (TYPE_ORDER[a.type] || 9) - (TYPE_ORDER[b.type] || 9);
      });
    });
    return chapters;
  }

  function collectStats(questions, chapters) {
    var answered = 0;
    var warned = 0;
    var withSource = 0;
    questions.forEach(function (question) {
      if (normalizeWhitespace(question.correctAnswer)) {
        answered += 1;
      }
      if (Array.isArray(question.warnings) && question.warnings.length) {
        warned += 1;
      }
      if (question.sourceUrl) {
        withSource += 1;
      }
    });
    return {
      total: questions.length,
      answered: answered,
      missing: questions.length - answered,
      chapters: chapters.length,
      warned: warned,
      withSource: withSource
    };
  }

  function optionsText(question, inline) {
    var options = Array.isArray(question.options) ? question.options : [];
    return options.map(function (option, index) {
      return optionLetter(option, index) + '. ' + normalizeWhitespace(option.text);
    }).join(inline ? ' | ' : '\n');
  }

  /* ---------------------------------------------------------------- Markdown */

  function buildMarkdown(data, includeAnswers) {
    var questions = questionsOf(data);
    var chapters = groupByChapter(questions);
    var stats = collectStats(questions, chapters);
    var course = courseOf(data);
    var lines = [];

    lines.push('# ' + courseTitleOf(data) + ' · 题目导出');
    lines.push('');
    lines.push('> 由 ' + GENERATOR + ' 生成于 ' + formatDateTime(new Date()));
    var idLine = [];
    if (course.courseId) {
      idLine.push('课程 ID：' + mdText(course.courseId));
    }
    if (course.clazzId) {
      idLine.push('班级 ID：' + mdText(course.clazzId));
    }
    if (course.cpi) {
      idLine.push('cpi：' + mdText(course.cpi));
    }
    if (idLine.length) {
      lines.push('> ' + idLine.join(' · '));
    }
    lines.push('> 题目总数：' + stats.total + ' · 已含答案：' + stats.answered + ' · 章节数：' + stats.chapters);
    lines.push('> 模式：' + (includeAnswers
      ? '**含答案**（包含“我的答案”、正确答案、解析与来源）'
      : '**不含答案**（仅题干与选项，可用于自测）'));
    if (data && data.demo) {
      lines.push('> 说明：本文件由 demo 模式示例数据生成。');
    }
    lines.push('');

    if (!chapters.length) {
      lines.push('（暂无题目）');
      return lines.join('\n');
    }

    var questionNo = 0;
    chapters.forEach(function (chapter) {
      lines.push('---');
      lines.push('');
      lines.push('## ' + mdText(chapter.title));
      lines.push('');
      chapter.types.forEach(function (bucket) {
        lines.push('### ' + mdText(bucket.label) + '（' + bucket.questions.length + ' 题）');
        lines.push('');
        bucket.questions.forEach(function (question) {
          questionNo += 1;
          lines.push('**' + questionNo + '. ' + mdText(question.stem || '（无题干）') + '**');
          lines.push('');
          var options = Array.isArray(question.options) ? question.options : [];
          if (options.length) {
            options.forEach(function (option, index) {
              lines.push(optionLetter(option, index) + '. ' + mdText(option.text));
            });
            lines.push('');
          }
          var meta = [];
          if (includeAnswers) {
            meta.push('- 我的答案：' + (normalizeWhitespace(question.myAnswer) ? mdText(question.myAnswer) : '（未作答）'));
            meta.push('- 正确答案：' + (normalizeWhitespace(question.correctAnswer)
              ? '**' + mdText(question.correctAnswer) + '**'
              : '（页面未提供）'));
            if (normalizeWhitespace(question.analysis)) {
              meta.push('- 解析：' + mdText(question.analysis));
            }
          }
          if (normalizeWhitespace(question.knowledgePoint)) {
            meta.push('- 知识点：' + mdText(question.knowledgePoint));
          }
          if (question.sourceUrl) {
            meta.push('- 来源：' + question.sourceUrl);
          }
          if (question.adapter) {
            meta.push('- 适配器：' + mdText(question.adapter));
          }
          (Array.isArray(question.warnings) ? question.warnings : []).forEach(function (warning) {
            meta.push('- ⚠ 提示：' + mdText(warning));
          });
          meta.forEach(function (line) {
            lines.push(line);
          });
          lines.push('');
        });
      });
    });

    lines.push('---');
    lines.push('');
    lines.push('*由 ' + GENERATOR + ' 生成 · ' + formatDateTime(new Date()) + ' · 只读采集，未做任何提交*');
    lines.push('');
    return lines.join('\n');
  }

  /* ---------------------------------------------------------------- JSON */

  function buildJson(data) {
    var questions = questionsOf(data);
    var chapters = groupByChapter(questions);
    var stats = collectStats(questions, chapters);
    var payload = {
      generator: GENERATOR,
      schema: 'xxt-copilot/questions@1',
      exportedAt: new Date().toISOString(),
      course: data && data.course ? data.course : null,
      stats: stats,
      tasks: tasksOf(data),
      questions: questions
    };
    if (data && data.demo) {
      payload.demo = true;
    }
    return JSON.stringify(payload, null, 2) + '\n';
  }

  /* ---------------------------------------------------------------- CSV */

  function csvCell(value) {
    var text = value == null ? '' : String(value);
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function buildCsv(data) {
    var questions = questionsOf(data);
    var rows = [
      ['序号', '章节', '题型', '题干', '选项', '我的答案', '正确答案', '解析', '知识点', '来源链接', '适配器', '警告']
    ];
    questions.forEach(function (question, index) {
      rows.push([
        String(index + 1),
        question.chapterTitle || '',
        question.typeLabel || typeLabel(question.type),
        normalizeWhitespace(question.stem),
        optionsText(question, true),
        normalizeWhitespace(question.myAnswer),
        normalizeWhitespace(question.correctAnswer),
        normalizeWhitespace(question.analysis),
        normalizeWhitespace(question.knowledgePoint),
        question.sourceUrl || '',
        question.adapter || '',
        (Array.isArray(question.warnings) ? question.warnings : []).join('；')
      ]);
    });
    var lines = rows.map(function (row) {
      return row.map(csvCell).join(',');
    });
    // UTF-8 BOM：保证 Excel 直接打开时中文不乱码；CRLF 换行更兼容 Windows Excel。
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  /* ---------------------------------------------------------------- 打印视图 */

  var PRINT_CSS = [
    '@page { size: A4; margin: 15mm 13mm; }',
    '* { box-sizing: border-box; }',
    'html, body { margin: 0; padding: 0; background: #fff; color: #1f2937; }',
    'body { font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Segoe UI", sans-serif; font-size: 11.5pt; line-height: 1.55; }',
    '.wrap { max-width: 184mm; margin: 0 auto; padding: 4mm 0; }',
    '.print-tip { margin: 0 0 10mm; padding: 2.5mm 4mm; border: 1px dashed #b6c2d4; border-radius: 2mm; color: #64748b; font-size: 9.5pt; }',
    '.doc-head { border-bottom: 2px solid #1f2937; padding-bottom: 4mm; margin-bottom: 6mm; }',
    '.doc-brand { display: flex; align-items: baseline; justify-content: space-between; color: #2f6bff; font-weight: 700; font-size: 11pt; letter-spacing: .02em; }',
    '.doc-brand span { color: #94a3b8; font-weight: 400; font-size: 9.5pt; }',
    '.doc-head h1 { margin: 2mm 0 2mm; font-size: 19pt; line-height: 1.3; color: #0f1722; }',
    '.doc-meta { display: flex; flex-wrap: wrap; gap: 1mm 6mm; color: #64748b; font-size: 9.5pt; }',
    '.chapter { margin-top: 7mm; }',
    '.chapter h2 { margin: 0 0 3mm; padding-left: 2.5mm; border-left: 4px solid #2f6bff; font-size: 14pt; line-height: 1.4; color: #0f1722; }',
    '.chapter h3 { margin: 5mm 0 2.5mm; font-size: 11.5pt; color: #2f6bff; }',
    '.chapter h3 .count { color: #94a3b8; font-weight: 400; font-size: 9.5pt; }',
    '.question { margin: 0 0 5mm; padding-bottom: 4mm; border-bottom: 1px dashed #dbe2ec; break-inside: avoid; page-break-inside: avoid; }',
    '.question:last-child { border-bottom: none; }',
    '.stem { font-size: 11.5pt; font-weight: 600; color: #111827; }',
    '.stem .no { font-family: Consolas, monospace; color: #2f6bff; }',
    '.stem .type { color: #94a3b8; font-weight: 400; font-size: 9pt; }',
    '.options { margin: 2mm 0 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 1mm 8mm; }',
    '.options li { min-width: 42%; font-size: 10.5pt; color: #374151; }',
    '.options b { color: #0f1722; }',
    '.answers { display: flex; flex-wrap: wrap; gap: 1mm 8mm; margin-top: 2.5mm; font-size: 10.5pt; }',
    '.answer-line b { color: #b91c1c; }',
    '.answer-blank { margin-top: 3.5mm; color: #94a3b8; font-size: 10.5pt; letter-spacing: .02em; }',
    '.analysis { margin-top: 2mm; padding: 2mm 3mm; background: #f8fafc; border-left: 2px solid #cbd5e1; color: #475569; font-size: 9.5pt; }',
    '.warning { margin-top: 1.5mm; color: #b45309; font-size: 9pt; }',
    '.source { margin-top: 1.5mm; color: #94a3b8; font-size: 8.5pt; word-break: break-all; }',
    '.empty { padding: 12mm 0; text-align: center; color: #94a3b8; }',
    '.doc-foot { margin-top: 8mm; padding-top: 3mm; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 8.5pt; text-align: center; }',
    '@media print { .print-tip { display: none; } body { font-size: 11pt; } }'
  ].join('\n');

  function buildPrintHtml(data, includeAnswers) {
    var questions = questionsOf(data);
    var chapters = groupByChapter(questions);
    var stats = collectStats(questions, chapters);
    var title = courseTitleOf(data);
    var body = [];

    body.push('<div class="print-tip">打印提示：按 Ctrl+P（macOS 为 Cmd+P）打印或另存为 PDF；本页为 A4 排版，已自动分页。</div>');
    body.push('<header class="doc-head">');
    body.push('<div class="doc-brand">XXT Copilot <span>题目打印视图 · 只读采集，未做任何提交</span></div>');
    body.push('<h1>' + escapeHtml(title) + '</h1>');
    body.push('<div class="doc-meta">');
    body.push('<span>导出时间：' + escapeHtml(formatDateTime(new Date())) + '</span>');
    body.push('<span>题目：' + stats.total + ' 题</span>');
    body.push('<span>章节：' + stats.chapters + '</span>');
    body.push('<span>模式：' + (includeAnswers ? '含答案' : '不含答案（自测）') + '</span>');
    body.push('</div>');
    body.push('</header>');

    if (!chapters.length) {
      body.push('<p class="empty">（暂无题目）</p>');
    }

    var questionNo = 0;
    chapters.forEach(function (chapter) {
      body.push('<section class="chapter">');
      body.push('<h2>' + escapeHtml(chapter.title) + '</h2>');
      chapter.types.forEach(function (bucket) {
        body.push('<h3>' + escapeHtml(bucket.label) + ' <span class="count">（' + bucket.questions.length + ' 题）</span></h3>');
        bucket.questions.forEach(function (question) {
          questionNo += 1;
          body.push('<article class="question">');
          body.push(
            '<div class="stem"><span class="no">' + questionNo + '.</span> ' +
            '<span class="type">[' + escapeHtml(bucket.label) + ']</span> ' +
            escapeHtml(question.stem || '（无题干）') + '</div>'
          );
          var options = Array.isArray(question.options) ? question.options : [];
          if (options.length) {
            body.push('<ul class="options">');
            options.forEach(function (option, index) {
              body.push('<li><b>' + escapeHtml(optionLetter(option, index)) + '.</b> ' + escapeHtml(option.text) + '</li>');
            });
            body.push('</ul>');
          }
          if (includeAnswers) {
            body.push('<div class="answers">');
            body.push('<span class="answer-line">我的答案：' + escapeHtml(normalizeWhitespace(question.myAnswer) || '未作答') + '</span>');
            body.push('<span class="answer-line">正确答案：<b>' + escapeHtml(normalizeWhitespace(question.correctAnswer) || '页面未提供') + '</b></span>');
            body.push('</div>');
            if (normalizeWhitespace(question.analysis)) {
              body.push('<div class="analysis">解析：' + escapeHtml(question.analysis) + '</div>');
            }
          } else {
            body.push('<div class="answer-blank">我的答案：________________________________________</div>');
          }
          if (Array.isArray(question.warnings) && question.warnings.length) {
            body.push('<div class="warning">提示：' + escapeHtml(question.warnings.join('；')) + '</div>');
          }
          body.push(
            '<div class="source">来源：' + escapeHtml(question.sourceUrl || '—') +
            ' · 适配器：' + escapeHtml(question.adapter || '—') + '</div>'
          );
          body.push('</article>');
        });
      });
      body.push('</section>');
    });

    body.push('<footer class="doc-foot">由 ' + GENERATOR + ' 生成 · ' + escapeHtml(formatDateTime(new Date())) + ' · 只读工具，不会提交作业或自动答题</footer>');

    return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + escapeHtml(title) + ' · 题目打印视图</title>\n' +
      '<style>\n' + PRINT_CSS + '\n</style>\n</head>\n<body>\n' +
      '<div class="wrap">\n' + body.join('\n') + '\n</div>\n</body>\n</html>\n';
  }

  /* ---------------------------------------------------------------- 下载 */

  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var anchor = global.document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    global.document.body.appendChild(anchor);
    anchor.click();
    global.setTimeout(function () {
      try {
        if (anchor.parentNode) {
          anchor.parentNode.removeChild(anchor);
        }
        URL.revokeObjectURL(url);
      } catch (error) {
        /* 忽略清理异常 */
      }
    }, 1000);
    return filename;
  }

  function downloadJson(filename, payload) {
    return downloadText(filename, JSON.stringify(payload, null, 2) + '\n', 'application/json;charset=utf-8');
  }

  /* ---------------------------------------------------------------- 对外导出动作 */

  function exportMarkdown(data, includeAnswers) {
    var filename = makeFileName(
      'xxt',
      courseTitleOf(data),
      includeAnswers ? '题目-含答案' : '题目-不含答案',
      'md'
    );
    return downloadText(filename, buildMarkdown(data, includeAnswers), 'text/markdown;charset=utf-8');
  }

  function exportJson(data) {
    var filename = makeFileName('xxt', courseTitleOf(data), '题目', 'json');
    return downloadText(filename, buildJson(data), 'application/json;charset=utf-8');
  }

  function exportCsv(data) {
    var filename = makeFileName('xxt', courseTitleOf(data), '题目', 'csv');
    return downloadText(filename, buildCsv(data), 'text/csv;charset=utf-8');
  }

  function openPrintView(data, includeAnswers) {
    var html = buildPrintHtml(data, includeAnswers);
    var printWindow = null;
    try {
      printWindow = global.open('', '_blank');
    } catch (error) {
      printWindow = null;
    }
    if (!printWindow) {
      return { ok: false, error: '打印窗口被浏览器拦截，请允许扩展打开新窗口后重试。' };
    }
    try {
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      if (printWindow.focus) {
        printWindow.focus();
      }
    } catch (error) {
      return { ok: false, error: '无法写入打印视图：' + (error && error.message ? error.message : error) };
    }
    return { ok: true, title: courseTitleOf(data) + ' · 题目打印视图', window: printWindow };
  }

  global.XXTExport = {
    GENERATOR: GENERATOR,
    formatDateTime: formatDateTime,
    makeFileName: makeFileName,
    typeLabel: typeLabel,
    groupByChapter: groupByChapter,
    collectStats: collectStats,
    buildMarkdown: buildMarkdown,
    buildJson: buildJson,
    buildCsv: buildCsv,
    buildPrintHtml: buildPrintHtml,
    downloadText: downloadText,
    downloadJson: downloadJson,
    exportMarkdown: exportMarkdown,
    exportJson: exportJson,
    exportCsv: exportCsv,
    openPrintView: openPrintView
  };
})(window);
