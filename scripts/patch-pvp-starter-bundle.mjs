/**
 * 启动器发出 dist 里的游戏脚本时，给 PVP 选人补上两件事：
 * 1. 招式不再只剩 1–5 级，整条进化链（含进化招式、回忆招式、蛋招式）都能进池子。
 * 2. 有多个特性时，菜单里出现「选择特性」，不看图鉴有没有解锁。
 * 单机模式的判断保持原样。匹配不到就原样返回，不改坏脚本。
 */

const MODE_PATTERNS = [
  /([A-Za-z_$][\w$]*)\?\.mode===`PVP`/g,
  /([A-Za-z_$][\w$]*)\?\.mode==="PVP"/g,
  /([A-Za-z_$][\w$]*)\?\.mode===([A-Za-z_$][\w$]*)\.PVP\b/g,
  /([A-Za-z_$][\w$]*)\.mode===`PVP`/g,
  /([A-Za-z_$][\w$]*)\.mode==="PVP"/g,
  /([A-Za-z_$][\w$]*)\.mode===([A-Za-z_$][\w$]*)\.PVP\b/g,
];

function tagPvpMode(source) {
  let count = 0;
  let out = source;
  for (const pattern of MODE_PATTERNS) {
    out = out.replace(pattern, (...args) => {
      const full = args[0];
      const at = args[args.length - 2];
      const previous = out.slice(Math.max(0, at - 60), at);
      if (previous.includes("__pokeroguePvpMoves")) {
        return full;
      }
      count++;
      return `((window.__pokeroguePvpMoves=(${full})),window.__pokeroguePvpMoves)`;
    });
  }
  return { source: out, count };
}

function pvpFlag(source) {
  const found = source.match(/([A-Za-z_$][\w$]*)\.roomState\??\.mode/);
  if (!found) {
    return "window.__pokeroguePvpMoves";
  }
  return `(window.__pokeroguePvpMoves=${found[1]}.roomState?.mode===\`PVP\`)`;
}

function evolutionWalk(registry, speciesId, formIndex, dest) {
  return `try{if(window.__pokeroguePvpMoves){const _seen=new Set(${dest});const _line=new Set([${speciesId}]);const _q=[${speciesId}];const _pre=${registry}.getPrevolutionChain?${registry}.getPrevolutionChain(${speciesId}):[];for(const _p of _pre||[]){_line.add(_p);_q.push(_p)}while(_q.length){const _cur=_q.pop();const _evos=${registry}.getEvolutions?${registry}.getEvolutions(_cur):[];for(const _ev of _evos||[]){const _key=_ev&&(_ev.evoFormKey||"");if(_key&&(String(_key).indexOf("mega")===0||String(_key).indexOf("gigantamax")===0||_key==="primal"||_key==="eternamax"))continue;if(!_ev||_line.has(_ev.speciesId))continue;_line.add(_ev.speciesId);_q.push(_ev.speciesId)}}for(const _sp of _line){for(const[,_mv]of ${registry}.getLevelMoves(_sp,_sp===${speciesId}?${formIndex}:0)||[]){if(!_seen.has(_mv)){_seen.add(_mv);${dest}.push(_mv)}}}}}catch(_evoMoves){console.warn("[PVP] 进化链招式没并进来",_evoMoves)}`;
}

function skipJsString(source, index) {
  const quote = source[index];
  let i = index + 1;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (quote === "`" && source[i] === "$" && source[i + 1] === "{") {
      i += 2;
      let depth = 1;
      while (i < source.length && depth > 0) {
        if (source[i] === "'" || source[i] === '"' || source[i] === "`") {
          i = skipJsString(source, i);
          continue;
        }
        if (source[i] === "{") {
          depth++;
        } else if (source[i] === "}") {
          depth--;
        }
        i++;
      }
      continue;
    }
    if (source[i] === quote) {
      return i + 1;
    }
    i++;
  }
  return i;
}

function matchBracket(source, openIndex) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const close = pairs[source[openIndex]];
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    const c = source[i];
    if (c === "'" || c === '"' || c === "`") {
      i = skipJsString(source, i) - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0 && c === close) {
        return i;
      }
    }
  }
  return -1;
}

function statementEnd(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === "'" || c === '"' || c === "`") {
      i = skipJsString(source, i) - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth++;
    } else if (c === ")" || c === "]") {
      if (depth === 0) {
        return -1;
      }
      depth--;
    } else if (c === "}") {
      if (depth === 0) {
        // 压缩后的 for 经常不加分号，直接顶到函数结尾的 }
        return i - 1;
      }
      depth--;
    } else if (c === ";" && depth === 0) {
      return i;
    }
  }
  return -1;
}

