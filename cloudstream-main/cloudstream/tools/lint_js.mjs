import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as acorn from "acorn";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const eclipsiaDirs = [
  ...fs.readdirSync(path.join(root, "eclipsia")).filter(d => fs.existsSync(path.join(root, "eclipsia", d, "src/main/assets/scrapers"))).sort().map(d => `eclipsia/${d}/src/main/assets/scrapers`),
  "shared/src/eclipsia/main/assets/shim",
];
const playzDirs = ["playz/src/main/assets/playz", "shared/src/playz/main/assets/shim"];

const BASE_IDENT = ["require", "cheerio", "CryptoJS", "DOMParser", "document", "window", "Buffer", "Symbol",
  "Map", "Set", "WeakMap", "WeakSet", "Proxy", "Reflect", "Intl", "TextEncoder", "TextDecoder", "URL", "process"];
const BASE_PROP = ["includes", "startsWith", "endsWith", "padStart", "padEnd", "repeat", "assign", "from", "of",
  "find", "findIndex", "findLast", "flat", "flatMap", "entries", "values", "fromEntries", "at", "replaceAll", "matchAll",
  "trimStart", "trimEnd", "isInteger", "isFinite", "isNaN", "trunc", "sign", "subtle", "toLocaleString", "toLocaleDateString", "toLocaleTimeString", "normalize"];

const groups = [
  { dirs: eclipsiaDirs, ident: new Set(BASE_IDENT), prop: new Set(BASE_PROP), noComments: false, label: "js lint ok" },
  {
    dirs: playzDirs,
    ident: new Set([...BASE_IDENT, "console", "async", "await", "http_get", "http_post"]),
    prop: new Set([...BASE_PROP, "finally"]),
    noComments: true,
    label: "playz js lint ok",
  },
];
const BANNED_REGEX = [/\(\?<[=!]/, /\(\?<\w+>/, /\\p\{/i];

let bad = 0;
const fail = (f, line, msg) => { bad++; console.log(`${f}:${line}: ${msg}`); };

function walk(node, visit, parent) {
  if (!node || typeof node.type !== "string") return;
  visit(node, parent);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach(c => c && typeof c.type === "string" && walk(c, visit, node));
    else if (v && typeof v.type === "string") walk(v, visit, node);
  }
}

for (const g of groups) for (const d of g.dirs) {
  for (const name of fs.readdirSync(path.join(root, d)).filter(n => n.endsWith(".js")).sort()) {
    const rel = `${d}/${name}`;
    const src = fs.readFileSync(path.join(root, rel), "utf8");
    let ast;
    try {
      ast = acorn.parse(src, {
        ecmaVersion: 5,
        locations: true,
        allowReturnOutsideFunction: true,
        onComment: g.noComments ? (block, text, s, e, sl) => fail(rel, sl.line, "comment") : undefined,
      });
    } catch (e) { fail(rel, e.loc?.line ?? 0, `not ES5: ${e.message}`); continue; }

    const ownFns = new Set();
    walk(ast, n => { if (n.type === "FunctionDeclaration" && n.id) ownFns.add(n.id.name); });

    walk(ast, (n, p) => {
      const line = n.loc.start.line;
      if (n.type === "Identifier" && g.ident.has(n.name)) {
        const isProp = p && p.type === "MemberExpression" && p.property === n && !p.computed;
        const isKey = p && p.type === "Property" && p.key === n;
        const isDecl = p && (p.type === "FunctionDeclaration" || p.type === "VariableDeclarator") && p.id === n;
        const guarded = p && p.type === "UnaryExpression" && p.operator === "typeof";
        if (!isProp && !isKey && !isDecl && !guarded) fail(rel, line, `banned global '${n.name}'`);
      }
      if (n.type === "MemberExpression" && !n.computed && g.prop.has(n.property.name) && !ownFns.has(n.property.name)) {
        if (p && p.type === "CallExpression" && p.callee === n) fail(rel, line, `ES6+ built-in '.${n.property.name}()'`);
      }
      if (n.type === "Literal" && n.regex) {
        if (/[syu]/.test(n.regex.flags)) fail(rel, line, `regex flag '${n.regex.flags}' not supported by Rhino`);
        if (BANNED_REGEX.some(r => r.test(n.regex.pattern))) fail(rel, line, "regex lookbehind/named group/\\p{} not supported by Rhino");
      }
    });
  }
}

if (bad) { console.log(`${bad} violation(s)`); process.exit(1); }
console.log(groups.map(g => g.label).join("\n"));
