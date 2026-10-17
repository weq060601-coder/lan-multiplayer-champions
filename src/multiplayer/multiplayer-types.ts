import type { BiomeId } from "#enums/biome-id";
import type { GameModes } from "#enums/game-modes";
import type { MoveId } from "#enums/move-id";
import type { SpeciesId } from "#enums/species-id";

/** 联机模式枚举 */
export enum MultiplayerMode {
  /** 方案三：同种子竞速模式 (Race Mode) */
  RACE = "RACE",
  /** 方案三：灵魂同调模式 (Soul Link Mode) */
  SOUL_LINK = "SOUL_LINK",
  /** 方案一：局域网 PVP 竞技场模式 (LAN PvP Arena) */
  PVP = "PVP",
  /** 方案二：双人协同双打闯关模式 (2-Player Co-op Roguelike) */
  COOP = "COOP",
}

/** PVP 队伍规模：建房时二选一，双方使用同一规模。 */
export type PvpFormat = 3 | 6;

/** 玩家在房间中的角色 */
export enum PlayerRole {
  HOST = "HOST",
  CLIENT = "CLIENT",
}

/** 网络消息包类型 */
export enum PacketType {
  // 房间信令与生命周期
  ROOM_JOIN_REQUEST = "ROOM_JOIN_REQUEST",
  ROOM_JOIN_RESPONSE = "ROOM_JOIN_RESPONSE",
  ROOM_STATE_SYNC = "ROOM_STATE_SYNC",
  PLAYER_READY_TOGGLE = "PLAYER_READY_TOGGLE",
  START_GAME = "START_GAME",
  LEAVE_ROOM = "LEAVE_ROOM",
  CHAT_MESSAGE = "CHAT_MESSAGE",
  PING = "PING",
  PONG = "PONG",

  // 方案三：竞速与同调
  RACE_PROGRESS_UPDATE = "RACE_PROGRESS_UPDATE",
  SOUL_LINK_FAINT = "SOUL_LINK_FAINT",
  RACE_FINISHED = "RACE_FINISHED",

  // 方案一：PVP 对战
  PVP_PARTY_SYNC = "PVP_PARTY_SYNC",
  PVP_ACTION_SUBMIT = "PVP_ACTION_SUBMIT",
  PVP_TURN_RESOLVED = "PVP_TURN_RESOLVED",
  /** 濒死后换上哪一只（对手侧要用它决定敌方换谁上场） */
  PVP_SWITCH_IN = "PVP_SWITCH_IN",
  /** 房主每回合结束下发的权威 HP，用来抹平伤害浮动带来的漂移 */
  PVP_HP_SYNC = "PVP_HP_SYNC",
  /** 一方全队濒死，对局结束 */
  PVP_MATCH_OVER = "PVP_MATCH_OVER",
  /** 客机选择留在当前房间，等待房主决定是否继续 */
  PVP_REMATCH_READY = "PVP_REMATCH_READY",
  /** 房主确认双方继续，在原房间开始下一局 */
  PVP_REMATCH_START = "PVP_REMATCH_START",
  /** 任一方选择回主页时同步结束当前房间 */
  PVP_RETURN_HOME = "PVP_RETURN_HOME",

  // 方案二：双人双打协同
  COOP_SLOT_ACTION_SUBMIT = "COOP_SLOT_ACTION_SUBMIT",
  COOP_MODIFIER_SELECTED = "COOP_MODIFIER_SELECTED",
  COOP_STATE_SYNC = "COOP_STATE_SYNC",
}

/** 统一网络数据包结构 */
export interface NetworkPacket<T = any> {
  type: PacketType;
  senderId: string;
  senderName: string;
  timestamp: number;
  payload: T;
}

/** 简化的宝可梦预览数据 (用于大厅展示和侧边栏) */
export interface SerializedPokemonSimple {
  speciesId: SpeciesId;
  name: string;
  level: number;
  hpPercent: number;
  isFainted: boolean;
  isShiny: boolean;
}

/** 房间内的玩家信息 */
export interface MultiplayerPlayer {
  id: string;
  name: string;
  role: PlayerRole;
  isReady: boolean;
  avatarSpeciesId?: SpeciesId;
  /** 竞速/闯关实时状态 */
  currentWave?: number;
  currentBiome?: BiomeId;
  livingPokemonCount?: number;
  partyPreview?: SerializedPokemonSimple[];
  hasFinished?: boolean;
}

