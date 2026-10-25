'use strict';

// A prop style's layout is a Mustache template the GM writes; the note's fields fill it.
// A field is always text: checkLayout refuses a layout that puts one where escaped text could
// still act (a URL, a handler, a style, a script), and layoutView hands Mustache plain strings,
// so a list, a map or a function in the frontmatter never reaches the template.
const Mustache = require('mustache');
const { plainMetaValue, valueText } = require('../processor');
const { isValidFamily } = require('../fonts');

// Mustache caches parsed templates by text and tags: checkLayout and fillLayout pass the same
// tags so both read the template the same way, whatever Mustache.tags holds.
const TAGS = ['{{', '}}'];

const TOOL_NAMES = ['title', 'note_title', 'body', 'text', 'items', 'sheet_number', 'sheet_count', 'first', 'last'];
// The only names that may print unescaped: the tool builds their HTML itself.
const TOOL_HTML = ['body', 'text', 'items'];
const PROP_NAME_RE = /^prop_[a-z0-9_]+(\|(color|class|font))?$/;

const FILTERS = {
  color: (s) => {
    const v = String(s == null ? '' : s);
    return /^#[0-9a-fA-F]{3,8}$/.test(v) || /^[a-zA-Z]{3,20}$/.test(v) ? v : '';
  },
  class: (s) => {
    const v = String(s == null ? '' : s).toLowerCase();
    return /^[a-z0-9][a-z0-9-]{0,40}$/.test(v) ? v : '';
  },
  font: (s) => (isValidFamily(s) ? s : ''),
};

// Attributes whose value is a URL, a script or a style: escaping does not make a field safe there.
// srcdoc is HTML the browser parses after unescaping, so it joins the list.
const DANGEROUS_ATTRS = new Set(['href', 'src', 'srcset', 'action', 'formaction', 'xlink:href', 'poster', 'background', 'data', 'style', 'srcdoc']);
const NAME_PROBLEM = "which a style may not read (only prop_ fields and the tool's names)";

function allowedName(name) {
  return TOOL_NAMES.includes(name) || PROP_NAME_RE.test(name);
}

function dangerousAttr(name) {
  // '' and a name holding '?' are names the walker could not pin down; treat them as the worst case.
  return name === '' || name.includes('?') || DANGEROUS_ATTRS.has(name) || name.startsWith('on');
}

// Elements whose content the browser reads by rules the walker does not follow (raw text,
// RCDATA, template contents, foreign content): a layout may not use them at all.
const REFUSED_ELEMENTS = new Set(['title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext', 'template', 'svg', 'math']);
// Elements that belong in a page's head or embed another document. A layout is a fragment of
// the page body, and a field in one of these (a meta refresh's content, an object's data) can
// send the reader elsewhere.
const HEAD_OR_EMBED = new Set(['meta', 'base', 'link', 'object', 'embed', 'frame', 'frameset', 'applet', 'form']);
// HTML's whitespace: JavaScript's \s also matches NBSP, VT and other Unicode spaces the
// browser reads as ordinary characters.
const HTML_WS = /^[\t\n\f\r ]$/;
const HTML_WS_OR_END = /^[\t\n\f\r />]$/;
// The states of a tag in which the next character starts or continues an attribute name.
const NAME_STATES = new Set(['beforeName', 'name', 'afterName', 'afterQuoted', 'selfClosing']);

// Reads the HTML around each Mustache tag. It walks the template's own text (the text tokens,
// joined), so the tags themselves never move it. It follows the browser's tokenizer for tags,
// attributes, comments and <script>/<style>, and refuses (through `refuse`) every construct
// it does not follow, so the context it reports is the one the browser will see.
class ContextWalker {
  constructor(skeleton, refuse) {
    this.s = skeleton;
    this.refuse = refuse;  // (skeleton offset, snippet, why)
    this.i = 0;
    this.mode = 'text';    // text | tag | attr | raw | comment
    this.sub = '';         // in a tag: tagname | beforeName | name | afterName | beforeValue | unquoted | afterQuoted | selfClosing
    this.tagName = '';
    this.closing = false;
    this.name = '';        // the attribute being read
    this.quote = '';
    this.raw = '';
  }

  context() {
    if (this.mode === 'attr') return `attr:${this.name}:${this.quote}`;
    if (this.mode === 'raw') return `raw:${this.raw}`;
    if (this.mode === 'comment') return 'raw:comment';
    return this.mode;
  }

