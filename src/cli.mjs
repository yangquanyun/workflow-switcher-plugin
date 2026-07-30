/**
 * CLI 命令调度与交互脚手架。
 * by AI.Coding
 */
import fs from "node:fs";
import { BUILTIN_TARGET_NAMES } from "./constants.mjs";
import { configPath } from "./paths.mjs";
import { addIgnoredSkills, loadConfig, removeIgnoredSkills, removeSource, removeTarget, saveConfig, setIgnoredSkills, setSource, setTarget } from "./config.mjs";
import { discoverSource, assertNoDuplicateNames } from "./scanner.mjs";
import { clearTargets, resolveTargetNames, switchSource } from "./switcher.mjs";
import { readState } from "./state.mjs";
import { validateName } from "./validation.mjs";
import { askConfirm, askMultiSelect, askSelect, askText, closePrompt, createPrompt } from "./prompt.mjs";
import { printDoctor, runDoctor } from "./doctor.mjs";
import { banner, commandList, errorKv, failure, info, kv, nameText, next, note, pathText, printResolution, section, spin, step, success, summary, table, warn } from "./output.mjs";

/**
 * 校验 source 目录并打印扫描结果，保存配置前提前暴露路径和重复名称问题。
 * @param {string} skillsDir source skills 目录。
 */
function validateAndPrintSource(skillsDir) {
  if (!fs.existsSync(skillsDir)) throw new Error(`工作流 skills 源目录不存在: ${skillsDir}`);
  const discovered = spin("扫描工作流目录", () => {
    const result = discoverSource(skillsDir);
    assertNoDuplicateNames(result, skillsDir);
    return result;
  }, "工作流目录检测通过");
  kv("skills", discovered.skills.length);
  kv("根附属项", discovered.rootAdjuncts.length);
}

/**
 * 校验工作流目录并返回扫描结果，供 setup 汇总展示使用。
 * @param {string} skillsDir 工作流 skills 源目录。
 * @param {{quiet?:boolean}} options 输出选项。
 * @returns {{skills:Array,rootAdjuncts:Array}} 扫描结果。
 */
function validateSource(skillsDir, options = {}) {
  if (!fs.existsSync(skillsDir)) throw new Error(`工作流 skills 源目录不存在: ${skillsDir}`);
  const scan = () => {
    const discovered = discoverSource(skillsDir);
    assertNoDuplicateNames(discovered, skillsDir);
    return discovered;
  };
  if (options.quiet) return scan();
  return spin("扫描工作流目录", scan, "工作流目录检测通过");
}

/**
 * 输出一段空行分隔的向导步骤标题，降低连续 prompt 的压迫感。
 * @param {string} title 步骤标题。
 */
function guideStep(title) {
  console.log("");
  step(title);
}

/**
 * 判断配置中是否已有工作流或工具目录。
 * @param {object} config 配置对象。
 * @returns {boolean} 是否已有配置。
 */
function hasAnyConfig(config) {
  return Object.keys(config.targets).length > 0 || Object.keys(config.sources).length > 0;
}

/**
 * 展示已有配置，帮助用户判断下一步是使用、追加还是重配。
 * @param {object} config 配置对象。
 */
function printSetupOverview(config) {
  section("已有配置");
  const targetRows = Object.entries(config.targets).map(([name, target]) => ["工具目录", nameText(name), pathText(target.activeDir)]);
  const sourceRows = Object.entries(config.sources).map(([name, source]) => ["工作流", nameText(name), pathText(source.skillsDir)]);
  table(["类型", "名称", "路径"], [...targetRows, ...sourceRows]);
}

/**
 * 无参数主菜单，适合作为脚手架入口。
 */
