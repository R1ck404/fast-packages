// Port of internal/css_parser/css_decls_color.go, css_color_spaces.go and
// css_decls_gradient.go (esbuild 0.28.2). See CONVENTIONS.md.
//
// Notes on the port:
// - helpers.F64 is a plain number (JavaScript never fuses operations); the
//   operation order of every F64 expression is kept exactly. Go's math
//   functions come from gostd.mjs (goPow, goCbrt, goAtan2, goSin, goCos,
//   goLog2, goRound, goCopysign).
// - Go constant expressions are evaluated exactly by the Go compiler and
//   rounded once. Where the same expression in JavaScript could round
//   differently, the correctly rounded value is written instead (with the Go
//   expression next to it).
// - css_ast.Token is passed by value in Go: functions that mutate their token
//   argument clone it first. "args := *token.Children" shares the backing
//   array with the caller's token, so writes through "args[i]" stay in place
//   like in Go.
// - Functions returning several values return arrays.
import { GoPanic, goIndexOutOfRange } from "./gopanic.mjs";
import { Token, WhitespaceBefore, WhitespaceAfter, AllowAnyPercentage, AllowPercentageAbove100 } from "./css_ast.mjs";
import { TComma, TDelimPlus, TDelimSlash, TDimension, TEndOfFile, TFunction, THash, TIdent, TNumber, TPercentage, tIsNumeric } from "./css_lexer.mjs";
import {
  cssFeatureHas,
  ColorFunctions,
  GradientDoublePosition,
  GradientInterpolation,
  GradientMidpoints,
  HWB,
  HexRGBA,
  Modern_RGB_HSL,
  RebeccaPurple,
} from "./compat_css.mjs";
import { strconvParseFloat, formatFloatFixed, goToLower, goEqualFold, goRound, goCopysign, goPow, goCbrt, goAtan2, goSin, goCos, goLog2, goUint32FromFloat } from "./gostd.mjs";

// A zero css_ast.Token{} (Kind == css_lexer.T(0)). Only ever read.
const ZERO_TOKEN = new Token();

// Go: 180 / math.Pi and math.Pi / 180 (computed exactly, rounded once)
const RAD_TO_DEG = 57.29577951308232;
const DEG_TO_RAD = 0.017453292519943295;

// ---------------------------------------------------------------------------
// css_decls_color.go

// These names are shorter than their hex codes
export const shortColorName: Map<number, string> = new Map([
  [0x000080ff, "navy"],
  [0x008000ff, "green"],
  [0x008080ff, "teal"],
  [0x4b0082ff, "indigo"],
  [0x800000ff, "maroon"],
  [0x800080ff, "purple"],
  [0x808000ff, "olive"],
  [0x808080ff, "gray"],
  [0xa0522dff, "sienna"],
  [0xa52a2aff, "brown"],
  [0xc0c0c0ff, "silver"],
  [0xcd853fff, "peru"],
  [0xd2b48cff, "tan"],
  [0xda70d6ff, "orchid"],
  [0xdda0ddff, "plum"],
  [0xee82eeff, "violet"],
  [0xf0e68cff, "khaki"],
  [0xf0ffffff, "azure"],
  [0xf5deb3ff, "wheat"],
  [0xf5f5dcff, "beige"],
  [0xfa8072ff, "salmon"],
  [0xfaf0e6ff, "linen"],
  [0xff0000ff, "red"],
  [0xff6347ff, "tomato"],
  [0xff7f50ff, "coral"],
  [0xffa500ff, "orange"],
  [0xffc0cbff, "pink"],
  [0xffd700ff, "gold"],
  [0xffe4c4ff, "bisque"],
  [0xfffafaff, "snow"],
  [0xfffff0ff, "ivory"],
]);

export const colorNameToHex: Map<string, number> = new Map([
  ["black", 0x000000ff],
  ["silver", 0xc0c0c0ff],
  ["gray", 0x808080ff],
  ["white", 0xffffffff],
  ["maroon", 0x800000ff],
  ["red", 0xff0000ff],
  ["purple", 0x800080ff],
  ["fuchsia", 0xff00ffff],
  ["green", 0x008000ff],
  ["lime", 0x00ff00ff],
  ["olive", 0x808000ff],
  ["yellow", 0xffff00ff],
  ["navy", 0x000080ff],
  ["blue", 0x0000ffff],
  ["teal", 0x008080ff],
  ["aqua", 0x00ffffff],
  ["orange", 0xffa500ff],
  ["aliceblue", 0xf0f8ffff],
  ["antiquewhite", 0xfaebd7ff],
  ["aquamarine", 0x7fffd4ff],
  ["azure", 0xf0ffffff],
  ["beige", 0xf5f5dcff],
  ["bisque", 0xffe4c4ff],
  ["blanchedalmond", 0xffebcdff],
  ["blueviolet", 0x8a2be2ff],
  ["brown", 0xa52a2aff],
  ["burlywood", 0xdeb887ff],
  ["cadetblue", 0x5f9ea0ff],
  ["chartreuse", 0x7fff00ff],
  ["chocolate", 0xd2691eff],
  ["coral", 0xff7f50ff],
  ["cornflowerblue", 0x6495edff],
  ["cornsilk", 0xfff8dcff],
  ["crimson", 0xdc143cff],
  ["cyan", 0x00ffffff],
  ["darkblue", 0x00008bff],
  ["darkcyan", 0x008b8bff],
  ["darkgoldenrod", 0xb8860bff],
  ["darkgray", 0xa9a9a9ff],
  ["darkgreen", 0x006400ff],
  ["darkgrey", 0xa9a9a9ff],
  ["darkkhaki", 0xbdb76bff],
  ["darkmagenta", 0x8b008bff],
  ["darkolivegreen", 0x556b2fff],
  ["darkorange", 0xff8c00ff],
  ["darkorchid", 0x9932ccff],
  ["darkred", 0x8b0000ff],
  ["darksalmon", 0xe9967aff],
  ["darkseagreen", 0x8fbc8fff],
  ["darkslateblue", 0x483d8bff],
  ["darkslategray", 0x2f4f4fff],
  ["darkslategrey", 0x2f4f4fff],
  ["darkturquoise", 0x00ced1ff],
  ["darkviolet", 0x9400d3ff],
  ["deeppink", 0xff1493ff],
  ["deepskyblue", 0x00bfffff],
  ["dimgray", 0x696969ff],
  ["dimgrey", 0x696969ff],
  ["dodgerblue", 0x1e90ffff],
  ["firebrick", 0xb22222ff],
  ["floralwhite", 0xfffaf0ff],
  ["forestgreen", 0x228b22ff],
  ["gainsboro", 0xdcdcdcff],
  ["ghostwhite", 0xf8f8ffff],
  ["gold", 0xffd700ff],
  ["goldenrod", 0xdaa520ff],
  ["greenyellow", 0xadff2fff],
  ["grey", 0x808080ff],
  ["honeydew", 0xf0fff0ff],
  ["hotpink", 0xff69b4ff],
  ["indianred", 0xcd5c5cff],
  ["indigo", 0x4b0082ff],
  ["ivory", 0xfffff0ff],
  ["khaki", 0xf0e68cff],
  ["lavender", 0xe6e6faff],
  ["lavenderblush", 0xfff0f5ff],
  ["lawngreen", 0x7cfc00ff],
  ["lemonchiffon", 0xfffacdff],
  ["lightblue", 0xadd8e6ff],
  ["lightcoral", 0xf08080ff],
  ["lightcyan", 0xe0ffffff],
  ["lightgoldenrodyellow", 0xfafad2ff],
  ["lightgray", 0xd3d3d3ff],
  ["lightgreen", 0x90ee90ff],
  ["lightgrey", 0xd3d3d3ff],
  ["lightpink", 0xffb6c1ff],
  ["lightsalmon", 0xffa07aff],
  ["lightseagreen", 0x20b2aaff],
  ["lightskyblue", 0x87cefaff],
  ["lightslategray", 0x778899ff],
  ["lightslategrey", 0x778899ff],
  ["lightsteelblue", 0xb0c4deff],
  ["lightyellow", 0xffffe0ff],
  ["limegreen", 0x32cd32ff],
  ["linen", 0xfaf0e6ff],
  ["magenta", 0xff00ffff],
  ["mediumaquamarine", 0x66cdaaff],
  ["mediumblue", 0x0000cdff],
  ["mediumorchid", 0xba55d3ff],
  ["mediumpurple", 0x9370dbff],
  ["mediumseagreen", 0x3cb371ff],
  ["mediumslateblue", 0x7b68eeff],
  ["mediumspringgreen", 0x00fa9aff],
  ["mediumturquoise", 0x48d1ccff],
  ["mediumvioletred", 0xc71585ff],
  ["midnightblue", 0x191970ff],
  ["mintcream", 0xf5fffaff],
  ["mistyrose", 0xffe4e1ff],
  ["moccasin", 0xffe4b5ff],
  ["navajowhite", 0xffdeadff],
  ["oldlace", 0xfdf5e6ff],
  ["olivedrab", 0x6b8e23ff],
  ["orangered", 0xff4500ff],
  ["orchid", 0xda70d6ff],
  ["palegoldenrod", 0xeee8aaff],
  ["palegreen", 0x98fb98ff],
  ["paleturquoise", 0xafeeeeff],
  ["palevioletred", 0xdb7093ff],
  ["papayawhip", 0xffefd5ff],
  ["peachpuff", 0xffdab9ff],
  ["peru", 0xcd853fff],
  ["pink", 0xffc0cbff],
  ["plum", 0xdda0ddff],
  ["powderblue", 0xb0e0e6ff],
  ["rosybrown", 0xbc8f8fff],
  ["royalblue", 0x4169e1ff],
  ["saddlebrown", 0x8b4513ff],
  ["salmon", 0xfa8072ff],
  ["sandybrown", 0xf4a460ff],
  ["seagreen", 0x2e8b57ff],
  ["seashell", 0xfff5eeff],
  ["sienna", 0xa0522dff],
  ["skyblue", 0x87ceebff],
  ["slateblue", 0x6a5acdff],
  ["slategray", 0x708090ff],
  ["slategrey", 0x708090ff],
  ["snow", 0xfffafaff],
  ["springgreen", 0x00ff7fff],
  ["steelblue", 0x4682b4ff],
  ["tan", 0xd2b48cff],
  ["thistle", 0xd8bfd8ff],
  ["tomato", 0xff6347ff],
  ["turquoise", 0x40e0d0ff],
  ["violet", 0xee82eeff],
  ["wheat", 0xf5deb3ff],
  ["whitesmoke", 0xf5f5f5ff],
  ["yellowgreen", 0x9acd32ff],
  ["rebeccapurple", 0x663399ff],
]);

// Returns [hex, ok] (hex is a uint32)
export function parseHex(text: string): [number, boolean] {
  let hex = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    let d: number;
    if (c >= 48 && c <= 57) {
      d = c - 48;
    } else if (c >= 97 && c <= 102) {
      d = c - (97 - 10);
    } else if (c >= 65 && c <= 70) {
      d = c - (65 - 10);
    } else {
      return [0, false];
    }
    hex = ((hex << 4) | d) >>> 0;
  }
  return [hex, true];
}

// 0xAABBCCDD => 0xABCD
export function compactHex(v: number): number {
  return (((v & 0x0ff00000) >>> 12) | ((v & 0x00000ff0) >>> 4)) >>> 0;
}

// 0xABCD => 0xAABBCCDD
export function expandHex(v: number): number {
  return (((v & 0xf000) << 16) | ((v & 0xff00) << 12) | ((v & 0x0ff0) << 8) | ((v & 0x00ff) << 4) | (v & 0x000f)) >>> 0;
}

export function hexR(v: number): number {
  return v >>> 24;
}
export function hexG(v: number): number {
  return (v >>> 16) & 255;
}
export function hexB(v: number): number {
  return (v >>> 8) & 255;
}
export function hexA(v: number): number {
  return v & 255;
}

export function floatToStringForColor(a: number): string {
  let text = formatFloatFixed(a, 3);
  while (text.charCodeAt(text.length - 1) === 48 /* '0' */) {
    text = text.slice(0, text.length - 1);
  }
  if (text.charCodeAt(text.length - 1) === 46 /* '.' */) {
    text = text.slice(0, text.length - 1);
  }
  return text;
}

// Returns [degrees, ok]
export function degreesForAngle(token: Token): [number, boolean] {
  switch (token.kind) {
    case TNumber: {
      const r = strconvParseFloat(token.text);
      if (r[1]) {
        return [r[0], true];
      }
      break;
    }

    case TDimension: {
      const r = strconvParseFloat(token.dimensionValue());
      if (r[1]) {
        const value = r[0];
        switch (token.dimensionUnit()) {
          case "deg":
            return [value, true];
          case "grad":
            return [value * (360.0 / 400.0), true];
          case "rad":
            return [value * RAD_TO_DEG, true];
          case "turn":
            return [value * 360.0, true];
        }
      }
      break;
    }
  }
  return [0, false];
}

