// String.prototype.isWellFormed and toWellFormed (ES2024: Node 20, recent
// browsers), which the engine uses, for older JavaScript engines (Node 18)
const proto = String.prototype as any;
if (typeof proto.isWellFormed !== "function") {
  const isLead = (c: number) => c >= 0xd800 && c <= 0xdbff;
  const isTrail = (c: number) => c >= 0xdc00 && c <= 0xdfff;
  Object.defineProperty(proto, "isWellFormed", {
    configurable: true,
    writable: true,
    value: function isWellFormed(this: string): boolean {
      const s = String(this);
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (isLead(c)) {
          if (i + 1 < s.length && isTrail(s.charCodeAt(i + 1))) i++;
          else return false;
        } else if (isTrail(c)) return false;
      }
      return true;
    },
  });
  Object.defineProperty(proto, "toWellFormed", {
    configurable: true,
    writable: true,
    value: function toWellFormed(this: string): string {
      const s = String(this);
      let out = "";
      let start = 0;
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (isLead(c) && i + 1 < s.length && isTrail(s.charCodeAt(i + 1))) {
          i++;
        } else if (isLead(c) || isTrail(c)) {
          out += s.slice(start, i) + String.fromCharCode(0xfffd);
          start = i + 1;
        }
      }
      return start === 0 ? s : out + s.slice(start);
    },
  });
}
export {};