async function runMenu() {
  const rl = createPrompt();
  try {
    while (true) {
      const action = await askSelect(rl, "请选择操作", [
        { label: "初始化配置", value: "setup" },
        { label: "添加工作流", value: "source-add" },
        { label: "添加工具目录", value: "target-add" },
        { label: "切换工作流", value: "use" },
        { label: "清空当前工作流", value: "clear" },
        { label: "查看状态", value: "status" },
        { label: "环境诊断", value: "doctor" },
        { label: "退出", value: "exit" },
      ]);

      if (action === "exit") return;
      if (action === "setup") {
        closePrompt(rl);
        return runSetup();
      }
      if (action === "source-add") {
        const source = await promptSource(rl);
        let config = setSource(loadConfig(), source.name, source.skillsDir);
        saveConfig(config);
        success("工作流已保存");
      }
      if (action === "target-add") {
        const target = await promptTarget(rl);
        let config = setTarget(loadConfig(), target.name, target.activeDir);
        saveConfig(config);
        success("工具目录已保存");
      }
      if (action === "use") {
        const config = loadConfig();
        const sourceNames = Object.keys(config.sources);
        if (sourceNames.length === 0) {
          warn("暂无工作流，请先添加。");
          continue;
        }
        const sourceName = await askSelect(rl, "请选择工作流", toChoices(sourceNames));
        closePrompt(rl);
        return runUse(sourceName, { target: [] });
      }
      if (action === "clear") {
        closePrompt(rl);
        return runClear({ target: [] });
      }
      if (action === "status") printCurrent(true);
      if (action === "doctor") printDoctor(runDoctor(loadConfig(), configPath()));
    }
  } finally {
    // 统一交互上下文释放入口，便于 prompt 实现替换。
    closePrompt(rl);
  }
}

/**
 * 打印帮助文案。
 */
function printHelp() {
  banner("命令速查");
  section("用法");
  console.log("  workflow-switcher <命令> [参数]");
  section("常用流程");
  commandList([
    ["workflow-switcher setup", "初始化工具目录和工作流"],
    ["workflow-switcher doctor", "检查路径和软链接权限"],
    ["workflow-switcher use", "选择并切换工作流"],
  ]);
  section("命令");
  table(
    ["命令", "说明"],
    [
      ["setup", "交互式初始化工作流和工具目录"],
      ["workflow add [名称] [路径]", "添加工作流，等同于 source add"],
      ["workflow list", "查看工作流列表，等同于 source list"],
      ["workflow ignore list <名称>", "查看工作流忽略的 skills"],
      ["workflow ignore add <名称> <skill...>", "忽略一个或多个 skill"],
      ["workflow ignore remove <名称> <skill...>", "恢复一个或多个 skill"],
      ["workflow ignore clear <名称>", "清空忽略列表"],
      ["workflow remove <名称>", "删除工作流配置，等同于 source remove"],
      ["source add [名称] [路径]", "添加工作流"],
      ["source list", "查看工作流列表"],
      ["source ignore list <名称>", "查看工作流忽略的 skills"],
      ["source ignore add <名称> <skill...>", "忽略一个或多个 skill"],
      ["source ignore remove <名称> <skill...>", "恢复一个或多个 skill"],
      ["source ignore clear <名称>", "清空忽略列表"],
      ["source remove <名称>", "删除工作流配置"],
      ["tool add [名称] [路径]", "添加工具目录，等同于 target add"],
      ["tool list", "查看工具目录列表，等同于 target list"],
      ["tool remove <名称>", "删除工具目录配置，等同于 target remove"],
      ["target add [名称] [路径]", "添加工具目录"],
      ["target list", "查看工具目录列表"],
      ["target remove <名称>", "删除工具目录配置"],
      ["use [source]", "切换工作流，不传 source 时进入选择"],
      ["clear", "清空当前工作流关联"],
      ["current", "查看当前工具目录状态"],
      ["status", "查看配置和当前状态"],
      ["doctor", "诊断配置、路径和 symlink 权限"],
    ],
  );
  section("选项");
  table(["选项", "说明"], [["--target <名称|all>", "指定 use 或 clear 的工具目录，可重复"]]);
}

/**
 * 解析简单 CLI 参数；保持轻量，不引入第三方依赖。
 * @param {string[]} argv 原始参数。
 * @returns {{command:string,args:string[],options:object}} 解析结果。
 */
function parseArgs(argv) {
  const args = [];
  const options = { target: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--target") options.target.push(argv[++index]);
    else if (arg.startsWith("--target=")) options.target.push(arg.slice("--target=".length));
    else args.push(arg);
  }
  return { command: args[0] || null, args: args.slice(1), options };
}

/**
 * 将更贴近日常语义的别名映射到内部命令，保留旧命令兼容性。
 * @param {string|null} command 原始命令。
 * @returns {string|null} 规范命令。
 */
function normalizeCommand(command) {
  if (command === "workflow") return "source";
  if (command === "tool") return "target";
  return command;
}