export function lowerAlphaPercentageToNumber(token: Token): Token {
  if (token.kind === TPercentage) {
    const r = strconvParseFloat(token.text.slice(0, token.text.length - 1));
    if (r[1]) {
      token = token.clone();
      token.kind = TNumber;
      token.text = floatToStringForColor(r[0] / 100.0);
    }
  }
  return token;
}

export class parsedColor {
  declare x: number; // color if hasColorSpace == true
  declare y: number;
  declare z: number;
  declare hex: number; // color and alpha if hasColorSpace == false, alpha if hasColorSpace == true
  declare hasColorSpace: boolean;
  constructor(x = 0, y = 0, z = 0, hex = 0, hasColorSpace = false) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.hex = hex;
    this.hasColorSpace = hasColorSpace;
  }
  clone(): parsedColor {
    return new parsedColor(this.x, this.y, this.z, this.hex, this.hasColorSpace);
  }
}

export function looksLikeColor(token: Token): boolean {
  switch (token.kind) {
    case TIdent:
      if (colorNameToHex.has(goToLower(token.text))) {
        return true;
      }
      break;

    case THash:
      switch (token.text.length) {
        case 3:
        case 4:
        case 6:
        case 8:
          if (parseHex(token.text)[1]) {
            return true;
          }
      }
      break;

    case TFunction:
      switch (goToLower(token.text)) {
        case "color-mix":
        case "color":
        case "hsl":
        case "hsla":
        case "hwb":
        case "lab":
        case "lch":
        case "oklab":
        case "oklch":
        case "rgb":
        case "rgba":
          return true;
      }
  }

  return false;
}

function childrenOf(token: Token): Token[] {
  // Go dereferences "*token.Children" (a nil pointer would panic)
  const children = token.children;
  if (children === null) throw new GoPanic("runtime error: invalid memory address or nil pointer dereference");
  return children;
}

// Returns [color, ok]
export function parseColor(token: Token): [parsedColor, boolean] {
  const text = token.text;

  switch (token.kind) {
    case TIdent: {
      const hex = colorNameToHex.get(goToLower(text));
      if (hex !== undefined) {
        return [new parsedColor(0, 0, 0, hex), true];
      }
      break;
    }

    case THash:
      switch (text.length) {
        case 3: {
          // "#123"
          const r = parseHex(text);
          if (r[1]) {
            return [new parsedColor(0, 0, 0, ((expandHex(r[0]) << 8) | 0xff) >>> 0), true];
          }
          break;
        }

        case 4: {
          // "#1234"
          const r = parseHex(text);
          if (r[1]) {
            return [new parsedColor(0, 0, 0, expandHex(r[0])), true];
          }
          break;
        }

        case 6: {
          // "#112233"
          const r = parseHex(text);
          if (r[1]) {
            return [new parsedColor(0, 0, 0, ((r[0] << 8) | 0xff) >>> 0), true];
          }
          break;
        }

        case 8: {
          // "#11223344"
          const r = parseHex(text);
          if (r[1]) {
            return [new parsedColor(0, 0, 0, r[0]), true];
          }
          break;
        }
      }
      break;

    case TFunction: {
      const lowerText = goToLower(text);
      switch (lowerText) {
        case "rgb":
        case "rgba": {
          const args = childrenOf(token);
          let r = ZERO_TOKEN;
          let g = ZERO_TOKEN;
          let b = ZERO_TOKEN;
          let a = ZERO_TOKEN;

          switch (args.length) {
            case 3:
              // "rgb(1 2 3)"
              r = args[0];
              g = args[1];
              b = args[2];
              break;

            case 5:
              // "rgba(1, 2, 3)"
              if (args[1].kind === TComma && args[3].kind === TComma) {
                r = args[0];
                g = args[2];
                b = args[4];
                break;
              }

              // "rgb(1 2 3 / 4%)"
              if (args[3].kind === TDelimSlash) {
                r = args[0];
                g = args[1];
                b = args[2];
                a = args[4];
              }
              break;

            case 7:
              // "rgb(1%, 2%, 3%, 4%)"
              if (args[1].kind === TComma && args[3].kind === TComma && args[5].kind === TComma) {
                r = args[0];
                g = args[2];
                b = args[4];
                a = args[6];
              }
              break;
          }

          const rr = parseColorByte(r, 1);
          if (rr[1]) {
            const gg = parseColorByte(g, 1);
            if (gg[1]) {
              const bb = parseColorByte(b, 1);
              if (bb[1]) {
                const aa = parseAlphaByte(a);
                if (aa[1]) {
                  return [new parsedColor(0, 0, 0, ((rr[0] << 24) | (gg[0] << 16) | (bb[0] << 8) | aa[0]) >>> 0), true];
                }
              }
            }
          }
          break;
        }

        case "hsl":
        case "hsla": {
          const args = childrenOf(token);
          let h = ZERO_TOKEN;
          let s = ZERO_TOKEN;
          let l = ZERO_TOKEN;
          let a = ZERO_TOKEN;

          switch (args.length) {
            case 3:
              // "hsl(1 2 3)"
              h = args[0];
              s = args[1];
              l = args[2];
              break;

            case 5:
              // "hsla(1, 2, 3)"
              if (args[1].kind === TComma && args[3].kind === TComma) {
                h = args[0];
                s = args[2];
                l = args[4];
                break;
              }

              // "hsl(1 2 3 / 4%)"
              if (args[3].kind === TDelimSlash) {
                h = args[0];
                s = args[1];
                l = args[2];
                a = args[4];
              }
              break;

            case 7:
              // "hsl(1%, 2%, 3%, 4%)"
              if (args[1].kind === TComma && args[3].kind === TComma && args[5].kind === TComma) {
                h = args[0];
                s = args[2];
                l = args[4];
                a = args[6];
              }
              break;
          }

          // HSL => RGB
          const hh = degreesForAngle(h);
          if (hh[1]) {
            const ss = s.clampedFractionForPercentage();
            if (ss[1]) {
              const ll = l.clampedFractionForPercentage();
              if (ll[1]) {
                const aa = parseAlphaByte(a);
                if (aa[1]) {
                  const rgb = hslToRgb(hh[0], ss[0], ll[0]);
                  return [new parsedColor(0, 0, 0, packRGBA(rgb[0], rgb[1], rgb[2], aa[0])), true];
                }
              }
            }
          }
          break;
        }

        case "hwb": {
          const args = childrenOf(token);
          let h = ZERO_TOKEN;
          let s = ZERO_TOKEN;
          let l = ZERO_TOKEN;
          let a = ZERO_TOKEN;

          switch (args.length) {
            case 3:
              // "hwb(1 2 3)"
              h = args[0];
              s = args[1];
              l = args[2];
              break;

            case 5:
              // "hwb(1 2 3 / 4%)"
              if (args[3].kind === TDelimSlash) {
                h = args[0];
                s = args[1];
                l = args[2];
                a = args[4];
              }
              break;
          }

          // HWB => RGB
          const hh = degreesForAngle(h);
          if (hh[1]) {
            const white = s.clampedFractionForPercentage();
            if (white[1]) {
              const black = l.clampedFractionForPercentage();
              if (black[1]) {
                const aa = parseAlphaByte(a);
                if (aa[1]) {
                  const rgb = hwbToRgb(hh[0], white[0], black[0]);
                  return [new parsedColor(0, 0, 0, packRGBA(rgb[0], rgb[1], rgb[2], aa[0])), true];
                }
              }
            }
          }
          break;
        }

        case "color": {
          const args = childrenOf(token);
          let colorSpace = ZERO_TOKEN;
          let alpha = ZERO_TOKEN;

          switch (args.length) {
            case 4:
              // "color(xyz 1 2 3)"
              colorSpace = args[0];
              break;

            case 6:
              // "color(xyz 1 2 3 / 50%)"
              if (args[4].kind === TDelimSlash) {
                colorSpace = args[0];
                alpha = args[5];
              }
              break;
          }

          if (colorSpace.kind === TIdent) {
            const r0 = args[1].numberOrFractionForPercentage(1, 0);
            if (r0[1]) {
              const r1 = args[2].numberOrFractionForPercentage(1, 0);
              if (r1[1]) {
                const r2 = args[3].numberOrFractionForPercentage(1, 0);
                if (r2[1]) {
                  const aa = parseAlphaByte(alpha);
                  if (aa[1]) {
                    const a = aa[0];
                    const v0 = r0[0];
                    const v1 = r1[0];
                    const v2 = r2[0];
                    switch (goToLower(colorSpace.text)) {
                      case "a98-rgb": {
                        const rgb = lin_a98rgb(v0, v1, v2);
                        const xyz = lin_a98rgb_to_xyz(rgb[0], rgb[1], rgb[2]);
                        return [new parsedColor(xyz[0], xyz[1], xyz[2], a, true), true];
                      }

                      case "display-p3": {
                        const rgb = lin_p3(v0, v1, v2);
                        const xyz = lin_p3_to_xyz(rgb[0], rgb[1], rgb[2]);
                        return [new parsedColor(xyz[0], xyz[1], xyz[2], a, true), true];
                      }

                      case "prophoto-rgb": {
                        const rgb = lin_prophoto(v0, v1, v2);
                        let xyz = lin_prophoto_to_xyz(rgb[0], rgb[1], rgb[2]);
                        xyz = d50_to_d65(xyz[0], xyz[1], xyz[2]);
                        return [new parsedColor(xyz[0], xyz[1], xyz[2], a, true), true];
                      }

                      case "rec2020": {
                        const rgb = lin_2020(v0, v1, v2);
                        const xyz = lin_2020_to_xyz(rgb[0], rgb[1], rgb[2]);
                        return [new parsedColor(xyz[0], xyz[1], xyz[2], a, true), true];
                      }

                      case "srgb": {
                        const rgb = lin_srgb(v0, v1, v2);
                        const xyz = lin_srgb_to_xyz(rgb[0], rgb[1], rgb[2]);
                        return [new parsedColor(xyz[0], xyz[1], xyz[2], a, true), true];
                      }

                      case "srgb-linear": {
                        const xyz = lin_srgb_to_xyz(v0, v1, v2);
                        return [new parsedColor(xyz[0], xyz[1], xyz[2], a, true), true];
                      }

                      case "xyz":
                      case "xyz-d65":
                        return [new parsedColor(v0, v1, v2, a, true), true];

                      case "xyz-d50": {
                        const xyz = d50_to_d65(v0, v1, v2);
                        return [new parsedColor(xyz[0], xyz[1], xyz[2], a, true), true];
                      }
                    }
                  }
                }
              }
            }
          }
          break;
        }

        case "lab":
        case "lch":
        case "oklab":
        case "oklch": {
          const args = childrenOf(token);
          let v0 = ZERO_TOKEN;
          let v1 = ZERO_TOKEN;
          let v2 = ZERO_TOKEN;
          let alpha = ZERO_TOKEN;

          switch (args.length) {
            case 3:
              // "lab(1 2 3)"
              v0 = args[0];
              v1 = args[1];
              v2 = args[2];
              break;

            case 5:
              // "lab(1 2 3 / 50%)"
              if (args[3].kind === TDelimSlash) {
                v0 = args[0];
                v1 = args[1];
                v2 = args[2];
                alpha = args[4];
              }
              break;
          }

          if (v0.kind !== TEndOfFile) {
            const aa = parseAlphaByte(alpha);
            if (aa[1]) {
              const a = aa[0];
              switch (lowerText) {
                case "lab": {
                  const r0 = v0.numberOrFractionForPercentage(100, 0);
                  if (r0[1]) {
                    const r1 = v1.numberOrFractionForPercentage(125, AllowAnyPercentage);
                    if (r1[1]) {
                      const r2 = v2.numberOrFractionForPercentage(125, AllowAnyPercentage);
                      if (r2[1]) {
                        let xyz = lab_to_xyz(r0[0], r1[0], r2[0]);
                        xyz = d50_to_d65(xyz[0], xyz[1], xyz[2]);
                        return [new parsedColor(xyz[0], xyz[1], xyz[2], a, true), true];
                      }
                    }
                  }
                  break;
                }

                case "lch": {
                  const r0 = v0.numberOrFractionForPercentage(100, 0);
                  if (r0[1]) {
                    const r1 = v1.numberOrFractionForPercentage(125, AllowPercentageAbove100);
                    if (r1[1]) {
                      const r2 = degreesForAngle(v2);
                      if (r2[1]) {
                        const lab = lch_to_lab(r0[0], r1[0], r2[0]);
                        let xyz = lab_to_xyz(lab[0], lab[1], lab[2]);
                        xyz = d50_to_d65(xyz[0], xyz[1], xyz[2]);
                        return [new parsedColor(xyz[0], xyz[1], xyz[2], a, true), true];
                      }
                    }
                  }
                  break;
                }

                case "oklab": {
                  const r0 = v0.numberOrFractionForPercentage(1, 0);
                  if (r0[1]) {
                    const r1 = v1.numberOrFractionForPercentage(0.4, AllowAnyPercentage);
                    if (r1[1]) {
                      const r2 = v2.numberOrFractionForPercentage(0.4, AllowAnyPercentage);
                      if (r2[1]) {
                        const xyz = oklab_to_xyz(r0[0], r1[0], r2[0]);
                        return [new parsedColor(xyz[0], xyz[1], xyz[2], a, true), true];
                      }
                    }
                  }
                  break;
                }

                case "oklch": {
                  const r0 = v0.numberOrFractionForPercentage(1, 0);
                  if (r0[1]) {
                    const r1 = v1.numberOrFractionForPercentage(0.4, AllowPercentageAbove100);
                    if (r1[1]) {
                      const r2 = degreesForAngle(v2);
                      if (r2[1]) {
                        const lab = oklch_to_oklab(r0[0], r1[0], r2[0]);
                        const xyz = oklab_to_xyz(lab[0], lab[1], lab[2]);
                        return [new parsedColor(xyz[0], xyz[1], xyz[2], a, true), true];
                      }
                    }
                  }
                  break;
                }
              }
            }
          }
          break;
        }
      }
      break;
    }
  }

  return [new parsedColor(), false];
}

