// Port of internal/helpers/timer.go: the timing information that the CLI's
// hidden "--timing" flag (api_helpers.UseTimer) prints. Go's methods do
// nothing on a nil *Timer; here a missing timer is null, and the call sites
// use "timer?.begin(...)".
import { MsgData, MsgID_None, Info, RANGE_ZERO } from "./logger.mjs";
                                        
import { GoPanic } from "./gopanic.mjs";

class timerData {
                        // (milliseconds, performance.now())
                       
                         
  constructor(time        , name        , isEnd         ) {
    this.time = time;
    this.name = name;
    this.isEnd = isEnd;
  }
}

function now()         {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// api_helpers.UseTimer
export const useTimer = { value: false };

// A new timer if "--timing" was given, else null
export function newTimerIfEnabled()               {
  return useTimer.value ? new Timer() : null;
}

export class Timer {
  ;                         
  constructor() {
    this.data = [];
  }

  begin(name        ) {
    this.data.push(new timerData(now(), name, false));
  }

  end(name        ) {
    this.data.push(new timerData(now(), name, true));
  }

  fork()        {
    return new Timer();
  }

  join(other              ) {
    if (other !== null) {
      for (const item of other.data) this.data.push(item);
    }
  }

  log(log     ) {
    const notes            = [];
    const stack                                       = [];
    let indent = 0;

    for (const item of this.data) {
      if (!item.isEnd) {
        const top = { item, index: notes.length };
        notes.push(new MsgData(null, null, "", true));
        stack.push(top);
        indent++;
      } else {
        indent--;
        const top = stack.pop()                                      ;
        if (item.name !== top.item.name) {
          throw new GoPanic("Internal error");
        }
        // (time.Duration.Milliseconds truncates)
        notes[top.index].text = "  ".repeat(indent) + top.item.name + ": " + Math.trunc(item.time - top.item.time) + "ms";
      }
    }

    log.addIDWithNotes(MsgID_None, Info, null, RANGE_ZERO, "Timing information (times may not nest hierarchically due to parallelism)", notes);
  }
}
// generated from timer.mts by tools/ts-build.mjs; edit that file
