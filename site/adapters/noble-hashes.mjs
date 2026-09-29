// `@noble/hashes` is noble's package or @r1ck404/fast-noble-hashes (bundle aliases).
import { sha256, sha384, sha512 } from "@noble/hashes/sha2";
import { md5, sha1 } from "@noble/hashes/legacy";
import { hmac } from "@noble/hashes/hmac";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { scrypt } from "@noble/hashes/scrypt";
import { bytesToHex } from "@noble/hashes/utils";

export async function load() {
  return { sha256, sha384, sha512, sha1, md5, hmac, pbkdf2, scrypt, bytesToHex };
}