// Reference: https://drafts.csswg.org/css-color/#hwb-to-rgb
export function hwbToRgb(hue: number, white: number, black: number): number[] {
  if (white + black >= 1) {
    const gray = white / (white + black);
    return [gray, gray, gray];
  }
  const delta = -(white + black) + 1;
  const rgb = hslToRgb(hue, 1, 0.5);
  const r = delta * rgb[0] + white;
  const g = delta * rgb[1] + white;
  const b = delta * rgb[2] + white;
  return [r, g, b];
}

// Reference https://drafts.csswg.org/css-color/#hsl-to-rgb
export function hslToRgb(hue: number, sat: number, light: number): number[] {
  hue = hue / 360.0;
  let t2: number;
  if (light <= 0.5) {
    t2 = (sat + 1) * light;
  } else {
    t2 = light + sat - light * sat;
  }
  const t1 = light * 2 - t2;
  const r = hueToRgb(t1, t2, hue + 1.0 / 3.0);
  const g = hueToRgb(t1, t2, hue);
  const b = hueToRgb(t1, t2, hue - 1.0 / 3.0);
  return [r, g, b];
}

export function hueToRgb(t1: number, t2: number, hue: number): number {
  hue = hue - Math.floor(hue);
  hue = hue * 6;
  let f: number;
  if (hue < 1) {
    f = (t2 - t1) * hue + t1; // helpers.Lerp(t1, t2, hue)
  } else if (hue < 3) {
    f = t2;
  } else if (hue < 4) {
    f = (t2 - t1) * (-hue + 4) + t1; // helpers.Lerp(t1, t2, hue.Neg().AddConst(4))
  } else {
    f = t1;
  }
  return f;
}