/**
 * 将名称列表转换为交互选项，避免调用方重复构造 label/value。
 * @param {string[]} names 名称列表。
 * @returns {Array<{label:string,value:string}>} 交互选项。
 */
function toChoices(names) {
  return names.map((name) => ({ label: name, value: name }));
}

/**
 * 询问是否继续追加同类配置，用选择菜单替代 Y/n，避免回车误触下一个输入校验。
 * @param {object} rl 交互上下文。
 * @param {string} message 提示文案。
 * @returns {Promise<boolean>} 是否继续。
 */
async function askContinue(rl, message) {
  const action = await askSelect(rl, message, [
    { label: "是", value: "continue" },
    { label: "否", value: "stop" },
  ]);
  return action === "continue";
}

/**
 * 将内置工具名称用于提示语展示，不改变配置中保存的 slug。
 * @param {string} name target 名称。
 * @returns {string} 展示名称。
 */
function targetPromptName(name) {
  if (name === "codex") return "Codex";
  if (name === "claude") return "Claude";
  return name;
}

/**
 * 根据内置名称或用户输入生成工具目录信息；不提供任何默认路径。
 * @param {object} rl 交互上下文。
 * @returns {Promise<{name:string,activeDir:string}>} target 信息。
 */
async function promptTarget(rl) {
  const choices = [
    ...toChoices(BUILTIN_TARGET_NAMES),
    { label: "自定义", value: "__custom__" },
  ];
  const selected = await askSelect(rl, "请选择工具", choices);
  const name = selected === "__custom__" ? validateName(await askText(rl, "请输入工具名称"), "target") : selected;
  const activeDir = await askText(rl, `请输入 ${targetPromptName(name)} 对应的 skills 目录路径`);
  return { name, activeDir };
}

/**
 * 交互式添加 target。
 * @param {object} config 当前配置。
 * @returns {Promise<object>} 更新后的配置。
 */
async function interactiveAddTarget(config) {
  const rl = createPrompt();
  try {
    guideStep("添加工具目录");
    const target = await promptTarget(rl);
    success(`已添加工具目录: ${target.name}`);
    kv("skills 目录", pathText(target.activeDir));
    return setTarget(config, target.name, target.activeDir);
  } finally {
    closePrompt(rl);
  }
}

/**
 * 使用指定交互上下文收集 source 信息。
 * @param {object} rl 交互上下文。
 * @returns {Promise<{name:string,skillsDir:string}>} source 信息。
 */
async function promptSource(rl) {
  const name = validateName(await askText(rl, "请输入工作流名称"), "source");
  const skillsDir = await askText(rl, "请输入工作流 skills 源目录路径");
  validateSource(skillsDir);
  return { name, skillsDir };
}

/**
 * 交互式添加 source。
 * @param {object} config 当前配置。
 * @returns {Promise<object>} 更新后的配置。
 */
async function interactiveAddSource(config) {
  const rl = createPrompt();
  try {
    guideStep("添加工作流");
    const source = await promptSource(rl);
    success(`已添加工作流: ${source.name}`);
    kv("skills 源目录", pathText(source.skillsDir));
    return setSource(config, source.name, source.skillsDir);
  } finally {
    closePrompt(rl);
  }
}

/**
 * 按确认式向导收集变更，保存前统一展示汇总表。
 * @param {object} rl 交互上下文。
 * @param {object} baseConfig 基础配置。
 * @param {{target:boolean,source:boolean}} plan 收集计划。
 * @returns {Promise<object>} 保存后的配置。
 */
