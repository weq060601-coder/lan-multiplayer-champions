import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { getLevelTotalExp } from "#data/exp";
import type { SpeciesFormEvolution } from "#balance/pokemon-evolutions";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { speciesEggMoves } from "#balance/egg-moves";
import { allAbilities, allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveCategory } from "#enums/move-category";
import type { MoveId } from "#enums/move-id";
import type { SpeciesId } from "#enums/species-id";
import { BerryType } from "#enums/berry-type";
import { FormChangeItem } from "#enums/form-change-item";
import { Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { SpeciesStatBoosterModifier } from "#modifiers/modifier";
import {
  FormChangeItemModifierType,
  getModifierTypeFuncById,
  SpeciesStatBoosterModifierType,
  type ModifierType,
  type PokemonHeldItemModifierType,
  type SpeciesStatBoosterItem,
} from "#modifiers/modifier-type";
import type { OptionSelectItem } from "#types/ui-types";
import { loadStarterPreferences } from "#utils/data";
import { multiplayerManager } from "../multiplayer/multiplayer-manager";
import { getPvpPartySize } from "../multiplayer/pvp-battle-manager";

/** PVP 队伍统一等级。等级直接线性缩放六项能力（pokemon.ts:1587），所以两边必须一致 */
const PVP_LEVEL = 50;

/**
 * 全队一共能选几个道具。
 *
 * 原来是 10 —— 实测太多：分配菜单要点十几次才走完，而且叠满道具会把对战变成拼装备。
 * 改成 3，逼玩家做取舍，也让组队流程快一截。
 */
const ITEM_BUDGET = 3;

/** 每只宝可梦的招式槽位数 */
const MOVE_SLOTS = 4;

/**
 * PVP 可选的持有物白名单。
 *
 * 静态持有物直接创建；树果、超级石和专属道具通过 pregen 参数创建具体类型。
 * 生成器不能直接 newModifier，必须先 generateType(party, args)。
 */
interface PvpItemChoice {
  typeId: string;
  pregenArgs?: unknown[];
}

const STATIC_PVP_ITEMS: PvpItemChoice[] = [
  "LEFTOVERS",
  "SHELL_BELL",
  "FOCUS_BAND",
  "SCOPE_LENS",
  "WIDE_LENS",
  "MULTI_LENS",
  "QUICK_CLAW",
  "KINGS_ROCK",
  "GRIP_CLAW",
  "REVIVER_SEED",
  "SOUL_DEW",
  "GOLDEN_PUNCH",
].map(typeId => ({ typeId }));

// 具体参数必须随队伍一起同步：这些三个 typeId 本身只是生成器，不代表某个实际道具。
const PVP_BERRY_ITEMS: PvpItemChoice[] = Object.values(BerryType)
  .filter((value): value is BerryType => typeof value === "number")
  .map(berryType => ({ typeId: "BERRY", pregenArgs: [berryType] }));

// 超级石先放进候选池，打开菜单时再按当前队伍过滤，不要把别人的石头也列出来。
const PVP_MEGA_STONES: PvpItemChoice[] = Object.values(FormChangeItem)
  .filter((value): value is FormChangeItem => typeof value === "number" && value > 0 && value < 100)
  .map(formChangeItem => ({ typeId: "FORM_CHANGE_ITEM", pregenArgs: [formChangeItem] }));

const PVP_SPECIES_ITEMS: PvpItemChoice[] = [
  "LIGHT_BALL",
  "THICK_CLUB",
  "METAL_POWDER",
  "QUICK_POWDER",
  "DEEP_SEA_SCALE",
  "DEEP_SEA_TOOTH",
].map(key => ({ typeId: "SPECIES_STAT_BOOSTER", pregenArgs: [key] }));

const PVP_ITEM_POOL: PvpItemChoice[] = [
  ...STATIC_PVP_ITEMS,
  ...PVP_BERRY_ITEMS,
  ...PVP_MEGA_STONES,
  ...PVP_SPECIES_ITEMS,
];

/** 一个可选的进化目标：目标种族 + 从当前种族走到它要依次套用的进化步骤 */
interface EvoChoice {
  speciesId: SpeciesId;
  name: string;
  path: SpeciesFormEvolution[];
}

/**
 * PVP 组队设置：把选好的初始怪拉到统一等级，让玩家自由选进化型，再分配持有物。
 *
 * 必须插在 SelectStarterPhase 之后、PvpPartySyncPhase 之前 ——
 * 队伍要先存在才能改，而且改完才能交换给对手。
 *
 * 为什么不做进 starter-select-ui-handler.ts：那文件 3320 行，
 * 塞二级菜单进去风险太大，还会连带影响单机模式。
 */
export class PvpTeamSetupPhase extends Phase {
  public readonly phaseName = "PvpTeamSetupPhase";

  /** 还剩几个道具额度 */
  private itemsLeft = ITEM_BUDGET;

  start(): void {
    super.start();

    const required = getPvpPartySize(multiplayerManager.roomState?.pvpFormat);
    const party = globalScene.getPlayerParty();
    if (party.length !== required) {
      globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
        globalScene.ui.showText(
          `${required}v${required} 对战需要恰好选择 ${required} 只宝可梦，当前为 ${party.length} 只。`,
          null,
          () => {
            globalScene.ui.clearText();
            multiplayerManager.leaveRoom();
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
      void this.prepareParty().then(() => {
        // 进化、特性和配招由选宝可梦界面决定；组队准备阶段只分配持有物。
        this.startItemAllocation();
      });
    });
  }

  /** 应用选择界面保存的 PVP 进化目标，再统一等级；不再逐只弹配置菜单。 */
  private async prepareParty(): Promise<void> {
    const preferences = loadStarterPreferences();
    for (const pokemon of globalScene.getPlayerParty()) {
      const targetSpeciesId = preferences[pokemon.species.speciesId]?.pvpEvolution;
      if (targetSpeciesId == null || targetSpeciesId === pokemon.species.speciesId) {
        continue;
      }
      const target = this.collectEvoChoices(pokemon).find(choice => choice.speciesId === targetSpeciesId);
      if (target) {
        await this.applyEvoPath(pokemon, target.path);
      }
    }
    this.levelUpParty();
  }

  /**
   * 全队拉到 PVP_LEVEL，保留选宝可梦界面已经配置的招式。
   *
   * ⚠️ exp 必须跟着等级一起对齐（getLevelTotalExp）。
   *    只改 level 不改 exp 的话，第一次结算经验时 levelExp 是负的，会立刻掉级。
   * 这里不重新生成招式，避免覆盖玩家在选宝可梦界面的配招。
   */
  private levelUpParty(): void {
    for (const pokemon of globalScene.getPlayerParty()) {
      if (!pokemon) {
        continue;
      }
      pokemon.level = PVP_LEVEL;
      pokemon.exp = getLevelTotalExp(pokemon.level, pokemon.species.growthRate);
      pokemon.calculateStats();
      pokemon.hp = pokemon.getMaxHp();
    }
    console.log("[PVP] 全队已拉到", PVP_LEVEL, "级，保留已选招式");
  }

  // ------------------------------------------------------------- 进化型选择

  /** 逐只让玩家挑进化型；i 走完队伍就进选招式 */
  private pickEvolutionFor(index: number): void {
    const party = globalScene.getPlayerParty();
    if (index >= party.length) {
      globalScene.ui.clearText();
      // 特性也必须排在进化之后：形态变化可能会改变特性表。
      this.pickAbilityFor(0);
      return;
    }

    const pokemon = party[index];
    const choices = this.collectEvoChoices(pokemon);

    // 没有分支也没有进化（例如路卡利欧这种已经是终点）：直接跳过，不让玩家点一次废菜单
    if (choices.length <= 1) {
      this.pickEvolutionFor(index + 1);
      return;
    }

    const options: OptionSelectItem[] = choices.map(choice => ({
      label: choice.path.length === 0 ? `${choice.name}（当前）` : choice.name,
      handler: () => {
        globalScene.ui.setMode(UiMode.MESSAGE);
        this.applyEvoPath(pokemon, choice.path).then(() => this.pickEvolutionFor(index + 1));
        return true;
      },
    }));

    globalScene.ui.showText(
      `第 ${index + 1} 只：${pokemon.name} —— 选择进化型`,
      null,
      () => {
        globalScene.ui.setMode(UiMode.OPTION_SELECT, {
          options,
          maxOptions: 8,
        });
      },
      null,
      true,
    );
  }

  /** 逐只选择特性；全图鉴房间开放该宝可梦的全部普通/隐藏特性。 */
  private pickAbilityFor(index: number): void {
    const party = globalScene.getPlayerParty();
    if (index >= party.length) {
      globalScene.ui.clearText();
      this.pickMovesFor(0);
      return;
    }

    const pokemon = party[index];
    const choices = this.collectAbilityChoices(pokemon);
    if (choices.length <= 1) {
      this.pickAbilityFor(index + 1);
      return;
    }

    const options: OptionSelectItem[] = choices.map(abilityIndex => ({
      label: allAbilities[pokemon.species.getAbility(abilityIndex)]?.name ?? `特性 ${abilityIndex + 1}`,
      handler: () => {
        globalScene.ui.setMode(UiMode.MESSAGE);
        pokemon.abilityIndex = abilityIndex;
        pokemon.calculateStats();
        this.pickAbilityFor(index + 1);
        return true;
      },
    }));

    globalScene.ui.showText(
      `第 ${index + 1} 只：${pokemon.name} —— 选择特性`,
      null,
      () => {
        globalScene.ui.setMode(UiMode.OPTION_SELECT, {
          options,
          maxOptions: 8,
        });
      },
      null,
      true,
    );
  }

  private collectAbilityChoices(pokemon: PlayerPokemon): number[] {
    const species = pokemon.getSpeciesForm();
    const seen = new Set<number>();
    return [0, 1, 2].slice(0, species.getAbilityCount()).filter(index => {
      const ability = species.getAbility(index);
      if (seen.has(ability) || !allAbilities[ability] || ability === AbilityId.NONE) {
        return false;
      }
      seen.add(ability);
      return true;
    });
  }

  /**
   * 把这只宝可梦这条进化链上「所有能到的种族」摊平成一个列表。
   *
   * 不能只问「第几阶段」——进化链是**分叉**的：伊布 8 个分支、刺尾虫 4 条路。
   * 所以做法是从当前种族广度遍历整条链，每个可达种族记下「要依次套用哪几步进化」。
   *
   * 这里**故意忽略进化条件**（等级/道具/亲密度/时间）：这是自由组队，不是养成。
   */
  private collectEvoChoices(pokemon: PlayerPokemon): EvoChoice[] {
    const out: EvoChoice[] = [
      { speciesId: pokemon.species.speciesId, name: pokemon.species.name, path: [] },
    ];
    const seen = new Set<SpeciesId>([pokemon.species.speciesId]);
    const queue: EvoChoice[] = [out[0]];

    while (queue.length) {
      const current = queue.shift()!;
      for (const evo of speciesDataRegistry.getEvolutions(current.speciesId)) {
        if (seen.has(evo.speciesId)) {
          continue;
        }
        seen.add(evo.speciesId);
        const next: EvoChoice = {
          speciesId: evo.speciesId,
          name: speciesDataRegistry.getSpecies(evo.speciesId).name,
          path: [...current.path, evo],
        };
        out.push(next);
        queue.push(next);
      }
    }

    return out;
  }

  /**
   * 依次套用进化步骤。
   *
   * 复用 pokemon.evolve() 而不是自己换 species：它顺带处理了
   * 三特性种族退化成两特性时的 abilityIndex 修正（伊布系）、形态 key 解析、
   * 以及忍者蛾那种一变二的特例。自己手写这些迟早出错。
   *
   * evolve() 内部会 loadAssets() + calculateStats()，所以贴图和数值都会跟着更新。
   * 它也会碰存档（setPokemonCaught），但传的是 incrementCount=false，
   * 对没抓过的种族直接 early return，不会弹「已加入初始宝可梦」的提示音。
   */
  private async applyEvoPath(pokemon: PlayerPokemon, path: SpeciesFormEvolution[]): Promise<void> {
    // evolve() 会按进化前后的特性数量重映射 abilityIndex，也会改招式。
    // 选人界面已经定好的招式和特性下标要在进化之后写回去。
    const wantedAbility = pokemon.abilityIndex;
    const savedMoves = (pokemon.moveset ?? []).map(move => move?.moveId ?? null);
    for (const evo of path) {
      const preEvolution = pokemon.getSpeciesForm();
      await pokemon.evolve(evo, preEvolution);
    }
    if (!path.length) {
      return;
    }
    const species = pokemon.getSpeciesForm();
    let abilityIndex = wantedAbility ?? 0;
    if (
      abilityIndex < 0
      || abilityIndex >= species.getAbilityCount()
      || species.getAbility(abilityIndex) === AbilityId.NONE
    ) {
      abilityIndex = 0;
    }
    pokemon.abilityIndex = abilityIndex;
    pokemon.calculateStats();
    if (savedMoves.some(moveId => !!moveId)) {
      savedMoves.forEach((moveId, slot) => {
        if (moveId) {
          pokemon.setMove(slot, moveId);
        }
      });
    } else {
      pokemon.generateAndPopulateMoveset();
    }
    pokemon.hp = pokemon.getMaxHp();
    console.log("[PVP]", pokemon.name, "已进化到", pokemon.species.name);
  }

  // --------------------------------------------------------------- 招式选择

  /**
   * 逐只让玩家改招式；i 走完队伍就进道具分配。
   *
   * **交互设计（为什么是「改槽位」而不是「从零挑 4 个」）**：
   * 进来时 4 个槽已经被 `generateAndPopulateMoveset()` 填好了（50 级的随机升级招式）。
   * 所以这里做成「列出 4 个槽 + 下一只」：
   *   - 对现成配招满意 → 点一下「下一只」就走，6 只最少 6 下；
   *   - 只想换一个招 → 点那个槽换掉，不用把 4 个重挑一遍。
   * 要是做成「从零挑 4 个」，6 只 × 4 槽 = 24 次强制选择，还都是从 20 多项的长列表里翻，
   * 手机上没人愿意点完。
   */
  private pickMovesFor(index: number): void {
    const party = globalScene.getPlayerParty();
    if (index >= party.length) {
      globalScene.ui.clearText();
      this.startItemAllocation();
      return;
    }

    const pokemon = party[index];
    if (!pokemon) {
      this.pickMovesFor(index + 1);
      return;
    }

    const options: OptionSelectItem[] = [];
    for (let slot = 0; slot < MOVE_SLOTS; slot++) {
      const current = pokemon.moveset[slot];
      const label = current ? this.describeMove(current.moveId) : "（空槽）";
      options.push({
        label: `${slot + 1}. ${label}`,
        handler: () => {
          globalScene.ui.setMode(UiMode.MESSAGE);
          this.showMovePool(index, slot);
          return true;
        },
      });
    }

    options.push({
      label: index + 1 >= party.length ? "完成配招，去分配道具" : "下一只",
      handler: () => {
        globalScene.ui.setMode(UiMode.MESSAGE);
        this.pickMovesFor(index + 1);
        return true;
      },
    });

    globalScene.ui.showText(
      `第 ${index + 1} 只：${pokemon.name} —— 选招式（点槽位可换）`,
      null,
      () => {
        globalScene.ui.setMode(UiMode.OPTION_SELECT, { options, maxOptions: 8 });
      },
      null,
      true,
    );
  }

  /** 第二层菜单：这个槽位换成哪个招式 */
  private showMovePool(index: number, slot: number): void {
    const pokemon = globalScene.getPlayerParty()[index];
    const pool = this.collectMoveChoices(pokemon);

    const options: OptionSelectItem[] = pool.map(moveId => ({
      label: this.describeMove(moveId),
      handler: () => {
        globalScene.ui.setMode(UiMode.MESSAGE);
        // 换招式用 setMove()：它内部 new PokemonMove(moveId)，ppUsed 归零、maxPp 按招式表取。
        pokemon.setMove(slot, moveId);
        this.pickMovesFor(index);
        return true;
      },
    }));

    options.push({
      label: "返回（不改这一槽）",
      handler: () => {
        globalScene.ui.setMode(UiMode.MESSAGE);
        this.pickMovesFor(index);
        return true;
      },
    });

    globalScene.ui.showText(
      `${pokemon.name} 第 ${slot + 1} 槽换成？`,
      null,
      () => {
        globalScene.ui.setMode(UiMode.OPTION_SELECT, { options, maxOptions: 8 });
      },
      null,
      true,
    );
  }

  /**
   * 这只宝可梦能选的全部招式。
   *
   * **为什么不直接用上游的 `getLearnableLevelMoves()`**：它做了两件不合这里的事 ——
   * ① 把**已经学会**的招式过滤掉了（那样换槽时看不到「换回原来那个」）；
   * ② 蛋招式要求 `metBiome === -1` 且非 Fresh Start，还得看存档里的解锁标志位。
   * PvP 是自由组队（进化都已经无视等级/道具条件了），所以这里直接读 `speciesEggMoves`
   * 把 4 个蛋招式全给，不看解锁 —— 跟「自由选进化型」是同一套逻辑。
   *
   * 不含 TM：TM 池有几百个，塞进 OPTION_SELECT 手机上翻不完。升级招式 + 蛋招式
   * 已经覆盖了绝大多数竞技配招（蛋招式往往就是那几个关键技）。
   */
  private collectMoveChoices(pokemon: PlayerPokemon): MoveId[] {
    const seen = new Set<MoveId>();
    const out: MoveId[] = [];

    const push = (id: MoveId): void => {
      // 未实装的招式必须挡掉：选了等于这一槽废了（`isUnimplemented` 的招式用不出来）
      if (seen.has(id) || !allMoves[id] || allMoves[id].isUnimplemented) {
        return;
      }
      seen.add(id);
      out.push(id);
    };

    // 升级招式：startingLevel 1 -> 取「50 级前能学的全部」，不是「刚好这一级学的」
    // 不按当前等级截断：进化招式是 0 级，回忆招式是 -1，后期招式也要能选。
    for (const [, moveId] of pokemon.getLevelMoves({
      startingLevel: 1,
      includeEvolutionMoves: true,
      includePrevolutionMoves: true,
      includeRelearnerMoves: true,
    })) {
      push(moveId);
    }

    // 蛋招式：按根种族查表，无视解锁标志。
    // ⚠️ `speciesEggMoves` 是**部分键**的对象字面量（只列了有蛋招式的种族），
    //    拿任意 SpeciesId 直接索引过不了类型检查，必须先 `in` 守卫 —— 上游也是这么做的。
    const rootId = pokemon.getSpeciesForm(true).getRootSpeciesId(true);
    if (rootId in speciesEggMoves) {
      for (const eggMove of speciesEggMoves[rootId as keyof typeof speciesEggMoves]) {
        push(eggMove);
      }
    }

    // 攻击招式按威力从高到低排前面，变化招式垫后 —— 竞技配招最常找的就是高威力那几个，
    // 而列表有 20 多项，手机上翻到底很累。
    return out.sort((a, b) => {
      const pa = allMoves[a].power > 0 ? allMoves[a].power : -1;
      const pb = allMoves[b].power > 0 ? allMoves[b].power : -1;
      return pb - pa;
    });
  }

  /** 招式的可读标签：名字 + 威力（变化招式标「变化」） */
  private describeMove(moveId: MoveId): string {
    const move = allMoves[moveId];
    if (!move) {
      return String(moveId);
    }
    if (move.category === MoveCategory.STATUS) {
      return `${move.name}（变化）`;
    }
    // 蓄力/变威力招式（踢倒、电磁炮之类）power 是 -1 或 0，别显示成「威力 -1」
    return move.power > 0 ? `${move.name}（威力 ${move.power}）` : `${move.name}（威力不定）`;
  }

  // --------------------------------------------------------------- 道具分配

  private startItemAllocation(): void {
    if (this.itemsLeft <= 0) {
      this.finish();
      return;
    }
    this.showItemMenu();
  }

  /**
   * 专属道具只给对得上的宝可梦。
   * 超级石走游戏自己的形态变化判定：没有能超级化的宝可梦就不出石头，有的话只出这只对应的石头。
   * 电气球、粗骨棒这类也一样，队伍里没有对应种族就不出现。
   */
  private isExclusiveItem(choice: PvpItemChoice): boolean {
    return choice.typeId === "FORM_CHANGE_ITEM" || choice.typeId === "SPECIES_STAT_BOOSTER";
  }

  private formChangeItemFits(pokemon: PlayerPokemon, item: FormChangeItem): boolean {
    const filter = new FormChangeItemModifierType(item).selectFilter;
    return filter != null && filter(pokemon) == null;
  }

  private speciesItemFits(pokemon: PlayerPokemon, key: SpeciesStatBoosterItem): boolean {
    const modifier = new SpeciesStatBoosterModifierType(key).newModifier(pokemon);
    if (!(modifier instanceof SpeciesStatBoosterModifier)) {
      return false;
    }
    const speciesIds = [pokemon.getSpeciesForm(true).speciesId];
    if (pokemon.isFusion()) {
      speciesIds.push(pokemon.getFusionSpeciesForm(true).speciesId);
    }
    const stats = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD];
    return speciesIds.some(speciesId => stats.some(stat => modifier.contains(speciesId, stat)));
  }

  private pokemonCanUseItem(pokemon: PlayerPokemon, choice: PvpItemChoice): boolean {
    if (choice.typeId === "FORM_CHANGE_ITEM") {
      return this.formChangeItemFits(pokemon, choice.pregenArgs?.[0] as FormChangeItem);
    }
    if (choice.typeId === "SPECIES_STAT_BOOSTER") {
      return this.speciesItemFits(pokemon, choice.pregenArgs?.[0] as SpeciesStatBoosterItem);
    }
    return true;
  }

  private partyCanUseItem(party: readonly PlayerPokemon[], choice: PvpItemChoice): boolean {
    if (!this.isExclusiveItem(choice)) {
      return true;
    }
    return party.some(pokemon => this.pokemonCanUseItem(pokemon, choice));
  }

  private itemMenuRank(choice: PvpItemChoice): number {
    if (choice.typeId === "FORM_CHANGE_ITEM") {
      return 0;
    }
    if (choice.typeId === "SPECIES_STAT_BOOSTER") {
      return 1;
    }
    if (choice.typeId === "BERRY") {
      return 3;
    }
    return 2;
  }

  /** 第一层菜单：挑一个道具（或者结束分配） */
  private showItemMenu(): void {
    const party = globalScene.getPlayerParty();
    const options: OptionSelectItem[] = PVP_ITEM_POOL.filter(choice => this.partyCanUseItem(party, choice))
      .sort((a, b) => this.itemMenuRank(a) - this.itemMenuRank(b))
      .map(choice => {
      const type = this.createItemType(choice);
      const name = type?.name ?? choice.typeId;
      return {
        label: name,
        handler: () => {
          globalScene.ui.setMode(UiMode.MESSAGE);
          this.showTargetMenu(choice, name);
          return true;
        },
      } satisfies OptionSelectItem as OptionSelectItem;
    });

    options.push({
      label: "结束分配",
      handler: () => {
        globalScene.ui.setMode(UiMode.MESSAGE);
        this.finish();
        return true;
      },
    });

    globalScene.ui.showText(
      `选择持有物（还剩 ${this.itemsLeft} 个额度）`,
      null,
      () => {
        globalScene.ui.setMode(UiMode.OPTION_SELECT, {
          options,
          maxOptions: 8,
        });
      },
      null,
      true,
    );
  }

  /** 第二层菜单：这个道具给谁 */
  private showTargetMenu(choice: PvpItemChoice, itemName: string): void {
    const party = globalScene.getPlayerParty();

    const options: OptionSelectItem[] = party.flatMap((pokemon, i) => {
      if (!this.pokemonCanUseItem(pokemon, choice)) {
        return [];
      }
      const carried = pokemon.getHeldItems().reduce((sum, m) => sum + m.stackCount, 0);
      return {
        label: `${pokemon.name}（已持 ${carried}）`,
        handler: () => {
          globalScene.ui.setMode(UiMode.MESSAGE);
          this.giveItem(party[i], choice);
          this.startItemAllocation();
          return true;
        },
      } satisfies OptionSelectItem as OptionSelectItem;
    });

    options.push({
      label: "返回",
      handler: () => {
        globalScene.ui.setMode(UiMode.MESSAGE);
        this.showItemMenu();
        return true;
      },
    });

    globalScene.ui.showText(
      `${itemName} 给谁？`,
      null,
      () => {
        globalScene.ui.setMode(UiMode.OPTION_SELECT, {
          options,
          maxOptions: 8,
        });
      },
      null,
      true,
    );
  }

  /** 真正把道具挂上去。走 addModifier（本机队伍），敌方那侧由 PartySerializer 重建 */
  private createItemType(choice: PvpItemChoice): ModifierType | null {
    const typeFunc = getModifierTypeFuncById(choice.typeId);
    if (!typeFunc) {
      return null;
    }
    const type = typeFunc();
    if (choice.pregenArgs && "generateType" in type && typeof type.generateType === "function") {
      return type.generateType(globalScene.getPlayerParty(), choice.pregenArgs);
    }
    return type;
  }

  private giveItem(pokemon: PlayerPokemon, choice: PvpItemChoice): void {
    const type = this.createItemType(choice);
    if (!type) {
      console.warn("[PVP] 未知持有物 typeId:", choice.typeId);
      return;
    }
    type.id = choice.typeId;
    const modifier = (type as PokemonHeldItemModifierType).newModifier(pokemon);
    if (!modifier) {
      return;
    }

    // 已经堆满了就别浪费额度
    const existing = pokemon.getHeldItems().find(m => {
      if (m.type.id !== choice.typeId) {
        return false;
      }
      if (!choice.pregenArgs) {
        return true;
      }
      const getPregenArgs = (m.type as ModifierType & { getPregenArgs?: () => unknown[] }).getPregenArgs;
      return JSON.stringify(getPregenArgs?.()) === JSON.stringify(choice.pregenArgs);
    });
    if (existing && existing.stackCount >= existing.getMaxStackCount()) {
      globalScene.ui.showText(`${pokemon.name} 的这个道具已经堆满了。`, null, () => {}, 1200, true);
      return;
    }

    globalScene.addModifier(modifier, true, false, false, true);
    pokemon.calculateStats();
    this.itemsLeft--;
  }

  private finish(): void {
    globalScene.ui.clearText();
    console.log("[PVP] 组队设置完成，剩余道具额度", this.itemsLeft);
    this.end();
  }
}