export function packRGBA(rf: number, gf: number, bf: number, a: number): number {
  const r = floatToByte(rf);
  const g = floatToByte(gf);
  const b = floatToByte(bf);
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

// Go's "int(f)" for an integral float64 whose result is then clamped to
// 0..255. NaN converts to 0 on wasm and to MinInt64 on amd64 (both clamp to
// 0), and so do values below -2^63. Values of 2^63 and above saturate on wasm
// (esbuild-wasm, which this reproduces) but become MinInt64 on amd64.
function intForClampedByte(f: number): number {
  if (f !== f) return 0;
  if (f >= 9223372036854775807) return 9223372036854775807; // (wasm: saturates to MaxInt64)
  return f === 0 ? 0 : f; // (no -0)
}

export function floatToByte(f: number): number {
  let i = intForClampedByte(goRound(f * 255));
  if (i < 0) {
    i = 0;
  } else if (i > 255) {
    i = 255;
  }
  return i;
}

// Returns [byte, ok]
export function parseAlphaByte(token: Token): [number, boolean] {
  if (token.kind === TEndOfFile) {
    return [255, true];
  }
  return parseColorByte(token, 255);
}

// Returns [byte, ok]
export function parseColorByte(token: Token, scale: number): [number, boolean] {
  let i = 0;
  let ok = false;

  switch (token.kind) {
    case TNumber: {
      const r = strconvParseFloat(token.text);
      if (r[1]) {
        i = intForClampedByte(goRound(r[0] * scale));
        ok = true;
      }
      break;
    }

    case TPercentage: {
      const r = strconvParseFloat(token.percentageValue());
      if (r[1]) {
        i = intForClampedByte(goRound(r[0] * (255.0 / 100.0)));
        ok = true;
      }
      break;
    }
  }

  if (i < 0) {
    i = 0;
  } else if (i > 255) {
    i = 255;
  }
  return [i, ok];
}

// Returns [hex, ok]
export function tryToConvertToHexWithoutClipping(x: number, y: number, z: number, a: number): [number, boolean] {
  const lin = xyz_to_lin_srgb(x, y, z);
  const rgb = gam_srgb(lin[0], lin[1], lin[2]);
  const r = rgb[0];
  const g = rgb[1];
  const b = rgb[2];
  if (r < -0.5 / 255 || r > 255.5 / 255 || g < -0.5 / 255 || g > 255.5 / 255 || b < -0.5 / 255 || b > 255.5 / 255) {
    return [0, false];
  }
  return [packRGBA(r, g, b, a), true];
}

function hexString(v: number, width: number): string {
  return (v >>> 0).toString(16).padStart(width, "0");
}

// Every four characters in this table is the fraction for that index
export const alphaFractionTable: string =
  "" +
  "0   .004.008.01 .016.02 .024.027.03 .035.04 .043.047.05 .055.06 " +
  ".063.067.07 .075.08 .082.086.09 .094.098.1  .106.11 .114.118.12 " +
  ".125.13 .133.137.14 .145.15 .153.157.16 .165.17 .173.176.18 .184" +
  ".19 .192.196.2  .204.208.21 .216.22 .224.227.23 .235.24 .243.247" +
  ".25 .255.26 .263.267.27 .275.28 .282.286.29 .294.298.3  .306.31 " +
  ".314.318.32 .325.33 .333.337.34 .345.35 .353.357.36 .365.37 .373" +
  ".376.38 .384.39 .392.396.4  .404.408.41 .416.42 .424.427.43 .435" +
  ".44 .443.447.45 .455.46 .463.467.47 .475.48 .482.486.49 .494.498" +
  ".5  .506.51 .514.518.52 .525.53 .533.537.54 .545.55 .553.557.56 " +
  ".565.57 .573.576.58 .584.59 .592.596.6  .604.608.61 .616.62 .624" +
  ".627.63 .635.64 .643.647.65 .655.66 .663.667.67 .675.68 .682.686" +
  ".69 .694.698.7  .706.71 .714.718.72 .725.73 .733.737.74 .745.75 " +
  ".753.757.76 .765.77 .773.776.78 .784.79 .792.796.8  .804.808.81 " +
  ".816.82 .824.827.83 .835.84 .843.847.85 .855.86 .863.867.87 .875" +
  ".88 .882.886.89 .894.898.9  .906.91 .914.918.92 .925.93 .933.937" +
  ".94 .945.95 .953.957.96 .965.97 .973.976.98 .984.99 .992.9961   ";

// ---------------------------------------------------------------------------
// css_color_spaces.go

// Reference: https://drafts.csswg.org/css-color/#color-conversion-code

// colorSpace
export const colorSpace_a98_rgb = 0;
export const colorSpace_display_p3 = 1;
export const colorSpace_hsl = 2;
export const colorSpace_hwb = 3;
export const colorSpace_lab = 4;
export const colorSpace_lch = 5;
export const colorSpace_oklab = 6;
export const colorSpace_oklch = 7;
export const colorSpace_prophoto_rgb = 8;
export const colorSpace_rec2020 = 9;
export const colorSpace_srgb = 10;
export const colorSpace_srgb_linear = 11;
export const colorSpace_xyz = 12;
export const colorSpace_xyz_d50 = 13;
export const colorSpace_xyz_d65 = 14;

// Go: func (colorSpace colorSpace) isPolar() bool
export function colorSpaceIsPolar(colorSpace: number): boolean {
  switch (colorSpace) {
    case colorSpace_hsl:
    case colorSpace_hwb:
    case colorSpace_lch:
    case colorSpace_oklch:
      return true;
  }
  return false;
}

// hueMethod
export const shorterHue = 0;
export const longerHue = 1;
export const increasingHue = 2;
export const decreasingHue = 3;

function lin_srgb_f(val: number): number {
  const abs = Math.abs(val);
  if (abs < 0.04045) {
    return val / 12.92;
  } else {
    return goCopysign(goPow((abs + 0.055) / 1.055, 2.4), val);
  }
}

export function lin_srgb(r: number, g: number, b: number): number[] {
  return [lin_srgb_f(r), lin_srgb_f(g), lin_srgb_f(b)];
}

function gam_srgb_f(val: number): number {
  const abs = Math.abs(val);
  if (abs > 0.0031308) {
    return goCopysign(goPow(abs, 5 / 12 /* Go: 1 / 2.4 */) * 1.055 - 0.055, val);
  } else {
    return val * 12.92;
  }
}

export function gam_srgb(r: number, g: number, b: number): number[] {
  return [gam_srgb_f(r), gam_srgb_f(g), gam_srgb_f(b)];
}

const M_lin_srgb_to_xyz = [
  506752.0 / 1228815, 87881.0 / 245763, 12673.0 / 70218,
  87098.0 / 409605, 175762.0 / 245763, 12673.0 / 175545,
  7918.0 / 409605, 87881.0 / 737289, 1001167.0 / 1053270,
];

export function lin_srgb_to_xyz(r: number, g: number, b: number): number[] {
  return multiplyMatrices(M_lin_srgb_to_xyz, r, g, b);
}

const M_xyz_to_lin_srgb = [
  12831.0 / 3959, -329.0 / 214, -1974.0 / 3959,
  -851781.0 / 878810, 1648619.0 / 878810, 36519.0 / 878810,
  705.0 / 12673, -2585.0 / 12673, 705.0 / 667,
];

export function xyz_to_lin_srgb(x: number, y: number, z: number): number[] {
  return multiplyMatrices(M_xyz_to_lin_srgb, x, y, z);
}

export function lin_p3(r: number, g: number, b: number): number[] {
  return lin_srgb(r, g, b);
}

export function gam_p3(r: number, g: number, b: number): number[] {
  return gam_srgb(r, g, b);
}

const M_lin_p3_to_xyz = [
  608311.0 / 1250200, 189793.0 / 714400, 198249.0 / 1000160,
  35783.0 / 156275, 247089.0 / 357200, 198249.0 / 2500400,
  0.0 / 1, 32229.0 / 714400, 5220557.0 / 5000800,
];

export function lin_p3_to_xyz(r: number, g: number, b: number): number[] {
  return multiplyMatrices(M_lin_p3_to_xyz, r, g, b);
}

const M_xyz_to_lin_p3 = [
  446124.0 / 178915, -333277.0 / 357830, -72051.0 / 178915,
  -14852.0 / 17905, 63121.0 / 35810, 423.0 / 17905,
  11844.0 / 330415, -50337.0 / 660830, 316169.0 / 330415,
];

export function xyz_to_lin_p3(x: number, y: number, z: number): number[] {
  return multiplyMatrices(M_xyz_to_lin_p3, x, y, z);
}

function lin_prophoto_f(val: number): number {
  const Et2 = 16.0 / 512;
  const abs = Math.abs(val);
  if (abs <= Et2) {
    return val / 16;
  } else {
    return goCopysign(goPow(abs, 1.8), val);
  }
}

export function lin_prophoto(r: number, g: number, b: number): number[] {
  return [lin_prophoto_f(r), lin_prophoto_f(g), lin_prophoto_f(b)];
}

function gam_prophoto_f(val: number): number {
  const Et = 1.0 / 512;
  const abs = Math.abs(val);
  if (abs >= Et) {
    return goCopysign(goPow(abs, 5 / 9 /* Go: 1 / 1.8 */), val);
  } else {
    return val * 16;
  }
}

export function gam_prophoto(r: number, g: number, b: number): number[] {
  return [gam_prophoto_f(r), gam_prophoto_f(g), gam_prophoto_f(b)];
}

const M_lin_prophoto_to_xyz = [
  0.7977604896723027, 0.13518583717574031, 0.0313493495815248,
  0.2880711282292934, 0.7118432178101014, 0.00008565396060525902,
  0.0, 0.0, 0.8251046025104601,
];

export function lin_prophoto_to_xyz(r: number, g: number, b: number): number[] {
  return multiplyMatrices(M_lin_prophoto_to_xyz, r, g, b);
}

const M_xyz_to_lin_prophoto = [
  1.3457989731028281, -0.25558010007997534, -0.05110628506753401,
  -0.5446224939028347, 1.5082327413132781, 0.02053603239147973,
  0.0, 0.0, 1.2119675456389454,
];

export function xyz_to_lin_prophoto(x: number, y: number, z: number): number[] {
  return multiplyMatrices(M_xyz_to_lin_prophoto, x, y, z);
}

function lin_a98rgb_f(val: number): number {
  return goCopysign(goPow(Math.abs(val), 563.0 / 256), val);
}

export function lin_a98rgb(r: number, g: number, b: number): number[] {
  return [lin_a98rgb_f(r), lin_a98rgb_f(g), lin_a98rgb_f(b)];
}

function gam_a98rgb_f(val: number): number {
  return goCopysign(goPow(Math.abs(val), 256.0 / 563), val);
}

export function gam_a98rgb(r: number, g: number, b: number): number[] {
  return [gam_a98rgb_f(r), gam_a98rgb_f(g), gam_a98rgb_f(b)];
}

const M_lin_a98rgb_to_xyz = [
  573536.0 / 994567, 263643.0 / 1420810, 187206.0 / 994567,
  591459.0 / 1989134, 6239551.0 / 9945670, 374412.0 / 4972835,
  53769.0 / 1989134, 351524.0 / 4972835, 4929758.0 / 4972835,
];

export function lin_a98rgb_to_xyz(r: number, g: number, b: number): number[] {
  return multiplyMatrices(M_lin_a98rgb_to_xyz, r, g, b);
}

const M_xyz_to_lin_a98rgb = [
  1829569.0 / 896150, -506331.0 / 896150, -308931.0 / 896150,
  -851781.0 / 878810, 1648619.0 / 878810, 36519.0 / 878810,
  16779.0 / 1248040, -147721.0 / 1248040, 1266979.0 / 1248040,
];

export function xyz_to_lin_a98rgb(x: number, y: number, z: number): number[] {
  return multiplyMatrices(M_xyz_to_lin_a98rgb, x, y, z);
}

// Go: const alpha = 1.09929682680944, const beta = 0.018053968510807
const rec2020_alpha = 1.09929682680944;
const rec2020_beta = 0.018053968510807;
const rec2020_alpha_minus_1 = 0.09929682680944; // Go: alpha - 1 (exact)
const rec2020_beta_times_4_5 = 0.0812428582986315; // Go: beta * 4.5 (exact)

function lin_2020_f(val: number): number {
  const abs = Math.abs(val);
  if (abs < rec2020_beta_times_4_5) {
    return val / 4.5;
  } else {
    return goCopysign(goPow((abs + rec2020_alpha_minus_1) / rec2020_alpha, 20 / 9 /* Go: 1 / 0.45 */), val);
  }
}

export function lin_2020(r: number, g: number, b: number): number[] {
  return [lin_2020_f(r), lin_2020_f(g), lin_2020_f(b)];
}

function gam_2020_f(val: number): number {
  const abs = Math.abs(val);
  if (abs > rec2020_beta) {
    return goCopysign(goPow(abs, 0.45) * rec2020_alpha - rec2020_alpha_minus_1, val);
  } else {
    return val * 4.5;
  }
}

export function gam_2020(r: number, g: number, b: number): number[] {
  return [gam_2020_f(r), gam_2020_f(g), gam_2020_f(b)];
}

const M_lin_2020_to_xyz = [
  63426534.0 / 99577255, 20160776.0 / 139408157, 47086771.0 / 278816314,
  26158966.0 / 99577255, 472592308.0 / 697040785, 8267143.0 / 139408157,
  0.0 / 1, 19567812.0 / 697040785, 295819943.0 / 278816314,
];

export function lin_2020_to_xyz(r: number, g: number, b: number): number[] {
  return multiplyMatrices(M_lin_2020_to_xyz, r, g, b);
}

const M_xyz_to_lin_2020 = [
  30757411.0 / 17917100, -6372589.0 / 17917100, -4539589.0 / 17917100,
  -19765991.0 / 29648200, 47925759.0 / 29648200, 467509.0 / 29648200,
  792561.0 / 44930125, -1921689.0 / 44930125, 42328811.0 / 44930125,
];

export function xyz_to_lin_2020(x: number, y: number, z: number): number[] {
  return multiplyMatrices(M_xyz_to_lin_2020, x, y, z);
}

const M_d65_to_d50 = [
  1.0479297925449969, 0.022946870601609652, -0.05019226628920524,
  0.02962780877005599, 0.9904344267538799, -0.017073799063418826,
  -0.009243040646204504, 0.015055191490298152, 0.7518742814281371,
];

export function d65_to_d50(x: number, y: number, z: number): number[] {
  return multiplyMatrices(M_d65_to_d50, x, y, z);
}

const M_d50_to_d65 = [
  0.955473421488075, -0.02309845494876471, 0.06325924320057072,
  -0.0283697093338637, 1.0099953980813041, 0.021041441191917323,
  0.012314014864481998, -0.020507649298898964, 1.330365926242124,
];

export function d50_to_d65(x: number, y: number, z: number): number[] {
  return multiplyMatrices(M_d50_to_d65, x, y, z);
}

export const d50_x = 3457 / 3585; // Go: 0.3457 / 0.3585 (exact decimals)
export const d50_z = 2958 / 3585; // Go: (1.0 - 0.3457 - 0.3585) / 0.3585

// Go: const epsilon = 216.0 / 24389, const kappa = 24389.0 / 27
const lab_epsilon = 216.0 / 24389;
const lab_kappa = 24389.0 / 27;
const lab_kappa_times_epsilon = 8; // Go: kappa * epsilon (exactly 216 / 27)

export function xyz_to_lab(x: number, y: number, z: number): number[] {
  x = x / d50_x;
  z = z / d50_z;

  let f0: number;
  let f1: number;
  let f2: number;
  if (x > lab_epsilon) {
    f0 = goCbrt(x);
  } else {
    f0 = (x * lab_kappa + 16) / 116;
  }
  if (y > lab_epsilon) {
    f1 = goCbrt(y);
  } else {
    f1 = (y * lab_kappa + 16) / 116;
  }
  if (z > lab_epsilon) {
    f2 = goCbrt(z);
  } else {
    f2 = (z * lab_kappa + 16) / 116;
  }

  return [f1 * 116 - 16, (f0 - f1) * 500, (f1 - f2) * 200];
}

export function lab_to_xyz(l: number, a: number, b: number): number[] {
  const f1 = (l + 16) / 116;
  const f0 = a / 500 + f1;
  const f2 = f1 - b / 200;

  const f0_3 = f0 * f0 * f0;
  const f2_3 = f2 * f2 * f2;

  let x: number;
  let y: number;
  let z: number;
  if (f0_3 > lab_epsilon) {
    x = f0_3;
  } else {
    x = (f0 * 116 - 16) / lab_kappa;
  }
  if (l > lab_kappa_times_epsilon) {
    y = (l + 16) / 116;
    y = y * y * y;
  } else {
    y = l / lab_kappa;
  }
  if (f2_3 > lab_epsilon) {
    z = f2_3;
  } else {
    z = (f2 * 116 - 16) / lab_kappa;
  }

  return [x * d50_x, y, z * d50_z];
}

export function lab_to_lch(l: number, a: number, b: number): number[] {
  let hue = goAtan2(b, a) * RAD_TO_DEG;
  if (hue < 0) {
    hue = hue + 360;
  }
  return [l, Math.sqrt(a * a + b * b), hue];
}

export function lch_to_lab(l: number, c: number, h: number): number[] {
  return [l, goCos(h * DEG_TO_RAD) * c, goSin(h * DEG_TO_RAD) * c];
}

const M_XYZtoLMS = [
  0.8190224432164319, 0.3619062562801221, -0.12887378261216414,
  0.0329836671980271, 0.9292868468965546, 0.03614466816999844,
  0.048177199566046255, 0.26423952494422764, 0.6335478258136937,
];
const M_LMStoOKLab = [
  0.2104542553, 0.7936177850, -0.0040720468,
  1.9779984951, -2.4285922050, 0.4505937099,
  0.0259040371, 0.7827717662, -0.8086757660,
];

export function xyz_to_oklab(x: number, y: number, z: number): number[] {
  const lms = multiplyMatrices(M_XYZtoLMS, x, y, z);
  return multiplyMatrices(M_LMStoOKLab, goCbrt(lms[0]), goCbrt(lms[1]), goCbrt(lms[2]));
}

const M_LMStoXYZ = [
  1.2268798733741557, -0.5578149965554813, 0.28139105017721583,
  -0.04057576262431372, 1.1122868293970594, -0.07171106666151701,
  -0.07637294974672142, -0.4214933239627914, 1.5869240244272418,
];
const M_OKLabtoLMS = [
  0.99999999845051981432, 0.39633779217376785678, 0.21580375806075880339,
  1.0000000088817607767, -0.1055613423236563494, -0.063854174771705903402,
  1.0000000546724109177, -0.089484182094965759684, -1.2914855378640917399,
];

export function oklab_to_xyz(l: number, a: number, b: number): number[] {
  const lms = multiplyMatrices(M_OKLabtoLMS, l, a, b);
  const L = lms[0];
  const m = lms[1];
  const s = lms[2];
  return multiplyMatrices(M_LMStoXYZ, L * L * L, m * m * m, s * s * s);
}

export function oklab_to_oklch(l: number, a: number, b: number): number[] {
  return lab_to_lch(l, a, b);
}

export function oklch_to_oklab(l: number, c: number, h: number): number[] {
  return lch_to_lab(l, c, h);
}

export function multiplyMatrices(A: number[], b0: number, b1: number, b2: number): number[] {
  return [
    b0 * A[0] + b1 * A[1] + b2 * A[2],
    b0 * A[3] + b1 * A[4] + b2 * A[5],
    b0 * A[6] + b1 * A[7] + b2 * A[8],
  ];
}

export function delta_eok(L1: number, a1: number, b1: number, L2: number, a2: number, b2: number): number {
  const dL = L1 - L2;
  const da = a1 - a2;
  const db = b1 - b2;
  const dL_sq = dL * dL;
  const da_sq = da * da;
  const db_sq = db * db;
  return Math.sqrt(dL_sq + da_sq + db_sq);
}

// (closures of gamut_mapping_xyz_to_srgb)
function gamut_oklch_to_srgb(l: number, c: number, h: number): number[] {
  const lab = oklch_to_oklab(l, c, h);
  const xyz = oklab_to_xyz(lab[0], lab[1], lab[2]);
  const rgb = xyz_to_lin_srgb(xyz[0], xyz[1], xyz[2]);
  return gam_srgb(rgb[0], rgb[1], rgb[2]);
}

function gamut_srgb_to_oklab(r: number, g: number, b: number): number[] {
  const lin = lin_srgb(r, g, b);
  const xyz = lin_srgb_to_xyz(lin[0], lin[1], lin[2]);
  return xyz_to_oklab(xyz[0], xyz[1], xyz[2]);
}

function gamut_inGamut(r: number, g: number, b: number): boolean {
  return r >= 0 && r <= 1 && g >= 0 && g <= 1 && b >= 0 && b <= 1;
}

function gamut_clip(x: number): number {
  if (x < 0) {
    return 0;
  }
  if (x > 1) {
    return 1;
  }
  return x;
}

export function gamut_mapping_xyz_to_srgb(x: number, y: number, z: number): number[] {
  const oklab = xyz_to_oklab(x, y, z);
  const lch = oklab_to_oklch(oklab[0], oklab[1], oklab[2]);
  const origin_l = lch[0];
  let origin_c = lch[1];
  const origin_h = lch[2];

  if (origin_l >= 1 || origin_l <= 0) {
    return [origin_l, origin_l, origin_l];
  }

  let rgb = gamut_oklch_to_srgb(origin_l, origin_c, origin_h);
  let r = rgb[0];
  let g = rgb[1];
  let b = rgb[2];
  if (gamut_inGamut(r, g, b)) {
    return [r, g, b];
  }

  const JND = 0.02;
  const epsilon = 0.0001;
  let min = 0.0;
  let max = origin_c;

  while (max - min > epsilon) {
    const chroma = (min + max) / 2;
    origin_c = chroma;

    rgb = gamut_oklch_to_srgb(origin_l, origin_c, origin_h);
    r = rgb[0];
    g = rgb[1];
    b = rgb[2];
    if (gamut_inGamut(r, g, b)) {
      min = chroma;
      continue;
    }

    const clipped_r = gamut_clip(r);
    const clipped_g = gamut_clip(g);
    const clipped_b = gamut_clip(b);
    const lab1 = gamut_srgb_to_oklab(clipped_r, clipped_g, clipped_b);
    const lab2 = gamut_srgb_to_oklab(r, g, b);
    const E = delta_eok(lab1[0], lab1[1], lab1[2], lab2[0], lab2[1], lab2[2]);
    if (E < JND) {
      return [clipped_r, clipped_g, clipped_b];
    }

    max = chroma;
  }

  return [r, g, b];
}

// (closure of hsl_to_rgb)
function hsl_to_rgb_f(n: number, hue: number, sat: number, light: number): number {
  let k = hue / 30 + n;
  k = k / 12;
  k = k - Math.floor(k);
  k = k * 12;
  const a = Math.min(light, -light + 1) * sat;
  return light - Math.max(-1, Math.min(Math.min(k - 3, -k + 9), 1)) * a;
}

export function hsl_to_rgb(hue: number, sat: number, light: number): number[] {
  hue = hue / 360;
  hue = hue - Math.floor(hue);
  hue = hue * 360;

  sat = sat / 100;
  light = light / 100;

  return [hsl_to_rgb_f(0, hue, sat, light), hsl_to_rgb_f(8, hue, sat, light), hsl_to_rgb_f(4, hue, sat, light)];
}

export function rgb_to_hsl(red: number, green: number, blue: number): number[] {
  const max = Math.max(Math.max(red, green), blue);
  const min = Math.min(Math.min(red, green), blue);
  let hue = NaN;
  let sat = 0.0;
  const light = (min + max) / 2;
  const d = max - min;

  if (d !== 0) {
    const div = Math.min(light, -light + 1);
    if (div !== 0) {
      sat = (max - light) / div;
    }

    switch (max) {
      case red:
        hue = (green - blue) / d;
        if (green < blue) {
          hue = hue + 6;
        }
        break;
      case green:
        hue = (blue - red) / d + 2;
        break;
      case blue:
        hue = (red - green) / d + 4;
        break;
    }

    hue = hue * 60;
  }

  return [hue, sat * 100, light * 100];
}

export function hwb_to_rgb(hue: number, white: number, black: number): number[] {
  white = white / 100;
  black = black / 100;
  if (white + black >= 1) {
    const gray = white / (white + black);
    return [gray, gray, gray];
  }
  const delta = -(white + black) + 1;
  const rgb = hsl_to_rgb(hue, 100, 50);
  const r = delta * rgb[0] + white;
  const g = delta * rgb[1] + white;
  const b = delta * rgb[2] + white;
  return [r, g, b];
}

export function rgb_to_hwb(red: number, green: number, blue: number): number[] {
  const h = rgb_to_hsl(red, green, blue)[0];
  const white = Math.min(Math.min(red, green), blue);
  const black = -Math.max(Math.max(red, green), blue) + 1;
  return [h, white * 100, black * 100];
}

export function xyz_to_colorSpace(x: number, y: number, z: number, colorSpace: number): number[] {
  switch (colorSpace) {
    case colorSpace_a98_rgb: {
      const v = xyz_to_lin_a98rgb(x, y, z);
      return gam_a98rgb(v[0], v[1], v[2]);
    }

    case colorSpace_display_p3: {
      const v = xyz_to_lin_p3(x, y, z);
      return gam_p3(v[0], v[1], v[2]);
    }

    case colorSpace_hsl: {
      const v = xyz_to_lin_srgb(x, y, z);
      const w = gam_srgb(v[0], v[1], v[2]);
      return rgb_to_hsl(w[0], w[1], w[2]);
    }

    case colorSpace_hwb: {
      const v = xyz_to_lin_srgb(x, y, z);
      const w = gam_srgb(v[0], v[1], v[2]);
      return rgb_to_hwb(w[0], w[1], w[2]);
    }

    case colorSpace_lab: {
      const v = d65_to_d50(x, y, z);
      return xyz_to_lab(v[0], v[1], v[2]);
    }

    case colorSpace_lch: {
      const v = d65_to_d50(x, y, z);
      const w = xyz_to_lab(v[0], v[1], v[2]);
      return lab_to_lch(w[0], w[1], w[2]);
    }

    case colorSpace_oklab:
      return xyz_to_oklab(x, y, z);

    case colorSpace_oklch: {
      const v = xyz_to_oklab(x, y, z);
      return oklab_to_oklch(v[0], v[1], v[2]);
    }

    case colorSpace_prophoto_rgb: {
      const v = d65_to_d50(x, y, z);
      const w = xyz_to_lin_prophoto(v[0], v[1], v[2]);
      return gam_prophoto(w[0], w[1], w[2]);
    }

    case colorSpace_rec2020: {
      const v = xyz_to_lin_2020(x, y, z);
      return gam_2020(v[0], v[1], v[2]);
    }

    case colorSpace_srgb: {
      const v = xyz_to_lin_srgb(x, y, z);
      return gam_srgb(v[0], v[1], v[2]);
    }

    case colorSpace_srgb_linear:
      return xyz_to_lin_srgb(x, y, z);

    case colorSpace_xyz:
    case colorSpace_xyz_d65:
      return [x, y, z];

    case colorSpace_xyz_d50:
      return d65_to_d50(x, y, z);

    default:
      throw new GoPanic("Internal error");
  }
}

export function colorSpace_to_xyz(v0: number, v1: number, v2: number, colorSpace: number): number[] {
  switch (colorSpace) {
    case colorSpace_a98_rgb: {
      const v = lin_a98rgb(v0, v1, v2);
      return lin_a98rgb_to_xyz(v[0], v[1], v[2]);
    }

    case colorSpace_display_p3: {
      const v = lin_p3(v0, v1, v2);
      return lin_p3_to_xyz(v[0], v[1], v[2]);
    }

    case colorSpace_hsl: {
      const v = hsl_to_rgb(v0, v1, v2);
      const w = lin_srgb(v[0], v[1], v[2]);
      return lin_srgb_to_xyz(w[0], w[1], w[2]);
    }

    case colorSpace_hwb: {
      const v = hwb_to_rgb(v0, v1, v2);
      const w = lin_srgb(v[0], v[1], v[2]);
      return lin_srgb_to_xyz(w[0], w[1], w[2]);
    }

    case colorSpace_lab: {
      const v = lab_to_xyz(v0, v1, v2);
      return d50_to_d65(v[0], v[1], v[2]);
    }

    case colorSpace_lch: {
      const v = lch_to_lab(v0, v1, v2);
      const w = lab_to_xyz(v[0], v[1], v[2]);
      return d50_to_d65(w[0], w[1], w[2]);
    }

    case colorSpace_oklab:
      return oklab_to_xyz(v0, v1, v2);

    case colorSpace_oklch: {
      const v = oklch_to_oklab(v0, v1, v2);
      return oklab_to_xyz(v[0], v[1], v[2]);
    }

    case colorSpace_prophoto_rgb: {
      const v = lin_prophoto(v0, v1, v2);
      const w = lin_prophoto_to_xyz(v[0], v[1], v[2]);
      return d50_to_d65(w[0], w[1], w[2]);
    }

    case colorSpace_rec2020: {
      const v = lin_2020(v0, v1, v2);
      return lin_2020_to_xyz(v[0], v[1], v[2]);
    }

    case colorSpace_srgb: {
      const v = lin_srgb(v0, v1, v2);
      return lin_srgb_to_xyz(v[0], v[1], v[2]);
    }

    case colorSpace_srgb_linear:
      return lin_srgb_to_xyz(v0, v1, v2);

    case colorSpace_xyz:
    case colorSpace_xyz_d65:
      return [v0, v1, v2];

    case colorSpace_xyz_d50:
      return d50_to_d65(v0, v1, v2);

    default:
      throw new GoPanic("Internal error");
  }
}

// ---------------------------------------------------------------------------
// css_decls_gradient.go

// gradientKind
export const linearGradient = 0;
export const radialGradient = 1;
export const conicGradient = 2;

export class parsedGradient {
  declare leadingTokens: Token[];
  declare colorStops: colorStop[];
  declare kind: number;
  declare repeating: boolean;
  constructor(leadingTokens: Token[] = [], colorStops: colorStop[] = [], kind = linearGradient, repeating = false) {
    this.leadingTokens = leadingTokens;
    this.colorStops = colorStops;
    this.kind = kind;
    this.repeating = repeating;
  }
}

export class colorStop {
  declare positions: Token[];
  declare color: Token;
  declare midpoint: Token; // Absent if "midpoint.kind === TEndOfFile"
  constructor(positions: Token[] = [], color: Token = new Token(), midpoint: Token = new Token()) {
    this.positions = positions;
    this.color = color;
    this.midpoint = midpoint;
  }
  // A shallow copy (Go: "clone := stop")
  clone(): colorStop {
    return new colorStop(this.positions, this.color, this.midpoint);
  }
}

// Returns [gradient, success]
export function parseGradient(token: Token): [parsedGradient | null, boolean] {
  if (token.kind !== TFunction) {
    return [null, false];
  }

  const gradient = new parsedGradient();
  switch (goToLower(token.text)) {
    case "linear-gradient":
      gradient.kind = linearGradient;
      break;

    case "radial-gradient":
      gradient.kind = radialGradient;
      break;

    case "conic-gradient":
      gradient.kind = conicGradient;
      break;

    case "repeating-linear-gradient":
      gradient.kind = linearGradient;
      gradient.repeating = true;
      break;

    case "repeating-radial-gradient":
      gradient.kind = radialGradient;
      gradient.repeating = true;
      break;

    case "repeating-conic-gradient":
      gradient.kind = conicGradient;
      gradient.repeating = true;
      break;

    default:
      return [null, false];
  }

  // Bail if any token is a "var()" since it may introduce commas
  const tokens = childrenOf(token);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === TFunction && goEqualFold(t.text, "var")) {
      return [null, false];
    }
  }

  // (Go reslices "tokens"; here "k" is the start of the remaining tokens)
  const n = tokens.length;
  let k = 0;

  // Try to strip the initial tokens
  if (n > 0 && !looksLikeColor(tokens[0])) {
    let i = 0;
    while (i < n && tokens[i].kind !== TComma) {
      i++;
    }
    gradient.leadingTokens = tokens.slice(0, i);
    if (i < n) {
      k = i + 1;
    } else {
      k = n;
    }
  }

  // Try to parse the color stops
  while (k < n) {
    // Parse the color
    const color = tokens[k];
    if (!looksLikeColor(color)) {
      return [null, false];
    }
    k++;

    // Parse up to two positions (copies: they may be mutated later)
    const positions: Token[] = [];
    while (positions.length < 2 && k < n) {
      const position = tokens[k];
      if (tIsNumeric(position.kind) || (position.kind === TFunction && goEqualFold(position.text, "calc"))) {
        positions.push(position.clone());
      } else {
        break;
      }
      k++;
    }

    // Parse the comma
    let midpoint = new Token();
    if (k < n) {
      if (tokens[k].kind !== TComma) {
        return [null, false];
      }
      k++;
      if (k === n) {
        return [null, false];
      }

      // Parse the midpoint, if any
      if (k < n && tIsNumeric(tokens[k].kind)) {
        midpoint = tokens[k];
        k++;

        // Followed by a mandatory comma
        if (k === n || tokens[k].kind !== TComma) {
          return [null, false];
        }
        k++;
      }
    }

    // Add the color stop
    gradient.colorStops.push(new colorStop(positions, color, midpoint));
  }

  return [gradient, true];
}

