# dshopen.org 收录申请

已提交：https://github.com/polang233/dsh-plugin-index/issues/413

## 标题

```text
[plugin-add] dsh-minigames
```

## 插件地址 / Plugin link

Git 来源（暂未发布 npm）：

```text
仓库：https://github.com/feiniao1933/dsh-minigames
版本：1.4.2
提交：ea96febe330e276d6811770899a50302c628dfda
路径：仓库根目录
```

## 简短说明 / Summary

中文：

```text
在 DSH 网页右侧面板加入「游戏盒子」标签页，内置人机五子棋：简单 / 普通 / 困难三档难度、Web Audio 合成的落子音效、悔棋与重开、本机胜平负战绩。你获胜时会播放全窗口彩带 + 烟花 + 奖杯庆祝动画。面板页与 DSH 的「开始」页同款排版，可通过输入框工具栏的小棋盘按钮或开始页胶囊打开；颜色用主题变量，文案跟随界面语言。
```

English:

```text
Adds a "mini games box" tab to the DSH Web right sidebar with two built-in games: a Gomoku match at easy / normal / hard AI with undo, restart and a local tally plus a frame-wide confetti/fireworks/trophy celebration on a win; and a WeChat-style sky-shooter remake (drag or arrow keys, auto-fire, three lives, several enemy types — fighters and heavy bombers shoot back — particle explosions, local best score). Placement and arcade sounds are synthesized with Web Audio and can be muted. The page mirrors the right sidebar's Start-page layout and opens from a small board button in the composer toolbar or the Start-page capsule; colours use the host theme tokens and copy follows the interface language.
```

## 截图 / Screenshots

暂不提供（本机无法对已登录页面截图）。建议补充 1–2 张：游戏页（棋盘 + 难度选择 + 音效按钮）与获胜庆祝动画，均不含账号信息。

## 补充信息 / Additional details

```text
Logo：包内 icon.svg（也通过 ./icon 导出）
测试版本：DSH 0.2.2-rc.1，macOS，Web 客户端
许可证：MIT（仓库内有 LICENSE）
安装（固定提交）：dsh plugin --profile web add 'github:feiniao1933/dsh-minigames#ea96febe330e276d6811770899a50302c628dfda'
安全：纯 Client 插件，无 webServer 路由、无网络请求、无凭据读写；只写入 3 个 localStorage 偏好键（战绩 / 难度 / 音效）。
```
