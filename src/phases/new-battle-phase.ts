import { globalScene } from "#app/global-scene";
import { BattlePhase } from "#phases/battle-phase";
import { multiplayerManager } from "../multiplayer/multiplayer-manager";
import { multiplayerOverlayWidget } from "../ui/handlers/multiplayer-overlay-ui-handler";

export class NewBattlePhase extends BattlePhase {
  public readonly phaseName = "NewBattlePhase";
  start() {
    super.start();

    globalScene.phaseManager.removeAllPhasesOfType("NewBattlePhase");

    globalScene.newBattle();

    if (multiplayerManager.isInRoom) {
      multiplayerOverlayWidget.show();
      multiplayerManager.raceManager.broadcastLocalProgress();
    }

    this.end();
  }
}