export function removeImpliedPositions(kind: number, colorStops: colorStop[]): colorStop[] {
  if (colorStops.length === 0) {
    return colorStops;
  }

  const positions: valueWithUnit[] = new Array(colorStops.length);
  for (let i = 0; i < colorStops.length; i++) {
    const stop = colorStops[i];
    if (stop.positions.length === 1) {
      const r = tryToParseValue(stop.positions[0], kind);
      if (r[1]) {
        positions[i] = r[0]!;
        continue;
      }
    }
    positions[i] = new valueWithUnit("", NaN);
  }

  let start = 0;
  while (start < colorStops.length) {
    const startPos = positions[start];
    if (!(startPos.value !== startPos.value)) {
      let end = start + 1;
      run: while (colorStops[end - 1].midpoint.kind === TEndOfFile && end < colorStops.length) {
        const endPos = positions[end];
        if (endPos.value !== endPos.value || endPos.unit !== startPos.unit) {
          break;
        }

        // Check that all values in this run are implied. Interpolation is done
        // using the start and end positions instead of the first and second
        // positions because it's more accurate.
        for (let i = start + 1; i < end; i++) {
          const t = (i - start) / (end - start);
          const impliedValue = (endPos.value - startPos.value) * t + startPos.value;
          if (Math.abs(positions[i].value - impliedValue) > 0.01) {
            break run;
          }
        }
        end++;
      }

      // Clear out all implied values
      if (end - start > 1) {
        for (let i = start + 1; i + 1 < end; i++) {
          colorStops[i].positions = [];
        }
        start = end - 1;
        continue;
      }
    }
    start++;
  }

  const first = colorStops[0].positions;
  if (
    first.length === 1 &&
    ((first[0].kind === TPercentage && first[0].percentageValue() === "0") || (first[0].kind === TDimension && first[0].dimensionValue() === "0"))
  ) {
    colorStops[0].positions = [];
  }

  const last = colorStops[colorStops.length - 1].positions;
  if (last.length === 1 && last[0].kind === TPercentage && last[0].percentageValue() === "100") {
    colorStops[colorStops.length - 1].positions = [];
  }

  return colorStops;
}

export function switchToSinglePositions(double: colorStop[]): colorStop[] {
  const single: colorStop[] = [];
  for (let j = 0; j < double.length; j++) {
    const stop = double[j].clone();
    for (let i = 0; i < stop.positions.length; i++) {
      stop.positions[i].whitespace = WhitespaceBefore;
    }
    while (stop.positions.length > 1) {
      const clone = stop.clone();
      clone.positions = stop.positions.slice(0, 1);
      clone.midpoint = new Token();
      single.push(clone);
      stop.positions = stop.positions.slice(1);
    }
    single.push(stop);
  }
  return single;
}

