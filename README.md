<!--
SPDX-FileCopyrightText: 2024-2026 Pagefault Games

SPDX-License-Identifier: CC-BY-NC-SA-4.0
-->

# 局域网联机（类宝可梦冠军模式）

**和朋友连上同一个局域网，自由组队、搭配招式与特性，然后直接来一场真人对战。** 本项目基于 PokéRogue beta **1.12.2.2**，主打省去长时间练级的组队 PVP，也保留肉鸽闯关、同种子竞速、灵魂同调和双人合作玩法。

这里的“类宝可梦冠军模式”指自由组队、统一等级、直接对战的玩法方向；不是官方《宝可梦 冠军》，也不代表完整复刻官方对战规则。

## 最重要的玩法：组好队，直接和朋友打

### 自由组队 PVP

| 能玩什么 | 实际规则 |
| --- | --- |
| **3v3 / 6v6** | 房主建房时选择队伍规模，每人选满 3 只或 6 只。是单打队伍战，不是同时派出 3 只或 6 只。 |
| **直接以 50 级开打** | 双方队伍统一等级，不必先在肉鸽里刷关练级。 |
| **自己决定阵容** | 在选队界面选择宝可梦及进化目标，调整特性、性格和 4 个招式槽位；招式来自游戏支持的可学池，不是任意招式全开放。 |
| **全图鉴开关** | 房主开启后，本场临时开放图鉴、普通/隐藏特性及性格选择；关闭时双方按房主的图鉴解锁快照组队。离开 PVP 后恢复原图鉴。 |
| **普通战 / 神战** | “神战”关闭时限制游戏规则中标记的神兽、幻兽，以及究极异兽、悖谬宝可梦等；开启后放开对应选人限制。它是本项目的规则开关，不是官方赛事分组。 |
| **持有物搭配** | 全队共享 **3 次道具分配额度**，在支持的树果、持有物、超级石及专属道具候选中做取舍；并非完整官方道具规则。 |
| **真人回合制对战** | 每回合选招式或换人，和对手交换指令后结算。对方队伍全部倒下即结束对局。 |
| **原房间再来一局** | 对局结束后可以继续留在房间，由双方确认后开始重赛，不必反复退出、重新连接。 |

**推荐第一局这样玩：** 房主选「PVP」→「3v3」→「全图鉴开启」→「神战关闭」。双方就绪后，房主启动游戏；各自选 3 只、定好进化/特性/性格/配招、分配持有物，然后开打。想玩更长的阵容博弈，再试 6v6；想放开强力宝可梦，再开启神战。

等级统一不等于完整数值归一化：个体值等仍受现有游戏数据影响。本项目沿用 PokéRogue 的招式、特性和道具实现，没有宣传为正式竞技排名、官方匹配或全机制完全一致的模拟器。

### 除了 PVP，还能怎么玩

- **肉鸽闯关：** 保留原版抓宠、换阵容、选道具、叠效果和逐层挑战的玩法，可以照常单人游玩。
- **同种子竞速：** 双方从同一个随机种子开始，各自在自己的流程中闯关，比推进速度和生存表现；悬浮状态显示对方层数和存活队伍数量。
- **灵魂同调：** 在联机闯关中，双方队伍相同槽位绑定。一方该槽位的宝可梦倒下，另一方对应槽位也会倒下，更考验保守换人和沟通。
- **双人合作双打：** 双方在双打战斗中分工控制宝可梦、提交各自回合指令，一起对付敌方，而不是互相 PVP。
- **中文说明：** 保留本地精翻并合入上游更新，包含 **953 条完整招式介绍**，方便比较配招效果。

PC 提供局域网启动器，Android 提供源码工程，支持跨端连接路径。当前定位是朋友之间的局域网游玩，不提供公网大厅、天梯或自动匹配；联机自检已通过，但不同手机、路由器和所有玩法组合尚未全部完成真机验收。

## 先下载，再开一局

