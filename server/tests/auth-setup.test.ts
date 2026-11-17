import app from "../src/index.js";
import { initDatabase, db, sqlite } from "../src/db/client.js";
import { systemConfig, users, webauthnCredentials, sessions } from "../src/db/schema.js";
import { runtimeSetupToken } from "../src/auth/setup.js";
import * as OTPAuth from "otpauth";
import { eq } from "drizzle-orm";
import { SmsGateClient } from "../src/gateway/smsgateClient.js";

export async function runAuthSetupTests() {
  console.log("--- Starting Authentication & Setup Tests ---");

  // 1. Reset state to uninitialized for testing setup wizard
  console.log("1. Resetting database to uninitialized state...");
  initDatabase();
  db.delete(sessions).run();
  db.delete(webauthnCredentials).run();
  db.delete(users).run();
  db.delete(systemConfig).run();

  // 2. Test Setup Token Gating
  console.log("2. Testing Setup Token Bootstrap Gating...");
  // Missing token
  const resNoToken = await app.request("/api/setup/step1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "Password123!" }),
  });
  if (resNoToken.status !== 401) {
    throw new Error(`Expected 401 for missing setup token, got: ${resNoToken.status}`);
  }

  // Invalid token
  const resBadToken = await app.request("/api/setup/step1", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Setup-Token": "incorrect_setup_token_value_here",
    },
    body: JSON.stringify({ username: "admin", password: "Password123!" }),
  });
  if (resBadToken.status !== 403) {
    throw new Error(`Expected 403 for invalid setup token, got: ${resBadToken.status}`);
  }
  console.log("   Setup token security gate verified!");

  // 3. Test Step 1: Admin & Vault Creation
  console.log("3. Testing Step 1: Admin Account & Crypto Vault Creation...");
  const adminPass = "MyStrongAdminPassword2026!";
  const resStep1 = await app.request("/api/setup/step1", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Setup-Token": runtimeSetupToken,
    },
    body: JSON.stringify({ username: "admin", password: adminPass }),
  });
  if (resStep1.status !== 200) {
    throw new Error(`Step 1 failed with status ${resStep1.status}: ${await resStep1.text()}`);
  }
  const step1Data = (await resStep1.json()) as any;

  if (!step1Data.recoveryKey || !step1Data.recoveryCodes || step1Data.recoveryCodes.length !== 8) {
    throw new Error(`Step 1 did not return recovery key and 8 backup codes: ${JSON.stringify(step1Data)}`);
  }
  console.log(`   Admin created. Recovery Key: ${step1Data.recoveryKey}`);
  console.log(`   Sample backup code: ${step1Data.recoveryCodes[0]}`);

  // 4. Test Step 2: Mandatory 2FA
  console.log("4. Testing Step 2: Mandatory 2FA Enforcement...");
  // Attempt step 3 pairing BEFORE 2FA is enrolled -> should fail with 400
  const resEarlyStep3 = await app.request("/api/setup/step3/pair", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Setup-Token": runtimeSetupToken,
    },
    body: JSON.stringify({ gatewayUrl: "http://mock-gateway:3000" }),
  });
  if (resEarlyStep3.status !== 400) {
    throw new Error(`Expected 400 when attempting Step 3 before 2FA, got ${resEarlyStep3.status}`);
  }
  console.log("   Mandatory 2FA gate properly blocked premature finalization!");

  // Generate TOTP Secret
  const resTotpGen = await app.request("/api/setup/step2/totp/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Setup-Token": runtimeSetupToken,
    },
  });
  const totpData = (await resTotpGen.json()) as any;

  console.log(`   TOTP Secret generated. URI prefix: ${totpData.uri.slice(0, 35)}...`);

  // Compute live valid OTP
  const totpClient = new OTPAuth.TOTP({
    issuer: "TextPup",
    secret: OTPAuth.Secret.fromBase32(totpData.secret),
  });
  const liveToken = totpClient.generate();

  // Verify code
  const resTotpVerify = await app.request("/api/setup/step2/totp/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Setup-Token": runtimeSetupToken,
    },
    body: JSON.stringify({ secret: totpData.secret, code: liveToken }),
  });
  if (resTotpVerify.status !== 200) {
    throw new Error(`TOTP verify failed: ${await resTotpVerify.text()}`);
  }
  console.log("   TOTP 2FA enrolled and verified!");

  // 5. Test Step 3: SMSGate Pairing & Permanent Lockdown
  console.log("5. Testing Step 3: Pairing & Permanent Onboarding Lockdown...");
  const origGetDevices = SmsGateClient.prototype.getDevices;
  const origEnsureWebhooks = SmsGateClient.prototype.ensureWebhooks;
  SmsGateClient.prototype.getDevices = async () => [
    {
      id: "mock_phone",
      name: "Pixel 9 Pro",
      isOnline: true,
      sims: [
        { slotIndex: 0, simNumber: 1, carrierName: "Verizon" },
        { slotIndex: 1, simNumber: 2, carrierName: "T-Mobile" },
      ],
    },
  ];
  SmsGateClient.prototype.ensureWebhooks = async () => [];

  const resPair = await app.request("/api/setup/step3/pair", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Setup-Token": runtimeSetupToken,
    },
    body: JSON.stringify({
      gatewayUrl: "http://sms-gateway:3000",
      gatewayUser: "admin",
      gatewayPass: "gatewaySecret123",
      simProfiles: {
        1: { label: "Work (Verizon)", color: "#059669" },
        2: { label: "Personal (T-Mobile)", color: "#D97706" },
      },
    }),
  });

  SmsGateClient.prototype.getDevices = origGetDevices;
  SmsGateClient.prototype.ensureWebhooks = origEnsureWebhooks;

  if (resPair.status !== 200) {
    throw new Error(`Pairing failed: ${await resPair.text()}`);
  }
  console.log("   Step 3 pairing finalized successfully!");

  // 6. Verify Permanent 404 Lockdown on /api/setup/*
  console.log("6. Verifying Permanent 404 Lockdown of /api/setup/*...");
  const resLockedStep1 = await app.request("/api/setup/step1", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Setup-Token": runtimeSetupToken,
    },
    body: JSON.stringify({ username: "admin", password: "Password123!" }),
  });
  if (resLockedStep1.status !== 404) {
    throw new Error(`Expected 404 after setup complete, got: ${resLockedStep1.status}`);
  }

  const resLockedStep3 = await app.request("/api/setup/step3/pair", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Setup-Token": runtimeSetupToken,
    },
    body: JSON.stringify({}),
  });
  if (resLockedStep3.status !== 404) {
    throw new Error(`Expected 404 after setup complete, got: ${resLockedStep3.status}`);
  }
  console.log("   Permanent 404 setup lockout verified!");

  // 7. Test Primary Login & 2FA Flow
  console.log("7. Testing Authentication (Password + 2FA)...");
  const loginRes = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: adminPass }),
  });
  if (loginRes.status !== 200) {
    throw new Error(`Login step 1 failed: ${await loginRes.text()}`);
  }
  const loginData = (await loginRes.json()) as any;

  if (!loginData.require2fa || !loginData.tempToken) {
    throw new Error(`Expected require2fa and tempToken, got: ${JSON.stringify(loginData)}`);
  }
  console.log("   Password validated. 2FA challenge initiated.");

  // Verify 2FA code
  const secondOtpToken = totpClient.generate();
  const verifyRes = await app.request("/api/auth/2fa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tempToken: loginData.tempToken,
      totpCode: secondOtpToken,
    }),
  });
  if (verifyRes.status !== 200) {
    throw new Error(`2FA verify failed: ${await verifyRes.text()}`);
  }

  const cookieHeader = verifyRes.headers.get("set-cookie") || "";
  console.log(`   Session established! Set-Cookie: ${cookieHeader.slice(0, 40)}...`);

  // Extract session token from cookie
  const match = cookieHeader.match(/(?:__Host-sid|sid)=([^;]+)/);
  const sessionToken = match ? match[1] : null;
  if (!sessionToken) {
    throw new Error("Could not find session cookie in response!");
  }

  // 8. Test Authenticated Route: GET /api/auth/me
  console.log("8. Testing Protected Endpoint GET /api/auth/me...");
  const meRes = await app.request("/api/auth/me", {
    headers: {
      Authorization: `Bearer ${sessionToken}`,
    },
  });
  if (meRes.status !== 200) {
    throw new Error(`GET /api/auth/me failed: ${await meRes.text()}`);
  }
  const meData = (await meRes.json()) as any;
  if (meData.user.username !== "admin" || !meData.isInitialized) {
    throw new Error(`Unexpected /me response: ${JSON.stringify(meData)}`);
  }
  console.log("   Authenticated user profile & vault status verified!");

  // 9. Test Recovery Backup Code Login
  console.log("9. Testing 2FA Login with Single-Use Recovery Backup Code...");
  const loginRes2 = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: adminPass }),
  });
  const login2Data = (await loginRes2.json()) as any;
  const backupCodeToUse = step1Data.recoveryCodes[0];

  const backupVerifyRes = await app.request("/api/auth/2fa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tempToken: login2Data.tempToken,
      recoveryCode: backupCodeToUse,
    }),
  });
  if (backupVerifyRes.status !== 200) {
    throw new Error(`Recovery code verification failed: ${await backupVerifyRes.text()}`);
  }
  console.log(`   Successfully authenticated with recovery backup code ${backupCodeToUse}!`);

  // Re-using the same backup code must now fail (single use)
  const loginRes3 = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: adminPass }),
  });
  const login3Data = (await loginRes3.json()) as any;

  const reuseRes = await app.request("/api/auth/2fa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tempToken: login3Data.tempToken,
      recoveryCode: backupCodeToUse,
    }),
  });
  if (reuseRes.status === 200) {
    throw new Error("Used backup code was accepted a second time!");
  }
  console.log("   Single-use consumption of recovery code verified!");

  // 10. Test Rate Limiting
  console.log("10. Testing IP Rate Limiting & Lockout...");
  let hitRateLimit = false;
  for (let i = 0; i < 6; i++) {
    const badLoginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "198.51.100.42",
      },
      body: JSON.stringify({ username: "admin", password: "wrongpassword" }),
    });
    if (badLoginRes.status === 429) {
      hitRateLimit = true;
      break;
    }
  }
  if (!hitRateLimit) {
    throw new Error("Rate limiter did not trigger 429 after 5 failed attempts!");
  }
  console.log("   Rate limiter 429 lockout verified!");

  // 11. Test Logout
  console.log("11. Testing Logout...");
  const logoutRes = await app.request("/api/auth/logout", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
    },
  });
  if (logoutRes.status !== 200) {
    throw new Error(`Logout failed: ${await logoutRes.text()}`);
  }

  const meAfterLogout = await app.request("/api/auth/me", {
    headers: {
      Authorization: `Bearer ${sessionToken}`,
    },
  });
  if (meAfterLogout.status !== 401) {
    throw new Error(`Expected 401 after logout, got: ${meAfterLogout.status}`);
  }
  console.log("   Session successfully revoked upon logout!");

  console.log("--- All Authentication & Setup Tests Passed Successfully! ---");
}

if (process.argv[1]?.endsWith("auth-setup.test.ts") || process.argv[1]?.endsWith("auth-setup.test.js")) {
  runAuthSetupTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Test failed:", err);
      process.exit(1);
    });
}
