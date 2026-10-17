import { globalScene } from "#app/global-scene";
import { UiMode } from "#enums/ui-mode";
import {
  type NetworkPacket,
  PacketType,
  type PvpCommandPayload,
  type PvpHpSyncPayload,
  type PvpPartyPayload,
  type PvpSwitchInPayload,
  type SerializedFullPokemon,
} from "./multiplayer-types";
import { PartySerializer } from "./party-serializer";
import type { OptionSelectItem } from "#types/ui-types";
import type { MultiplayerManager } from "./multiplayer-manager";
import type { PvpFormat } from "./multiplayer-types";

/** PVP 固定为完整 6v6；队伍交换和战斗入口共用这一约束。 */
export const PVP_PARTY_SIZE = 3;

export function getPvpPartySize(format: PvpFormat | undefined): PvpFormat {
  return format === 6 ? 6 : 3;
}

/**
 * 方案一：局域网 PVP 竞技场管理器（简化版真对战）
 *
 * 设计要点（改之前先读，不然很容易把两台机器打成两场不同的仗）：
 *
 * 1. 镜像视角：A 机看到的是「我方 = A 队伍，敌方 = B 队伍」，B 机正好相反。
 *    所以跨机器传的下标一律传「队伍内序号」，不能传 BattlerIndex ——
 *    队伍序号在两台机器上一致，BattlerIndex 不一致。
 *
 * 2. 指令交换：本机 CommandPhase 选完招式就广播；本机 EnemyCommandPhase 不跑 AI，
 *    而是等对面那条广播到达再翻译成敌方 turnCommand。两边每回合各发一条各等一条，
 *    天然对齐；用 turn 号配对，先到的包进 buffer，不会错位。
 *
 * 3. 随机数：两台机器把 currentBattle.battleSeed 设成同一个值即可。
 *    Battle.randSeedInt() 每回合用 shiftCharCodes(battleSeed, turn << 6) 重新播种
 *    （battle.ts:497），所以某回合流水偶尔错开，下一回合也会自动对回来。
 *
 * 4. HP 兜底：速度并列之类的边界情况仍可能让伤害差一点。每回合结束由房主下发权威 HP，
 *    客机只做「非 0 -> 非 0」的修正（绝不写成 0、也绝不从 0 改回来），
 *    避免绕过 FaintPhase 产生「HP 归零却还在场上」的僵尸宝可梦。
 */
export class PvpBattleManager {
  private multiplayer: MultiplayerManager;

  /** 只有 PVP 房间真正开打后才为 true；所有 phase 里的 PVP 分支都靠它把守 */
  public isActive = false;

  public opponentName = "对手";
  public opponentParty: SerializedFullPokemon[] = [];

  /** 已到达但还没被 EnemyCommandPhase 取走的对手指令，按 turn 存 */
  private remoteCommands = new Map<number, PvpCommandPayload>();
  private commandWaiters = new Map<number, (cmd: PvpCommandPayload) => void>();

  /** 对手濒死换人的队伍序号队列（可靠通道，先到先出即可） */
  private remoteSwitchIns: number[] = [];
  private switchInWaiters: ((slot: number) => void)[] = [];

  private partyWaiters: (() => void)[] = [];

  /** 对局是否已判出胜负，避免重复结算 */
  public matchOver = false;
  /** 是否已经启动本机的结束流程；对手结束包只锁住回合指令，不能吞掉收尾。 */
  private endFlowStarted = false;
  private remoteRematchReady = false;
  private localRematchReady = false;
  private endPhaseDone: (() => void) | null = null;

  constructor(multiplayer: MultiplayerManager) {
    this.multiplayer = multiplayer;
  }

