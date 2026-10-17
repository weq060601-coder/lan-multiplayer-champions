import { globalScene } from "#app/global-scene";
import type { PlayerPokemon } from "#field/pokemon";
import { type NetworkPacket, PacketType, type RaceProgressPayload, type SoulLinkFaintPayload } from "./multiplayer-types";
import { PartySerializer } from "./party-serializer";
import type { MultiplayerManager } from "./multiplayer-manager";

/**
 * 方案三：同种子竞速与灵魂同调管理器
 */
export class RaceManager {
  private multiplayer: MultiplayerManager;
  private lastSyncedWave = -1;

  public isSoulLinkEnabled = false;

  constructor(multiplayer: MultiplayerManager) {
    this.multiplayer = multiplayer;
  }

  public initListeners(): void {
    this.multiplayer.transport.onPacket((packet: NetworkPacket) => {
      if (packet.type === PacketType.RACE_PROGRESS_UPDATE) {
        this.handleProgressUpdate(packet.senderId, packet.payload as RaceProgressPayload);
      } else if (packet.type === PacketType.SOUL_LINK_FAINT) {
        this.handleSoulLinkFaint(packet.payload as SoulLinkFaintPayload);
      }
    });
  }

  /**
   * 广播本地玩家的最新闯关进度
   */
  public broadcastLocalProgress(): void {
    if (!this.multiplayer.isInRoom || !this.multiplayer.roomState?.gameStarted) return;

    try {
      const battle = globalScene.currentBattle;
      const arena = globalScene.arena;
      const party = globalScene.getPlayerParty();

      const wave = battle?.waveIndex ?? 1;
      const biome = arena?.biomeId ?? 0;
      const money = globalScene.money ?? 0;
      const score = globalScene.score ?? 0;

      const serializedParty = PartySerializer.serializeSimpleParty(party);
      const faintedCount = party.filter(p => p.isFainted()).length;
      const isGameOver = party.length > 0 && faintedCount === party.length;
      const isVictory = wave >= 200;

      const payload: RaceProgressPayload = {
        wave,
        biome,
        money,
        score,
        party: serializedParty,
        faintedCount,
        isGameOver,
        isVictory,
      };

      this.multiplayer.transport.send(PacketType.RACE_PROGRESS_UPDATE, payload);
    } catch (e) {
      console.warn("[RaceManager] Failed to broadcast progress:", e);
    }
  }

  /**
   * 当本地某只宝可梦濒死时触发
   */
  public onLocalPokemonFainted(pokemon: PlayerPokemon, slotIndex: number): void {
    if (!this.isSoulLinkEnabled) return;

    const payload: SoulLinkFaintPayload = {
      slotIndex,
      speciesId: pokemon.species.speciesId,
      pokemonName: pokemon.name || pokemon.species.name,
      wave: globalScene.currentBattle?.waveIndex ?? 1,
    };

    this.multiplayer.transport.send(PacketType.SOUL_LINK_FAINT, payload);
  }

  private handleProgressUpdate(senderId: string, payload: RaceProgressPayload): void {
    const player = this.multiplayer.getPlayer(senderId);
    if (player) {
      player.currentWave = payload.wave;
      player.currentBiome = payload.biome;
      player.partyPreview = payload.party;
      player.livingPokemonCount = payload.party.filter(p => !p.isFainted).length;
      player.hasFinished = payload.isVictory || payload.isGameOver;

      this.multiplayer.emitUpdate();
    }
  }

  private handleSoulLinkFaint(payload: SoulLinkFaintPayload): void {
    if (!this.isSoulLinkEnabled) return;

    const party = globalScene.getPlayerParty();
    if (payload.slotIndex >= 0 && payload.slotIndex < party.length) {
      const myPokemon = party[payload.slotIndex];
      if (myPokemon && !myPokemon.isFainted()) {
        myPokemon.hp = 0;
        console.warn(`[SoulLink] Teammate fainted! Cascading death to slot ${payload.slotIndex} (${myPokemon.name})`);
        globalScene.ui?.showText(`[灵魂同调] 队友的 ${payload.pokemonName} 倒下了，你的 ${myPokemon.name} 也随之阵亡！`);
      }
    }
  }
}
