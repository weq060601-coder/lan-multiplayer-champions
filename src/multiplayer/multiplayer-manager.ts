import { GameModes } from "#enums/game-modes";
import {
  MultiplayerMode,
  type MultiplayerPlayer,
  type NetworkPacket,
  PacketType,
  PlayerRole,
  type PvpDexSnapshotEntry,
  type PvpFormat,
  type RoomState,
} from "./multiplayer-types";
import { NetworkTransport } from "./network-transport";
import type { SignalConfig } from "./signal-config";
import { RaceManager } from "./race-manager";
import { PvpBattleManager } from "./pvp-battle-manager";
import { CoopBattleManager } from "./coop-battle-manager";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { globalScene } from "#app/global-scene";
import { AbilityAttr } from "#enums/ability-attr";
import { AbilityId } from "#enums/ability-id";
import type { DexEntry } from "#types/dex-data";
import type { StarterDataEntry } from "#types/save-data";

export type RoomUpdateListener = (state: RoomState) => void;
export type GameStartListener = (state: RoomState) => void;

/**
 * 局域网联机子系统核心管理单例
 */
export class MultiplayerManager {
  private static instance: MultiplayerManager;

  public transport: NetworkTransport;
  public roomState: RoomState | null = null;

  public raceManager: RaceManager;
  public pvpManager: PvpBattleManager;
  public coopManager: CoopBattleManager;

  private roomUpdateListeners: RoomUpdateListener[] = [];
  private gameStartListeners: GameStartListener[] = [];
  private pvpDexSnapshot: Map<number, { dex: DexEntry; starter?: StarterDataEntry }> | null = null;
  private roomSyncRetryTimer: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    this.transport = new NetworkTransport();
    this.raceManager = new RaceManager(this);
    this.pvpManager = new PvpBattleManager(this);
    this.coopManager = new CoopBattleManager(this);

