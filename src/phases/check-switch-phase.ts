import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { getPokemonNameWithAffix } from "#app/messages";
import { BattleStyle } from "#enums/battle-style";
import { BattlerTagType } from "#enums/battler-tag-type";
import { SwitchType } from "#enums/switch-type";
import { UiMode } from "#enums/ui-mode";
import { BattlePhase } from "#phases/battle-phase";
import i18next from "i18next";
import { multiplayerManager } from "../multiplayer/multiplayer-manager";

export class CheckSwitchPhase extends BattlePhase {
  public readonly phaseName = "CheckSwitchPhase";
  protected fieldIndex: number;
  protected useName: boolean;

  constructor(fieldIndex: number, useName: boolean) {
    super();

    this.fieldIndex = fieldIndex;
    this.useName = useName;
  }

  start() {
    super.start();

    const pokemon = globalScene.getPlayerField()[this.fieldIndex];

    // End this phase early...

    // PVP：开局这个「要换宝可梦吗」必须跳过。
    // 它换的是本机的首发，但这次交换不会广播给对手 ——
    // 对面机器上「敌方首发」还是队伍第一只，两台机器立刻打成两场不同的仗。
    // 简化版的规则就是：选队时排在第一位的那只就是首发，锁定。
    if (multiplayerManager.pvpManager.isActive) {
      this.end();
      return;
    }

    // ...if the user is playing in Set Mode
    if (settings.general.battleStyle === BattleStyle.SET) {
      this.end();
      return;
    }

    // ...if the checked Pokemon is somehow not on the field
    if (globalScene.field.getAll().indexOf(pokemon) === -1) {
      globalScene.phaseManager.unshiftNew("SummonMissingPhase", this.fieldIndex);
      return super.end();
    }

    // ...if there are no other allowed Pokemon in the player's party to switch with
    if (
      globalScene
        .getPlayerParty()
        .slice(1)
        .filter(p => p.isActive()).length === 0
    ) {
      this.end();
      return;
    }

    // ...or if any player Pokemon has an effect that prevents the checked Pokemon from switching
    if (
      pokemon.getTag(BattlerTagType.FRENZY)
      || pokemon.isTrapped()
      || globalScene.getPlayerField().some(p => p.getTag(BattlerTagType.COMMANDED))
    ) {
      this.end();
      return;
    }

    globalScene.ui.showText(
      i18next.t("battle:switchQuestion", {
        pokemonName: this.useName ? getPokemonNameWithAffix(pokemon) : i18next.t("battle:pokemon"),
      }),
      null,
      () => {
        globalScene.ui.setMode(
          UiMode.CONFIRM,
          () => {
            globalScene.ui.setMode(UiMode.MESSAGE);
            globalScene.phaseManager.unshiftNew("SwitchPhase", SwitchType.INITIAL_SWITCH, this.fieldIndex, false, true);
            this.end();
          },
          () => {
            globalScene.ui.setMode(UiMode.MESSAGE);
            this.end();
          },
        );
      },
    );
  }
}
