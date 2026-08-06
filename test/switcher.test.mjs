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

test("switchSource 会把后来新增的 source skill 纳入受控状态", { skip: process.platform === "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-switcher-added-skill-"));
  const source = path.join(root, "source");
  const active = path.join(root, "active");
  fs.mkdirSync(source, { recursive: true });

  try {
    writeSkill(source, "coding", "coding");
    const config = {
      version: 3,
      sources: { V5: { skillsDir: source } },
      targets: { codex: { activeDir: active, enabled: true } },
    };
    switchSource(config, "V5", ["codex"]);

    // 模拟分类内新增 skill，下一次 use 应创建链接并写入状态。
    writeSkill(source, "debugging", "debugging");
    const [result] = switchSource(config, "V5", ["codex"]);
    const state = readState(active);

    assert.deepEqual(result.created, ["debugging"]);
    assert.equal(fs.lstatSync(path.join(active, "debugging")).isSymbolicLink(), true);
    assert.deepEqual(
      state.managed.map((item) => item.name).sort(),
      ["coding", "debugging"],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("switchSource 会清理已从 source 删除的受控 skill 断链", { skip: process.platform === "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-switcher-deleted-skill-"));
  const source = path.join(root, "source");
  const active = path.join(root, "active");
  fs.mkdirSync(source, { recursive: true });

  try {
    writeSkill(source, "coding", "coding");
    const config = {
      version: 3,
      sources: { V5: { skillsDir: source } },
      targets: { codex: { activeDir: active, enabled: true } },
    };
    switchSource(config, "V5", ["codex"]);

    // 模拟分类内删除 skill：目标目录消失后，active 中会留下受控断链。
    fs.rmSync(path.join(source, "coding"), { recursive: true, force: true });
    const [result] = switchSource(config, "V5", ["codex"]);
    const state = readState(active);

    assert.deepEqual(result.removed, ["coding"]);
    assert.deepEqual(result.warnings, []);
    assert.equal(fs.existsSync(path.join(active, "coding")), false);
    assert.deepEqual(state.managed, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("switchSource 会在同名 skill 移动后重建受控链接", { skip: process.platform === "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-switcher-moved-skill-"));
  const source = path.join(root, "source");
  const active = path.join(root, "active");
  fs.mkdirSync(source, { recursive: true });

  try {
    writeSkill(source, "old/coding", "coding");
    const config = {
      version: 3,
      sources: { V5: { skillsDir: source } },
      targets: { codex: { activeDir: active, enabled: true } },
    };
    switchSource(config, "V5", ["codex"]);

    // 模拟分类整理目录：skill name 不变，但源目录从 old 移到 new。
    fs.mkdirSync(path.join(source, "new"), { recursive: true });
    fs.renameSync(path.join(source, "old", "coding"), path.join(source, "new", "coding"));
    const [result] = switchSource(config, "V5", ["codex"]);
    const state = readState(active);

    assert.deepEqual(result.removed, ["coding"]);
    assert.deepEqual(result.created, ["coding"]);
    assert.deepEqual(result.warnings, []);
    assert.equal(fs.realpathSync(path.join(active, "coding")), fs.realpathSync(path.join(source, "new", "coding")));
    assert.equal(state.managed[0].target, path.join(source, "new", "coding"));
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

test("switchSource 预检失败时不会部分删除其他受控链接", { skip: process.platform === "win32" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-switcher-switch-atomic-"));
  const source = path.join(root, "source");
  const active = path.join(root, "active");
  fs.mkdirSync(source, { recursive: true });

  try {
    writeSkill(source, "coding", "coding");
    writeSkill(source, "debugging", "debugging");
    const config = {
      version: 3,
      sources: { V5: { skillsDir: source, ignoredSkills: [] } },
      targets: { codex: { activeDir: active, enabled: true } },
    };
    switchSource(config, "V5", ["codex"]);

    fs.rmSync(path.join(source, "coding"), { recursive: true, force: true });
    fs.rmSync(path.join(source, "debugging"), { recursive: true, force: true });
    fs.unlinkSync(path.join(active, "debugging"));
    fs.writeFileSync(path.join(active, "debugging"), "manual");

    assert.throws(() => switchSource(config, "V5", ["codex"]), /当前内容不是符号链接/);
    // coding 虽然是可清理断链，但必须等全部预检通过后才能删除。
    assert.equal(fs.lstatSync(path.join(active, "coding")).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(path.join(active, "debugging"), "utf8"), "manual");
    assert.deepEqual(
      readState(active).managed.map((item) => item.name).sort(),
      ["coding", "debugging"],
    );
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
