import sodium from "libsodium-wrappers-sumo";
import { FableError } from "../contracts/index.ts";

export interface EncryptedPayload {
  version: 1;
  nonce: string;
  ciphertext: string;
}
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
export async function createVaultKey() {
  await sodium.ready;
  return b64(sodium.randombytes_buf(32));
}
export async function encryptPayload(
  key: string,
  value: unknown,
  identity: string,
): Promise<EncryptedPayload> {
  await sodium.ready;
  const bytes = Buffer.from(key, "base64url");
  if (bytes.length !== 32)
    throw new FableError(
      "VALIDATION",
      "Enter the complete 43 character recovery key.",
    );
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  );
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    JSON.stringify(value),
    identity,
    null,
    nonce,
    bytes,
  );
  return { version: 1, nonce: b64(nonce), ciphertext: b64(ciphertext) };
}
export async function decryptPayload<T>(
  key: string,
  payload: EncryptedPayload,
  identity: string,
): Promise<T> {
  await sodium.ready;
  if (payload.version !== 1)
    throw new FableError(
      "UNSUPPORTED",
      "This vault uses a newer encryption format. Update Fable before syncing.",
    );
  try {
    const plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      Buffer.from(payload.ciphertext, "base64url"),
      identity,
      Buffer.from(payload.nonce, "base64url"),
      Buffer.from(key, "base64url"),
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new FableError(
      "AUTH",
      "The recovery key is incorrect, or the encrypted file was changed. No local files were replaced.",
    );
  }
}