    this.setupPacketHandlers();
    this.transport.onConnect(peerId => {
      // 连接刚建立时先发一次当前房间状态，避免首个 ROOM_JOIN_REQUEST 丢失后副机永久卡在同步页。
      if (this.isHost && this.roomState) {
        this.transport.sendToPeer(peerId, PacketType.ROOM_STATE_SYNC, this.roomState);
      }
    });
    this.raceManager.initListeners();
    this.pvpManager.initListeners();
    this.coopManager.initListeners();
  }

  public static getInstance(): MultiplayerManager {
    if (!MultiplayerManager.instance) {
      MultiplayerManager.instance = new MultiplayerManager();
    }
    return MultiplayerManager.instance;
  }

  public get isInRoom(): boolean {
    return this.roomState !== null;
  }

  public get isHost(): boolean {
    return this.transport.isHost;
  }

  public getMe(): MultiplayerPlayer | undefined {
    return this.roomState?.players.find(p => p.id === this.transport.myPeerId);
  }

  public getPlayer(peerId: string): MultiplayerPlayer | undefined {
    return this.roomState?.players.find(p => p.id === peerId);
  }

  public getTeammate(): MultiplayerPlayer | undefined {
    return this.roomState?.players.find(p => p.id !== this.transport.myPeerId);
  }

  /**
   * 创建房间 (作为房主)
   */
  public async createRoom(
    roomCode: string,
    playerName: string,
    mode: MultiplayerMode = MultiplayerMode.RACE,
    baseGameMode: GameModes = GameModes.CLASSIC,
    pvpFormat: PvpFormat = 3,
    pvpFullDex = false,
    pvpLegendary = false,
  ): Promise<string> {
    const peerId = await this.transport.createHost(roomCode, playerName);

    // 随机生成局域网同步种子 (Seed)
    const seed = Math.random().toString(36).substring(2, 10).toUpperCase();

    this.roomState = {
      roomId: roomCode.toUpperCase(),
      roomName: `${playerName} 的房间`,
      mode,
      baseGameMode,
      seed,
      players: [
        {
          id: peerId,
          name: playerName,
          role: PlayerRole.HOST,
          isReady: true,
        },
      ],
      gameStarted: false,
      ...(mode === MultiplayerMode.PVP ? { pvpFormat } : {}),
      ...(mode === MultiplayerMode.PVP ? { pvpFullDex, pvpLegendary } : {}),
    };

    if (mode === MultiplayerMode.SOUL_LINK) {
      this.raceManager.isSoulLinkEnabled = true;
    }

    this.emitUpdate();
    return peerId;
  }

  /**
   * 加入房间 (作为客机)
   */
  public async joinRoom(roomCode: string, playerName: string, signal?: SignalConfig): Promise<boolean> {
    this.roomState = null;
    this.stopRoomSyncRetry();
    const success = await this.transport.joinHost(roomCode, playerName, signal);
    if (success) {
      const request = () => this.transport.send(PacketType.ROOM_JOIN_REQUEST, { playerName });
      request();
      // WebRTC 通道已打开但首个数据包偶尔会丢失时，重复握手请求直到收到状态。
      let attempts = 0;
      this.roomSyncRetryTimer = setInterval(() => {
        if (this.roomState || ++attempts >= 10) {
          this.stopRoomSyncRetry();
          return;
        }
        request();
      }, 1000);
    }
    return success;
  }

  /**
   * 切换就绪状态
   */
  public toggleReady(): void {
    if (!this.roomState) return;

    const me = this.getMe();
    if (me) {
      me.isReady = !me.isReady;
      if (this.isHost) {
        this.broadcastRoomState();
      } else {
        this.transport.send(PacketType.PLAYER_READY_TOGGLE, {
          isReady: me.isReady,
        });
      }
      this.emitUpdate();
    }
  }

  /**
   * 更改房间模式 (仅房主可用)
   */
  public setMode(mode: MultiplayerMode): void {
    if (!this.isHost || !this.roomState) return;
    this.roomState.mode = mode;
    this.raceManager.isSoulLinkEnabled = mode === MultiplayerMode.SOUL_LINK;
    this.broadcastRoomState();
    this.emitUpdate();
  }

  /**
   * 房主启动游戏
   */
  public startGame(): void {
    if (!this.isHost || !this.roomState) return;

    if (this.roomState.players.length < 2) return;
    if (!this.roomState.players.every(player => player.isReady)) return;

    this.roomState.gameStarted = true;
    if (this.roomState.mode === MultiplayerMode.PVP) {
      this.roomState.pvpDexSnapshot = this.createPvpDexSnapshot();
    }
    this.transport.broadcast(PacketType.START_GAME, this.roomState);
    this.notifyGameStarted();
  }

  /** 当前房间的选队权限以房主存档为准，快照随 START_GAME 一并广播。 */
  private createPvpDexSnapshot(): Record<number, PvpDexSnapshotEntry> {
    const snapshot: Record<number, PvpDexSnapshotEntry> = {};
    for (const species of speciesDataRegistry.getAllSpecies()) {
      const id = species.speciesId;
      const dex = globalScene.gameData.dexData[id];
      if (!dex) continue;
      snapshot[id] = {
        seenAttr: dex.seenAttr.toString(),
        caughtAttr: dex.caughtAttr.toString(),
        natureAttr: dex.natureAttr,
        seenCount: dex.seenCount,
        caughtCount: dex.caughtCount,
        hatchedCount: dex.hatchedCount,
        ivs: [...dex.ivs],
        abilityAttr: globalScene.gameData.starterData[id]?.abilityAttr ?? 0,
      };
    }
    return snapshot;
  }

  /** 房主重置房间状态后，双方回到大厅并可在同一连接中开下一局。 */
  public preparePvpRematch(): void {
    if (!this.isHost || !this.roomState) return;
    this.restorePvpDex();
    this.pvpManager.clear();
    this.roomState.gameStarted = true;
    this.roomState.seed = Math.random().toString(36).substring(2, 10).toUpperCase();
    this.roomState.players.forEach(player => { player.isReady = false; });
    this.roomState.pvpDexSnapshot = this.createPvpDexSnapshot();
    this.transport.broadcast(PacketType.START_GAME, this.roomState);
    this.notifyGameStarted();
  }

  /**
   * 离开当前房间
   */
  public leaveRoom(): void {
    if (this.roomState) {
      this.transport.send(PacketType.LEAVE_ROOM, {});
    }
    // 注意：这里必须用 resetConnection 而不是 destroy，
    // 否则会把 onPacket 监听器一起清掉，导致下次建房/加房收不到任何包。
    this.transport.resetConnection();
    this.stopRoomSyncRetry();
    this.raceManager.isSoulLinkEnabled = false;
    this.coopManager.clear();
    this.pvpManager.clear();
    this.restorePvpDex();
    this.roomState = null;
    this.notifyRoomCleared();
  }

  /** 在本场 PVP 中临时开放完整图鉴，结束后由 restorePvpDex 恢复。 */
  public applyPvpDex(fullDex: boolean, hostSnapshot?: Record<number, PvpDexSnapshotEntry>): void {
    this.restorePvpDex();

    const snapshot = new Map<number, { dex: DexEntry; starter?: StarterDataEntry }>();
    for (const species of speciesDataRegistry.getAllSpecies()) {
      const speciesId = species.speciesId;
      const dexEntry = globalScene.gameData.dexData[speciesId];
      if (!dexEntry) {
        continue;
      }
      const starter = globalScene.gameData.starterData[speciesId];
      snapshot.set(speciesId, {
        dex: { ...dexEntry, ivs: [...dexEntry.ivs] },
        starter: starter ? { ...starter } : starter,
      });

      // 非全圖鑑房間使用房主快照作為兩端共同的解鎖權限；不讀取客機自己的圖鑑。
      const hostDex = hostSnapshot?.[speciesId] ?? {
        seenAttr: "0",
        caughtAttr: "0",
        natureAttr: 0,
        seenCount: 0,
        caughtCount: 0,
        hatchedCount: 0,
        ivs: [0, 0, 0, 0, 0, 0],
        abilityAttr: 0,
      };
      if (!fullDex) {
        // 新版房间总会下发完整快照；缺失条目按未解锁处理，避免客机本地存档
        // 在房主关闭全图鉴时意外开放宝可梦或特性。
        dexEntry.seenAttr = BigInt(hostDex.seenAttr);
        dexEntry.caughtAttr = BigInt(hostDex.caughtAttr);
        dexEntry.natureAttr = hostDex.natureAttr;
        dexEntry.seenCount = hostDex.seenCount;
        dexEntry.caughtCount = hostDex.caughtCount;
        dexEntry.hatchedCount = hostDex.hatchedCount;
        dexEntry.ivs = [...hostDex.ivs];
        if (starter) {
          starter.abilityAttr = hostDex.abilityAttr;
        }
      }

      if (!fullDex) {
        continue;
      }
      const fullUnlocks = species.getFullUnlocksData();
      dexEntry.seenAttr = fullUnlocks;
      dexEntry.caughtAttr = fullUnlocks;
      // 全图鉴房间同时开放该种族的所有普通/隐藏特性，供选队阶段切换。
      if (starter) {
        starter.abilityAttr |= AbilityAttr.ABILITY_1;
        if (species.ability2 !== AbilityId.NONE && species.ability2 !== species.ability1) {
          starter.abilityAttr |= AbilityAttr.ABILITY_2;
        }
        if (species.abilityHidden !== AbilityId.NONE) {
          starter.abilityAttr |= AbilityAttr.ABILITY_HIDDEN;
        }
      }
      dexEntry.natureAttr = (1 << 26) - 2;
    }
    this.pvpDexSnapshot = snapshot;
  }

  /** 恢复进入 PVP 前的图鉴数据，防止临时选项污染系统存档。 */
  public restorePvpDex(): void {
    if (!this.pvpDexSnapshot) {
      return;
    }
    if (globalScene?.gameData) {
      for (const [speciesId, saved] of this.pvpDexSnapshot) {
        globalScene.gameData.dexData[speciesId] = saved.dex;
        if (saved.starter) {
          globalScene.gameData.starterData[speciesId] = saved.starter;
        }
      }
    }
    this.pvpDexSnapshot = null;
  }

  public broadcastRoomState(): void {
    if (!this.isHost || !this.roomState) return;
    this.transport.broadcast(PacketType.ROOM_STATE_SYNC, this.roomState);
  }

  private setupPacketHandlers(): void {
    this.transport.onPacket((packet: NetworkPacket) => {
      switch (packet.type) {
        case PacketType.ROOM_JOIN_REQUEST:
          if (this.isHost && this.roomState) {
            // 限制 2 人房间
            const existing = this.getPlayer(packet.senderId);
            if (!existing && this.roomState.players.length < 2) {
              this.roomState.players.push({
                id: packet.senderId,
                name: packet.payload.playerName || packet.senderName || "Guest",
                role: PlayerRole.CLIENT,
                isReady: false,
              });
              this.broadcastRoomState();
              this.emitUpdate();
            }
            // 即使是重复请求，也要回应当前状态；客户端可安全重发握手包。
            this.transport.sendToPeer(packet.senderId, PacketType.ROOM_STATE_SYNC, this.roomState);
          }
          break;

        case PacketType.ROOM_STATE_SYNC:
          if (!this.isHost) {
            this.stopRoomSyncRetry();
            this.roomState = packet.payload as RoomState;
            this.raceManager.isSoulLinkEnabled = this.roomState.mode === MultiplayerMode.SOUL_LINK;
            this.emitUpdate();
          }
          break;

        case PacketType.PLAYER_READY_TOGGLE:
          if (this.isHost && this.roomState) {
            const player = this.getPlayer(packet.senderId);
            if (player) {
              player.isReady = packet.payload.isReady;
              this.broadcastRoomState();
              this.emitUpdate();
            }
          }
          break;

        case PacketType.START_GAME:
          if (!this.isHost) {
            this.roomState = packet.payload as RoomState;
            this.notifyGameStarted();
          }
          break;

        case PacketType.PVP_REMATCH_READY:
          // PvpBattleManager 收到后与房主本地选择合并；房间管理器不改生命周期。
          break;

        case PacketType.PVP_REMATCH_START:
          if (!this.isHost) {
            this.roomState = packet.payload as RoomState;
            this.emitUpdate();
          }
          break;

        case PacketType.LEAVE_ROOM:
          if (this.roomState) {
            this.roomState.players = this.roomState.players.filter(p => p.id !== packet.senderId);
            if (this.isHost) {
              this.broadcastRoomState();
            }
            this.emitUpdate();
          }
          break;
      }
    });

    this.transport.onDisconnect(() => {
      console.log("[Multiplayer] Peer disconnected");
      if (!this.roomState) {
        return;
      }
      if (this.isHost) {
        if (this.roomState.gameStarted) {
          this.roomState = null;
          this.pvpManager.clear();
          this.coopManager.clear();
          this.raceManager.isSoulLinkEnabled = false;
          this.restorePvpDex();
          this.notifyRoomCleared();
        } else {
          this.roomState.players = this.roomState.players.filter(p => p.id === this.transport.myPeerId);
          this.emitUpdate();
        }
      } else {
        this.stopRoomSyncRetry();
        this.roomState = null;
        this.pvpManager.clear();
        this.coopManager.clear();
        this.restorePvpDex();
        this.notifyRoomCleared();
      }
    });
  }

  public onRoomUpdate(listener: RoomUpdateListener): () => void {
    this.roomUpdateListeners.push(listener);
    return () => {
      this.roomUpdateListeners = this.roomUpdateListeners.filter(l => l !== listener);
    };
  }

  public onGameStarted(listener: GameStartListener): () => void {
    this.gameStartListeners.push(listener);
    return () => {
      this.gameStartListeners = this.gameStartListeners.filter(l => l !== listener);
    };
  }

  public emitUpdate(): void {
    if (this.roomState) {
      this.roomUpdateListeners.forEach(l => l(this.roomState!));
    }
  }

  /**
   * 房间已被清空（退出/被踢/断线）时通知 UI。
   * emitUpdate 有非空守卫，这里单独发一个空状态，让大厅能退回主菜单。
   */
  private notifyRoomCleared(): void {
    this.roomUpdateListeners.forEach(l => l(null as unknown as RoomState));
  }

  private stopRoomSyncRetry(): void {
    if (this.roomSyncRetryTimer) {
      clearInterval(this.roomSyncRetryTimer);
      this.roomSyncRetryTimer = null;
    }
  }

  private notifyGameStarted(): void {
    if (this.roomState) {
      this.gameStartListeners.forEach(l => l(this.roomState!));
    }
  }
}

export const multiplayerManager = MultiplayerManager.getInstance();
