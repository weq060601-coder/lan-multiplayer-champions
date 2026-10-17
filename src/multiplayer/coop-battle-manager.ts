import { globalScene } from "#app/global-scene";
import { type NetworkPacket, PacketType, type TurnActionPayload } from "./multiplayer-types";
import type { MultiplayerManager } from "./multiplayer-manager";

/**
 * 方案二：双人协同双打闯关管理器
 */
export class CoopBattleManager {
  private multiplayer: MultiplayerManager;

  public isActive = false;

  public isWaitingForTeammate = false;
  public teammateSlotAction: TurnActionPayload | null = null;
  private readonly actionWaiters = new Map<string, (action: TurnActionPayload | null) => void>();

  constructor(multiplayer: MultiplayerManager) {
    this.multiplayer = multiplayer;
  }

  public initListeners(): void {
    this.multiplayer.transport.onPacket((packet: NetworkPacket) => {
      if (packet.type === PacketType.COOP_SLOT_ACTION_SUBMIT) {
        this.handleTeammateAction(packet.payload as TurnActionPayload);
      }
    });
  }

  /**
   * 客机提交自己控制的宝可梦槽位（Slot 1/2）操作
   */
  public submitSlotAction(action: TurnActionPayload): void {
    this.isWaitingForTeammate = true;
    this.multiplayer.transport.send(PacketType.COOP_SLOT_ACTION_SUBMIT, action);
  }

  public awaitSlotAction(turn: number, slotIndex: number, timeoutMs = 120000): Promise<TurnActionPayload | null> {
    const key = `${turn}:${slotIndex}`;
    return new Promise(resolve => {
      let timer: ReturnType<typeof setTimeout>;
      const finish = (action: TurnActionPayload | null) => {
        clearTimeout(timer);
        this.actionWaiters.delete(key);
        resolve(action);
      };
      timer = setTimeout(() => finish(null), timeoutMs);
      this.actionWaiters.set(key, finish);
    });
  }

  private handleTeammateAction(action: TurnActionPayload): void {
    this.teammateSlotAction = action;
    this.isWaitingForTeammate = false;
    this.actionWaiters.get(`${action.turnNumber}:${action.slotIndex}`)?.(action);
    console.log("[Coop] Received teammate battle action:", action);
  }

  public clear(): void {
    this.isActive = false;
    this.isWaitingForTeammate = false;
    this.teammateSlotAction = null;
    this.actionWaiters.clear();
  }
}