async function collectSetupDraft(rl, baseConfig, plan) {
  let config = baseConfig;
  const draftTargets = [];
  const draftSources = [];

  if (plan.target) {
    guideStep("第 1 步：添加工具目录");
    let shouldAddTarget = true;
    while (shouldAddTarget) {
      const target = await promptTarget(rl);
      draftTargets.push(target);
      note(`已记录工具目录: ${nameText(target.name)}  ${pathText(target.activeDir)}`);
      shouldAddTarget = await askContinue(rl, "是否继续添加工具目录");
    }
  }

  if (plan.source) {
    guideStep("第 2 步：添加工作流");
    let shouldAddSource = true;
    while (shouldAddSource) {
      const name = validateName(await askText(rl, "请输入工作流名称"), "source");
      const skillsDir = await askText(rl, "请输入工作流 skills 源目录路径");
      const discovered = validateSource(skillsDir, { quiet: true });
      draftSources.push({ name, skillsDir, skills: discovered.skills.length, rootAdjuncts: discovered.rootAdjuncts.length });
      note(`工作流目录检测通过`);
      note(`已记录工作流: ${nameText(name)}  ${discovered.skills.length} skills / ${discovered.rootAdjuncts.length} 共享项`);
      shouldAddSource = await askContinue(rl, "是否继续添加工作流");
    }
  }

  if (draftTargets.length === 0 && draftSources.length === 0) {
    warn("没有新增或更新任何配置。");
    return config;
  }

  console.log("");
  summary("配置汇总");
  const summaryRows = [
    ...draftTargets.map((target) => ["工具目录", target.name, pathText(target.activeDir), "-"]),
    ...draftSources.map((source) => ["工作流", source.name, pathText(source.skillsDir), `${source.skills} skills / ${source.rootAdjuncts} 共享项`]),
  ];
  table(["类型", "名称", "路径", "检测结果"], summaryRows);
  const saveAction = await askSelect(rl, "是否保存以上配置", [
    { label: "是", value: "save" },
    { label: "否", value: "cancel" },
  ]);
  if (saveAction !== "save") {
    warn("已取消保存，现有配置未改变。");
    return config;
  }

  for (const target of draftTargets) config = setTarget(config, target.name, target.activeDir);
  for (const source of draftSources) config = setSource(config, source.name, source.skillsDir);
  saveConfig(config);
  success("配置已保存");
  kv("配置文件", pathText(configPath()));
  next("建议先执行 workflow-switcher doctor 检查路径和软链接权限。");
  next("检查通过后执行 workflow-switcher use 选择并切换工作流。");
  return config;
}

/**
 * setup 向导：首次初始化直接收集；已有配置时先给出维护菜单。
 */
async function runSetup() {
  let config = loadConfig();
  const rl = createPrompt();
  try {
    banner("初始化本机工作流切换配置");
    if (!hasAnyConfig(config)) {
      info("先配置工具读取 skills 的目录，再配置可切换的工作流目录。");
      await collectSetupDraft(rl, config, { target: true, source: true });
      return;
    }

    printSetupOverview(config);
    const action = await askSelect(rl, "请选择下一步", [
      { label: "继续使用现有配置", value: "keep" },
      { label: "添加或更新工具目录", value: "target" },
      { label: "添加或更新工作流", value: "source" },
      { label: "重新配置", value: "reset" },
      { label: "退出", value: "exit" },
    ]);

    if (action === "keep") {
      success("保留现有配置");
      info("可以执行 workflow-switcher doctor 检查环境，或执行 workflow-switcher use 切换工作流。");
      return;
    }
    if (action === "exit") return;
    if (action === "target") {
      await collectSetupDraft(rl, config, { target: true, source: false });
      return;
    }
    if (action === "source") {
      await collectSetupDraft(rl, config, { target: false, source: true });
      return;
    }
    if (action === "reset") {
      const confirmed = await askConfirm(rl, "重新配置只会覆盖 workflow-switcher 配置，不会删除真实工作流目录或工具目录。是否继续？", false);
      if (!confirmed) {
        warn("已取消重新配置，现有配置未改变。");
        return;
      }
      await collectSetupDraft(rl, { version: config.version, sources: {}, targets: {} }, { target: true, source: true });
    }
  } finally {
    closePrompt(rl);
  }
}

/**
 * 打印 source 列表。
 * @param {object} config 配置对象。
 */
function printSources(config) {
  const entries = Object.entries(config.sources);
  if (entries.length === 0) return warn("暂无工作流，请执行 workflow-switcher source add");
  section("工作流");
  table(
    ["名称", "skills 源目录", "忽略"],
    entries.map(([name, source]) => [nameText(name), pathText(source.skillsDir), source.ignoredSkills?.length || 0]),
  );
}

/**
 * 打印指定 source 的忽略 skill 列表。
 * @param {object} config 配置对象。
 * @param {string} sourceName source 名称。
 */
function printIgnoredSkills(config, sourceName) {
  const source = config.sources[validateName(sourceName, "source")];
  if (!source) throw new Error(`未知 source: ${sourceName}`);
  const ignoredSkills = source.ignoredSkills || [];
  section(`忽略 skills: ${sourceName}`);
  if (ignoredSkills.length === 0) {
    info("当前没有忽略任何 skill。");
    return;
  }
  table(["skill name"], ignoredSkills.map((skillName) => [nameText(skillName)]));
}