  public initListeners(): void {
    this.multiplayer.transport.onPacket((packet: NetworkPacket) => {
      switch (packet.type) {
        case PacketType.PVP_PARTY_SYNC:
          this.handlePartySync(packet.payload as PvpPartyPayload);
          break;
        case PacketType.PVP_ACTION_SUBMIT:
          this.handleRemoteCommand(packet.payload as PvpCommandPayload);
          break;
        case PacketType.PVP_SWITCH_IN:
          this.handleRemoteSwitchIn(packet.payload as PvpSwitchInPayload);
          break;
        case PacketType.PVP_HP_SYNC:
          this.applyHpSync(packet.payload as PvpHpSyncPayload);
          break;
        case PacketType.PVP_MATCH_OVER:
          this.matchOver = true;
          break;
        case PacketType.PVP_REMATCH_READY:
          if (this.multiplayer.isHost && this.isActive && this.endFlowStarted) {
            this.remoteRematchReady = true;
            this.tryStartRematch();
          }
          break;
        case PacketType.PVP_RETURN_HOME:
          if (this.multiplayer.isHost && packet.senderId !== this.multiplayer.transport.myPeerId) {
            this.multiplayer.transport.broadcast(PacketType.PVP_RETURN_HOME, {});
          }
          this.finishReturnHome();
          break;
      }
    });
  }

  // ---------------------------------------------------------------- 队伍交换

  /** 把自己选好的队伍发给对手（会被重复调用，用于「对面还没选完」时重发） */
  public sendMyParty(): void {
    const party = globalScene.getPlayerParty();
    const required = getPvpPartySize(this.multiplayer.roomState?.pvpFormat);
    if (party.length !== required) {
      console.warn(`[PVP] 需要 ${required} 只宝可梦，当前为 ${party.length} 只`);
      return;
    }
    const payload: PvpPartyPayload = {
      playerName: this.multiplayer.getMe()?.name ?? "Trainer",
      party: PartySerializer.serializeFullParty(party),
    };
    this.multiplayer.transport.send(PacketType.PVP_PARTY_SYNC, payload);
  }

  public get hasOpponentParty(): boolean {
    return this.opponentParty.length > 0;
  }