  // What must match on both sides of a section for its two outcomes to leave the same HTML.
  key() {
    let tag = '';
    if (this.mode === 'tag') tag = NAME_STATES.has(this.sub) ? 'names' : `${this.sub}:${this.tagName}`;
    return [this.mode, tag, this.quote, this.raw].join('|');
  }

  openTag(closing) {
    this.mode = 'tag';
    this.sub = 'tagname';
    this.tagName = '';
    this.closing = closing;
    this.name = '';
  }

  endTagName() {
    const name = this.tagName.toLowerCase();
    if (!this.closing && REFUSED_ELEMENTS.has(name)) {
      this.refuse(this.i - name.length, `<${name}>`, `is an element whose content the safety check cannot read; a style may not use <${name}>`);
    } else if (!this.closing && HEAD_OR_EMBED.has(name)) {
      this.refuse(this.i - name.length, `<${name}>`, `belongs in a page's head or embeds another document; a layout is part of the page body and may not use <${name}>`);
    }
  }

  endTag() {
    const name = this.tagName.toLowerCase();
    if (!this.closing && (name === 'script' || name === 'style')) {
      this.mode = 'raw';
      this.raw = name;
    } else {
      this.mode = 'text';
    }
    this.sub = '';
  }

  startName(c) {
    this.sub = 'name';
    this.name = c.toLowerCase();
  }

  walkTo(end) {
    const s = this.s;
    while (this.i < end) {
      const c = s[this.i];
      const ws = HTML_WS.test(c);
      if (this.mode === 'text') {
        if (c === '<') {
          const next = s[this.i + 1] || '';
          if (s.startsWith('<!--', this.i)) {
            if (s.startsWith('<!-->', this.i) || s.startsWith('<!--->', this.i)) {
              this.refuse(this.i, '<!-->', 'is a comment the browser closes at once; write <!-- … --> with text between');
            }
            this.mode = 'comment';
            this.i += 4;
            continue;
          }
          if (s.startsWith('<![CDATA[', this.i)) this.refuse(this.i, '<![CDATA[', 'starts a CDATA section, which a style may not use');
          else if (next === '!') this.refuse(this.i, '<!', 'starts a declaration or bogus comment, which a style may not use (only <!-- … -->)');
          else if (next === '?') this.refuse(this.i, '<?', 'starts a processing instruction, which a style may not use');
          else if (/[a-zA-Z]/.test(next)) { this.openTag(false); this.i += 1; continue; }
          else if (next === '/') {
            if (/[a-zA-Z]/.test(s[this.i + 2] || '')) { this.openTag(true); this.i += 2; continue; }
            this.refuse(this.i, '</', 'is not followed by a tag name, which the browser reads as a bogus comment');
          }
        }
      } else if (this.mode === 'comment') {
        if (s.startsWith('-->', this.i)) { this.mode = 'text'; this.i += 3; continue; }
        if (s.startsWith('--!>', this.i)) this.refuse(this.i, '--!>', 'closes a comment in a way the safety check does not follow; end it with -->');
      } else if (this.mode === 'raw') {
        if (s.startsWith('<!--', this.i)) {
          this.refuse(this.i, '<!--', `is inside <${this.raw}>, where it changes where the element ends`);
        }
        const close = `</${this.raw}`;
        if (s.slice(this.i, this.i + close.length).toLowerCase() === close && HTML_WS_OR_END.test(s[this.i + close.length] || '')) {
          this.openTag(true);
          this.tagName = this.raw;
          this.raw = '';
          this.i += close.length;
          continue;
        }
      } else if (this.mode === 'attr') {
        if (c === this.quote) { this.mode = 'tag'; this.sub = 'afterQuoted'; this.quote = ''; }
      } else if (this.sub === 'tagname') {
        if (c === '>') { this.endTagName(); this.endTag(); }
        else if (ws) { this.endTagName(); this.sub = 'beforeName'; }
        else if (c === '/') { this.endTagName(); this.sub = 'selfClosing'; }
        else this.tagName += c;
      } else {
        // Attribute states, as the HTML tokenizer names them.
        let sub = this.sub;
        if (sub === 'selfClosing' || sub === 'afterQuoted') {
          if (c === '>') { this.endTag(); this.i += 1; continue; }
          if (ws && sub === 'afterQuoted') { this.sub = 'beforeName'; this.i += 1; continue; }
          if (c === '/') { this.sub = 'selfClosing'; this.i += 1; continue; }
          sub = 'beforeName'; // the browser reads this character again as the start of a name
        }
        if (sub === 'beforeName') {
          this.sub = 'beforeName';
          if (c === '>') this.endTag();
          else if (c === '/') this.sub = 'selfClosing';
          else if (c === '=') {
            this.refuse(this.i, '=', 'starts an attribute name, which the browser reads differently from the safety check');
            this.startName(c);
          } else if (!ws) this.startName(c);
        } else if (sub === 'name') {
          if (c === '>') this.endTag();
          else if (ws) this.sub = 'afterName';
          else if (c === '/') this.sub = 'selfClosing';
          else if (c === '=') this.sub = 'beforeValue';
          else this.name += c.toLowerCase();
        } else if (sub === 'afterName') {
          if (c === '>') this.endTag();
          else if (c === '/') this.sub = 'selfClosing';
          else if (c === '=') this.sub = 'beforeValue';
          else if (!ws) this.startName(c);
        } else if (sub === 'beforeValue') {
          if (c === '>') this.endTag();
          else if (c === '"' || c === "'") { this.mode = 'attr'; this.quote = c; }
          else if (!ws) this.sub = 'unquoted';
        } else if (sub === 'unquoted') {
          if (c === '>') this.endTag();
          else if (ws) this.sub = 'beforeName';
        }
      }
      this.i += 1;
    }
  }
}