/**
 * 执行 source ignore 子命令。
 * @param {string[]} args 子命令参数。
 */
function runSourceIgnore(args) {
  const [action, sourceName, ...skillNames] = args;
  if (!action) throw new Error("source ignore 缺少操作: list/add/remove/clear");
  if (!sourceName) throw new Error("source ignore 缺少工作流名称");
  let config = loadConfig();

  if (action === "list") return printIgnoredSkills(config, sourceName);
  if (action === "add") {
    if (skillNames.length === 0) throw new Error("source ignore add 至少需要一个 skill name");
    config = addIgnoredSkills(config, sourceName, skillNames);
    saveConfig(config);
    printIgnoredSkills(config, sourceName);
    next(`执行 workflow-switcher use ${sourceName} 让忽略列表生效。`);
    return success("忽略列表已更新");
  }
  if (action === "remove") {
    if (skillNames.length === 0) throw new Error("source ignore remove 至少需要一个 skill name");
    config = removeIgnoredSkills(config, sourceName, skillNames);
    saveConfig(config);
    printIgnoredSkills(config, sourceName);
    next(`执行 workflow-switcher use ${sourceName} 恢复关联。`);
    return success("忽略列表已更新");
  }
  if (action === "clear") {
    config = setIgnoredSkills(config, sourceName, []);
    saveConfig(config);
    printIgnoredSkills(config, sourceName);
    next(`执行 workflow-switcher use ${sourceName} 恢复全部关联。`);
    return success("忽略列表已清空");
  }
  throw new Error(`未知 source ignore 操作: ${action}`);
}

/**
 * 打印 target 列表。
 * @param {object} config 配置对象。
 */
function printTargets(config) {
  const entries = Object.entries(config.targets);
  if (entries.length === 0) return warn("暂无工具目录，请执行 workflow-switcher target add");
  section("工具目录");
  table(["名称", "skills 目录"], entries.map(([name, target]) => [nameText(name), pathText(target.activeDir)]));
}

/**
 * 选择操作目标 target；未传 --target 且有多个 target 时进入交互选择。
 * @param {object} config 配置对象。
 * @param {string[]} requested 请求 target。
 * @param {string} message 交互选择提示。
 * @returns {Promise<string[]>} target 名称列表。
 */
async function selectTargetsForAction(config, requested, message) {
  if (requested.length > 0) return resolveTargetNames(config, requested);
  const names = resolveTargetNames(config, []);
  if (names.length <= 1) return names;
  const rl = createPrompt();
  try {
    return askMultiSelect(rl, message, toChoices(names));
  } finally {
    closePrompt(rl);
  }
}

/**
 * 选择 use 命令的 source；命令未传 source 时进入交互选择。
 * @param {object} config 配置对象。
 * @param {string} requested 请求 source。
 * @returns {Promise<string>} source 名称。
 */
async function selectSourceForUse(config, requested) {
  if (requested) return requested;
  const names = Object.keys(config.sources);
  if (names.length === 0) throw new Error("未配置可用工作流，请先执行 workflow-switcher source add");
  const rl = createPrompt();
  try {
    return askSelect(rl, "请选择工作流", toChoices(names));
  } finally {
    closePrompt(rl);
  }
}

/**
 * 执行 use 命令。
 * @param {string} sourceName source 名称。
 * @param {object} options 命令选项。
 */
async function runUse(sourceName, options) {
  const config = loadConfig();
  const selectedSourceName = await selectSourceForUse(config, sourceName);
  const targetNames = await selectTargetsForAction(config, options.target, "请选择要切换的工具目录");
  if (targetNames.length === 0) throw new Error("未配置可用工具目录");
  const results = spin(`切换到工作流 ${selectedSourceName}`, () => switchSource(config, selectedSourceName, targetNames), "工作流切换完成");
  for (const result of results) {
    section(`结果: ${result.targetName}`);
    table(
      ["项目", "结果"],
      [
        ["工作流", result.sourceName],
        ["skills 目录", pathText(result.activeDir)],
        ["skills", result.skills],
        ["根附属项", result.rootAdjuncts],
        ["新建", result.created.length],
        ["复用", result.unchanged.length],
        ["移除", result.removed.length],
      ],
    );
    for (const warning of result.warnings) warn(`[${result.targetName}] ${warning}`);
  }
  info("切换完成后，请新开对应智能体会话或重启客户端，让 skills 列表刷新。");
}

