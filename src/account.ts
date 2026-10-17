import { pokerogueApi } from "#api/api";
import { bypassLogin } from "#constants/app-constants";
import type { UserInfo } from "#types/api";
import { randomString } from "#utils/common";

export let loggedInUser: UserInfo | null = null;

/** A random, 32-length alphanumeric string used to identify the current client session. */
// TODO: This should arguably be inside its own file
export const clientSessionId = randomString(32);

export async function updateUserInfo(): Promise<[success: boolean, status: number]> {
  if (!bypassLogin) {
    const [accountInfo, status] = await pokerogueApi.account.getInfo();
    if (!accountInfo) {
      return [false, status];
    }
    loggedInUser = accountInfo;
    return [true, 200];
  }

  loggedInUser = {
    username: "Guest",
    lastSessionSlot: -1,
    discordId: "",
    googleId: "",
    hasAdminRole: false,
  };
  for (let s = 0; s < 5; s++) {
    if (localStorage.getItem(getSessionDataLocalStorageKey(s))) {
      loggedInUser.lastSessionSlot = s;
      break;
    }
  }
  // 「继续游戏」优先读上次玩的那个存档；那个槽已被删除时才退回第一个有存档的槽。
  const remembered = getLastPlayedSessionSlot();
  if (remembered !== null && localStorage.getItem(getSessionDataLocalStorageKey(remembered))) {
    loggedInUser.lastSessionSlot = remembered;
  }

  // Migrate old data from before the username was appended
  // TODO: This fallback has existed for 20 MONTHS by now; review if we need it anymore
  for (const d of ["data", "sessionData", "sessionData1", "sessionData2", "sessionData3", "sessionData4"]) {
    const lsItem = localStorage.getItem(d);
    if (lsItem) {
      const lsUserItem = localStorage.getItem(`${d}_${loggedInUser.username}`);
      if (lsUserItem) {
        localStorage.setItem(`${d}_${loggedInUser.username}_bak`, lsUserItem);
      }
      localStorage.setItem(`${d}_${loggedInUser.username}`, lsItem);
      localStorage.removeItem(d);
    }
  }
  return [true, 200];
}

/** 本地记录「上次玩的存档槽」的 key，按用户名区分。 */
function getLastPlayedSlotKey(): string {
  return `lastSessionSlot_${loggedInUser?.username ?? "Guest"}`;
}

/** 记下最近读取或保存过的存档槽，供下次启动时「继续游戏」使用。 */
export function setLastPlayedSessionSlot(slotId: number): void {
  if (!Number.isInteger(slotId) || slotId < 0 || slotId >= 5) {
    return;
  }
  try {
    localStorage.setItem(getLastPlayedSlotKey(), String(slotId));
  } catch (err) {
    console.warn("Failed to remember last session slot", err);
  }
}

function getLastPlayedSessionSlot(): number | null {
  const slot = Number.parseInt(localStorage.getItem(getLastPlayedSlotKey()) ?? "", 10);
  return Number.isInteger(slot) && slot >= 0 && slot < 5 ? slot : null;
}

/**
 * Obtain the local storage key corresponding to a given save slot.
 * @param slotId - The numerical save slot ID
 * @throws {Error}
 * Throws if `slotId < 0` (which likely indicates an invalid slot passed from the title screen)
 * @returns The local storage key used to access the save data for the given slot.
 */
export function getSessionDataLocalStorageKey(slotId: number): string {
  if (slotId < 0) {
    throw new Error("Cannot access a negative save slot ID from localstorage!");
  }

  // TODO: Default to `Guest` as a fallback for no logged in username
  // rather than leaving a trailing underscore
  return `sessionData${slotId || ""}_${loggedInUser?.username}`;
}
