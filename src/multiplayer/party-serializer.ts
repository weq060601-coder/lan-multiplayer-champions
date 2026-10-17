import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { EnemyPokemon, type PlayerPokemon } from "#field/pokemon";
import { getModifierTypeFuncById, type ModifierType, type PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { PokemonMove } from "#data/moves/pokemon-move";
import { TrainerSlot } from "#enums/trainer-slot";
import type { MoveId } from "#enums/move-id";
import type { SpeciesId } from "#enums/species-id";
import type { Variant } from "#sprites/variant";
import type { SerializedFullPokemon, SerializedPokemonSimple } from "./multiplayer-types";

/**
 * 宝可梦队伍数据序列化与反序列化工具
 */
export class PartySerializer {
  /**
   * 将当前出战队伍简化为预览数据（用于大厅和侧边栏 UI）
   */
  public static serializeSimpleParty(party: PlayerPokemon[]): SerializedPokemonSimple[] {
    if (!party || !party.length) return [];
    return party.map(pokemon => {
      const maxHp = pokemon.getMaxHp();
      const currentHp = pokemon.hp;
      return {
        speciesId: pokemon.species.speciesId,
        name: pokemon.name || pokemon.species.name,
        level: pokemon.level,
        hpPercent: maxHp > 0 ? Math.max(0, Math.min(100, Math.round((currentHp / maxHp) * 100))) : 0,
        isFainted: pokemon.isFainted(),
        isShiny: pokemon.shiny,
      };
    });
  }

  /**
   * 完整序列化队伍（用于 PVP 对战与 Co-op 双打）
   */
  public static serializeFullParty(party: PlayerPokemon[]): SerializedFullPokemon[] {
    if (!party || !party.length) return [];
    return party.map(pokemon => {
      const moves = (pokemon.moveset || []).filter(m => m && m.moveId).map(m => {
        const maxPp = m.getMovePp();
        const pp = Math.max(0, maxPp - m.ppUsed);
        return {
          moveId: m.moveId as MoveId,
          pp,
          maxPp,
        };
      });

      const ivs: [number, number, number, number, number, number] = [
        pokemon.ivs[0] ?? 31,
        pokemon.ivs[1] ?? 31,
        pokemon.ivs[2] ?? 31,
        pokemon.ivs[3] ?? 31,
        pokemon.ivs[4] ?? 31,
        pokemon.ivs[5] ?? 31,
      ];

      const stats: [number, number, number, number, number, number] = [
        pokemon.stats[0] ?? 100,
        pokemon.stats[1] ?? 100,
        pokemon.stats[2] ?? 100,
        pokemon.stats[3] ?? 100,
        pokemon.stats[4] ?? 100,
        pokemon.stats[5] ?? 100,
      ];

      // PVP：持有物只传 typeId + 层数，收到的一侧按队伍序号重建成敌方道具
      const heldItems = pokemon
        .getHeldItems()
        .filter(m => m?.type?.id)
        .map(m => {
          const pregenArgs = (m.type as ModifierType & { getPregenArgs?: () => unknown[] }).getPregenArgs?.();
          return {
            typeId: m.type.id,
            stackCount: m.stackCount,
            ...(pregenArgs ? { pregenArgs } : {}),
          };
        });

      return {
        speciesId: pokemon.species.speciesId,
        name: pokemon.name || pokemon.species.name,
        level: pokemon.level,
        gender: pokemon.gender,
        formIndex: pokemon.formIndex,
        shiny: pokemon.shiny,
        variant: pokemon.variant,
        nature: pokemon.getNature(),
        ability: pokemon.abilityIndex,
        passiveAbility: pokemon.passive ? 1 : 0,
        ivs,
        evs: [0, 0, 0, 0, 0, 0],
        currentHp: pokemon.hp,
        maxHp: pokemon.getMaxHp(),
        stats,
        moves,
        heldItems,
      };
    });
  }

  /**
   * 从序列化数据在当前战斗中生成对手宝可梦（EnemyPokemon）
   */
  public static createEnemyFromSerialized(data: SerializedFullPokemon): EnemyPokemon {
    const species = speciesDataRegistry.getSpecies(data.speciesId);
    // ⚠️ trainerSlot 必须是 TRAINER 而不是 NONE：
    //    FaintPhase 判断「敌方还有没有后备」时会比对 trainerSlot
    //    (faint-phase.ts:188 `p.trainerSlot === pokemon.trainerSlot`)，
    //    填 NONE 的话对手倒了一只之后就再也换不上人，战斗直接判结束。
    const enemyPokemon = new EnemyPokemon(species, data.level, TrainerSlot.TRAINER, false, !data.shiny);

    enemyPokemon.gender = data.gender;
    enemyPokemon.formIndex = data.formIndex;
    enemyPokemon.nature = data.nature;
    enemyPokemon.abilityIndex = data.ability;
    enemyPokemon.ivs = data.ivs;
    enemyPokemon.shiny = data.shiny;
    enemyPokemon.variant = (data.variant as Variant) || 0;
    enemyPokemon.passive = !!data.passiveAbility;

    // ⚠️ 上面改了 formIndex / nature / ivs，构造函数里算好的 stats 已经过时，
    //    不重算的话 getMaxHp() 还是旧值，血条和伤害全对不上。
    enemyPokemon.calculateStats();

    enemyPokemon.hp = Math.min(enemyPokemon.getMaxHp(), data.currentHp || enemyPokemon.getMaxHp());

    if (data.moves && data.moves.length > 0) {
      enemyPokemon.moveset = data.moves.map(m => new PokemonMove(m.moveId, Math.max(0, m.maxPp - m.pp)));
    }

    // ⚠️⚠️ 必须 init()：它才会建精灵图和血条并挂进 fieldUI
    //    (pokemon.ts:514 initBattleInfo() + addPokemonSprite)。
    //    battle-scene.ts 的 addEnemyPokemon() 最后一行也是 pokemon.init()。
    //    漏掉它的症状就是「战斗开始了但敌方一只宝可梦都看不见」。
    //    放在最后调用：精灵图的贴图 key 取决于 formIndex/shiny/variant，血条取决于 hp/maxHp，
    //    这些都得先设好。
    enemyPokemon.init();

    return enemyPokemon;
  }

  /**
   * PVP：把对手队伍里记录的持有物重建成**敌方**持有物。
   *
   * 必须在敌方队伍已经装进 battle.enemyParty 之后再调用 ——
   * PokemonHeldItemModifier 是按 pokemonId 认主的，宝可梦得先存在。
   *
   * ⚠️ 走 addEnemyModifier() 而不是 addModifier()：
   *    前者进 globalScene.enemyModifiers，后者进 globalScene.modifiers。
   *    填错的话对手的剩饭会给我自己回血。
   */
  public static applyEnemyHeldItems(party: EnemyPokemon[], data: SerializedFullPokemon[]): void {
    party.forEach((pokemon, i) => {
      const items = data[i]?.heldItems;
      if (!pokemon) {
        return;
      }
      for (const item of items ?? []) {
        const typeFunc = getModifierTypeFuncById(item.typeId);
        if (!typeFunc) {
          console.warn("[PVP] 未知持有物 typeId，已跳过:", item.typeId);
          continue;
        }
        let type = typeFunc();
        if (item.pregenArgs && "generateType" in type && typeof type.generateType === "function") {
          type = type.generateType([], item.pregenArgs);
        }
        if (!type) {
          continue;
        }
        type.id = item.typeId;
        const modifier = (type as PokemonHeldItemModifierType).newModifier(pokemon);
        if (!modifier) {
          continue;
        }
        modifier.stackCount = Math.min(item.stackCount, modifier.getMaxStackCount());
        globalScene.addEnemyModifier(modifier, true, true);
      }
      if (items?.length) {
        pokemon.calculateStats();
      }
      // 用出手方已经算好的六维盖掉本地重算结果。
      // 敌方重算会吃到另一套修正，速度一反，两边就会打出相反的击倒。
      if (data[i]?.stats?.length === 6) {
        pokemon.stats = [...data[i].stats];
        const maxHp = data[i].maxHp || pokemon.stats[0];
        if (maxHp > 0) {
          pokemon.stats[0] = maxHp;
          pokemon.hp = Math.min(maxHp, data[i].currentHp || maxHp);
        }
      }
    });
  }
}
