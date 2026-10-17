import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { SwitchType } from "#enums/switch-type";
import { multiplayerManager } from "../multiplayer/multiplayer-manager";

/**
 * PVP：敌方（= 对手）的一只倒下之后，换上哪一只由**对手本人**决定，不能让 AI 猜。
 *
 * FaintPhase 原本直接 push 一个 slotIndex = -1 的 SwitchSummonPhase，
 * -1 会走 `trainer.getNextSummonIndex()` 的 AI 逻辑（switch-summon-phase.ts:57），
 * 两台机器算出来的结果和对手的实际选择没有任何关系，一换人就分叉。
 *
 * 所以 PVP 下改成先插这个 phase 等对手那边 SwitchPhase 的选择广播过来，
 * 再用确定的 slotIndex 去 unshift SwitchSummonPhase。
 */
export class PvpRemoteSwitchPhase extends Phase {
  public readonly phaseName = "PvpRemoteSwitchPhase";
  private readonly fieldIndex: number;

  constructor(fieldIndex: number) {
    super();
    this.fieldIndex = fieldIndex;
  }

  start(): void {
    super.start();

    const pvp = multiplayerManager.pvpManager;
    const enemy = globalScene.getEnemyField()[this.fieldIndex];
    // 这只其实没倒：说明两边已经打岔。不能在这里干等对手换人，否则换完就卡住。
    if (enemy && !enemy.isFainted()) {
      this.end();
      return;
    }

    pvp.awaitRemoteSwitchIn().then(slot => {
      const enemyParty = globalScene.getEnemyParty();
      let target = slot;

      // 超时或者对手给了个不能用的序号：退化成「补队伍里第一只还没倒的」，
      // 两台机器都用同一条规则，所以退化之后仍然一致。
      if (target < 0 || !enemyParty[target] || enemyParty[target].isFainted() || enemyParty[target].isOnField()) {
        target = enemyParty.findIndex(p => p && !p.isFainted() && !p.isOnField());
      }

      if (target >= 0) {
        globalScene.phaseManager.unshiftNew(
          "SwitchSummonPhase",
          SwitchType.SWITCH,
          this.fieldIndex,
          target,
          false,
          false,
        );
      }

      this.end();
    });
  }
}
