#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

// npm 6 does not enforce package.json#engines. Keep this launcher compatible
// with Node 12 so an old npm can still hand execution over to Node 22.
var childProcess = require("child_process");
var fs = require("fs");
var os = require("os");
var path = require("path");

var MINIMUM = [22, 13, 0];
var projectRoot = path.resolve(__dirname, "..");

function versionOf(executable) {
  try {
    var output = childProcess.execFileSync(executable, ["--version"], { encoding: "utf8" }).trim();
    var match = output.match(/v?(\d+)\.(\d+)\.(\d+)/);
    return match ? match.slice(1).map(Number) : null;
  } catch {
    return null;
  }
}

function isCompatible(version) {
  if (!version) return false;
  for (var index = 0; index < MINIMUM.length; index += 1) {
    if (version[index] > MINIMUM[index]) return true;
    if (version[index] < MINIMUM[index]) return false;
  }
  return true;
}

function compareVersions(left, right) {
  for (var index = 0; index < 3; index += 1) {
    if (left.version[index] !== right.version[index]) return right.version[index] - left.version[index];
  }
  return 0;
}

function findNode22() {
  var candidates = [process.execPath, "/opt/homebrew/bin/node", "/usr/local/bin/node"];
  var nvmRoot = process.env.NVM_DIR || path.join(os.homedir(), ".nvm");
  var versionsRoot = path.join(nvmRoot, "versions", "node");
  if (fs.existsSync(versionsRoot)) {
    fs.readdirSync(versionsRoot).forEach(function (directory) {
      candidates.push(path.join(versionsRoot, directory, "bin", "node"));
    });
  }
  var compatible = candidates
    .filter(function (candidate, index) { return candidates.indexOf(candidate) === index && fs.existsSync(candidate); })
    .map(function (candidate) { return { executable: candidate, version: versionOf(candidate) }; })
    .filter(function (candidate) { return isCompatible(candidate.version); })
    .sort(compareVersions);
  return compatible.length ? compatible[0] : null;
}

var selected = findNode22();
if (!selected) {
  console.error("字芽需要 Node.js 22.13 或更新版本。");
  console.error("请先运行：nvm install 22 && nvm use 22");
  process.exit(1);
}

var command = process.argv[2];
var args = process.argv.slice(3);
if (!command) {
  console.error("缺少要运行的命令。");
  process.exit(1);
}

var executable;
var commandArgs;
if (command === "node") {
  executable = selected.executable;
  commandArgs = args;
} else {
  executable = path.join(projectRoot, "node_modules", ".bin", command);
  commandArgs = args;
  if (!fs.existsSync(executable)) {
    console.error("没有找到项目命令：" + command + "。请先安装依赖。");
    process.exit(1);
  }
}

var environment = Object.assign({}, process.env, {
  PATH: path.dirname(selected.executable) + path.delimiter + (process.env.PATH || ""),
  WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH || ".wrangler/wrangler.log",
});
var previousBuild = null;
if (command === "vinext" && args[0] === "build") {
  var dist = path.join(projectRoot, "dist");
  if (fs.existsSync(dist)) {
    previousBuild = path.join(os.tmpdir(), "wordsprout-generated-dist-" + process.pid + "-" + Date.now());
    fs.renameSync(dist, previousBuild);
  }
}
var result = childProcess.spawnSync(executable, commandArgs, {
  cwd: projectRoot,
  env: environment,
  stdio: "inherit",
});
if (previousBuild) {
  try {
    fs.rmdirSync(previousBuild, { recursive: true });
  } catch {
    // The old directory is only generated output in the system temp folder.
  }
}
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(typeof result.status === "number" ? result.status : 1);
