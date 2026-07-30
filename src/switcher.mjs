/**
 * workflow 切换核心逻辑。
 * by AI.Coding
 */
import fs from "node:fs";
import path from "node:path";
import { assertWritableDir, linkTarget, lstatMaybe, realpathMaybe } from "./fs-utils.mjs";
import { discoverSource, assertNoDuplicateNames } from "./scanner.mjs";
import { clearTargetState, readState, toStateEntries, writeState } from "./state.mjs";
import { assertSymlinkCapability, createSymlink, symlinkMatches } from "./symlink.mjs";
import { isInsidePath } from "./paths.mjs";

/**
 * 解析 target 名称列表，all 表示所有启用 target。
 * @param {object} config 配置对象。
 * @param {string[]} requested 用户请求 target。
 * @returns {string[]} target 名称列表。
 */
export function resolveTargetNames(config, requested = []) {
  if (requested.length === 0) return Object.keys(config.targets).filter((name) => config.targets[name].enabled !== false);
  if (requested.includes("all")) return Object.keys(config.targets).filter((name) => config.targets[name].enabled !== false);
  return requested;
}

/**
 * 检查状态记录中的条目是否允许被当前工具清理。
 * @param {object} item 状态条目。
 * @param {object} config 配置对象。
 * @returns {boolean} 是否允许清理。
 */
function isManagedTargetAllowed(item, config) {
  const expected = realpathMaybe(item.target);
  if (!expected) return false;
  return Object.values(config.sources).some((source) => {
    const sourceRoot = realpathMaybe(source.skillsDir);
    return sourceRoot && isInsidePath(expected, sourceRoot);
  });
}

/**
 * 清理上一次状态文件记录的受控 symlink。
 * @param {string} activeDir target active skills 目录。
 * @param {object} config 配置对象。
 * @param {object} state target 状态。
 * @param {Set<string>} keepNames 本次无需删除的名称。
 * @returns {{removed:string[],warnings:string[]}} 清理结果。
 */
function removeManagedSymlinks(activeDir, config, state, keepNames = new Set()) {
  const removed = [];
  const warnings = [];
  for (const item of [...state.managed, ...state.managedRootEntries]) {
    if (!item?.name || keepNames.has(item.name)) continue;
    const activePath = path.join(activeDir, item.name);
    const stat = lstatMaybe(activePath);
    if (!stat) continue;
    if (!stat.isSymbolicLink()) {
      warnings.push(`跳过 ${activePath}: 不是符号链接`);
      continue;
    }
    const currentTarget = realpathMaybe(linkTarget(activePath));
    if (currentTarget !== realpathMaybe(item.target) || !isManagedTargetAllowed(item, config)) {
      warnings.push(`跳过 ${activePath}: 当前链接目标不属于受控 source`);
      continue;
    }
    // 只删除状态文件记录且目标仍可信的 symlink，避免误删用户文件。
    fs.unlinkSync(activePath);
    removed.push(item.name);
  }
  return { removed, warnings };
}

/**
 * 校验单个 target 的受控链接是否可以安全清空。
 * @param {object} config 配置对象。
 * @param {string} targetName target 名称。
 * @returns {{targetName:string,activeDir:string,state:object,removable:Array,missing:string[]}} 清空计划。
 */
export function preflightClearTarget(config, targetName) {
  const target = config.targets[targetName];
  if (!target) throw new Error(`未知 target: ${targetName}`);
  if (!fs.existsSync(target.activeDir)) throw new Error(`target 路径不存在: ${target.activeDir}`);
  assertWritableDir(target.activeDir);

  const state = readState(target.activeDir);
  const entries = [...state.managed, ...state.managedRootEntries];
  const removable = [];
  const missing = [];
  const seenNames = new Set();
  const activeRoot = path.resolve(target.activeDir);

  for (const item of entries) {
    if (!item?.name || !item?.target) {
      throw new Error(`${target.activeDir} 的状态文件包含无效受控项，已停止清空`);
    }
    if (seenNames.has(item.name)) {
      throw new Error(`${target.activeDir} 的状态文件包含重复受控项 ${item.name}，已停止清空`);
    }
    seenNames.add(item.name);

    const activePath = path.resolve(activeRoot, item.name);
    if (path.dirname(activePath) !== activeRoot) {
      throw new Error(`${target.activeDir} 的状态文件包含越界受控项 ${item.name}，已停止清空`);
    }

    const stat = lstatMaybe(activePath);
    if (!stat) {
      missing.push(item.name);
      continue;
    }
    if (!stat.isSymbolicLink()) {
      throw new Error(`${activePath} 不是本工具受控项: 当前内容不是符号链接，已停止清空`);
    }

    const currentTarget = realpathMaybe(linkTarget(activePath));
    const expectedTarget = realpathMaybe(item.target);
    if (!currentTarget || !expectedTarget || currentTarget !== expectedTarget) {
      throw new Error(`${activePath} 不是本工具受控项: 当前链接目标与状态记录不一致，已停止清空`);
    }
    if (!isManagedTargetAllowed(item, config)) {
      throw new Error(`${activePath} 不是本工具受控项: 当前链接目标不属于已配置 source，已停止清空`);
    }
    removable.push({ name: item.name, activePath });
  }

  return { targetName, activeDir: target.activeDir, state, removable, missing };
}

/**
 * 执行已经通过预检的单 target 清空计划。
 * @param {{targetName:string,activeDir:string,state:object,removable:Array,missing:string[]}} plan 清空计划。
 * @returns {object} 清空结果。
 */
