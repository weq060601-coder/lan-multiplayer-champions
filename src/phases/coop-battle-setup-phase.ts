import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { MultiplayerMode } from "../multiplayer/multiplayer-types";
import { multiplayerManager } from "../multiplayer/multiplayer-manager";

/** Enable the native double-battle rules for the LAN co-op run. */
export class CoopBattleSetupPhase extends Phase {
  public readonly phaseName = "CoopBattleSetupPhase";

  start(): void {
    super.start();
    if (multiplayerManager.roomState?.mode === MultiplayerMode.COOP && globalScene.currentBattle) {
      globalScene.currentBattle.double = true;
      multiplayerManager.coopManager.isActive = true;
      console.log("[Coop] Native double-battle rules enabled");
    }
    this.end();
  }
}
