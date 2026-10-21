import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "node_modules/yaml/dist/nodes/identity.js"(exports) {
    "use strict";
    var ALIAS = Symbol.for("yaml.alias");
    var DOC = Symbol.for("yaml.document");
    var MAP = Symbol.for("yaml.map");
    var PAIR = Symbol.for("yaml.pair");
    var SCALAR = Symbol.for("yaml.scalar");
    var SEQ = Symbol.for("yaml.seq");
    var NODE_TYPE = Symbol.for("yaml.node.type");
    var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
    var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
    var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
    var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
    var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
    var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
    function isCollection(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return true;
        }
      return false;
    }
    function isNode(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case ALIAS:
          case MAP:
          case SCALAR:
          case SEQ:
            return true;
        }
      return false;
    }
    var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
    exports.ALIAS = ALIAS;
    exports.DOC = DOC;
    exports.MAP = MAP;
    exports.NODE_TYPE = NODE_TYPE;
    exports.PAIR = PAIR;
    exports.SCALAR = SCALAR;
    exports.SEQ = SEQ;
    exports.hasAnchor = hasAnchor;
    exports.isAlias = isAlias;
    exports.isCollection = isCollection;
    exports.isDocument = isDocument;
    exports.isMap = isMap;
    exports.isNode = isNode;
    exports.isPair = isPair;
    exports.isScalar = isScalar;
    exports.isSeq = isSeq;
  }
});