function patchMoveLoops(source, flag) {
  const loops = [];
  const headerRe = /for\s*\(\s*(?:let|const)\s*\[\s*(\w+)\s*,\s*(\w+)\s*\]\s*of\s*/g;
  let match = headerRe.exec(source);
  while (match) {
    const level = match[1];
    const move = match[2];
    const forParen = source.indexOf("(", match.index);
    const headerEnd = matchBracket(source, forParen);
    if (headerEnd < 0) {
      match = headerRe.exec(source);
      continue;
    }
    let cursor = headerEnd + 1;
    while (source[cursor] === " " || source[cursor] === "\n") {
      cursor++;
    }
    const bodyEnd = source[cursor] === "{" ? matchBracket(source, cursor) : statementEnd(source, cursor);
    const nearMoves = source.slice(Math.max(0, match.index - 350), headerEnd).includes("getLevelMoves");
    if (bodyEnd > headerEnd && bodyEnd - headerEnd < 800 && nearMoves) {
      const body = source.slice(headerEnd + 1, bodyEnd + 1);
      const cond = new RegExp(`\\b${level}\\s*>\\s*0\\s*&&\\s*${level}\\s*<=\\s*5`);
      const dest = body.match(new RegExp(`([A-Za-z_$][\\w$]*)\\.push\\(\\s*${move}\\s*\\)`));
      if (cond.test(body) && dest && !body.includes("__pokeroguePvpMoves")) {
        const region = source.slice(Math.max(0, match.index - 350), headerEnd);
        const calls = [...region.matchAll(/([A-Za-z_$][\w$]*)\.getLevelMoves\(\s*(\w+)\s*,\s*(\w+)\s*\)/g)];
        const call = calls[calls.length - 1];
        const newBody = body.replace(cond, found => `(${flag}||${found})`);
        const extra = call ? evolutionWalk(call[1], call[2], call[3], dest[1]) : "";
        loops.push({
          start: match.index,
          end: bodyEnd + 1,
          text: source.slice(match.index, headerEnd + 1) + newBody + extra,
        });
      }
    }
    match = headerRe.exec(source);
  }

  let out = source;
  for (let i = loops.length - 1; i >= 0; i--) {
    const loop = loops[i];
    out = out.slice(0, loop.start) + loop.text + out.slice(loop.end);
  }
  const count = loops.length;

  const egg = /(\w+)\.eggMoves\s*&\s*(?:\(\s*)?1\s*<<\s*(\w+)\s*(?:\)\s*)?&&\s*(\w+)\.push\(\s*(\w+)\[(\w+)\]\[\s*\2\s*\]\s*\)/g;
  let eggCount = 0;
  out = out.replace(egg, (full, data, bit, dest, table, speciesId) => {
    eggCount++;
    return `(${flag}||${data}.eggMoves&1<<${bit})&&${dest}.push(${table}[${speciesId}][${bit}])`;
  });
  return { source: out, count, eggCount };
}

function patchAbilityMenu(source) {
  if (source.includes("选择特性（当前：") || !source.includes("（不进化）")) {
    return { source, added: false };
  }
  const labelAt = source.indexOf("PVP 进化目标");
  const noEvoAt = source.indexOf("（不进化）");
  if (labelAt < 0 || noEvoAt < 0) {
    return { source, added: false };
  }
  const beforeLabel = source.slice(Math.max(0, labelAt - 160), labelAt);
  const optionsMatch = beforeLabel.match(/([A-Za-z_$][\w$]*)\.push\(\{\s*label:\s*["'`]?\s*$/);
  if (!optionsMatch) {
    return { source, added: false };
  }
  const head = source.slice(0, noEvoAt);
  const modeAt = Math.max(
    head.lastIndexOf("mode===`PVP`"),
    head.lastIndexOf('mode==="PVP"'),
    head.lastIndexOf(".PVP"),
  );
  if (modeAt < 0) {
    return { source, added: false };
  }
  const brace = source.indexOf("{", modeAt);
  if (brace < 0 || brace > noEvoAt) {
    return { source, added: false };
  }
  const block = source.slice(brace, noEvoAt + 80);
  const registry = block.match(/([A-Za-z_$][\w$]*)\.getSpecies\(/);
  const tail = source.slice(noEvoAt, noEvoAt + 5000);
  const setMode = tail.match(/([A-Za-z_$][\w$]*)\.setMode\(([^)]+)\)/);
  const clearMode = tail.match(/([A-Za-z_$][\w$]*)\.setModeWithoutClear\(([^,)]+)/);
  const abilityArray = source.match(/([A-Za-z_$][\w$]*)\[\w+\.getAbility\(\w+\)\]\?\.name/);
  if (!registry || !setMode || !clearMode) {
    return { source, added: false };
  }
  const ui = setMode[1];
  const mode = setMode[2];
  const optionMode = clearMode[2];
  const nameOf = abilityArray
    ? `(${abilityArray[1]}[_a]&&${abilityArray[1]}[_a].name||("特性"+(_i+1)))`
    : `("特性"+(_i+1))`;
  const injection = `try{const _prefs=(this.starterPreferences&&this.starterPreferences[this.lastStarterId])||{};const _sid=_prefs.pvpEvolution??this.lastStarterId;const _form=_sid===this.lastStarterId?(_prefs.formIndex||0):0;const _sp=${registry[1]}.getSpecies(_sid);const _fm=_sp.forms&&_sp.forms[_form]?_sp.forms[_form]:_sp;const _raw=[_fm.ability1,_fm.ability2,_fm.abilityHidden];const _seen=new Set();const _choices=[];for(let _i=0;_i<_raw.length;_i++){const _a=_raw[_i];if(!_a||_seen.has(_a))continue;_seen.add(_a);_choices.push({index:_i,name:${nameOf}})}if(_choices.length>1){const _cur=_choices.find(c=>c.index===_prefs.abilityIndex)||_choices[0];${optionsMatch[1]}.push({label:"选择特性（当前："+_cur.name+"）",handler:()=>{${ui}.setMode(${mode}).then(()=>{${ui}.showText("选择特性",null,()=>{${ui}.setModeWithoutClear(${optionMode},{options:_choices.map(c=>({label:c.name,handler:()=>{this.starterPreferences[this.lastStarterId]||(this.starterPreferences[this.lastStarterId]={});this.starterPreferences[this.lastStarterId].abilityIndex=c.index;this.originalStarterPreferences||(this.originalStarterPreferences={});this.originalStarterPreferences[this.lastStarterId]||(this.originalStarterPreferences[this.lastStarterId]={});this.originalStarterPreferences[this.lastStarterId].abilityIndex=c.index;try{this.setNewAbilityIndex(this.lastStarterId,c.index)}catch(_e){}try{this.setStarterDetails(this.lastStarterId)}catch(_e2){}${ui}.setMode(${mode});return true}})).concat([{label:"取消",handler:()=>{${ui}.setMode(${mode});return true}}]),maxOptions:8})})});return true}})}}catch(_pvpAbility){console.warn("[PVP] 特性菜单没挂上",_pvpAbility)}`;
  return {
    source: source.slice(0, brace + 1) + injection + source.slice(brace + 1),
    added: true,
  };
}

export function patchPvpStarterBundle(source, fileLabel = "") {
  const original = source;
  const notes = [];
  try {
    // 新编译的 dist 已经带上源码里的 PVP 招式和特性。再套这层补丁会把脚本改出语法错误，PC 黑屏。
    if (source.includes("选择特性（当前：")) {
      return { source, notes };
    }
    if (source.includes("battle-scene-erKXNiKp.js?v=lan3")) {
      source = source.split("battle-scene-erKXNiKp.js?v=lan3").join("battle-scene-erKXNiKp.js?v=lan4");
      notes.push("入口改到 lan4");
    }
    const tagged = tagPvpMode(source);
    source = tagged.source;
    if (tagged.count) {
      notes.push(`标记了 ${tagged.count} 处 PVP 模式判断`);
    }
    if (source.includes("getLevelMoves") && source.includes("<=5")) {
      const moves = patchMoveLoops(source, pvpFlag(source));
      source = moves.source;
      if (moves.count) {
        notes.push(`放开了 ${moves.count} 处初始招式等级限制`);
      }
      if (moves.eggCount) {
        notes.push(`蛋招式 ${moves.eggCount} 处在 PVP 不再看解锁`);
      }
      if (!moves.count && fileLabel.startsWith("battle-scene")) {
        notes.push("没找到 1–5 级招式过滤，选招式可能还是旧的");
      }
    }
    if (source.includes("（不进化）")) {
      const ability = patchAbilityMenu(source);
      source = ability.source;
      notes.push(ability.added ? "已加上选择特性" : "特性菜单锚点对不上，这次没改菜单");
    }
    return { source, notes };
  } catch (err) {
    return {
      source: original,
      notes: [`补丁失败${fileLabel ? `（${fileLabel}）` : ""}：${err instanceof Error ? err.message : String(err)}`],
    };
  }
}
