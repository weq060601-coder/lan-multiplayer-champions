import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { BattleType } from "#enums/battle-type";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { UiMode } from "#enums/ui-mode";
import { Trainer } from "#field/trainer";
import { multiplayerManager } from "../multiplayer/multiplayer-manager";
import { PartySerializer } from "../multiplayer/party-serializer";
import { getPvpPartySize } from "../multiplayer/pvp-battle-manager";

/**
 * PVP 开局：双方交换完整队伍，并把这场战斗改造成「对手的 6 只 vs 我的 6 只」。
 *
 * 必须插在 SelectStarterPhase 之后、EncounterPhase 之前：
 * - SelectStarterPhase.initBattle() 里才会 newBattle()，所以在它之前拿不到 currentBattle；
 * - EncounterPhase 会按 battle.enemyLevels 生成敌方队伍，所以要在它之前把队伍准备好。
 */
export class PvpPartySyncPhase extends Phase {
  public readonly phaseName = "PvpPartySyncPhase";

  start(): void {
    super.start();

    const pvp = multiplayerManager.pvpManager;

    const partySize = getPvpPartySize(multiplayerManager.roomState?.pvpFormat);
    if (globalScene.getPlayerParty().length !== partySize) {
      globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
        globalScene.ui.showText(
          `${partySize}v${partySize} 对战需要选择 ${partySize} 只宝可梦，当前只有 ${globalScene.getPlayerParty().length} 只。`,
          null,
          () => {
            globalScene.ui.clearText();
            multiplayerManager.leaveRoom();
            pvp.clear();
            globalScene.phaseManager.clearAllPhases();
            globalScene.phaseManager.toTitleScreen();
            this.end();
          },
          null,
          true,
        );
      });
      return;
    }

    globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
      globalScene.ui.showText("正在与对手交换队伍，请稍候…", null, () => {}, null, true);

      pvp.sendMyParty();
      pvp.awaitOpponentParty().then(ok => {
        if (!ok) {
          globalScene.ui.showText("等不到对手的队伍，联机对战取消。", null, () => {
            globalScene.ui.clearText();
            multiplayerManager.leaveRoom();
            pvp.clear();
            globalScene.phaseManager.clearAllPhases();
            // ⚠️ toTitleScreen() 只是把 TitlePhase 放进队列，还得靠 end() 去驱动 shiftPhase()。
            //    少了这句 end()，队列里躺着 TitlePhase 但没人跑它，游戏卡在一片空白上。
            globalScene.phaseManager.toTitleScreen();
            this.end();
          }, null, true);
          return;
        }

        this.configureBattle();
        globalScene.ui.clearText();
        this.end();
      });
    });
  }

  /** 把 newBattle() 造出来的野生遭遇改造成「训练家对战」，敌方队伍来自对手 */
  private configureBattle(): void {
    const pvp = multiplayerManager.pvpManager;
    const battle = globalScene.currentBattle;
    const room = multiplayerManager.roomState;

    // 6v6 训练家战斗：场上仍按标准单打轮流出场，濒死后自动换下一只。
    battle.double = false;

    // ⚠️ 用 BattleType.TRAINER 而不是 WILD：训练家对战自带
    //    「整队 6 只 / 倒了自动换下一只 / 全倒才算输」这三件事，
    //    野生遭遇只有一只在场，倒了立刻结算，做不成 6v6。
    battle.battleType = BattleType.TRAINER;
    if (!battle.trainer) {
      battle.trainer = new Trainer(TrainerType.ACE_TRAINER, TrainerVariant.DEFAULT, 0);
    }
    battle.trainer.name = pvp.opponentName;

    // 敌方队伍 = 对手真实队伍。enemyLevels 的长度决定 EncounterPhase 生成几只
    const enemyParty = pvp.buildEnemyParty();
    battle.enemyLevels = enemyParty.map(p => p.level);
    battle.enemyParty = enemyParty;

    // 对手选的持有物要重建成**敌方**持有物。
    // 必须放在 battle.enemyParty 赋值之后：道具是按 pokemonId 认主的，宝可梦得先就位。
    PartySerializer.applyEnemyHeldItems(enemyParty, pvp.opponentParty);

    // ⚠️ 两台机器必须共用同一个 battleSeed，否则伤害浮动 / 命中 / 会心各算各的。
    //    battleSeed 每回合会用 shiftCharCodes(battleSeed, turn << 6) 重新播种，
    //    所以只要初始值一样，之后每回合都自动对齐。
    battle.battleSeed = derivePvpBattleSeed(room?.seed ?? "PVP");
    battle.resetPvpTurnSeed();
    battle.pvpLockstep = true;
    battle.pvpHostIsPlayer = multiplayerManager.isHost;

    console.log(
      "[PVP] 对局已就绪：对手",
      pvp.opponentName,
      "队伍",
      enemyParty.length,
      "只，battleSeed =",
      battle.battleSeed,
    );
  }
}

/** 把房间码/种子拉伸成 randomString(16, true) 那种 16 位字符串，两台机器算出来一样 */
function derivePvpBattleSeed(roomSeed: string): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let hash = 2166136261;
  for (let i = 0; i < roomSeed.length; i++) {
    hash ^= roomSeed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  let out = "";
  for (let i = 0; i < 16; i++) {
    hash = Math.imul(hash ^ (i + 1), 16777619) >>> 0;
    out += chars[hash % chars.length];
  }
  return out;
}