function executeClearPlan(plan) {
  for (const item of plan.removable) fs.unlinkSync(item.activePath);
  clearTargetState(plan.activeDir, plan.targetName);
  return {
    targetName: plan.targetName,
    activeDir: plan.activeDir,
    previousSource: plan.state.currentSource,
    removed: plan.removable.map((item) => item.name),
    missing: plan.missing,
  };
}

/**
 * 清空单个 target 当前受控工作流。
 * @param {object} config 配置对象。
 * @param {string} targetName target 名称。
 * @returns {object} 清空结果。
 */
export function clearOneTarget(config, targetName) {
  return executeClearPlan(preflightClearTarget(config, targetName));
}

/**
 * 清空多个 target；先完成全部预检，避免已知冲突导致部分 target 被清空。
 * @param {object} config 配置对象。
 * @param {string[]} targetNames target 名称列表。
 * @returns {Array} 清空结果列表。
 */
export function clearTargets(config, targetNames) {
  const uniqueTargetNames = [...new Set(targetNames)];
  const plans = uniqueTargetNames.map((targetName) => preflightClearTarget(config, targetName));
  return plans.map((plan) => executeClearPlan(plan));
}

/**
 * 检查是否存在非受控同名冲突。
 * @param {string} activeDir target active skills 目录。
 * @param {Array} desiredEntries 本次需要创建的条目。
 * @param {object} state target 状态。
 */
function assertNoUnmanagedConflicts(activeDir, desiredEntries, state) {
  const managedByName = new Map([...state.managed, ...state.managedRootEntries].map((item) => [item.name, item]));
  for (const entry of desiredEntries) {
    const activePath = path.join(activeDir, entry.name);
    const stat = lstatMaybe(activePath);
    if (!stat) continue;
    if (symlinkMatches(activePath, entry.target)) continue;
    const managedItem = managedByName.get(entry.name);
    const currentTarget = stat.isSymbolicLink() ? realpathMaybe(linkTarget(activePath)) : null;
    const expectedTarget = managedItem ? realpathMaybe(managedItem.target) : null;
    // 只有磁盘链接仍指向状态文件记录的目标时，才允许后续清理并重建。
    if (managedItem && currentTarget && expectedTarget && currentTarget === expectedTarget) continue;
    throw new Error(`${activePath} 已存在且不是本工具受控项，请先手动处理`);
  }
}

/**
 * 执行切换前检查，所有检查通过后才允许清理旧链接。
 * @param {string} sourceName source 名称。
 * @param {object} source source 配置。
 * @param {string} targetName target 名称。
 * @param {object} target target 配置。
 * @param {object} config 全局配置。
 * @returns {{discovered:object,state:object}} 检查结果。
 */
export function preflightSwitch(sourceName, source, targetName, target, config) {
  if (!source) throw new Error(`未知 source: ${sourceName}`);
  if (!target) throw new Error(`未知 target: ${targetName}`);
  if (!fs.existsSync(source.skillsDir)) throw new Error(`source 路径不存在: ${source.skillsDir}`);

  const discovered = discoverSource(source.skillsDir, { ignoredSkills: source.ignoredSkills });
  assertNoDuplicateNames(discovered, source.skillsDir);
  assertWritableDir(target.activeDir);
  assertSymlinkCapability(target.activeDir);
  const state = readState(target.activeDir);
  assertNoUnmanagedConflicts(target.activeDir, discovered.entries, state);
  return { discovered, state };
}

/**
 * 把 source 切换到单个 target。
 * @param {object} config 配置对象。
 * @param {string} sourceName source 名称。
 * @param {string} targetName target 名称。
 * @returns {object} 切换结果。
 */
export function switchOneTarget(config, sourceName, targetName) {
  const source = config.sources[sourceName];
  const target = config.targets[targetName];
  const { discovered, state } = preflightSwitch(sourceName, source, targetName, target, config);
  const desiredNames = new Set(discovered.entries.map((entry) => entry.name));
  const keepNames = new Set(
    discovered.entries
      .filter((entry) => symlinkMatches(path.join(target.activeDir, entry.name), entry.target))
      .map((entry) => entry.name),
  );
  const removal = removeManagedSymlinks(target.activeDir, config, state, keepNames);
  const created = [];

  for (const entry of discovered.entries) {
    const activePath = path.join(target.activeDir, entry.name);
    if (keepNames.has(entry.name)) continue;
    if (lstatMaybe(activePath)) {
      // 预检和清理后仍存在同名条目时停止，避免误删用户文件或被篡改链接。
      throw new Error(`${activePath} 仍然存在，已停止创建新链接`);
    }
    createSymlink(entry.target, activePath);
    created.push(entry.name);
  }

  writeState(target.activeDir, {
    target: targetName,
    currentSource: sourceName,
    sourceDir: source.skillsDir,
    updatedAt: new Date().toISOString(),
    managed: toStateEntries(discovered.skills),
    managedRootEntries: toStateEntries(discovered.rootAdjuncts),
  });

  return {
    targetName,
    sourceName,
    activeDir: target.activeDir,
    skills: discovered.skills.length,
    rootAdjuncts: discovered.rootAdjuncts.length,
    removed: removal.removed,
    created,
    unchanged: [...keepNames].filter((name) => desiredNames.has(name)),
    warnings: removal.warnings,
  };
}

/**
 * 把 source 切换到多个 target。
 * @param {object} config 配置对象。
 * @param {string} sourceName source 名称。
 * @param {string[]} targetNames target 名称列表。
 * @returns {Array} 切换结果列表。
 */
export function switchSource(config, sourceName, targetNames) {
  return targetNames.map((targetName) => switchOneTarget(config, sourceName, targetName));
}