// The template's own text, in document order with every tag taken out, and where each run of
// it starts in the template. Mustache hands back its cached tokens, so nothing here writes to them.
function skeletonOf(tokens) {
  let skeleton = '';
  const runs = []; // [offset in the skeleton, index in the template]
  const walk = (list) => {
    for (const token of list) {
      if (token[0] === 'text') { runs.push([skeleton.length, token[2]]); skeleton += token[1]; }
      else if (Array.isArray(token[4])) walk(token[4]);
    }
  };
  walk(tokens);
  return { skeleton, runs };
}

function templateIndex(runs, offset) {
  let index = 0;
  for (const [at, start] of runs) if (at <= offset) index = start + (offset - at);
  return index;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line += 1;
  return line;
}

function nameProblem(token, ctx) {
  const [type, name] = token;
  if (!allowedName(name)) return `reads "${name}", ${NAME_PROBLEM}`;
  const filter = name.includes('|') ? name.split('|')[1] : '';
  if (type === '&') {
    if (!TOOL_HTML.includes(name)) return 'prints unescaped HTML; only body, text and items may';
    if (ctx !== 'text') return 'prints unescaped HTML outside the page text';
    return null;
  }
  if (type === '#' || type === '^') {
    if (filter) return `uses |${filter} on a section; a filter only fills a style or class value`;
    if (ctx.startsWith('raw:')) return ctx === 'raw:comment' ? 'opens a section inside an HTML comment' : `opens a section inside <${ctx.slice(4)}>`;
    return null;
  }
  if (filter) {
    const home = filter === 'class' ? 'class' : 'style';
    return ctx.startsWith(`attr:${home}:`) ? null : `uses |${filter} outside ${home}="…"`;
  }
  if (ctx === 'text') return null;
  if (ctx === 'tag') return 'sits inside a tag, outside a quoted attribute value';
  if (ctx === 'raw:comment') return 'sits inside an HTML comment';
  if (ctx.startsWith('raw:')) return `sits inside <${ctx.slice(4)}>`;
  const attr = ctx.split(':').slice(1, -1).join(':');
  if (!dangerousAttr(attr)) return null;
  if (attr.includes('?')) return 'is the value of an attribute whose name a section changes, which may not hold a field';
  return `is the value of ${attr || 'an unnamed attribute'}="…", which may not hold a field`;
}

// Inside a tag, a section must hold whole attributes: quotes balanced and no < or > outside them.
function wholeAttributes(body) {
  let quote = '';
  for (const c of body) {
    if (quote) { if (c === quote) quote = ''; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '<' || c === '>') return false;
  }
  return !quote;
}

