import * as OTPAuth from "otpauth";
import crypto from "node:crypto";

/**
 * Generates a new 160-bit TOTP secret and standard otpauth:// URI.
 */
export function generateTotpSecret(username: string): { secretBase32: string; uri: string } {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: "TextPup",
    label: username,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });

  return {
    secretBase32: secret.base32,
    uri: totp.toString(),
  };
}

/**
 * Verifies a 6-digit TOTP code against the base32 secret.
 * Allows a +/- 1 step (30s) window for clock drift.
 */
export function verifyTotpCode(secretBase32: string, token: string): boolean {
  if (!token || !secretBase32) return false;
  const totp = new OTPAuth.TOTP({
    issuer: "TextPup",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });

  const delta = totp.validate({
    token: token.trim(),
    window: 1,
  });

  return delta !== null;
}

/**
 * Generates 8 single-use recovery backup codes formatted like "a1b2-c3d4".
 */
export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(4).toString("hex");
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}

/**
 * Normalizes and hashes a recovery code with SHA-256 for secure storage.
 */
export function hashRecoveryCode(code: string): string {
  const normalized = code.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/**
 * Verifies a recovery code against the stored JSON array of hashes.
 * If valid, consumes (removes) the matched code and returns updated JSON.
 */
export function verifyAndConsumeRecoveryCode(
  code: string,
  hashedCodesJson: string | null
): { valid: boolean; remainingHashedCodesJson: string | null } {
  if (!hashedCodesJson || !code) {
    return { valid: false, remainingHashedCodesJson: hashedCodesJson };
  }

  try {
    const hashes: string[] = JSON.parse(hashedCodesJson);
    const codeHash = hashRecoveryCode(code);
    const matchIdx = hashes.findIndex((h) => h === codeHash);

    if (matchIdx === -1) {
      return { valid: false, remainingHashedCodesJson: hashedCodesJson };
    }

    hashes.splice(matchIdx, 1);
    return {
      valid: true,
      remainingHashedCodesJson: JSON.stringify(hashes),
    };
  } catch {
    return { valid: false, remainingHashedCodesJson: hashedCodesJson };
  }
}
