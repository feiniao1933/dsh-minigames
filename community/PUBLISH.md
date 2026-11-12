# 发布状态 / Publishing status

## 发布渠道

- **Open Plugin Market（dshopen.org）**：✅ 已收录（2026-11-12 维护者确认按 **1.4.3** 收录）
  - 插件页：https://dshopen.org/zh/plugins/dsh-minigames/
  - 收录 Issue（已关闭，可继续回复升版）：https://github.com/polang233/dsh-plugin-index/issues/413
  - 已提交 **1.4.4 升级请求**（1.4.3 有「肥鱼大冒险」启动卡死 bug，1.4.4 已修复）：https://github.com/polang233/dsh-plugin-index/issues/413#issuecomment-6825090492
  - 版本 1.4.4（修复肥鱼大冒险启动卡死 + 改名），固定提交 `da20544b2d8d7c34b43d282a32810da0177002f4`
- **awesome-dsh-plugin（dsh-market 目录）**：✅ PR 已合并收录（2026-11-12）
  - PR：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/14033
  - 维护者把分类从 `ui` 调整为 `fun`；条目：`data/plugins/feiniao1933__dsh-minigames.yml`
- **npm**：未发布（本机未登录 npm；Git 固定提交来源已满足 dshopen 要求）

## 已完成

- 公开源码仓库：https://github.com/feiniao1933/dsh-minigames
- 发布用包：`dsh-minigames@1.4.4`，MIT，`repository` / `engines.dsh` / `dsh.bundle.patch` / `LICENSE` 齐全
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
- [x] awesome-dsh-plugin PR 已合并
- [ ] 等 dshopen 按 1.4.4 复核升版
- [x] 1.1.1：打飞机改为微信极简画风，修复结束画面抖动与游戏画面遮挡
- [x] 1.2.0：敌机开火（战斗机瞄准射击、重型机三向散射），新增 31 项弹幕测试
- [x] 1.2.1：更换游戏盒子图标（白色手柄 + 深蓝底），标签页/开始页/工具栏同步
- [x] 1.3.0：五子棋进度记忆（刷新/重开后自动恢复棋局、胜负与耗时）
- [x] 1.4.0：新增第三个游戏「鲸鱼飞飞」（海底 Flappy Bird，鲸鱼形象，鼠标/键盘控制），图标放大
- [x] 1.4.1：打飞机与鲸鱼飞飞画面加宽（360×600 → 540×600），填满侧栏宽度
- [x] 1.4.2：游戏改名——打飞机 → 飞机大战、鲸鱼飞飞 → 鲸鱼飞跃
- [x] 1.4.3：鲸鱼改为水下漂浮手感（慢重力/软拍翅/倾斜缓动/待机浮沉/尾迹气泡）
- [x] 1.4.4：改名「肥鱼大冒险」；修复启动卡死（绘制函数残留未定义变量导致 rAF 循环中断），并为两个画布游戏加单帧异常兜底
- [ ] 补充打飞机与获胜庆祝的截图
- [x] 真实使用截图：`screenshots/game-page.png`（通过 `screenshots.json` 声明），并在 dshopen Issue 评论中提供链接
- [ ] 补充获胜庆祝动画截图
- [ ] 可选：npm 登录后 `npm publish --access public`
