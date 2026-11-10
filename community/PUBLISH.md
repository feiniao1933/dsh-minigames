# 发布状态 / Publishing status

## 发布渠道

- **Open Plugin Market（dshopen.org）**：待提交（Git 固定提交来源）
- **awesome-dsh-plugin（dsh-market 目录）**：待提交（`data/plugins/feiniao1933__dsh-minigames.yml`）
- **npm**：未发布（本机未登录 npm；Git 来源已满足 dshopen 要求）

## 已完成

- 公开源码仓库：https://github.com/feiniao1933/dsh-minigames
- 发布用包：`dsh-minigames@1.0.0`，MIT，`repository` / `engines.dsh` / `dsh.bundle.patch` / `LICENSE` 齐全
- `client.js` 构建产物入库；`npm pack` 校验通过
- 引擎测试 156 断言、UI 冒烟测试通过
- 当前 profile 已安装并验证（右面板标签、输入框工具栏入口、庆祝层均 active）

## 待办

- [ ] dshopen 收录申请 Issue（`[plugin-add] dsh-minigames`）
- [ ] awesome-dsh-plugin 单文件 PR
- [ ] 用真实使用截图补充到 Issue / 市场详情
- [ ] 可选：npm 登录后 `npm publish --access public`