export function switchToDoublePositions(single: colorStop[]): colorStop[] {
  const double: colorStop[] = [];
  for (let i = 0; i < single.length; i++) {
    const stop = single[i];
    if (i + 1 < single.length && stop.positions.length === 1 && stop.midpoint.kind === TEndOfFile) {
      const next = single[i + 1];
      if (next.positions.length === 1 && stop.color.equal(next.color, null)) {
        double.push(new colorStop([stop.positions[0], next.positions[0]], stop.color, next.midpoint));
        i++;
        continue;
      }
    }
    double.push(stop);
  }
  return double;
}

// Returns [remaining, colorSpace, hueMethod, ok]
export function removeColorInterpolation(tokens: Token[]): [Token[] | null, number, number, boolean] {
  for (let i = 0; i + 1 < tokens.length; i++) {
    const in_ = tokens[i];
    if (in_.kind === TIdent && goEqualFold(in_.text, "in")) {
      const space = tokens[i + 1];
      if (space.kind === TIdent) {
        let colorSpace: number;
        let hueMethod = shorterHue;
        const start = i;
        let end = i + 2;

        // Parse the color space
        switch (goToLower(space.text)) {
          case "a98-rgb":
            colorSpace = colorSpace_a98_rgb;
            break;
          case "display-p3":
            colorSpace = colorSpace_display_p3;
            break;
          case "hsl":
            colorSpace = colorSpace_hsl;
            break;
          case "hwb":
            colorSpace = colorSpace_hwb;
            break;
          case "lab":
            colorSpace = colorSpace_lab;
            break;
          case "lch":
            colorSpace = colorSpace_lch;
            break;
          case "oklab":
            colorSpace = colorSpace_oklab;
            break;
          case "oklch":
            colorSpace = colorSpace_oklch;
            break;
          case "prophoto-rgb":
            colorSpace = colorSpace_prophoto_rgb;
            break;
          case "rec2020":
            colorSpace = colorSpace_rec2020;
            break;
          case "srgb":
            colorSpace = colorSpace_srgb;
            break;
          case "srgb-linear":
            colorSpace = colorSpace_srgb_linear;
            break;
          case "xyz":
            colorSpace = colorSpace_xyz;
            break;
          case "xyz-d50":
            colorSpace = colorSpace_xyz_d50;
            break;
          case "xyz-d65":
            colorSpace = colorSpace_xyz_d65;
            break;
          default:
            return [null, 0, 0, false];
        }

        // Parse the optional hue mode for polar color spaces
        if (colorSpaceIsPolar(colorSpace) && i + 3 < tokens.length) {
          const hue = tokens[i + 3];
          if (hue.kind === TIdent && goEqualFold(hue.text, "hue")) {
            const method = tokens[i + 2];
            if (method.kind === TIdent) {
              switch (goToLower(method.text)) {
                case "shorter":
                  hueMethod = shorterHue;
                  break;
                case "longer":
                  hueMethod = longerHue;
                  break;
                case "increasing":
                  hueMethod = increasingHue;
                  break;
                case "decreasing":
                  hueMethod = decreasingHue;
                  break;
                default:
                  return [null, 0, 0, false];
              }
              end = i + 4;
            }
          }
        }

        // Remove all parsed tokens (copies: their whitespace is changed below)
        const remaining: Token[] = [];
        for (let j = 0; j < start; j++) {
          remaining.push(tokens[j].clone());
        }
        for (let j = end; j < tokens.length; j++) {
          remaining.push(tokens[j].clone());
        }
        const n = remaining.length;
        if (n > 0) {
          remaining[0].whitespace &= ~WhitespaceBefore;
          remaining[n - 1].whitespace &= ~WhitespaceAfter;
        }
        return [remaining, colorSpace, hueMethod, true];
      }
    }
  }

  return [null, 0, 0, false];
}

export class valueWithUnit {
  declare unit: string;
  declare value: number;
  constructor(unit = "", value = 0) {
    this.unit = unit;
    this.value = value;
  }
}

export class parsedColorStop {
  // Position information (may be a sum of two different units)
  declare positionTerms: valueWithUnit[];

  // Color midpoint (a.k.a. transition hint) information
  declare midpoint: valueWithUnit | null;

  // Non-premultiplied color information in XYZ space
  declare x: number;
  declare y: number;
  declare z: number;
  declare alpha: number;

  // Non-premultiplied color information in sRGB space
  declare r: number;
  declare g: number;
  declare b: number;

  // Premultiplied color information in the interpolation color space
  declare v0: number;
  declare v1: number;
  declare v2: number;

  // True if the original color has a color space
  declare hasColorSpace: boolean;

  constructor(
    positionTerms: valueWithUnit[] = [],
    midpoint: valueWithUnit | null = null,
    x = 0,
    y = 0,
    z = 0,
    alpha = 0,
    r = 0,
    g = 0,
    b = 0,
    v0 = 0,
    v1 = 0,
    v2 = 0,
    hasColorSpace = false,
  ) {
    this.positionTerms = positionTerms;
    this.midpoint = midpoint;
    this.x = x;
    this.y = y;
    this.z = z;
    this.alpha = alpha;
    this.r = r;
    this.g = g;
    this.b = b;
    this.v0 = v0;
    this.v1 = v1;
    this.v2 = v2;
    this.hasColorSpace = hasColorSpace;
  }

  // A shallow copy (Go: "x := stop"; "positionTerms" and "midpoint" are
  // shared like Go's slice and pointer)
  clone(): parsedColorStop {
    return new parsedColorStop(
      this.positionTerms,
      this.midpoint,
      this.x,
      this.y,
      this.z,
      this.alpha,
      this.r,
      this.g,
      this.b,
      this.v0,
      this.v1,
      this.v2,
      this.hasColorSpace,
    );
  }
}

class stopInfo {
  declare fromPos: valueWithUnit;
  declare toPos: valueWithUnit;
  declare fromCount: number;
  declare toCount: number;
  constructor() {
    this.fromPos = new valueWithUnit();
    this.toPos = new valueWithUnit();
    this.fromCount = 0;
    this.toCount = 0;
  }
}

// Returns [colorStops, ok]
export function tryToParseColorStops(gradient: parsedGradient): [parsedColorStop[] | null, boolean] {
  const colorStops: parsedColorStop[] = [];

  for (let si = 0; si < gradient.colorStops.length; si++) {
    const stop = gradient.colorStops[si];
    const pc = parseColor(stop.color);
    if (!pc[1]) {
      return [null, false];
    }
    const color = pc[0];
    let r: number;
    let g: number;
    let b: number;
    if (!color.hasColorSpace) {
      r = hexR(color.hex) / 255;
      g = hexG(color.hex) / 255;
      b = hexB(color.hex) / 255;
      const lin = lin_srgb(r, g, b);
      const xyz = lin_srgb_to_xyz(lin[0], lin[1], lin[2]);
      color.x = xyz[0];
      color.y = xyz[1];
      color.z = xyz[2];
    } else {
      const lin = xyz_to_lin_srgb(color.x, color.y, color.z);
      const rgb = gam_srgb(lin[0], lin[1], lin[2]);
      r = rgb[0];
      g = rgb[1];
      b = rgb[2];
    }
    const parsedStop = new parsedColorStop([], null, color.x, color.y, color.z, hexA(color.hex) / 255, r, g, b, 0, 0, 0, color.hasColorSpace);

    for (let i = 0; i < stop.positions.length; i++) {
      const pr = tryToParseValue(stop.positions[i], gradient.kind);
      if (pr[1]) {
        parsedStop.positionTerms = [pr[0]!];
      } else {
        return [null, false];
      }

      // Expand double positions
      if (i + 1 < stop.positions.length) {
        colorStops.push(parsedStop.clone());
      }
    }

    if (stop.midpoint.kind !== TEndOfFile) {
      const mr = tryToParseValue(stop.midpoint, gradient.kind);
      if (mr[1]) {
        parsedStop.midpoint = mr[0];
      } else {
        return [null, false];
      }
    }

    colorStops.push(parsedStop);
  }

  // Automatically fill in missing positions
  if (colorStops.length > 0) {
    // Fill in missing positions for the endpoints first
    const first = colorStops[0];
    if (first.positionTerms.length === 0) {
      first.positionTerms = [new valueWithUnit("%", 0)];
    }
    const last = colorStops[colorStops.length - 1];
    if (last.positionTerms.length === 0) {
      last.positionTerms = [new valueWithUnit("%", 100)];
    }

    // Set all positions to be greater than the position before them
    for (let i = 0; i < colorStops.length; i++) {
      const stop = colorStops[i];
      let prevPosUnit = "";
      let prevPosValue = 0;
      for (let j = i - 1; j >= 0; j--) {
        const prev = colorStops[j];
        if (prev.midpoint !== null) {
          prevPosUnit = prev.midpoint.unit;
          prevPosValue = prev.midpoint.value;
          break;
        }
        if (prev.positionTerms.length === 1) {
          prevPosUnit = prev.positionTerms[0].unit;
          prevPosValue = prev.positionTerms[0].value;
          break;
        }
      }
      if (stop.positionTerms.length === 1) {
        if (prevPosUnit === stop.positionTerms[0].unit) {
          stop.positionTerms[0].value = Math.max(prevPosValue, stop.positionTerms[0].value);
        }
        prevPosUnit = stop.positionTerms[0].unit;
        prevPosValue = stop.positionTerms[0].value;
      }
      if (stop.midpoint !== null && prevPosUnit === stop.midpoint.unit) {
        stop.midpoint.value = Math.max(prevPosValue, stop.midpoint.value);
      }
    }

    // Scan over all other stops with missing positions
    const infos: stopInfo[] = new Array(colorStops.length);
    for (let i = 0; i < colorStops.length; i++) {
      infos[i] = new stopInfo();
    }
    for (let i = 0; i < colorStops.length; i++) {
      const stop = colorStops[i];
      if (stop.positionTerms.length === 1) {
        continue;
      }
      const info = infos[i];

      // Scan backward
      for (let from = i - 1; from >= 0; from--) {
        const fromStop = colorStops[from];
        info.fromCount++;
        if (fromStop.midpoint !== null) {
          info.fromPos = fromStop.midpoint;
          break;
        }
        if (fromStop.positionTerms.length === 1) {
          info.fromPos = fromStop.positionTerms[0];
          break;
        }
      }

      // Scan forward
      for (let to = i; to < colorStops.length; to++) {
        info.toCount++;
        const toStop = colorStops[to];
        if (toStop.midpoint !== null) {
          info.toPos = toStop.midpoint;
          break;
        }
        if (to + 1 < colorStops.length) {
          const toStop2 = colorStops[to + 1];
          if (toStop2.positionTerms.length === 1) {
            info.toPos = toStop2.positionTerms[0];
            break;
          }
        }
      }
    }

    // Then fill in all other missing positions
    for (let i = 0; i < colorStops.length; i++) {
      const stop = colorStops[i];
      if (stop.positionTerms.length !== 1) {
        const info = infos[i];
        const t = info.fromCount / (info.fromCount + info.toCount);
        if (info.fromPos.unit === info.toPos.unit) {
          colorStops[i].positionTerms = [new valueWithUnit(info.fromPos.unit, (info.toPos.value - info.fromPos.value) * t + info.fromPos.value)];
        } else {
          colorStops[i].positionTerms = [
            new valueWithUnit(info.fromPos.unit, (-t + 1) * info.fromPos.value),
            new valueWithUnit(info.toPos.unit, t * info.toPos.value),
          ];
        }
      }
    }

    // Midpoints are only supported if they use the same units as their neighbors
    for (let i = 0; i < colorStops.length; i++) {
      const stop = colorStops[i];
      if (stop.midpoint !== null) {
        // (Go panics with an index out of range for a midpoint on the last stop)
        if (i + 1 >= colorStops.length) goIndexOutOfRange(i + 1, colorStops.length);
        const next = colorStops[i + 1];
        if (
          stop.positionTerms.length !== 1 ||
          stop.midpoint.unit !== stop.positionTerms[0].unit ||
          next.positionTerms.length !== 1 ||
          stop.midpoint.unit !== next.positionTerms[0].unit
        ) {
          return [null, false];
        }
      }
    }
  }

  return [colorStops, true];
}

// Returns [result, success]
export function tryToParseValue(token: Token, kind: number): [valueWithUnit | null, boolean] {
  const result = new valueWithUnit();
  if (kind === conicGradient) {
    // <angle-percentage>
    switch (token.kind) {
      case TDimension: {
        const r = degreesForAngle(token);
        if (!r[1]) {
          return [null, false];
        }
        result.value = r[0] * (100.0 / 360);
        result.unit = "%";
        break;
      }

      case TPercentage: {
        const r = strconvParseFloat(token.percentageValue());
        if (!r[1]) {
          return [null, false];
        }
        result.value = r[0];
        result.unit = "%";
        break;
      }

      default:
        return [null, false];
    }
  } else {
    // <length-percentage>
    switch (token.kind) {
      case TNumber: {
        const r = strconvParseFloat(token.text);
        if (!r[1] || r[0] !== 0) {
          return [null, false];
        }
        result.value = 0;
        result.unit = "%";
        break;
      }

      case TDimension: {
        const r = strconvParseFloat(token.dimensionValue());
        if (!r[1]) {
          return [null, false];
        }
        result.value = r[0];
        result.unit = token.dimensionUnit();
        break;
      }

      case TPercentage: {
        const r = strconvParseFloat(token.percentageValue());
        if (!r[1]) {
          return [null, false];
        }
        result.value = r[0];
        result.unit = "%";
        break;
      }

      default:
        return [null, false];
    }
  }

  return [result, true];
}