// node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "node_modules/yaml/dist/visit.js"(exports) {
    "use strict";
    var identity = require_identity();
    var BREAK = Symbol("break visit");
    var SKIP = Symbol("skip children");
    var REMOVE = Symbol("remove node");
    function visit(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        visit_(null, node, visitor_, Object.freeze([]));
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    function visit_(key, node, visitor, path) {
      const ctrl = callVisitor(key, node, visitor, path);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path, ctrl);
        return visit_(key, ctrl, visitor, path);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path = Object.freeze(path.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = visit_(i, node.items[i], visitor, path);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path = Object.freeze(path.concat(node));
          const ck = visit_("key", node.key, visitor, path);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    async function visitAsync(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        await visitAsync_(null, node, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key, node, visitor, path) {
      const ctrl = await callVisitor(key, node, visitor, path);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path, ctrl);
        return visitAsync_(key, ctrl, visitor, path);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path = Object.freeze(path.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = await visitAsync_(i, node.items[i], visitor, path);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path = Object.freeze(path.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    function initVisitor(visitor) {
      if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
        return Object.assign({
          Alias: visitor.Node,
          Map: visitor.Node,
          Scalar: visitor.Node,
          Seq: visitor.Node
        }, visitor.Value && {
          Map: visitor.Value,
          Scalar: visitor.Value,
          Seq: visitor.Value
        }, visitor.Collection && {
          Map: visitor.Collection,
          Seq: visitor.Collection
        }, visitor);
      }
      return visitor;
    }
    function callVisitor(key, node, visitor, path) {
      if (typeof visitor === "function")
        return visitor(key, node, path);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path);
      return void 0;
    }
    function replaceNode(key, path, node) {
      const parent = path[path.length - 1];
      if (identity.isCollection(parent)) {
        parent.items[key] = node;
      } else if (identity.isPair(parent)) {
        if (key === "key")
          parent.key = node;
        else
          parent.value = node;
      } else if (identity.isDocument(parent)) {
        parent.contents = node;
      } else {
        const pt = identity.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt} parent`);
      }
    }
    exports.visit = visit;
    exports.visitAsync = visitAsync;
  }
});

// node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "node_modules/yaml/dist/doc/directives.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    var escapeChars = {
      "!": "%21",
      ",": "%2C",
      "[": "%5B",
      "]": "%5D",
      "{": "%7B",
      "}": "%7D"
    };
    var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
    var Directives = class _Directives {
      constructor(yaml, tags) {
        this.docStart = null;
        this.docEnd = false;
        this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
        this.tags = Object.assign({}, _Directives.defaultTags, tags);
      }
      clone() {
        const copy = new _Directives(this.yaml, this.tags);
        copy.docStart = this.docStart;
        return copy;
      }
      /**
       * During parsing, get a Directives instance for the current document and
       * update the stream state according to the current version's spec.
       */
      atDocument() {
        const res = new _Directives(this.yaml, this.tags);
        switch (this.yaml.version) {
          case "1.1":
            this.atNextDocument = true;
            break;
          case "1.2":
            this.atNextDocument = false;
            this.yaml = {
              explicit: _Directives.defaultYaml.explicit,
              version: "1.2"
            };
            this.tags = Object.assign({}, _Directives.defaultTags);
            break;
        }
        return res;
      }
      /**
       * @param onError - May be called even if the action was successful
       * @returns `true` on success
       */
      add(line, onError) {
        if (this.atNextDocument) {
          this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
          this.tags = Object.assign({}, _Directives.defaultTags);
          this.atNextDocument = false;
        }
        const parts = line.trim().split(/[ \t]+/);
        const name = parts.shift();
        switch (name) {
          case "%TAG": {
            if (parts.length !== 2) {
              onError(0, "%TAG directive should contain exactly two parts");
              if (parts.length < 2)
                return false;
            }
            const [handle, prefix] = parts;
            this.tags[handle] = prefix;
            return true;
          }
          case "%YAML": {
            this.yaml.explicit = true;
            if (parts.length !== 1) {
              onError(0, "%YAML directive should contain exactly one part");
              return false;
            }
            const [version] = parts;
            if (version === "1.1" || version === "1.2") {
              this.yaml.version = version;
              return true;
            } else {
              const isValid = /^\d+\.\d+$/.test(version);
              onError(6, `Unsupported YAML version ${version}`, isValid);
              return false;
            }
          }
          default:
            onError(0, `Unknown directive ${name}`, true);
            return false;
        }
      }
      /**
       * Resolves a tag, matching handles to those defined in %TAG directives.
       *
       * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
       *   `'!local'` tag, or `null` if unresolvable.
       */
      tagName(source, onError) {
        if (source === "!")
          return "!";
        if (source[0] !== "!") {
          onError(`Not a valid tag: ${source}`);
          return null;
        }
        if (source[1] === "<") {
          const verbatim = source.slice(2, -1);
          if (verbatim === "!" || verbatim === "!!") {
            onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
            return null;
          }
          if (source[source.length - 1] !== ">")
            onError("Verbatim tags must end with a >");
          return verbatim;
        }
        const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
        if (!suffix)
          onError(`The ${source} tag has no suffix`);
        const prefix = this.tags[handle];
        if (prefix) {
          try {
            return prefix + decodeURIComponent(suffix);
          } catch (error) {
            onError(String(error));
            return null;
          }
        }
        if (handle === "!")
          return source;
        onError(`Could not resolve tag: ${source}`);
        return null;
      }
      /**
       * Given a fully resolved tag, returns its printable string form,
       * taking into account current tag prefixes and defaults.
       */
      tagString(tag) {
        for (const [handle, prefix] of Object.entries(this.tags)) {
          if (tag.startsWith(prefix))
            return handle + escapeTagName(tag.substring(prefix.length));
        }
        return tag[0] === "!" ? tag : `!<${tag}>`;
      }
      toString(doc) {
        const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
        const tagEntries = Object.entries(this.tags);
        let tagNames;
        if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
          const tags = {};
          visit.visit(doc.contents, (_key, node) => {
            if (identity.isNode(node) && node.tag)
              tags[node.tag] = true;
          });
          tagNames = Object.keys(tags);
        } else
          tagNames = [];
        for (const [handle, prefix] of tagEntries) {
          if (handle === "!!" && prefix === "tag:yaml.org,2002:")
            continue;
          if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
            lines.push(`%TAG ${handle} ${prefix}`);
        }
        return lines.join("\n");
      }
    };
    Directives.defaultYaml = { explicit: false, version: "1.2" };
    Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
    exports.Directives = Directives;
  }
});

// node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "node_modules/yaml/dist/doc/anchors.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    function anchorIsValid(anchor) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
        const sa = JSON.stringify(anchor);
        const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
        throw new Error(msg);
      }
      return true;
    }
    function anchorNames(root) {
      const anchors = /* @__PURE__ */ new Set();
      visit.visit(root, {
        Value(_key, node) {
          if (node.anchor)
            anchors.add(node.anchor);
        }
      });
      return anchors;
    }
    function findNewAnchor(prefix, exclude) {
      for (let i = 1; true; ++i) {
        const name = `${prefix}${i}`;
        if (!exclude.has(name))
          return name;
      }
    }
    function createNodeAnchors(doc, prefix) {
      const aliasObjects = [];
      const sourceObjects = /* @__PURE__ */ new Map();
      let prevAnchors = null;
      return {
        onAnchor: (source) => {
          aliasObjects.push(source);
          prevAnchors ?? (prevAnchors = anchorNames(doc));
          const anchor = findNewAnchor(prefix, prevAnchors);
          prevAnchors.add(anchor);
          return anchor;
        },
        /**
         * With circular references, the source node is only resolved after all
         * of its child nodes are. This is why anchors are set only after all of
         * the nodes have been created.
         */
        setAnchors: () => {
          for (const source of aliasObjects) {
            const ref = sourceObjects.get(source);
            if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) {
              ref.node.anchor = ref.anchor;
            } else {
              const error = new Error("Failed to resolve repeated object (this should not happen)");
              error.source = source;
              throw error;
            }
          }
        },
        sourceObjects
      };
    }
    exports.anchorIsValid = anchorIsValid;
    exports.anchorNames = anchorNames;
    exports.createNodeAnchors = createNodeAnchors;
    exports.findNewAnchor = findNewAnchor;
  }
});

// node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "node_modules/yaml/dist/doc/applyReviver.js"(exports) {
    "use strict";
    function applyReviver(reviver, obj, key, val) {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i = 0, len = val.length; i < len; ++i) {
            const v0 = val[i];
            const v1 = applyReviver(reviver, val, String(i), v0);
            if (v1 === void 0)
              delete val[i];
            else if (v1 !== v0)
              val[i] = v1;
          }
        } else if (val instanceof Map) {
          for (const k of Array.from(val.keys())) {
            const v0 = val.get(k);
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              val.delete(k);
            else if (v1 !== v0)
              val.set(k, v1);
          }
        } else if (val instanceof Set) {
          for (const v0 of Array.from(val)) {
            const v1 = applyReviver(reviver, val, v0, v0);
            if (v1 === void 0)
              val.delete(v0);
            else if (v1 !== v0) {
              val.delete(v0);
              val.add(v1);
            }
          }
        } else {
          for (const [k, v0] of Object.entries(val)) {
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              delete val[k];
            else if (v1 !== v0)
              val[k] = v1;
          }
        }
      }
      return reviver.call(obj, key, val);
    }
    exports.applyReviver = applyReviver;
  }
});

// node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "node_modules/yaml/dist/nodes/toJS.js"(exports) {
    "use strict";
    var identity = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i) => toJS(v, String(i), ctx));
      if (value && typeof value.toJSON === "function") {
        if (!ctx || !identity.hasAnchor(value))
          return value.toJSON(arg, ctx);
        const data = { aliasCount: 0, count: 1, res: void 0 };
        ctx.anchors.set(value, data);
        ctx.onCreate = (res2) => {
          data.res = res2;
          delete ctx.onCreate;
        };
        const res = value.toJSON(arg, ctx);
        if (ctx.onCreate)
          ctx.onCreate(res);
        return res;
      }
      if (typeof value === "bigint" && !ctx?.keep)
        return Number(value);
      return value;
    }
    exports.toJS = toJS;
  }
});

// node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "node_modules/yaml/dist/nodes/Node.js"(exports) {
    "use strict";
    var applyReviver = require_applyReviver();
    var identity = require_identity();
    var toJS = require_toJS();
    var NodeBase = class {
      constructor(type) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: type });
      }
      /** Create a copy of this node.  */
      clone() {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** A plain JavaScript representation of this node. */
      toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        if (!identity.isDocument(doc))
          throw new TypeError("A document argument is required");
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc,
          keep: true,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this, "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
    };
    exports.NodeBase = NodeBase;
  }
});

// node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "node_modules/yaml/dist/nodes/Alias.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var visit = require_visit();
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var Alias = class extends Node.NodeBase {
      constructor(source) {
        super(identity.ALIAS);
        this.source = source;
        Object.defineProperty(this, "tag", {
          set() {
            throw new Error("Alias nodes cannot have tags");
          }
        });
      }
      /**
       * Resolve the value of this alias within `doc`, finding the last
       * instance of the `source` anchor before this node.
       */
      resolve(doc, ctx) {
        if (ctx?.maxAliasCount === 0)
          throw new ReferenceError("Alias resolution is disabled");
        let nodes;
        if (ctx?.aliasResolveCache) {
          nodes = ctx.aliasResolveCache;
        } else {
          nodes = [];
          visit.visit(doc, {
            Node: (_key, node) => {
              if (identity.isAlias(node) || identity.hasAnchor(node))
                nodes.push(node);
            }
          });
          if (ctx)
            ctx.aliasResolveCache = nodes;
        }
        let found = void 0;
        for (const node of nodes) {
          if (node === this)
            break;
          if (node.anchor === this.source)
            found = node;
        }
        if (found && ctx) {
          const { anchors: anchors2, doc: doc2, maxAliasCount } = ctx;
          let data = anchors2.get(found);
          if (!data) {
            toJS.toJS(found, null, ctx);
            data = anchors2.get(found);
          }
          if (data?.res === void 0) {
            const msg = "This should not happen: Alias anchor was not resolved?";
            throw new ReferenceError(msg);
          }
          if (maxAliasCount >= 0) {
            data.count += 1;
            if (data.aliasCount === 0)
              data.aliasCount = getAliasCount(doc2, found, anchors2);
            if (data.count * data.aliasCount > maxAliasCount) {
              const msg = "Excessive alias count indicates a resource exhaustion attack";
              throw new ReferenceError(msg);
            }
          }
        }
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        const source = this.resolve(ctx.doc, ctx);
        if (!source) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        return ctx.anchors.get(source).res;
      }
      toString(ctx, _onComment, _onChompKeep) {
        const src = `*${this.source}`;
        if (ctx) {
          anchors.anchorIsValid(this.source);
          if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
            const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
            throw new Error(msg);
          }
          if (ctx.implicitKey)
            return `${src} `;
        }
        return src;
      }
    };
    function getAliasCount(doc, node, anchors2) {
      if (identity.isAlias(node)) {
        const source = node.resolve(doc);
        const anchor = anchors2 && source && anchors2.get(source);
        return anchor ? anchor.count * anchor.aliasCount : 0;
      } else if (identity.isCollection(node)) {
        let count = 0;
        for (const item of node.items) {
          const c = getAliasCount(doc, item, anchors2);
          if (c > count)
            count = c;
        }
        return count;
      } else if (identity.isPair(node)) {
        const kc = getAliasCount(doc, node.key, anchors2);
        const vc = getAliasCount(doc, node.value, anchors2);
        return Math.max(kc, vc);
      }
      return 1;
    }
    exports.Alias = Alias;
  }
});

// node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "node_modules/yaml/dist/nodes/Scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
    var Scalar = class extends Node.NodeBase {
      constructor(value) {
        super(identity.SCALAR);
        this.value = value;
      }
      toJSON(arg, ctx) {
        return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
      }
      toString() {
        return String(this.value);
      }
    };
    Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
    Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
    Scalar.PLAIN = "PLAIN";
    Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
    Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
    exports.Scalar = Scalar;
    exports.isScalarValue = isScalarValue;
  }
});

// node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "node_modules/yaml/dist/doc/createNode.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        const match = tags.filter((t) => t.tag === tagName);
        const tagObj = match.find((t) => !t.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t) => t.identify?.(value) && !t.format);
    }
    function createNode(value, tagName, ctx) {
      if (identity.isDocument(value))
        value = value.contents;
      if (identity.isNode(value))
        return value;
      if (identity.isPair(value)) {
        const map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
        map.items.push(value);
        return map;
      }
      if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
        value = value.valueOf();
      }
      const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
      let ref = void 0;
      if (aliasDuplicateObjects && value && typeof value === "object") {
        ref = sourceObjects.get(value);
        if (ref) {
          ref.anchor ?? (ref.anchor = onAnchor(value));
          return new Alias.Alias(ref.anchor);
        } else {
          ref = { anchor: null, node: null };
          sourceObjects.set(value, ref);
        }
      }
      if (tagName?.startsWith("!!"))
        tagName = defaultTagPrefix + tagName.slice(2);
      let tagObj = findTagObject(value, tagName, schema.tags);
      if (!tagObj) {
        if (value && typeof value.toJSON === "function") {
          value = value.toJSON();
        }
        if (!value || typeof value !== "object") {
          const node2 = new Scalar.Scalar(value);
          if (ref)
            ref.node = node2;
          return node2;
        }
        tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
      }
      if (onTagObj) {
        onTagObj(tagObj);
        delete ctx.onTagObj;
      }
      const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      if (tagName)
        node.tag = tagName;
      else if (!tagObj.default)
        node.tag = tagObj.tag;
      if (ref)
        ref.node = node;
      return node;
    }
    exports.createNode = createNode;
  }
});

// node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "node_modules/yaml/dist/nodes/Collection.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var identity = require_identity();
    var Node = require_Node();
    function collectionFromPath(schema, path, value) {
      let v = value;
      for (let i = path.length - 1; i >= 0; --i) {
        const k = path[i];
        if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
          const a = [];
          a[k] = v;
          v = a;
        } else {
          v = /* @__PURE__ */ new Map([[k, v]]);
        }
      }
      return createNode.createNode(v, void 0, {
        aliasDuplicateObjects: false,
        keepUndefined: false,
        onAnchor: () => {
          throw new Error("This should not happen, please report a bug.");
        },
        schema,
        sourceObjects: /* @__PURE__ */ new Map()
      });
    }
    var isEmptyPath = (path) => path == null || typeof path === "object" && !!path[Symbol.iterator]().next().done;
    var Collection = class extends Node.NodeBase {
      constructor(type, schema) {
        super(type);
        Object.defineProperty(this, "schema", {
          value: schema,
          configurable: true,
          enumerable: false,
          writable: true
        });
      }
      /**
       * Create a copy of this collection.
       *
       * @param schema - If defined, overwrites the original's schema
       */
      clone(schema) {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (schema)
          copy.schema = schema;
        copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path, value) {
        if (isEmptyPath(path))
          this.add(value);
        else {
          const [key, ...rest] = path;
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.addIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
      /**
       * Removes a value from the collection.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path) {
        const [key, ...rest] = path;
        if (rest.length === 0)
          return this.delete(key);
        const node = this.get(key, true);
        if (identity.isCollection(node))
          return node.deleteIn(rest);
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path, keepScalar) {
        const [key, ...rest] = path;
        const node = this.get(key, true);
        if (rest.length === 0)
          return !keepScalar && identity.isScalar(node) ? node.value : node;
        else
          return identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node) => {
          if (!identity.isPair(node))
            return false;
          const n = node.value;
          return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path) {
        const [key, ...rest] = path;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path, value) {
        const [key, ...rest] = path;
        if (rest.length === 0) {
          this.set(key, value);
        } else {
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.setIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
    };
    exports.Collection = Collection;
    exports.collectionFromPath = collectionFromPath;
    exports.isEmptyPath = isEmptyPath;
  }
});

// node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyComment.js"(exports) {
    "use strict";
    var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment, indent) {
      if (/^\n+$/.test(comment))
        return comment.substring(1);
      return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
    }
    var lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
    exports.indentComment = indentComment;
    exports.lineComment = lineComment;
    exports.stringifyComment = stringifyComment;
  }
});

// node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "node_modules/yaml/dist/stringify/foldFlowLines.js"(exports) {
    "use strict";
    var FOLD_FLOW = "flow";
    var FOLD_BLOCK = "block";
    var FOLD_QUOTED = "quoted";
    function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text;
      if (lineWidth < minContentWidth)
        minContentWidth = 0;
      const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
      if (text.length <= endStep)
        return text;
      const folds = [];
      const escapedFolds = {};
      let end = lineWidth - indent.length;
      if (typeof indentAtStart === "number") {
        if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
          folds.push(0);
        else
          end = lineWidth - indentAtStart;
      }
      let split = void 0;
      let prev = void 0;
      let overflow = false;
      let i = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i = consumeMoreIndentedLines(text, i, indent.length);
        if (i !== -1)
          end = i + endStep;
      }
      for (let ch; ch = text[i += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i;
          switch (text[i + 1]) {
            case "x":
              i += 3;
              break;
            case "u":
              i += 5;
              break;
            case "U":
              i += 9;
              break;
            default:
              i += 1;
          }
          escEnd = i;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i = consumeMoreIndentedLines(text, i, indent.length);
          end = i + indent.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next = text[i + 1];
            if (next && next !== " " && next !== "\n" && next !== "	")
              split = i;
          }
          if (i >= end) {
            if (split) {
              folds.push(split);
              end = split + endStep;
              split = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text[i += 1];
                overflow = true;
              }
              const j = i > escEnd + 1 ? i - 2 : escStart - 1;
              if (escapedFolds[j])
                return text;
              folds.push(j);
              escapedFolds[j] = true;
              end = j + endStep;
              split = void 0;
            } else {
              overflow = true;
            }
          }
        }
        prev = ch;
      }
      if (overflow && onOverflow)
        onOverflow();
      if (folds.length === 0)
        return text;
      if (onFold)
        onFold();
      let res = text.slice(0, folds[0]);
      for (let i2 = 0; i2 < folds.length; ++i2) {
        const fold = folds[i2];
        const end2 = folds[i2 + 1] || text.length;
        if (fold === 0)
          res = `
${indent}${text.slice(0, end2)}`;
        else {
          if (mode === FOLD_QUOTED && escapedFolds[fold])
            res += `${text[fold]}\\`;
          res += `
${indent}${text.slice(fold + 1, end2)}`;
        }
      }
      return res;
    }
    function consumeMoreIndentedLines(text, i, indent) {
      let end = i;
      let start = i + 1;
      let ch = text[start];
      while (ch === " " || ch === "	") {
        if (i < start + indent) {
          ch = text[++i];
        } else {
          do {
            ch = text[++i];
          } while (ch && ch !== "\n");
          end = i;
          start = i + 1;
          ch = text[start];
        }
      }
      return end;
    }
    exports.FOLD_BLOCK = FOLD_BLOCK;
    exports.FOLD_FLOW = FOLD_FLOW;
    exports.FOLD_QUOTED = FOLD_QUOTED;
    exports.foldFlowLines = foldFlowLines;
  }
});

// node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyString.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var foldFlowLines = require_foldFlowLines();
    var getFoldOptions = (ctx, isBlock) => ({
      indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
      lineWidth: ctx.options.lineWidth,
      minContentWidth: ctx.options.minContentWidth
    });
    var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
    function lineLengthOverLimit(str, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return false;
      const limit = lineWidth - indentLength;
      const strLen = str.length;
      if (strLen <= limit)
        return false;
      for (let i = 0, start = 0; i < strLen; ++i) {
        if (str[i] === "\n") {
          if (i - start > limit)
            return true;
          start = i + 1;
          if (strLen - start <= limit)
            return false;
        }
      }
      return true;
    }
    function doubleQuotedString(value, ctx) {
      const json = JSON.stringify(value);
      if (ctx.options.doubleQuotedAsJSON)
        return json;
      const { implicitKey } = ctx;
      const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      let str = "";
      let start = 0;
      for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
        if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
          str += json.slice(start, i) + "\\ ";
          i += 1;
          start = i;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json[i + 1]) {
            case "u":
              {
                str += json.slice(start, i);
                const code = json.substr(i + 2, 4);
                switch (code) {
                  case "0000":
                    str += "\\0";
                    break;
                  case "0007":
                    str += "\\a";
                    break;
                  case "000b":
                    str += "\\v";
                    break;
                  case "001b":
                    str += "\\e";
                    break;
                  case "0085":
                    str += "\\N";
                    break;
                  case "00a0":
                    str += "\\_";
                    break;
                  case "2028":
                    str += "\\L";
                    break;
                  case "2029":
                    str += "\\P";
                    break;
                  default:
                    if (code.substr(0, 2) === "00")
                      str += "\\x" + code.substr(2);
                    else
                      str += json.substr(i, 6);
                }
                i += 5;
                start = i + 1;
              }
              break;
            case "n":
              if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
                i += 1;
              } else {
                str += json.slice(start, i) + "\n\n";
                while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
                  str += "\n";
                  i += 2;
                }
                str += indent;
                if (json[i + 2] === " ")
                  str += "\\";
                i += 1;
                start = i + 1;
              }
              break;
            default:
              i += 1;
          }
      }
      str = start ? str + json.slice(start) : json;
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
    }
    function singleQuotedString(value, ctx) {
      if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
        return doubleQuotedString(value, ctx);
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
      return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function quotedString(value, ctx) {
      const { singleQuote } = ctx.options;
      let qs;
      if (singleQuote === false)
        qs = doubleQuotedString;
      else {
        const hasDouble = value.includes('"');
        const hasSingle = value.includes("'");
        if (hasDouble && !hasSingle)
          qs = singleQuotedString;
        else if (hasSingle && !hasDouble)
          qs = doubleQuotedString;
        else
          qs = singleQuote ? singleQuotedString : doubleQuotedString;
      }
      return qs(value, ctx);
    }
    var blockEndNewlines;
    try {
      blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
    } catch {
      blockEndNewlines = /\n+(?!\n|$)/g;
    }
    function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
      const { blockQuote, commentString, lineWidth } = ctx.options;
      if (!blockQuote || /\n[\t ]+$/.test(value)) {
        return quotedString(value, ctx);
      }
      const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
      const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
      if (!value)
        return literal ? "|\n" : ">\n";
      let chomp;
      let endStart;
      for (endStart = value.length; endStart > 0; --endStart) {
        const ch = value[endStart - 1];
        if (ch !== "\n" && ch !== "	" && ch !== " ")
          break;
      }
      let end = value.substring(endStart);
      const endNlPos = end.indexOf("\n");
      if (endNlPos === -1) {
        chomp = "-";
      } else if (value === end || endNlPos !== end.length - 1) {
        chomp = "+";
        if (onChompKeep)
          onChompKeep();
      } else {
        chomp = "";
      }
      if (end) {
        value = value.slice(0, -end.length);
        if (end[end.length - 1] === "\n")
          end = end.slice(0, -1);
        end = end.replace(blockEndNewlines, `$&${indent}`);
      }
      let startWithSpace = false;
      let startEnd;
      let startNlPos = -1;
      for (startEnd = 0; startEnd < value.length; ++startEnd) {
        const ch = value[startEnd];
        if (ch === " ")
          startWithSpace = true;
        else if (ch === "\n")
          startNlPos = startEnd;
        else
          break;
      }
      let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
      if (start) {
        value = value.substring(start.length);
        start = start.replace(/\n+/g, `$&${indent}`);
      }
      const indentSize = indent ? "2" : "1";
      let header = (startWithSpace ? indentSize : "") + chomp;
      if (comment) {
        header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
        if (onComment)
          onComment();
      }
      if (!literal) {
        const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
        let literalFallback = false;
        const foldOptions = getFoldOptions(ctx, true);
        if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) {
          foldOptions.onOverflow = () => {
            literalFallback = true;
          };
        }
        const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
        if (!literalFallback)
          return `>${header}
${indent}${body}`;
      }
      value = value.replace(/\n+/g, `$&${indent}`);
      return `|${header}
${indent}${start}${value}${end}`;
    }
    function plainString(item, ctx, onComment, onChompKeep) {
      const { type, value } = item;
      const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
      if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
        return quotedString(value, ctx);
      }
      if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
        return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
      }
      if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) {
        return blockString(item, ctx, onComment, onChompKeep);
      }
      if (containsDocumentMarker(value)) {
        if (indent === "") {
          ctx.forceBlockIndent = true;
          return blockString(item, ctx, onComment, onChompKeep);
        } else if (implicitKey && indent === indentStep) {
          return quotedString(value, ctx);
        }
      }
      const str = value.replace(/\n+/g, `$&
${indent}`);
      if (actualString) {
        const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
        const { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function stringifyString(item, ctx, onComment, onChompKeep) {
      const { implicitKey, inFlow } = ctx;
      const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
      let { type } = item;
      if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
        if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
          type = Scalar.Scalar.QUOTE_DOUBLE;
      }
      const _stringify = (_type) => {
        switch (_type) {
          case Scalar.Scalar.BLOCK_FOLDED:
          case Scalar.Scalar.BLOCK_LITERAL:
            return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
          case Scalar.Scalar.QUOTE_DOUBLE:
            return doubleQuotedString(ss.value, ctx);
          case Scalar.Scalar.QUOTE_SINGLE:
            return singleQuotedString(ss.value, ctx);
          case Scalar.Scalar.PLAIN:
            return plainString(ss, ctx, onComment, onChompKeep);
          default:
            return null;
        }
      };
      let res = _stringify(type);
      if (res === null) {
        const { defaultKeyType, defaultStringType } = ctx.options;
        const t = implicitKey && defaultKeyType || defaultStringType;
        res = _stringify(t);
        if (res === null)
          throw new Error(`Unsupported default string type ${t}`);
      }
      return res;
    }
    exports.stringifyString = stringifyString;
  }
});

// node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "node_modules/yaml/dist/stringify/stringify.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var identity = require_identity();
    var stringifyComment = require_stringifyComment();
    var stringifyString = require_stringifyString();
    function createStringifyContext(doc, options) {
      const opt = Object.assign({
        blockQuote: true,
        commentString: stringifyComment.stringifyComment,
        defaultKeyType: null,
        defaultStringType: "PLAIN",
        directives: null,
        doubleQuotedAsJSON: false,
        doubleQuotedMinMultiLineLength: 40,
        falseStr: "false",
        flowCollectionPadding: true,
        indentSeq: true,
        lineWidth: 80,
        minContentWidth: 20,
        nullStr: "null",
        simpleKeys: false,
        singleQuote: null,
        trailingComma: false,
        trueStr: "true",
        verifyAliasOrder: true
      }, doc.schema.toStringOptions, options);
      let inFlow;
      switch (opt.collectionStyle) {
        case "block":
          inFlow = false;
          break;
        case "flow":
          inFlow = true;
          break;
        default:
          inFlow = null;
      }
      return {
        anchors: /* @__PURE__ */ new Set(),
        doc,
        flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
        indent: "",
        indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
        inFlow,
        options: opt
      };
    }
    function getTagObject(tags, item) {
      if (item.tag) {
        const match = tags.filter((t) => t.tag === item.tag);
        if (match.length > 0)
          return match.find((t) => t.format === item.format) ?? match[0];
      }
      let tagObj = void 0;
      let obj;
      if (identity.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t) => t.identify?.(obj));
        if (match.length > 1) {
          const testMatch = match.filter((t) => t.test);
          if (testMatch.length > 0)
            match = testMatch;
        }
        tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
      } else {
        obj = item;
        tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
      }
      if (!tagObj) {
        const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
        throw new Error(`Tag not resolved for ${name} value`);
      }
      return tagObj;
    }
    function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      const props = [];
      const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
      if (anchor && anchors.anchorIsValid(anchor)) {
        anchors$1.add(anchor);
        props.push(`&${anchor}`);
      }
      const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
      if (tag)
        props.push(doc.directives.tagString(tag));
      return props.join(" ");
    }
    function stringify(item, ctx, onComment, onChompKeep) {
      if (identity.isPair(item))
        return item.toString(ctx, onComment, onChompKeep);
      if (identity.isAlias(item)) {
        if (ctx.doc.directives)
          return item.toString(ctx);
        if (ctx.resolvedAliases?.has(item)) {
          throw new TypeError(`Cannot stringify circular structure without alias nodes`);
        } else {
          if (ctx.resolvedAliases)
            ctx.resolvedAliases.add(item);
          else
            ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
          item = item.resolve(ctx.doc);
        }
      }
      let tagObj = void 0;
      const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
      const props = stringifyProps(node, tagObj, ctx);
      if (props.length > 0)
        ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
      const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str;
      return identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
    }
    exports.createStringifyContext = createStringifyContext;
    exports.stringify = stringify;
  }
});

// node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyPair.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
      const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
      let keyComment = identity.isNode(key) && key.comment || null;
      if (simpleKeys) {
        if (keyComment) {
          throw new Error("With simple keys, key nodes cannot have comments");
        }
        if (identity.isCollection(key) || !identity.isNode(key) && typeof key === "object") {
          const msg = "With simple keys, collection cannot be used as a key value";
          throw new Error(msg);
        }
      }
      let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
      ctx = Object.assign({}, ctx, {
        allNullValues: false,
        implicitKey: !explicitKey && (simpleKeys || !allNullValues),
        indent: indent + indentStep
      });
      let keyCommentDone = false;
      let chompKeep = false;
      let str = stringify.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
      if (!explicitKey && !ctx.inFlow && str.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = true;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null) {
          if (keyCommentDone && onComment)
            onComment();
          return str === "" ? "?" : explicitKey ? `? ${str}` : str;
        }
      } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
        str = `? ${str}`;
        if (keyComment && !keyCommentDone) {
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        } else if (chompKeep && onChompKeep)
          onChompKeep();
        return str;
      }
      if (keyCommentDone)
        keyComment = null;
      if (explicitKey) {
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        str = `? ${str}
${indent}:`;
      } else {
        str = `${str}:`;
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
      }
      let vsb, vcb, valueComment;
      if (identity.isNode(value)) {
        vsb = !!value.spaceBefore;
        vcb = value.commentBefore;
        valueComment = value.comment;
      } else {
        vsb = false;
        vcb = null;
        valueComment = null;
        if (value && typeof value === "object")
          value = doc.createNode(value);
      }
      ctx.implicitKey = false;
      if (!explicitKey && !keyComment && identity.isScalar(value))
        ctx.indentAtStart = str.length + 1;
      chompKeep = false;
      if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
        ctx.indent = ctx.indent.substring(2);
      }
      let valueCommentDone = false;
      const valueStr = stringify.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
      let ws = " ";
      if (keyComment || vsb || vcb) {
        ws = vsb ? "\n" : "";
        if (vcb) {
          const cs = commentString(vcb);
          ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
        }
        if (valueStr === "" && !ctx.inFlow) {
          if (ws === "\n" && valueComment)
            ws = "\n\n";
        } else {
          ws += `
${ctx.indent}`;
        }
      } else if (!explicitKey && identity.isCollection(value)) {
        const vs0 = valueStr[0];
        const nl0 = valueStr.indexOf("\n");
        const hasNewline = nl0 !== -1;
        const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
        if (hasNewline || !flow) {
          let hasPropsLine = false;
          if (hasNewline && (vs0 === "&" || vs0 === "!")) {
            let sp0 = valueStr.indexOf(" ");
            if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
              sp0 = valueStr.indexOf(" ", sp0 + 1);
            }
            if (sp0 === -1 || nl0 < sp0)
              hasPropsLine = true;
          }
          if (!hasPropsLine)
            ws = `
${ctx.indent}`;
        }
      } else if (valueStr === "" || valueStr[0] === "\n") {
        ws = "";
      }
      str += ws + valueStr;
      if (ctx.inFlow) {
        if (valueCommentDone && onComment)
          onComment();
      } else if (valueComment && !valueCommentDone) {
        str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment));
      } else if (chompKeep && onChompKeep) {
        onChompKeep();
      }
      return str;
    }
    exports.stringifyPair = stringifyPair;
  }
});

// node_modules/yaml/dist/log.js
var require_log = __commonJS({
  "node_modules/yaml/dist/log.js"(exports) {
    "use strict";
    var node_process = __require("process");
    function debug(logLevel, ...messages) {
      if (logLevel === "debug")
        console.log(...messages);
    }
    function warn(logLevel, warning) {
      if (logLevel === "debug" || logLevel === "warn") {
        if (typeof node_process.emitWarning === "function")
          node_process.emitWarning(warning);
        else
          console.warn(warning);
      }
    }
    exports.debug = debug;
    exports.warn = warn;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/merge.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var MERGE_KEY = "<<";
    var merge = {
      identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
      default: "key",
      tag: "tag:yaml.org,2002:merge",
      test: /^<<$/,
      resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
        addToJSMap: addMergeToJSMap
      }),
      stringify: () => MERGE_KEY
    };
    var isMergeKey = (ctx, key) => (merge.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
    function addMergeToJSMap(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (identity.isSeq(source))
        for (const it of source.items)
          mergeValue(ctx, map, it);
      else if (Array.isArray(source))
        for (const it of source)
          mergeValue(ctx, map, it);
      else
        mergeValue(ctx, map, source);
    }
    function mergeValue(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (!identity.isMap(source))
        throw new Error("Merge sources must be maps or map aliases");
      const srcMap = source.toJSON(null, ctx, Map);
      for (const [key, value2] of srcMap) {
        if (map instanceof Map) {
          if (!map.has(key))
            map.set(key, value2);
        } else if (map instanceof Set) {
          map.add(key);
        } else if (!Object.prototype.hasOwnProperty.call(map, key)) {
          Object.defineProperty(map, key, {
            value: value2,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      }
      return map;
    }
    function resolveAliasValue(ctx, value) {
      return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
    }
    exports.addMergeToJSMap = addMergeToJSMap;
    exports.isMergeKey = isMergeKey;
    exports.merge = merge;
  }
});

// node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports) {
    "use strict";
    var log2 = require_log();
    var merge = require_merge();
    var stringify = require_stringify();
    var identity = require_identity();
    var toJS = require_toJS();
    function addPairToJSMap(ctx, map, { key, value }) {
      if (identity.isNode(key) && key.addToJSMap)
        key.addToJSMap(ctx, map, value);
      else if (merge.isMergeKey(ctx, key))
        merge.addMergeToJSMap(ctx, map, value);
      else {
        const jsKey = toJS.toJS(key, "", ctx);
        if (map instanceof Map) {
          map.set(jsKey, toJS.toJS(value, jsKey, ctx));
        } else if (map instanceof Set) {
          map.add(jsKey);
        } else {
          const stringKey = stringifyKey(key, jsKey, ctx);
          const jsValue = toJS.toJS(value, stringKey, ctx);
          if (stringKey in map)
            Object.defineProperty(map, stringKey, {
              value: jsValue,
              writable: true,
              enumerable: true,
              configurable: true
            });
          else
            map[stringKey] = jsValue;
        }
      }
      return map;
    }
    function stringifyKey(key, jsKey, ctx) {
      if (jsKey === null)
        return "";
      if (typeof jsKey !== "object")
        return String(jsKey);
      if (identity.isNode(key) && ctx?.doc) {
        const strCtx = stringify.createStringifyContext(ctx.doc, {});
        strCtx.anchors = /* @__PURE__ */ new Set();
        for (const node of ctx.anchors.keys())
          strCtx.anchors.add(node.anchor);
        strCtx.inFlow = true;
        strCtx.inStringifyKey = true;
        const strKey = key.toString(strCtx);
        if (!ctx.mapKeyWarned) {
          let jsonStr = JSON.stringify(strKey);
          if (jsonStr.length > 40)
            jsonStr = jsonStr.substring(0, 36) + '..."';
          log2.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
          ctx.mapKeyWarned = true;
        }
        return strKey;
      }
      return JSON.stringify(jsKey);
    }
    exports.addPairToJSMap = addPairToJSMap;
  }
});

// node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS({
  "node_modules/yaml/dist/nodes/Pair.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyPair = require_stringifyPair();
    var addPairToJSMap = require_addPairToJSMap();
    var identity = require_identity();
    function createPair(key, value, ctx) {
      const k = createNode.createNode(key, void 0, ctx);
      const v = createNode.createNode(value, void 0, ctx);
      return new Pair(k, v);
    }
    var Pair = class _Pair {
      constructor(key, value = null) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR });
        this.key = key;
        this.value = value;
      }
      clone(schema) {
        let { key, value } = this;
        if (identity.isNode(key))
          key = key.clone(schema);
        if (identity.isNode(value))
          value = value.clone(schema);
        return new _Pair(key, value);
      }
      toJSON(_, ctx) {
        const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        return addPairToJSMap.addPairToJSMap(ctx, pair, this);
      }
      toString(ctx, onComment, onChompKeep) {
        return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
      }
    };
    exports.Pair = Pair;
    exports.createPair = createPair;
  }
});

// node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyCollection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      const flow = ctx.inFlow ?? collection.flow;
      const stringify2 = flow ? stringifyFlowCollection : stringifyBlockCollection;
      return stringify2(collection, ctx, options);
    }
    function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
      const { indent, options: { commentString } } = ctx;
      const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
      let chompKeep = false;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment2 = null;
        if (identity.isNode(item)) {
          if (!chompKeep && item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
          if (item.comment)
            comment2 = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (!chompKeep && ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
          }
        }
        chompKeep = false;
        let str2 = stringify.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
        if (comment2)
          str2 += stringifyComment.lineComment(str2, itemIndent, commentString(comment2));
        if (chompKeep && comment2)
          chompKeep = false;
        lines.push(blockItemPrefix + str2);
      }
      let str;
      if (lines.length === 0) {
        str = flowChars.start + flowChars.end;
      } else {
        str = lines[0];
        for (let i = 1; i < lines.length; ++i) {
          const line = lines[i];
          str += line ? `
${indent}${line}` : "\n";
        }
      }
      if (comment) {
        str += "\n" + stringifyComment.indentComment(commentString(comment), indent);
        if (onComment)
          onComment();
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str;
    }
    function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
      const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
      itemIndent += indentStep;
      const itemCtx = Object.assign({}, ctx, {
        indent: itemIndent,
        inFlow: true,
        type: null
      });
      let reqNewline = false;
      let linesAtValue = 0;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment = null;
        if (identity.isNode(item)) {
          if (item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, false);
          if (item.comment)
            comment = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, false);
            if (ik.comment)
              reqNewline = true;
          }
          const iv = identity.isNode(item.value) ? item.value : null;
          if (iv) {
            if (iv.comment)
              comment = iv.comment;
            if (iv.commentBefore)
              reqNewline = true;
          } else if (item.value == null && ik?.comment) {
            comment = ik.comment;
          }
        }
        if (comment)
          reqNewline = true;
        let str = stringify.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
        if (i < items.length - 1) {
          str += ",";
        } else if (ctx.options.trailingComma) {
          if (ctx.options.lineWidth > 0) {
            reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
          }
          if (reqNewline) {
            str += ",";
          }
        }
        if (comment)
          str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
        lines.push(str);
        linesAtValue = lines.length;
      }
      const { start, end } = flowChars;
      if (lines.length === 0) {
        return start + end;
      } else {
        if (!reqNewline) {
          const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
          reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
        }
        if (reqNewline) {
          let str = start;
          for (const line of lines)
            str += line ? `
${indentStep}${indent}${line}` : "\n";
          return `${str}
${indent}${end}`;
        } else {
          return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
        }
      }
    }
    function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
      if (comment && chompKeep)
        comment = comment.replace(/^\n+/, "");
      if (comment) {
        const ic = stringifyComment.indentComment(commentString(comment), indent);
        lines.push(ic.trimStart());
      }
    }
    exports.stringifyCollection = stringifyCollection;
  }
});

// node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLMap.js"(exports) {
    "use strict";
    var stringifyCollection = require_stringifyCollection();
    var addPairToJSMap = require_addPairToJSMap();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    function findPair(items, key) {
      const k = identity.isScalar(key) ? key.value : key;
      for (const it of items) {
        if (identity.isPair(it)) {
          if (it.key === key || it.key === k)
            return it;
          if (identity.isScalar(it.key) && it.key.value === k)
            return it;
        }
      }
      return void 0;
    }
    var YAMLMap = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:map";
      }
      constructor(schema) {
        super(identity.MAP, schema);
        this.items = [];
      }
      /**
       * A generic collection parsing method that can be extended
       * to other node classes that inherit from YAMLMap
       */
      static from(schema, obj, ctx) {
        const { keepUndefined, replacer } = ctx;
        const map = new this(schema);
        const add = (key, value) => {
          if (typeof replacer === "function")
            value = replacer.call(obj, key, value);
          else if (Array.isArray(replacer) && !replacer.includes(key))
            return;
          if (value !== void 0 || keepUndefined)
            map.items.push(Pair.createPair(key, value, ctx));
        };
        if (obj instanceof Map) {
          for (const [key, value] of obj)
            add(key, value);
        } else if (obj && typeof obj === "object") {
          for (const key of Object.keys(obj))
            add(key, obj[key]);
        }
        if (typeof schema.sortMapEntries === "function") {
          map.items.sort(schema.sortMapEntries);
        }
        return map;
      }
      /**
       * Adds a value to the collection.
       *
       * @param overwrite - If not set `true`, using a key that is already in the
       *   collection will throw. Otherwise, overwrites the previous value.
       */
      add(pair, overwrite) {
        let _pair;
        if (identity.isPair(pair))
          _pair = pair;
        else if (!pair || typeof pair !== "object" || !("key" in pair)) {
          _pair = new Pair.Pair(pair, pair?.value);
        } else
          _pair = new Pair.Pair(pair.key, pair.value);
        const prev = findPair(this.items, _pair.key);
        const sortEntries = this.schema?.sortMapEntries;
        if (prev) {
          if (!overwrite)
            throw new Error(`Key ${_pair.key} already set`);
          if (identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value))
            prev.value.value = _pair.value;
          else
            prev.value = _pair.value;
        } else if (sortEntries) {
          const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          if (i === -1)
            this.items.push(_pair);
          else
            this.items.splice(i, 0, _pair);
        } else {
          this.items.push(_pair);
        }
      }
      delete(key) {
        const it = findPair(this.items, key);
        if (!it)
          return false;
        const del = this.items.splice(this.items.indexOf(it), 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const it = findPair(this.items, key);
        const node = it?.value;
        return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
      }
      has(key) {
        return !!findPair(this.items, key);
      }
      set(key, value) {
        this.add(new Pair.Pair(key, value), true);
      }
      /**
       * @param ctx - Conversion context, originally set in Document#toJS()
       * @param {Class} Type - If set, forces the returned collection type
       * @returns Instance of Type, Map, or Object
       */
      toJSON(_, ctx, Type) {
        const map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const item of this.items)
          addPairToJSMap.addPairToJSMap(ctx, map, item);
        return map;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        for (const item of this.items) {
          if (!identity.isPair(item))
            throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
        }
        if (!ctx.allNullValues && this.hasAllNullValues(false))
          ctx = Object.assign({}, ctx, { allNullValues: true });
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "",
          flowChars: { start: "{", end: "}" },
          itemIndent: ctx.indent || "",
          onChompKeep,
          onComment
        });
      }
    };
    exports.YAMLMap = YAMLMap;
    exports.findPair = findPair;
  }
});

// node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS({
  "node_modules/yaml/dist/schema/common/map.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLMap = require_YAMLMap();
    var map = {
      collection: "map",
      default: true,
      nodeClass: YAMLMap.YAMLMap,
      tag: "tag:yaml.org,2002:map",
      resolve(map2, onError) {
        if (!identity.isMap(map2))
          onError("Expected a mapping for this tag");
        return map2;
      },
      createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
    };
    exports.map = map;
  }
});

// node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLSeq.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyCollection = require_stringifyCollection();
    var Collection = require_Collection();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var toJS = require_toJS();
    var YAMLSeq = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:seq";
      }
      constructor(schema) {
        super(identity.SEQ, schema);
        this.items = [];
      }
      add(value) {
        this.items.push(value);
      }
      /**
       * Removes a value from the collection.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       *
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return false;
        const del = this.items.splice(idx, 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return void 0;
        const it = this.items[idx];
        return !keepScalar && identity.isScalar(it) ? it.value : it;
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       */
      has(key) {
        const idx = asItemIndex(key);
        return typeof idx === "number" && idx < this.items.length;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       *
       * If `key` does not contain a representation of an integer, this will throw.
       * It may be wrapped in a `Scalar`.
       */
      set(key, value) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          throw new Error(`Expected a valid index, not ${key}.`);
        const prev = this.items[idx];
        if (identity.isScalar(prev) && Scalar.isScalarValue(value))
          prev.value = value;
        else
          this.items[idx] = value;
      }
      toJSON(_, ctx) {
        const seq = [];
        if (ctx?.onCreate)
          ctx.onCreate(seq);
        let i = 0;
        for (const item of this.items)
          seq.push(toJS.toJS(item, String(i++), ctx));
        return seq;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "- ",
          flowChars: { start: "[", end: "]" },
          itemIndent: (ctx.indent || "") + "  ",
          onChompKeep,
          onComment
        });
      }
      static from(schema, obj, ctx) {
        const { replacer } = ctx;
        const seq = new this(schema);
        if (obj && Symbol.iterator in Object(obj)) {
          let i = 0;
          for (let it of obj) {
            if (typeof replacer === "function") {
              const key = obj instanceof Set ? it : String(i++);
              it = replacer.call(obj, key, it);
            }
            seq.items.push(createNode.createNode(it, void 0, ctx));
          }
        }
        return seq;
      }
    };
    function asItemIndex(key) {
      let idx = identity.isScalar(key) ? key.value : key;
      if (idx && typeof idx === "string")
        idx = Number(idx);
      return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
    }
    exports.YAMLSeq = YAMLSeq;
  }
});

// node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS({
  "node_modules/yaml/dist/schema/common/seq.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLSeq = require_YAMLSeq();
    var seq = {
      collection: "seq",
      default: true,
      nodeClass: YAMLSeq.YAMLSeq,
      tag: "tag:yaml.org,2002:seq",
      resolve(seq2, onError) {
        if (!identity.isSeq(seq2))
          onError("Expected a sequence for this tag");
        return seq2;
      },
      createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
    };
    exports.seq = seq;
  }
});

// node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS({
  "node_modules/yaml/dist/schema/common/string.js"(exports) {
    "use strict";
    var stringifyString = require_stringifyString();
    var string = {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str) => str,
      stringify(item, ctx, onComment, onChompKeep) {
        ctx = Object.assign({ actualString: true }, ctx);
        return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
      }
    };
    exports.string = string;
  }
});

// node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS({
  "node_modules/yaml/dist/schema/common/null.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var nullTag = {
      identify: (value) => value == null,
      createNode: () => new Scalar.Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^(?:~|[Nn]ull|NULL)?$/,
      resolve: () => new Scalar.Scalar(null),
      stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
    };
    exports.nullTag = nullTag;
  }
});

// node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS({
  "node_modules/yaml/dist/schema/core/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var boolTag = {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
      resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
      stringify({ source, value }, ctx) {
        if (source && boolTag.test.test(source)) {
          const sv = source[0] === "t" || source[0] === "T";
          if (value === sv)
            return source;
        }
        return value ? ctx.options.trueStr : ctx.options.falseStr;
      }
    };
    exports.boolTag = boolTag;
  }
});

// node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyNumber.js"(exports) {
    "use strict";
    function stringifyNumber({ format, minFractionDigits, tag, value }) {
      if (typeof value === "bigint")
        return String(value);
      const num = typeof value === "number" ? value : Number(value);
      if (!isFinite(num))
        return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
      let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
        let i = n.indexOf(".");
        if (i < 0) {
          i = n.length;
          n += ".";
        }
        let d = minFractionDigits - (n.length - i - 1);
        while (d-- > 0)
          n += "0";
      }
      return n;
    }
    exports.stringifyNumber = stringifyNumber;
  }
});

// node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS({
  "node_modules/yaml/dist/schema/core/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str));
        const dot = str.indexOf(".");
        if (dot !== -1 && str[str.length - 1] === "0")
          node.minFractionDigits = str.length - dot - 1;
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS({
  "node_modules/yaml/dist/schema/core/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    var intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value) && value >= 0)
        return prefix + value.toString(radix);
      return stringifyNumber.stringifyNumber(node);
    }
    var intOct = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^0o[0-7]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
      stringify: (node) => intStringify(node, 8, "0o")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^0x[0-9a-fA-F]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "node_modules/yaml/dist/schema/core/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.boolTag,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float
    ];
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS({
  "node_modules/yaml/dist/schema/json/schema.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var map = require_map();
    var seq = require_seq();
    function intIdentify(value) {
      return typeof value === "bigint" || Number.isInteger(value);
    }
    var stringifyJSON = ({ value }) => JSON.stringify(value);
    var jsonScalars = [
      {
        identify: (value) => typeof value === "string",
        default: true,
        tag: "tag:yaml.org,2002:str",
        resolve: (str) => str,
        stringify: stringifyJSON
      },
      {
        identify: (value) => value == null,
        createNode: () => new Scalar.Scalar(null),
        default: true,
        tag: "tag:yaml.org,2002:null",
        test: /^null$/,
        resolve: () => null,
        stringify: stringifyJSON
      },
      {
        identify: (value) => typeof value === "boolean",
        default: true,
        tag: "tag:yaml.org,2002:bool",
        test: /^true$|^false$/,
        resolve: (str) => str === "true",
        stringify: stringifyJSON
      },
      {
        identify: intIdentify,
        default: true,
        tag: "tag:yaml.org,2002:int",
        test: /^-?(?:0|[1-9][0-9]*)$/,
        resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
        stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
      },
      {
        identify: (value) => typeof value === "number",
        default: true,
        tag: "tag:yaml.org,2002:float",
        test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
        resolve: (str) => parseFloat(str),
        stringify: stringifyJSON
      }
    ];
    var jsonError = {
      default: true,
      tag: "",
      test: /^/,
      resolve(str, onError) {
        onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
        return str;
      }
    };
    var schema = [map.map, seq.seq].concat(jsonScalars, jsonError);
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/binary.js"(exports) {
    "use strict";
    var node_buffer = __require("buffer");
    var Scalar = require_Scalar();
    var stringifyString = require_stringifyString();
    var binary = {
      identify: (value) => value instanceof Uint8Array,
      // Buffer inherits from Uint8Array
      default: false,
      tag: "tag:yaml.org,2002:binary",
      /**
       * Returns a Buffer in node and an Uint8Array in browsers
       *
       * To use the resulting buffer as an image, you'll want to do something like:
       *
       *   const blob = new Blob([buffer], { type: 'image/jpeg' })
       *   document.querySelector('#photo').src = URL.createObjectURL(blob)
       */
      resolve(src, onError) {
        if (typeof node_buffer.Buffer === "function") {
          return node_buffer.Buffer.from(src, "base64");
        } else if (typeof atob === "function") {
          const str = atob(src.replace(/[\n\r]/g, ""));
          const buffer = new Uint8Array(str.length);
          for (let i = 0; i < str.length; ++i)
            buffer[i] = str.charCodeAt(i);
          return buffer;
        } else {
          onError("This environment does not support reading binary tags; either Buffer or atob is required");
          return src;
        }
      },
      stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
        if (!value)
          return "";
        const buf = value;
        let str;
        if (typeof node_buffer.Buffer === "function") {
          str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
        } else if (typeof btoa === "function") {
          let s = "";
          for (let i = 0; i < buf.length; ++i)
            s += String.fromCharCode(buf[i]);
          str = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n = Math.ceil(str.length / lineWidth);
          const lines = new Array(n);
          for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
            lines[i] = str.substr(o, lineWidth);
          }
          str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
        }
        return stringifyString.stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
      }
    };
    exports.binary = binary;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/pairs.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLSeq = require_YAMLSeq();
    function resolvePairs(seq, onError) {
      if (identity.isSeq(seq)) {
        for (let i = 0; i < seq.items.length; ++i) {
          let item = seq.items[i];
          if (identity.isPair(item))
            continue;
          else if (identity.isMap(item)) {
            if (item.items.length > 1)
              onError("Each pair must have its own sequence indicator");
            const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
            if (item.commentBefore)
              pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
            if (item.comment) {
              const cn = pair.value ?? pair.key;
              cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
            }
            item = pair;
          }
          seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
        }
      } else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      const { replacer } = ctx;
      const pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          if (typeof replacer === "function")
            it = replacer.call(iterable, String(i++), it);
          let key, value;
          if (Array.isArray(it)) {
            if (it.length === 2) {
              key = it[0];
              value = it[1];
            } else
              throw new TypeError(`Expected [key, value] tuple: ${it}`);
          } else if (it && it instanceof Object) {
            const keys = Object.keys(it);
            if (keys.length === 1) {
              key = keys[0];
              value = it[key];
            } else {
              throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
            }
          } else {
            key = it;
          }
          pairs2.items.push(Pair.createPair(key, value, ctx));
        }
      return pairs2;
    }
    var pairs = {
      collection: "seq",
      default: false,
      tag: "tag:yaml.org,2002:pairs",
      resolve: resolvePairs,
      createNode: createPairs
    };
    exports.createPairs = createPairs;
    exports.pairs = pairs;
    exports.resolvePairs = resolvePairs;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/omap.js"(exports) {
    "use strict";
    var identity = require_identity();
    var toJS = require_toJS();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var pairs = require_pairs();
    var YAMLOMap = class _YAMLOMap extends YAMLSeq.YAMLSeq {
      constructor() {
        super();
        this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
        this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
        this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
        this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
        this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
        this.tag = _YAMLOMap.tag;
      }
      /**
       * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
       * but TypeScript won't allow widening the signature of a child method.
       */
      toJSON(_, ctx) {
        if (!ctx)
          return super.toJSON(_);
        const map = /* @__PURE__ */ new Map();
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const pair of this.items) {
          let key, value;
          if (identity.isPair(pair)) {
            key = toJS.toJS(pair.key, "", ctx);
            value = toJS.toJS(pair.value, key, ctx);
          } else {
            key = toJS.toJS(pair, "", ctx);
          }
          if (map.has(key))
            throw new Error("Ordered maps must not include duplicate keys");
          map.set(key, value);
        }
        return map;
      }
      static from(schema, iterable, ctx) {
        const pairs$1 = pairs.createPairs(schema, iterable, ctx);
        const omap2 = new this();
        omap2.items = pairs$1.items;
        return omap2;
      }
    };
    YAMLOMap.tag = "tag:yaml.org,2002:omap";
    var omap = {
      collection: "seq",
      identify: (value) => value instanceof Map,
      nodeClass: YAMLOMap,
      default: false,
      tag: "tag:yaml.org,2002:omap",
      resolve(seq, onError) {
        const pairs$1 = pairs.resolvePairs(seq, onError);
        const seenKeys = [];
        for (const { key } of pairs$1.items) {
          if (identity.isScalar(key)) {
            if (seenKeys.includes(key.value)) {
              onError(`Ordered maps must not include duplicate keys: ${key.value}`);
            } else {
              seenKeys.push(key.value);
            }
          }
        }
        return Object.assign(new YAMLOMap(), pairs$1);
      },
      createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
    };
    exports.YAMLOMap = YAMLOMap;
    exports.omap = omap;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function boolStringify({ value, source }, ctx) {
      const boolObj = value ? trueTag : falseTag;
      if (source && boolObj.test.test(source))
        return source;
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
    var trueTag = {
      identify: (value) => value === true,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
      resolve: () => new Scalar.Scalar(true),
      stringify: boolStringify
    };
    var falseTag = {
      identify: (value) => value === false,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
      resolve: () => new Scalar.Scalar(false),
      stringify: boolStringify
    };
    exports.falseTag = falseTag;
    exports.trueTag = trueTag;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str.replace(/_/g, "")),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str.replace(/_/g, "")));
        const dot = str.indexOf(".");
        if (dot !== -1) {
          const f = str.substring(dot + 1).replace(/_/g, "");
          if (f[f.length - 1] === "0")
            node.minFractionDigits = f.length;
        }
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    function intResolve(str, offset, radix, { intAsBigInt }) {
      const sign = str[0];
      if (sign === "-" || sign === "+")
        offset += 1;
      str = str.substring(offset).replace(/_/g, "");
      if (intAsBigInt) {
        switch (radix) {
          case 2:
            str = `0b${str}`;
            break;
          case 8:
            str = `0o${str}`;
            break;
          case 16:
            str = `0x${str}`;
            break;
        }
        const n2 = BigInt(str);
        return sign === "-" ? BigInt(-1) * n2 : n2;
      }
      const n = parseInt(str, radix);
      return sign === "-" ? -1 * n : n;
    }
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value)) {
        const str = value.toString(radix);
        return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
      }
      return stringifyNumber.stringifyNumber(node);
    }
    var intBin = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
      stringify: (node) => intStringify(node, 2, "0b")
    };
    var intOct = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
      stringify: (node) => intStringify(node, 8, "0")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9][0-9_]*$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^[-+]?0x[0-9a-fA-F_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intBin = intBin;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/set.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSet = class _YAMLSet extends YAMLMap.YAMLMap {
      constructor(schema) {
        super(schema);
        this.tag = _YAMLSet.tag;
      }
      add(key) {
        let pair;
        if (identity.isPair(key))
          pair = key;
        else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
          pair = new Pair.Pair(key.key, null);
        else
          pair = new Pair.Pair(key, null);
        const prev = YAMLMap.findPair(this.items, pair.key);
        if (!prev)
          this.items.push(pair);
      }
      /**
       * If `keepPair` is `true`, returns the Pair matching `key`.
       * Otherwise, returns the value of that Pair's key.
       */
      get(key, keepPair) {
        const pair = YAMLMap.findPair(this.items, key);
        return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
      }
      set(key, value) {
        if (typeof value !== "boolean")
          throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
        const prev = YAMLMap.findPair(this.items, key);
        if (prev && !value) {
          this.items.splice(this.items.indexOf(prev), 1);
        } else if (!prev && value) {
          this.items.push(new Pair.Pair(key));
        }
      }
      toJSON(_, ctx) {
        return super.toJSON(_, ctx, Set);
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        if (this.hasAllNullValues(true))
          return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
        else
          throw new Error("Set items must all have null values");
      }
      static from(schema, iterable, ctx) {
        const { replacer } = ctx;
        const set2 = new this(schema);
        if (iterable && Symbol.iterator in Object(iterable))
          for (let value of iterable) {
            if (typeof replacer === "function")
              value = replacer.call(iterable, value, value);
            set2.items.push(Pair.createPair(value, null, ctx));
          }
        return set2;
      }
    };
    YAMLSet.tag = "tag:yaml.org,2002:set";
    var set = {
      collection: "map",
      identify: (value) => value instanceof Set,
      nodeClass: YAMLSet,
      default: false,
      tag: "tag:yaml.org,2002:set",
      createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
      resolve(map, onError) {
        if (identity.isMap(map)) {
          if (map.hasAllNullValues(true))
            return Object.assign(new YAMLSet(), map);
          else
            onError("Set items must all have null values");
        } else
          onError("Expected a mapping for this tag");
        return map;
      }
    };
    exports.YAMLSet = YAMLSet;
    exports.set = set;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/timestamp.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    function parseSexagesimal(str, asBigInt) {
      const sign = str[0];
      const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
      const num = (n) => asBigInt ? BigInt(n) : Number(n);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
      return sign === "-" ? num(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num = (n) => n;
      if (typeof value === "bigint")
        num = (n) => BigInt(n);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      if (value < 0) {
        sign = "-";
        value *= num(-1);
      }
      const _60 = num(60);
      const parts = [value % _60];
      if (value < 60) {
        parts.unshift(0);
      } else {
        value = (value - parts[0]) / _60;
        parts.unshift(value % _60);
        if (value >= 60) {
          value = (value - parts[0]) / _60;
          parts.unshift(value);
        }
      }
      return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
    }
    var intTime = {
      identify: (value) => typeof value === "bigint" || Number.isInteger(value),
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
      resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
      stringify: stringifySexagesimal
    };
    var floatTime = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
      resolve: (str) => parseSexagesimal(str, false),
      stringify: stringifySexagesimal
    };
    var timestamp = {
      identify: (value) => value instanceof Date,
      default: true,
      tag: "tag:yaml.org,2002:timestamp",
      // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
      // may be omitted altogether, resulting in a date format. In such a case, the time part is
      // assumed to be 00:00:00Z (start of day, UTC).
      test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
      resolve(str) {
        const match = str.match(timestamp.test);
        if (!match)
          throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
        const [, year, month, day2, hour, minute, second] = match.map(Number);
        const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
        let date = Date.UTC(year, month - 1, day2, hour || 0, minute || 0, second || 0, millisec);
        const tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, false);
          if (Math.abs(d) < 30)
            d *= 60;
          date -= 6e4 * d;
        }
        return new Date(date);
      },
      stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
    };
    exports.floatTime = floatTime;
    exports.intTime = intTime;
    exports.timestamp = timestamp;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var binary = require_binary();
    var bool = require_bool2();
    var float = require_float2();
    var int = require_int2();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var set = require_set();
    var timestamp = require_timestamp();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.trueTag,
      bool.falseTag,
      int.intBin,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float,
      binary.binary,
      merge.merge,
      omap.omap,
      pairs.pairs,
      set.set,
      timestamp.intTime,
      timestamp.floatTime,
      timestamp.timestamp
    ];
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS({
  "node_modules/yaml/dist/schema/tags.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = require_schema();
    var schema$1 = require_schema2();
    var binary = require_binary();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var schema$2 = require_schema3();
    var set = require_set();
    var timestamp = require_timestamp();
    var schemas = /* @__PURE__ */ new Map([
      ["core", schema.schema],
      ["failsafe", [map.map, seq.seq, string.string]],
      ["json", schema$1.schema],
      ["yaml11", schema$2.schema],
      ["yaml-1.1", schema$2.schema]
    ]);
    var tagsByName = {
      binary: binary.binary,
      bool: bool.boolTag,
      float: float.float,
      floatExp: float.floatExp,
      floatNaN: float.floatNaN,
      floatTime: timestamp.floatTime,
      int: int.int,
      intHex: int.intHex,
      intOct: int.intOct,
      intTime: timestamp.intTime,
      map: map.map,
      merge: merge.merge,
      null: _null.nullTag,
      omap: omap.omap,
      pairs: pairs.pairs,
      seq: seq.seq,
      set: set.set,
      timestamp: timestamp.timestamp
    };
    var coreKnownTags = {
      "tag:yaml.org,2002:binary": binary.binary,
      "tag:yaml.org,2002:merge": merge.merge,
      "tag:yaml.org,2002:omap": omap.omap,
      "tag:yaml.org,2002:pairs": pairs.pairs,
      "tag:yaml.org,2002:set": set.set,
      "tag:yaml.org,2002:timestamp": timestamp.timestamp
    };
    function getTags(customTags, schemaName, addMergeTag) {
      const schemaTags = schemas.get(schemaName);
      if (schemaTags && !customTags) {
        return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
      }
      let tags = schemaTags;
      if (!tags) {
        if (Array.isArray(customTags))
          tags = [];
        else {
          const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
        }
      }
      if (Array.isArray(customTags)) {
        for (const tag of customTags)
          tags = tags.concat(tag);
      } else if (typeof customTags === "function") {
        tags = customTags(tags.slice());
      }
      if (addMergeTag)
        tags = tags.concat(merge.merge);
      return tags.reduce((tags2, tag) => {
        const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
        if (!tagObj) {
          const tagName = JSON.stringify(tag);
          const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
        }
        if (!tags2.includes(tagObj))
          tags2.push(tagObj);
        return tags2;
      }, []);
    }
    exports.coreKnownTags = coreKnownTags;
    exports.getTags = getTags;
  }
});

// node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS({
  "node_modules/yaml/dist/schema/Schema.js"(exports) {
    "use strict";
    var identity = require_identity();
    var map = require_map();
    var seq = require_seq();
    var string = require_string();
    var tags = require_tags();
    var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    var Schema = class _Schema {
      constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
        this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
        this.name = typeof schema === "string" && schema || "core";
        this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
        this.tags = tags.getTags(customTags, this.name, merge);
        this.toStringOptions = toStringDefaults ?? null;
        Object.defineProperty(this, identity.MAP, { value: map.map });
        Object.defineProperty(this, identity.SCALAR, { value: string.string });
        Object.defineProperty(this, identity.SEQ, { value: seq.seq });
        this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
      }
      clone() {
        const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
        copy.tags = this.tags.slice();
        return copy;
      }
    };
    exports.Schema = Schema;
  }
});

// node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyDocument.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyDocument(doc, options) {
      const lines = [];
      let hasDirectives = options.directives === true;
      if (options.directives !== false && doc.directives) {
        const dir = doc.directives.toString(doc);
        if (dir) {
          lines.push(dir);
          hasDirectives = true;
        } else if (doc.directives.docStart)
          hasDirectives = true;
      }
      if (hasDirectives)
        lines.push("---");
      const ctx = stringify.createStringifyContext(doc, options);
      const { commentString } = ctx.options;
      if (doc.commentBefore) {
        if (lines.length !== 1)
          lines.unshift("");
        const cs = commentString(doc.commentBefore);
        lines.unshift(stringifyComment.indentComment(cs, ""));
      }
      let chompKeep = false;
      let contentComment = null;
      if (doc.contents) {
        if (identity.isNode(doc.contents)) {
          if (doc.contents.spaceBefore && hasDirectives)
            lines.push("");
          if (doc.contents.commentBefore) {
            const cs = commentString(doc.contents.commentBefore);
            lines.push(stringifyComment.indentComment(cs, ""));
          }
          ctx.forceBlockIndent = !!doc.comment;
          contentComment = doc.contents.comment;
        }
        const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
        let body = stringify.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body += stringifyComment.lineComment(body, "", commentString(contentComment));
        if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
          lines[lines.length - 1] = `--- ${body}`;
        } else
          lines.push(body);
      } else {
        lines.push(stringify.stringify(doc.contents, ctx));
      }
      if (doc.directives?.docEnd) {
        if (doc.comment) {
          const cs = commentString(doc.comment);
          if (cs.includes("\n")) {
            lines.push("...");
            lines.push(stringifyComment.indentComment(cs, ""));
          } else {
            lines.push(`... ${cs}`);
          }
        } else {
          lines.push("...");
        }
      } else {
        let dc = doc.comment;
        if (dc && chompKeep)
          dc = dc.replace(/^\n+/, "");
        if (dc) {
          if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
            lines.push("");
          lines.push(stringifyComment.indentComment(commentString(dc), ""));
        }
      }
      return lines.join("\n") + "\n";
    }
    exports.stringifyDocument = stringifyDocument;
  }
});

// node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS({
  "node_modules/yaml/dist/doc/Document.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var toJS = require_toJS();
    var Schema = require_Schema();
    var stringifyDocument = require_stringifyDocument();
    var anchors = require_anchors();
    var applyReviver = require_applyReviver();
    var createNode = require_createNode();
    var directives = require_directives();
    var Document = class _Document {
      constructor(value, replacer, options) {
        this.commentBefore = null;
        this.comment = null;
        this.errors = [];
        this.warnings = [];
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
        let _replacer = null;
        if (typeof replacer === "function" || Array.isArray(replacer)) {
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const opt = Object.assign({
          intAsBigInt: false,
          keepSourceTokens: false,
          logLevel: "warn",
          prettyErrors: true,
          strict: true,
          stringKeys: false,
          uniqueKeys: true,
          version: "1.2"
        }, options);
        this.options = opt;
        let { version } = opt;
        if (options?._directives) {
          this.directives = options._directives.atDocument();
          if (this.directives.yaml.explicit)
            version = this.directives.yaml.version;
        } else
          this.directives = new directives.Directives({ version });
        this.setSchema(version, options);
        this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
      }
      /**
       * Create a deep copy of this Document and its contents.
       *
       * Custom Node values that inherit from `Object` still refer to their original instances.
       */
      clone() {
        const copy = Object.create(_Document.prototype, {
          [identity.NODE_TYPE]: { value: identity.DOC }
        });
        copy.commentBefore = this.commentBefore;
        copy.comment = this.comment;
        copy.errors = this.errors.slice();
        copy.warnings = this.warnings.slice();
        copy.options = Object.assign({}, this.options);
        if (this.directives)
          copy.directives = this.directives.clone();
        copy.schema = this.schema.clone();
        copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** Adds a value to the document. */
      add(value) {
        if (assertCollection(this.contents))
          this.contents.add(value);
      }
      /** Adds a value to the document. */
      addIn(path, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path, value);
      }
      /**
       * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
       *
       * If `node` already has an anchor, `name` is ignored.
       * Otherwise, the `node.anchor` value will be set to `name`,
       * or if an anchor with that name is already present in the document,
       * `name` will be used as a prefix for a new unique anchor.
       * If `name` is undefined, the generated anchor will use 'a' as a prefix.
       */
      createAlias(node, name) {
        if (!node.anchor) {
          const prev = anchors.anchorNames(this);
          node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
        }
        return new Alias.Alias(node.anchor);
      }
      createNode(value, replacer, options) {
        let _replacer = void 0;
        if (typeof replacer === "function") {
          value = replacer.call({ "": value }, "", value);
          _replacer = replacer;
        } else if (Array.isArray(replacer)) {
          const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
          const asStr = replacer.filter(keyToStr).map(String);
          if (asStr.length > 0)
            replacer = replacer.concat(asStr);
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
        const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(
          this,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          anchorPrefix || "a"
        );
        const ctx = {
          aliasDuplicateObjects: aliasDuplicateObjects ?? true,
          keepUndefined: keepUndefined ?? false,
          onAnchor,
          onTagObj,
          replacer: _replacer,
          schema: this.schema,
          sourceObjects
        };
        const node = createNode.createNode(value, tag, ctx);
        if (flow && identity.isCollection(node))
          node.flow = true;
        setAnchors();
        return node;
      }
      /**
       * Convert a key and a value into a `Pair` using the current schema,
       * recursively wrapping all values as `Scalar` or `Collection` nodes.
       */
      createPair(key, value, options = {}) {
        const k = this.createNode(key, null, options);
        const v = this.createNode(value, null, options);
        return new Pair.Pair(k, v);
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        return assertCollection(this.contents) ? this.contents.delete(key) : false;
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path) {
        if (Collection.isEmptyPath(path)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path) : false;
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      get(key, keepScalar) {
        return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
      }
      /**
       * Returns item at `path`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path, keepScalar) {
        if (Collection.isEmptyPath(path))
          return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity.isCollection(this.contents) ? this.contents.getIn(path, keepScalar) : void 0;
      }
      /**
       * Checks if the document includes a value with the key `key`.
       */
      has(key) {
        return identity.isCollection(this.contents) ? this.contents.has(key) : false;
      }
      /**
       * Checks if the document includes a value at `path`.
       */
      hasIn(path) {
        if (Collection.isEmptyPath(path))
          return this.contents !== void 0;
        return identity.isCollection(this.contents) ? this.contents.hasIn(path) : false;
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      set(key, value) {
        if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, [key], value);
        } else if (assertCollection(this.contents)) {
          this.contents.set(key, value);
        }
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path, value) {
        if (Collection.isEmptyPath(path)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path, value);
        }
      }
      /**
       * Change the YAML version and schema used by the document.
       * A `null` version disables support for directives, explicit tags, anchors, and aliases.
       * It also requires the `schema` option to be given as a `Schema` instance value.
       *
       * Overrides all previously set schema options.
       */
      setSchema(version, options = {}) {
        if (typeof version === "number")
          version = String(version);
        let opt;
        switch (version) {
          case "1.1":
            if (this.directives)
              this.directives.yaml.version = "1.1";
            else
              this.directives = new directives.Directives({ version: "1.1" });
            opt = { resolveKnownTags: false, schema: "yaml-1.1" };
            break;
          case "1.2":
          case "next":
            if (this.directives)
              this.directives.yaml.version = version;
            else
              this.directives = new directives.Directives({ version });
            opt = { resolveKnownTags: true, schema: "core" };
            break;
          case null:
            if (this.directives)
              delete this.directives;
            opt = null;
            break;
          default: {
            const sv = JSON.stringify(version);
            throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
          }
        }
        if (options.schema instanceof Object)
          this.schema = options.schema;
        else if (opt)
          this.schema = new Schema.Schema(Object.assign(opt, options));
        else
          throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
      }
      // json & jsonArg are only used from toJSON()
      toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc: this,
          keep: !json,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
      /**
       * A JSON representation of the document `contents`.
       *
       * @param jsonArg Used by `JSON.stringify` to indicate the array index or
       *   property name.
       */
      toJSON(jsonArg, onAnchor) {
        return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
      }
      /** A YAML representation of the document. */
      toString(options = {}) {
        if (this.errors.length > 0)
          throw new Error("Document with errors cannot be stringified");
        if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
          const s = JSON.stringify(options.indent);
          throw new Error(`"indent" option must be a positive integer, not ${s}`);
        }
        return stringifyDocument.stringifyDocument(this, options);
      }
    };
    function assertCollection(contents) {
      if (identity.isCollection(contents))
        return true;
      throw new Error("Expected a YAML collection as document contents");
    }
    exports.Document = Document;
  }
});

// node_modules/yaml/dist/errors.js
var require_errors = __commonJS({
  "node_modules/yaml/dist/errors.js"(exports) {
    "use strict";
    var YAMLError = class extends Error {
      constructor(name, pos, code, message) {
        super();
        this.name = name;
        this.code = code;
        this.message = message;
        this.pos = pos;
      }
    };
    var YAMLParseError = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLParseError", pos, code, message);
      }
    };
    var YAMLWarning = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLWarning", pos, code, message);
      }
    };
    var prettifyError = (src, lc) => (error) => {
      if (error.pos[0] === -1)
        return;
      error.linePos = error.pos.map((pos) => lc.linePos(pos));
      const { line, col } = error.linePos[0];
      error.message += ` at line ${line}, column ${col}`;
      let ci = col - 1;
      let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
      if (ci >= 60 && lineStr.length > 80) {
        const trimStart = Math.min(ci - 39, lineStr.length - 79);
        lineStr = "\u2026" + lineStr.substring(trimStart);
        ci -= trimStart - 1;
      }
      if (lineStr.length > 80)
        lineStr = lineStr.substring(0, 79) + "\u2026";
      if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
        if (prev.length > 80)
          prev = prev.substring(0, 79) + "\u2026\n";
        lineStr = prev + lineStr;
      }
      if (/[^ ]/.test(lineStr)) {
        let count = 1;
        const end = error.linePos[1];
        if (end?.line === line && end.col > col) {
          count = Math.max(1, Math.min(end.col - col, 80 - ci));
        }
        const pointer = " ".repeat(ci) + "^".repeat(count);
        error.message += `:

${lineStr}
${pointer}
`;
      }
    };
    exports.YAMLError = YAMLError;
    exports.YAMLParseError = YAMLParseError;
    exports.YAMLWarning = YAMLWarning;
    exports.prettifyError = prettifyError;
  }
});

// node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS({
  "node_modules/yaml/dist/compose/resolve-props.js"(exports) {
    "use strict";
    function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
      let spaceBefore = false;
      let atNewline = startOnNewline;
      let hasSpace = startOnNewline;
      let comment = "";
      let commentSep = "";
      let hasNewline = false;
      let reqSpace = false;
      let tab = null;
      let anchor = null;
      let tag = null;
      let newlineAfterProp = null;
      let comma = null;
      let found = null;
      let start = null;
      for (const token of tokens) {
        if (reqSpace) {
          if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
            onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
          reqSpace = false;
        }
        if (tab) {
          if (atNewline && token.type !== "comment" && token.type !== "newline") {
            onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
          }
          tab = null;
        }
        switch (token.type) {
          case "space":
            if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) {
              tab = token;
            }
            hasSpace = true;
            break;
          case "comment": {
            if (!hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = token.source.substring(1) || " ";
            if (!comment)
              comment = cb;
            else
              comment += commentSep + cb;
            commentSep = "";
            atNewline = false;
            break;
          }
          case "newline":
            if (atNewline) {
              if (comment)
                comment += token.source;
              else if (!found || indicator !== "seq-item-ind")
                spaceBefore = true;
            } else
              commentSep += token.source;
            atNewline = true;
            hasNewline = true;
            if (anchor || tag)
              newlineAfterProp = token;
            hasSpace = true;
            break;
          case "anchor":
            if (anchor)
              onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
            if (token.source.endsWith(":"))
              onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
            anchor = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          case "tag": {
            if (tag)
              onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
            tag = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          }
          case indicator:
            if (anchor || tag)
              onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
            if (found)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
            found = token;
            atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
            hasSpace = false;
            break;
          case "comma":
            if (flow) {
              if (comma)
                onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
              comma = token;
              atNewline = false;
              hasSpace = false;
              break;
            }
          // else fallthrough
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
            atNewline = false;
            hasSpace = false;
        }
      }
      const last = tokens[tokens.length - 1];
      const end = last ? last.offset + last.source.length : offset;
      if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
        onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      }
      if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
        onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
      return {
        comma,
        found,
        spaceBefore,
        comment,
        hasNewline,
        anchor,
        tag,
        newlineAfterProp,
        end,
        start: start ?? end
      };
    }
    exports.resolveProps = resolveProps;
  }
});

// node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS({
  "node_modules/yaml/dist/compose/util-contains-newline.js"(exports) {
    "use strict";
    function containsNewline(key) {
      if (!key)
        return null;
      switch (key.type) {
        case "alias":
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          if (key.source.includes("\n"))
            return true;
          if (key.end) {
            for (const st of key.end)
              if (st.type === "newline")
                return true;
          }
          return false;
        case "flow-collection":
          for (const it of key.items) {
            for (const st of it.start)
              if (st.type === "newline")
                return true;
            if (it.sep) {
              for (const st of it.sep)
                if (st.type === "newline")
                  return true;
            }
            if (containsNewline(it.key) || containsNewline(it.value))
              return true;
          }
          return false;
        default:
          return true;
      }
    }
    exports.containsNewline = containsNewline;
  }
});

// node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS({
  "node_modules/yaml/dist/compose/util-flow-indent-check.js"(exports) {
    "use strict";
    var utilContainsNewline = require_util_contains_newline();
    function flowIndentCheck(indent, fc, onError) {
      if (fc?.type === "flow-collection") {
        const end = fc.end[0];
        if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) {
          const msg = "Flow end indicator should be more indented than parent";
          onError(end, "BAD_INDENT", msg, true);
        }
      }
    }
    exports.flowIndentCheck = flowIndentCheck;
  }
});

// node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS({
  "node_modules/yaml/dist/compose/util-map-includes.js"(exports) {
    "use strict";
    var identity = require_identity();
    function mapIncludes(ctx, items, search) {
      const { uniqueKeys } = ctx.options;
      if (uniqueKeys === false)
        return false;
      const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
      return items.some((pair) => isEqual(pair.key, search));
    }
    exports.mapIncludes = mapIncludes;
  }
});

// node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-map.js"(exports) {
    "use strict";
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    var utilMapIncludes = require_util_map_includes();
    var startColMsg = "All mapping items must start at the same column";
    function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLMap.YAMLMap;
      const map = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      let offset = bm.offset;
      let commentEnd = null;
      for (const collItem of bm.items) {
        const { start, key, sep, value } = collItem;
        const keyProps = resolveProps.resolveProps(start, {
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: bm.indent,
          startOnNewline: true
        });
        const implicitKey = !keyProps.found;
        if (implicitKey) {
          if (key) {
            if (key.type === "block-seq")
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
            else if ("indent" in key && key.indent !== bm.indent)
              onError(offset, "BAD_INDENT", startColMsg);
          }
          if (!keyProps.anchor && !keyProps.tag && !sep) {
            commentEnd = keyProps.end;
            if (keyProps.comment) {
              if (map.comment)
                map.comment += "\n" + keyProps.comment;
              else
                map.comment = keyProps.comment;
            }
            continue;
          }
          if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) {
            onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
          }
        } else if (keyProps.found?.indent !== bm.indent) {
          onError(offset, "BAD_INDENT", startColMsg);
        }
        ctx.atKey = true;
        const keyStart = keyProps.end;
        const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
        ctx.atKey = false;
        if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        const valueProps = resolveProps.resolveProps(sep ?? [], {
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: bm.indent,
          startOnNewline: !key || key.type === "block-scalar"
        });
        offset = valueProps.end;
        if (valueProps.found) {
          if (implicitKey) {
            if (value?.type === "block-map" && !valueProps.hasNewline)
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
            if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
              onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep, null, valueProps, onError);
          if (ctx.schema.compat)
            utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
          offset = valueNode.range[2];
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        } else {
          if (implicitKey)
            onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
          if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        }
      }
      if (commentEnd && commentEnd < offset)
        onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
      map.range = [bm.offset, offset, commentEnd ?? offset];
      return map;
    }
    exports.resolveBlockMap = resolveBlockMap;
  }
});

// node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-seq.js"(exports) {
    "use strict";
    var YAMLSeq = require_YAMLSeq();
    var resolveProps = require_resolve_props();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLSeq.YAMLSeq;
      const seq = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = bs.offset;
      let commentEnd = null;
      for (const { start, value } of bs.items) {
        const props = resolveProps.resolveProps(start, {
          indicator: "seq-item-ind",
          next: value,
          offset,
          onError,
          parentIndent: bs.indent,
          startOnNewline: true
        });
        if (!props.found) {
          if (props.anchor || props.tag || value) {
            if (value?.type === "block-seq")
              onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
            else
              onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
          } else {
            commentEnd = props.end;
            if (props.comment)
              seq.comment = props.comment;
            continue;
          }
        }
        const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
        offset = node.range[2];
        seq.items.push(node);
      }
      seq.range = [bs.offset, offset, commentEnd ?? offset];
      return seq;
    }
    exports.resolveBlockSeq = resolveBlockSeq;
  }
});

// node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS({
  "node_modules/yaml/dist/compose/resolve-end.js"(exports) {
    "use strict";
    function resolveEnd(end, offset, reqSpace, onError) {
      let comment = "";
      if (end) {
        let hasSpace = false;
        let sep = "";
        for (const token of end) {
          const { source, type } = token;
          switch (type) {
            case "space":
              hasSpace = true;
              break;
            case "comment": {
              if (reqSpace && !hasSpace)
                onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
              const cb = source.substring(1) || " ";
              if (!comment)
                comment = cb;
              else
                comment += sep + cb;
              sep = "";
              break;
            }
            case "newline":
              if (comment)
                sep += source;
              hasSpace = true;
              break;
            default:
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
          }
          offset += source.length;
        }
      }
      return { comment, offset };
    }
    exports.resolveEnd = resolveEnd;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilMapIncludes = require_util_map_includes();
    var blockMsg = "Block collections are not allowed within flow collections";
    var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
    function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
      const isMap = fc.start.source === "{";
      const fcName = isMap ? "flow map" : "flow sequence";
      const NodeClass = tag?.nodeClass ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
      const coll = new NodeClass(ctx.schema);
      coll.flow = true;
      const atRoot = ctx.atRoot;
      if (atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = fc.offset + fc.start.source.length;
      for (let i = 0; i < fc.items.length; ++i) {
        const collItem = fc.items[i];
        const { start, key, sep, value } = collItem;
        const props = resolveProps.resolveProps(start, {
          flow: fcName,
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (!props.found) {
          if (!props.anchor && !props.tag && !sep && !value) {
            if (i === 0 && props.comma)
              onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
            else if (i < fc.items.length - 1)
              onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
            if (props.comment) {
              if (coll.comment)
                coll.comment += "\n" + props.comment;
              else
                coll.comment = props.comment;
            }
            offset = props.end;
            continue;
          }
          if (!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key))
            onError(
              key,
              // checked by containsNewline()
              "MULTILINE_IMPLICIT_KEY",
              "Implicit keys of flow sequence pairs need to be on a single line"
            );
        }
        if (i === 0) {
          if (props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        } else {
          if (!props.comma)
            onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
          if (props.comment) {
            let prevItemComment = "";
            loop: for (const st of start) {
              switch (st.type) {
                case "comma":
                case "space":
                  break;
                case "comment":
                  prevItemComment = st.source.substring(1);
                  break loop;
                default:
                  break loop;
              }
            }
            if (prevItemComment) {
              let prev = coll.items[coll.items.length - 1];
              if (identity.isPair(prev))
                prev = prev.value ?? prev.key;
              if (prev.comment)
                prev.comment += "\n" + prevItemComment;
              else
                prev.comment = prevItemComment;
              props.comment = props.comment.substring(prevItemComment.length + 1);
            }
          }
        }
        if (!isMap && !sep && !props.found) {
          const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep, null, props, onError);
          coll.items.push(valueNode);
          offset = valueNode.range[2];
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else {
          ctx.atKey = true;
          const keyStart = props.end;
          const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
          if (isBlock(key))
            onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
          ctx.atKey = false;
          const valueProps = resolveProps.resolveProps(sep ?? [], {
            flow: fcName,
            indicator: "map-value-ind",
            next: value,
            offset: keyNode.range[2],
            onError,
            parentIndent: fc.indent,
            startOnNewline: false
          });
          if (valueProps.found) {
            if (!isMap && !props.found && ctx.options.strict) {
              if (sep)
                for (const st of sep) {
                  if (st === valueProps.found)
                    break;
                  if (st.type === "newline") {
                    onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                    break;
                  }
                }
              if (props.start < valueProps.found.offset - 1024)
                onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
            }
          } else if (value) {
            if ("source" in value && value.source?.[0] === ":")
              onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
            else
              onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep, null, valueProps, onError) : null;
          if (valueNode) {
            if (isBlock(value))
              onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
          } else if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          if (isMap) {
            const map = coll;
            if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
              onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
            map.items.push(pair);
          } else {
            const map = new YAMLMap.YAMLMap(ctx.schema);
            map.flow = true;
            map.items.push(pair);
            const endRange = (valueNode ?? keyNode).range;
            map.range = [keyNode.range[0], endRange[1], endRange[2]];
            coll.items.push(map);
          }
          offset = valueNode ? valueNode.range[2] : valueProps.end;
        }
      }
      const expectedEnd = isMap ? "}" : "]";
      const [ce, ...ee] = fc.end;
      let cePos = offset;
      if (ce?.source === expectedEnd)
        cePos = ce.offset + ce.source.length;
      else {
        const name = fcName[0].toUpperCase() + fcName.substring(1);
        const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
        onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
        if (ce && ce.source.length !== 1)
          ee.unshift(ce);
      }
      if (ee.length > 0) {
        const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
        if (end.comment) {
          if (coll.comment)
            coll.comment += "\n" + end.comment;
          else
            coll.comment = end.comment;
        }
        coll.range = [fc.offset, cePos, end.offset];
      } else {
        coll.range = [fc.offset, cePos, cePos];
      }
      return coll;
    }
    exports.resolveFlowCollection = resolveFlowCollection;
  }
});

// node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS({
  "node_modules/yaml/dist/compose/compose-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveBlockMap = require_resolve_block_map();
    var resolveBlockSeq = require_resolve_block_seq();
    var resolveFlowCollection = require_resolve_flow_collection();
    function resolveCollection(CN, ctx, token, onError, tagName, tag) {
      const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
      const Coll = coll.constructor;
      if (tagName === "!" || tagName === Coll.tagName) {
        coll.tag = Coll.tagName;
        return coll;
      }
      if (tagName)
        coll.tag = tagName;
      return coll;
    }
    function composeCollection(CN, ctx, token, props, onError) {
      const tagToken = props.tag;
      const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
      if (token.type === "block-seq") {
        const { anchor, newlineAfterProp: nl } = props;
        const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
        if (lastProp && (!nl || nl.offset < lastProp.offset)) {
          const message = "Missing newline after block sequence props";
          onError(lastProp, "MISSING_CHAR", message);
        }
      }
      const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
      if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") {
        return resolveCollection(CN, ctx, token, onError, tagName);
      }
      let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
      if (!tag) {
        const kt = ctx.schema.knownTags[tagName];
        if (kt?.collection === expType) {
          ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
          tag = kt;
        } else {
          if (kt) {
            onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
          } else {
            onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
          }
          return resolveCollection(CN, ctx, token, onError, tagName);
        }
      }
      const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
      const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
      const node = identity.isNode(res) ? res : new Scalar.Scalar(res);
      node.range = coll.range;
      node.tag = tagName;
      if (tag?.format)
        node.format = tag.format;
      return node;
    }
    exports.composeCollection = composeCollection;
  }
});

// node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function resolveBlockScalar(ctx, scalar, onError) {
      const start = scalar.offset;
      const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
      if (!header)
        return { value: "", type: null, comment: "", range: [start, start, start] };
      const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
      const lines = scalar.source ? splitLines(scalar.source) : [];
      let chompStart = lines.length;
      for (let i = lines.length - 1; i >= 0; --i) {
        const content = lines[i][1];
        if (content === "" || content === "\r")
          chompStart = i;
        else
          break;
      }
      if (chompStart === 0) {
        const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
        let end2 = start + header.length;
        if (scalar.source)
          end2 += scalar.source.length;
        return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
      }
      let trimIndent = scalar.indent + header.indent;
      let offset = scalar.offset + header.length;
      let contentStart = 0;
      for (let i = 0; i < chompStart; ++i) {
        const [indent, content] = lines[i];
        if (content === "" || content === "\r") {
          if (header.indent === 0 && indent.length > trimIndent)
            trimIndent = indent.length;
        } else {
          if (indent.length < trimIndent) {
            const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
            onError(offset + indent.length, "MISSING_CHAR", message);
          }
          if (header.indent === 0)
            trimIndent = indent.length;
          contentStart = i;
          if (trimIndent === 0 && !ctx.atRoot) {
            const message = "Block scalar values in collections must be indented";
            onError(offset, "BAD_INDENT", message);
          }
          break;
        }
        offset += indent.length + content.length + 1;
      }
      for (let i = lines.length - 1; i >= chompStart; --i) {
        if (lines[i][0].length > trimIndent)
          chompStart = i + 1;
      }
      let value = "";
      let sep = "";
      let prevMoreIndented = false;
      for (let i = 0; i < contentStart; ++i)
        value += lines[i][0].slice(trimIndent) + "\n";
      for (let i = contentStart; i < chompStart; ++i) {
        let [indent, content] = lines[i];
        offset += indent.length + content.length + 1;
        const crlf = content[content.length - 1] === "\r";
        if (crlf)
          content = content.slice(0, -1);
        if (content && indent.length < trimIndent) {
          const src = header.indent ? "explicit indentation indicator" : "first line";
          const message = `Block scalar lines must not be less indented than their ${src}`;
          onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
          indent = "";
        }
        if (type === Scalar.Scalar.BLOCK_LITERAL) {
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
        } else if (indent.length > trimIndent || content[0] === "	") {
          if (sep === " ")
            sep = "\n";
          else if (!prevMoreIndented && sep === "\n")
            sep = "\n\n";
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
          prevMoreIndented = true;
        } else if (content === "") {
          if (sep === "\n")
            value += "\n";
          else
            sep = "\n";
        } else {
          value += sep + content;
          sep = " ";
          prevMoreIndented = false;
        }
      }
      switch (header.chomp) {
        case "-":
          break;
        case "+":
          for (let i = chompStart; i < lines.length; ++i)
            value += "\n" + lines[i][0].slice(trimIndent);
          if (value[value.length - 1] !== "\n")
            value += "\n";
          break;
        default:
          value += "\n";
      }
      const end = start + header.length + scalar.source.length;
      return { value, type, comment: header.comment, range: [start, end, end] };
    }
    function parseBlockScalarHeader({ offset, props }, strict, onError) {
      if (props[0].type !== "block-scalar-header") {
        onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
        return null;
      }
      const { source } = props[0];
      const mode = source[0];
      let indent = 0;
      let chomp = "";
      let error = -1;
      for (let i = 1; i < source.length; ++i) {
        const ch = source[i];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n = Number(ch);
          if (!indent && n)
            indent = n;
          else if (error === -1)
            error = offset + i;
        }
      }
      if (error !== -1)
        onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = false;
      let comment = "";
      let length = source.length;
      for (let i = 1; i < props.length; ++i) {
        const token = props[i];
        switch (token.type) {
          case "space":
            hasSpace = true;
          // fallthrough
          case "newline":
            length += token.source.length;
            break;
          case "comment":
            if (strict && !hasSpace) {
              const message = "Comments must be separated from other tokens by white space characters";
              onError(token, "MISSING_CHAR", message);
            }
            length += token.source.length;
            comment = token.source.substring(1);
            break;
          case "error":
            onError(token, "UNEXPECTED_TOKEN", token.message);
            length += token.source.length;
            break;
          /* istanbul ignore next should not happen */
          default: {
            const message = `Unexpected token in block scalar header: ${token.type}`;
            onError(token, "UNEXPECTED_TOKEN", message);
            const ts = token.source;
            if (ts && typeof ts === "string")
              length += ts.length;
          }
        }
      }
      return { mode, indent, chomp, comment, length };
    }
    function splitLines(source) {
      const split = source.split(/\n( *)/);
      const first = split[0];
      const m = first.match(/^( *)/);
      const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
      const lines = [line0];
      for (let i = 1; i < split.length; i += 2)
        lines.push([split[i], split[i + 1]]);
      return lines;
    }
    exports.resolveBlockScalar = resolveBlockScalar;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var resolveEnd = require_resolve_end();
    function resolveFlowScalar(scalar, strict, onError) {
      const { offset, type, source, end } = scalar;
      let _type;
      let value;
      const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
      switch (type) {
        case "scalar":
          _type = Scalar.Scalar.PLAIN;
          value = plainValue(source, _onError);
          break;
        case "single-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_SINGLE;
          value = singleQuotedValue(source, _onError);
          break;
        case "double-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_DOUBLE;
          value = doubleQuotedValue(source, _onError);
          break;
        /* istanbul ignore next should not happen */
        default:
          onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
          return {
            value: "",
            type: null,
            comment: "",
            range: [offset, offset + source.length, offset + source.length]
          };
      }
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
      return {
        value,
        type: _type,
        comment: re.comment,
        range: [offset, valueEnd, re.offset]
      };
    }
    function plainValue(source, onError) {
      let badChar = "";
      switch (source[0]) {
        /* istanbul ignore next should not happen */
        case "	":
          badChar = "a tab character";
          break;
        case ",":
          badChar = "flow indicator character ,";
          break;
        case "%":
          badChar = "directive indicator character %";
          break;
        case "|":
        case ">": {
          badChar = `block scalar indicator ${source[0]}`;
          break;
        }
        case "@":
        case "`": {
          badChar = `reserved character ${source[0]}`;
          break;
        }
      }
      if (badChar)
        onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
      return unfoldLines(source);
    }
    function singleQuotedValue(source, onError) {
      if (source[source.length - 1] !== "'" || source.length === 1)
        onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
      return unfoldLines(source.slice(1, -1)).replace(/''/g, "'");
    }
    function unfoldLines(source) {
      const line = /(.*?)\r?\n/sy;
      let match = line.exec(source);
      if (!match)
        return source;
      let trimEnd, trimBoth;
      try {
        trimEnd = new RegExp("(?<![ 	])[ 	]+$");
        trimBoth = new RegExp("^[ 	]+|(?<![ 	])[ 	]+$", "g");
      } catch {
        trimEnd = /[ \t]+$/;
        trimBoth = /^[ \t]+|[ \t]+$/g;
      }
      let res = match[1].replace(trimEnd, "");
      let sep = " ";
      let pos = line.lastIndex;
      while (match = line.exec(source)) {
        const lm = match[1].replace(trimBoth, "");
        if (lm === "") {
          if (sep === "\n")
            res += sep;
          else
            sep = "\n";
        } else {
          res += sep + lm;
          sep = " ";
        }
        pos = line.lastIndex;
      }
      const last = /[ \t]*(.*)/sy;
      last.lastIndex = pos;
      match = last.exec(source);
      return res + sep + (match?.[1] ?? "");
    }
    function doubleQuotedValue(source, onError) {
      let res = "";
      for (let i = 1; i < source.length - 1; ++i) {
        const ch = source[i];
        if (ch === "\r" && source[i + 1] === "\n")
          continue;
        if (ch === "\n") {
          const { fold, offset } = foldNewline(source, i);
          res += fold;
          i = offset;
        } else if (ch === "\\") {
          let next = source[++i];
          const cc = escapeCodes[next];
          if (cc)
            res += cc;
          else if (next === "\n") {
            next = source[i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "\r" && source[i + 1] === "\n") {
            next = source[++i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "x" || next === "u" || next === "U") {
            const length = next === "x" ? 2 : next === "u" ? 4 : 8;
            res += parseCharCode(source, i + 1, length, onError);
            i += length;
          } else {
            const raw = source.substr(i - 1, 2);
            onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
            res += raw;
          }
        } else if (ch === " " || ch === "	") {
          const wsStart = i;
          let next = source[i + 1];
          while (next === " " || next === "	")
            next = source[++i + 1];
          if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n"))
            res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
        } else {
          res += ch;
        }
      }
      if (source[source.length - 1] !== '"' || source.length === 1)
        onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
      return res;
    }
    function foldNewline(source, offset) {
      let fold = "";
      let ch = source[offset + 1];
      while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        if (ch === "\r" && source[offset + 2] !== "\n")
          break;
        if (ch === "\n")
          fold += "\n";
        offset += 1;
        ch = source[offset + 1];
      }
      if (!fold)
        fold = " ";
      return { fold, offset };
    }
    var escapeCodes = {
      "0": "\0",
      // null character
      a: "\x07",
      // bell character
      b: "\b",
      // backspace
      e: "\x1B",
      // escape character
      f: "\f",
      // form feed
      n: "\n",
      // line feed
      r: "\r",
      // carriage return
      t: "	",
      // horizontal tab
      v: "\v",
      // vertical tab
      N: "\x85",
      // Unicode next line
      _: "\xA0",
      // Unicode non-breaking space
      L: "\u2028",
      // Unicode line separator
      P: "\u2029",
      // Unicode paragraph separator
      " ": " ",
      '"': '"',
      "/": "/",
      "\\": "\\",
      "	": "	"
    };
    function parseCharCode(source, offset, length, onError) {
      const cc = source.substr(offset, length);
      const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
      const code = ok ? parseInt(cc, 16) : NaN;
      try {
        return String.fromCodePoint(code);
      } catch {
        const raw = source.substr(offset - 2, length + 2);
        onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
        return raw;
      }
    }
    exports.resolveFlowScalar = resolveFlowScalar;
  }
});

