/**
 * CLI 集成测试。
 * by AI.Coding
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 执行 CLI 命令，并把配置文件隔离到临时目录。
 * @param {string[]} args CLI 参数。
 * @param {string} configPath 临时配置路径。
 * @returns {import("node:child_process").SpawnSyncReturns<Buffer>} 执行结果。
 */
function runCli(args, configPath) {
  return spawnSync(process.execPath, ["bin/workflow-switcher.mjs", ...args], {
    cwd: path.resolve("."),
    env: { ...process.env, WORKFLOW_SWITCHER_CONFIG: configPath, NO_COLOR: "1" },
    encoding: "utf8",
  });
}

test("workflow/tool 别名可以写入 source 和 target 配置", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-switcher-cli-"));
  const configPath = path.join(root, "config.json");
  const sourceDir = path.join(root, "source");
  const activeDir = path.join(root, "active");

  try {
    fs.mkdirSync(path.join(sourceDir, "coding"), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "coding", "SKILL.md"), "---\nname: coding\ndescription: test\n---\n");

    const sourceResult = runCli(["workflow", "add", "V5", sourceDir], configPath);
    assert.equal(sourceResult.status, 0, sourceResult.stderr || sourceResult.stdout);

    const targetResult = runCli(["tool", "add", "codex", activeDir], configPath);
    assert.equal(targetResult.status, 0, targetResult.stderr || targetResult.stdout);

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(config.sources.V5.skillsDir, sourceDir);
    assert.equal(config.targets.codex.activeDir, activeDir);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workflow ignore 命令可以添加、恢复和清空忽略列表", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-switcher-cli-ignore-"));
  const configPath = path.join(root, "config.json");
  const sourceDir = path.join(root, "source");

  try {
    fs.mkdirSync(path.join(sourceDir, "coding"), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "coding", "SKILL.md"), "---\nname: coding\ndescription: test\n---\n");

    const sourceResult = runCli(["workflow", "add", "V5", sourceDir], configPath);
    assert.equal(sourceResult.status, 0, sourceResult.stderr || sourceResult.stdout);

    const addResult = runCli(["workflow", "ignore", "add", "V5", "coding", "debugging"], configPath);
    assert.equal(addResult.status, 0, addResult.stderr || addResult.stdout);

    let config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.deepEqual(config.sources.V5.ignoredSkills, ["coding", "debugging"]);

    const removeResult = runCli(["workflow", "ignore", "remove", "V5", "coding"], configPath);
    assert.equal(removeResult.status, 0, removeResult.stderr || removeResult.stdout);

    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.deepEqual(config.sources.V5.ignoredSkills, ["debugging"]);

    const clearResult = runCli(["workflow", "ignore", "clear", "V5"], configPath);
    assert.equal(clearResult.status, 0, clearResult.stderr || clearResult.stdout);

    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.deepEqual(config.sources.V5.ignoredSkills, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("clear --target all 清理所有工具目录并重置当前工作流", { skip: process.platform === "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-switcher-cli-clear-"));
  const configPath = path.join(root, "config.json");
  const sourceDir = path.join(root, "source");
  const codexDir = path.join(root, "codex");
  const claudeDir = path.join(root, "claude");

  try {
    fs.mkdirSync(path.join(sourceDir, "coding"), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "coding", "SKILL.md"), "---\nname: coding\ndescription: test\n---\n");

    assert.equal(runCli(["workflow", "add", "V5", sourceDir], configPath).status, 0);
    assert.equal(runCli(["tool", "add", "codex", codexDir], configPath).status, 0);
    assert.equal(runCli(["tool", "add", "claude", claudeDir], configPath).status, 0);
    assert.equal(runCli(["use", "V5", "--target", "all"], configPath).status, 0);

    const clearResult = runCli(["clear", "--target", "all"], configPath);
    assert.equal(clearResult.status, 0, clearResult.stderr || clearResult.stdout);
    assert.match(clearResult.stdout, /工作流关联已清空/);
    assert.equal(fs.existsSync(path.join(codexDir, "coding")), false);
    assert.equal(fs.existsSync(path.join(claudeDir, "coding")), false);

    for (const activeDir of [codexDir, claudeDir]) {
      const state = JSON.parse(fs.readFileSync(path.join(activeDir, ".workflow-switcher.json"), "utf8"));
      assert.equal(state.currentSource, null);
      assert.equal(state.sourceDir, null);
      assert.deepEqual(state.managed, []);
    }

    const statusResult = runCli(["status"], configPath);
    assert.equal(statusResult.status, 0, statusResult.stderr || statusResult.stdout);
    assert.match(statusResult.stdout, /未选择或使用工作流/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