/** 房间状态 */
export interface RoomState {
  roomId: string;
  roomName: string;
  mode: MultiplayerMode;
  baseGameMode: GameModes;
  seed: string;
  players: MultiplayerPlayer[];
  gameStarted: boolean;
  /** 仅 PVP 使用；缺省值兼容旧房间，按 3v3 处理。 */
  pvpFormat?: PvpFormat;
  /** 仅 PVP 使用；是否在本场临时开放完整图鉴。 */
  pvpFullDex?: boolean;
  /** 仅 PVP 使用；是否开启神战（允许选择神兽 / 准神兽 / 幻之宝可梦）。缺省为关闭。 */
  pvpLegendary?: boolean;
  /** PVP 由房主权威下发的图鉴解锁快照，防止客机本地档影响选队。 */
  pvpDexSnapshot?: Record<number, PvpDexSnapshotEntry>;
}

/** JSON 可传输的房主图鉴字段。bitfield 用十进制字符串避免精度损失。 */
export interface PvpDexSnapshotEntry {
  seenAttr: string;
  caughtAttr: string;
  natureAttr: number;
  seenCount: number;
  caughtCount: number;
  hatchedCount: number;
  ivs: number[];
  abilityAttr: number;
}

/** 完整的宝可梦序列化数据 (用于 PVP 对战与 Co-op 换宠) */
export interface SerializedFullPokemon {
  speciesId: SpeciesId;
  name: string;
  level: number;
  gender: number;
  formIndex: number;
  shiny: boolean;
  variant: number;
  nature: number;
  ability: number;
  passiveAbility?: number;
  ivs: [number, number, number, number, number, number];
  evs: [number, number, number, number, number, number];
  currentHp: number;
  maxHp: number;
  stats: [number, number, number, number, number, number];
  moves: {
    moveId: MoveId;
    pp: number;
    maxPp: number;
  }[];
  /**
   * PVP：这只宝可梦身上的持有物。
   * 只传 modifierTypes 里的 typeId 和层数 —— 绝不能传 ModifierData，
   * 它的 args[0] 是 pokemonId，两台机器上对不上号。
   */
  heldItems?: {
    typeId: string;
    stackCount: number;
    /** 参数化生成器的具体选项（树果、超级石、专属道具等） */
    pregenArgs?: unknown[];
  }[];
}

/** 战斗行动指令类型 */
export enum BattleActionType {
  MOVE = "MOVE",
  SWITCH = "SWITCH",
  USE_ITEM = "USE_ITEM",
  RUN = "RUN",
}

/** PVP：交换队伍时一并带上的信息 */
export interface PvpPartyPayload {
  playerName: string;
  party: SerializedFullPokemon[];
}

/** PVP：单回合指令。只支持「用招式」和「换宝可梦」两种，够打一场简化版对战 */
export interface PvpCommandPayload {
  /** 发出这条指令时的回合序号，用来配对，防止先后到达错位 */
  turn: number;
  kind: "MOVE" | "SWITCH" | "SKIP";
  /** kind=MOVE：招式 ID。挣扎不在 moveset 里，所以必须直接传 ID 而不能只传下标 */
  moveId?: MoveId;
  /** kind=MOVE：招式在 moveset 里的下标（两台机器的 moveset 顺序一致），仅作兜底 */
  moveIndex?: number;
  /** kind=SWITCH：换上队伍里的第几只（两台机器的队伍顺序一致） */
  switchSlot?: number;
}

/** PVP：濒死后换上第几只 */
export interface PvpSwitchInPayload {
  slot: number;
}

/** PVP：房主下发的权威 HP 快照 */
export interface PvpHpSyncPayload {
  turn: number;
  /** 房主自己队伍的 HP（客机侧要当成「敌方队伍」） */
  hostParty: number[];
  /** 客机队伍的 HP（客机侧要当成「自己队伍」） */
  clientParty: number[];
}

/** 回合行动指令包 */
export interface TurnActionPayload {
  turnNumber: number;
  slotIndex: number;
  actionType: BattleActionType;
  moveIndex?: number;
  targetSlot?: number;
  switchPokemonIndex?: number;
  itemId?: string;
  itemTargetSlot?: number;
}

/** 竞速/同调模式进度更新包 */
export interface RaceProgressPayload {
  wave: number;
  biome: BiomeId;
  money: number;
  score: number;
  party: SerializedPokemonSimple[];
  faintedCount: number;
  isGameOver: boolean;
  isVictory: boolean;
}

/** 灵魂同调濒死同步包 */
export interface SoulLinkFaintPayload {
  slotIndex: number;
  speciesId: SpeciesId;
  pokemonName: string;
  wave: number;
}