// node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS({
  "node_modules/yaml/dist/compose/compose-scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    function composeScalar(ctx, token, tagToken, onError) {
      const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
      const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
      let tag;
      if (ctx.options.stringKeys && ctx.atKey) {
        tag = ctx.schema[identity.SCALAR];
      } else if (tagName)
        tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
      else if (token.type === "scalar")
        tag = findScalarTagByTest(ctx, value, token, onError);
      else
        tag = ctx.schema[identity.SCALAR];
      let scalar;
      try {
        const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
        scalar = identity.isScalar(res) ? res : new Scalar.Scalar(res);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
        scalar = new Scalar.Scalar(value);
      }
      scalar.range = range;
      scalar.source = value;
      if (type)
        scalar.type = type;
      if (tagName)
        scalar.tag = tagName;
      if (tag.format)
        scalar.format = tag.format;
      if (comment)
        scalar.comment = comment;
      return scalar;
    }
    function findScalarTagByName(schema, value, tagName, tagToken, onError) {
      if (tagName === "!")
        return schema[identity.SCALAR];
      const matchWithTest = [];
      for (const tag of schema.tags) {
        if (!tag.collection && tag.tag === tagName) {
          if (tag.default && tag.test)
            matchWithTest.push(tag);
          else
            return tag;
        }
      }
      for (const tag of matchWithTest)
        if (tag.test?.test(value))
          return tag;
      const kt = schema.knownTags[tagName];
      if (kt && !kt.collection) {
        schema.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
        return kt;
      }
      onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
      return schema[identity.SCALAR];
    }
    function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
      const tag = schema.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema[identity.SCALAR];
      if (schema.compat) {
        const compat = schema.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema[identity.SCALAR];
        if (tag.tag !== compat.tag) {
          const ts = directives.tagString(tag.tag);
          const cs = directives.tagString(compat.tag);
          const msg = `Value may be parsed as either ${ts} or ${cs}`;
          onError(token, "TAG_RESOLVE_FAILED", msg, true);
        }
      }
      return tag;
    }
    exports.composeScalar = composeScalar;
  }
});