/**
 * 执行 clear 命令。
 * @param {object} options 命令选项。
 */
async function runClear(options) {
  const config = loadConfig();
  const targetNames = await selectTargetsForAction(config, options.target, "请选择要清空的工具目录");
  if (targetNames.length === 0) throw new Error("未配置可用工具目录");
  const results = spin("清空当前工作流关联", () => clearTargets(config, targetNames), "工作流关联已清空");
  for (const result of results) {
    section(`结果: ${result.targetName}`);
    table(
      ["项目", "结果"],
      [
        ["原工作流", result.previousSource || "未选择或使用工作流"],
        ["skills 目录", pathText(result.activeDir)],
        ["移除", result.removed.length],
        ["已不存在", result.missing.length],
      ],
    );
  }
  info("清空完成后，请新开对应智能体会话或重启客户端，让 skills 列表刷新。");
}

/**
 * 打印当前状态。
 * @param {boolean} verbose 是否输出配置列表。
 */
function printCurrent(verbose = false) {
  const config = loadConfig();
  banner("当前配置与切换状态");
  if (verbose) {
    kv("配置文件", pathText(configPath()));
    printSources(config);
    printTargets(config);
  }
  if (Object.keys(config.targets).length === 0) {
    warn("暂无工具目录，请先执行 workflow-switcher target add");
    return;
  }
  const rows = [];
  for (const [name, target] of Object.entries(config.targets)) {
    const state = readState(target.activeDir);
    rows.push([nameText(name), state.currentSource || "未选择或使用工作流", pathText(target.activeDir)]);
  }
  section("当前状态");
  table(["工具", "当前工作流", "skills 目录"], rows);
}

/**
 * CLI 主入口。
 * @param {string[]} argv 参数列表。
 */
export async function main(argv = []) {
  const parsed = parseArgs(argv);
  const command = normalizeCommand(parsed.command);
  try {
    if (!command) return await runMenu();
    if (command === "help" || command === "--help" || command === "-h") return printHelp();
    if (command === "setup") return await runSetup();

    if (command === "source") {
      const [sub, name, dir] = parsed.args;
      let config = loadConfig();
      if (sub === "ignore") return runSourceIgnore(parsed.args.slice(1));
      if (sub === "add") {
        if (name && dir) validateAndPrintSource(dir);
        config = name && dir ? setSource(config, name, dir) : await interactiveAddSource(config);
        saveConfig(config);
        return success(`工作流已保存: ${name || "(交互输入)"}`);
      }
      if (sub === "list") return printSources(config);
      if (sub === "remove") {
        config = removeSource(config, name);
        saveConfig(config);
        return success(`工作流已删除: ${name}`);
      }
    }

    if (command === "target") {
      const [sub, name, dir] = parsed.args;
      let config = loadConfig();
      if (sub === "add") {
        config = name && dir ? setTarget(config, name, dir) : await interactiveAddTarget(config);
        saveConfig(config);
        return success(`工具目录已保存: ${name || "(交互输入)"}`);
      }
      if (sub === "list") return printTargets(config);
      if (sub === "remove") {
        config = removeTarget(config, name);
        saveConfig(config);
        return success(`工具目录已删除: ${name}`);
      }
    }

    if (command === "use") return await runUse(parsed.args[0], parsed.options);
    if (command === "clear") {
      if (parsed.args.length > 0) throw new Error("clear 不接受位置参数，请使用 --target 指定工具目录");
      return await runClear(parsed.options);
    }
    if (command === "current") return printCurrent(false);
    if (command === "status") return printCurrent(true);
    if (command === "doctor") {
      const config = loadConfig();
      return printDoctor(spin("检查配置、路径和软链接权限", () => runDoctor(config, configPath()), "诊断完成"));
    }

    throw new Error(`未知命令: ${parsed.command}`);
  } catch (error) {
    const message = /force closed the prompt|SIGINT/i.test(error.message) ? "用户取消了当前操作。" : error.message;
    failure("操作失败");
    errorKv("原因", message);
    printResolution(new Error(message));
    process.exitCode = 1;
  }
}