export function tryToExpandGradient(
  loc: number,
  gradient: parsedGradient,
  colorStops: parsedColorStop[],
  remaining: Token[],
  colorSpace: number,
  hueMethod: number,
): boolean {
  // Convert color stops into the interpolation color space
  for (let i = 0; i < colorStops.length; i++) {
    const stop = colorStops[i];
    const v = xyz_to_colorSpace(stop.x, stop.y, stop.z, colorSpace);
    const pm = premultiply(v[0], v[1], v[2], stop.alpha, colorSpace);
    stop.v0 = pm[0];
    stop.v1 = pm[1];
    stop.v2 = pm[2];
  }

  const newColorStops: colorStop[] = [];

  const generateColorStops = (
    depth: number,
    from: parsedColorStop,
    to: parsedColorStop,
    prevX: number,
    prevY: number,
    prevZ: number,
    prevR: number,
    prevG: number,
    prevB: number,
    prevA: number,
    prevT: number,
    nextX: number,
    nextY: number,
    nextZ: number,
    nextR: number,
    nextG: number,
    nextB: number,
    nextA: number,
    nextT: number,
  ): void => {
    if (depth > 4) {
      return;
    }

    const t = (prevT + nextT) / 2;
    let positionT = t;

    // Handle midpoints (which we have already checked uses the same units)
    if (from.midpoint !== null) {
      const fromPos = from.positionTerms[0].value;
      const toPos = to.positionTerms[0].value;
      const stopPos = (toPos - fromPos) * t + fromPos;
      const H = (from.midpoint.value - fromPos) / (toPos - fromPos);
      const P = (stopPos - fromPos) / (toPos - fromPos);
      if (H <= 0) {
        positionT = 1;
      } else if (H >= 1) {
        positionT = 0;
      } else {
        positionT = goPow(P, -1 / goLog2(H));
      }
    }

    const iv = interpolateColors(from.v0, from.v1, from.v2, to.v0, to.v1, to.v2, colorSpace, hueMethod, positionT);
    const a = (to.alpha - from.alpha) * positionT + from.alpha;
    const uv = unpremultiply(iv[0], iv[1], iv[2], a, colorSpace);
    const xyz = colorSpace_to_xyz(uv[0], uv[1], uv[2], colorSpace);
    const x = xyz[0];
    const y = xyz[1];
    const z = xyz[2];

    // Stop when the color is similar enough to the sRGB midpoint
    // (Go: const epsilon = 4.0 / 255, compared with the constant epsilon*epsilon)
    const epsilonSquared = 16 / 65025;
    const lin = xyz_to_lin_srgb(x, y, z);
    const rgb = gam_srgb(lin[0], lin[1], lin[2]);
    const r = rgb[0];
    const g = rgb[1];
    const b = rgb[2];
    const dr = r * a - (prevR * prevA + nextR * nextA) / 2;
    const dg = g * a - (prevG * prevA + nextG * nextA) / 2;
    const db = b * a - (prevB * prevA + nextB * nextA) / 2;
    const d = dr * dr + dg * dg + db * db;
    if (d < epsilonSquared) {
      return;
    }

    // Recursive split before this stop
    generateColorStops(depth + 1, from, to, prevX, prevY, prevZ, prevR, prevG, prevB, prevA, prevT, x, y, z, r, g, b, a, t);

    // Generate this stop
    const color = makeColorToken(loc, x, y, z, a);
    const positionTerms = interpolatePositions(from.positionTerms, to.positionTerms, t);
    const position = makePositionToken(loc, positionTerms);
    position.whitespace = WhitespaceBefore;
    newColorStops.push(new colorStop([position], color, new Token()));

    // Recursive split after this stop
    generateColorStops(depth + 1, from, to, x, y, z, r, g, b, a, t, nextX, nextY, nextZ, nextR, nextG, nextB, nextA, nextT);
  };

  for (let i = 0; i < colorStops.length; i++) {
    const stop = colorStops[i];
    const color = makeColorToken(loc, stop.x, stop.y, stop.z, stop.alpha);
    const position = makePositionToken(loc, stop.positionTerms);
    position.whitespace = WhitespaceBefore;
    newColorStops.push(new colorStop([position], color, new Token()));

    // Generate new color stops in between as needed
    if (i + 1 < colorStops.length) {
      const next = colorStops[i + 1];
      generateColorStops(
        0,
        stop,
        next,
        stop.x,
        stop.y,
        stop.z,
        stop.r,
        stop.g,
        stop.b,
        stop.alpha,
        0,
        next.x,
        next.y,
        next.z,
        next.r,
        next.g,
        next.b,
        next.alpha,
        1,
      );
    }
  }

  gradient.leadingTokens = remaining;
  gradient.colorStops = newColorStops;
  return true;
}

export function formatFloat(value: number, decimals: number): string {
  // strings.TrimSuffix(strings.TrimRight(strconv.FormatFloat(value, 'f', decimals, 64), "0"), ".")
  const text = formatFloatFixed(value, decimals);
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 48 /* '0' */) {
    end--;
  }
  if (end > 0 && text.charCodeAt(end - 1) === 46 /* '.' */) {
    end--;
  }
  return text.slice(0, end);
}

export function makeDimensionOrPercentToken(loc: number, value: number, unit: string): Token {
  const token = new Token();
  token.loc = loc;
  token.text = formatFloat(value, 2);
  if (unit === "%") {
    token.kind = TPercentage;
  } else {
    token.kind = TDimension;
    token.unitOffset = token.text.length;
  }
  token.text += unit;
  return token;
}

export function makePositionToken(loc: number, positionTerms: valueWithUnit[]): Token {
  if (positionTerms.length === 1) {
    return makeDimensionOrPercentToken(loc, positionTerms[0].value, positionTerms[0].unit);
  }

  const children: Token[] = [];
  for (let i = 0; i < positionTerms.length; i++) {
    const term = positionTerms[i];
    if (i > 0) {
      children.push(new Token(null, "+", loc, 0, 0, TDelimPlus, WhitespaceBefore | WhitespaceAfter));
    }
    children.push(makeDimensionOrPercentToken(loc, term.value, term.unit));
  }

  return new Token(children, "calc", loc, 0, 0, TFunction, 0);
}

export function makeColorToken(loc: number, x: number, y: number, z: number, a: number): Token {
  const color = new Token();
  color.loc = loc;

  // Go: uint32(a.MulConst(255).Round().Value()). "a" is NaN for a midpoint
  // between two stops at the same position: that converts to 0 on both wasm
  // and amd64 (checked against esbuild and esbuild-wasm). Other values
  // outside the uint32 range are platform-defined (and not reachable).
  const af = goRound(a * 255);
  let alpha: number;
  if (af !== af) {
    alpha = 0;
  } else if (af >= 0 && af < 4294967296) {
    alpha = af + 0;
  } else {
    alpha = goUint32FromFloat(af); // (wasm: a saturating conversion, then the low 32 bits)
  }

  const hr = tryToConvertToHexWithoutClipping(x, y, z, alpha);
  if (hr[1]) {
    const hex = hr[0];
    color.kind = THash;
    if (alpha === 255) {
      color.text = hexString(hex >>> 8, 6);
    } else {
      color.text = hexString(hex, 8);
    }
  } else {
    const children: Token[] = [
      new Token(null, "xyz", loc, 0, 0, TIdent, WhitespaceAfter),
      new Token(null, formatFloat(x, 3), loc, 0, 0, TNumber, WhitespaceBefore | WhitespaceAfter),
      new Token(null, formatFloat(y, 3), loc, 0, 0, TNumber, WhitespaceBefore | WhitespaceAfter),
      new Token(null, formatFloat(z, 3), loc, 0, 0, TNumber, WhitespaceBefore),
    ];
    if (a < 1) {
      children.push(
        new Token(null, "/", loc, 0, 0, TDelimSlash, WhitespaceBefore | WhitespaceAfter),
        new Token(null, formatFloat(a, 3), loc, 0, 0, TNumber, WhitespaceBefore),
      );
    }
    color.kind = TFunction;
    color.text = "color";
    color.children = children;
  }
  return color;
}

export function interpolateHues(a: number, b: number, t: number, hueMethod: number): number {
  a = a / 360;
  b = b / 360;
  a = a - Math.floor(a);
  b = b - Math.floor(b);

  switch (hueMethod) {
    case shorterHue: {
      const delta = b - a;
      if (delta > 0.5) {
        a = a + 1;
      }
      if (delta < -0.5) {
        b = b + 1;
      }
      break;
    }

    case longerHue: {
      const delta = b - a;
      if (delta > 0 && delta < 0.5) {
        a = a + 1;
      }
      if (delta > -0.5 && delta <= 0) {
        b = b + 1;
      }
      break;
    }

    case increasingHue:
      if (b < a) {
        b = b + 1;
      }
      break;

    case decreasingHue:
      if (a < b) {
        a = a + 1;
      }
      break;
  }

  return ((b - a) * t + a) * 360;
}

export function interpolateColors(
  a0: number,
  a1: number,
  a2: number,
  b0: number,
  b1: number,
  b2: number,
  colorSpace: number,
  hueMethod: number,
  t: number,
): number[] {
  let v0: number;
  let v2: number;
  const v1 = (b1 - a1) * t + a1;

  switch (colorSpace) {
    case colorSpace_hsl:
    case colorSpace_hwb:
      v2 = (b2 - a2) * t + a2;
      v0 = interpolateHues(a0, b0, t, hueMethod);
      break;

    case colorSpace_lch:
    case colorSpace_oklch:
      v0 = (b0 - a0) * t + a0;
      v2 = interpolateHues(a2, b2, t, hueMethod);
      break;

    default:
      v0 = (b0 - a0) * t + a0;
      v2 = (b2 - a2) * t + a2;
  }

  return [v0, v1, v2];
}

export function interpolatePositions(a: valueWithUnit[], b: valueWithUnit[], t: number): valueWithUnit[] {
  const result: valueWithUnit[] = [];
  const findUnit = (unit: string): number => {
    for (let i = 0; i < result.length; i++) {
      if (result[i].unit === unit) {
        return i;
      }
    }
    result.push(new valueWithUnit(unit, 0));
    return result.length - 1;
  };

  // "result += a * (1 - t)"
  for (let i = 0; i < a.length; i++) {
    const term = a[i];
    const ptr = result[findUnit(term.unit)];
    ptr.value = (-t + 1) * term.value + ptr.value;
  }

  // "result += b * t"
  for (let i = 0; i < b.length; i++) {
    const term = b[i];
    const ptr = result[findUnit(term.unit)];
    ptr.value = t * term.value + ptr.value;
  }

  // Remove an extra zero value for neatness. We don't remove all
  // of them because it may be important to retain a single zero.
  if (result.length > 1) {
    for (let i = 0; i < result.length; i++) {
      if (result[i].value === 0) {
        result.splice(i, 1);
        break;
      }
    }
  }

  return result;
}

export function premultiply(v0: number, v1: number, v2: number, alpha: number, colorSpace: number): number[] {
  if (alpha < 1) {
    switch (colorSpace) {
      case colorSpace_hsl:
      case colorSpace_hwb:
        v2 = v2 * alpha;
        break;
      case colorSpace_lch:
      case colorSpace_oklch:
        v0 = v0 * alpha;
        break;
      default:
        v0 = v0 * alpha;
        v2 = v2 * alpha;
    }
    v1 = v1 * alpha;
  }
  return [v0, v1, v2];
}

export function unpremultiply(v0: number, v1: number, v2: number, alpha: number, colorSpace: number): number[] {
  if (alpha > 0 && alpha < 1) {
    switch (colorSpace) {
      case colorSpace_hsl:
      case colorSpace_hwb:
        v2 = v2 / alpha;
        break;
      case colorSpace_lch:
      case colorSpace_oklch:
        v0 = v0 / alpha;
        break;
      default:
        v0 = v0 / alpha;
        v2 = v2 / alpha;
    }
    v1 = v1 / alpha;
  }
  return [v0, v1, v2];
}

// ---------------------------------------------------------------------------
// Parser methods (mixed into css_parser.mjs's "parser" class)

