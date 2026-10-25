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
  // '' and '?' are names the walker could not pin down; treat them as the worst case.
  return name === '' || name === '?' || DANGEROUS_ATTRS.has(name) || name.startsWith('on');
}

// Reads the HTML around each Mustache tag. It walks the template's own text (the text tokens,
// joined), so the tags themselves never move it, tracking tags, quoted attribute values,
// comments and <script>/<style> until their close tag.
class ContextWalker {
  constructor(skeleton) {
    this.s = skeleton;
    this.i = 0;
    this.mode = 'text';  // text | tag | attr | raw | comment
    this.sub = '';       // in a tag: tagname | names | value | unquoted
    this.tagName = '';
    this.closing = false;
    this.name = '';      // the attribute being read
    this.gap = true;     // the next name character starts a new attribute name
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
    const tag = this.mode === 'tag' ? `${this.sub}:${this.sub === 'tagname' ? this.tagName : ''}` : '';
    return [this.mode, tag, this.quote, this.raw].join('|');
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

  openTag(closing) {
    this.mode = 'tag';
    this.sub = 'tagname';
    this.tagName = '';
    this.closing = closing;
    this.name = '';
    this.gap = true;
  }

  walkTo(end) {
    const s = this.s;
    while (this.i < end) {
      const c = s[this.i];
      const ws = /\s/.test(c);
      if (this.mode === 'text') {
        if (c === '<' && s.startsWith('<!--', this.i)) { this.mode = 'comment'; this.i += 4; continue; }
        if (c === '<' && /[a-zA-Z!?]/.test(s[this.i + 1] || '')) { this.openTag(false); this.i += 1; continue; }
        if (c === '<' && s[this.i + 1] === '/' && /[a-zA-Z]/.test(s[this.i + 2] || '')) { this.openTag(true); this.i += 2; continue; }
      } else if (this.mode === 'comment') {
        if (s.startsWith('-->', this.i)) { this.mode = 'text'; this.i += 3; continue; }
      } else if (this.mode === 'raw') {
        const close = `</${this.raw}`;
        if (s.slice(this.i, this.i + close.length).toLowerCase() === close) {
          this.openTag(true);
          this.tagName = this.raw;
          this.raw = '';
          this.i += close.length;
          continue;
        }
      } else if (this.mode === 'attr') {
        if (c === this.quote) { this.mode = 'tag'; this.sub = 'names'; this.quote = ''; this.gap = true; }
      } else if (this.sub === 'tagname') {
        if (c === '>') this.endTag();
        else if (ws || c === '/') { this.sub = 'names'; this.gap = true; }
        else this.tagName += c;
      } else if (this.sub === 'names') {
        if (c === '>') this.endTag();
        else if (ws || c === '/') this.gap = true;
        else if (c === '=') { this.sub = 'value'; this.name = this.name.toLowerCase(); }
        else if (this.gap) { this.name = c; this.gap = false; }
        else this.name += c;
      } else if (this.sub === 'value') {
        if (c === '>') this.endTag();
        else if (c === '"' || c === "'") { this.mode = 'attr'; this.quote = c; }
        else if (!ws) this.sub = 'unquoted';
      } else if (this.sub === 'unquoted') {
        if (c === '>') this.endTag();
        else if (ws) { this.sub = 'names'; this.gap = true; }
      }
      this.i += 1;
    }
  }
}

// The template's own text, in document order with every tag taken out. Mustache hands back
// its cached tokens, so nothing here writes to them.
function skeletonOf(tokens) {
  let skeleton = '';
  const walk = (list) => {
    for (const token of list) {
      if (token[0] === 'text') skeleton += token[1];
      else if (Array.isArray(token[4])) walk(token[4]);
    }
  };
  walk(tokens);
  return skeleton;
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
  if (attr === '?') return 'is the value of an attribute whose name a section changes, which may not hold a field';
  return `is the value of ${attr || 'an unnamed attribute'}="…", which may not hold a field`;
}

// Problems with a layout, each "<file> line <n>: {{<tag>}} <why>"; [] when the layout is usable.
function checkLayout(text, { file } = {}) {
  const where = file || 'layout';
  let tokens;
  try {
    tokens = Mustache.parse(text, TAGS);
  } catch (err) {
    const at = /at (\d+)/.exec(err.message);
    return [at ? `${where} line ${lineOf(text, Number(at[1]))}: ${err.message}` : `${where}: ${err.message}`];
  }
  const walker = new ContextWalker(skeletonOf(tokens));
  const problems = [];
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
      const before = walker.key();
      const name = walker.name;
      visit(token[4]);
      walker.walkTo(offset);
      if (walker.key() !== before) {
        say(token, 'changes the HTML around it inside the section, so the page differs with and without it');
      } else if (walker.name !== name) {
        walker.name = '?'; // either name may be the one that holds the value
      }
    }
  };
  visit(tokens);
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

function fieldText(value) {
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
