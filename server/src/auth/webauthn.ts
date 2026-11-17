import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from "@simplewebauthn/server";

export const rpName = "TextPup";
export const rpID = process.env.RP_ID || "localhost";
export const rpOrigin = process.env.RP_ORIGIN || "http://localhost:8080";

// Ephemeral challenge cache with 5-minute TTL
interface CachedChallenge {
  challenge: string;
  userId?: string;
  expiresAt: number;
}
const challengeMap = new Map<string, CachedChallenge>();

export function storeChallenge(key: string, challenge: string, userId?: string) {
  challengeMap.set(key, {
    challenge,
    userId,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
}

export function popChallenge(key: string): CachedChallenge | null {
  const item = challengeMap.get(key);
  if (!item) return null;
  challengeMap.delete(key);
  if (item.expiresAt < Date.now()) return null;
  return item;
}

export async function getWebAuthnRegistrationOptions(
  user: { id: string; username: string },
  existingCredentials: Array<{ id: string; transports?: string | null }> = []
) {
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: Buffer.from(user.id, "utf-8"),
    userName: user.username,
    userDisplayName: user.username,
    attestationType: "none",
    excludeCredentials: existingCredentials.map((c) => ({
      id: c.id,
      transports: c.transports ? JSON.parse(c.transports) : undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  storeChallenge(user.id, options.challenge, user.id);
  return options;
}

export async function verifyWebAuthnRegistration(
  userId: string,
  response: any
): Promise<VerifiedRegistrationResponse> {
  const cached = popChallenge(userId);
  if (!cached || !cached.challenge) {
    throw new Error("WebAuthn challenge expired or not found. Please try again.");
  }

  return await verifyRegistrationResponse({
    response,
    expectedChallenge: cached.challenge,
    expectedOrigin: rpOrigin,
    expectedRPID: rpID,
  });
}

export async function getWebAuthnAuthenticationOptions(
  credentials: Array<{ id: string; transports?: string | null }> = []
) {
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: credentials.map((c) => ({
      id: c.id,
      transports: c.transports ? JSON.parse(c.transports) : undefined,
    })),
    userVerification: "preferred",
  });

  storeChallenge(options.challenge, options.challenge);
  return options;
}

export async function verifyWebAuthnAuthentication(
  response: any,
  credential: { id: string; publicKey: Buffer; counter: number }
): Promise<VerifiedAuthenticationResponse> {
  const challengeKey = response.response?.clientDataJSON
    ? Buffer.from(response.response.clientDataJSON, "base64").toString("utf-8")
    : null;

  // Search cached challenge
  let matchedChallenge: string | null = null;
  for (const [key, item] of challengeMap.entries()) {
    if (challengeKey && challengeKey.includes(item.challenge)) {
      matchedChallenge = item.challenge;
      challengeMap.delete(key);
      break;
    }
  }

  if (!matchedChallenge) {
    throw new Error("WebAuthn login challenge expired or invalid.");
  }

  return await verifyAuthenticationResponse({
    response,
    expectedChallenge: matchedChallenge,
    expectedOrigin: rpOrigin,
    expectedRPID: rpID,
    credential: {
      id: credential.id,
      publicKey: new Uint8Array(credential.publicKey),
      counter: credential.counter,
    },

  });
}