export const colorMethods = {
  // Convert newer color syntax to older color syntax for older browsers
  lowerAndMinifyColor(token: Token, wouldClipColor: { value: boolean } | null): Token {
    const p: any = this;
    const text = token.text;

    switch (token.kind) {
      case THash:
        if (cssFeatureHas(p.options.unsupportedCSSFeatures, HexRGBA)) {
          switch (text.length) {
            case 4: {
              // "#1234" => "rgba(1, 2, 3, 0.004)"
              const r = parseHex(text);
              if (r[1]) {
                const hex = expandHex(r[0]);
                return p.tryToGenerateColor(token, new parsedColor(0, 0, 0, hex), null);
              }
              break;
            }

            case 8: {
              // "#12345678" => "rgba(18, 52, 86, 0.47)"
              const r = parseHex(text);
              if (r[1]) {
                return p.tryToGenerateColor(token, new parsedColor(0, 0, 0, r[0]), null);
              }
              break;
            }
          }
        }
        break;

      case TIdent:
        if (cssFeatureHas(p.options.unsupportedCSSFeatures, RebeccaPurple) && goEqualFold(text, "rebeccapurple")) {
          token = token.clone();
          token.kind = THash;
          token.text = "663399";
        }
        break;

      case TFunction:
        switch (goToLower(text)) {
          case "rgb":
          case "rgba":
          case "hsl":
          case "hsla":
            if (cssFeatureHas(p.options.unsupportedCSSFeatures, Modern_RGB_HSL)) {
              token = token.clone();
              // (Shares the caller's children array like Go's "*token.Children")
              const args = childrenOf(token);
              let removeAlpha = false;
              let addAlpha = false;

              // "hsl(1deg, 2%, 3%)" => "hsl(1, 2%, 3%)"
              if ((text === "hsl" || text === "hsla") && args.length > 0) {
                const d = degreesForAngle(args[0]);
                if (d[1]) {
                  args[0].kind = TNumber;
                  args[0].text = floatToStringForColor(d[0]);
                }
              }

              // These check for "IsNumeric" to reject "var()" since a single "var()"
              // can substitute for multiple tokens and that messes up pattern matching
              switch (args.length) {
                case 3:
                  // "rgba(1 2 3)" => "rgb(1, 2, 3)"
                  // "hsla(1 2% 3%)" => "hsl(1, 2%, 3%)"
                  if (tIsNumeric(args[0].kind) && tIsNumeric(args[1].kind) && tIsNumeric(args[2].kind)) {
                    removeAlpha = true;
                    args[0].whitespace = 0;
                    args[1].whitespace = 0;
                    const commaToken: Token = p.commaToken(token.loc);
                    token.children = [args[0].clone(), commaToken, args[1].clone(), commaToken.clone(), args[2].clone()];
                  }
                  break;

                case 5:
                  // "rgba(1, 2, 3)" => "rgb(1, 2, 3)"
                  // "hsla(1, 2%, 3%)" => "hsl(1%, 2%, 3%)"
                  if (
                    tIsNumeric(args[0].kind) &&
                    args[1].kind === TComma &&
                    tIsNumeric(args[2].kind) &&
                    args[3].kind === TComma &&
                    tIsNumeric(args[4].kind)
                  ) {
                    removeAlpha = true;
                    break;
                  }

                  // "rgb(1 2 3 / 4%)" => "rgba(1, 2, 3, 0.04)"
                  // "hsl(1 2% 3% / 4%)" => "hsla(1, 2%, 3%, 0.04)"
                  if (
                    tIsNumeric(args[0].kind) &&
                    tIsNumeric(args[1].kind) &&
                    tIsNumeric(args[2].kind) &&
                    args[3].kind === TDelimSlash &&
                    tIsNumeric(args[4].kind)
                  ) {
                    addAlpha = true;
                    args[0].whitespace = 0;
                    args[1].whitespace = 0;
                    args[2].whitespace = 0;
                    const commaToken: Token = p.commaToken(token.loc);
                    token.children = [
                      args[0].clone(),
                      commaToken,
                      args[1].clone(),
                      commaToken.clone(),
                      args[2].clone(),
                      commaToken.clone(),
                      lowerAlphaPercentageToNumber(args[4]).clone(),
                    ];
                  }
                  break;

                case 7:
                  // "rgb(1%, 2%, 3%, 4%)" => "rgba(1%, 2%, 3%, 0.04)"
                  // "hsl(1, 2%, 3%, 4%)" => "hsla(1, 2%, 3%, 0.04)"
                  if (
                    tIsNumeric(args[0].kind) &&
                    args[1].kind === TComma &&
                    tIsNumeric(args[2].kind) &&
                    args[3].kind === TComma &&
                    tIsNumeric(args[4].kind) &&
                    args[5].kind === TComma &&
                    tIsNumeric(args[6].kind)
                  ) {
                    addAlpha = true;
                    args[6] = lowerAlphaPercentageToNumber(args[6]);
                  }
                  break;
              }

              if (removeAlpha) {
                if (goEqualFold(text, "rgba")) {
                  token.text = "rgb";
                } else if (goEqualFold(text, "hsla")) {
                  token.text = "hsl";
                }
              } else if (addAlpha) {
                if (goEqualFold(text, "rgb")) {
                  token.text = "rgba";
                } else if (goEqualFold(text, "hsl")) {
                  token.text = "hsla";
                }
              }
            }
            break;

          case "hwb":
            if (cssFeatureHas(p.options.unsupportedCSSFeatures, HWB)) {
              const c = parseColor(token);
              if (c[1]) {
                return p.tryToGenerateColor(token, c[0], wouldClipColor);
              }
            }
            break;

          case "color":
          case "lab":
          case "lch":
          case "oklab":
          case "oklch":
            if (cssFeatureHas(p.options.unsupportedCSSFeatures, ColorFunctions)) {
              const c = parseColor(token);
              if (c[1]) {
                return p.tryToGenerateColor(token, c[0], wouldClipColor);
              }
            }
            break;
        }
    }

    // When minifying, try to parse the color and print it back out. This minifies
    // the color because we always print it out using the shortest encoding.
    if (p.options.minifySyntax) {
      const c = parseColor(token);
      if (c[1]) {
        token = p.tryToGenerateColor(token, c[0], wouldClipColor);
      }
    }

    return token;
  },

  tryToGenerateColor(token: Token, color: parsedColor, wouldClipColor: { value: boolean } | null): Token {
    const p: any = this;

    // Note: Do NOT remove color information from fully transparent colors.
    // Safari behaves differently than other browsers for color interpolation:
    // https://css-tricks.com/thing-know-gradients-transparent-black/

    // Attempt to convert other color spaces to sRGB, and only continue if the
    // result (rounded to the nearest byte) will be in the 0-to-1 sRGB range
    let hex: number;
    if (!color.hasColorSpace) {
      hex = color.hex;
    } else {
      const result = tryToConvertToHexWithoutClipping(color.x, color.y, color.z, color.hex);
      if (result[1]) {
        hex = result[0];
      } else if (wouldClipColor !== null) {
        wouldClipColor.value = true;
        return token;
      } else {
        const rgb = gamut_mapping_xyz_to_srgb(color.x, color.y, color.z);
        hex = packRGBA(rgb[0], rgb[1], rgb[2], color.hex);
      }
    }

    token = token.clone();
    if (hexA(hex) === 255) {
      token.children = null;
      const name = shortColorName.get(hex);
      if (name !== undefined && p.options.minifySyntax) {
        token.kind = TIdent;
        token.text = name;
      } else {
        token.kind = THash;
        hex = hex >>> 8;
        const compact = compactHex(hex);
        if (p.options.minifySyntax && hex === expandHex(compact)) {
          token.text = hexString(compact, 3);
        } else {
          token.text = hexString(hex, 6);
        }
      }
    } else if (!cssFeatureHas(p.options.unsupportedCSSFeatures, HexRGBA)) {
      token.children = null;
      token.kind = THash;
      const compact = compactHex(hex);
      if (p.options.minifySyntax && hex === expandHex(compact)) {
        token.text = hexString(compact, 4);
      } else {
        token.text = hexString(hex, 8);
      }
    } else {
      token.kind = TFunction;
      token.text = "rgba";
      const commaToken: Token = p.commaToken(token.loc);
      const index = hexA(hex) * 4;
      let alpha = alphaFractionTable.slice(index, index + 4);
      const space = alpha.indexOf(" ");
      if (space !== -1) {
        alpha = alpha.slice(0, space);
      }
      token.children = [
        new Token(null, String(hexR(hex)), token.loc, 0, 0, TNumber, 0),
        commaToken,
        new Token(null, String(hexG(hex)), token.loc, 0, 0, TNumber, 0),
        commaToken.clone(),
        new Token(null, String(hexB(hex)), token.loc, 0, 0, TNumber, 0),
        commaToken.clone(),
        new Token(null, alpha, token.loc, 0, 0, TNumber, 0),
      ];
    }

    return token;
  },

  generateGradient(token: Token, gradient: parsedGradient): Token {
    const p: any = this;
    // (Go appends copies of the tokens: clone them)
    const children: Token[] = [];
    const commaToken: Token = p.commaToken(token.loc);

    for (let i = 0; i < gradient.leadingTokens.length; i++) {
      children.push(gradient.leadingTokens[i].clone());
    }
    for (let i = 0; i < gradient.colorStops.length; i++) {
      const stop = gradient.colorStops[i];
      if (children.length > 0) {
        children.push(commaToken.clone());
      }
      const color = stop.color.clone();
      if (stop.positions.length === 0 && stop.midpoint.kind === TEndOfFile) {
        color.whitespace &= ~WhitespaceAfter;
      }
      children.push(color);
      for (let j = 0; j < stop.positions.length; j++) {
        children.push(stop.positions[j].clone());
      }
      if (stop.midpoint.kind !== TEndOfFile) {
        children.push(commaToken.clone(), stop.midpoint.clone());
      }
    }

    token = token.clone();
    token.children = children;
    return token;
  },

  lowerAndMinifyGradient(token: Token, wouldClipColor: { value: boolean } | null): Token {
    const p: any = this;
    const pg = parseGradient(token);
    if (!pg[1]) {
      return token;
    }
    const gradient = pg[0]!;

    const lowerMidpoints = cssFeatureHas(p.options.unsupportedCSSFeatures, GradientMidpoints);
    let lowerColorSpaces = cssFeatureHas(p.options.unsupportedCSSFeatures, ColorFunctions);
    const lowerInterpolation = cssFeatureHas(p.options.unsupportedCSSFeatures, GradientInterpolation);

    // Assume that if the browser doesn't support color spaces in gradients, then
    // it doesn't correctly interpolate non-sRGB colors even when a color space
    // is not specified. This is the case for Firefox 120, for example, which has
    // support for the "color()" syntax but not for color spaces in gradients.
    // There is no entry in our feature support matrix for this edge case so we
    // make this assumption instead.
    //
    // Note that this edge case means we have to _replace_ the original gradient
    // with the expanded one instead of inserting a fallback before it. Otherwise
    // Firefox 120 would use the original gradient instead of the fallback because
    // it supports the syntax, but just renders it incorrectly.
    if (lowerInterpolation) {
      lowerColorSpaces = true;
    }

    // Potentially expand the gradient to handle unsupported features
    let didExpand = false;
    if (lowerMidpoints || lowerColorSpaces || lowerInterpolation) {
      const cs = tryToParseColorStops(gradient);
      if (cs[1]) {
        const colorStops = cs[0]!;
        let hasColorSpace = false;
        let hasMidpoint = false;
        for (let i = 0; i < colorStops.length; i++) {
          const stop = colorStops[i];
          if (stop.hasColorSpace) {
            hasColorSpace = true;
          }
          if (stop.midpoint !== null) {
            hasMidpoint = true;
          }
        }
        const rc = removeColorInterpolation(gradient.leadingTokens);
        const remaining = rc[0];
        let colorSpace = rc[1];
        const hueMethod = rc[2];
        const hasInterpolation = rc[3];
        if ((hasInterpolation && lowerInterpolation) || (hasColorSpace && lowerColorSpaces) || (hasMidpoint && lowerMidpoints)) {
          if (hasInterpolation) {
            tryToExpandGradient(token.loc, gradient, colorStops, remaining!, colorSpace, hueMethod);
          } else {
            if (hasColorSpace) {
              colorSpace = colorSpace_oklab;
            } else {
              colorSpace = colorSpace_srgb;
            }
            tryToExpandGradient(token.loc, gradient, colorStops, gradient.leadingTokens, colorSpace, shorterHue);
          }
          didExpand = true;
        }
      }
    }

    // Lower all colors in the gradient stop
    for (let i = 0; i < gradient.colorStops.length; i++) {
      const stop = gradient.colorStops[i];
      stop.color = p.lowerAndMinifyColor(stop.color, wouldClipColor);
    }

    if (cssFeatureHas(p.options.unsupportedCSSFeatures, GradientDoublePosition)) {
      // Replace double positions with duplicated single positions
      for (let i = 0; i < gradient.colorStops.length; i++) {
        if (gradient.colorStops[i].positions.length > 1) {
          gradient.colorStops = switchToSinglePositions(gradient.colorStops);
          break;
        }
      }
    } else if (p.options.minifySyntax) {
      // Replace duplicated single positions with double positions
      for (let i = 0; i < gradient.colorStops.length; i++) {
        const stop = gradient.colorStops[i];
        if (i > 0 && stop.positions.length === 1) {
          const prev = gradient.colorStops[i - 1];
          if (prev.positions.length === 1 && prev.midpoint.kind === TEndOfFile && prev.color.equal(stop.color, null)) {
            gradient.colorStops = switchToDoublePositions(gradient.colorStops);
            break;
          }
        }
      }
    }

    if (p.options.minifySyntax || didExpand) {
      gradient.colorStops = removeImpliedPositions(gradient.kind, gradient.colorStops);
    }

    return p.generateGradient(token, gradient);
  },
};
