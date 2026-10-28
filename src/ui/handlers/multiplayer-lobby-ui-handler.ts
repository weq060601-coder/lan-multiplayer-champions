import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { GameModes } from "#enums/game-modes";
import { getGameMode } from "#app/game-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow, WindowVariant } from "#ui/ui-theme";
import type { MultiplayerInputOptions } from "#ui/multiplayer-input-form-ui-handler";
import { MultiplayerMode, PlayerRole, type PvpFormat } from "../../multiplayer/multiplayer-types";
import { multiplayerManager } from "../../multiplayer/multiplayer-manager";
import { getSignalOverride, resolveSignalConfig, setSignalOverride } from "../../multiplayer/signal-config";
import { getEmbeddedSignalAddress } from "../../multiplayer/embedded-signal-server";
import { type DiscoveredHost, discoverLanHosts, isDiscoverySupported, locateRoomSignal } from "../../multiplayer/lan-discovery";

enum LobbyView {
  MAIN = "MAIN",
  CREATE = "CREATE",
  JOIN = "JOIN",
  ROOM = "ROOM",
  /** 自动搜索局域网主机的结果列表 */
  DISCOVER = "DISCOVER",
}

/**
 * 局域网联机大厅 UI 处理器
 */
export class MultiplayerLobbyUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.NineSlice;
  private titleText: Phaser.GameObjects.Text;
  private statusText: Phaser.GameObjects.Text;

  private currentView: LobbyView = LobbyView.MAIN;
  private cursorIndex = 0;

  // 选项文本列表
  private optionTexts: Phaser.GameObjects.Text[] = [];

  // 创建/加入房间暂存参数
  private selectedMode: MultiplayerMode = MultiplayerMode.RACE;
  private selectedPvpFormat: PvpFormat = 3;
  private selectedPvpFullDex = false;
  /** 神战：开启后选队可以选神兽，关闭时和官方 PVP 一样不能选。 */
  private selectedPvpLegendary = false;
  private inputRoomCode = "";

  /** 上一次自动搜索的结果，供 DISCOVER 视图渲染 */
  private discoveredHosts: DiscoveredHost[] = [];
  /** 搜索没结果时要显示给玩家的原因 */
  private discoverMessage = "";
  /** 搜索进行中（渲染成「搜索中...」，并挡住重复触发） */
  private discovering = false;

  /**
   * 正在处理一次确认操作，期间忽略后续 ACTION。
   *
   * ⚠️ 少了这个东西会出真 bug：`handleSelectAction()` 是 async 的，而
   * `processInput()` 调它时**没有 await**，所以在「创建房间 / 加入房间」这类
   * 要等网络的分支里，用户连点两下就会发两次请求。
   */
  private busy = false;
  private modeList = [
    MultiplayerMode.RACE,
    MultiplayerMode.SOUL_LINK,
    MultiplayerMode.PVP,
    MultiplayerMode.COOP,
  ];

  public override setup(): void {
    const ui = this.getUi();
    const { width: canvasWidth, height: canvasHeight } = globalScene.scaledCanvas;
    const width = 290;
    const height = 150;

    // UI 原点在屏幕底部 (y = canvasHeight)，所以放置在 -canvasHeight + offset
    this.container = globalScene.add.container(
      (canvasWidth - width) / 2,
      -canvasHeight + (canvasHeight - height) / 2,
    );
    this.container.setName("multiplayer-lobby");
    this.container.setVisible(false);
    ui.add(this.container);

    this.bg = addWindow(0, 0, width, height, false, false, 0, 0, WindowVariant.NORMAL);
    this.container.add(this.bg);

    this.titleText = addTextObject(width / 2, 8, "局域网联机大厅", TextStyle.WINDOW, {
      fontSize: "44px",
      align: "center",
    }).setOrigin(0.5, 0);
    this.container.add(this.titleText);

    this.statusText = addTextObject(width / 2, height - 16, "", TextStyle.TOOLTIP_CONTENT, {
      fontSize: "34px",
    }).setOrigin(0.5, 0);
    this.container.add(this.statusText);

    this.bg.setVisible(false);
    this.titleText.setVisible(false);
    this.statusText.setVisible(false);

    // 监听房间状态变化
    multiplayerManager.onRoomUpdate(room => {
      // 房间被清空（退出/断线）：如果还停在房间界面，退回主菜单
      if (!room && !multiplayerManager.isInRoom) {
        if (this.currentView === LobbyView.ROOM) {
          this.currentView = LobbyView.MAIN;
          this.cursorIndex = 0;
          this.renderCurrentView();
        }
        return;
      }

      if (this.currentView === LobbyView.ROOM || this.currentView === LobbyView.JOIN || multiplayerManager.isInRoom) {
        this.currentView = LobbyView.ROOM;
        this.renderRoomView();
      }
    });

    // 监听游戏开始
    multiplayerManager.onGameStarted((roomState) => {
      this.handleGameStarted(roomState);
    });
  }

  public override show(args: any[]): boolean {
    if (!super.show(args)) return false;

    this.container.setVisible(true);
    this.bg.setVisible(true);
    this.titleText.setVisible(true);
    this.statusText.setVisible(true);
    this.currentView = multiplayerManager.isInRoom ? LobbyView.ROOM : LobbyView.MAIN;
    this.cursorIndex = 0;
    this.statusText.setText("");
    this.renderCurrentView();

    return true;
  }

  public override clear(): void {
    super.clear();
    this.container.setVisible(false);
    if (this.bg) this.bg.setVisible(false);
    if (this.titleText) this.titleText.setVisible(false);
    if (this.statusText) this.statusText.setVisible(false);
    this.clearOptions();
  }

  private clearOptions(): void {
    this.optionTexts.forEach(t => t.destroy());
    this.optionTexts = [];
  }

  private renderCurrentView(): void {
    this.clearOptions();

    switch (this.currentView) {
      case LobbyView.MAIN:
        this.renderMainView();
        break;
      case LobbyView.CREATE:
        this.renderCreateView();
        break;
      case LobbyView.JOIN:
        this.renderJoinView();
        break;
      case LobbyView.ROOM:
        this.renderRoomView();
        break;
      case LobbyView.DISCOVER:
        this.renderDiscoverView();
        break;
    }

    this.updateCursorHighlight();
  }

  private getModeDisplayName(mode: MultiplayerMode, pvpFormat: PvpFormat = this.selectedPvpFormat): string {
    switch (mode) {
      case MultiplayerMode.RACE:
        return "同种子竞速 (Race)";
      case MultiplayerMode.SOUL_LINK:
        return "灵魂同调 (Soul Link)";
      case MultiplayerMode.PVP:
        return `局域网 PVP ${pvpFormat}v${pvpFormat} 竞技 (PvP Arena)`;
      case MultiplayerMode.COOP:
        return "双人双打协同 (2P Co-op)";
    }
  }

  private renderMainView(): void {
    this.titleText.setText("局域网联机大厅 (Multiplayer)");
    const signal = resolveSignalConfig();
    const options = [
      "1. 创建房间 (Host Room)",
      "2. 加入房间 (Join Room)",
      "3. 自动搜索局域网主机 (Auto-find LAN host)",
      `4. 联机服务器（安卓房主时填手机地址）: ${signal.label}${signal.manual ? " (手填)" : " (自动)"}`,
      "5. 返回标题 (Back to Title)",
    ];

    // 行距从 24 收到 22：加了第 5 项，按 24 排会顶到状态栏文字。
    options.forEach((opt, idx) => {
      const text = addTextObject(18, 34 + idx * 22, opt, TextStyle.WINDOW, {
        fontSize: "40px",
      });
      this.container.add(text);
      this.optionTexts.push(text);
    });
  }

  private renderDiscoverView(): void {
    this.titleText.setText("搜索局域网主机 (Auto-find LAN host)");

    if (this.discovering) {
      // 搜索中不列任何可选项 —— optionTexts 为空时光标逻辑天然无处可去，
      // 不需要额外加锁（Math.min(length-1, ...) 会夹到 -1，updateCursorHighlight 空转）。
      const text = addTextObject(18, 40, "正在搜索，请稍候...", TextStyle.WINDOW, {
        fontSize: "38px",
      });
      this.container.add(text);
      this.optionTexts.push(text);
      return;
    }

    const options: string[] = this.discoveredHosts.map(
      h => `-> ${h.name}  (${h.host}:${h.port})`,
    );
    options.push("-> 重新搜索 (Retry)");
    options.push("-> 返回上一层 (Cancel)");

    options.forEach((opt, idx) => {
      const text = addTextObject(16, 34 + idx * 22, opt, TextStyle.WINDOW, {
        fontSize: "38px",
      });
      this.container.add(text);
      this.optionTexts.push(text);
    });

    if (this.discoveredHosts.length === 0 && this.discoverMessage) {
      this.statusText.setText(this.discoverMessage);
    }
  }

  private renderCreateView(): void {
    this.titleText.setText("创建联机房间 (Create Room)");
    const modeName = this.getModeDisplayName(this.selectedMode);

    const options = [
      `玩法模式: < ${modeName} >`,
      `房间短码: ${this.inputRoomCode || "AUTO"}`,
      ...(this.selectedMode === MultiplayerMode.PVP
        ? [
            `PVP 规模: < ${this.selectedPvpFormat}v${this.selectedPvpFormat} >`,
            `全图鉴: < ${this.selectedPvpFullDex ? "开启" : "关闭"} >`,
            `神战(可选神兽): < ${this.selectedPvpLegendary ? "开启" : "关闭"} >`,
          ]
        : []),
      "-> 确认创建并启动 (Host)",
      "-> 返回上一层 (Cancel)",
    ];

    // PVP has seven rows (format / full dex / legendary); tighten spacing so the last row stays above the status line.
    const rowGap = options.length > 6 ? 15 : 18;
    const rowTop = options.length > 6 ? 28 : 30;
    options.forEach((opt, idx) => {
      const text = addTextObject(16, rowTop + idx * rowGap, opt, TextStyle.WINDOW, {
        fontSize: "38px",
      });
      this.container.add(text);
      this.optionTexts.push(text);
    });
  }

  private renderJoinView(): void {
    this.titleText.setText("加入房间 (Join Room)");
    const options = [
      `输入房间码: [ ${this.inputRoomCode || "点击或输入"} ]`,
      "-> 连接房间 (Connect)",
      "-> 返回上一层 (Cancel)",
    ];

    options.forEach((opt, idx) => {
      const text = addTextObject(16, 36 + idx * 24, opt, TextStyle.WINDOW, {
        fontSize: "38px",
      });
      this.container.add(text);
      this.optionTexts.push(text);
    });
  }

  private renderRoomView(): void {
    const room = multiplayerManager.roomState;
    if (!room) {
      this.titleText.setText("正在进入房间 (Joining Room...)");
      this.clearOptions();
      const text = addTextObject(18, 50, "正在同步房主数据，请稍候...", TextStyle.WINDOW, {
        fontSize: "38px",
      });
      this.container.add(text);
      this.optionTexts.push(text);
      return;
    }

    const pvpSettings = room.mode === MultiplayerMode.PVP
      // 放到标题第二行：和房间号挤在一行时会超出 290 宽的窗口。
      ? `\n全图鉴: ${room.pvpFullDex ? "开启" : "关闭"}    神战: ${room.pvpLegendary ? "开启" : "关闭"}`
      : "";
    this.titleText.setText(`房间: [${room.roomId}]  模式: ${this.getModeDisplayName(room.mode, room.pvpFormat ?? 3)}${pvpSettings}`);

    const p1 = room.players[0];
    const p2 = room.players[1];

    const p1Status = p1 ? `${p1.name} (${p1.role === PlayerRole.HOST ? "房主" : "客机"}) - ${p1.isReady ? "已就绪 ✔" : "准备中..."}` : "空缺";
    const p2Status = p2 ? `${p2.name} (${p2.role === PlayerRole.HOST ? "房主" : "客机"}) - ${p2.isReady ? "已就绪 ✔" : "准备中..."}` : "等待玩家加入...";

    const me = multiplayerManager.getMe();
    const isMeReady = me?.isReady ?? false;

    const options = [
      `1P: ${p1Status}`,
      `2P: ${p2Status}`,
      isMeReady ? "-> 取消就绪 (Unready)" : "-> 准备就绪 (Ready)",
    ];

    if (multiplayerManager.isHost) {
      options.push("-> [房主] 启动游戏 (Start Game)");
    }

    options.push("-> 退出房间 (Leave Room)");

    this.clearOptions();
    options.forEach((opt, idx) => {
      const text = addTextObject(14, 28 + idx * 19, opt, TextStyle.WINDOW, {
        fontSize: "36px",
      });
      this.container.add(text);
      this.optionTexts.push(text);
    });

    this.updateCursorHighlight();
  }

  private updateCursorHighlight(): void {
    this.optionTexts.forEach((t, idx) => {
      if (idx === this.cursorIndex) {
        t.setColor("#ffdd44");
      } else {
        t.setColor("#ffffff");
      }
    });
  }

  public override processInput(button: Button): boolean {
    if (button === Button.UP) {
      this.cursorIndex = Math.max(0, this.cursorIndex - 1);
      this.updateCursorHighlight();
      return true;
    }

    if (button === Button.DOWN) {
      this.cursorIndex = Math.min(this.optionTexts.length - 1, this.cursorIndex + 1);
      this.updateCursorHighlight();
      return true;
    }

    if (button === Button.LEFT || button === Button.RIGHT) {
      if (this.currentView === LobbyView.CREATE && this.cursorIndex === 0) {
        let currentIdx = this.modeList.indexOf(this.selectedMode);
        if (button === Button.LEFT) {
          currentIdx = (currentIdx - 1 + this.modeList.length) % this.modeList.length;
        } else {
          currentIdx = (currentIdx + 1) % this.modeList.length;
        }
        this.selectedMode = this.modeList[currentIdx];
        this.renderCurrentView();
        return true;
      }
    }

    if (button === Button.ACTION) {
      // 正在处理上一次确认（等网络、或已经弹出输入框）时，直接吞掉这次按键。
      if (this.busy) {
        return true;
      }
      this.busy = true;
      this.handleSelectAction().finally(() => {
        this.busy = false;
      });
      return true;
    }

    if (button === Button.CANCEL) {
      this.handleCancelAction();
      return true;
    }

    return false;
  }

  /**
   * 弹出游戏内输入框，等用户填完。确认返回填的字符串，取消返回 null。
   *
   * 取代原来的 `window.prompt()`。原生 prompt 在安卓 WebView 上会无限弹窗：
   * 它同步卡住 JS 线程，用户点「确定」关掉它的那一下触摸穿透到游戏画布，
   * 被 Phaser 当成新的 ACTION，于是又开一个。详见 MultiplayerInputFormUiHandler 的注释。
   *
   * ⚠️ 这里必须用 `setOverlayMode` + `revertMode` 这一对，不能用
   * `setModeWithoutClear` 再 `setMode(MULTIPLAYER_LOBBY)` 回来：
   * ① 只有 setOverlayMode 会把当前模式压进 modeChain，revertMode 才有东西可弹；
   * ② 本 handler 的 show() 会把 currentView 重置成 MAIN/ROOM，
   *    走 setMode 回来的话，用户在「加入房间」页填完码会被踢回主菜单。
   *    revertMode 不重跑 show()，视图和光标位置都能原样保住。
   */
  private promptInput(opts: MultiplayerInputOptions): Promise<string | null> {
    return new Promise(resolve => {
      let settled = false;
      const finish = (value: string | null) => {
        // 防抖：确认和取消都可能被连点触发两次
        if (settled) {
          return;
        }
        settled = true;
        globalScene.ui.revertMode().then(() => resolve(value));
      };

      globalScene.ui.setOverlayMode(
        UiMode.MULTIPLAYER_INPUT,
        { buttonActions: [(value: string) => finish(value), () => finish(null)] },
        opts,
      );
    });
  }

  private async handleSelectAction(): Promise<void> {
    if (this.currentView === LobbyView.MAIN) {
      if (this.cursorIndex === 0) {
        // 创建房间
        this.currentView = LobbyView.CREATE;
        this.inputRoomCode = Math.floor(1000 + Math.random() * 9000).toString();
        this.cursorIndex = 0;
        this.renderCurrentView();
      } else if (this.cursorIndex === 1) {
        // 加入房间
        this.currentView = LobbyView.JOIN;
        this.cursorIndex = 0;
        this.renderCurrentView();
      } else if (this.cursorIndex === 2) {
        // 自动搜索局域网主机
        this.currentView = LobbyView.DISCOVER;
        this.cursorIndex = 0;
        await this.runDiscovery();
      } else if (this.cursorIndex === 3) {
        // 手填联机服务器地址（自动搜索失败时的退路）
        const current = getSignalOverride();
        const input = await this.promptInput({
          title: "联机服务器地址（安卓房主请填手机显示的 IP:端口）",
          label: "手机 IP:端口",
          value: current ?? "",
          allowEmpty: true, // 留空 = 恢复自动识别
        });
        if (input !== null) {
          setSignalOverride(input);
          this.renderCurrentView();
          this.statusText.setText(
            input.trim() ? `联机服务器已设为 ${resolveSignalConfig().label}` : "已恢复为自动识别联机服务器",
          );
        }
      } else if (this.cursorIndex === 4) {
        // 返回标题
        globalScene.phaseManager.toTitleScreen();
      }
    } else if (this.currentView === LobbyView.CREATE) {
      if (this.cursorIndex === 0) {
        // 循环切换模式
        const nextIdx = (this.modeList.indexOf(this.selectedMode) + 1) % this.modeList.length;
        this.selectedMode = this.modeList[nextIdx];
        this.renderCurrentView();
      } else if (this.cursorIndex === 1) {
        // 重新随机房间码
        this.inputRoomCode = Math.floor(1000 + Math.random() * 9000).toString();
        this.renderCurrentView();
      } else if (this.selectedMode === MultiplayerMode.PVP && this.cursorIndex === 2) {
        this.selectedPvpFormat = this.selectedPvpFormat === 3 ? 6 : 3;
        this.renderCurrentView();
      } else if (this.selectedMode === MultiplayerMode.PVP && this.cursorIndex === 3) {
        this.selectedPvpFullDex = !this.selectedPvpFullDex;
        this.renderCurrentView();
      } else if (this.selectedMode === MultiplayerMode.PVP && this.cursorIndex === 4) {
        this.selectedPvpLegendary = !this.selectedPvpLegendary;
        this.renderCurrentView();
      } else if (this.cursorIndex === (this.selectedMode === MultiplayerMode.PVP ? 5 : 2)) {
        // 确认创建
        this.statusText.setText("正在建立 P2P 房间...");
        try {
          const playerName = "Trainer_" + Math.floor(100 + Math.random() * 900);
          await multiplayerManager.createRoom(
            this.inputRoomCode,
            playerName,
            this.selectedMode,
            GameModes.CLASSIC,
            this.selectedPvpFormat,
            this.selectedPvpFullDex,
            this.selectedPvpLegendary,
          );
          this.currentView = LobbyView.ROOM;
          this.cursorIndex = 0;
          const embeddedAddress = getEmbeddedSignalAddress();
          this.statusText.setText(embeddedAddress
            ? `房间已创建。另一台设备输入房间码 ${this.inputRoomCode} 就会自动搜索并对上。手机地址 ${embeddedAddress}。`
            : `房间已创建。另一台设备输入房间码 ${this.inputRoomCode} 就会自动搜索并对上。`);
          this.renderCurrentView();
        } catch (e: any) {
          this.statusText.setText(e.message || "创建房间失败");
        }
      } else if (this.cursorIndex === (this.selectedMode === MultiplayerMode.PVP ? 6 : 3)) {
        this.currentView = LobbyView.MAIN;
        this.cursorIndex = 0;
        this.renderCurrentView();
      }
    } else if (this.currentView === LobbyView.JOIN) {
      if (this.cursorIndex === 0) {
        // 输入房间码
        const input = await this.promptInput({
          title: "输入房间码",
          label: "房间码",
          value: this.inputRoomCode,
          numericOnly: true,
          exactLength: 4,
        });
        if (input) {
          this.inputRoomCode = input;
          this.renderCurrentView();
        }
      } else if (this.cursorIndex === 1) {
        if (!this.inputRoomCode) {
          this.statusText.setText("请先输入房间码！");
          return;
        }
        this.statusText.setText(`正在搜索房间码 ${this.inputRoomCode}...`);
        try {
          const located = await locateRoomSignal(this.inputRoomCode);
          if (!("signal" in located)) {
            if (!getSignalOverride()) {
              this.statusText.setText(located.error);
              return;
            }
            this.statusText.setText("自动搜索没对上房间码，改用已填写的地址...");
          }
          const playerName = "Player_" + Math.floor(100 + Math.random() * 900);
          const ok = await multiplayerManager.joinRoom(
            this.inputRoomCode,
            playerName,
            "signal" in located ? located.signal : undefined,
          );
          if (ok) {
            this.currentView = LobbyView.ROOM;
            this.cursorIndex = 0;
            this.statusText.setText("成功连接房间！");
            this.renderCurrentView();
          }
        } catch (e: any) {
          this.statusText.setText(e.message || "连接房间失败，请检查房间码");
        }
      } else if (this.cursorIndex === 2) {
        this.currentView = LobbyView.MAIN;
        this.cursorIndex = 0;
        this.renderCurrentView();
      }
    } else if (this.currentView === LobbyView.ROOM) {
      const isHost = multiplayerManager.isHost;
      if (this.cursorIndex === 2) {
        // 准备 / 取消准备
        multiplayerManager.toggleReady();
      } else if (isHost && this.cursorIndex === 3) {
        // 房主启动游戏
        const room = multiplayerManager.roomState;
        if (room && room.players.length >= 2 && room.players.every(player => player.isReady)) {
          multiplayerManager.startGame();
        } else if (!room || room.players.length < 2) {
          this.statusText.setText("等待另一名玩家加入");
        } else {
          this.statusText.setText("请等待双方都准备就绪");
        }
      } else if ((!isHost && this.cursorIndex === 3) || (isHost && this.cursorIndex === 4)) {
        // 离开房间
        multiplayerManager.leaveRoom();
        this.currentView = LobbyView.MAIN;
        this.cursorIndex = 0;
        this.renderCurrentView();
      }
    } else if (this.currentView === LobbyView.DISCOVER) {
      // 搜索中不响应确认（此时列表里只有一行「正在搜索」提示，没有可选项）
      if (this.discovering) {
        return;
      }

      const hostCount = this.discoveredHosts.length;
      if (this.cursorIndex < hostCount) {
        // 只作为自动搜索失败时的备用地址。建房不会用它。
        const picked = this.discoveredHosts[this.cursorIndex];
        setSignalOverride(`${picked.host}:${picked.port}`);
        this.currentView = LobbyView.MAIN;
        this.cursorIndex = 0;
        this.renderCurrentView();
        this.statusText.setText(`已记下 ${picked.name} (${picked.host}:${picked.port})。加入时仍会先按房间码搜索，搜不到才用这个地址。`);
      } else if (this.cursorIndex === hostCount) {
        // 重新搜索
        await this.runDiscovery();
      } else {
        this.currentView = LobbyView.MAIN;
        this.cursorIndex = 0;
        this.renderCurrentView();
      }
    }
  }

  /**
   * 跑一次局域网搜索并刷新 DISCOVER 视图。
   *
   * `discoverLanHosts()` 自己不抛异常，失败会折成 `{hosts: [], reason}`，
   * 所以这里不需要 try/catch —— 但 `discovering` 标志仍要用 finally 复位，
   * 否则万一将来它改成会抛，视图就永远卡在「正在搜索」。
   */
  private async runDiscovery(): Promise<void> {
    if (!isDiscoverySupported()) {
      // 只有旧 APK（没有原生搜索插件）会进这里。浏览器会去问本机 launcher。
      this.discoveredHosts = [];
      this.discovering = false;
      const result = await discoverLanHosts();
      this.discoverMessage = result.reason ?? "";
      this.renderCurrentView();
      return;
    }

    this.discovering = true;
    this.discoveredHosts = [];
    this.discoverMessage = "";
    this.statusText.setText("正在向局域网发送搜索广播...");
    this.renderCurrentView();

    try {
      const result = await discoverLanHosts();
      this.discoveredHosts = result.hosts;
      this.discoverMessage = result.reason ?? "";
      if (result.hosts.length > 0) {
        this.statusText.setText(`找到 ${result.hosts.length} 台局域网主机，选一台即可。`);
      }
    } finally {
      this.discovering = false;
      this.cursorIndex = 0;
      this.renderCurrentView();
    }
  }

  private handleCancelAction(): void {
    if (this.currentView === LobbyView.ROOM) {
      multiplayerManager.leaveRoom();
      this.currentView = LobbyView.MAIN;
      // ⚠️ 回 MAIN 必须把光标归零。DISCOVER 视图的选项数是**可变的**
      //    （N 台主机 + 重新搜索 + 返回），找到 4 台就有 6 项，比 MAIN 的 5 项多。
      //    带着 5 这个下标回 MAIN，updateCursorHighlight 的 forEach 谁都匹配不上，
      //    结果是高亮整个消失、看着像卡死（不崩，所以更难查）。
      this.cursorIndex = 0;
      this.renderCurrentView();
    } else if (this.currentView !== LobbyView.MAIN) {
      this.currentView = LobbyView.MAIN;
      this.cursorIndex = 0;
      this.renderCurrentView();
    } else {
      globalScene.phaseManager.toTitleScreen();
    }
  }

  /**
   * 当收到房主启动游戏指令时触发
   */
  private handleGameStarted(roomState: any): void {
    console.log("[Multiplayer] Game Starting with mode:", roomState.mode, "Seed:", roomState.seed);
    this.clear();

    // 隐藏大厅并进入游戏模式
    globalScene.ui.setMode(UiMode.MESSAGE);

    // 联机房间可能是在上一局结束后重新创建的；清掉上一局残留队伍，
    // 否则新选的 3/6 只会叠加到旧队伍上，进入 PVP 时会出现「当前队伍 9 只」之类的错误。
    globalScene.reset(false, false);

    // 用房主下发的种子，保证两台机器随机内容一致
    globalScene.setSeed(roomState.seed || "MULTIPLAYER");
    globalScene.resetSeed();

    // ⚠️ 必须用 getGameMode()，不能手写 new GameMode(CLASSIC, { isClassic: true })：
    //    后者会漏掉 hasTrainers / hasMysteryEncounters 和 classicFixedBattles，
    //    8 波劲敌之类的固定战全都不会出现。
    globalScene.gameMode = getGameMode(GameModes.CLASSIC);
    globalScene.newArena(globalScene.gameMode.getStartingBiome());

    // ⚠️ SelectStarterPhase 之后必须紧跟 EncounterPhase，和 TitlePhase.end() 保持一致。
    //    少了 EncounterPhase，选完初始怪队列就空了，PhaseManager 的兜底
    //    (phase-manager.ts:354 `if (nextPhase == null) this.turnStart()`) 会直接跳到
    //    TurnInitPhase —— 而宝可梦在 initBattle 里被 setVisible(false) 过，
    //    没人再把它显示出来，也没人生成敌方队伍。
    //    症状就是「有指令菜单、但屏幕上一只宝可梦都没有」。
    globalScene.phaseManager.clearAllPhases();
    globalScene.phaseManager.pushNew("SelectStarterPhase");

    // PVP：选完队伍后先插一步「交换队伍」，再进遭遇。
    // PvpPartySyncPhase 会把这场野生遭遇改造成「对手的真实队伍 vs 我的队伍」，
    // 必须夹在 SelectStarterPhase（里面才 newBattle()）和 EncounterPhase（按队伍生成敌方）之间。
    if (roomState.mode === MultiplayerMode.PVP) {
      multiplayerManager.pvpManager.isActive = true;
      multiplayerManager.applyPvpDex(roomState.pvpFullDex === true, roomState.pvpDexSnapshot);
      // 先本地组队（统一等级 / 选进化型 / 分配道具），再交换给对手。
      // 顺序不能颠倒：交换的必须是最终形态的队伍，否则对面拿到的是还没设置完的。
      globalScene.phaseManager.pushNew("PvpTeamSetupPhase");
      globalScene.phaseManager.pushNew("PvpPartySyncPhase");
    }

    // COOP：两台设备进入原生双打规则；该 phase 必须在 SelectStarter（newBattle）之后、
    // EncounterPhase（生成敌方场上单位）之前设置 double 标志。
    if (roomState.mode === MultiplayerMode.COOP) {
      globalScene.phaseManager.pushNew("CoopBattleSetupPhase");
    }

    globalScene.phaseManager.pushNew("EncounterPhase", false);
    globalScene.phaseManager.shiftPhase();
  }
}
