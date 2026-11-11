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
