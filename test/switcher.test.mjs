/**
 * switcher 模块测试。
 * by AI.Coding
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearTargets, switchSource } from "../src/switcher.mjs";
import { readState, writeState } from "../src/state.mjs";

/**
 * 写入一个测试 skill。
 * @param {string} root source 根目录。
 * @param {string} dir skill 目录名。
 * @param {string} name skill 名称。
 */
function writeSkill(root, dir, name) {
  const skillDir = path.join(root, dir);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: ${name}\ndescription: test\n---\n`);
}

test("switchSource 使用 symlink 投影 skills 和根附属项", { skip: process.platform === "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-switcher-switch-"));
  const source = path.join(root, "source");
  const active = path.join(root, "active");
  fs.mkdirSync(source, { recursive: true });

  try {
    writeSkill(source, "coding", "coding");
    fs.writeFileSync(path.join(source, "WORKFLOW.md"), "workflow");

    const config = {
      version: 3,
      sources: { V5: { skillsDir: source } },
      targets: { codex: { activeDir: active, enabled: true } },
    };

    const [result] = switchSource(config, "V5", ["codex"]);
    const state = readState(active);

    assert.equal(result.skills, 1);
    assert.equal(result.rootAdjuncts, 1);
    assert.equal(fs.lstatSync(path.join(active, "coding")).isSymbolicLink(), true);
    assert.equal(fs.lstatSync(path.join(active, "WORKFLOW.md")).isSymbolicLink(), true);
    assert.equal(state.currentSource, "V5");
    assert.equal(state.managed.length, 1);
    assert.equal(state.managedRootEntries.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("switchSource 会清理后来加入 ignoredSkills 的受控 skill", { skip: process.platform === "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-switcher-ignore-"));
  const source = path.join(root, "source");
  const active = path.join(root, "active");
  fs.mkdirSync(source, { recursive: true });

  try {
    writeSkill(source, "coding", "coding");
    writeSkill(source, "debugging", "debugging");

    const baseConfig = {
      version: 3,
      sources: { V5: { skillsDir: source, ignoredSkills: [] } },
      targets: { codex: { activeDir: active, enabled: true } },
    };
    switchSource(baseConfig, "V5", ["codex"]);

    const ignoredConfig = {
      ...baseConfig,
      sources: { V5: { skillsDir: source, ignoredSkills: ["debugging"] } },
    };
    const [result] = switchSource(ignoredConfig, "V5", ["codex"]);
    const state = readState(active);

    assert.equal(result.skills, 1);
    assert.equal(fs.lstatSync(path.join(active, "coding")).isSymbolicLink(), true);
    assert.equal(fs.existsSync(path.join(active, "debugging")), false);
    assert.deepEqual(state.managed.map((item) => item.name), ["coding"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("switchSource 遇到被改指向的受控名称时阻止切换", { skip: process.platform === "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-switcher-conflict-"));
  const source = path.join(root, "source");
  const active = path.join(root, "active");
  const oldTarget = path.join(root, "old-coding");
  const rogueTarget = path.join(root, "rogue-coding");
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(active, { recursive: true });
  fs.mkdirSync(oldTarget, { recursive: true });
  fs.mkdirSync(rogueTarget, { recursive: true });

  try {
    writeSkill(source, "coding", "coding");
    fs.symlinkSync(rogueTarget, path.join(active, "coding"), "dir");
    writeState(active, {
      target: "codex",
      currentSource: "OLD",
      sourceDir: root,
      managed: [{ kind: "skill", name: "coding", target: oldTarget, relativeTarget: "coding" }],
      managedRootEntries: [],
    });

    const config = {
      version: 3,
      sources: { V5: { skillsDir: source }, OLD: { skillsDir: root } },
      targets: { codex: { activeDir: active, enabled: true } },
    };

    assert.throws(() => switchSource(config, "V5", ["codex"]), /不是本工具受控项/);
    assert.equal(fs.realpathSync(path.join(active, "coding")), fs.realpathSync(rogueTarget));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("clearTargets 清理受控项并保留非受控内容", { skip: process.platform === "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-switcher-clear-"));
  const source = path.join(root, "source");
  const active = path.join(root, "active");
  fs.mkdirSync(source, { recursive: true });

  try {
    writeSkill(source, "coding", "coding");
    fs.writeFileSync(path.join(source, "WORKFLOW.md"), "workflow");
    const config = {
      version: 3,
      sources: { V5: { skillsDir: source } },
      targets: { codex: { activeDir: active, enabled: true } },
    };
    switchSource(config, "V5", ["codex"]);
    fs.writeFileSync(path.join(active, "manual.txt"), "manual");

    const [result] = clearTargets(config, ["codex"]);
    const state = readState(active);

    assert.deepEqual(result.removed.sort(), ["WORKFLOW.md", "coding"]);
    assert.equal(result.previousSource, "V5");
    assert.equal(fs.existsSync(path.join(active, "coding")), false);
    assert.equal(fs.existsSync(path.join(active, "WORKFLOW.md")), false);
    assert.equal(fs.readFileSync(path.join(active, "manual.txt"), "utf8"), "manual");
    assert.equal(state.currentSource, null);
    assert.equal(state.sourceDir, null);
    assert.deepEqual(state.managed, []);
    assert.deepEqual(state.managedRootEntries, []);

    const [secondResult] = clearTargets(config, ["codex"]);
    assert.deepEqual(secondResult.removed, []);
    assert.deepEqual(secondResult.missing, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("clearTargets 对没有状态文件的 target 保持幂等", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-switcher-clear-empty-"));
  const active = path.join(root, "active");
  fs.mkdirSync(active, { recursive: true });

  try {
    const config = {
      version: 3,
      sources: {},
      targets: { codex: { activeDir: active, enabled: true } },
    };
    const [result] = clearTargets(config, ["codex", "codex"]);
    const state = readState(active);

    assert.deepEqual(result.removed, []);
    assert.deepEqual(result.missing, []);
    assert.equal(state.target, "codex");
    assert.equal(state.currentSource, null);
    assert.deepEqual(state.managed, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("clearTargets 任一 target 预检失败时不清空其他 target", { skip: process.platform === "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-switcher-clear-atomic-"));
  const source = path.join(root, "source");
  const activeCodex = path.join(root, "codex");
  const activeClaude = path.join(root, "claude");
  const rogueTarget = path.join(root, "rogue-coding");
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(rogueTarget, { recursive: true });

  try {
    writeSkill(source, "coding", "coding");
    const config = {
      version: 3,
      sources: { V5: { skillsDir: source } },
      targets: {
        codex: { activeDir: activeCodex, enabled: true },
        claude: { activeDir: activeClaude, enabled: true },
      },
    };
    switchSource(config, "V5", ["codex", "claude"]);
    fs.unlinkSync(path.join(activeClaude, "coding"));
    fs.symlinkSync(rogueTarget, path.join(activeClaude, "coding"), "dir");

    assert.throws(() => clearTargets(config, ["codex", "claude"]), /不是本工具受控项/);
    assert.equal(fs.lstatSync(path.join(activeCodex, "coding")).isSymbolicLink(), true);
    assert.equal(readState(activeCodex).currentSource, "V5");
    assert.equal(fs.realpathSync(path.join(activeClaude, "coding")), fs.realpathSync(rogueTarget));
    assert.equal(readState(activeClaude).currentSource, "V5");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