- 当前版本分支：`codex/lan-multiplayer`。
- 中文翻译仓库：[weq060601-coder/pokerogue-locales](https://github.com/weq060601-coder/pokerogue-locales/tree/codex/zh-hans-full)，主仓库通过子模块固定到对应提交。
- 游戏资源仍引用官方 `pokerogue-assets` 子模块；上游署名与许可证保留在下方及各源文件中。
- Git 仓库保存源码；APK 作为 Releases 附件单独发布，个人存档、`node_modules` 和 `dist` 等本地文件不在源码仓库中。

### Android：下载 APK 直接安装

- [Android 1.27 测试版发布页](https://github.com/weq060601-coder/lan-multiplayer-champions/releases/tag/lan-v1.27)
- [直接下载 APK](https://github.com/weq060601-coder/lan-multiplayer-champions/releases/download/lan-v1.27/lan-multiplayer-champions-v1.27.apk)（约 **660 MiB**）

APK 已内置网页、游戏资源和中文翻译，无需在手机上克隆源码或安装 Node.js。下载后按系统提示允许对应来源安装应用；与朋友连接同一 Wi-Fi 后，在游戏标题菜单进入「局域网联机」。

这是 **2026-10-28 构建的现有 1.27 调试签名包**，安装后名称仍为「PokéRogue 局域网联机版」，本次没有重新打包。旧 Android/WebView 存在兼容性限制；工程最低 API 配置不代表所有旧手机都已通过验收。发布页附有 SHA-256 校验文件。

### 下载与运行

需要 Node.js **24.9.0 或更新版本**、pnpm **10.34.5** 和 Git。资源子模块较大，请预留下载空间。

```powershell
git clone --depth 1 --branch codex/lan-multiplayer --recurse-submodules --shallow-submodules https://github.com/weq060601-coder/lan-multiplayer-champions.git
cd lan-multiplayer-champions
pnpm install --frozen-lockfile
pnpm build:app
node scripts/launcher.mjs
```

Windows 完成构建后也可以运行根目录的 `双击启动游戏.bat`。源码调试使用 `pnpm start:dev`；局域网联机使用上面的启动器，启动器同时提供本地信令与发现服务。

请使用 `git clone --recurse-submodules`，GitHub 的普通源码 ZIP 不包含子模块内容。已有克隆可执行 `git submodule update --init --recursive` 获取本版本固定的资源与翻译；更新上游时请审查翻译差异，避免覆盖本地精翻。

Android 当前工程版本为 **1.27**，现成 APK 见上方发布页，自行打包步骤见下方折叠说明。

## 局域网联机怎么用

1. 两台设备连接同一路由器或 Wi-Fi。电脑运行上面的启动器，保持启动器窗口开启；终端会显示本机和局域网访问地址，以实际输出端口为准。
2. 房主在游戏标题菜单进入「局域网联机」，选择「创建房间」，设置玩法并确认创建。
3. 客机进入联机大厅，选择「自动搜索局域网主机」；也可以在「加入房间」中按界面提示填写房间码和连接信息。电脑当房主、Android App 当客机时，优先使用自动搜索。
4. 双方进入同一房间后选择「准备就绪」，再由房主选择「启动游戏」。
5. 手机浏览器体验电脑提供的游戏时，打开启动器打印的局域网网址，而不是手机自己的 `localhost`。

搜索不到主机时，检查是否误连访客 Wi-Fi、路由器是否开启客户端/AP 隔离，以及 Windows 防火墙是否允许 Node.js 的专用网络访问。启动器使用实际 HTTP 端口和 UDP **41234**（发现）/ **41235**（STUN）；仅按局域网需求配置访问，无需开放公网端口。

房间已连接但对战状态异常时，先用 3v3 小队复现并记录玩法、两端设备、操作顺序和出错回合，再到本仓库 Issues 反馈。

<details>
<summary>开发者说明：Android 源码打包</summary>

### Android 源码打包

现成 APK 见上方 Releases；需要自己修改并构建时：

1. 先完成上面的源码克隆和 `pnpm install --frozen-lockfile`。
2. 准备 JDK 17、Android SDK Platform 35 和对应构建工具。工程当前 `compileSdkVersion` 为 35。
3. 编辑 `scripts/build-apk.ps1`：将 `$jdkDir` 的本机旧路径替换为自己的 JDK 目录；SDK 默认读取 `$env:LOCALAPPDATA\Android\Sdk`，自定义安装目录时也要调整 `$sdkDir`。
4. 在项目根目录执行 `powershell -ExecutionPolicy Bypass -File .\scripts\build-apk.ps1`。脚本依次构建网页、同步 Capacitor 和执行 Gradle，生成根目录的 `PokeRogue-LAN-Multiplayer.apk`。

该脚本生成调试 APK，用于本地测试，不是正式签名发行包。SDK/JDK 需提前准备，脚本不负责安装这些环境。

</details>

<details>
<summary>开发者说明：联机自检</summary>

### 保留的联机自检

以下三份测试分别验证信令转发、局域网广播发现和启动器集成；用途不同，不是重复导出或构建产物：

```powershell
node scripts/test-signal-server.mjs
node scripts/test-lan-discovery.mjs
node scripts/test-launcher-signal.mjs
```

`test/` 目录保留上游的游戏测试。这些测试用于开发验证，不是游戏运行所需的玩家操作。

</details>

## 游戏资源与版权边界

主仓库通过 `assets` 子模块记录上游游戏资源仓库的地址及提交号，没有将该目录的角色贴图、音频和字体重新复制进当前主仓库文件树。Android 工程保留封装工具默认图标和启动图；上游网站图标及 README 的外部 Logo 引用也仍保留。

Releases 中的 APK 为完整离线安装包，包含游戏贴图、音频、字体及翻译；这些资源位于安装包中，并未作为普通文件加入 Git 源码历史。

这是保留上游历史的 fork，不是经过全历史资源剥离的全新纯代码仓库。资源分仓、只发源码、改名或注明上游许可，均不构成对宝可梦相关第三方版权与商标的使用授权，也不保证免于投诉或下架。上游资源是否公开可访问与是否获得权利人授权是不同问题；GitHub 的 [DMCA 政策](https://docs.github.com/en/site-policy/content-removal-policies/dmca-takedown-policy)也适用于 fork。

---

<details>
<summary>上游项目、署名与许可证</summary>

## 上游项目说明

<div align="center"><picture><img src="https://github.com/pagefaultgames/pokerogue-assets/blob/beta/images/logo.png?raw=true" width="300" alt="PokéRogue"></picture>

[![Discord Static Badge](https://img.shields.io/badge/Community_Discord-blurple?style=flat&logo=discord&logoSize=auto&labelColor=white&color=5865F2)](https://discord.gg/pokerogue)
[![Test Coverage Endpoint Badge](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/Bertie690/9cdfc49361824d1d5a57b7e8b38855d8/raw/coverage-badge.json)](https://github.com/pagefaultgames/pokerogue/actions/workflows/tests.yml) \
[![Docs Coverage Static Badge](https://pagefaultgames.github.io/pokerogue/beta/coverage.svg)](https://pagefaultgames.github.io/pokerogue/beta)
[![Biome Linting Static Badge](https://img.shields.io/badge/Linted_with-Biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev)
[![GNU AGPLv3 License Static Badge](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
</div>

PokéRogue is a browser based Pokémon fangame heavily inspired by the roguelite genre. Battle endlessly while gathering stacking items, exploring many different biomes, fighting trainers, bosses, and more!

# Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md), this includes instructions on how to set up the game locally.

# 📝 Credits

> If this project contains assets you have produced and you do not see your name, **please** reach out, either [here on GitHub](https://github.com/pagefaultgames/pokerogue/issues/new) or via [Discord](https://discord.gg/pokerogue).

Thank you to all the wonderful people that have contributed to the PokéRogue project! You can find the credits [here](./CREDITS.md).

# Licensing

This repository seeks to be [REUSE compliant](https://reuse.software/): copyright and/or licensing information for each file is stored
either in the file itself or in an associated `REUSE.toml` file.

The full licensing information for each file can be found by utilizing [REUSE's tooling](https://github.com/fsfe/reuse-tool), such as via `reuse spdx`. \
An abbreviated summary of said information is as follows:
- All source code belonging to the project, unless otherwise noted, is licensed under [AGPL-v3.0-only](LICENSES/AGPL-3.0-only.txt).
- All forms of documentation (both Markdown files[^1] and any comments explicitly documenting source code) are licensed under [CC-BY-NC-SA-4.0](LICENSES/CC-BY-NC-SA-4.0.txt).
- Auto-generated files produced by external tools or files of insignificant originality are not copyrighted and are licensed under [CC0-1.0](LICENSES/CC0-1.0.txt).
- To the extent that the assets we provide are [licensable and applicable](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en#ref-exception-or-limitation), they are licensed under [CC-BY-NC-SA-4.0](LICENSES/CC-BY-NC-SA-4.0.txt) unless otherwise noted.
  Exceptions can be found in associated `REUSE.toml` files.
  - ⚠️ Files in `assets/` that are not explicitly licensed via `REUSE.toml` files should be considered to have _no_ licensing / copyright information.

[^1]: Including this README

</details>