// Problems with a layout, each "<file> line <n>: {{<tag>}} <why>"; [] when the layout is usable.
// A problem in the HTML itself names the HTML instead of a Mustache tag.
function checkLayout(text, { file } = {}) {
  const where = file || 'layout';
  let tokens;
  try {
    tokens = Mustache.parse(text, TAGS);
  } catch (err) {
    const at = /at (\d+)/.exec(err.message);
    return [at ? `${where} line ${lineOf(text, Number(at[1]))}: ${err.message}` : `${where}: ${err.message}`];
  }
  const { skeleton, runs } = skeletonOf(tokens);
  const problems = [];
  const walker = new ContextWalker(skeleton, (at, snippet, why) => {
    problems.push(`${where} line ${lineOf(text, templateIndex(runs, at))}: ${snippet} ${why}`);
  });
  let offset = 0; // how much of the joined text comes before the current token
  const say = (token, why) => problems.push(`${where} line ${lineOf(text, token[2])}: ${text.slice(token[2], token[3])} ${why}`);
  const visit = (list) => {
    for (const token of list) {
      const type = token[0];
      if (type === 'text') { offset += token[1].length; continue; }
      if (type === '!') continue;
      walker.walkTo(offset);
      if (type === '>') { say(token, 'reads a partial, which a style may not use'); continue; }
      if (type === '=') { say(token, 'changes the tag delimiters, which a style may not do'); continue; }
      const why = nameProblem(token, walker.context());
      if (why) say(token, why);
      if (type !== '#' && type !== '^') continue;
      const inTag = walker.mode === 'tag';
      const start = offset;
      const before = walker.key();
      const name = walker.name;
      visit(token[4]);
      walker.walkTo(offset);
      // A close directly followed by another section is fine: that section's own opening
      // check reads what comes before it in either outcome.
      const closeEnd = text.indexOf(TAGS[1], token[5]) + TAGS[1].length;
      const nextSection = /^\{\{\s*[#^]/.test(text.slice(closeEnd));
      if (inTag && !HTML_WS.test(skeleton[start - 1] || '')) {
        say(token, 'opens inside a tag without a space before it; a section in a tag must hold whole attributes');
      } else if (inTag && !nextSection && !HTML_WS_OR_END.test(skeleton[offset] || '')) {
        say(token, 'closes inside a tag without a space, / or > after it; a section in a tag must hold whole attributes');
      } else if (inTag && !wholeAttributes(skeleton.slice(start, offset))) {
        say(token, 'holds an unbalanced quote, < or > inside a tag; a section in a tag must hold whole attributes');
      } else if (walker.key() !== before) {
        say(token, 'changes the HTML around it inside the section, so the page differs with and without it');
      } else if (walker.name !== name) {
        walker.name = '?'; // either name may be the one that holds the value
      }
    }
  };
  visit(tokens);
  walker.walkTo(skeleton.length);
  return problems;
}

// Every name the template reads, sections included, in first-seen order.
function layoutNames(text) {
  let tokens;
  try {
    tokens = Mustache.parse(text, TAGS);
  } catch {
    return [];
  }
  const names = [];
  const walk = (list) => {
    for (const token of list) {
      if (['name', '&', '#', '^'].includes(token[0]) && !names.includes(token[1])) names.push(token[1]);
      if (Array.isArray(token[4])) walk(token[4]);
    }
  };
  walk(tokens);
  return names;
}

// False and empty read as '', so a section over the field skips it; true reads 'true'.
function fieldText(value) {
  if (value === false) return '';
  const scalar = ['string', 'number', 'boolean'].includes(typeof value) || value instanceof Date;
  return scalar ? plainMetaValue(valueText(value)) : '';
}

function toolValue(value) {
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

// The view a layout is filled from: plain strings and booleans only.
function layoutView(fields, names, tool) {
  const view = {};
  for (const name of names) {
    if (PROP_NAME_RE.test(name)) {
      const [base, filter] = name.split('|');
      const own = fields && Object.prototype.hasOwnProperty.call(fields, base);
      const value = fieldText(own ? fields[base] : '');
      view[name] = filter ? FILTERS[filter](value) : value;
    } else if (TOOL_NAMES.includes(name)) {
      view[name] = toolValue(tool && tool[name]);
    }
  }
  return view;
}

// Partials are always {}, so a {{> name}} prints nothing.
function fillLayout(text, view) {
  return Mustache.render(text, view, {}, TAGS);
}

module.exports = { TOOL_NAMES, TOOL_HTML, FILTERS, checkLayout, layoutNames, layoutView, fillLayout };