// node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS({
  "node_modules/yaml/dist/compose/util-empty-scalar-position.js"(exports) {
    "use strict";
    function emptyScalarPosition(offset, before, pos) {
      if (before) {
        pos ?? (pos = before.length);
        for (let i = pos - 1; i >= 0; --i) {
          let st = before[i];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          st = before[++i];
          while (st?.type === "space") {
            offset += st.source.length;
            st = before[++i];
          }
          break;
        }
      }
      return offset;
    }
    exports.emptyScalarPosition = emptyScalarPosition;
  }
});

// node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS({
  "node_modules/yaml/dist/compose/compose-node.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var composeCollection = require_compose_collection();
    var composeScalar = require_compose_scalar();
    var resolveEnd = require_resolve_end();
    var utilEmptyScalarPosition = require_util_empty_scalar_position();
    var CN = { composeNode, composeEmptyNode };
    function composeNode(ctx, token, props, onError) {
      const atKey = ctx.atKey;
      const { spaceBefore, comment, anchor, tag } = props;
      let node;
      let isSrcToken = true;
      switch (token.type) {
        case "alias":
          node = composeAlias(ctx, token, onError);
          if (anchor || tag)
            onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
          break;
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "block-scalar":
          node = composeScalar.composeScalar(ctx, token, tag, onError);
          if (anchor)
            node.anchor = anchor.source.substring(1);
          break;
        case "block-map":
        case "block-seq":
        case "flow-collection":
          try {
            node = composeCollection.composeCollection(CN, ctx, token, props, onError);
            if (anchor)
              node.anchor = anchor.source.substring(1);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            onError(token, "RESOURCE_EXHAUSTION", message);
          }
          break;
        default: {
          const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
          onError(token, "UNEXPECTED_TOKEN", message);
          isSrcToken = false;
        }
      }
      node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
      if (anchor && node.anchor === "")
        onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      if (atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
        const msg = "With stringKeys, all keys must be strings";
        onError(tag ?? token, "NON_STRING_KEY", msg);
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        if (token.type === "scalar" && token.source === "")
          node.comment = comment;
        else
          node.commentBefore = comment;
      }
      if (ctx.options.keepSourceTokens && isSrcToken)
        node.srcToken = token;
      return node;
    }
    function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
      const token = {
        type: "scalar",
        offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
        indent: -1,
        source: ""
      };
      const node = composeScalar.composeScalar(ctx, token, tag, onError);
      if (anchor) {
        node.anchor = anchor.source.substring(1);
        if (node.anchor === "")
          onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        node.comment = comment;
        node.range[2] = end;
      }
      return node;
    }
    function composeAlias({ options }, { offset, source, end }, onError) {
      const alias = new Alias.Alias(source.substring(1));
      if (alias.source === "")
        onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
      if (alias.source.endsWith(":"))
        onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
      alias.range = [offset, valueEnd, re.offset];
      if (re.comment)
        alias.comment = re.comment;
      return alias;
    }
    exports.composeEmptyNode = composeEmptyNode;
    exports.composeNode = composeNode;
  }
});

// node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS({
  "node_modules/yaml/dist/compose/compose-doc.js"(exports) {
    "use strict";
    var Document = require_Document();
    var composeNode = require_compose_node();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    function composeDoc(options, directives, { offset, start, value, end }, onError) {
      const opts = Object.assign({ _directives: directives }, options);
      const doc = new Document.Document(void 0, opts);
      const ctx = {
        atKey: false,
        atRoot: true,
        directives: doc.directives,
        options: doc.options,
        schema: doc.schema
      };
      const props = resolveProps.resolveProps(start, {
        indicator: "doc-start",
        next: value ?? end?.[0],
        offset,
        onError,
        parentIndent: 0,
        startOnNewline: true
      });
      if (props.found) {
        doc.directives.docStart = true;
        if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
          onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
      }
      doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
      const contentEnd = doc.contents.range[2];
      const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
      if (re.comment)
        doc.comment = re.comment;
      doc.range = [offset, contentEnd, re.offset];
      return doc;
    }
    exports.composeDoc = composeDoc;
  }
});

// node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS({
  "node_modules/yaml/dist/compose/composer.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var directives = require_directives();
    var Document = require_Document();
    var errors = require_errors();
    var identity = require_identity();
    var composeDoc = require_compose_doc();
    var resolveEnd = require_resolve_end();
    function getErrorPos(src) {
      if (typeof src === "number")
        return [src, src + 1];
      if (Array.isArray(src))
        return src.length === 2 ? src : [src[0], src[1]];
      const { offset, source } = src;
      return [offset, offset + (typeof source === "string" ? source.length : 1)];
    }
    function parsePrelude(prelude) {
      let comment = "";
      let atComment = false;
      let afterEmptyLine = false;
      for (let i = 0; i < prelude.length; ++i) {
        const source = prelude[i];
        switch (source[0]) {
          case "#":
            comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
            atComment = true;
            afterEmptyLine = false;
            break;
          case "%":
            if (prelude[i + 1]?.[0] !== "#")
              i += 1;
            atComment = false;
            break;
          default:
            if (!atComment)
              afterEmptyLine = true;
            atComment = false;
        }
      }
      return { comment, afterEmptyLine };
    }
    var Composer = class {
      constructor(options = {}) {
        this.doc = null;
        this.atDirectives = false;
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
        this.onError = (source, code, message, warning) => {
          const pos = getErrorPos(source);
          if (warning)
            this.warnings.push(new errors.YAMLWarning(pos, code, message));
          else
            this.errors.push(new errors.YAMLParseError(pos, code, message));
        };
        this.directives = new directives.Directives({ version: options.version || "1.2" });
        this.options = options;
      }
      decorate(doc, afterDoc) {
        const { comment, afterEmptyLine } = parsePrelude(this.prelude);
        if (comment) {
          const dc = doc.contents;
          if (afterDoc) {
            doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
          } else if (afterEmptyLine || doc.directives.docStart || !dc) {
            doc.commentBefore = comment;
          } else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
            let it = dc.items[0];
            if (identity.isPair(it))
              it = it.key;
            const cb = it.commentBefore;
            it.commentBefore = cb ? `${comment}
${cb}` : comment;
          } else {
            const cb = dc.commentBefore;
            dc.commentBefore = cb ? `${comment}
${cb}` : comment;
          }
        }
        if (afterDoc) {
          for (let i = 0; i < this.errors.length; ++i)
            doc.errors.push(this.errors[i]);
          for (let i = 0; i < this.warnings.length; ++i)
            doc.warnings.push(this.warnings[i]);
        } else {
          doc.errors = this.errors;
          doc.warnings = this.warnings;
        }
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
      }
      /**
       * Current stream status information.
       *
       * Mostly useful at the end of input for an empty stream.
       */
      streamInfo() {
        return {
          comment: parsePrelude(this.prelude).comment,
          directives: this.directives,
          errors: this.errors,
          warnings: this.warnings
        };
      }
      /**
       * Compose tokens into documents.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *compose(tokens, forceDoc = false, endOffset = -1) {
        for (const token of tokens)
          yield* this.next(token);
        yield* this.end(forceDoc, endOffset);
      }
      /** Advance the composer by one CST token. */
      *next(token) {
        if (node_process.env.LOG_STREAM)
          console.dir(token, { depth: null });
        switch (token.type) {
          case "directive":
            this.directives.add(token.source, (offset, message, warning) => {
              const pos = getErrorPos(token);
              pos[0] += offset;
              this.onError(pos, "BAD_DIRECTIVE", message, warning);
            });
            this.prelude.push(token.source);
            this.atDirectives = true;
            break;
          case "document": {
            const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
            if (this.atDirectives && !doc.directives.docStart)
              this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
            this.decorate(doc, false);
            if (this.doc)
              yield this.doc;
            this.doc = doc;
            this.atDirectives = false;
            break;
          }
          case "byte-order-mark":
          case "space":
            break;
          case "comment":
          case "newline":
            this.prelude.push(token.source);
            break;
          case "error": {
            const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
            const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
            if (this.atDirectives || !this.doc)
              this.errors.push(error);
            else
              this.doc.errors.push(error);
            break;
          }
          case "doc-end": {
            if (!this.doc) {
              const msg = "Unexpected doc-end without preceding document";
              this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
              break;
            }
            this.doc.directives.docEnd = true;
            const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
            this.decorate(this.doc, true);
            if (end.comment) {
              const dc = this.doc.comment;
              this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
            }
            this.doc.range[2] = end.offset;
            break;
          }
          default:
            this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
        }
      }
      /**
       * Call at end of input to yield any remaining document.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *end(forceDoc = false, endOffset = -1) {
        if (this.doc) {
          this.decorate(this.doc, true);
          yield this.doc;
          this.doc = null;
        } else if (forceDoc) {
          const opts = Object.assign({ _directives: this.directives }, this.options);
          const doc = new Document.Document(void 0, opts);
          if (this.atDirectives)
            this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
          doc.range = [0, endOffset, endOffset];
          this.decorate(doc, false);
          yield doc;
        }
      }
    };
    exports.Composer = Composer;
  }
});

// node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS({
  "node_modules/yaml/dist/parse/cst-scalar.js"(exports) {
    "use strict";
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    var errors = require_errors();
    var stringifyString = require_stringifyString();
    function resolveAsScalar(token, strict = true, onError) {
      if (token) {
        const _onError = (pos, code, message) => {
          const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
          if (onError)
            onError(offset, code, message);
          else
            throw new errors.YAMLParseError([offset, offset + 1], code, message);
        };
        switch (token.type) {
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
          case "block-scalar":
            return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
        }
      }
      return null;
    }
    function createScalarToken(value, context2) {
      const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context2;
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey,
        indent: indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      const end = context2.end ?? [
        { type: "newline", offset: -1, indent, source: "\n" }
      ];
      switch (source[0]) {
        case "|":
        case ">": {
          const he = source.indexOf("\n");
          const head = source.substring(0, he);
          const body = source.substring(he + 1) + "\n";
          const props = [
            { type: "block-scalar-header", offset, indent, source: head }
          ];
          if (!addEndtoBlockProps(props, end))
            props.push({ type: "newline", offset: -1, indent, source: "\n" });
          return { type: "block-scalar", offset, indent, props, source: body };
        }
        case '"':
          return { type: "double-quoted-scalar", offset, indent, source, end };
        case "'":
          return { type: "single-quoted-scalar", offset, indent, source, end };
        default:
          return { type: "scalar", offset, indent, source, end };
      }
    }
    function setScalarValue(token, value, context2 = {}) {
      let { afterKey = false, implicitKey = false, inFlow = false, type } = context2;
      let indent = "indent" in token ? token.indent : null;
      if (afterKey && typeof indent === "number")
        indent += 2;
      if (!type)
        switch (token.type) {
          case "single-quoted-scalar":
            type = "QUOTE_SINGLE";
            break;
          case "double-quoted-scalar":
            type = "QUOTE_DOUBLE";
            break;
          case "block-scalar": {
            const header = token.props[0];
            if (header.type !== "block-scalar-header")
              throw new Error("Invalid block scalar header");
            type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
            break;
          }
          default:
            type = "PLAIN";
        }
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey: implicitKey || indent === null,
        indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      switch (source[0]) {
        case "|":
        case ">":
          setBlockScalarValue(token, source);
          break;
        case '"':
          setFlowScalarValue(token, source, "double-quoted-scalar");
          break;
        case "'":
          setFlowScalarValue(token, source, "single-quoted-scalar");
          break;
        default:
          setFlowScalarValue(token, source, "scalar");
      }
    }
    function setBlockScalarValue(token, source) {
      const he = source.indexOf("\n");
      const head = source.substring(0, he);
      const body = source.substring(he + 1) + "\n";
      if (token.type === "block-scalar") {
        const header = token.props[0];
        if (header.type !== "block-scalar-header")
          throw new Error("Invalid block scalar header");
        header.source = head;
        token.source = body;
      } else {
        const { offset } = token;
        const indent = "indent" in token ? token.indent : -1;
        const props = [
          { type: "block-scalar-header", offset, indent, source: head }
        ];
        if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0))
          props.push({ type: "newline", offset: -1, indent, source: "\n" });
        for (const key of Object.keys(token))
          if (key !== "type" && key !== "offset")
            delete token[key];
        Object.assign(token, { type: "block-scalar", indent, props, source: body });
      }
    }
    function addEndtoBlockProps(props, end) {
      if (end)
        for (const st of end)
          switch (st.type) {
            case "space":
            case "comment":
              props.push(st);
              break;
            case "newline":
              props.push(st);
              return true;
          }
      return false;
    }
    function setFlowScalarValue(token, source, type) {
      switch (token.type) {
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          token.type = type;
          token.source = source;
          break;
        case "block-scalar": {
          const end = token.props.slice(1);
          let oa = source.length;
          if (token.props[0].type === "block-scalar-header")
            oa -= token.props[0].source.length;
          for (const tok of end)
            tok.offset += oa;
          delete token.props;
          Object.assign(token, { type, source, end });
          break;
        }
        case "block-map":
        case "block-seq": {
          const offset = token.offset + source.length;
          const nl = { type: "newline", offset, indent: token.indent, source: "\n" };
          delete token.items;
          Object.assign(token, { type, source, end: [nl] });
          break;
        }
        default: {
          const indent = "indent" in token ? token.indent : -1;
          const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
          for (const key of Object.keys(token))
            if (key !== "type" && key !== "offset")
              delete token[key];
          Object.assign(token, { type, indent, source, end });
        }
      }
    }
    exports.createScalarToken = createScalarToken;
    exports.resolveAsScalar = resolveAsScalar;
    exports.setScalarValue = setScalarValue;
  }
});

// node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS({
  "node_modules/yaml/dist/parse/cst-stringify.js"(exports) {
    "use strict";
    var stringify = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
    function stringifyToken(token) {
      switch (token.type) {
        case "block-scalar": {
          let res = "";
          for (const tok of token.props)
            res += stringifyToken(tok);
          return res + token.source;
        }
        case "block-map":
        case "block-seq": {
          let res = "";
          for (const item of token.items)
            res += stringifyItem(item);
          return res;
        }
        case "flow-collection": {
          let res = token.start.source;
          for (const item of token.items)
            res += stringifyItem(item);
          for (const st of token.end)
            res += st.source;
          return res;
        }
        case "document": {
          let res = stringifyItem(token);
          if (token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
        default: {
          let res = token.source;
          if ("end" in token && token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
      }
    }
    function stringifyItem({ start, key, sep, value }) {
      let res = "";
      for (const st of start)
        res += st.source;
      if (key)
        res += stringifyToken(key);
      if (sep)
        for (const st of sep)
          res += st.source;
      if (value)
        res += stringifyToken(value);
      return res;
    }
    exports.stringify = stringify;
  }
});

// node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS({
  "node_modules/yaml/dist/parse/cst-visit.js"(exports) {
    "use strict";
    var BREAK = Symbol("break visit");
    var SKIP = Symbol("skip children");
    var REMOVE = Symbol("remove item");
    function visit(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    visit.itemAtPath = (cst, path) => {
      let item = cst;
      for (const [field, index] of path) {
        const tok = item?.[field];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path) => {
      const parent = visit.itemAtPath(cst, path.slice(0, -1));
      const field = path[path.length - 1][0];
      const coll = parent?.[field];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path, item, visitor) {
      let ctrl = visitor(item, path);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field of ["key", "value"]) {
        const token = item[field];
        if (token && "items" in token) {
          for (let i = 0; i < token.items.length; ++i) {
            const ci = _visit(Object.freeze(path.concat([[field, i]])), token.items[i], visitor);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i, 1);
              i -= 1;
            }
          }
          if (typeof ctrl === "function" && field === "key")
            ctrl = ctrl(item, path);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path) : ctrl;
    }
    exports.visit = visit;
  }
});

// node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS({
  "node_modules/yaml/dist/parse/cst.js"(exports) {
    "use strict";
    var cstScalar = require_cst_scalar();
    var cstStringify = require_cst_stringify();
    var cstVisit = require_cst_visit();
    var BOM = "\uFEFF";
    var DOCUMENT = "";
    var FLOW_END = "";
    var SCALAR = "";
    var isCollection = (token) => !!token && "items" in token;
    var isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
    function prettyToken(token) {
      switch (token) {
        case BOM:
          return "<BOM>";
        case DOCUMENT:
          return "<DOC>";
        case FLOW_END:
          return "<FLOW_END>";
        case SCALAR:
          return "<SCALAR>";
        default:
          return JSON.stringify(token);
      }
    }
    function tokenType(source) {
      switch (source) {
        case BOM:
          return "byte-order-mark";
        case DOCUMENT:
          return "doc-mode";
        case FLOW_END:
          return "flow-error-end";
        case SCALAR:
          return "scalar";
        case "---":
          return "doc-start";
        case "...":
          return "doc-end";
        case "":
        case "\n":
        case "\r\n":
          return "newline";
        case "-":
          return "seq-item-ind";
        case "?":
          return "explicit-key-ind";
        case ":":
          return "map-value-ind";
        case "{":
          return "flow-map-start";
        case "}":
          return "flow-map-end";
        case "[":
          return "flow-seq-start";
        case "]":
          return "flow-seq-end";
        case ",":
          return "comma";
      }
      switch (source[0]) {
        case " ":
        case "	":
          return "space";
        case "#":
          return "comment";
        case "%":
          return "directive-line";
        case "*":
          return "alias";
        case "&":
          return "anchor";
        case "!":
          return "tag";
        case "'":
          return "single-quoted-scalar";
        case '"':
          return "double-quoted-scalar";
        case "|":
        case ">":
          return "block-scalar-header";
      }
      return null;
    }
    exports.createScalarToken = cstScalar.createScalarToken;
    exports.resolveAsScalar = cstScalar.resolveAsScalar;
    exports.setScalarValue = cstScalar.setScalarValue;
    exports.stringify = cstStringify.stringify;
    exports.visit = cstVisit.visit;
    exports.BOM = BOM;
    exports.DOCUMENT = DOCUMENT;
    exports.FLOW_END = FLOW_END;
    exports.SCALAR = SCALAR;
    exports.isCollection = isCollection;
    exports.isScalar = isScalar;
    exports.prettyToken = prettyToken;
    exports.tokenType = tokenType;
  }
});

// node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS({
  "node_modules/yaml/dist/parse/lexer.js"(exports) {
    "use strict";
    var cst = require_cst();
    function isEmpty(ch) {
      switch (ch) {
        case void 0:
        case " ":
        case "\n":
        case "\r":
        case "	":
          return true;
        default:
          return false;
      }
    }
    var hexDigits = new Set("0123456789ABCDEFabcdef");
    var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
    var flowIndicatorChars = new Set(",[]{}");
    var invalidAnchorChars = new Set(" ,[]{}\n\r	");
    var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
    var Lexer = class {
      constructor() {
        this.atEnd = false;
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        this.buffer = "";
        this.flowKey = false;
        this.flowLevel = 0;
        this.indentNext = 0;
        this.indentValue = 0;
        this.lineEndPos = null;
        this.next = null;
        this.pos = 0;
      }
      /**
       * Generate YAML tokens from the `source` string. If `incomplete`,
       * a part of the last line may be left as a buffer for the next call.
       *
       * @returns A generator of lexical tokens
       */
      *lex(source, incomplete = false) {
        if (source) {
          if (typeof source !== "string")
            throw TypeError("source is not a string");
          this.buffer = this.buffer ? this.buffer + source : source;
          this.lineEndPos = null;
        }
        this.atEnd = !incomplete;
        let next = this.next ?? "stream";
        while (next && (incomplete || this.hasChars(1)))
          next = yield* this.parseNext(next);
      }
      atLineEnd() {
        let i = this.pos;
        let ch = this.buffer[i];
        while (ch === " " || ch === "	")
          ch = this.buffer[++i];
        if (!ch || ch === "#" || ch === "\n")
          return true;
        if (ch === "\r")
          return this.buffer[i + 1] === "\n";
        return false;
      }
      charAt(n) {
        return this.buffer[this.pos + n];
      }
      continueScalar(offset) {
        let ch = this.buffer[offset];
        if (this.indentNext > 0) {
          let indent = 0;
          while (ch === " ")
            ch = this.buffer[++indent + offset];
          if (ch === "\r") {
            const next = this.buffer[indent + offset + 1];
            if (next === "\n" || !next && !this.atEnd)
              return offset + indent + 1;
          }
          return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
        }
        if (ch === "-" || ch === ".") {
          const dt = this.buffer.substr(offset, 3);
          if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
            return -1;
        }
        return offset;
      }
      getLine() {
        let end = this.lineEndPos;
        if (typeof end !== "number" || end !== -1 && end < this.pos) {
          end = this.buffer.indexOf("\n", this.pos);
          this.lineEndPos = end;
        }
        if (end === -1)
          return this.atEnd ? this.buffer.substring(this.pos) : null;
        if (this.buffer[end - 1] === "\r")
          end -= 1;
        return this.buffer.substring(this.pos, end);
      }
      hasChars(n) {
        return this.pos + n <= this.buffer.length;
      }
      setNext(state) {
        this.buffer = this.buffer.substring(this.pos);
        this.pos = 0;
        this.lineEndPos = null;
        this.next = state;
        return null;
      }
      peek(n) {
        return this.buffer.substr(this.pos, n);
      }
      *parseNext(next) {
        switch (next) {
          case "stream":
            return yield* this.parseStream();
          case "line-start":
            return yield* this.parseLineStart();
          case "block-start":
            return yield* this.parseBlockStart();
          case "doc":
            return yield* this.parseDocument();
          case "flow":
            return yield* this.parseFlowCollection();
          case "quoted-scalar":
            return yield* this.parseQuotedScalar();
          case "block-scalar":
            return yield* this.parseBlockScalar();
          case "plain-scalar":
            return yield* this.parsePlainScalar();
        }
      }
      *parseStream() {
        let line = this.getLine();
        if (line === null)
          return this.setNext("stream");
        if (line[0] === cst.BOM) {
          yield* this.pushCount(1);
          line = line.substring(1);
        }
        if (line[0] === "%") {
          let dirEnd = line.length;
          let cs = line.indexOf("#");
          while (cs !== -1) {
            const ch = line[cs - 1];
            if (ch === " " || ch === "	") {
              dirEnd = cs - 1;
              break;
            } else {
              cs = line.indexOf("#", cs + 1);
            }
          }
          while (true) {
            const ch = line[dirEnd - 1];
            if (ch === " " || ch === "	")
              dirEnd -= 1;
            else
              break;
          }
          const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
          yield* this.pushCount(line.length - n);
          this.pushNewline();
          return "stream";
        }
        if (this.atLineEnd()) {
          const sp = yield* this.pushSpaces(true);
          yield* this.pushCount(line.length - sp);
          yield* this.pushNewline();
          return "stream";
        }
        yield cst.DOCUMENT;
        return yield* this.parseLineStart();
      }
      *parseLineStart() {
        const ch = this.charAt(0);
        if (!ch && !this.atEnd)
          return this.setNext("line-start");
        if (ch === "-" || ch === ".") {
          if (!this.atEnd && !this.hasChars(4))
            return this.setNext("line-start");
          const s = this.peek(3);
          if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
            yield* this.pushCount(3);
            this.indentValue = 0;
            this.indentNext = 0;
            return s === "---" ? "doc" : "stream";
          }
        }
        this.indentValue = yield* this.pushSpaces(false);
        if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
          this.indentNext = this.indentValue;
        return yield* this.parseBlockStart();
      }
      *parseBlockStart() {
        const [ch0, ch1] = this.peek(2);
        if (!ch1 && !this.atEnd)
          return this.setNext("block-start");
        if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
          const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
          this.indentNext = this.indentValue + 1;
          this.indentValue += n;
          return "block-start";
        }
        return "doc";
      }
      *parseDocument() {
        yield* this.pushSpaces(true);
        const line = this.getLine();
        if (line === null)
          return this.setNext("doc");
        let n = yield* this.pushIndicators();
        switch (line[n]) {
          case "#":
            yield* this.pushCount(line.length - n);
          // fallthrough
          case void 0:
            yield* this.pushNewline();
            return yield* this.parseLineStart();
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel = 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            return "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "doc";
          case '"':
          case "'":
            return yield* this.parseQuotedScalar();
          case "|":
          case ">":
            n += yield* this.parseBlockScalarHeader();
            n += yield* this.pushSpaces(true);
            yield* this.pushCount(line.length - n);
            yield* this.pushNewline();
            return yield* this.parseBlockScalar();
          default:
            return yield* this.parsePlainScalar();
        }
      }
      *parseFlowCollection() {
        let nl, sp;
        let indent = -1;
        do {
          nl = yield* this.pushNewline();
          if (nl > 0) {
            sp = yield* this.pushSpaces(false);
            this.indentValue = indent = sp;
          } else {
            sp = 0;
          }
          sp += yield* this.pushSpaces(true);
        } while (nl + sp > 0);
        const line = this.getLine();
        if (line === null)
          return this.setNext("flow");
        if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
          const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
          if (!atFlowEndMarker) {
            this.flowLevel = 0;
            yield cst.FLOW_END;
            return yield* this.parseLineStart();
          }
        }
        let n = 0;
        while (line[n] === ",") {
          n += yield* this.pushCount(1);
          n += yield* this.pushSpaces(true);
          this.flowKey = false;
        }
        n += yield* this.pushIndicators();
        switch (line[n]) {
          case void 0:
            return "flow";
          case "#":
            yield* this.pushCount(line.length - n);
            return "flow";
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel += 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            this.flowKey = true;
            this.flowLevel -= 1;
            return this.flowLevel ? "flow" : "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "flow";
          case '"':
          case "'":
            this.flowKey = true;
            return yield* this.parseQuotedScalar();
          case ":": {
            const next = this.charAt(1);
            if (this.flowKey || isEmpty(next) || next === ",") {
              this.flowKey = false;
              yield* this.pushCount(1);
              yield* this.pushSpaces(true);
              return "flow";
            }
          }
          // fallthrough
          default:
            this.flowKey = false;
            return yield* this.parsePlainScalar();
        }
      }
      *parseQuotedScalar() {
        const quote = this.charAt(0);
        let end = this.buffer.indexOf(quote, this.pos + 1);
        if (quote === "'") {
          while (end !== -1 && this.buffer[end + 1] === "'")
            end = this.buffer.indexOf("'", end + 2);
        } else {
          while (end !== -1) {
            let n = 0;
            while (this.buffer[end - 1 - n] === "\\")
              n += 1;
            if (n % 2 === 0)
              break;
            end = this.buffer.indexOf('"', end + 1);
          }
        }
        const qb = this.buffer.substring(0, end);
        let nl = qb.indexOf("\n", this.pos);
        if (nl !== -1) {
          while (nl !== -1) {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = qb.indexOf("\n", cs);
          }
          if (nl !== -1) {
            end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
          }
        }
        if (end === -1) {
          if (!this.atEnd)
            return this.setNext("quoted-scalar");
          end = this.buffer.length;
        }
        yield* this.pushToIndex(end + 1, false);
        return this.flowLevel ? "flow" : "doc";
      }
      *parseBlockScalarHeader() {
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        let i = this.pos;
        while (true) {
          const ch = this.buffer[++i];
          if (ch === "+")
            this.blockScalarKeep = true;
          else if (ch > "0" && ch <= "9")
            this.blockScalarIndent = Number(ch) - 1;
          else if (ch !== "-")
            break;
        }
        return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
      }
      *parseBlockScalar() {
        let nl = this.pos - 1;
        let indent = 0;
        let ch;
        loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2) {
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case "\n":
              nl = i2;
              indent = 0;
              break;
            case "\r": {
              const next = this.buffer[i2 + 1];
              if (!next && !this.atEnd)
                return this.setNext("block-scalar");
              if (next === "\n")
                break;
            }
            // fallthrough
            default:
              break loop;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("block-scalar");
        if (indent >= this.indentNext) {
          if (this.blockScalarIndent === -1)
            this.indentNext = indent;
          else {
            this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
          }
          do {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = this.buffer.indexOf("\n", cs);
          } while (nl !== -1);
          if (nl === -1) {
            if (!this.atEnd)
              return this.setNext("block-scalar");
            nl = this.buffer.length;
          }
        }
        let i = nl + 1;
        ch = this.buffer[i];
        while (ch === " ")
          ch = this.buffer[++i];
        if (ch === "	") {
          while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
            ch = this.buffer[++i];
          nl = i - 1;
        } else if (!this.blockScalarKeep) {
          do {
            let i2 = nl - 1;
            let ch2 = this.buffer[i2];
            if (ch2 === "\r")
              ch2 = this.buffer[--i2];
            const lastChar = i2;
            while (ch2 === " ")
              ch2 = this.buffer[--i2];
            if (ch2 === "\n" && i2 >= this.pos && i2 + 1 + indent > lastChar)
              nl = i2;
            else
              break;
          } while (true);
        }
        yield cst.SCALAR;
        yield* this.pushToIndex(nl + 1, true);
        return yield* this.parseLineStart();
      }
      *parsePlainScalar() {
        const inFlow = this.flowLevel > 0;
        let end = this.pos - 1;
        let i = this.pos - 1;
        let ch;
        while (ch = this.buffer[++i]) {
          if (ch === ":") {
            const next = this.buffer[i + 1];
            if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
              break;
            end = i;
          } else if (isEmpty(ch)) {
            let next = this.buffer[i + 1];
            if (ch === "\r") {
              if (next === "\n") {
                i += 1;
                ch = "\n";
                next = this.buffer[i + 1];
              } else
                end = i;
            }
            if (next === "#" || inFlow && flowIndicatorChars.has(next))
              break;
            if (ch === "\n") {
              const cs = this.continueScalar(i + 1);
              if (cs === -1)
                break;
              i = Math.max(i, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end = i;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("plain-scalar");
        yield cst.SCALAR;
        yield* this.pushToIndex(end + 1, true);
        return inFlow ? "flow" : "doc";
      }
      *pushCount(n) {
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos += n;
          return n;
        }
        return 0;
      }
      *pushToIndex(i, allowEmpty) {
        const s = this.buffer.slice(this.pos, i);
        if (s) {
          yield s;
          this.pos += s.length;
          return s.length;
        } else if (allowEmpty)
          yield "";
        return 0;
      }
      *pushIndicators() {
        let n = 0;
        loop: while (true) {
          switch (this.charAt(0)) {
            case "!":
              n += yield* this.pushTag();
              n += yield* this.pushSpaces(true);
              continue loop;
            case "&":
              n += yield* this.pushUntil(isNotAnchorChar);
              n += yield* this.pushSpaces(true);
              continue loop;
            case "-":
            // this is an error
            case "?":
            // this is an error outside flow collections
            case ":": {
              const inFlow = this.flowLevel > 0;
              const ch1 = this.charAt(1);
              if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
                if (!inFlow)
                  this.indentNext = this.indentValue + 1;
                else if (this.flowKey)
                  this.flowKey = false;
                n += yield* this.pushCount(1);
                n += yield* this.pushSpaces(true);
                continue loop;
              }
            }
          }
          break loop;
        }
        return n;
      }
      *pushTag() {
        if (this.charAt(1) === "<") {
          let i = this.pos + 2;
          let ch = this.buffer[i];
          while (!isEmpty(ch) && ch !== ">")
            ch = this.buffer[++i];
          return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
        } else {
          let i = this.pos + 1;
          let ch = this.buffer[i];
          while (ch) {
            if (tagChars.has(ch))
              ch = this.buffer[++i];
            else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
              ch = this.buffer[i += 3];
            } else
              break;
          }
          return yield* this.pushToIndex(i, false);
        }
      }
      *pushNewline() {
        const ch = this.buffer[this.pos];
        if (ch === "\n")
          return yield* this.pushCount(1);
        else if (ch === "\r" && this.charAt(1) === "\n")
          return yield* this.pushCount(2);
        else
          return 0;
      }
      *pushSpaces(allowTabs) {
        let i = this.pos - 1;
        let ch;
        do {
          ch = this.buffer[++i];
        } while (ch === " " || allowTabs && ch === "	");
        const n = i - this.pos;
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos = i;
        }
        return n;
      }
      *pushUntil(test) {
        let i = this.pos;
        let ch = this.buffer[i];
        while (!test(ch))
          ch = this.buffer[++i];
        return yield* this.pushToIndex(i, false);
      }
    };
    exports.Lexer = Lexer;
  }
});

