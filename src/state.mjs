/**
 * target 状态文件管理。
 * by AI.Coding
 */
import path from "node:path";
import { CONFIG_VERSION, STATE_FILE } from "./constants.mjs";
import { readJson, writeJson } from "./fs-utils.mjs";

/**
 * 获取 target 状态文件路径。
 * @param {string} activeDir target active skills 目录。
 * @returns {string} 状态文件路径。
 */
export function statePath(activeDir) {
  return path.join(activeDir, STATE_FILE);
}

/**
 * 创建空状态对象。
 * @returns {object} 空状态。
 */
export function emptyState() {
  return { version: CONFIG_VERSION, currentSource: null, managed: [], managedRootEntries: [] };
}

/**
 * 读取 target 状态文件，缺失时返回空状态。
 * @param {string} activeDir target active skills 目录。
 * @returns {object} 状态对象。
 */
export function readState(activeDir) {
  const payload = readJson(statePath(activeDir), emptyState());
  return {
    version: payload.version || CONFIG_VERSION,
    target: payload.target || null,
    currentSource: payload.currentSource || null,
    sourceDir: payload.sourceDir || payload.source || null,
    updatedAt: payload.updatedAt || null,
    managed: Array.isArray(payload.managed) ? payload.managed : [],
    managedRootEntries: Array.isArray(payload.managedRootEntries) ? payload.managedRootEntries : [],
  };
}

/**
 * 写入 target 状态文件。
 * @param {string} activeDir target active skills 目录。
 * @param {object} state 状态对象。
 */
export function writeState(activeDir, state) {
  writeJson(statePath(activeDir), { version: CONFIG_VERSION, ...state });
}

/**
 * 把 target 状态重置为未选择工作流，并保留状态文件供后续安全管理。
 * @param {string} activeDir target active skills 目录。
 * @param {string} targetName target 名称。
 * @returns {object} 已写入的空状态。
 */
export function clearTargetState(activeDir, targetName) {
  const state = {
    target: targetName,
    currentSource: null,
    sourceDir: null,
    updatedAt: new Date().toISOString(),
    managed: [],
    managedRootEntries: [],
  };
  writeState(activeDir, state);
  return state;
}

/**
 * 把投影条目转换成状态文件条目。
 * @param {Array} entries 投影条目。
 * @returns {Array} 状态条目。
 */
export function toStateEntries(entries) {
  return entries.map((entry) => ({
    kind: entry.kind,
    name: entry.name,
    target: entry.target,
    relativeTarget: entry.relativeTarget,
  }));
}
