import { VALUE_REDUCTION_MAX } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { settings } from "#app/global-settings-manager";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { speciesEggMoves } from "#balance/egg-moves";
import {
  getPassiveCandyCount,
  getSameSpeciesEggCandyCounts,
  getStarterValueFriendshipCap,
  getValueReductionCandyCounts,
} from "#balance/starters";
import { allAbilities, allMoves } from "#data/data-lists";
import { AbilityAttr } from "#enums/ability-attr";
import { CandyUpgradeDisplayMode } from "#enums/candy-upgrade-display-mode";
import { CandyUpgradeNotificationMode } from "#enums/candy-upgrade-notification-mode";
import { ChallengeType } from "#enums/challenge-type";
import { Challenges } from "#enums/challenges";
import { DexAttr } from "#enums/dex-attr";
import { GameModes } from "#enums/game-modes";
import type { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { Passive } from "#enums/passive";
import { SpeciesFormKey } from "#enums/species-form-key";
import type { SpeciesId } from "#enums/species-id";
import { RibbonData } from "#system/ribbon-data";
import type { DexEntry } from "#types/dex-data";
import type { DexAttrProps, StarterDataEntry, StarterPreferences } from "#types/save-data";
import type { DefinedSpeciesDetails, SpeciesDetails } from "#types/starter-select-types";
import type { StarterSpeciesId } from "#types/starter-species-id";
import { SortCriteria, type SortDirection } from "#ui/dropdown";
import { applyChallenges, checkStarterValidForChallenge } from "#utils/challenge-utils";
import { deepCopy } from "#utils/data";
import { ValueHolder } from "#utils/value-holder";
import i18next from "i18next";

/**
 * Determines if a passive upgrade is available for the given species ID
 * @param speciesId - The ID of the species to check the passive of
 * @param gameData - (Default `globalScene.gameData`) Game data to use
 * @returns Whether the user has enough candies and a passive has not been unlocked already
 */
export function isPassiveAvailable(speciesId: number, gameData = globalScene.gameData): boolean {
  // Get this species ID's starter data
  const starterId = speciesDataRegistry.getStarter(speciesId);
  const starterData = gameData.starterData[starterId];

  return (
    starterData.candyCount >= getPassiveCandyCount(speciesDataRegistry.getStarterCost(starterId))
    && !(starterData.passiveAttr & Passive.UNLOCKED)
  );
}

/**
 * Determines if a value reduction upgrade is available for the given species ID
 * @param speciesId - The ID of the species to check the value reduction of
 * @param gameData - (Default `globalScene.gameData`) Game data to use
 * @returns Whether the user has enough candies and all value reductions have not been unlocked already
 */
export function isValueReductionAvailable(speciesId: number, gameData = globalScene.gameData): boolean {
  const starterId = speciesDataRegistry.getStarter(speciesId);
  const starterData = gameData.starterData[starterId];

  return (
    starterData.candyCount
      >= getValueReductionCandyCounts(speciesDataRegistry.getStarterCost(starterId))[starterData.valueReduction]
    && starterData.valueReduction < VALUE_REDUCTION_MAX
  );
}

/**
 * Determines if an egg for the same starter can be bought for the given species ID
 * @param speciesId - The ID of the species to check the value reduction of
 * @param gameData - (Default `globalScene.gameData`) Game data to use
 * @returns Whether the user has enough candies
 */
export function isSameSpeciesEggAvailable(speciesId: number, gameData = globalScene.gameData): boolean {
  const starterId = speciesDataRegistry.getStarter(speciesId);
  return (
    gameData.starterData[starterId].candyCount
    >= getSameSpeciesEggCandyCounts(speciesDataRegistry.getStarterCost(starterId))
  );
}

/**
 * Determines if a starter is valid for challenges.
 * @param starterId - The ID of the starter species to check
 * @returns whether the starter is valid for challenges
 */
export function isStarterValidForChallenge(starterId: StarterSpeciesId): boolean {
  const species = speciesDataRegistry.getSpecies(starterId);

  let isStarterValid = false;
  if (species.forms?.length > 0) {
    for (let i = 0; i < species.forms.length; i++) {
      // Here we are making a fake form index dex props for challenges.
      // Since some pokemon rely on forms to be valid (i.e. blaze tauros for fire challenges),
      // we make a fake form and dex props to use in the challenge
      if (!species.forms[i].isStarterSelectable) {
        continue;
      }
      const tempFormProps = BigInt(Math.pow(2, i)) * DexAttr.DEFAULT_FORM;
      const isValidForChallenge = checkStarterValidForChallenge(
        starterId,
        globalScene.gameData.getDexAttrProps(tempFormProps),
        true,
      );
      isStarterValid ||= isValidForChallenge;
    }
  } else {
    const isValidForChallenge = checkStarterValidForChallenge(
      starterId,
      globalScene.gameData.getSpeciesDefaultDexAttrProps(species.speciesId),
      true,
    );
    isStarterValid = isValidForChallenge;
  }

  return isStarterValid;
}

/** @returns Whether upgrade notifications are enabled and set to display as an icon */
export function isUpgradeIconEnabled(): boolean {
  return (
    settings.display.candyUpgradeNotificationMode !== CandyUpgradeNotificationMode.OFF
    && settings.display.candyUpgradeDisplayMode === CandyUpgradeDisplayMode.ICON
  );
}

/** @returns Whether upgrade notifications are enabled and set to display as an animation */
export function isUpgradeAnimationEnabled(): boolean {
  return (
    settings.display.candyUpgradeNotificationMode !== CandyUpgradeNotificationMode.OFF
    && settings.display.candyUpgradeDisplayMode === CandyUpgradeDisplayMode.ANIMATION
  );
}

interface StarterSelectLanguageSetting {
  starterInfoTextSize: string;
  instructionTextSize: string;
  starterInfoXPos?: number;
  starterInfoYOffset?: number;
}

const languageSettings: { [key: string]: StarterSelectLanguageSetting } = {
  en: {
    starterInfoTextSize: "56px",
    instructionTextSize: "28px",
  },
  de: {
    starterInfoTextSize: "54px",
    instructionTextSize: "25px",
    starterInfoXPos: 35,
  },
  "es-ES": {
    starterInfoTextSize: "52px",
    instructionTextSize: "28px",
    starterInfoYOffset: 0.5,
    starterInfoXPos: 39,
  },
  "es-419": {
    starterInfoTextSize: "50px",
    instructionTextSize: "28px",
    starterInfoYOffset: 0.5,
    starterInfoXPos: 37,
  },
  fr: {
    starterInfoTextSize: "54px",
    instructionTextSize: "28px",
  },
  it: {
    starterInfoTextSize: "56px",
    instructionTextSize: "28px",
  },
  "pt-BR": {
    starterInfoTextSize: "54px",
    instructionTextSize: "28px",
    starterInfoXPos: 37,
  },
  zh: {
    starterInfoTextSize: "56px",
    instructionTextSize: "26px",
    starterInfoXPos: 26,
  },
  ko: {
    starterInfoTextSize: "60px",
    instructionTextSize: "28px",
    starterInfoYOffset: -0.5,
    starterInfoXPos: 30,
  },
  ja: {
    starterInfoTextSize: "48px",
    instructionTextSize: "32px",
    starterInfoYOffset: 1,
    starterInfoXPos: 32,
  },
  ca: {
    starterInfoTextSize: "48px",
    instructionTextSize: "28px",
    starterInfoYOffset: 0.5,
    starterInfoXPos: 29,
  },
  eu: {
    starterInfoTextSize: "48px",
    instructionTextSize: "28px",
    starterInfoYOffset: 0.5,
    starterInfoXPos: 29,
  },
  da: {
    starterInfoTextSize: "56px",
    instructionTextSize: "28px",
  },
  th: {
    starterInfoTextSize: "50px",
    instructionTextSize: "30px",
    starterInfoYOffset: 0.5,
    starterInfoXPos: 40,
  },
  tr: {
    starterInfoTextSize: "56px",
    instructionTextSize: "28px",
    starterInfoXPos: 34,
  },
  pl: {
    starterInfoTextSize: "48px",
    instructionTextSize: "28px",
    starterInfoYOffset: 0.5,
  },
  ru: {
    starterInfoTextSize: "46px",
    instructionTextSize: "28px",
    starterInfoYOffset: 0.5,
    starterInfoXPos: 26,
  },
  uk: {
    starterInfoTextSize: "46px",
    instructionTextSize: "28px",
    starterInfoYOffset: 0.5,
    starterInfoXPos: 26,
  },
  id: {
    starterInfoTextSize: "48px",
    instructionTextSize: "28px",
    starterInfoYOffset: 0.5,
    starterInfoXPos: 37,
  },
  hi: {
    starterInfoTextSize: "56px",
    instructionTextSize: "28px",
  },
  vi: {
    starterInfoTextSize: "50px",
    instructionTextSize: "28px",
    starterInfoYOffset: 0.5,
    starterInfoXPos: 34,
  },
  tl: {
    starterInfoTextSize: "56px",
    instructionTextSize: "28px",
  },
  sv: {
    starterInfoTextSize: "56px",
    instructionTextSize: "28px",
  },
};

export function getStarterSelectTextSettings(): StarterSelectLanguageSetting {
  const currentLanguage = i18next.resolvedLanguage ?? "en";
  const textSettings = languageSettings[currentLanguage] ?? languageSettings["en"];
  return textSettings;
}

/**
 * Return a copy of the dex data and starter data for a given species,
 * modifying it by applying any challenges that restrict which options should be available.
 *
 * @param speciesId - The species id to get data for
 * @param applyChallenge - (Default `true`) Whether the current challenges should be taken into account
 * @returns A copy of the starter's {@linkcode DexEntry} and {@linkcode StarterDataEntry}
 */
export function getStarterData(
  starterId: StarterSpeciesId,
  applyChallenge = true,
): { dexEntry: DexEntry; starterDataEntry: StarterDataEntry } {
  const originalDexEntry = globalScene.gameData.dexData[starterId];
  const dexEntry: DexEntry = { ...originalDexEntry };
  dexEntry.ivs = [...originalDexEntry.ivs];
  dexEntry.ribbons = new RibbonData(originalDexEntry.ribbons.getRibbons());
  const starterDataEntry: StarterDataEntry = deepCopy(globalScene.gameData.starterData[starterId]);

  if (applyChallenge) {
    applyChallenges(ChallengeType.STARTER_SELECT_MODIFY, starterId, dexEntry, starterDataEntry);
  }

  return { dexEntry, starterDataEntry };
}

/**
 * Get the current friendship and friendship cap for a given species.
 * @param speciesId - The id of the species to get friendship for
 * @returns An object containing the current friendship and friendship cap for the species
 */
export function getFriendship(speciesId: StarterSpeciesId): { currentFriendship: number; friendshipCap: number } {
  const currentFriendship = globalScene.gameData.starterData[speciesId].friendship;

  const friendshipCap = getStarterValueFriendshipCap(speciesDataRegistry.getStarterCost(speciesId));

  return { currentFriendship, friendshipCap };
}

/**
 * Creates a temporary dex attr props that will be used to check whether a pokemon is valid for a challenge
 * and to display the correct shiny, variant, and form based on the starter preferences
 *
 * @param speciesId - The id of the species to get props for
 * @param starterPreferences - (Optional) The {@linkcode StarterPreferences} of the starter
 * @returns the dex props as a `bigint`
 */
export function getDexAttrFromPreferences(
  speciesId: StarterSpeciesId,
  starterPreferences: StarterPreferences = {},
): bigint {
  let props = 0n;
  const { dexEntry } = getStarterData(speciesId);
  const caughtAttr = dexEntry.caughtAttr;

  /*
   * This checks the gender of the pokemon by checking:
   * - That the starter preferences for the species exist, and if so, if it's female.
   *   If so, it'll add `DexAttr.FEMALE` to our temp props
   * - If the `caughtAttr` for the pokemon is female and NOT male - this means that the ONLY gender we've gotten is female,
   *   and we need to add `DexAttr.FEMALE` to our temp props
   *
   * If neither of these pass, we add `DexAttr.MALE` to our temp props
   */
  if (starterPreferences.female || ((caughtAttr & DexAttr.FEMALE) > 0n && (caughtAttr & DexAttr.MALE) === 0n)) {
    props += DexAttr.FEMALE;
  } else {
    props += DexAttr.MALE;
  }

  // This part is very similar to above, but instead of for gender, it checks for shiny within starter preferences.
  // If they're not there, it enables shiny state by default if any shiny was caught
  if (starterPreferences.shiny || ((caughtAttr & DexAttr.SHINY) > 0n && starterPreferences?.shiny !== false)) {
    props += DexAttr.SHINY;
    if (starterPreferences.variant !== undefined) {
      props += BigInt(Math.pow(2, starterPreferences.variant)) * DexAttr.DEFAULT_VARIANT;
    } else if ((caughtAttr & DexAttr.VARIANT_3) > 0) {
      props += DexAttr.VARIANT_3;
    } else if ((caughtAttr & DexAttr.VARIANT_2) > 0) {
      props += DexAttr.VARIANT_2;
    } else {
      props += DexAttr.DEFAULT_VARIANT;
    }
  } else {
    props += DexAttr.NON_SHINY;
    // we add the default variant here because non shiny versions are listed as default variant
    props += DexAttr.DEFAULT_VARIANT;
  }

  if (starterPreferences.formIndex) {
    props += BigInt(Math.pow(2, starterPreferences.formIndex)) * DexAttr.DEFAULT_FORM;
  } else {
    // Get the first unlocked form
    props += globalScene.gameData.getFormAttr(globalScene.gameData.getFormIndex(caughtAttr));
  }

  return props;
}

/**
 * Convert starter preferences to dex props, which are used as an input by various functions.
 *
 * If any preferences are undefined, the default value for the species is given, based on its caught data.
 * @param starterId - The {@linkcode StarterSpeciesId | starter} to get dex props for
 * @param starterPreferences - (Optional) The {@linkcode StarterPreferences} for the species
 * @returns The {@linkcode DexAttrProps} for the starter
 */
export function getStarterDexAttrPropsFromPreferences(
  starterId: StarterSpeciesId,
  starterPreferences: StarterPreferences = {},
): DexAttrProps {
  // Shiny is always default, except in fresh start
  const isShinyDefault = !globalScene.gameMode.hasChallenge(Challenges.FRESH_START);
  const defaults = globalScene.gameData.getSpeciesDefaultDexAttrProps(starterId, isShinyDefault);

  return {
    shiny: starterPreferences.shiny ?? defaults.shiny,
    variant: starterPreferences.variant ?? defaults.variant,
    female: starterPreferences.female ?? defaults.female,
    formIndex: starterPreferences.formIndex ?? defaults.formIndex,
  };
}

function getStarterDefaultAbilityIndex(starterId: StarterSpeciesId): number {
  const { starterDataEntry: starterData } = getStarterData(starterId);
  const abilityAttr = starterData.abilityAttr;
  const species = speciesDataRegistry.getSpecies(starterId);

  if (abilityAttr & AbilityAttr.ABILITY_1) {
    return 0;
  }
  if (!species.ability2 || abilityAttr & AbilityAttr.ABILITY_2) {
    return 1;
  }
  return 2;
}

function getStarterDefaultNature(starterId: StarterSpeciesId): Nature {
  const { dexEntry } = getStarterData(starterId);
  for (let n = 0; n < 25; n++) {
    if (dexEntry.natureAttr & (1 << (n + 1))) {
      return n as Nature;
    }
  }
  return Nature.HARDY;
}

/**
 * Convert starter preferences to {@linkcode SpeciesDetails} format.
 *
 * If any preferences are undefined, the default value for the species is given, based on its caught data.
 * @param starterId - The {@linkcode StarterSpeciesId | starter} to get dex props for
 * @param starterPreferences - (Optional) The {@linkcode StarterPreferences} for the species
 * @returns The data in `SpeciesDetails` format
 */
export function getStarterDetailsFromPreferences(
  starterId: StarterSpeciesId,
  starterPreferences: StarterPreferences = {},
) {
  const { female, formIndex, shiny, variant } = getStarterDexAttrPropsFromPreferences(starterId, starterPreferences);
  const species = speciesDataRegistry.getSpecies(starterId);
  const abilityIndex = starterPreferences.abilityIndex ?? getStarterDefaultAbilityIndex(starterId);
  const natureIndex = starterPreferences.nature ?? getStarterDefaultNature(starterId);
  const teraType = starterPreferences.tera ?? species.type1;

  return { shiny, formIndex, female, variant, abilityIndex, natureIndex, teraType } satisfies DefinedSpeciesDetails;
}

/** @returns The limit on starter points available for the current run, taking challenges into account */
export function getRunValueLimit(): number {
  const valueLimit = new ValueHolder(0);
  switch (globalScene.gameMode.modeId) {
    case GameModes.ENDLESS:
    case GameModes.SPLICED_ENDLESS:
      valueLimit.value = 15;
      break;
    default:
      valueLimit.value = 10;
  }

  applyChallenges(ChallengeType.STARTER_POINTS, valueLimit);

  return valueLimit.value;
}

/**
 * Calculate the total value of a given party.
 * @param party - An array of species IDs representing the player's starter party
 * @returns The total value of the party
 */
export function getPartyValue(party: StarterSpeciesId[]): number {
  return party.reduce(
    (total: number, starterId: StarterSpeciesId) => total + globalScene.gameData.getSpeciesStarterValue(starterId),
    0,
  );
}

/**
 * Sort an array of {@linkcode StarterSpeciesId} based on a given criteria and direction.
 * @param speciesIds - An array of species IDs to be sorted
 * @param sort - The criteria by which the species hould be sorted
 * @param dir - The direction in which the species should be sorted
 */
export function sortStarterSpecies(speciesIds: StarterSpeciesId[], sort: SortCriteria, dir: SortDirection): void {
  speciesIds.sort((a, b) => {
    const { gameData } = globalScene;
    const { dexData, starterData } = gameData;

    switch (sort) {
      case SortCriteria.NUMBER:
        return (a - b) * -dir;
      case SortCriteria.COST:
        return (gameData.getSpeciesStarterValue(a) - gameData.getSpeciesStarterValue(b)) * -dir;
      case SortCriteria.CANDY: {
        const candyCountA = starterData[a].candyCount;
        const candyCountB = starterData[b].candyCount;
        return (candyCountA - candyCountB) * -dir;
      }
      case SortCriteria.IV: {
        const ivsA = dexData[a].ivs;
        const avgIVsA = ivsA.reduce((total, cur) => total + cur, 0) / ivsA.length;

        const ivsB = dexData[b].ivs;
        const avgIVsB = ivsB.reduce((total, cur) => total + cur, 0) / ivsB.length;

        return (avgIVsA - avgIVsB) * -dir;
      }
      case SortCriteria.NAME:
        return speciesDataRegistry.getSpecies(a).name.localeCompare(speciesDataRegistry.getSpecies(b).name) * -dir;
      case SortCriteria.CAUGHT:
        return (dexData[a].caughtCount - dexData[b].caughtCount) * -dir;
      case SortCriteria.HATCHED:
        return (dexData[a].hatchedCount - dexData[b].hatchedCount) * -dir;
      default: // to make Biome happy
        sort satisfies never;
        return 0;
    }
  });
}

/**
 * Get the moves that a starter can have.
 * @param starterId - The id of the starter species to get moves for
 * @param formIndex - The form index of the starter to get moves for
 * @returns An array of move IDs
 */
export function getStarterMoves(starterId: StarterSpeciesId, formIndex: number): MoveId[] {
  const starterMoves: MoveId[] = [];
  const { starterDataEntry } = getStarterData(starterId);

  const levelMoves = speciesDataRegistry.getLevelMoves(starterId, formIndex);
  applyChallenges(ChallengeType.LEVEL_UP_MOVESET, speciesDataRegistry.getSpecies(starterId), levelMoves);
  for (const [level, moveId] of levelMoves) {
    if (level > 0 && level <= 5) {
      starterMoves.push(moveId);
    }
  }

  if (Object.hasOwn(speciesEggMoves, starterId)) {
    for (let em = 0; em < 4; em++) {
      if (starterDataEntry.eggMoves & (1 << em)) {
        starterMoves.push(speciesEggMoves[starterId][em]);
      }
    }
  }

  return starterMoves;
}

/** 超级进化、极巨化、原始回归不算进选人招式池的进化。 */
function isTemporaryBattleForm(formKey?: string | null): boolean {
  if (!formKey) {
    return false;
  }
  return (
    formKey.startsWith(SpeciesFormKey.MEGA)
    || formKey.startsWith(SpeciesFormKey.GIGANTAMAX)
    || formKey === SpeciesFormKey.PRIMAL
    || formKey === SpeciesFormKey.ETERNAMAX
  );
}

/**
 * 当前种族、它的进化前、以及整条进化分支（伊布的八个进化都算）。
 * 不包含超级进化等临时形态。
 */
function collectEvolutionLine(starterId: SpeciesId): SpeciesId[] {
  const line = new Set<SpeciesId>([starterId, ...speciesDataRegistry.getPrevolutionChain(starterId)]);
  const queue = [...line];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const evolution of speciesDataRegistry.getEvolutions(current)) {
      if (isTemporaryBattleForm(evolution.evoFormKey) || line.has(evolution.speciesId)) {
        continue;
      }
      line.add(evolution.speciesId);
      queue.push(evolution.speciesId);
    }
  }
  return [...line];
}

