const assert = require("node:assert/strict");
const { test } = require("node:test");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

function loadWithResponse(deliver) {
  const filename = path.resolve(__dirname, "../src/problems/problemParsing.js");
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = (id) => id === "https" ? {
    get(url, options, callback) {
      const request = new EventEmitter();
      request.setTimeout = () => {};
      request.destroy = (error) => request.emit("error", error);
      queueMicrotask(() => {
        const response = new EventEmitter();
        response.statusCode = 200;
        response.headers = {};
        response.resume = () => {};
        response.setEncoding = () => { throw new Error("String mode breaks inspector dataLength"); };
        callback(response);
        deliver(response, request);
      });
      return request;
    },
  } : module.require(id.startsWith(".") ? path.resolve(path.dirname(filename), id) : id);
  loaded._compile(fs.readFileSync(filename, "utf8"), filename);
  return loaded.exports.fetchText;
}

test("keeps Buffer chunks for inspector and decodes split UTF-8 correctly", async () => {
  const expected = "프로그래머스 문제 🚀";
  const bytes = Buffer.from(expected);
  const fetchText = loadWithResponse((response) => {
    for (const byte of bytes) response.emit("data", Buffer.from([byte]));
    response.emit("end");
  });
  assert.equal(await fetchText("https://school.programmers.co.kr/test"), expected);
});

test("response stream errors reject instead of leaving the fetch pending", async () => {
  const failure = new Error("response interrupted");
  const fetchText = loadWithResponse((response) => response.emit("error", failure));
  await assert.rejects(fetchText("https://school.programmers.co.kr/test"), (error) => error === failure);
});