// node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS({
  "node_modules/yaml/dist/parse/line-counter.js"(exports) {
    "use strict";
    var LineCounter = class {
      constructor() {
        this.lineStarts = [];
        this.addNewLine = (offset) => this.lineStarts.push(offset);
        this.linePos = (offset) => {
          let low = 0;
          let high = this.lineStarts.length;
          while (low < high) {
            const mid = low + high >> 1;
            if (this.lineStarts[mid] < offset)
              low = mid + 1;
            else
              high = mid;
          }
          if (this.lineStarts[low] === offset)
            return { line: low + 1, col: 1 };
          if (low === 0)
            return { line: 0, col: offset };
          const start = this.lineStarts[low - 1];
          return { line: low, col: offset - start + 1 };
        };
      }
    };
    exports.LineCounter = LineCounter;
  }
});

// node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS({
  "node_modules/yaml/dist/parse/parser.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var cst = require_cst();
    var lexer = require_lexer();
    function includesToken(list2, type) {
      for (let i = 0; i < list2.length; ++i)
        if (list2[i].type === type)
          return true;
      return false;
    }
    function findNonEmptyIndex(list2) {
      for (let i = 0; i < list2.length; ++i) {
        switch (list2[i].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i;
        }
      }
      return -1;
    }
    function isFlowToken(token) {
      switch (token?.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "flow-collection":
          return true;
        default:
          return false;
      }
    }
    function getPrevProps(parent) {
      switch (parent.type) {
        case "document":
          return parent.start;
        case "block-map": {
          const it = parent.items[parent.items.length - 1];
          return it.sep ?? it.start;
        }
        case "block-seq":
          return parent.items[parent.items.length - 1].start;
        /* istanbul ignore next should not happen */
        default:
          return [];
      }
    }
    function getFirstKeyStartProps(prev) {
      if (prev.length === 0)
        return [];
      let i = prev.length;
      loop: while (--i >= 0) {
        switch (prev[i].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
      while (prev[++i]?.type === "space") {
      }
      return prev.splice(i, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i = 0; i < source.length; ++i)
          target.push(source[i]);
    }
    function fixFlowSeqItems(fc) {
      if (fc.start.type === "flow-seq-start") {
        for (const it of fc.items) {
          if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
            if (it.key)
              it.value = it.key;
            delete it.key;
            if (isFlowToken(it.value)) {
              if (it.value.end)
                arrayPushArray(it.value.end, it.sep);
              else
                it.value.end = it.sep;
            } else
              arrayPushArray(it.start, it.sep);
            delete it.sep;
          }
        }
      }
    }
    var Parser = class {
      /**
       * @param onNewLine - If defined, called separately with the start position of
       *   each new line (in `parse()`, including the start of input).
       */
      constructor(onNewLine) {
        this.atNewLine = true;
        this.atScalar = false;
        this.indent = 0;
        this.offset = 0;
        this.onKeyLine = false;
        this.stack = [];
        this.source = "";
        this.type = "";
        this.lexer = new lexer.Lexer();
        this.onNewLine = onNewLine;
      }
      /**
       * Parse `source` as a YAML stream.
       * If `incomplete`, a part of the last line may be left as a buffer for the next call.
       *
       * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
       *
       * @returns A generator of tokens representing each directive, document, and other structure.
       */
      *parse(source, incomplete = false) {
        if (this.onNewLine && this.offset === 0)
          this.onNewLine(0);
        for (const lexeme of this.lexer.lex(source, incomplete))
          yield* this.next(lexeme);
        if (!incomplete)
          yield* this.end();
      }
      /**
       * Advance the parser by the `source` of one lexical token.
       */
      *next(source) {
        this.source = source;
        if (node_process.env.LOG_TOKENS)
          console.log("|", cst.prettyToken(source));
        if (this.atScalar) {
          this.atScalar = false;
          yield* this.step();
          this.offset += source.length;
          return;
        }
        const type = cst.tokenType(source);
        if (!type) {
          const message = `Not a YAML token: ${source}`;
          yield* this.pop({ type: "error", offset: this.offset, message, source });
          this.offset += source.length;
        } else if (type === "scalar") {
          this.atNewLine = false;
          this.atScalar = true;
          this.type = "scalar";
        } else {
          this.type = type;
          yield* this.step();
          switch (type) {
            case "newline":
              this.atNewLine = true;
              this.indent = 0;
              if (this.onNewLine)
                this.onNewLine(this.offset + source.length);
              break;
            case "space":
              if (this.atNewLine && source[0] === " ")
                this.indent += source.length;
              break;
            case "explicit-key-ind":
            case "map-value-ind":
            case "seq-item-ind":
              if (this.atNewLine)
                this.indent += source.length;
              break;
            case "doc-mode":
            case "flow-error-end":
              return;
            default:
              this.atNewLine = false;
          }
          this.offset += source.length;
        }
      }
      /** Call at end of input to push out any remaining constructions */
      *end() {
        while (this.stack.length > 0)
          yield* this.pop();
      }
      get sourceToken() {
        const st = {
          type: this.type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
        return st;
      }
      *step() {
        const top = this.peek(1);
        if (this.type === "doc-end" && top?.type !== "doc-end") {
          while (this.stack.length > 0)
            yield* this.pop();
          this.stack.push({
            type: "doc-end",
            offset: this.offset,
            source: this.source
          });
          return;
        }
        if (!top)
          return yield* this.stream();
        switch (top.type) {
          case "document":
            return yield* this.document(top);
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return yield* this.scalar(top);
          case "block-scalar":
            return yield* this.blockScalar(top);
          case "block-map":
            return yield* this.blockMap(top);
          case "block-seq":
            return yield* this.blockSequence(top);
          case "flow-collection":
            return yield* this.flowCollection(top);
          case "doc-end":
            return yield* this.documentEnd(top);
        }
        yield* this.pop();
      }
      peek(n) {
        return this.stack[this.stack.length - n];
      }
      *pop(error) {
        const token = error ?? this.stack.pop();
        if (!token) {
          const message = "Tried to pop an empty stack";
          yield { type: "error", offset: this.offset, source: "", message };
        } else if (this.stack.length === 0) {
          yield token;
        } else {
          const top = this.peek(1);
          if (token.type === "block-scalar") {
            token.indent = "indent" in top ? top.indent : 0;
          } else if (token.type === "flow-collection" && top.type === "document") {
            token.indent = 0;
          }
          if (token.type === "flow-collection")
            fixFlowSeqItems(token);
          switch (top.type) {
            case "document":
              top.value = token;
              break;
            case "block-scalar":
              top.props.push(token);
              break;
            case "block-map": {
              const it = top.items[top.items.length - 1];
              if (it.value) {
                top.items.push({ start: [], key: token, sep: [] });
                this.onKeyLine = true;
                return;
              } else if (it.sep) {
                it.value = token;
              } else {
                Object.assign(it, { key: token, sep: [] });
                this.onKeyLine = !it.explicitKey;
                return;
              }
              break;
            }
            case "block-seq": {
              const it = top.items[top.items.length - 1];
              if (it.value)
                top.items.push({ start: [], value: token });
              else
                it.value = token;
              break;
            }
            case "flow-collection": {
              const it = top.items[top.items.length - 1];
              if (!it || it.value)
                top.items.push({ start: [], key: token, sep: [] });
              else if (it.sep)
                it.value = token;
              else
                Object.assign(it, { key: token, sep: [] });
              return;
            }
            /* istanbul ignore next should not happen */
            default:
              yield* this.pop();
              yield* this.pop(token);
          }
          if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
            const last = token.items[token.items.length - 1];
            if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
              if (top.type === "document")
                top.end = last.start;
              else
                top.items.push({ start: last.start });
              token.items.splice(-1, 1);
            }
          }
        }
      }
      *stream() {
        switch (this.type) {
          case "directive-line":
            yield { type: "directive", offset: this.offset, source: this.source };
            return;
          case "byte-order-mark":
          case "space":
          case "comment":
          case "newline":
            yield this.sourceToken;
            return;
          case "doc-mode":
          case "doc-start": {
            const doc = {
              type: "document",
              offset: this.offset,
              start: []
            };
            if (this.type === "doc-start")
              doc.start.push(this.sourceToken);
            this.stack.push(doc);
            return;
          }
        }
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML stream`,
          source: this.source
        };
      }
      *document(doc) {
        if (doc.value)
          return yield* this.lineEnd(doc);
        switch (this.type) {
          case "doc-start": {
            if (findNonEmptyIndex(doc.start) !== -1) {
              yield* this.pop();
              yield* this.step();
            } else
              doc.start.push(this.sourceToken);
            return;
          }
          case "anchor":
          case "tag":
          case "space":
          case "comment":
          case "newline":
            doc.start.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(doc);
        if (bv)
          this.stack.push(bv);
        else {
          yield {
            type: "error",
            offset: this.offset,
            message: `Unexpected ${this.type} token in YAML document`,
            source: this.source
          };
        }
      }
      *scalar(scalar) {
        if (this.type === "map-value-ind") {
          const prev = getPrevProps(this.peek(2));
          const start = getFirstKeyStartProps(prev);
          let sep;
          if (scalar.end) {
            sep = scalar.end;
            sep.push(this.sourceToken);
            delete scalar.end;
          } else
            sep = [this.sourceToken];
          const map = {
            type: "block-map",
            offset: scalar.offset,
            indent: scalar.indent,
            items: [{ start, key: scalar, sep }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map;
        } else
          yield* this.lineEnd(scalar);
      }
      *blockScalar(scalar) {
        switch (this.type) {
          case "space":
          case "comment":
          case "newline":
            scalar.props.push(this.sourceToken);
            return;
          case "scalar":
            scalar.source = this.source;
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine) {
              let nl = this.source.indexOf("\n") + 1;
              while (nl !== 0) {
                this.onNewLine(this.offset + nl);
                nl = this.source.indexOf("\n", nl) + 1;
              }
            }
            yield* this.pop();
            break;
          /* istanbul ignore next should not happen */
          default:
            yield* this.pop();
            yield* this.step();
        }
      }
      *blockMap(map) {
        const it = map.items[map.items.length - 1];
        switch (this.type) {
          case "newline":
            this.onKeyLine = false;
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "space":
          case "comment":
            if (it.value) {
              map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              if (this.atIndentedComment(it.start, map.indent)) {
                const prev = map.items[map.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  map.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
        }
        if (this.indent >= map.indent) {
          const atMapIndent = !this.onKeyLine && this.indent === map.indent;
          const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
          let start = [];
          if (atNextItem && it.sep && !it.value) {
            const nl = [];
            for (let i = 0; i < it.sep.length; ++i) {
              const st = it.sep[i];
              switch (st.type) {
                case "newline":
                  nl.push(i);
                  break;
                case "space":
                  break;
                case "comment":
                  if (st.indent > map.indent)
                    nl.length = 0;
                  break;
                default:
                  nl.length = 0;
              }
            }
            if (nl.length >= 2)
              start = it.sep.splice(nl[1]);
          }
          switch (this.type) {
            case "anchor":
            case "tag":
              if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start });
                this.onKeyLine = true;
              } else if (it.sep) {
                it.sep.push(this.sourceToken);
              } else {
                it.start.push(this.sourceToken);
              }
              return;
            case "explicit-key-ind":
              if (!it.sep && !it.explicitKey) {
                it.start.push(this.sourceToken);
                it.explicitKey = true;
              } else if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start, explicitKey: true });
              } else {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [this.sourceToken], explicitKey: true }]
                });
              }
              this.onKeyLine = true;
              return;
            case "map-value-ind":
              if (it.explicitKey) {
                if (!it.sep) {
                  if (includesToken(it.start, "newline")) {
                    Object.assign(it, { key: null, sep: [this.sourceToken] });
                  } else {
                    const start2 = getFirstKeyStartProps(it.start);
                    this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                    });
                  }
                } else if (it.value) {
                  map.items.push({ start: [], key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start, key: null, sep: [this.sourceToken] }]
                  });
                } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                  const start2 = getFirstKeyStartProps(it.start);
                  const key = it.key;
                  const sep = it.sep;
                  sep.push(this.sourceToken);
                  delete it.key;
                  delete it.sep;
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key, sep }]
                  });
                } else if (start.length > 0) {
                  it.sep = it.sep.concat(start, this.sourceToken);
                } else {
                  it.sep.push(this.sourceToken);
                }
              } else {
                if (!it.sep) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else if (it.value || atNextItem) {
                  map.items.push({ start, key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: [], key: null, sep: [this.sourceToken] }]
                  });
                } else {
                  it.sep.push(this.sourceToken);
                }
              }
              this.onKeyLine = true;
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start, key: fs, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs);
              } else {
                Object.assign(it, { key: fs, sep: [] });
                this.onKeyLine = true;
              }
              return;
            }
            default: {
              const bv = this.startBlockValue(map);
              if (bv) {
                if (bv.type === "block-seq") {
                  if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                    yield* this.pop({
                      type: "error",
                      offset: this.offset,
                      message: "Unexpected block-seq-ind on same line with key",
                      source: this.source
                    });
                    return;
                  }
                } else if (atMapIndent) {
                  map.items.push({ start });
                }
                this.stack.push(bv);
                return;
              }
            }
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *blockSequence(seq) {
        const it = seq.items[seq.items.length - 1];
        switch (this.type) {
          case "newline":
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                seq.items.push({ start: [this.sourceToken] });
            } else
              it.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it.value)
              seq.items.push({ start: [this.sourceToken] });
            else {
              if (this.atIndentedComment(it.start, seq.indent)) {
                const prev = seq.items[seq.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  seq.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
          case "anchor":
          case "tag":
            if (it.value || this.indent <= seq.indent)
              break;
            it.start.push(this.sourceToken);
            return;
          case "seq-item-ind":
            if (this.indent !== seq.indent)
              break;
            if (it.value || includesToken(it.start, "seq-item-ind"))
              seq.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
        }
        if (this.indent > seq.indent) {
          const bv = this.startBlockValue(seq);
          if (bv) {
            this.stack.push(bv);
            return;
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *flowCollection(fc) {
        const it = fc.items[fc.items.length - 1];
        if (this.type === "flow-error-end") {
          let top;
          do {
            yield* this.pop();
            top = this.peek(1);
          } while (top?.type === "flow-collection");
        } else if (fc.end.length === 0) {
          switch (this.type) {
            case "comma":
            case "explicit-key-ind":
              if (!it || it.sep)
                fc.items.push({ start: [this.sourceToken] });
              else
                it.start.push(this.sourceToken);
              return;
            case "map-value-ind":
              if (!it || it.value)
                fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              return;
            case "space":
            case "comment":
            case "newline":
            case "anchor":
            case "tag":
              if (!it || it.value)
                fc.items.push({ start: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                it.start.push(this.sourceToken);
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs, sep: [] });
              else if (it.sep)
                this.stack.push(fs);
              else
                Object.assign(it, { key: fs, sep: [] });
              return;
            }
            case "flow-map-end":
            case "flow-seq-end":
              fc.end.push(this.sourceToken);
              return;
          }
          const bv = this.startBlockValue(fc);
          if (bv)
            this.stack.push(bv);
          else {
            yield* this.pop();
            yield* this.step();
          }
        } else {
          const parent = this.peek(2);
          if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
            yield* this.pop();
            yield* this.step();
          } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            fixFlowSeqItems(fc);
            const sep = fc.end.splice(1, fc.end.length);
            sep.push(this.sourceToken);
            const map = {
              type: "block-map",
              offset: fc.offset,
              indent: fc.indent,
              items: [{ start, key: fc, sep }]
            };
            this.onKeyLine = true;
            this.stack[this.stack.length - 1] = map;
          } else {
            yield* this.lineEnd(fc);
          }
        }
      }
      flowScalar(type) {
        if (this.onNewLine) {
          let nl = this.source.indexOf("\n") + 1;
          while (nl !== 0) {
            this.onNewLine(this.offset + nl);
            nl = this.source.indexOf("\n", nl) + 1;
          }
        }
        return {
          type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
      }
      startBlockValue(parent) {
        switch (this.type) {
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return this.flowScalar(this.type);
          case "block-scalar-header":
            return {
              type: "block-scalar",
              offset: this.offset,
              indent: this.indent,
              props: [this.sourceToken],
              source: ""
            };
          case "flow-map-start":
          case "flow-seq-start":
            return {
              type: "flow-collection",
              offset: this.offset,
              indent: this.indent,
              start: this.sourceToken,
              items: [],
              end: []
            };
          case "seq-item-ind":
            return {
              type: "block-seq",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken] }]
            };
          case "explicit-key-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            start.push(this.sourceToken);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, explicitKey: true }]
            };
          }
          case "map-value-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, key: null, sep: [this.sourceToken] }]
            };
          }
        }
        return null;
      }
      atIndentedComment(start, indent) {
        if (this.type !== "comment")
          return false;
        if (this.indent <= indent)
          return false;
        return start.every((st) => st.type === "newline" || st.type === "space");
      }
      *documentEnd(docEnd) {
        if (this.type !== "doc-mode") {
          if (docEnd.end)
            docEnd.end.push(this.sourceToken);
          else
            docEnd.end = [this.sourceToken];
          if (this.type === "newline")
            yield* this.pop();
        }
      }
      *lineEnd(token) {
        switch (this.type) {
          case "comma":
          case "doc-start":
          case "doc-end":
          case "flow-seq-end":
          case "flow-map-end":
          case "map-value-ind":
            yield* this.pop();
            yield* this.step();
            break;
          case "newline":
            this.onKeyLine = false;
          // fallthrough
          case "space":
          case "comment":
          default:
            if (token.end)
              token.end.push(this.sourceToken);
            else
              token.end = [this.sourceToken];
            if (this.type === "newline")
              yield* this.pop();
        }
      }
    };
    exports.Parser = Parser;
  }
});

// node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS({
  "node_modules/yaml/dist/public-api.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var errors = require_errors();
    var log2 = require_log();
    var identity = require_identity();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    function parseOptions(options) {
      const prettyErrors = options.prettyErrors !== false;
      const lineCounter$1 = options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null;
      return { lineCounter: lineCounter$1, prettyErrors };
    }
    function parseAllDocuments(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      const docs = Array.from(composer$1.compose(parser$1.parse(source)));
      if (prettyErrors && lineCounter2)
        for (const doc of docs) {
          doc.errors.forEach(errors.prettifyError(source, lineCounter2));
          doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
        }
      if (docs.length > 0)
        return docs;
      return Object.assign([], { empty: true }, composer$1.streamInfo());
    }
    function parseDocument(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      let doc = null;
      for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) {
        if (!doc)
          doc = _doc;
        else if (doc.options.logLevel !== "silent") {
          doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
          break;
        }
      }
      if (prettyErrors && lineCounter2) {
        doc.errors.forEach(errors.prettifyError(source, lineCounter2));
        doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
      }
      return doc;
    }
    function parse3(src, reviver, options) {
      let _reviver = void 0;
      if (typeof reviver === "function") {
        _reviver = reviver;
      } else if (options === void 0 && reviver && typeof reviver === "object") {
        options = reviver;
      }
      const doc = parseDocument(src, options);
      if (!doc)
        return null;
      doc.warnings.forEach((warning) => log2.warn(doc.options.logLevel, warning));
      if (doc.errors.length > 0) {
        if (doc.options.logLevel !== "silent")
          throw doc.errors[0];
        else
          doc.errors = [];
      }
      return doc.toJS(Object.assign({ reviver: _reviver }, options));
    }
    function stringify(value, replacer, options) {
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
      }
      if (typeof options === "string")
        options = options.length;
      if (typeof options === "number") {
        const indent = Math.round(options);
        options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
      }
      if (value === void 0) {
        const { keepUndefined } = options ?? replacer ?? {};
        if (!keepUndefined)
          return void 0;
      }
      if (identity.isDocument(value) && !_replacer)
        return value.toString(options);
      return new Document.Document(value, _replacer, options).toString(options);
    }
    exports.parse = parse3;
    exports.parseAllDocuments = parseAllDocuments;
    exports.parseDocument = parseDocument;
    exports.stringify = stringify;
  }
});

// node_modules/yaml/dist/index.js
var require_dist = __commonJS({
  "node_modules/yaml/dist/index.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var Schema = require_Schema();
    var errors = require_errors();
    var Alias = require_Alias();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var cst = require_cst();
    var lexer = require_lexer();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    var publicApi = require_public_api();
    var visit = require_visit();
    exports.Composer = composer.Composer;
    exports.Document = Document.Document;
    exports.Schema = Schema.Schema;
    exports.YAMLError = errors.YAMLError;
    exports.YAMLParseError = errors.YAMLParseError;
    exports.YAMLWarning = errors.YAMLWarning;
    exports.Alias = Alias.Alias;
    exports.isAlias = identity.isAlias;
    exports.isCollection = identity.isCollection;
    exports.isDocument = identity.isDocument;
    exports.isMap = identity.isMap;
    exports.isNode = identity.isNode;
    exports.isPair = identity.isPair;
    exports.isScalar = identity.isScalar;
    exports.isSeq = identity.isSeq;
    exports.Pair = Pair.Pair;
    exports.Scalar = Scalar.Scalar;
    exports.YAMLMap = YAMLMap.YAMLMap;
    exports.YAMLSeq = YAMLSeq.YAMLSeq;
    exports.CST = cst;
    exports.Lexer = lexer.Lexer;
    exports.LineCounter = lineCounter.LineCounter;
    exports.Parser = parser.Parser;
    exports.parse = publicApi.parse;
    exports.parseAllDocuments = publicApi.parseAllDocuments;
    exports.parseDocument = publicApi.parseDocument;
    exports.stringify = publicApi.stringify;
    exports.visit = visit.visit;
    exports.visitAsync = visit.visitAsync;
  }
});

// plugins/cairn/cli/src/main.ts
import { readFileSync as readFileSync6 } from "node:fs";
import { resolve as resolve3 } from "node:path";

// plugins/cairn/cli/src/locate.ts
import { existsSync as existsSync2, readdirSync, readFileSync as readFileSync2 } from "node:fs";
import { basename, dirname as dirname2, join as join2, relative } from "node:path";

// plugins/cairn/cli/src/git.ts
import { execFileSync, spawnSync } from "node:child_process";

// plugins/cairn/cli/src/util.ts
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
var Refusal = class extends Error {
  fixes;
  constructor(message, fixes = []) {
    super(message);
    this.fixes = fixes;
  }
};
var CliError = class extends Error {
};
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var readText = (p) => existsSync(p) ? readFileSync(p, "utf8") : void 0;
function writeText(p, s) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, s);
}
var hashText = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
var SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function pluginRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, ".claude-plugin", "plugin.json"))) return dir;
    dir = dirname(dir);
  }
  throw new CliError("cannot locate plugin root");
}
function withLock(dir, fn) {
  const lock = join(dir, ".lock");
  const deadline = Date.now() + 1e4;
  for (; ; ) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > 3e4) rmdirSync(lock);
      } catch {
      }
      if (Date.now() > deadline) throw new CliError(`state is locked (${lock}); remove it if no cairn command is running`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    return fn();
  } finally {
    try {
      rmdirSync(lock);
    } catch {
    }
  }
}

// plugins/cairn/cli/src/git.ts
var NO_AUTO_MAINTENANCE = ["-c", "gc.auto=0", "-c", "maintenance.auto=false"];
function git(args, cwd) {
  const r = spawnSync("git", [...NO_AUTO_MAINTENANCE, ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new CliError(`git ${args.join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}
function gitOk(args, cwd) {
  return spawnSync("git", [...NO_AUTO_MAINTENANCE, ...args], { cwd, encoding: "utf8" }).status === 0;
}
function worktrees(cwd) {
  const out = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd, encoding: "utf8" });
  const list2 = [];
  for (const block of out.split("\n\n")) {
    const path = block.match(/^worktree (.+)$/m)?.[1];
    if (!path) continue;
    const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1];
    list2.push({ path, branch });
  }
  return list2;
}
var currentBranch = (cwd) => git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
var topLevel = (cwd) => git(["rev-parse", "--show-toplevel"], cwd);
var commonDir = (cwd) => git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
var branchExists = (name, cwd) => gitOk(["show-ref", "--verify", "--quiet", `refs/heads/${name}`], cwd);
function commitPath(cwd, path, message) {
  git(["add", "-A", "--", path], cwd);
  if (gitOk(["diff", "--cached", "--quiet", "--", path], cwd)) return false;
  git(["commit", "-q", "-m", message, "--", path], cwd);
  return true;
}