/**
 * PVP 选人招式池：整条进化链的升级招式（含等级 0 的进化招式和 -1 的回忆招式）
 * 加上根种族的全部蛋招式。不看等级上限，也不看图鉴解锁。
 * 只有当前选中的形态用它自己的形态招式，其余阶段用基础形态。
 * 攻击招式按威力从高到低，这样默认四个槽位是最强的四个。
 */
export function getPvpStarterMoves(starterId: StarterSpeciesId, formIndex = 0): MoveId[] {
  const seen = new Set<MoveId>();
  const moves: MoveId[] = [];
  const push = (moveId: MoveId): void => {
    if (seen.has(moveId) || !allMoves[moveId] || allMoves[moveId].isUnimplemented) {
      return;
    }
    seen.add(moveId);
    moves.push(moveId);
  };

  for (const speciesId of collectEvolutionLine(starterId)) {
    const levelMoves = speciesDataRegistry.getLevelMoves(speciesId, speciesId === starterId ? formIndex : 0);
    for (const [, moveId] of levelMoves) {
      push(moveId);
    }
  }

  const rootId = speciesDataRegistry.getSpecies(starterId).getRootSpeciesId(true);
  const eggKey = rootId in speciesEggMoves ? rootId : starterId in speciesEggMoves ? starterId : null;
  if (eggKey != null) {
    for (const eggMove of speciesEggMoves[eggKey as keyof typeof speciesEggMoves]) {
      push(eggMove);
    }
  }

  return moves.sort((a, b) => {
    const powerA = allMoves[a].power > 0 ? allMoves[a].power : -1;
    const powerB = allMoves[b].power > 0 ? allMoves[b].power : -1;
    return powerB - powerA;
  });
}

export interface PvpAbilityChoice {
  index: number;
  name: string;
}

/**
 * PVP 可选特性。当前形态上每个不同、已实装的特性都算，不看图鉴解锁。
 * 没有第二特性或隐藏特性时不会凭空占位凑出两项。
 */
export function getPvpAbilityChoices(speciesId: number, formIndex = 0): PvpAbilityChoice[] {
  const species = speciesDataRegistry.getSpecies(speciesId as SpeciesId);
  const form = species.forms[formIndex] ?? species;
  const seen = new Set<number>();
  const choices: PvpAbilityChoice[] = [];
  for (let index = 0; index < form.getAbilityCount(); index++) {
    const abilityId = form.getAbility(index);
    if (!abilityId || seen.has(abilityId) || !allAbilities[abilityId]) {
      continue;
    }
    seen.add(abilityId);
    choices.push({ index, name: allAbilities[abilityId].name });
  }
  return choices;
}
