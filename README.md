# Workflow Switcher

一个用于切换本机 agent skills 工作流的跨平台 CLI。

当你同时维护多套业务工作流时，把所有 skills 都放进 Codex、Claude 等工具目录，容易触发错误的 workflow。Workflow Switcher 只把当前选择的那一套工作流通过软链接关联到工具目录，让每个工具在同一时间只看到需要的 skills。

支持 macOS 和 Windows。只使用软链接，不会自动 copy，也不会降级为 junction。

## 效果预览

安装完成后会明确告诉你安装位置、命令入口和下一步操作：

```text
✅ Workflow Switcher 安装完成

安装位置
  应用目录: /Users/you/.workflow-switcher/app
  命令入口: /Users/you/.local/bin/workflow-switcher

下一步
  workflow-switcher setup
```

初始化时会用选择菜单完成配置，保存前会展示汇总：

```text
🧭 第 1 步：添加工具目录
请输入 Codex 对应的 skills 目录路径

📋 配置汇总
类型      名称    路径                                      检测结果
工具目录  codex   /Users/you/.codex/skills                  -
工作流    V5      /Users/you/workspace/team-a/skills         12 skills / 3 共享项

🎯 是否保存以上配置
  是
  否
```

切换失败时会同时给出原因和处理方式：

```text
❌ 操作失败
  原因: 无法创建符号链接
🔐 处理方式: Windows 请开启 Developer Mode，或让管理员授予 Create symbolic links 权限，或以管理员身份运行终端。
```

## 快速安装

