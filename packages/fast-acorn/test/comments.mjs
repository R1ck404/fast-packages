import * as fast from "../index.mjs";
import * as acorn from "acorn";
const cases = [
  "#!/usr/bin/env node\n// a\n/* b\n c */ x = 1 // d",
  "/* 1 */ let a = /* 2 */ 1; // 3\n let = ; // after error",
  "<!-- html comment\nx\n--> also html\n",
  "/** doc */ export default function f() { /* inner */ return 1 }",
];
for (const code of cases) {
  for (const sourceType of ["script", "module"]) {
    const run = (lib) => {
      const arr = [];
      let res;
      try {
        res = JSON.stringify(lib.parse(code, { ecmaVersion: "latest", sourceType, onComment: arr, locations: true, allowHashBang: true }));
      } catch (e) {
        res = "ERR " + e.message;
      }
      return res + " | " + JSON.stringify(arr);
    };
    console.log(run(acorn) === run(fast) ? "same" : "DIFF\n" + run(acorn) + "\n" + run(fast));
  }
}
