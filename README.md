<!--
SPDX-FileCopyrightText: 2024-2026 Pagefault Games

SPDX-License-Identifier: CC-BY-NC-SA-4.0
-->

# PokéRogue 局域网联机版（类宝可梦冠军模式）

和朋友连上同一个 Wi-Fi，不用先刷很久的等级，选好宝可梦、配好招式，就能直接打一局真人对战。想自己闯关或和朋友一起闯关也可以，原版肉鸽玩法都还在。

## 手机端下载（Android 测试版）

手机玩家直接下载安装 APK 即可游玩，安装包已内置游戏画面、音频资源和简体中文，不需要折腾源码或安装开发环境：

- **[直接下载 APK（v1.27 测试版，约 660 MiB）](https://github.com/weq060601-coder/lan-multiplayer-champions/releases/download/lan-v1.27/lan-multiplayer-champions-v1.27.apk)**
- [前往 GitHub 发布页查看说明](https://github.com/weq060601-coder/lan-multiplayer-champions/releases/tag/lan-v1.27) ｜ [SHA-256 校验文件](https://github.com/weq060601-coder/lan-multiplayer-champions/releases/download/lan-v1.27/lan-multiplayer-champions-v1.27.apk.sha256)

下载后按 Android 系统提示允许安装即可。装好后的桌面应用名称为 **「PokéRogue 局域网联机版」**。

---

## 能玩什么

### 1. 自由组队 PVP（主打玩法）

省去漫长的刷关练级，和身边的朋友直接组队切磋：

- **不用练级，直接开打**：对战统一为 **50 级**，选好阵容就能立刻开始。
- **3v3 或 6v6 单打轮换**：由房主选择每人带 3 只还是 6 只宝可梦，双方轮流派宝可梦上场单打，直到一方队伍全部倒下。
- **自由选队与配招**：可以自由挑选宝可梦、进化形态、特性、性格和 4 个招式（招式来自游戏内支持的可学范围）。
- **全图鉴与神战开关**：房主开启「全图鉴」后，本局可临时选用全部图鉴、特性和性格，不会改动客机原本的存档；关闭时则按房主的解锁进度选人。房主还可以开关「神战」，决定是否放开强力与特殊宝可梦。
- **持有物搭配**：全队共享 **3 次道具分配额度**，可以在支持的树果、持有物、超级石和专属道具中自由取舍。
- **原房间再来一局**：打完一局后不用退出重连，双方在房间内确认就能直接重赛。

### 2. 肉鸽闯关与更多联机玩法

除了直接对战，你还可以在游戏里玩到这些模式：

- **单人肉鸽闯关**：保留原版玩法，抓宠、调整阵容、拿道具，一层层往后挑战。
- **同种子竞速**：两人从相同的随机种子出发，各自闯关，实时看谁推得更快、活得更久。
- **灵魂同调**：两人联机闯关时，队伍相同位置互相绑定——只要一方那个位置的宝可梦倒下，另一方对应位置的宝可梦也会跟着倒下。
- **双人合作双打**：两人在双打战斗中分工下达指令，一起对付敌方。
- **内置中文说明**：自带简体中文界面与 **953 条完整中文招式介绍**，选招时不用猜效果。

---

## 怎么和朋友开第一局

1. **连上同一个网络**：两台设备连接到同一个 Wi-Fi 或路由器。
2. **建房与加入**：在游戏标题画面进入「局域网联机」。一人点「创建房间」，另一人点「自动搜索局域网主机」加入（也可以手动输入房间信息加入）。
3. **选规则并开打**：第一次玩建议房主选 **PVP → 3v3 → 开启全图鉴 → 关闭神战**。双方点「准备就绪」后由房主开始游戏，各自选好 3 只宝可梦、配好招式和道具就能开打。

**如果电脑也参与联机：**
- 电脑需要先运行本项目的局域网启动器，并在游玩期间保持窗口开着。
- 推荐由电脑当房主、手机 App 用「自动搜索」加入。
- 如果手机直接用浏览器连电脑玩，请在手机浏览器里输入电脑启动器显示的**局域网地址**，不要输 `localhost`。

**如果搜不到房间：**
请检查两台设备是不是连了同一个 Wi-Fi、有没有误连「访客网络」、路由器有没有开启「AP 隔离 / 设备隔离」，以及电脑上的 Windows 防火墙是否放行了 Node.js。

---

## 电脑端运行方法（PC）

本项目目前没有提供独立的 Windows `.exe` 安装包，电脑游玩需要通过源码构建并运行启动器（完成首次构建后，可以直接双击根目录的 `双击启动游戏.bat` 启动）。

<details>
<summary>展开查看：电脑端（PC）源码构建与运行步骤</summary>

需要先在电脑上安装 **Node.js 24.9.0 或更新版本**、**pnpm 10.34.5** 和 **Git**，然后在终端按顺序运行：

```powershell
git clone --depth 1 --branch codex/lan-multiplayer --recurse-submodules --shallow-submodules https://github.com/weq060601-coder/lan-multiplayer-champions.git
cd lan-multiplayer-champions
pnpm install --frozen-lockfile
pnpm build:app
node scripts/launcher.mjs
```

> **为什么不能直接在 GitHub 点 Download ZIP？**
> 简体中文等 29 种语言文件已经直接内置在主仓库 `locales/zh-Hans/` 等目录中（普通源码 ZIP 里也有中文，不再需要单独拉取翻译仓库），但游戏贴图和音频资源（`assets`）仍然通过 Git 子模块引用。只下载普通源码 ZIP 会缺少游戏资源、无法直接运行，请使用上面的 `git clone --recurse-submodules` 命令拉取。

</details>

---

## 注意事项与问题反馈

- **非官方爱好者项目**：本项目基于 PokéRogue beta **1.12.2.2** 改造，是爱好者制作的局域网联机版本。「类宝可梦冠军模式」仅代表自由组队、统一等级直接对战的玩法形式，与官方《宝可梦 冠军》无隶属关系，数值、道具和招式沿用 PokéRogue 现有实现，并非官方赛事规则模拟器。
- **当前 APK 版本说明**：发布页提供的 Android 安装包（v1.27）是 **2026-10-28 构建的调试签名测试包**。11 月 11 日的仓库翻译整合只改变了源码保存方式，没有重新打包替换该 APK；安装后应用名仍显示为「PokéRogue 局域网联机版」。
- **翻译与设备兼容**：游戏已完整翻译 953 条招式说明，但并不代表游戏内每一句台词和文本都已百分之百精翻。此外，不同型号的旧手机、系统 WebView、路由器环境以及「手机建房、电脑加入」等跨端组合尚未逐一完成真机实测。
- **问题反馈**：如果联机或对战遇到异常，欢迎先用 3v3 小队复现，记录下玩法模式、双方设备、操作顺序和出错回合，前往 [GitHub Issues](https://github.com/weq060601-coder/lan-multiplayer-champions/issues) 反馈。

---

<details>
<summary>开发者说明：网络参数、自检脚本与 Android 打包</summary>

### 局域网端口与调试命令

- 日常源码开发调试可运行 `pnpm start:dev`；需要局域网联机时请运行 `node scripts/launcher.mjs`，启动器会同时提供网页服务、本地信令与局域网发现服务。
- 启动器使用实际输出的 HTTP 端口，以及 UDP **41234**（局域网房间发现）和 UDP **41235**（本地 STUN），仅在局域网内通信，无需开放公网端口。
- 翻译文件位于主仓库 `locales/zh-Hans/`（源自原翻译仓库提交 `bafb4eecb4e36ec0805cb23df15732ae631ade8b`，后续直接在本仓库维护）。可执行 `pnpm test:locales` 检查语言包 JSON 与 953 条中文招式介绍，构建后可执行 `pnpm test:locales -- --dist` 核对构建产物。
- 已有仓库克隆如需单独补齐资源子模块，可执行 `git submodule update --init --recursive assets`。

### 联机自检脚本

以下三项脚本分别用于测试信令转发、局域网广播发现和启动器集成（供开发验证，普通玩家无需运行）：

```powershell
node scripts/test-signal-server.mjs
node scripts/test-lan-discovery.mjs
node scripts/test-launcher-signal.mjs
```

### 自行打包 Android APK

现成安装包请直接在上方下载。如果需要修改代码并自行打包调试 APK（当前 Android 工程版本为 **1.27**，与 PokéRogue 源码基线版本号 **1.12.2.2** 各自独立）：

1. 完成上方的源码克隆与 `pnpm install --frozen-lockfile`。
2. 安装 JDK 17、Android SDK Platform 35（工程 `compileSdkVersion` 为 35）及对应构建工具。
3. 打开 `scripts/build-apk.ps1`，将 `$jdkDir` 改为你本机的 JDK 路径；若 Android SDK 不在默认的 `$env:LOCALAPPDATA\Android\Sdk`，同步修改 `$sdkDir`。
4. 在项目根目录执行：
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\build-apk.ps1
   ```
   脚本会依次构建网页、同步 Capacitor 并调用 Gradle，在根目录生成调试签名包 `PokeRogue-LAN-Multiplayer.apk`。

</details>

<details>
<summary>上游项目、资源说明、署名与许可证</summary>

## 游戏资源与版权说明

主仓库通过 `assets` 子模块指向官方 `pokerogue-assets` 资源仓库，未将角色贴图、音频和字体直接复制进当前 Git 源码树；Releases 中的 APK 则是包含贴图、音频、字体和翻译的完整离线安装包。

本项目是保留上游历史的衍生仓库（fork）。无论是资源分仓、源码发布还是注明上游许可，均不构成对宝可梦相关第三方版权与商标的官方授权，GitHub 的 [DMCA 政策](https://docs.github.com/en/site-policy/content-removal-policies/dmca-takedown-policy)同样适用于本仓库。

---

## 上游项目说明（PokéRogue）

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
