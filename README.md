<!--
SPDX-FileCopyrightText: 2024-2026 Pagefault Games

SPDX-License-Identifier: CC-BY-NC-SA-4.0
-->

# PokéRogue 局域网联机与中文精翻版

本仓库保存基于官方 beta **1.12.2.2** 的局域网联机版本，包含 PC 启动器、Android 工程，以及竞速、灵魂同调、PVP 和双人合作玩法。简体中文保留本地精翻，并合入官方翻译更新，包含 **953 条完整招式介绍**。

- 当前版本分支：`codex/lan-multiplayer`。
- 中文翻译仓库：[weq060601-coder/pokerogue-locales](https://github.com/weq060601-coder/pokerogue-locales/tree/codex/zh-hans-full)，主仓库通过子模块固定到对应提交。
- 游戏资源仍引用官方 `pokerogue-assets` 子模块；上游署名与许可证保留在下方及各源文件中。
- 发布内容为源码；APK、个人存档、`node_modules` 和 `dist` 等本地文件不在源码仓库中。

## 下载与运行

需要 Node.js **24.9.0 或更新版本**、pnpm **10.34.5** 和 Git。资源子模块较大，请预留下载空间。

```powershell
git clone --depth 1 --branch codex/lan-multiplayer --recurse-submodules --shallow-submodules https://github.com/weq060601-coder/pokerogue-lan-multiplayer.git
cd pokerogue-lan-multiplayer
pnpm install --frozen-lockfile
pnpm build:app
node scripts/launcher.mjs
```

Windows 完成构建后也可以运行根目录的 `双击启动游戏.bat`。源码调试使用 `pnpm start:dev`；局域网联机使用上面的启动器，启动器同时提供本地信令与发现服务。

请使用 `git clone --recurse-submodules`，GitHub 的普通源码 ZIP 不包含子模块内容。已有克隆可执行 `git submodule update --init --recursive` 获取本版本固定的资源与翻译；更新上游时请审查翻译差异，避免覆盖本地精翻。

Android 构建入口为 `scripts/build-apk.ps1`，需另行配置本机 JDK 与 Android SDK 路径。当前 Android 工程版本为 **1.27**。详细实现及真机验收记录见 [交接文档.md](./交接文档.md)。

## 局域网联机怎么用

1. 两台设备连接同一路由器或 Wi-Fi。电脑运行上面的启动器，保持启动器窗口开启；终端会显示本机和局域网访问地址，以实际输出端口为准。
2. 房主在游戏标题菜单进入「局域网联机」，选择「创建房间」，设置玩法并确认创建。
3. 客机进入联机大厅，选择「自动搜索局域网主机」；也可以在「加入房间」中按界面提示填写房间码和连接信息。电脑当房主、Android App 当客机时，优先使用自动搜索。
4. 双方进入同一房间后选择「准备就绪」，再由房主选择「启动游戏」。
5. 手机浏览器体验电脑提供的游戏时，打开启动器打印的局域网网址，而不是手机自己的 `localhost`。

搜索不到主机时，检查是否误连访客 Wi-Fi、路由器是否开启客户端/AP 隔离，以及 Windows 防火墙是否允许 Node.js 的专用网络访问。启动器使用实际 HTTP 端口和 UDP **41234**（发现）/ **41235**（STUN）；仅按局域网需求配置访问，无需开放公网端口。

三组 Node 自检已通过；这不代表所有手机、路由器及跨端玩法都完成真机验收，具体限制见交接文档。

## Android 源码打包

本仓库没有发布可直接安装的 APK。自行构建需要：

1. 先完成上面的源码克隆和 `pnpm install --frozen-lockfile`。
2. 准备 JDK 17、Android SDK Platform 35 和对应构建工具。工程当前 `compileSdkVersion` 为 35。
3. 编辑 `scripts/build-apk.ps1`：将 `$jdkDir` 的本机旧路径替换为自己的 JDK 目录；SDK 默认读取 `$env:LOCALAPPDATA\Android\Sdk`，自定义安装目录时也要调整 `$sdkDir`。
4. 在项目根目录执行 `powershell -ExecutionPolicy Bypass -File .\scripts\build-apk.ps1`。脚本依次构建网页、同步 Capacitor 和执行 Gradle，生成根目录的 `PokeRogue-LAN-Multiplayer.apk`。

该脚本生成调试 APK，用于本地测试，不是正式签名发行包。SDK/JDK 需提前准备，脚本不负责安装这些环境。

## 保留的联机自检

以下三份测试分别验证信令转发、局域网广播发现和启动器集成；用途不同，不是重复导出或构建产物：

```powershell
node scripts/test-signal-server.mjs
node scripts/test-lan-discovery.mjs
node scripts/test-launcher-signal.mjs
```

`test/` 目录保留上游的游戏测试。本分支没有额外新增该目录下的测试文件；旧翻译导出和 Android 默认示例测试已从当前版本移除，但完整 Git 历史仍记录此前提交。

## 游戏资源与版权边界

主仓库通过 `assets` 子模块记录上游游戏资源仓库的地址及提交号，没有将该目录的角色贴图、音频和字体重新复制进当前主仓库文件树。Android 工程保留封装工具默认图标和启动图；上游网站图标及 README 的外部 Logo 引用也仍保留。

这是保留上游历史的 fork，不是经过全历史资源剥离的全新纯代码仓库。资源分仓、只发源码或注明上游许可，均不构成对宝可梦相关第三方版权与商标的使用授权，也不保证免于投诉或下架。上游资源是否公开可访问与是否获得权利人授权是不同问题；GitHub 的 [DMCA 政策](https://docs.github.com/en/site-policy/content-removal-policies/dmca-takedown-policy)也适用于 fork。

---

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
