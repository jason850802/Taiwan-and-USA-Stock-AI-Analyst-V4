var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
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

// <define:import.meta.env>
var define_import_meta_env_default;
var init_define_import_meta_env = __esm({
  "<define:import.meta.env>"() {
    define_import_meta_env_default = {};
  }
});

// utils/market.ts
init_define_import_meta_env();
var isTwStock = (symbol) => {
  const s = symbol.toUpperCase();
  return s.endsWith(".TW") || s.endsWith(".TWO") || /^\d{3,6}[A-Z]?$/.test(s);
};
var marketOf = (symbol) => isTwStock(symbol) ? "TW" : "US";

// services/_shared/apiClient.ts
init_define_import_meta_env();
var secret = define_import_meta_env_default?.VITE_PROXY_SECRET;
var proxyHeaders = secret ? { "X-Proxy-Secret": secret } : {};

// services/fetchError.ts
init_define_import_meta_env();
var DataFetchError = class extends Error {
  constructor(kind, message) {
    super(message);
    this.name = "DataFetchError";
    this.kind = kind;
  }
};
var classifyCaught = (e) => {
  if (e instanceof DataFetchError) return e.kind;
  const status = e?.status;
  if (typeof status === "number") {
    if (status === 429) return "RATE_LIMIT";
    if (status >= 500) return "BACKEND_DOWN";
  }
  const message = String(e?.message ?? "");
  if (e instanceof TypeError || /failed to fetch|networkerror/i.test(message)) return "NETWORK";
  return "UNKNOWN";
};

export {
  __commonJS,
  __toESM,
  init_define_import_meta_env,
  isTwStock,
  marketOf,
  proxyHeaders,
  DataFetchError,
  classifyCaught
};