// plugins/cairn/cli/src/locate.ts
var PLANS_DIR = "docs/sdlc/plans";
var PLAN_PREFIXES = ["feature/", "fix/", "sdlc/"];
var TASK_PREFIXES = ["task/", "sdlc-task/"];
var planBranch = (slug, track) => `${track === "fix" ? "fix/" : "feature/"}${slug}`;
var taskBranch = (slug, task) => `task/${slug}/${task}`;
var worktreeName = (branch) => branch.replace(/\//g, "-");
var planRel = (slug) => `${PLANS_DIR}/${slug}`;
function planDirName(slug, created) {
  if (typeof created === "string") return `${created.slice(0, 10)}-${slug}`;
  const p = (n) => String(n).padStart(2, "0");
  return `${created.getFullYear()}-${p(created.getMonth() + 1)}-${p(created.getDate())}-${slug}`;
}
var DATED = /^\d{4}-\d{2}-\d{2}-/;
function pickPlanDir(slug, names, hasPlan) {
  const dated = names.filter((n) => DATED.test(n) && n.slice(11) === slug).sort().reverse();
  return [...dated, slug].find((n) => names.includes(n) && hasPlan(n));
}
function resolvePlanDir(slug, where) {
  let name;
  if ("root" in where) {
    const base = join2(where.root, PLANS_DIR);
    if (!existsSync2(base)) return void 0;
    name = pickPlanDir(slug, readdirSync(base), (n) => existsSync2(join2(base, n, "state.json")));
  } else {
    let names;
    try {
      names = git(["ls-tree", "--name-only", where.ref, `${PLANS_DIR}/`], where.cwd).split("\n").filter(Boolean).map((p) => p.slice(PLANS_DIR.length + 1));
    } catch {
      return void 0;
    }
    name = pickPlanDir(slug, names, (n) => gitOk(["cat-file", "-e", `${where.ref}:${PLANS_DIR}/${n}/state.json`], where.cwd));
  }
  return name && `${PLANS_DIR}/${name}`;
}
var planRelIn = (slug, root) => resolvePlanDir(slug, { root }) ?? planRel(slug);
var planRelOf = (plan) => relative(plan.worktree, plan.dir);
function recordedBranch(ref, slug, cwd) {
  try {
    const rel = resolvePlanDir(slug, { ref, cwd });
    return rel ? JSON.parse(git(["show", `${ref}:${rel}/state.json`], cwd)).branch : void 0;
  } catch {
    return void 0;
  }
}
var planBranchesFor = (slug, cwd) => PLAN_PREFIXES.map((p) => `${p}${slug}`).filter((b) => branchExists(b, cwd) && recordedBranch(b, slug, cwd) === b);
function parseBranch(branch) {
  for (const p of PLAN_PREFIXES) if (branch.startsWith(p)) return { slug: branch.slice(p.length) };
  for (const p of TASK_PREFIXES)
    if (branch.startsWith(p)) {
      const [slug, task] = branch.slice(p.length).split("/");
      return { slug, task };
    }
  return {};
}
function planRef(slug, wts, planBranch2) {
  const wt = planBranch2 ? wts.find((w) => w.branch === planBranch2) : void 0;
  return wt ? { slug, worktree: wt.path, dir: join2(wt.path, planRelIn(slug, wt.path)) } : { slug };
}
function context(cwd, slugOverride) {
  let top;
  try {
    top = topLevel(cwd);
  } catch {
    throw new CliError("not inside a git repository");
  }
  const wts = worktrees(top);
  const branch = currentBranch(top);
  const { slug, task } = parseBranch(branch);
  const ctx = { cwd, top, mainRoot: wts[0]?.path ?? top, branch, worktrees: wts, task };
  const s = slugOverride ?? slug;
  if (s) {
    let planBr;
    let accept = false;
    if (slugOverride) {
      planBr = planBranchesFor(s, top)[0];
      accept = true;
    } else {
      let recorded;
      try {
        recorded = JSON.parse(readFileSync2(join2(top, planRelIn(s, top), "state.json"), "utf8")).branch;
      } catch {
      }
      const legacy = branch.startsWith("sdlc/") || branch.startsWith("sdlc-task/");
      if (task) {
        planBr = recorded ?? (legacy ? `sdlc/${s}` : void 0);
        accept = legacy || !!recorded && branchExists(recorded, top);
      } else {
        planBr = branch;
        accept = legacy || recorded === branch;
      }
    }
    if (accept) ctx.plan = planRef(s, wts, planBr);
  }
  return ctx;
}
function requirePlan(ctx) {
  const p = ctx.plan;
  if (!p) throw new CliError(`not on a plan branch (current: ${ctx.branch}). Use \`cairn status --all\` to list plans, or \`cairn new <slug>\`.`);
  if (!p.worktree || !p.dir || !existsSync2(join2(p.dir, "state.json")))
    throw new CliError(`plan "${p.slug}" has no checked-out worktree with state. Run \`cairn resume ${p.slug}\` to check out its plan branch.`);
  return p;
}

// plugins/cairn/cli/src/shared.ts
import { spawnSync as spawnSync2 } from "node:child_process";
import { appendFileSync, mkdirSync as mkdirSync2 } from "node:fs";
import { join as join6 } from "node:path";

// plugins/cairn/cli/src/config.ts
import { join as join3 } from "node:path";
var CONFIG_REL = ".sdlc/config.json";
var DEFAULTS = { maxParallel: 3, autoCommit: true };
function loadConfig(...roots) {
  for (const root of roots) {
    if (!root) continue;
    const raw = readText(join3(root, CONFIG_REL));
    if (raw === void 0) continue;
    try {
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (e) {
      throw new CliError(`${CONFIG_REL} is not valid JSON: ${e.message}`);
    }
  }
  return { ...DEFAULTS };
}
var worktreeRoot = (cfg, mainRoot) => cfg.worktreeRoot ? join3(mainRoot, cfg.worktreeRoot) : join3(mainRoot, ".claude", "worktrees");

// plugins/cairn/cli/src/proof.ts
import { createHash as createHash2, randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, constants, fstatSync, linkSync, openSync, readFileSync as readFileSync3, readSync, renameSync, rmSync } from "node:fs";
import { join as join4 } from "node:path";
var HEARTBEAT_FRESH_MS = 1e4;
var cairnDir = (common) => join4(common, "cairn");
var hashPath = (common) => join4(cairnDir(common), "mod-secret.sha256");
function readLineFromStdin(prompt) {
  process.stderr.write(prompt);
  const buf = Buffer.alloc(1);
  let line = "";
  for (; ; ) {
    let n;
    try {
      n = readSync(0, buf, 0, 1, null);
    } catch (e) {
      if (e.code === "EAGAIN") continue;
      throw e;
    }
    if (n === 0 || buf[0] === 10) return line;
    line += String.fromCharCode(buf[0]);
  }
}
var terminalIO = {
  isTTY: () => !!process.stdin.isTTY && !!process.stdout.isTTY,
  readLine: readLineFromStdin
};
function readRegularFile(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return void 0;
  }
  try {
    return fstatSync(fd).isFile() ? readFileSync3(fd, "utf8") : void 0;
  } finally {
    closeSync(fd);
  }
}
function secretMatches(common, given) {
  if (!given) return false;
  const original = hashPath(common);
  const claimed = `${original}.claimed.${randomBytes(8).toString("hex")}`;
  try {
    renameSync(original, claimed);
  } catch {
    return false;
  }
  const stored = readRegularFile(claimed)?.trim() ?? "";
  const a = Buffer.from(stored);
  const b = Buffer.from(createHash2("sha256").update(given).digest("hex"));
  const match = a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
  if (!match) {
    try {
      linkSync(claimed, original);
    } catch {
    }
  }
  try {
    rmSync(claimed, { force: true });
  } catch {
  }
  return match;
}
function humanProof(ctx, opts, io = terminalIO) {
  const common = commonDir(ctx.mainRoot);
  const secret = process.env.CAIRN_APPROVER;
  delete process.env.CAIRN_APPROVER;
  if (secretMatches(common, secret)) return { source: "mod" };
  if (!opts.human) return void 0;
  if (!io.isTTY()) throw new Refusal("--human needs an interactive terminal: run this in your own terminal, not through the agent");
  const slug = ctx.plan?.slug;
  const typed = io.readLine("Type the plan name to confirm: ").trim();
  return slug && typed === slug ? { source: "terminal" } : void 0;
}
function modActive(common) {
  const t = Number(readText(join4(cairnDir(common), "mod-heartbeat"))?.trim());
  const age = Date.now() - t;
  return Number.isFinite(t) && t > 0 && age >= 0 && age < HEARTBEAT_FRESH_MS;
}

// plugins/cairn/cli/src/sections.ts
function sections(md) {
  const out = /* @__PURE__ */ new Map();
  let title;
  let body = [];
  let fenced = false;
  const flush = () => {
    if (title !== void 0) out.set(title, body.join("\n").trim());
  };
  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const m = !fenced && line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (m) {
      flush();
      title = m[1].toLowerCase();
      body = [];
    } else if (title !== void 0) body.push(line);
  }
  flush();
  return out;
}
function missingSections(md, required) {
  const have = sections(md);
  return required.filter((r) => !have.has(r.toLowerCase()));
}
function emptySections(md, required) {
  const have = sections(md);
  return required.filter((r) => {
    const body = have.get(r.toLowerCase());
    return body !== void 0 && body.replace(/<!--[\s\S]*?-->/g, "").trim() === "";
  });
}
var uncheckedItems = (body = "") => body.split("\n").filter((l) => /^\s*[-*]\s+\[ \]/.test(l)).map((l) => l.trim());
var wordCount = (md) => md.replace(/<!--[\s\S]*?-->/g, "").split(/\s+/).filter(Boolean).length;
var proseWordCount = (md) => wordCount(md.replace(/<!--[\s\S]*?-->/g, "").split("\n").filter((l) => !/^\s*#{1,6}\s/.test(l)).join("\n"));
var PRD_SECTIONS = ["Problem", "Solution", "Requirements", "Non-goals", "Open questions"];
var PLAN_SECTIONS = ["Goal", "Architecture", "Phases"];
var RECORD_SECTIONS = ["Links", "Why", "What was built", "How it works", "Findings", "Follow-ups"];
var HANDOFF_SECTIONS = ["In flight", "Open questions", "Next action"];
var RECORD_WORD_BUDGET = 600;
var FIX_RECORD_SECTIONS = ["Links", "Bug", "Cause", "Fix", "Evidence"];
var FIX_RECORD_WORD_BUDGET = 200;
var FR_ID = /\bFR-\d+\b/g;
var ids = (text = "") => [...new Set(text.match(FR_ID) ?? [])];

// plugins/cairn/cli/src/state.ts
import { join as join5 } from "node:path";

// plugins/cairn/cli/src/types.ts
var STAGES = ["repro", "discover", "prd", "plan", "execute", "verify", "review", "ship", "learn", "closed"];
var STAGE_LABEL = {
  repro: "Repro",
  discover: "Discover",
  prd: "PRD",
  plan: "Plan",
  execute: "Build",
  verify: "Check",
  review: "Review",
  ship: "Ship",
  learn: "Learn",
  closed: "Closed"
};
var SUBSTEPS = ["implementing", "reviewing", "fixing", "merging", "blocked"];
var SUGGESTION_AREAS = ["tests", "security", "perf", "quality", "ux", "docs"];
var SUGGESTION_SOURCES = ["task-review", "branch-review", "check", "implementer", "plan", "user"];

// plugins/cairn/cli/src/render.ts
var day = (iso) => iso ? iso.slice(0, 10) : "";
function nextFor(s) {
  if (s.stage === "closed") return { procedure: "status", text: "This plan is closed. Its record is in RECORD.md." };
  if (s.paused) return { procedure: "resume", text: `Paused ${day(s.paused.at)}. Resume to pick up where it stopped.` };
  const all = s.phases.flatMap((p) => p.tasks);
  switch (s.stage) {
    case "repro":
      return s.repro ? { procedure: "fix", substep: "advance", text: "Repro recorded. Advance to the fix." } : { procedure: "fix", text: "Record a command that reproduces the bug (cairn repro)." };
    case "discover":
      return { procedure: "discover", text: "Interview: settle the open decisions, then move on to the PRD." };
    case "prd":
      return s.approvals.prd ? { procedure: "prd", substep: "advance", text: "PRD approved. Advance to planning." } : { procedure: "prd", text: "Draft the PRD and get it approved." };
    case "plan":
      return s.approvals.plan ? { procedure: "plan", substep: "advance", text: "Plan approved. Advance to execution." } : { procedure: "plan", text: "Write the phased plan, load it, and get it approved." };
    case "execute": {
      const phase = s.phases.find((p) => p.status !== "done");
      if (!phase && s.track === "fix" && s.repro) return { procedure: "review", text: "The fix is built. Advance to review." };
      if (!phase) return { procedure: "verify", text: "All phases are done. Advance to verification." };
      if (phase.status === "awaiting_approval")
        return { procedure: "phase-end", text: `Phase "${phase.name}" is built. Run \`cairn phase finish\` to continue.` };
      const running = all.filter((x) => x.status === "in_progress");
      if (running.length)
        return { procedure: "execute", substep: "continue", text: `Continue running tasks: ${running.map((x) => `${x.name} (${x.substep ?? "implementing"})`).join(", ")}.` };
      return { procedure: "execute", text: `Start the next ready tasks in phase "${phase.name}".` };
    }
    case "verify":
      return { procedure: "verify", text: "Verify the build against the PRD and record the result." };
    case "review":
      return { procedure: "review", text: "Review the whole branch and record the result." };
    case "ship":
      return s.approvals.ship ? { procedure: "ship", substep: "advance", text: "Ship approved. Open the PR and advance." } : { procedure: "ship", text: "Write the completion record and decide whether to ship." };
    case "learn":
      return { procedure: "learn", text: "Capture anything worth keeping, then close the plan." };
  }
}
function progress(s) {
  const all = s.phases.flatMap((p) => p.tasks);
  if (!s.phases.length) return STAGE_LABEL[s.stage];
  const done = all.filter((x) => x.status === "done").length;
  const running = all.filter((x) => x.status === "in_progress").length;
  const pi = s.phases.findIndex((p) => p.status !== "done");
  const phase = pi === -1 ? "all phases done" : `phase ${pi + 1}/${s.phases.length} "${s.phases[pi].name}"`;
  return `${STAGE_LABEL[s.stage]} \xB7 ${phase} \xB7 ${done}/${all.length} tasks done${running ? ` \xB7 ${running} running` : ""}`;
}
var SOURCE_LABEL = { mod: "you, in the menu", terminal: "you, in the terminal" };
var approvedBy = (a) => {
  if (a.source === "mod" || a.source === "terminal") return ` (${SOURCE_LABEL[a.source]})`;
  return a.via === "agent" ? " (relayed by agent)" : "";
};
var overrideSource = (detail = "") => {
  const m = detail.match(/\(source: (mod|terminal)\)\s*$/);
  return m ? ` (${SOURCE_LABEL[m[1]]})` : "";
};
var openDrift = (s) => s.drift.filter((d) => !d.acked);
function summary(s) {
  const drift = openDrift(s).length;
  return `${s.title} (${s.slug}): ${progress(s)}${s.paused ? " \xB7 PAUSED" : ""}${drift ? ` \xB7 ${drift} out-of-scope edit(s)` : ""}`;
}
var taskIcon = (x, done) => x.status === "done" ? "\u2713" : x.status === "in_progress" ? "\u25D0" : x.blockedBy.some((b) => !done.has(b)) ? "\u2298" : "\u25CB";
var phaseIcon = (p) => ({ done: "\u2713", awaiting_approval: "\u25C6", in_progress: "\u25D0", pending: "\u25CB" })[p.status];
function renderStatus(s) {
  const next = nextFor(s);
  const all = s.phases.flatMap((p) => p.tasks);
  const byId = new Map(all.map((x) => [x.id, x]));
  const done = new Set(all.filter((x) => x.status === "done").map((x) => x.id));
  const out = [
    `# ${s.title}: status`,
    "",
    "<!-- Generated by cairn from state.json. Edits here are overwritten. -->",
    "",
    `**Where we are:** ${progress(s)}`,
    `**Next:** ${next.text}`
  ];
  if (s.paused) out.push(`**Paused** since ${day(s.paused.at)}. See handoff.md.`);
  out.push("", `Branch \`${s.branch}\` from \`${s.base}\` \xB7 started ${day(s.created)} \xB7 updated ${day(s.updated)}`);
  if (s.phases.length) {
    out.push("", "## Phases");
    for (const p of s.phases) {
      out.push(`- ${phaseIcon(p)} ${p.name}${p.status === "awaiting_approval" ? " (built, ready to finish)" : ""}`);
      for (const x of p.tasks) {
        let tail = "";
        if (x.status === "in_progress") tail = ` (${x.substep ?? "implementing"}${x.fixRound ? `, fix attempt ${x.fixRound}` : ""})`;
        else if (x.status === "pending") {
          const on = x.blockedBy.filter((b) => !done.has(b)).map((b) => byId.get(b)?.name ?? b);
          if (on.length) tail = ` (waits on ${on.join(", ")})`;
        }
        out.push(`  - ${taskIcon(x, done)} ${x.name}${tail}`);
      }
    }
  }
  const checkpoints = [];
  const a = s.approvals;
  if (a.prd) checkpoints.push(`PRD approved ${day(a.prd.at)}${approvedBy(a.prd)}`);
  if (a.plan) checkpoints.push(`Plan approved ${day(a.plan.at)}${approvedBy(a.plan)}`);
  if (s.evidence.verify) checkpoints.push(`Verify: ${s.evidence.verify.result}${s.evidence.verify.note ? ` (${s.evidence.verify.note})` : ""}`);
  if (s.evidence.review) checkpoints.push(`Review: ${s.evidence.review.result}${s.evidence.review.note ? ` (${s.evidence.review.note})` : ""}`);
  if (a.ship) checkpoints.push(`Ship approved ${day(a.ship.at)}${approvedBy(a.ship)}`);
  if (checkpoints.length) out.push("", "## Checkpoints", ...checkpoints.map((c) => `- ${c}`));
  const drift = openDrift(s);
  if (drift.length) out.push("", "## Out-of-scope edits to review", ...drift.map((d) => `- \`${d.path}\`: ${d.reason}`));
  const overrides = s.log.filter((l) => l.override);
  if (overrides.length) out.push("", "## Overrides", ...overrides.map((l) => `- ${day(l.at)} ${l.event}: ${l.override}${overrideSource(l.detail)}`));
  out.push("", "## Recent activity", ...s.log.slice(-8).reverse().map((l) => `- ${l.at.slice(0, 16).replace("T", " ")} ${l.event}${l.detail ? `: ${l.detail}` : ""}`));
  return out.join("\n") + "\n";
}
function renderIndex(rows) {
  const out = ["# Plans", "", "<!-- Generated by cairn. Edits here are overwritten. -->", ""];
  if (!rows.length) return out.concat("No plans yet. Start one with `/cairn:new`.").join("\n") + "\n";
  out.push("| Plan | Where | Next | Worktree |", "|---|---|---|---|");
  for (const r of rows)
    out.push(`| ${r.state.title} (\`${r.state.slug}\`) | ${progress(r.state)}${r.state.paused ? " \xB7 PAUSED" : ""} | ${nextFor(r.state).text} | ${r.worktree ?? "(not checked out)"} |`);
  return out.join("\n") + "\n";
}

// plugins/cairn/cli/src/state.ts
var statePath = (dir) => join5(dir, "state.json");
function normalize(s) {
  for (const p of s.phases ?? []) {
    const legacy = p;
    p.tasks ??= legacy.slices;
    delete legacy.slices;
  }
  return s;
}
function loadState(dir) {
  const raw = readText(statePath(dir));
  if (raw === void 0) throw new CliError(`no state.json in ${dir}`);
  const s = normalize(JSON.parse(raw));
  if (s.schema !== 1) throw new CliError(`unsupported state schema ${s.schema}`);
  return s;
}
function parseState(raw) {
  return normalize(JSON.parse(raw));
}
function saveState(dir, s) {
  s.updated = now();
  writeText(statePath(dir), JSON.stringify(s, null, 2) + "\n");
  writeText(join5(dir, "STATUS.md"), renderStatus(s));
}
function log(s, event, detail, override) {
  s.log.push({ at: now(), event, ...detail ? { detail } : {}, ...override ? { override } : {} });
}
function newState(slug, title, track, branch, base) {
  const t = now();
  return {
    schema: 1,
    slug,
    title,
    track,
    branch,
    base,
    created: t,
    updated: t,
    stage: "discover",
    paused: null,
    approvals: {},
    phases: [],
    evidence: {},
    drift: [],
    log: [{ at: t, event: "created" }]
  };
}

// plugins/cairn/cli/src/shared.ts
var current;
function humanOnce(opts, io) {
  if (!current) return void 0;
  if (current.human === void 0) current.human = humanProof(current.ctx, opts, io) ?? null;
  return current.human ?? void 0;
}
function requireHumanProof(kind, opts, io) {
  const p = humanOnce(opts, io);
  if (p) return p.source;
  throw new Refusal("approvals come from the user, and this command has no proof that one did", [
    `the user answers "Approve (Recommended)" in the approval menu tagged [cairn:approve ${kind} ${current?.ctx.plan?.slug}]`,
    `or the user runs, in their own terminal: cd ${current?.ctx.plan?.worktree ?? "<plan worktree>"} && ${pluginRoot()}/bin/cairn approve ${kind} --human`,
    "or the user presses Approve in the cairn pane (or runs /cairn:approve)"
  ]);
}
function gate(ok, s, event, opts, message, fixes = []) {
  if (ok) return;
  if (opts.override) {
    const human = humanOnce(opts);
    if (!human)
      throw new Refusal(`${message}; an override needs proof that the user chose it`, [
        `the user answers "Override" in a menu tagged [cairn:override ${s.slug}], and the mod runs the command`,
        "or the user runs this command, with --override, in their own terminal with --human"
      ]);
    log(s, `override: ${event}`, `${message} (source: ${human.source})`, opts.override);
    return;
  }
  throw new Refusal(message, [...fixes, `or, if the user chose to skip this: add --override "<reason>"`]);
}
function planCtx(ctx) {
  const plan = requirePlan(ctx);
  current = { ctx };
  return { ctx, plan, cfg: loadConfig(plan.worktree, ctx.mainRoot) };
}
function mutate(pc, commitMsg, fn) {
  const r = withLock(pc.plan.dir, () => {
    const s = loadState(pc.plan.dir);
    const out = fn(s);
    saveState(pc.plan.dir, s);
    return out;
  });
  if (commitMsg && pc.cfg.autoCommit) commitPath(pc.plan.worktree, planRelOf(pc.plan), `cairn(${pc.plan.slug}): ${commitMsg}`);
  return r;
}
var planFile = (pc, name) => join6(pc.plan.dir, name);
function childEnv() {
  const { CAIRN_APPROVER: _approver, ...rest } = process.env;
  return rest;
}
var COUNTS = /\b(?:pass(?:ed|ing)?|fail(?:ed|ing|ures?)?)\b\s*[:=]?\s*\d|\d+\s+(?:pass(?:ed|ing)?|fail(?:ed|ing|ures?)?)\b/i;
var testSummary = (lines) => [...lines].reverse().find((l) => COUNTS.test(l)) ?? lines.slice(-1)[0];
function runTests(cfg, cwd) {
  if (!cfg.test) return void 0;
  const r = spawnSync2("sh", ["-c", cfg.test], { cwd, encoding: "utf8", env: childEnv(), maxBuffer: 64 * 1024 * 1024 });
  const lines = `${r.stdout ?? ""}
${r.stderr ?? ""}`.split("\n").map((l) => l.trim()).filter(Boolean);
  return { ok: r.status === 0, cmd: cfg.test, tail: testSummary(lines) ?? `exit ${r.status}` };
}
function testsGate(t, s, event, opts) {
  if (!t) {
    log(s, `warning: ${event}`, "no test command configured, so nothing was run");
    return void 0;
  }
  gate(t.ok, s, event, opts, `tests are not green (\`${t.cmd}\` \u2192 ${t.tail})`, ["fix the failing tests, then retry"]);
  return t;
}
function runSetup(cfg, wt, mainRoot) {
  if (!cfg.setup) return "";
  const r = spawnSync2("sh", ["-c", cfg.setup], { cwd: wt, encoding: "utf8", env: { ...childEnv(), CAIRN_MAIN_ROOT: mainRoot }, maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? `
Setup ran: ${cfg.setup}` : `
Setup failed (\`${cfg.setup}\`, exit ${r.status}): ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ")}`;
}
function docProblems(md, file, required) {
  if (md === void 0) return [`${file} does not exist`];
  const p = [];
  const missing = missingSections(md, required);
  if (missing.length) p.push(`${file} is missing sections: ${missing.join(", ")}`);
  const empty2 = emptySections(md, required);
  if (empty2.length) p.push(`${file} has empty sections: ${empty2.join(", ")}`);
  return p;
}
function recordProblems(pc) {
  const md = readText(planFile(pc, "RECORD.md"));
  const p = docProblems(md, "RECORD.md", RECORD_SECTIONS);
  if (md && wordCount(md) > RECORD_WORD_BUDGET) p.push(`RECORD.md is ${wordCount(md)} words; the budget is ${RECORD_WORD_BUDGET}`);
  return p;
}
function ensureExcluded(mainRoot, pattern) {
  const file = join6(commonDir(mainRoot), "info", "exclude");
  const cur = readText(file) ?? "";
  if (!cur.split("\n").includes(pattern)) {
    mkdirSync2(join6(commonDir(mainRoot), "info"), { recursive: true });
    appendFileSync(file, `${cur.endsWith("\n") || !cur ? "" : "\n"}${pattern}
`);
  }
}
function template(name) {
  try {
    return readText(join6(pluginRoot(), "templates", name));
  } catch {
    return void 0;
  }
}

// plugins/cairn/cli/src/commands/plans.ts
import { existsSync as existsSync3, readFileSync as readFileSync4 } from "node:fs";
import { join as join7, resolve } from "node:path";
function cmdNew(ctx, slug, opts) {
  if (!slug || !SLUG.test(slug)) throw new CliError('usage: cairn new <kebab-case-slug> --title "\u2026"');
  const track = opts.track === "fix" ? "fix" : "feature";
  const branch = planBranch(slug, track);
  const existing = planBranchesFor(slug, ctx.top)[0];
  if (existing) throw new Refusal(`a plan named "${slug}" already exists (${existing})`, [`cairn resume ${slug}`, "or pick another slug"]);
  if (!gitOk(["rev-parse", "--verify", "HEAD"], ctx.top)) throw new Refusal("the repository has no commits yet", ["make an initial commit first"]);
  const mainBranch = ctx.worktrees[0]?.branch ?? ctx.branch;
  const base = typeof opts.from === "string" ? opts.from : ctx.plan ? mainBranch : ctx.branch;
  const title = typeof opts.title === "string" ? opts.title : slug;
  const cfg = loadConfig(ctx.top, ctx.mainRoot);
  let wt;
  if (opts["no-worktree"]) {
    git(["switch", "-q", "-c", branch, base], ctx.top);
    wt = ctx.top;
  } else {
    const root = worktreeRoot(cfg, ctx.mainRoot);
    if (!cfg.worktreeRoot) ensureExcluded(ctx.mainRoot, ".claude/worktrees/");
    wt = join7(root, worktreeName(branch));
    git(["worktree", "add", "-q", "-b", branch, wt, base], ctx.top);
  }
  const rel = `${PLANS_DIR}/${planDirName(slug, /* @__PURE__ */ new Date())}`;
  const dir = join7(wt, rel);
  writeText(join7(dir, "decisions.md"), `# Decisions: ${title}

Append-only. Written by \`cairn decide\` as each decision is made.
`);
  const state = newState(slug, title, track, branch, base);
  if (track === "fix") state.stage = "repro";
  saveState(dir, state);
  if (cfg.autoCommit) commitPath(wt, rel, `cairn(${slug}): start plan "${title}"`);
  const setup = opts["no-worktree"] ? "" : runSetup(cfg, wt, ctx.mainRoot);
  return {
    message: [
      `Started plan "${title}" on ${branch} (from ${base}).${setup}`,
      `Worktree: ${wt}`,
      `The plan is ready. Continue with /cairn:next from where you are.`
    ].join("\n"),
    data: { slug, branch, base, worktree: wt, dir }
  };
}
function cmdProductInit(ctx) {
  const dir = join7(ctx.top, "docs/sdlc/product");
  const prd = join7(dir, "PRD.md");
  if (existsSync3(prd)) throw new Refusal("docs/sdlc/product/PRD.md already exists", ["edit it with the product procedure instead"]);
  writeText(prd, template("product-prd.md") ?? "# Product PRD\n\n## Vision\n\n## Users\n\n## Non-goals\n\n## Non-functional requirements\n\n## Must not trade off\n\n## Roadmap\n");
  writeText(join7(dir, "decisions", ".gitkeep"), "");
  return { message: `Created docs/sdlc/product/PRD.md and decisions/ on ${ctx.branch}. Fill it in, then commit.`, data: { path: prd } };
}
function cmdDecide(ctx, question, answer, opts) {
  const d = typeof opts.file === "string" ? readDecisionFile(ctx.cwd, opts.file) : { question, answer, why: typeof opts.why === "string" ? opts.why : void 0 };
  if (!d.question || !d.answer) throw new CliError('usage: cairn decide "<question>" "<answer>" [--why "\u2026"] | cairn decide --file <path>');
  const n = appendDecision(planCtx(ctx), d.question, d.answer, d.why);
  return { message: `Recorded decision ${n}: ${d.answer}`, data: { number: n } };
}
function readDecisionFile(cwd, file) {
  let data;
  try {
    data = JSON.parse(readFileSync4(resolve(cwd, file), "utf8"));
  } catch (e) {
    throw new CliError(`cannot read decision file ${file}: ${e.message}`);
  }
  const obj = data;
  if (!obj || typeof obj !== "object" || Array.isArray(obj) || typeof obj.question !== "string" || typeof obj.answer !== "string" || obj.why !== void 0 && typeof obj.why !== "string")
    throw new CliError(`decision file ${file} must be a JSON object {"question": "\u2026", "answer": "\u2026", "why": "\u2026"} (why optional)`);
  return { question: obj.question, answer: obj.answer, why: obj.why };
}
function appendDecision(pc, question, answer, why) {
  const file = planFile(pc, "decisions.md");
  const cur = readText(file) ?? "# Decisions\n";
  const n = (cur.match(/^### /gm)?.length ?? 0) + 1;
  writeText(file, `${cur.replace(/\n*$/, "\n")}
### ${n}. ${question}
**Decision:** ${answer}${why ? `
**Why:** ${why}` : ""}
_${now().slice(0, 16).replace("T", " ")}_
`);
  return n;
}

// plugins/cairn/cli/src/commands/stages.ts
import { join as join11 } from "node:path";

// plugins/cairn/cli/src/glob.ts
function globToRegex(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  if (!/[*?]/.test(glob)) re = re.replace(/\/$/, "") + "(?:/.*)?";
  return new RegExp(`^${re}$`);
}
var matchesAny = (path, globs) => globs.some((g) => globToRegex(g).test(path));
var staticPrefix = (glob) => glob.split(/[*?[]/)[0];
function scopesOverlap(a, b) {
  for (const x of a)
    for (const y of b) {
      if (globToRegex(x).test(y) || globToRegex(y).test(x)) return true;
      const px = staticPrefix(x);
      const py = staticPrefix(y);
      if (px.startsWith(py) || py.startsWith(px)) return true;
    }
  return false;
}

// plugins/cairn/cli/src/ready.ts
var currentPhase = (s) => s.phases.find((p) => p.status !== "done");
var allTasks = (s) => s.phases.flatMap((p) => p.tasks);
var findTask = (s, id) => allTasks(s).find((x) => x.id === id);
function readySet(s, maxParallel) {
  const phase = currentPhase(s);
  const done = new Set(allTasks(s).filter((x) => x.status === "done").map((x) => x.id));
  const inProgress = allTasks(s).filter((x) => x.status === "in_progress");
  const result = { ready: [], inProgress, waiting: [], phase };
  if (!phase || s.stage !== "execute" || s.paused) return result;
  let room = Math.max(0, maxParallel - inProgress.length);
  const taken = inProgress.map((x) => x.scope);
  for (const sl of phase.tasks) {
    if (sl.status !== "pending") continue;
    const on = sl.blockedBy.filter((b) => !done.has(b));
    if (on.length) {
      result.waiting.push({ task: sl, on });
      continue;
    }
    const clash = taken.some((t) => scopesOverlap(t, sl.scope));
    if (clash || room === 0) {
      result.waiting.push({ task: sl, on: clash ? ["scope overlap with running work"] : ["parallel cap"] });
      continue;
    }
    result.ready.push(sl);
    taken.push(sl.scope);
    room--;
  }
  return result;
}

// plugins/cairn/cli/src/commands/fix.ts
import { spawnSync as spawnSync3 } from "node:child_process";
import { existsSync as existsSync4, mkdtempSync, rmSync as rmSync2 } from "node:fs";
import { tmpdir } from "node:os";
import { join as join8 } from "node:path";
var DEFAULT_REPRO_TIMEOUT_MINUTES = 10;
var fastLane = (s) => s.track === "fix" && (s.stage === "repro" || !!s.repro);
var configHash = (cfg) => hashText(JSON.stringify({ setup: cfg.setup, test: cfg.test, build: cfg.build }));
function configGate(s, cfg, event, opts) {
  gate(
    !s.configHash || s.configHash === configHash(cfg),
    s,
    event,
    opts,
    "the setup, test, or build command in .sdlc/config.json changed since the user approved it",
    ["the user re-approves the commands by running, in their own terminal: cairn approve plan --human", "or the user chooses Override in the menu"]
  );
}
var changedFiles = (cwd, slug, base, head) => git(["diff", "--name-only", "-z", "-M", base, head, "--", ".", `:!${planRelIn(slug, cwd)}`], cwd).split("\0").filter(Boolean);
var GROUP_WRAPPER = 'set -m; sh -c "$1" & set +m; echo $! > "$2"; wait $!';
var SETPGID_FAILURE = /child setpgid \(.*\): Operation not permitted/;
function runRepro(cmd, cwd, cfg) {
  const minutes = cfg.reproTimeoutMinutes ?? DEFAULT_REPRO_TIMEOUT_MINUTES;
  const tmp = mkdtempSync(join8(tmpdir(), "cairn-repro-"));
  const pidFile = join8(tmp, "pgid");
  const r = spawnSync3("sh", ["-c", GROUP_WRAPPER, "sh", cmd, pidFile], { cwd, encoding: "utf8", env: childEnv(), timeout: minutes * 6e4, maxBuffer: 64 * 1024 * 1024 });
  const timedOut = r.error?.code === "ETIMEDOUT";
  const pgid = Number(readText(pidFile));
  if (timedOut && pgid > 0) {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {
    }
  }
  rmSync2(tmp, { recursive: true, force: true });
  const lines = `${r.stdout ?? ""}
${r.stderr ?? ""}`.split("\n").map((l) => l.trim()).filter((l) => l && !SETPGID_FAILURE.test(l));
  const last = lines.slice(-1)[0] ?? `exit ${r.status}`;
  if (timedOut) return { outcome: "timeout", detail: `timed out after ${Math.round(minutes * 60)}s` };
  if (r.error) return { outcome: "nostart", detail: r.error.message };
  if (r.status === 126 || r.status === 127) return { outcome: "nostart", detail: last };
  return { outcome: r.status === 0 ? "passes" : "fails", detail: last };
}
function cmdRepro(ctx, cmd, opts) {
  if (!cmd) throw new CliError('usage: cairn repro "<command>"');
  const pc = planCtx(ctx);
  const pre = loadState(pc.plan.dir);
  if (pre.track !== "fix") throw new Refusal("cairn repro is for fix plans", ["start one with cairn new <slug> --track fix"]);
  gate(pre.stage === "repro", pre, "repro", opts, `the plan is in ${pre.stage}, not repro`);
  configGate(pre, pc.cfg, "repro", opts);
  const ran = runRepro(cmd, pc.plan.worktree, pc.cfg);
  return mutate(pc, "repro recorded", (s) => {
    configGate(s, pc.cfg, "repro", opts);
    gate(s.stage === "repro", s, "repro", opts, `the plan is in ${s.stage}, not repro`);
    if (ran.outcome === "timeout" || ran.outcome === "nostart")
      throw new Refusal(`the repro command ${ran.outcome === "timeout" ? "did not finish" : "could not start"}: ${ran.detail}`, ["write a repro command that runs and finishes"]);
    if (ran.outcome === "passes") throw new Refusal("the command exits 0: this does not reproduce the bug", ["write a command that fails while the bug is present"]);
    s.repro = { cmd, tail: ran.detail, at: now() };
    s.configHash = configHash(pc.cfg);
    log(s, "repro recorded", `${cmd} \u2192 ${ran.detail}`);
    return { message: `Repro recorded: \`${cmd}\` fails (${ran.detail}). Next: \`cairn advance\` to the fix.`, data: { repro: s.repro } };
  });
}
function cmdEscalate(ctx, opts) {
  const pc = planCtx(ctx);
  const pre = loadState(pc.plan.dir);
  if (pre.track !== "fix") throw new Refusal("only a fix plan can be escalated; this is a feature plan");
  if (pre.stage === "closed") throw new Refusal("the plan is closed");
  const changed = /* @__PURE__ */ new Map();
  const own = planRelOf(pc.plan) + "/";
  for (const sl of allTasks(pre)) {
    const head = sl.branch && branchExists(sl.branch, pc.plan.worktree) ? sl.branch : sl.tip;
    if (!sl.base || !head) continue;
    const files = changedFiles(pc.plan.worktree, pre.slug, sl.base, head);
    if (sl.status === "in_progress" && sl.worktree && existsSync4(sl.worktree))
      for (const args of [["diff", "--name-only", "-z", "HEAD"], ["ls-files", "--others", "--exclude-standard", "-z"]])
        files.push(...git(args, sl.worktree).split("\0").filter((f) => f && !f.startsWith(own)));
    changed.set(sl.id, [...new Set(files.map((f) => f.replace(/[*?]/g, "?")))].sort());
  }
  return mutate(pc, "escalated to a feature plan", (s) => {
    for (const sl of allTasks(s)) sl.scope = changed.get(sl.id) ?? [];
    const repro = s.repro ? `\`${s.repro.cmd}\` (failed with: ${s.repro.tail})` : "none recorded";
    appendDecision(pc, "Escalate the fix to a feature plan", `The bug "${s.title}" is bigger than a fix. Repro: ${repro}. The fix task and its work are kept; the plan must keep the task id "fix".`, typeof opts.note === "string" ? opts.note : void 0);
    s.track = "feature";
    s.stage = "prd";
    delete s.evidence.review;
    delete s.approvals.ship;
    log(s, "escalated", "fix \u2192 feature plan at prd");
    return { message: `"${s.title}" is now a feature plan at the PRD stage. The fix task keeps its work, with its scope narrowed to the files it changed. Next: write the PRD.` };
  });
}

// plugins/cairn/cli/src/commands/suggest.ts
import { existsSync as existsSync6, readdirSync as readdirSync2 } from "node:fs";
import { join as join10 } from "node:path";

// plugins/cairn/cli/src/commands/status.ts
import { existsSync as existsSync5, readFileSync as readFileSync5 } from "node:fs";
import { join as join9 } from "node:path";
function listPlans(ctx) {
  const refs = git(["for-each-ref", "--format=%(refname:short)", ...PLAN_PREFIXES.map((p) => `refs/heads/${p}`)], ctx.top).split("\n").filter(Boolean);
  const rows = [];
  for (const b of refs) {
    const slug = parseBranch(b).slug;
    if (!slug) continue;
    const ref = planRef(slug, ctx.worktrees, b);
    try {
      const rel = resolvePlanDir(slug, { ref: b, cwd: ctx.top });
      const raw = ref.dir && existsSync5(join9(ref.dir, "state.json")) ? readFileSync5(join9(ref.dir, "state.json"), "utf8") : git(["show", `${b}:${rel}/state.json`], ctx.top);
      const state = parseState(raw);
      if (state.branch !== b) continue;
      rows.push({ state, live: !!ref.dir, worktree: ref.worktree, dir: ref.dir ?? join9(ctx.mainRoot, resolvePlanDir(slug, { root: ctx.mainRoot }) ?? rel ?? planRelIn(slug, ctx.mainRoot)) });
    } catch {
    }
  }
  return rows;
}
var modIsActive = (ctx) => modActive(commonDir(ctx.mainRoot));
function warnings(pc, s) {
  const w = [];
  const prd = readText(planFile(pc, "prd.md"));
  if (s.approvals.prd?.hash && prd && hashText(prd) !== s.approvals.prd.hash) w.push("prd.md changed after it was approved");
  const plan = readText(planFile(pc, "plan.md"));
  if (s.planHash && plan && hashText(plan) !== s.planHash) w.push("plan.md changed after it was loaded: run `cairn plan load --replan` or revert it");
  const open = s.drift.filter((d) => !d.acked);
  if (open.length) w.push(`${open.length} file(s) changed outside the plan's scope`);
  return w;
}
function cmdStatus(ctx, opts) {
  if (opts.all || !ctx.plan) {
    const rows = listPlans(ctx);
    const active = rows.filter((r) => r.state.stage !== "closed");
    const lines = rows.length ? rows.map((r) => `${r.state.stage === "closed" ? "\u2713" : r.state.paused ? "\u23F8" : "\u2022"} ${summary(r.state)}
    next: ${nextFor(r.state).text}${r.worktree ? "" : " (not checked out)"}`) : ["No plans yet. Start one with /cairn:new."];
    const openSuggestions = openSuggestionCount(ctx);
    return { message: `${active.length} active plan(s).
${lines.join("\n")}`, data: { plans: rows.map((r) => ({ ...r, next: nextFor(r.state), openSuggestions, ready: r.worktree ? readyFor({ plan: { dir: r.dir } }) : void 0 })), modActive: modIsActive(ctx), openSuggestions } };
  }
  const pc = planCtx(ctx);
  const s = loadState(pc.plan.dir);
  const w = warnings(pc, s);
  const next = nextFor(s);
  return {
    message: [summary(s), `Next: ${next.text}`, ...w.map((x) => `! ${x}`), ...ctx.task ? [`(You are in the worktree for task "${ctx.task}".)`] : []].join("\n"),
    data: { state: s, next, ready: readyFor(pc), warnings: w, task: ctx.task ?? null, planWorktree: pc.plan.worktree, modActive: modIsActive(ctx), openSuggestions: openSuggestionCount(ctx) }
  };
}
var procedurePath = (name) => join9(pluginRoot(), "procedures", `${name}.md`);
function cmdNext(ctx) {
  if (!ctx.plan) {
    const active = listPlans(ctx).filter((r) => r.state.stage !== "closed");
    if (!active.length) return { message: "No active plans. Start one.", data: { plan: null, stage: null, procedure: procedurePath("new"), summary: "No active plans.", modActive: modIsActive(ctx) } };
    return {
      message: `Active plans:
${active.map((r) => `  ${summary(r.state)}`).join("\n")}
Ask the user which plan to resume (/cairn:resume <slug>) or whether to start a new one (/cairn:new).`,
      data: { plan: null, stage: null, procedure: procedurePath("status"), plans: active.map((r) => r.state.slug), modActive: modIsActive(ctx) }
    };
  }
  const pc = planCtx(ctx);
  const s = loadState(pc.plan.dir);
  const n = nextFor(s);
  return {
    message: `${summary(s)}
Next: ${n.text}
Follow: ${procedurePath(n.procedure)}`,
    data: { plan: s.slug, stage: s.stage, substep: n.substep ?? null, procedure: procedurePath(n.procedure), summary: summary(s), text: n.text, warnings: warnings(pc, s), planWorktree: pc.plan.worktree, modActive: modIsActive(ctx) }
  };
}
function cmdRender(ctx) {
  if (ctx.plan) {
    const pc = planCtx(ctx);
    withLock(pc.plan.dir, () => saveState(pc.plan.dir, loadState(pc.plan.dir)));
    return { message: `Rendered ${join9(pc.plan.dir, "STATUS.md")}.` };
  }
  const out = join9(ctx.top, "docs/sdlc/INDEX.md");
  writeText(out, renderIndex(listPlans(ctx)));
  return { message: `Rendered ${out}.` };
}

// plugins/cairn/cli/src/commands/suggest.ts
var list = (v) => typeof v === "string" ? v.split("\n").filter(Boolean) : [];
var MAX_DECLINES = 2;
var MAX_AGE_DAYS = 60;
var MAX_OPEN_PER_PLAN = 5;
var isMarker = (x) => !!x.resolves || !!x.declines;
function allStates(ctx) {
  const out = /* @__PURE__ */ new Map();
  for (const r of listPlans(ctx)) out.set(r.state.slug, r.state);
  const dir = join10(ctx.top, PLANS_DIR);
  if (existsSync6(dir))
    for (const name of readdirSync2(dir)) {
      const raw = readText(join10(dir, name, "state.json"));
      if (raw === void 0) continue;
      try {
        const s = parseState(raw);
        if (!out.has(s.slug)) out.set(s.slug, s);
      } catch {
      }
    }
  return [...out.values()];
}
function collectSuggestions(ctx, at = Date.now()) {
  const states = allStates(ctx);
  const all = states.flatMap((s) => s.suggestions ?? []);
  const closed = new Set(all.map((x) => x.resolves).filter((r) => !!r));
  const merged = new Set(all.flatMap((x) => x.merges ?? []));
  const declines = /* @__PURE__ */ new Map();
  for (const x of all) if (x.declines) declines.set(x.declines, (declines.get(x.declines) ?? 0) + 1);
  return states.flatMap(
    (s) => (s.suggestions ?? []).filter((x) => !isMarker(x)).map((x) => {
      const key = `${s.slug}:${x.id}`;
      const declined = declines.get(key) ?? 0;
      const old = at - Date.parse(x.at) > MAX_AGE_DAYS * 864e5;
      const status = closed.has(key) ? "closed" : merged.has(key) ? "merged" : declined >= MAX_DECLINES || old ? "expired" : "open";
      return { ...x, slug: s.slug, key, open: status === "open", status, declined };
    })
  );
}
function openSuggestionCount(ctx) {
  try {
    return collectSuggestions(ctx).filter((x) => x.open).length;
  } catch {
    return 0;
  }
}
var USAGE = "usage: cairn suggest add --area <a> [--where <glob>]... (--text <t> | --text-file <f>) [--from <f>] | list [--open] [--for <glob>]... [--json] | resolve <slug>:<id> [--dismiss] [--note <t>] | merge <key> <key>... --area <a> [--where <glob>]... --text <t> | decline <key>...";
function cmdSuggest(ctx, action, arg, opts, more = []) {
  if (action === "add") return suggestAdd(ctx, opts);
  if (action === "list") return suggestList(ctx, opts);
  if (action === "resolve") return suggestResolve(ctx, arg, opts);
  if (action === "merge") return suggestMerge(ctx, [arg, ...more].filter((k) => !!k), opts);
  if (action === "decline") return suggestDecline(ctx, [arg, ...more].filter((k) => !!k));
  throw new CliError(USAGE);
}
function suggestAdd(ctx, opts) {
  const area = String(opts.area ?? "");
  if (!SUGGESTION_AREAS.includes(area)) throw new CliError(`--area must be one of ${SUGGESTION_AREAS.join(", ")}`);
  const from = String(opts.from ?? "implementer");
  if (!SUGGESTION_SOURCES.includes(from)) throw new CliError(`--from must be one of ${SUGGESTION_SOURCES.join(", ")}`);
  const text = typeof opts.text === "string" ? opts.text.trim() : "";
  if (!text) throw new CliError("--text or --text-file is required");
  const pc = planCtx(ctx);
  return mutate(pc, void 0, (s) => {
    const all = s.suggestions ??= [];
    const id = `s${all.length + 1}`;
    all.push({ id, area, text, where: list(opts.where), from, at: now() });
    return { message: `${s.slug}:${id}`, data: { id, key: `${s.slug}:${id}` } };
  });
}
function suggestList(ctx, opts) {
  const forGlobs = list(opts.for);
  const rows = collectSuggestions(ctx).filter((x) => (!opts.open || x.open) && (!forGlobs.length || x.where.length > 0 && scopesOverlap(forGlobs, x.where)));
  const lines = [];
  for (const area of SUGGESTION_AREAS)
    for (const x of rows.filter((r) => r.area === area))
      lines.push(`- [${area}] ${x.text} (${x.key}, noted ${x.at.slice(0, 10)})${x.where.length ? ` \u2014 ${x.where.join(", ")}` : ""}${x.open ? "" : ` [${x.status}]`}`);
  return {
    message: lines.length ? lines.join("\n") : opts.open ? "No open suggestions." : "No suggestions.",
    data: { suggestions: rows, open: rows.filter((x) => x.open).length }
  };
}
function suggestResolve(ctx, key, opts) {
  if (!key || !/^[a-z0-9-]+:s\d+$/.test(key)) throw new CliError(USAGE);
  const target = collectSuggestions(ctx).find((x) => x.key === key);
  if (!target) throw new Refusal(`no suggestion ${key}`, ["cairn suggest list"]);
  const pc = planCtx(ctx);
  return mutate(pc, void 0, (s) => {
    const all = s.suggestions ??= [];
    all.push({
      id: `s${all.length + 1}`,
      area: target.area,
      text: `${opts.dismiss ? "Dismissed" : "Resolved"} ${key}`,
      where: target.where,
      from: "user",
      at: now(),
      resolves: key,
      ...opts.dismiss ? { dismissed: true } : {},
      ...opts.note ? { note: String(opts.note) } : {}
    });
    return { message: `${opts.dismiss ? "Dismissed" : "Resolved"} ${key}.` };
  });
}
var KEY = /^[a-z0-9-]+:s\d+$/;
function openTargets(ctx, keys) {
  if (!keys.length || keys.some((k) => !KEY.test(k))) throw new CliError(USAGE);
  const all = collectSuggestions(ctx);
  return keys.map((k) => {
    const t = all.find((x) => x.key === k);
    if (!t) throw new Refusal(`no suggestion ${k}`, ["cairn suggest list"]);
    if (!t.open) throw new Refusal(`${k} is already ${t.status}`);
    return t;
  });
}
function suggestMerge(ctx, keys, opts) {
  if (new Set(keys).size < 2) throw new CliError("merge needs at least two different follow-ups");
  const area = String(opts.area ?? "");
  if (!SUGGESTION_AREAS.includes(area)) throw new CliError(`--area must be one of ${SUGGESTION_AREAS.join(", ")}`);
  const text = typeof opts.text === "string" ? opts.text.trim() : "";
  if (!text) throw new CliError("--text or --text-file is required");
  const targets = openTargets(ctx, [...new Set(keys)]);
  const where = list(opts.where).length ? list(opts.where) : [...new Set(targets.flatMap((t) => t.where))];
  const pc = planCtx(ctx);
  return mutate(pc, void 0, (s) => {
    const all = s.suggestions ??= [];
    const id = `s${all.length + 1}`;
    all.push({ id, area, text, where, from: "plan", at: now(), merges: targets.map((t) => t.key) });
    return { message: `Merged ${targets.length} into ${s.slug}:${id}.`, data: { id, key: `${s.slug}:${id}` } };
  });
}
function suggestDecline(ctx, keys) {
  const targets = openTargets(ctx, [...new Set(keys)]);
  const pc = planCtx(ctx);
  return mutate(pc, void 0, (s) => {
    const all = s.suggestions ??= [];
    for (const t of targets) all.push({ id: `s${all.length + 1}`, area: t.area, text: `Declined ${t.key}`, where: t.where, from: "user", at: now(), declines: t.key });
    const expired = targets.filter((t) => t.declined + 1 >= MAX_DECLINES);
    return { message: `Declined ${targets.length}.${expired.length ? ` Now expired: ${expired.map((t) => t.key).join(", ")}.` : ""}` };
  });
}

// plugins/cairn/cli/src/commands/stages.ts
var STAGE_ORDER = {
  feature: STAGES.filter((x) => x !== "repro"),
  fix: ["repro", "execute", "review", "ship", "closed"]
};
var nextStage = (s) => {
  const order = STAGE_ORDER[fastLane(s) ? "fix" : "feature"];
  return order[order.indexOf(s.stage) + 1];
};
function fixRecordProblems(pc) {
  const md = readText(planFile(pc, "RECORD.md"));
  const p = docProblems(md, "RECORD.md", FIX_RECORD_SECTIONS);
  const n = md ? proseWordCount(md) : 0;
  if (n > FIX_RECORD_WORD_BUDGET) p.push(`RECORD.md is ${n} words; the budget is ${FIX_RECORD_WORD_BUDGET}`);
  return p;
}
var recordCheck = (pc, track) => track === "fix" ? { problems: fixRecordProblems(pc), fix: "write RECORD.md from templates/record-fix.md" } : { problems: recordProblems(pc), fix: "write RECORD.md from templates/record.md" };
function closeGates(pc, s, opts, record, tests) {
  configGate(s, pc.cfg, "close", opts);
  const open = collectSuggestions(pc.ctx).filter((x) => x.open && x.slug === s.slug);
  gate(
    open.length <= MAX_OPEN_PER_PLAN,
    s,
    "close",
    opts,
    `${open.length} open follow-ups from this plan; at most ${MAX_OPEN_PER_PLAN} may stay open: ${open.map((x) => `${x.key} (${x.text})`).join("; ")}`,
    ['group related ones: cairn suggest merge <key>... --area <a> --text "<high-level item>"', 'drop trivia: cairn suggest resolve <key> --dismiss --note "<reason>"', "then list what was dropped in the record"]
  );
  gate(!record.problems.length, s, "close", opts, record.problems.join("; "), [record.fix]);
  testsGate(tests, s, "close", opts);
}
function prdProblems(md) {
  const problems = docProblems(md, "prd.md", PRD_SECTIONS);
  const open = uncheckedItems(md ? sections(md).get("open questions") : "");
  if (open.length) problems.push(`prd.md has ${open.length} open question(s): ${open.join(" | ")}`);
  return problems;
}
var firstSentence = (text = "") => text.replace(/\s+/g, " ").trim().match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text.trim();
function prdSummary(md) {
  const sec = sections(md);
  const reqs = (sec.get("requirements") ?? "").split("\n").filter((l) => /\bFR-\d+\b/.test(l)).map((l) => `- ${l.replace(/^\s*[-*]\s+/, "").replace(/\*\*/g, "").split(/Check:/)[0].trim()}`);
  return [firstSentence(sec.get("problem")), "", "**Requirements**", ...reqs, "", "**Non-goals**", sec.get("non-goals") ?? ""].join("\n").trim();
}
function planSummary(s) {
  return s.phases.flatMap((ph, i) => [`${i + 1}. **${ph.name}**`, ...ph.tasks.map((t) => `   - ${t.name} (${t.complexity})${t.risky ? " risky" : ""}`)]).join("\n");
}
function readyFor(pc) {
  try {
    const s = loadState(pc.plan.dir);
    const file = (name) => join11(pc.plan.dir, name);
    const pcLike = pc;
    if (s.stage === "prd" && !s.approvals.prd) {
      const md = readText(file("prd.md"));
      return md && !prdProblems(md).length ? { kind: "prd", file: file("prd.md"), summary: prdSummary(md) } : void 0;
    }
    if (s.stage === "plan" && !s.approvals.plan) {
      const md = readText(file("plan.md"));
      return s.phases.length && md && s.planHash === hashText(md) ? { kind: "plan", file: file("plan.md"), summary: planSummary(s) } : void 0;
    }
    if (s.stage === "ship" && !s.approvals.ship && s.evidence.review?.result === "pass") {
      if (recordCheck(pcLike, fastLane(s) ? "fix" : "feature").problems.length) return void 0;
      const md = readText(file("RECORD.md")) ?? "";
      return { kind: "ship", file: file("RECORD.md"), summary: (sections(md).get("what was built") ?? "").trim() };
    }
  } catch {
  }
  return void 0;
}
var APPROVAL_KINDS = ["prd", "plan", "ship"];
var APPROVE_USAGE = 'usage: cairn approve prd|plan|ship [--human] [--note "\u2026"]';
function cmdApprove(ctx, kind, opts, io) {
  if (!kind || !APPROVAL_KINDS.includes(kind)) throw new CliError(APPROVE_USAGE);
  const pc = planCtx(ctx);
  const source = requireHumanProof(kind, opts, io);
  const approval = () => ({ at: now(), via: "human", source, ...opts.note ? { note: String(opts.note) } : {} });
  switch (kind) {
    case "prd": {
      const md = readText(planFile(pc, "prd.md"));
      return mutate(pc, "PRD approved", (s) => {
        gate(s.stage === "prd", s, "approve prd", opts, `the plan is in ${s.stage}, not prd`);
        const problems = prdProblems(md);
        gate(!problems.length, s, "approve prd", opts, problems.join("; "), ["finish prd.md, resolving open questions with the user"]);
        s.approvals.prd = { ...approval(), hash: md ? hashText(md) : void 0 };
        log(s, "PRD approved", source);
        return { message: "PRD approved. Next: `cairn advance` to planning." };
      });
    }
    case "plan": {
      const md = readText(planFile(pc, "plan.md"));
      return mutate(pc, "plan approved", (s) => {
        if (s.stage !== "plan" && s.configHash && s.configHash !== configHash(pc.cfg)) {
          s.configHash = configHash(pc.cfg);
          log(s, "commands re-approved", source);
          return { message: "The changed setup, test, and build commands are approved." };
        }
        gate(s.stage === "plan", s, "approve plan", opts, `the plan is in ${s.stage}, not plan`);
        gate(s.phases.length > 0, s, "approve plan", opts, "no plan is loaded", ["cairn plan load"]);
        gate(!!md && s.planHash === hashText(md), s, "approve plan", opts, "plan.md changed since it was loaded", ["cairn plan load"]);
        s.approvals.plan = { ...approval(), hash: s.planHash };
        s.configHash = configHash(pc.cfg);
        log(s, "plan approved", source);
        return { message: "Plan approved. Next: `cairn advance` to execution." };
      });
    }
    case "ship":
      return mutate(pc, "ship approved", (s) => {
        gate(s.stage === "ship", s, "approve ship", opts, `the plan is in ${s.stage}, not ship`);
        gate(s.evidence.review?.result === "pass", s, "approve ship", opts, "review has not passed", ["run the review procedure, then cairn evidence review pass"]);
        const record = recordCheck(pc, fastLane(s) ? "fix" : "feature");
        gate(!record.problems.length, s, "approve ship", opts, record.problems.join("; "), [record.fix]);
        s.approvals.ship = approval();
        log(s, "ship approved", source);
        return { message: "Ship approved. Next: open the PR, then `cairn advance`." };
      });
    default:
      throw new CliError(APPROVE_USAGE);
  }
}
function cmdAdvance(ctx, opts) {
  const pc = planCtx(ctx);
  const decisions = readText(planFile(pc, "decisions.md")) ?? "";
  const pre = loadState(pc.plan.dir);
  const closing = fastLane(pre) && pre.stage === "ship";
  if (closing) configGate(pre, pc.cfg, "close", opts);
  const record = closing ? recordCheck(pc, "fix") : void 0;
  const tests = closing ? runTests(pc.cfg, pc.plan.worktree) : void 0;
  let to;
  const r = mutate(pc, void 0, (s) => {
    to = nextStage(s);
    if (!to || s.stage === "learn") throw new Refusal(s.stage === "learn" ? "use `cairn close` to finish the plan" : "the plan is closed");
    if (typeof opts.to === "string" && opts.to !== to) throw new Refusal(`the next stage after ${s.stage} is ${to}, not ${opts.to}`);
    if (s.paused) throw new Refusal("the plan is paused", ["cairn resume"]);
    switch (s.stage) {
      case "repro":
        if (!s.repro) throw new Refusal("no repro is recorded", ['cairn repro "<command that fails while the bug is present>"']);
        s.phases = [{ id: "fix", name: "Fix", status: "pending", tasks: [{ id: "fix", name: "Fix", covers: [], blockedBy: [], scope: ["**"], complexity: "standard", status: "pending", fixRound: 0 }] }];
        break;
      case "discover":
        gate(/^### /m.test(decisions), s, "advance", opts, "no decisions recorded yet", ['cairn decide "<question>" "<answer>"']);
        break;
      case "prd":
        gate(!!s.approvals.prd, s, "advance", opts, "the PRD is not approved", ["cairn approve prd"]);
        break;
      case "plan":
        gate(!!s.approvals.plan && s.phases.length > 0, s, "advance", opts, "the plan is not approved", ["cairn approve plan"]);
        break;
      case "execute":
        gate(s.phases.every((p) => p.status === "done"), s, "advance", opts, "not every phase is finished", ["cairn phase finish"]);
        break;
      case "verify":
        gate(s.evidence.verify?.result === "pass", s, "advance", opts, "verification has not passed", ['cairn evidence verify pass --note "\u2026"']);
        break;
      case "review":
        gate(s.evidence.review?.result === "pass" && !s.evidence.review.blocking, s, "advance", opts, "review has not passed with zero blocking findings", ["cairn evidence review pass --blocking 0"]);
        break;
      case "ship":
        gate(!!s.approvals.ship, s, "advance", opts, "shipping is not approved", ["cairn approve ship"]);
        if (record) closeGates(pc, s, opts, record, tests);
        break;
    }
    s.stage = to;
    if (to === "execute") {
      const p = currentPhase(s);
      if (p && p.status === "pending") p.status = "in_progress";
    }
    log(s, "advanced", to);
    if (to === "closed") return { message: `Closed "${s.title}". The record is ${join11(pc.plan.dir, "RECORD.md")}.` };
    return { message: `Moved to ${to}. ${nextFor(s).text}` };
  });
  if (pc.cfg.autoCommit) commitPath(pc.plan.worktree, planRelOf(pc.plan), `cairn(${pc.plan.slug}): advance to ${to}`);
  return r;
}
function cmdClose(ctx, opts) {
  const pc = planCtx(ctx);
  configGate(loadState(pc.plan.dir), pc.cfg, "close", opts);
  const record = recordCheck(pc, "feature");
  const tests = runTests(pc.cfg, pc.plan.worktree);
  return mutate(pc, "closed", (s) => {
    gate(s.stage === "learn", s, "close", opts, `the plan is in ${s.stage}, not learn`);
    closeGates(pc, s, opts, record, tests);
    s.stage = "closed";
    log(s, "closed");
    return { message: `Closed "${s.title}". The record is ${join11(pc.plan.dir, "RECORD.md")}.` };
  });
}

// plugins/cairn/cli/src/plan-parse.ts
var import_yaml = __toESM(require_dist(), 1);
var BLOCK = /```ya?ml\s+cairn-tasks\s*\n([\s\S]*?)```/;
var COMPLEXITY = ["simple", "standard", "complex"];
var KINDS = ["prefactor"];
var strList = (v) => Array.isArray(v) && v.every((x) => typeof x === "string") ? v : void 0;
function parsePlan(planMd, prdMd) {
  const problems = [];
  const missing = missingSections(planMd, PLAN_SECTIONS);
  if (missing.length) problems.push(`plan.md is missing sections: ${missing.join(", ")}`);
  const block = planMd.match(BLOCK)?.[1];
  if (!block) return { phases: [], problems: [...problems, "plan.md has no ```yaml cairn-tasks block under ## Phases"] };
  let doc;
  try {
    doc = (0, import_yaml.parse)(block);
  } catch (e) {
    return { phases: [], problems: [...problems, `cairn-tasks YAML does not parse: ${e.message}`] };
  }
  const rawPhases = doc?.phases;
  if (!Array.isArray(rawPhases) || rawPhases.length === 0)
    return { phases: [], problems: [...problems, "cairn-tasks needs a non-empty `phases:` list"] };
  const prdSections = sections(prdMd);
  const requirements = prdSections.get("requirements") ?? prdSections.get("functional requirements");
  const prdIds = new Set(ids(requirements));
  problems.push(...badRequirementIds(requirements));
  const phases = [];
  const phaseOf = /* @__PURE__ */ new Map();
  const seenPhase = /* @__PURE__ */ new Set();
  rawPhases.forEach((rp, pi) => {
    const pid = String(rp?.id ?? "");
    if (!SLUG.test(pid)) problems.push(`phase #${pi + 1}: id "${pid}" must be kebab-case`);
    if (seenPhase.has(pid)) problems.push(`phase id "${pid}" is used twice`);
    seenPhase.add(pid);
    const tasks = [];
    if (!Array.isArray(rp?.tasks) || rp.tasks.length === 0) problems.push(`phase "${pid}" has no tasks`);
    for (const rs of rp?.tasks ?? []) {
      const sid = String(rs?.id ?? "");
      const where = `task "${sid}"`;
      if (!SLUG.test(sid)) problems.push(`${where}: id must be kebab-case`);
      if (phaseOf.has(sid)) problems.push(`${where}: id is used twice`);
      phaseOf.set(sid, pi);
      const covers = strList(rs?.covers) ?? [];
      const blockedBy = strList(rs?.blocked_by ?? []) ?? [];
      const scope = strList(rs?.scope) ?? [];
      const complexity = rs?.complexity ?? "standard";
      const kind = rs?.kind === void 0 ? void 0 : String(rs.kind);
      if (kind !== void 0 && !KINDS.includes(kind)) problems.push(`${where}: kind must be ${KINDS.join(" or ")}, or left out`);
      if (!covers.length && kind !== "prefactor") problems.push(`${where}: \`covers\` must list the PRD FR ids it implements (only kind: prefactor may leave it empty)`);
      for (const c of covers) if (!prdIds.has(c)) problems.push(`${where}: covers ${c}, which is not in the PRD's Requirements`);
      if (!scope.length) problems.push(`${where}: \`scope\` must list the file globs it may touch`);
      if (!COMPLEXITY.includes(complexity)) problems.push(`${where}: complexity must be simple, standard, or complex`);
      const risky = rs?.risky === true;
      if (rs?.risky !== void 0 && typeof rs.risky !== "boolean") problems.push(`${where}: risky must be true or false`);
      const riskReason = typeof rs?.riskReason === "string" && rs.riskReason.trim() ? rs.riskReason.trim() : void 0;
      tasks.push({ id: sid, name: String(rs?.name ?? sid), ...kind === "prefactor" ? { kind } : {}, covers, blockedBy, scope, complexity, status: "pending", fixRound: 0, risky, ...risky && riskReason ? { riskReason } : {} });
    }
    phases.push({ id: pid, name: String(rp?.name ?? pid), status: "pending", tasks });
  });
  const all = phases.flatMap((p) => p.tasks);
  for (const [pi, p] of phases.entries())
    for (const s of p.tasks)
      for (const b of s.blockedBy) {
        if (!phaseOf.has(b)) problems.push(`task "${s.id}": blocked_by "${b}" is not a task in this plan`);
        else if (phaseOf.get(b) > pi) problems.push(`task "${s.id}": blocked_by "${b}" is in a later phase`);
      }
  const cycle = findCycle(all);
  if (cycle) problems.push(`blocked_by has a cycle: ${cycle.join(" \u2192 ")}`);
  const covered = new Set(all.flatMap((s) => s.covers));
  const deferred = new Set(ids(sections(planMd).get("deferred requirements")));
  const uncovered = [...prdIds].filter((id) => !covered.has(id) && !deferred.has(id));
  if (uncovered.length)
    problems.push(`PRD requirements not covered by any task: ${uncovered.join(", ")}. Cover them or list them under ## Deferred requirements`);
  return { phases, problems };
}
function badRequirementIds(requirements = "") {
  const bad = /* @__PURE__ */ new Set();
  for (const m of requirements.matchAll(/\*\*([^*]+)\*\*/g)) {
    const id = m[1].trim().split(/\s+/)[0].replace(/[.:,;]+$/, "");
    if (/^fr[-_\d]/i.test(id) && !/^FR-\d+$/.test(id)) bad.add(id);
  }
  return [...bad].map((id) => `PRD requirement id "${id}" must have the form FR-<digits>`);
}
function findCycle(tasks) {
  const deps = new Map(tasks.map((s) => [s.id, s.blockedBy]));
  const state = /* @__PURE__ */ new Map();
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 1);
    stack.push(id);
    for (const d of deps.get(id) ?? []) {
      const c = visit(d);
      if (c) return c;
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const s of tasks) {
    const c = visit(s.id);
    if (c) return c;
  }
}
function mergeProgress(next, prev) {
  const old = new Map(prev.flatMap((p) => p.tasks).map((s) => [s.id, s]));
  const kept = /* @__PURE__ */ new Set();
  for (const p of next)
    for (const [i, s] of p.tasks.entries()) {
      const o = old.get(s.id);
      if (!o) continue;
      kept.add(s.id);
      p.tasks[i] = { ...s, status: o.status, substep: o.substep, fixRound: o.fixRound, branch: o.branch, worktree: o.worktree, base: o.base, tip: o.tip, tests: o.tests, testedCommit: o.testedCommit, doneAt: o.doneAt, startedAt: o.startedAt, note: o.note };
    }
  const lostDone = [...old.values()].filter((s) => s.status !== "pending" && !kept.has(s.id)).map((s) => s.id);
  for (const p of next) p.status = phaseStatus(p, prev.find((q) => q.id === p.id)?.status);
  return { phases: next, lostDone };
}
function phaseStatus(p, prior) {
  if (p.tasks.every((s) => s.status === "done")) return prior === "done" ? "done" : "awaiting_approval";
  if (p.tasks.some((s) => s.status !== "pending") || prior === "in_progress") return "in_progress";
  return "pending";
}

// plugins/cairn/cli/src/commands/planload.ts
function cmdPlanLoad(ctx, opts) {
  const pc = planCtx(ctx);
  const planMd = readText(planFile(pc, "plan.md"));
  const prdMd = readText(planFile(pc, "prd.md")) ?? "";
  if (!planMd) throw new Refusal("plan.md does not exist", ["write it from templates/plan.md"]);
  const parsed = parsePlan(planMd, prdMd);
  if (parsed.problems.length) throw new Refusal(`plan.md is not loadable:
  - ${parsed.problems.join("\n  - ")}`, ["fix plan.md, then cairn plan load"]);
  return mutate(pc, "plan loaded", (s) => {
    const replanning = s.stage !== "plan";
    if (replanning && !opts.replan) throw new Refusal(`the plan is in ${s.stage}; changing it mid-flight is a re-plan`, ["cairn plan load --replan"]);
    if (!["plan", "execute", "verify", "review"].includes(s.stage)) throw new Refusal(`a plan can't be loaded in ${s.stage}`);
    const dropsFix = s.log.some((l) => l.event === "escalated") && allTasks(s).some((x) => x.id === "fix") && !parsed.phases.some((p) => p.tasks.some((x) => x.id === "fix"));
    if (dropsFix) throw new Refusal('the new plan drops the "fix" task that escalate kept', ['keep a task with id "fix" in plan.md']);
    const { phases, lostDone } = mergeProgress(parsed.phases, s.phases);
    if (lostDone.length) throw new Refusal(`the new plan drops tasks that already started or finished: ${lostDone.join(", ")}`, ["keep them in plan.md"]);
    s.phases = phases;
    s.planHash = hashText(planMd);
    if (replanning) {
      s.stage = "plan";
      delete s.approvals.plan;
      delete s.evidence.verify;
      delete s.evidence.review;
      for (const p of s.phases) delete p.verdict;
      log(s, "re-plan loaded", `${allTasks(s).length} tasks`);
    } else log(s, "plan loaded", `${s.phases.length} phases, ${allTasks(s).length} tasks`);
    return {
      message: `Loaded ${s.phases.length} phases and ${allTasks(s).length} tasks.${replanning ? " The plan needs approval again." : ""} Next: approve the plan with the user.`,
      data: { phases: s.phases.map((p) => ({ id: p.id, name: p.name, tasks: p.tasks.map((x) => x.id) })) }
    };
  });
}

// plugins/cairn/cli/src/commands/tasks.ts
import { existsSync as existsSync7 } from "node:fs";
import { basename as basename2, join as join12 } from "node:path";
var MAX_FIX_ROUNDS = 2;
var DEFAULT_FIX_MAX_FILES = 8;
function cmdReady(ctx) {
  const pc = planCtx(ctx);
  const s = loadState(pc.plan.dir);
  const r = readySet(s, pc.cfg.maxParallel);
  const tier = { simple: "haiku", standard: "sonnet", complex: "opus" };
  const lines = [
    r.phase ? `Phase "${r.phase.name}": ${r.ready.length} ready, ${r.inProgress.length} running, ${r.waiting.length} waiting.` : "No phase in progress.",
    ...r.ready.map((x) => `  ready: ${x.id} (${x.name}) model=${tier[x.complexity]}`),
    ...r.inProgress.map((x) => `  running: ${x.id} (${x.substep ?? "implementing"}${x.fixRound ? `, fix attempt ${x.fixRound}` : ""}) at ${x.worktree}`),
    ...r.waiting.map((w) => `  waiting: ${w.task.id} on ${w.on.join(", ")}`)
  ];
  if (s.paused) lines.unshift("The plan is paused: start nothing new.");
  return {
    message: lines.join("\n"),
    data: {
      paused: !!s.paused,
      phase: r.phase?.id,
      phaseStatus: r.phase?.status,
      ready: r.ready.map((x) => ({ ...x, model: tier[x.complexity] })),
      inProgress: r.inProgress,
      waiting: r.waiting.map((w) => ({ id: w.task.id, on: w.on }))
    }
  };
}
function cmdTask(ctx, action, id, rest, opts) {
  if (!id) throw new CliError("usage: cairn task start|step|done <task-id> \u2026");
  const pc = planCtx(ctx);
  if (action === "start") return taskStart(pc, id, opts);
  if (action === "step") return taskStep(pc, id, rest[0], opts);
  if (action === "done") return taskDone(pc, id, opts);
  throw new CliError("usage: cairn task start|step|done <task-id>");
}
function taskStart(pc, id, opts) {
  const { plan, ctx, cfg } = pc;
  const r = mutate(pc, void 0, (s) => {
    const branch = taskBranch(plan.slug, id);
    const path = join12(worktreeRoot(cfg, ctx.mainRoot), `${basename2(plan.worktree)}--${id}`);
    const pb = s.branch;
    const sl = findTask(s, id);
    if (!sl) throw new Refusal(`no task "${id}" in this plan`, ["cairn ready"]);
    if (sl.status === "in_progress") return { message: `Task "${sl.name}" is already running (${sl.substep}) at ${sl.worktree}.`, data: { worktree: sl.worktree, branch: sl.branch, resumed: true } };
    if (sl.status === "done" && fastLane(s) && s.stage === "review") {
      sl.status = "pending";
      s.phases.find((p) => p.tasks.includes(sl)).status = "in_progress";
      s.stage = "execute";
      delete s.evidence.review;
      log(s, "fix reopened", "from review");
    }
    if (sl.status === "done") throw new Refusal(`task "${sl.name}" is already done`);
    gate(s.stage === "execute" && !s.paused, s, "task start", opts, s.paused ? "the plan is paused" : `the plan is in ${s.stage}, not execute`);
    configGate(s, cfg, "task start", opts);
    const ready = readySet(s, cfg.maxParallel);
    const waiting = ready.waiting.find((w) => w.task.id === id);
    gate(ready.ready.some((x) => x.id === id), s, "task start", opts, waiting ? `task "${sl.name}" is waiting on ${waiting.on.join(", ")}` : `task "${sl.name}" is not in the current phase`, ["cairn ready"]);
    const base = git(["rev-parse", pb], plan.worktree);
    let setup = "";
    if (!existsSync7(path)) {
      if (branchExists(branch, plan.worktree)) git(["worktree", "add", "-q", path, branch], plan.worktree);
      else git(["worktree", "add", "-q", "-b", branch, path, pb], plan.worktree);
      setup = runSetup(cfg, path, ctx.mainRoot);
    }
    Object.assign(sl, { status: "in_progress", substep: "implementing", fixRound: 0, branch, worktree: path, base: sl.base ?? base, startedAt: sl.startedAt ?? now() });
    const phase = s.phases.find((p) => p.tasks.includes(sl));
    if (phase.status === "pending") phase.status = "in_progress";
    log(s, "task started", sl.name);
    return { message: `Started task "${sl.name}" in ${path} (branch ${branch}).${setup}`, data: { worktree: path, branch, planBranch: pb } };
  });
  ensureExcluded(ctx.mainRoot, ".claude/worktrees/");
  return r;
}
function taskStep(pc, id, step, opts) {
  if (!SUBSTEPS.includes(step)) throw new CliError(`usage: cairn task step <id> ${SUBSTEPS.join("|")}`);
  return mutate(pc, void 0, (s) => {
    const sl = findTask(s, id);
    if (!sl || sl.status !== "in_progress") throw new Refusal(`task "${id}" is not running`, ["cairn task start " + id]);
    if (step === "fixing") {
      gate(sl.fixRound < MAX_FIX_ROUNDS, s, "task fix round", opts, `task "${sl.name}" has used ${MAX_FIX_ROUNDS} fix attempts`, ["stop and ask the user: split the task, re-plan, or take it over"]);
      sl.fixRound++;
    }
    sl.substep = step;
    if (opts.note) sl.note = String(opts.note);
    log(s, `task ${step}`, `${sl.name}${step === "fixing" ? ` (attempt ${sl.fixRound})` : ""}${opts.note ? `: ${opts.note}` : ""}`);
    return { message: `Task "${sl.name}": ${step}${step === "fixing" ? `, attempt ${sl.fixRound} of ${MAX_FIX_ROUNDS}` : ""}.` };
  });
}
function taskDone(pc, id, opts) {
  const { plan } = pc;
  const pre = loadState(plan.dir);
  const sl = findTask(pre, id);
  if (!sl) throw new Refusal(`no task "${id}" in this plan`);
  if (sl.status !== "in_progress" || !sl.branch) throw new Refusal(`task "${sl.name}" is not running`);
  const pb = pre.branch;
  configGate(pre, pc.cfg, "task done", opts);
  const merged = branchExists(sl.branch, plan.worktree) && gitOk(["merge-base", "--is-ancestor", sl.branch, pb], plan.worktree);
  const dirty = sl.worktree && existsSync7(sl.worktree) ? git(["status", "--porcelain"], sl.worktree) : "";
  const tip = branchExists(sl.branch, plan.worktree) ? git(["rev-parse", "--short", sl.branch], plan.worktree) : void 0;
  const commits = tip && sl.base ? Number(git(["rev-list", "--count", `${sl.base}..${sl.branch}`], plan.worktree)) : 0;
  const planDirty = git(["status", "--porcelain", "--", ".", `:!${planRelOf(plan)}`], plan.worktree);
  const checkable = merged && !dirty && !planDirty;
  const tests = checkable ? runTests(pc.cfg, plan.worktree) : void 0;
  const testedCommit = tests ? git(["rev-parse", "HEAD"], plan.worktree) : void 0;
  const fix = fastLane(pre);
  const repro = fix && merged && pre.repro ? runRepro(pre.repro.cmd, plan.worktree, pc.cfg) : void 0;
  const heads = [pb, ...tip ? [sl.branch] : []];
  const changed = fix && sl.base ? new Set(heads.flatMap((h) => changedFiles(plan.worktree, plan.slug, sl.base, h))).size : 0;
  const outside = tip && sl.base ? changedFiles(plan.worktree, plan.slug, sl.base, sl.branch).filter((f) => !matchesAny(f, sl.scope)) : [];
  const maxFiles = pc.cfg.fixMaxFiles ?? DEFAULT_FIX_MAX_FILES;
  const r = mutate(pc, `task done: ${sl.name}`, (s) => {
    const cur = findTask(s, id);
    configGate(s, pc.cfg, "task done", opts);
    gate(!dirty, s, "task done", opts, `the task worktree has uncommitted changes`, [`commit or discard them in ${cur.worktree}`]);
    gate(commits > 0, s, "task done", opts, `${cur.branch} has no commits since the task started`, ["the implementer commits its work on the task branch, in the task worktree"]);
    gate(!planDirty, s, "task done", opts, `the plan worktree has uncommitted changes outside docs/sdlc: ${planDirty.split("\n").slice(0, 5).join(", ")}`, ["work belongs on task branches: move it into a task, or discard it"]);
    gate(merged, s, "task done", opts, `${cur.branch} is not merged into ${pb}`, [`git -C ${plan.worktree} merge --no-ff ${cur.branch}`]);
    testsGate(tests ?? (checkable ? void 0 : { ok: false, cmd: pc.cfg.test ?? "(none)", tail: "not run" }), s, "task done", opts);
    if (fix) {
      gate(repro?.outcome === "passes", s, "task done", opts, repro ? `the repro still fails (\`${s.repro?.cmd}\` \u2192 ${repro.detail})` : "the repro was not run: the task is not merged", ["fix the bug so the repro command exits 0"]);
      gate(changed <= maxFiles, s, "task done", opts, `the fix changed ${changed} files; a fix may change at most ${maxFiles}`, ["this is bigger than a fix: cairn escalate turns it into a feature plan, keeping the work"]);
    }
    for (const path of outside)
      if (!s.drift.some((d) => d.path === path && !d.acked)) {
        s.drift.push({ path, at: now(), reason: `changed outside task "${cur.name}" scope (found at task done)`, task: cur.id });
        log(s, "drift", path);
      }
    Object.assign(cur, { status: "done", substep: void 0, doneAt: now(), tip, tests: tests ? `${tests.cmd} \u2192 ${tests.tail}` : void 0, testedCommit: tests?.ok ? testedCommit : void 0 });
    const phase = s.phases.find((p) => p.tasks.some((x) => x.id === id));
    phase.status = phaseStatus(phase, phase.status);
    if (fastLane(s) && phase.status === "awaiting_approval") phase.status = "done";
    log(s, "task done", cur.name);
    const left = phase.tasks.filter((x) => x.status !== "done").length;
    return {
      message: `Task "${cur.name}" done${tests ? ` (tests: ${tests.tail})` : " (no test command configured: nothing was run)"}. ${left ? `${left} task(s) left in phase "${phase.name}".` : fastLane(s) ? "The fix is built: `cairn advance` to review." : `Phase "${phase.name}" is built: run \`cairn phase finish\`.`}`,
      data: { phaseComplete: !left }
    };
  });
  if (merged && sl.worktree && existsSync7(sl.worktree)) gitOk(["worktree", "remove", sl.worktree], plan.worktree);
  if (merged) gitOk(["branch", "-d", sl.branch], plan.worktree);
  return r;
}

// plugins/cairn/cli/src/commands/phase.ts
function newSuggestionsText(s) {
  const since = [...s.log].reverse().find((l) => l.event === "phase finished" || l.event === "advanced" && l.detail === "execute")?.at ?? s.created;
  const fresh = (s.suggestions ?? []).filter((x) => !x.resolves && !x.declines && x.at > since);
  if (!fresh.length) return "0 new suggestions";
  const by = /* @__PURE__ */ new Map();
  for (const x of fresh) by.set(x.area, (by.get(x.area) ?? 0) + 1);
  return `${fresh.length} new suggestion${fresh.length === 1 ? "" : "s"} (${[...by].map(([a, n]) => `${n} ${a}`).join(", ")})`;
}
function cmdPhase(ctx, action, opts) {
  if (action !== "finish") throw new CliError("usage: cairn phase finish");
  const pc = planCtx(ctx);
  const { plan } = pc;
  const pre = loadState(plan.dir);
  const phase = currentPhase(pre);
  if (pre.stage !== "execute" || !phase) throw new Refusal(`the plan is in ${pre.stage}, with no phase to finish`, ["cairn next"]);
  if (pre.paused) throw new Refusal("the plan is paused", ["cairn resume"]);
  const unfinished = phase.tasks.filter((x) => x.status !== "done");
  if (unfinished.length) throw new Refusal(`phase "${phase.name}" still has unfinished tasks: ${unfinished.map((x) => x.name).join(", ")}`, ["cairn ready"]);
  const blocked = phase.tasks.filter((x) => x.substep === "blocked");
  if (blocked.length) throw new Refusal(`blocked tasks: ${blocked.map((x) => x.name).join(", ")}`);
  const dirty = git(["status", "--porcelain", "--", ".", `:!${planRelOf(plan)}`], plan.worktree);
  if (dirty) throw new Refusal(`the plan worktree has uncommitted changes outside docs/sdlc: ${dirty.split("\n").slice(0, 5).join(", ")}`, ["work belongs on task branches: move it into a task, or discard it"]);
  const head = git(["rev-parse", "HEAD"], plan.worktree);
  const last = [...phase.tasks].filter((x) => x.testedCommit).sort((a, b) => (a.doneAt ?? "").localeCompare(b.doneAt ?? "")).pop();
  const reused = !!(last?.testedCommit && last.tests && gitOk(["diff", "--quiet", last.testedCommit, head, "--", ".", ":!docs/sdlc"], plan.worktree));
  const tests = reused ? void 0 : runTests(pc.cfg, plan.worktree);
  return mutate(pc, `phase finished: ${phase.name}`, (s) => {
    const cur = currentPhase(s);
    gate(cur.verdict?.result !== "red", s, "phase finish", opts, `the on-track check for "${cur.name}" is red${cur.verdict?.note ? ` (${cur.verdict.note})` : ""}`, ["fix what the report flags, then re-run `cairn evidence phase`"]);
    if (!reused) testsGate(tests, s, "phase finish", opts);
    const testText = reused ? `tests green (${last.tests.split(" \u2192 ").pop()})` : tests ? `tests ${tests.ok ? "green" : "RED"} (${tests.tail})` : "no test command";
    const suggestions = newSuggestionsText(s);
    const drift = s.drift.filter((d) => !d.acked);
    cur.status = "done";
    log(s, "phase finished", `${cur.name} (${testText})`);
    const following = currentPhase(s);
    let next;
    if (following) {
      following.status = "in_progress";
      next = `next phase "${following.name}"`;
    } else {
      s.stage = "verify";
      log(s, "advanced", "verify");
      next = "all phases done, moved to Check";
    }
    const driftText = drift.length ? `; ${drift.length} out-of-scope edit(s): ${drift.slice(0, 5).map((d) => d.path).join(", ")}` : "";
    return {
      message: `Phase "${cur.name}" finished: ${cur.tasks.length} tasks, ${testText}, ${suggestions}${driftText}; ${next}.`,
      data: { phase: cur.id, next: following?.id ?? null, stage: s.stage }
    };
  });
}

// plugins/cairn/cli/src/commands/records.ts
import { existsSync as existsSync8, readdirSync as readdirSync3 } from "node:fs";
import { basename as basename3, dirname as dirname3, join as join13 } from "node:path";
var DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})-/;
function whyLine(md) {
  const body = (md ? sections(md).get("why") ?? "" : "").replace(/<!--[\s\S]*?-->/g, "").trim();
  const para = body.split(/\n\s*\n/)[0]?.replace(/\s+/g, " ").trim() ?? "";
  return para.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? para;
}
function listRecords(ctx) {
  const main2 = dirname3(commonDir(ctx.top));
  const byMain = { ...ctx, top: main2 };
  const found = /* @__PURE__ */ new Map();
  for (const r of listPlans(ctx)) found.set(r.state.slug, { state: r.state, dir: r.dir });
  const base = join13(main2, PLANS_DIR);
  if (existsSync8(base))
    for (const name of readdirSync3(base)) {
      const raw = readText(join13(base, name, "state.json"));
      if (raw === void 0) continue;
      try {
        const state = parseState(raw);
        if (!found.has(state.slug)) found.set(state.slug, { state, dir: join13(base, name) });
      } catch {
      }
    }
  const followUps = /* @__PURE__ */ new Map();
  for (const x of collectSuggestions(byMain)) followUps.set(x.slug, [...followUps.get(x.slug) ?? [], { text: x.text, area: x.area, status: x.status }]);
  const entries = [...found.values()].map(({ state, dir }) => {
    let recordPath = join13(dir, "RECORD.md");
    if (!existsSync8(recordPath)) recordPath = join13(base, basename3(dir), "RECORD.md");
    const text = readText(recordPath);
    return {
      slug: state.slug,
      title: state.title,
      date: basename3(dir).match(DATE_PREFIX)?.[1] ?? state.created.slice(0, 10),
      stage: state.stage,
      why: whyLine(text),
      ...text !== void 0 ? { record: recordPath } : {},
      followUps: followUps.get(state.slug) ?? []
    };
  });
  const open = (e) => e.stage === "closed" ? 1 : 0;
  return entries.sort((a, b) => open(a) - open(b) || b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}
function cmdRecords(ctx) {
  const records = listRecords(ctx);
  const lines = records.map((r) => {
    const open = r.followUps.filter((f) => f.status === "open").length;
    return [
      `${r.date}  ${r.title} (${r.slug})${r.stage === "closed" ? "" : `  [in progress: ${r.stage}]`}`,
      ...r.why ? [`    ${r.why}`] : [],
      ...r.record ? [`    ${r.record}`] : [],
      ...r.followUps.length ? [`    ${r.followUps.length} follow-up(s), ${open} open`] : []
    ].join("\n");
  });
  return { message: lines.length ? lines.join("\n") : "No plans yet.", data: { records } };
}

// plugins/cairn/cli/src/direction.ts
var import_yaml2 = __toESM(require_dist(), 1);
var BLOCK2 = /```ya?ml[ \t]+cairn-direction[ \t]*\r?\n([\s\S]*?)```/g;
var VERDICTS = ["aligned", "partial", "missing", "contradicted"];
var CLASSES = ["pulled-forward", "unplanned", "non-goal-breach", "supporting"];
var PATH_LINE = /^\S.*:\d+(-\d+)?$/;
var empty = () => ({ requirements: [], unplanned: [], nfr: [] });
function parseScorecard(md) {
  const blocks = [...md.replace(/\r\n/g, "\n").matchAll(BLOCK2)];
  if (!blocks.length) return { rows: empty(), problems: ["the report has no ```yaml cairn-direction block"] };
  if (blocks.length > 1) return { rows: empty(), problems: ["the report has more than one cairn-direction block; keep exactly one"] };
  let doc;
  try {
    doc = (0, import_yaml2.parse)(blocks[0][1]);
  } catch (e) {
    return { rows: empty(), problems: [`cairn-direction YAML does not parse: ${e.message}`] };
  }
  const problems = [];
  const list2 = (key) => {
    const v = doc?.[key] ?? [];
    if (!Array.isArray(v)) {
      problems.push(`\`${key}\` must be a list`);
      return [];
    }
    return v;
  };
  const evidence = (label, r) => {
    if (typeof r?.evidence !== "string" || !PATH_LINE.test(r.evidence.trim())) problems.push(`${label}: evidence must be path:line (got ${JSON.stringify(r?.evidence)})`);
  };
  const rows = empty();
  for (const key of ["requirements", "nfr"])
    for (const r of list2(key)) {
      const label = `${key} row ${r?.id ?? "(no id)"}`;
      if (typeof r?.id !== "string" || !r.id) problems.push(`${label}: needs an id`);
      if (!VERDICTS.includes(r?.verdict)) problems.push(`${label}: verdict must be one of ${VERDICTS.join("|")}`);
      evidence(label, r);
      rows[key].push(r);
    }
  for (const r of list2("unplanned")) {
    const label = `unplanned row "${r?.what ?? "(no description)"}"`;
    if (typeof r?.what !== "string" || !r.what) problems.push(`${label}: needs \`what\``);
    if (!CLASSES.includes(r?.class)) problems.push(`${label}: class must be one of ${CLASSES.join("|")}`);
    evidence(label, r);
    rows.unplanned.push(r);
  }
  return { rows, problems };
}
function computeVerdict(rows) {
  const scored = [...rows.requirements, ...rows.nfr];
  if (scored.some((r) => r.verdict === "contradicted" || r.verdict === "missing") || rows.unplanned.some((u) => u.class === "non-goal-breach")) return "red";
  if (scored.some((r) => r.verdict === "partial") || rows.unplanned.some((u) => u.class !== "supporting")) return "yellow";
  return "green";
}

// plugins/cairn/cli/src/commands/evidence.ts
function cmdEvidencePhase(ctx, opts) {
  const pc = planCtx(ctx);
  return mutate(pc, "phase direction verdict", (s) => {
    const phase = currentPhase(s);
    if (s.stage !== "execute" || !phase || phase.status !== "awaiting_approval") throw new Refusal("no phase is built and waiting to finish", ["finish the phase's tasks first (cairn ready / cairn task done)"]);
    const rel = `direction/${phase.id}.md`;
    const md = readText(planFile(pc, rel));
    if (md === void 0) throw new Refusal(`${rel} does not exist`, ["run the direction check and write the report with a cairn-direction scorecard"]);
    const { rows, problems } = parseScorecard(md);
    const covered = [...new Set(phase.tasks.flatMap((x) => x.covers))];
    const have = new Set(rows.requirements.map((r) => r?.id));
    const missing = covered.filter((id) => !have.has(id));
    if (missing.length) problems.push(`no row for covered requirement(s): ${missing.join(", ")}`);
    if (problems.length) throw new Refusal(`${rel} is not a valid scorecard:
  - ${problems.join("\n  - ")}`);
    const result = computeVerdict(rows);
    const commit = git(["rev-parse", "HEAD"], pc.plan.worktree);
    phase.verdict = { result, at: now(), commit, ...opts.note ? { note: String(opts.note) } : {} };
    log(s, `direction ${result}`, phase.name);
    return { message: `Recorded the direction verdict for "${phase.name}": ${result} at ${commit.slice(0, 7)}.`, data: { verdict: result, commit } };
  });
}
function cmdEvidence(ctx, kind, result, opts) {
  if (kind === "phase") return cmdEvidencePhase(ctx, opts);
  if (kind !== "verify" && kind !== "review" || result !== "pass" && result !== "fail")
    throw new CliError('usage: cairn evidence verify|review pass|fail [--note "\u2026"] [--blocking N] | evidence phase [--note "\u2026"]');
  const pc = planCtx(ctx);
  return mutate(pc, `${kind} ${result}`, (s) => {
    gate(s.stage === kind, s, `evidence ${kind}`, opts, `the plan is in ${s.stage}, not ${kind}`);
    const blocking = opts.blocking !== void 0 ? Number(opts.blocking) : void 0;
    if (result === "pass" && blocking) throw new Refusal(`a review with ${blocking} blocking finding(s) can't pass`, ["fix them in place, then record the review with --blocking 0"]);
    s.evidence[kind] = { result, at: now(), ...opts.note ? { note: String(opts.note) } : {}, ...blocking !== void 0 ? { blocking } : {} };
    log(s, `${kind} ${result}`, opts.note ? String(opts.note) : void 0);
    return { message: `Recorded ${kind}: ${result}.` };
  });
}
function cmdDriftAck(ctx, path, opts) {
  if (!path && !opts.all) throw new CliError('usage: cairn drift ack <path>|--all [--note "\u2026"]');
  const pc = planCtx(ctx);
  return mutate(pc, void 0, (s) => {
    const hits = s.drift.filter((d) => !d.acked && (opts.all || d.path === path));
    if (!hits.length) throw new Refusal(`no unreviewed drift${path ? ` for ${path}` : ""}`);
    for (const d of hits) d.acked = { at: now(), ...opts.note ? { note: String(opts.note) } : {} };
    log(s, "drift reviewed", hits.map((d) => d.path).join(", "));
    return { message: `Marked ${hits.length} drift entr${hits.length === 1 ? "y" : "ies"} as reviewed.` };
  });
}

// plugins/cairn/cli/src/commands/pause.ts
import { join as join14 } from "node:path";
function cmdPause(ctx, opts) {
  const pc = planCtx(ctx);
  const md = readText(planFile(pc, "handoff.md"));
  return mutate(pc, "paused", (s) => {
    if (s.stage === "closed") throw new Refusal("the plan is closed");
    if (s.paused) throw new Refusal("the plan is already paused", ["cairn resume"]);
    const problems = docProblems(md, "handoff.md", HANDOFF_SECTIONS);
    const hash = md ? hashText(md) : void 0;
    const lastHash = [...s.log].reverse().find((l) => l.event === "paused")?.detail;
    if (hash && hash === lastHash) problems.push("handoff.md is unchanged since the last pause");
    gate(!problems.length, s, "pause", opts, problems.join("; "), ["write handoff.md from templates/handoff.md: what is in flight, open questions, the next action"]);
    s.paused = { at: now(), mode: opts.now ? "now" : "drain", handoffHash: hash };
    log(s, "paused", hash);
    return { message: `Paused "${s.title}". To pick up later: open Claude Code in this worktree and run /cairn:next (or /cairn:resume ${s.slug} from main).` };
  });
}
function cmdResume(ctx, slug, opts) {
  if (slug && ctx.plan?.slug !== slug) {
    const branch = planBranchesFor(slug, ctx.top)[0];
    if (!branch) throw new Refusal(`no plan named "${slug}"`, ["cairn status --all"]);
    const ref = planRef(slug, ctx.worktrees, branch);
    if (!ref.worktree) {
      const cfg = loadConfig(ctx.top, ctx.mainRoot);
      const wt = join14(worktreeRoot(cfg, ctx.mainRoot), worktreeName(branch));
      git(["worktree", "add", "-q", wt, branch], ctx.top);
      ensureExcluded(ctx.mainRoot, ".claude/worktrees/");
      ref.worktree = wt;
    }
    return {
      message: `Plan "${slug}" lives in ${ref.worktree}. Switch into it (EnterWorktree with that path, or \`cd ${ref.worktree} && claude\`), then run /cairn:resume.`,
      data: { slug, worktree: ref.worktree, switchRequired: true }
    };
  }
  const pc = planCtx(ctx);
  const wasPaused = !!loadState(pc.plan.dir).paused;
  const r = mutate(pc, wasPaused ? "resumed" : void 0, (s) => {
    if (s.paused) {
      log(s, "resumed", `paused since ${s.paused.at.slice(0, 10)}`);
      s.paused = null;
    }
    const next = nextFor(s);
    const running = allTasks(s).filter((x) => x.status === "in_progress");
    return {
      message: [
        wasPaused ? `Resumed "${s.title}".` : `"${s.title}" was not paused.`,
        summary(s),
        ...running.map((x) => `  in flight: ${x.name} (${x.substep}${x.fixRound ? `, fix round ${x.fixRound}` : ""}) at ${x.worktree}`),
        `Next: ${next.text}`
      ].join("\n"),
      data: { procedure: procedurePath(next.procedure), handoff: readText(planFile(pc, "handoff.md")) ?? null }
    };
  });
  return r;
}

// plugins/cairn/cli/src/commands/hooks.ts
import { existsSync as existsSync9 } from "node:fs";
import { dirname as dirname4, isAbsolute, join as join15, relative as relative2, resolve as resolve2 } from "node:path";
var hookOut = (event, text) => JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
function hookSessionStart(input) {
  const ctx = context(input.cwd ?? process.cwd());
  if (ctx.plan?.dir && existsSync9(join15(ctx.plan.dir, "state.json"))) {
    const pc = planCtx(ctx);
    const s = loadState(pc.plan.dir);
    if (s.stage === "closed") return "";
    const lines = [`cairn: ${summary(s)}`, `Next: ${nextFor(s).text} The user runs /cairn:next to continue.`, ...warnings(pc, s).map((w) => `Warning: ${w}`)];
    if (ctx.task) {
      const sl = findTask(s, ctx.task);
      if (sl) lines.push(`This worktree is task "${sl.name}". Touch only: ${sl.scope.join(", ")}. Never edit docs/sdlc/.`);
    }
    return hookOut("SessionStart", lines.join("\n"));
  }
  const active = listPlans(ctx).filter((r) => r.state.stage !== "closed");
  if (!active.length) return "";
  return hookOut("SessionStart", [`cairn: ${active.length} active plan(s) in this repo:`, ...active.map((r) => `- ${summary(r.state)}`), "The user can resume one with /cairn:resume <slug> or start another with /cairn:new."].join("\n"));
}
function hookPostEdit(input) {
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (!file) return "";
  const abs = isAbsolute(file) ? file : resolve2(input.cwd ?? process.cwd(), file);
  let dir = dirname4(abs);
  while (!existsSync9(dir) && dirname4(dir) !== dir) dir = dirname4(dir);
  const ctx = context(dir);
  if (!ctx.plan?.dir || !existsSync9(join15(ctx.plan.dir, "state.json"))) return "";
  const rel = relative2(ctx.top, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return "";
  if (rel.startsWith("docs/sdlc/") || rel.startsWith(".sdlc/") || rel.startsWith(".claude/")) return "";
  const pc = planCtx(ctx);
  const logged = withLock(pc.plan.dir, () => {
    const s = loadState(pc.plan.dir);
    if (s.stage === "closed") return "";
    let allowed;
    let where;
    const task = ctx.task ? findTask(s, ctx.task) : void 0;
    if (["discover", "prd", "plan"].includes(s.stage)) {
      allowed = ["docs/**"];
      where = "before the plan was approved";
    } else if (task) {
      allowed = task.scope;
      where = `outside task "${task.name}" scope`;
    } else if (s.stage === "execute") {
      allowed = (currentPhase(s)?.tasks ?? []).flatMap((x) => x.scope);
      where = "outside the current phase's scope";
    } else {
      allowed = allTasks(s).flatMap((x) => x.scope);
      where = "outside the plan's scope";
    }
    if (matchesAny(rel, allowed)) return "";
    if (s.drift.some((d) => d.path === rel && !d.acked)) return "";
    s.drift.push({ path: rel, at: now(), reason: `edited ${where}`, ...task ? { task: task.id } : {} });
    log(s, "drift", rel);
    saveState(pc.plan.dir, s);
    return `${rel} was edited ${where}`;
  });
  return logged ? hookOut("PostToolUse", `cairn: ${logged}. Logged as out-of-scope; it is listed in the phase summary. If this was not intended, revert it.`) : "";
}

// plugins/cairn/cli/src/main.ts
var BOOLEAN = /* @__PURE__ */ new Set(["json", "all", "replan", "now", "no-worktree", "human", "open", "dismiss"]);
var REPEATABLE = /* @__PURE__ */ new Set(["where", "for"]);
function parseArgs(argv, cwd = process.cwd()) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      pos.push(a);
      continue;
    }
    const [name, inline] = a.slice(2).split(/=(.*)/s, 2);
    if (BOOLEAN.has(name)) opts[name] = true;
    else {
      if (inline === void 0 && i + 1 >= argv.length) throw new CliError(`--${name} needs a value`);
      const v = inline ?? argv[++i];
      const prev = opts[name];
      opts[name] = REPEATABLE.has(name) && typeof prev === "string" ? `${prev}
${v}` : v;
    }
  }
  const noteFile = opts["note-file"];
  if (typeof noteFile === "string") {
    try {
      opts.note = readFileSync6(resolve3(cwd, noteFile), "utf8");
    } catch (e) {
      throw new CliError(`cannot read --note-file ${noteFile}: ${e.message}`);
    }
  }
  const textFile = opts["text-file"];
  if (typeof textFile === "string") {
    try {
      opts.text = readFileSync6(resolve3(cwd, textFile), "utf8");
    } catch (e) {
      throw new CliError(`cannot read --text-file ${textFile}: ${e.message}`);
    }
  }
  return { pos, opts };
}
var USAGE2 = `cairn: plan state for the agent-driven lifecycle. See references/cli.md.
  next | status [--all] | new <slug> --title "\u2026" | product init | decide "<q>" "<a>" [--why] | decide --file <path>
  approve prd|plan|ship | advance [--to <stage>] | plan load [--replan] | ready
  task start|step|done <id> | phase finish | evidence verify|review pass|fail | evidence phase | drift ack <path>|--all
  suggest add|list|resolve|merge|decline \u2026
  pause [--now] | resume [<slug>] | close | render | records
  repro "<command>" | escalate (fix plans)
Flags: --json, --note "\u2026", --note-file <path>, --override "reason" (only when the user chose to skip a check)`;
function run(argv, cwd = process.cwd()) {
  const { pos, opts } = parseArgs(argv, cwd);
  const [cmd, a, b, ...rest] = pos;
  const ctx = () => context(cwd);
  switch (cmd) {
    case "next":
      return cmdNext(ctx());
    case "status":
      return cmdStatus(ctx(), opts);
    case "new":
      return cmdNew(ctx(), a, opts);
    case "product":
      if (a !== "init") throw new CliError("usage: cairn product init");
      return cmdProductInit(ctx());
    case "decide":
      return cmdDecide(ctx(), a, b, opts);
    case "approve":
      return cmdApprove(ctx(), a, opts);
    case "advance":
      return cmdAdvance(ctx(), opts);
    case "plan":
      if (a !== "load") throw new CliError("usage: cairn plan load [--replan]");
      return cmdPlanLoad(ctx(), opts);
    case "ready":
      return cmdReady(ctx());
    case "repro":
      return cmdRepro(ctx(), a, opts);
    case "escalate":
      return cmdEscalate(ctx(), opts);
    case "task":
      return cmdTask(ctx(), a, b, rest, opts);
    case "evidence":
      return cmdEvidence(ctx(), a, b, opts);
    case "phase":
      return cmdPhase(ctx(), a, opts);
    case "suggest":
      return cmdSuggest(ctx(), a, b, opts, rest);
    case "drift":
      if (a !== "ack") throw new CliError("usage: cairn drift ack <path>|--all");
      return cmdDriftAck(ctx(), b, opts);
    case "pause":
      return cmdPause(ctx(), opts);
    case "resume":
      return cmdResume(ctx(), a, opts);
    case "close":
      return cmdClose(ctx(), opts);
    case "records":
      return cmdRecords(ctx());
    case "render":
      return cmdRender(ctx());
    case void 0:
    case "help":
    case "--help":
      return { message: USAGE2 };
    default:
      throw new CliError(`unknown command "${cmd}"
${USAGE2}`);
  }
}
function readStdin() {
  try {
    return JSON.parse(readFileSync6(0, "utf8") || "{}");
  } catch {
    return {};
  }
}
function main(argv) {
  if (argv[0] === "hook") {
    try {
      const input = readStdin();
      const out = argv[1] === "session-start" ? hookSessionStart(input) : argv[1] === "post-edit" ? hookPostEdit(input) : "";
      if (out) process.stdout.write(out + "\n");
    } catch {
    }
    return 0;
  }
  const json = argv.includes("--json");
  try {
    const r = run(argv);
    process.stdout.write((json ? JSON.stringify({ ok: true, message: r.message, ...r.data }, null, 2) : r.message) + "\n");
    return 0;
  } catch (e) {
    if (e instanceof Refusal) {
      process.stdout.write(
        (json ? JSON.stringify({ ok: false, refused: e.message, fixes: e.fixes }, null, 2) : `\u2717 Refused: ${e.message}${e.fixes.map((f) => `
  \u2192 ${f}`).join("")}`) + "\n"
      );
      return 2;
    }
    const msg = e instanceof CliError ? e.message : e.stack ?? String(e);
    process.stdout.write((json ? JSON.stringify({ ok: false, error: msg }) : `\u2717 Error: ${msg}`) + "\n");
    return 1;
  }
}
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("cairn.mjs")) process.exitCode = main(process.argv.slice(2));
export {
  parseArgs,
  run
};