  /**
   * 等对手把队伍发过来。对面可能还在选初始宝可梦，所以边等边重发自己的队伍，
   * 免得自己的包发早了、对面还没进 PVP 流程就被丢掉。
   */
  public awaitOpponentParty(timeoutMs = 180000): Promise<boolean> {
    if (this.hasOpponentParty) return Promise.resolve(true);

    return new Promise<boolean>(resolve => {
      let done = false;
      const waiter = () => finish(true);
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        clearInterval(resend);
        clearTimeout(timer);
        this.partyWaiters = this.partyWaiters.filter(w => w !== waiter);
        resolve(ok);
      };
      this.partyWaiters.push(waiter);
      const resend = setInterval(() => this.sendMyParty(), 1500);
      const timer = setTimeout(() => finish(false), timeoutMs);
    });
  }

  /** 把对手的队伍变成本机的敌方队伍 */
  public buildEnemyParty() {
    return this.opponentParty.map(data => PartySerializer.createEnemyFromSerialized(data));
  }

  // ---------------------------------------------------------------- 回合指令

  public submitLocalCommand(payload: PvpCommandPayload): void {
    this.multiplayer.transport.send(PacketType.PVP_ACTION_SUBMIT, payload);
  }

  /** 等对手这一回合的指令；超时返回 null，由调用方退化成「敌方随便出一招」 */
  public awaitRemoteCommand(turn: number, timeoutMs = 120000): Promise<PvpCommandPayload | null> {
    const buffered = this.remoteCommands.get(turn);
    if (buffered) {
      this.remoteCommands.delete(turn);
      return Promise.resolve(buffered);
    }

    return new Promise<PvpCommandPayload | null>(resolve => {
      let done = false;
      const finish = (cmd: PvpCommandPayload | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.commandWaiters.delete(turn);
        resolve(cmd);
      };
      this.commandWaiters.set(turn, cmd => finish(cmd));
      const timer = setTimeout(() => finish(null), timeoutMs);
    });
  }

  // ------------------------------------------------------------ 濒死后换人

  public sendSwitchIn(slot: number): void {
    this.multiplayer.transport.send(PacketType.PVP_SWITCH_IN, { slot } as PvpSwitchInPayload);
  }

  /** 等对手选好换上哪一只；超时返回 -1，调用方退化成「补队伍里第一只没倒的」 */
  public awaitRemoteSwitchIn(timeoutMs = 120000): Promise<number> {
    const buffered = this.remoteSwitchIns.shift();
    if (buffered !== undefined) return Promise.resolve(buffered);

    return new Promise<number>(resolve => {
      let done = false;
      const waiter = (slot: number) => finish(slot);
      const finish = (slot: number) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.switchInWaiters = this.switchInWaiters.filter(w => w !== waiter);
        resolve(slot);
      };
      this.switchInWaiters.push(waiter);
      const timer = setTimeout(() => finish(-1), timeoutMs);
    });
  }

  // ------------------------------------------------------------------ HP 同步

  /** 房主在每回合结束时调用，把权威 HP 下发给客机 */
  public broadcastHpSync(): void {
    if (!this.isActive || !this.multiplayer.isHost) return;
    const payload: PvpHpSyncPayload = {
      turn: globalScene.currentBattle?.turn ?? 0,
      hostParty: globalScene.getPlayerParty().map(p => p.hp),
      clientParty: globalScene.getEnemyParty().map(p => p.hp),
    };
    this.multiplayer.transport.send(PacketType.PVP_HP_SYNC, payload);
  }

  /**
   * 客机侧把房主的权威 HP 贴回来。只修正「双方都还活着」的差值。
   */
  private applyHpSync(payload: PvpHpSyncPayload): void {
    if (!this.isActive || this.multiplayer.isHost) return;

    const fix = (
      pokemon: { hp: number; name?: string; isOnField?: () => boolean } | undefined,
      authoritative: number | undefined,
    ) => {
      if (!pokemon || authoritative === undefined || pokemon.hp === authoritative) return;
      // 已经倒下的不再改血，避免把濒死流程中途拉回来。还活着但房主判定为 0 时必须跟着倒下。
      if (pokemon.hp <= 0) return;
      console.warn("[PVP] HP 漂移修正:", pokemon.name, pokemon.hp, "->", authoritative);
      pokemon.hp = authoritative;
      const battlerIndex = (pokemon as { getBattlerIndex?: () => number }).getBattlerIndex?.();
      if (authoritative <= 0 && pokemon.isOnField?.() && battlerIndex !== undefined) {
        globalScene.phaseManager.queueFaintPhase(battlerIndex, false);
      }
    };

    // 客机视角：自己 = clientParty，敌方 = hostParty
    globalScene.getPlayerParty().forEach((p, i) => fix(p, payload.clientParty[i]));
    globalScene.getEnemyParty().forEach((p, i) => fix(p, payload.hostParty[i]));
  }

  // -------------------------------------------------------------------- 收尾

  public notifyMatchOver(): void {
    if (!this.isActive) return;
    this.multiplayer.transport.send(PacketType.PVP_MATCH_OVER, {});
  }

  // ---------------------------------------------------------------- 包处理

  private handlePartySync(payload: PvpPartyPayload | SerializedFullPokemon[]): void {
    // 兼容早期只发数组的格式
    const party = Array.isArray(payload) ? payload : payload?.party;
    const name = Array.isArray(payload) ? undefined : payload?.playerName;
    const required = getPvpPartySize(this.multiplayer.roomState?.pvpFormat);
    if (!party?.length || party.length !== required) {
      console.warn(`[PVP] 对手队伍不是完整 ${required}v${required} 队伍，已忽略`);
      return;
    }

    this.opponentParty = party;
    if (name) this.opponentName = name;
    console.log("[PVP] 收到对手队伍:", party.length, "只");

    const waiters = this.partyWaiters.slice();
    this.partyWaiters = [];
    waiters.forEach(w => w());
  }

  private handleRemoteCommand(cmd: PvpCommandPayload): void {
    if (!cmd) return;
    const waiter = this.commandWaiters.get(cmd.turn);
    if (waiter) {
      this.commandWaiters.delete(cmd.turn);
      waiter(cmd);
    } else {
      this.remoteCommands.set(cmd.turn, cmd);
    }
  }

  private handleRemoteSwitchIn(payload: PvpSwitchInPayload): void {
    const slot = payload?.slot ?? -1;
    const waiter = this.switchInWaiters.shift();
    if (waiter) {
      waiter(slot);
    } else {
      this.remoteSwitchIns.push(slot);
    }
  }

  /** 对局结束后双方可留房准备重赛，或由任一方发起同步退房。 */
  public endMatch(won: boolean, onDone: () => void): void {
    if (this.endFlowStarted) return;
    this.endFlowStarted = true;
    this.matchOver = true;
    this.endPhaseDone = onDone;
    this.notifyMatchOver();
    globalScene.phaseManager.clearAllPhases();

    const text = won ? `你赢了！击败了 ${this.opponentName}。` : `你输了，${this.opponentName} 获胜。`;
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
      globalScene.ui.showText(text, null, () => {
        globalScene.ui.clearText();
        const options: OptionSelectItem[] = [
          {
            label: "留在房间，准备下一局",
            handler: () => {
              if (this.multiplayer.isHost) {
                this.localRematchReady = true;
                if (!this.tryStartRematch()) {
                  globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
                    globalScene.ui.showText("已准备，等待对手选择继续…", null, () => {}, null, true);
                  });
                }
              } else {
                this.multiplayer.transport.send(PacketType.PVP_REMATCH_READY, {});
                globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
                  globalScene.ui.showText("已准备，等待房主开始下一局…", null, () => {}, null, true);
                });
              }
              return true;
            },
          },
          {
            label: "回到主页",
          handler: () => {
              if (this.multiplayer.isHost) {
                this.multiplayer.transport.broadcast(PacketType.PVP_RETURN_HOME, {});
                this.finishReturnHome();
              } else {
                this.multiplayer.transport.send(PacketType.PVP_RETURN_HOME, {});
                globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
                  globalScene.ui.showText("正在同步退出房间…", null, () => {}, null, true);
                });
              }
              return true;
            },
          },
        ];
        globalScene.ui.setMode(UiMode.OPTION_SELECT, { options, noCancel: true });
      }, null, true);
    });
  }

  private tryStartRematch(): boolean {
    if (!this.multiplayer.isHost || !this.multiplayer.roomState || !this.endFlowStarted) return false;
    if (!this.localRematchReady || !this.remoteRematchReady) return false;
    this.localRematchReady = false;
    this.remoteRematchReady = false;
    // 新的 START_GAME 会触发大厅的统一开局入口：清理上一局队伍并重走选队。
    this.multiplayer.preparePvpRematch();
    return true;
  }

  private finishReturnHome(): void {
    if (!this.endFlowStarted) return;
    const phaseDone = this.endPhaseDone;
    this.endPhaseDone = null;
    this.multiplayer.leaveRoom();
    this.clear();
    globalScene.reset();
    globalScene.phaseManager.toTitleScreen();
    phaseDone?.();
  }

  public clear(): void {
    this.isActive = false;
    this.matchOver = false;
    this.endFlowStarted = false;
    this.remoteRematchReady = false;
    this.localRematchReady = false;
    this.endPhaseDone = null;
    this.opponentParty = [];
    this.opponentName = "对手";
    this.remoteCommands.clear();
    this.commandWaiters.clear();
    this.remoteSwitchIns = [];
    this.switchInWaiters = [];
    this.partyWaiters = [];
  }
}
