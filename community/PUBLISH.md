# 发布状态 / Publishing status

## 发布渠道

- **Open Plugin Market（dshopen.org）**：已提交收录申请（Git 固定提交来源），等待维护者审查
  - Issue：https://github.com/polang233/dsh-plugin-index/issues/413
  - 版本 1.0.0，固定提交 `fd0f69cc53d49a652a78da3a16e4a4adcc174931`
- **awesome-dsh-plugin（dsh-market 目录）**：已提交单文件 PR，等待 CI / 维护者
  - PR：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/14033
  - 条目：`data/plugins/feiniao1933__dsh-minigames.yml`（category `ui`）
- **npm**：未发布（本机未登录 npm；Git 固定提交来源已满足 dshopen 要求）

## 已完成

- 公开源码仓库：https://github.com/feiniao1933/dsh-minigames
- 发布用包：`dsh-minigames@1.0.0`，MIT，`repository` / `engines.dsh` / `dsh.bundle.patch` / `LICENSE` 齐全
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
- [ ] 等 awesome CI 的仓库年龄 gate（仓库 2026-11-10 创建，约 24h 后可复跑）
- [ ] 用真实使用截图补充到 Issue / 市场详情
- [ ] 可选：npm 登录后 `npm publish --access public`
