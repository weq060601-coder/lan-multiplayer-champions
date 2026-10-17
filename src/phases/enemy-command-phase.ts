import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { getMoveTargets } from "#moves/move-utils";
import type { EnemyPokemon } from "#field/pokemon";
import { FieldPhase } from "#phases/field-phase";
import { multiplayerManager } from "../multiplayer/multiplayer-manager";

/**
 * Phase for determining an enemy AI's action for the next turn.
 * During this phase, the enemy decides whether to switch (if it has a trainer)
 * or to use a move from its moveset.
 *
 * For more information on how the Enemy AI works, see docs/enemy-ai.md
 * @see {@linkcode Pokemon.getMatchupScore}
 * @see {@linkcode EnemyPokemon.getNextMove}
 */
export class EnemyCommandPhase extends FieldPhase {
  public readonly phaseName = "EnemyCommandPhase";
  protected fieldIndex: number;
  protected skipTurn = false;

  constructor(fieldIndex: number) {
    super();

    this.fieldIndex = fieldIndex;
    if (globalScene.currentBattle.mysteryEncounter?.skipEnemyBattleTurns) {
      this.skipTurn = true;
    }
  }

  start() {
    super.start();

    const enemyPokemon = globalScene.getEnemyField()[this.fieldIndex];

    const battle = globalScene.currentBattle;

    // PVP：敌方就是对面那个真人，指令不能由 AI 决定，必须等对手的广播。
    if (multiplayerManager.pvpManager.isActive) {
      this.resolveFromRemote(enemyPokemon);
      return;
    }

    const trainer = battle.trainer;

    if (
      battle.double
      && enemyPokemon.hasAbility(AbilityId.COMMANDER)
      && enemyPokemon.getAlly()?.getTag(BattlerTagType.COMMANDED)
    ) {
      this.skipTurn = true;
    }

    /**
     * If the enemy has a trainer, decide whether or not the enemy should switch
     * to another member in its party.
     *
     * This block compares the active enemy Pokemon's {@linkcode Pokemon.getMatchupScore | matchup score}
     * against the active player Pokemon with the enemy party's other non-fainted Pokemon. If a party
     * member's matchup score is 3x the active enemy's score (or 2x for "boss" trainers),
     * the enemy will switch to that Pokemon.
     */
    if (trainer && enemyPokemon.getMoveQueue().length === 0) {
      const opponents = enemyPokemon.getOpponents();

      if (!enemyPokemon.isTrapped()) {
        const partyMemberScores = trainer.getPartyMemberMatchupScores(enemyPokemon.trainerSlot, true);

        if (partyMemberScores.length > 0) {
          const matchupScores = opponents.map(opp => enemyPokemon.getMatchupScore(opp));
          const matchupScore = matchupScores.reduce((total, score) => (total += score), 0) / matchupScores.length;

          const sortedPartyMemberScores = trainer.getSortedPartyMemberMatchupScores(partyMemberScores);

          const switchMultiplier = 1 - (battle.enemySwitchCounter ? Math.pow(0.1, 1 / battle.enemySwitchCounter) : 0);

          if (sortedPartyMemberScores[0][1] * switchMultiplier >= matchupScore * (trainer.config.isBoss ? 2 : 3)) {
            const index = trainer.getNextSummonIndex(enemyPokemon.trainerSlot, partyMemberScores);

            battle.turnCommands[this.fieldIndex + BattlerIndex.ENEMY] = {
              command: Command.POKEMON,
              cursor: index,
              args: [false],
              skip: this.skipTurn,
            };

            battle.enemySwitchCounter++;

            return this.end();
          }
        }
      }
    }

    /** Select a move to use (and a target to use it against, if applicable) */
    const nextMove = enemyPokemon.getNextMove();

    if (this.shouldTera(enemyPokemon)) {
      globalScene.currentBattle.preTurnCommands[this.fieldIndex + BattlerIndex.ENEMY] = { command: Command.TERA };
    }

    globalScene.currentBattle.turnCommands[this.fieldIndex + BattlerIndex.ENEMY] = {
      command: Command.FIGHT,
      move: nextMove,
      skip: this.skipTurn,
    };

    globalScene.currentBattle.enemySwitchCounter = Math.max(globalScene.currentBattle.enemySwitchCounter - 1, 0);

    this.end();
  }

  /**
   * PVP：等对手这一回合的指令，翻译成敌方的 turnCommand。
   *
   * 跨机器只传「队伍序号 / 招式 ID」这类两台机器都一致的东西；
   * 目标（BattlerIndex）在本机重新算，因为同一只宝可梦在两台机器上的
   * BattlerIndex 是镜像的（我方 0/1 <-> 敌方 2/3），直接传会打到自己人身上。
   */
  private resolveFromRemote(enemyPokemon: EnemyPokemon): void {
    const battle = globalScene.currentBattle;
    const pvp = multiplayerManager.pvpManager;
    const turn = battle.turn;

    pvp.awaitRemoteCommand(turn).then(cmd => {
      const slot = this.fieldIndex + BattlerIndex.ENEMY;

      if (cmd?.kind === "SWITCH" && cmd.switchSlot !== undefined && cmd.switchSlot >= 0) {
        battle.turnCommands[slot] = {
          command: Command.POKEMON,
          cursor: cmd.switchSlot,
          args: [false],
          skip: this.skipTurn,
        };
        this.end();
        return;
      }

      let moveId = cmd?.moveId ?? MoveId.NONE;
      if (!moveId && cmd?.moveIndex !== undefined && cmd.moveIndex >= 0) {
        moveId = enemyPokemon.getMoveset()[cmd.moveIndex]?.moveId ?? MoveId.NONE;
      }
      // 对手掉线 / 超时：退化成挣扎，两台机器规则一致，不至于卡死在这一回合
      if (cmd == null || cmd.kind === "SKIP" || !moveId) {
        moveId = MoveId.STRUGGLE;
      }

      const targets = getMoveTargets(enemyPokemon, moveId).targets;

      battle.turnCommands[slot] = {
        command: Command.FIGHT,
        move: { move: moveId, targets, useMode: MoveUseMode.NORMAL },
        skip: this.skipTurn,
      };

      this.end();
    });
  }

  private shouldTera(pokemon: EnemyPokemon): boolean {
    return !!globalScene.currentBattle.trainer?.shouldTera(pokemon);
  }

  getFieldIndex(): number {
    return this.fieldIndex;
  }
}
