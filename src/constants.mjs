/**
 * Workflow Switcher 全局常量。
 * by AI.Coding
 */

// 状态文件名称固定放在每个 target active skills 目录中。
export const STATE_FILE = ".workflow-switcher.json";

// 配置版本从新的 sources/targets 模型开始计为 3，不兼容旧 v2。
export const CONFIG_VERSION = 3;

// 内置的只是常见 target 名称，路径必须由用户手动输入。
export const BUILTIN_TARGET_NAMES = ["codex", "claude"];

// 保留当前项目已有的 workflow 根目录标记，用来判断是否需要投影根附属项。
export const AUTO_ROOT_MARKERS = [
  "WORKFLOW.md",
  "WORKFLOW-DETAILS.md",
  "TEMPLATE-STANDARD.md",
  ".best-practices",
  ".scripts",
  "templates",
];

// 一旦命中根目录标记，就把这些存在的共享依赖一起作为根附属项投影。
export const AUTO_ROOT_OPTIONAL_ENTRIES = ["README.md", ...AUTO_ROOT_MARKERS];

// 命令名和特殊参数不能作为 source/target 名称，避免解析歧义。
export const RESERVED_NAMES = new Set([
  "setup",
  "source",
  "workflow",
  "target",
  "tool",
  "use",
  "clear",
  "current",
  "status",
  "doctor",
  "help",
  "all",
]);
