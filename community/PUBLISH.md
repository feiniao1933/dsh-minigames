# 发布状态 / Publishing status

## 发布渠道

- **Open Plugin Market（dshopen.org）**：已提交收录申请（Git 固定提交来源），等待维护者审查
  - Issue：https://github.com/polang233/dsh-plugin-index/issues/413
  - 版本 1.1.0（新增打飞机），固定提交 `b8c0c8999f2ccbbb4251d01a37161dc72f209dfb`
- **awesome-dsh-plugin（dsh-market 目录）**：已提交单文件 PR，等待 CI / 维护者
  - PR：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/14033
  - 条目：`data/plugins/feiniao1933__dsh-minigames.yml`（category `ui`）
- **npm**：未发布（本机未登录 npm；Git 固定提交来源已满足 dshopen 要求）

## 已完成

- 公开源码仓库：https://github.com/feiniao1933/dsh-minigames
- 发布用包：`dsh-minigames@1.1.0`，MIT，`repository` / `engines.dsh` / `dsh.bundle.patch` / `LICENSE` 齐全
- `client.js` 构建产物入库；`npm pack` 校验通过
- 引擎测试 156 断言、UI 冒烟测试通过
- 当前 profile 已安装并验证（右面板标签、输入框工具栏入口、庆祝层均 active）
- GitHub 安装验证通过：临时 `DSH_HOME` 中新 profile 执行
  `dsh plugin --profile mgtest add github:feiniao1933/dsh-minigames`，
  安装 `dsh-minigames 1.0.0`，`--dump-config` 中出现 `# == dsh-minigames` / `minigames-box`
- 已推送标签 `v1.0.0`，仓库 topics 含 `dsh-plugin`

## 待办

- [x] dshopen 收录申请 Issue（`[plugin-add] dsh-minigames`）
- [x] awesome-dsh-plugin 单文件 PR
- [x] 1.1.0：新增微信经典「打飞机」小游戏 + 游戏架切换
- [ ] 等 awesome CI 的仓库年龄 gate（仓库 2026-11-10 创建，约 24h 后可复跑）
- [ ] 补充打飞机与获胜庆祝的截图
- [x] 真实使用截图：`screenshots/game-page.png`（通过 `screenshots.json` 声明），并在 dshopen Issue 评论中提供链接
- [ ] 补充获胜庆祝动画截图
- [ ] 可选：npm 登录后 `npm publish --access public`