需要 Node.js 20.17 或更高的 LTS 版本，推荐 Node.js 22 LTS。

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/yangquanyun/workflow-switcher/main/scripts/install.sh | bash
```

Windows PowerShell：

建议右键 PowerShell，选择“以管理员身份运行”后再执行。安装本身通常不需要管理员权限，但后续 `doctor` 和 `use` 需要创建软链接；如果没有开启 Developer Mode，也没有管理员权限，切换时可能会失败。

```powershell
irm https://raw.githubusercontent.com/yangquanyun/workflow-switcher/main/scripts/install.ps1 | iex
```

安装成功后执行：

```bash
workflow-switcher setup
```

安装脚本会输出安装位置、命令入口、下一步命令。Windows 安装脚本会在需要时自动把命令目录写入用户 PATH；如果当前窗口没有立即生效，重新打开 PowerShell 后再执行 `workflow-switcher setup`。

## 三分钟上手

第 1 步，初始化配置：

```bash
workflow-switcher setup
```

向导会要求你配置两类目录：

- 工具目录：Codex、Claude 或其他工具实际读取 skills 的目录。
- 工作流目录：某套业务工作流的 skills 源目录，例如 `V5`、`ZW`。

填写完成后，向导会展示汇总表。只有在最后一步选择“是”后，才会写入配置文件。

如果本机已经有配置，`setup` 会先展示当前配置，再让你选择继续使用、添加工具目录、添加工作流、重新配置或退出。

第 2 步，检查环境：

```bash
workflow-switcher doctor
```

第 3 步，切换工作流：

```bash
workflow-switcher use
```

切换完成后，请新开对应 agent 会话，或重启对应客户端，让 skills 列表刷新。

## 日常使用

打开交互菜单：

```bash
workflow-switcher
```

初始化配置：

```bash
workflow-switcher setup
```

选择并切换工作流：

```bash
workflow-switcher use
```

指定工作流和工具目录：

```bash
workflow-switcher use V5 --target codex
```

清空当前工具目录中的受控工作流关联：

```bash
workflow-switcher clear --target codex
```

清空所有已启用工具目录中的受控工作流关联：

```bash
workflow-switcher clear --target all
```

切换到所有已启用工具目录：

```bash
workflow-switcher use ZW --target all
```

查看状态：

```bash
workflow-switcher status
```

检查路径和软链接权限：

```bash
workflow-switcher doctor
```

## 配置管理

`workflow` 是 `source` 的别名，`tool` 是 `target` 的别名。两套命令都可用，推荐团队文档里使用更直观的 `workflow` 和 `tool`。

添加工作流：

```bash
workflow-switcher workflow add V5 /path/to/v5/skills
```

添加工具目录：

```bash
workflow-switcher tool add codex /path/to/codex/skills
```

查看已配置工作流：

```bash
workflow-switcher workflow list
```

忽略当前不需要关联的 skill：

```bash
workflow-switcher workflow ignore add V5 figma-ui-spec shop-release-upload
workflow-switcher use V5 --target codex
```

恢复其中一个或多个 skill：

```bash
workflow-switcher workflow ignore remove V5 figma-ui-spec
workflow-switcher use V5 --target codex
```

查看或清空忽略列表：

```bash
workflow-switcher workflow ignore list V5
workflow-switcher workflow ignore clear V5
```

查看已配置工具目录：

```bash
workflow-switcher tool list
```

删除工作流配置：

```bash
workflow-switcher workflow remove V5
```

删除工具目录配置：

```bash
workflow-switcher tool remove codex
```

删除配置不会删除你的真实工作流目录，也不会删除 Codex、Claude 等工具目录。

## 目录概念

### 工具目录

工具目录是 Codex、Claude 或其他 agent 工具实际读取 skills 的目录。

Workflow Switcher 内置的只是 `codex`、`claude`、`自定义` 这几个名称选项，不会预填默认路径。每个人设备不同，路径必须由用户手动确认。

示例：

```text
工具: codex
skills 目录: 你本机 codex 实际读取 skills 的目录
```

### 工作流目录

工作流目录是一套待切换的 skills 源目录。名称完全自定义，不内置任何团队、业务或分类。

示例：

```text
工作流名称: V5
工作流 skills 源目录: /Users/yangqy/workspace/seeyon-new/ai-toolkit/skills
```

```text
工作流名称: ZW
工作流 skills 源目录: /Users/yangqy/workspace/1st/ai-toolkit/skills
```

### 忽略部分 skills

如果某个工作流目录里包含暂时用不到的 skills，可以按 `SKILL.md` frontmatter 中的 `name` 配置忽略。忽略项保存在对应工作流配置中，不会修改源目录文件。

```bash
workflow-switcher workflow ignore add V5 figma-ui-spec shop-release-upload
```

下次执行 `use` 时，被忽略的 skill 不会被软链接关联到工具目录；如果它之前已经由 Workflow Switcher 创建过软链接，也会在切换时被清理。

恢复时从忽略列表移除对应 name，再重新切换：

```bash
workflow-switcher workflow ignore remove V5 figma-ui-spec
workflow-switcher use V5 --target codex
```

清空忽略列表会恢复该工作流下全部 skills 的投影：

```bash
workflow-switcher workflow ignore clear V5
workflow-switcher use V5 --target codex
```

## 根目录共享项

工作流目录不仅可以包含 skill 子目录，也可以包含共享说明、模板和脚本。命中以下项目时，Workflow Switcher 会一起通过软链接关联到工具目录：

```text
README.md
WORKFLOW.md
WORKFLOW-DETAILS.md
TEMPLATE-STANDARD.md
.best-practices
.scripts
templates
```

## Windows 软链接权限

Windows 创建软链接需要系统权限。推荐在开始使用前先用“管理员 PowerShell”执行安装、`setup`、`doctor` 和 `use`。

如果不想每次使用管理员终端，也可以开启 Developer Mode。否则安装可能成功，但 `doctor` 或 `use` 在创建软链接时会失败。

如果已经遇到无法创建符号链接，请选择一种方式处理：

```text
1. 开启 Windows Developer Mode。
2. 让管理员授予 Create symbolic links 权限。
3. 以管理员身份运行终端。
```

修复后重新检查：

```bash
workflow-switcher doctor
```

## 安全规则

Workflow Switcher 只管理自己创建并记录的软链接。

每个工具目录中会写入：

```text
.workflow-switcher.json
```

后续切换时，只会清理这个状态文件中记录的受控项。如果工具目录里已经存在同名文件或目录，但不是 Workflow Switcher 管理的内容，切换会停止并提示你手动处理，避免误删。

`clear` 同样只清理状态文件记录且链接目标仍可信的受控软链接，不删除工作流配置、真实源目录或手工放入工具目录的内容。清空后状态文件会保留，当前工作流重置为“未选择或使用工作流”。如果任一受控项被改成普通文件、改指向其他目录或无法确认归属，清空会在删除前停止；使用 `--target all` 时会先检查全部工具目录，避免已知冲突造成部分清空。

清空完成后，请新开对应 agent 会话，或重启对应客户端，让 skills 列表刷新。

## 一键卸载

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/yangquanyun/workflow-switcher/main/scripts/uninstall.sh | bash
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/yangquanyun/workflow-switcher/main/scripts/uninstall.ps1 | iex
```

卸载会删除 Workflow Switcher 自身的安装目录、命令入口和配置目录，不会删除你的真实工作流目录，也不会删除 Codex、Claude 等工具目录。

## 本地开发

安装依赖：

```bash
npm install
```

运行 CLI：

```bash
node bin/workflow-switcher.mjs help
node bin/workflow-switcher.mjs setup
```

运行测试：

```bash
npm run check
npm test
```
