import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runAllTests() {
  console.log("==================================================================");
  console.log("   TEXTPUP COMPLETE AUTOMATED TEST SUITE EXECUTION");
  console.log("==================================================================");

  const testSuites = [
    { name: "Database Schema & Crypto Vault", file: path.join(__dirname, "crypto-vault.test.ts") },
    { name: "Media Processing & Carrier Compression", file: path.join(__dirname, "media-processor.test.ts") },
    { name: "Gateway Webhooks & Inbox Reconciliation", file: path.join(__dirname, "gateway-sync.test.ts") },
    { name: "Authentication, Passkeys, TOTP & Setup", file: path.join(__dirname, "auth-setup.test.ts") },
    { name: "Application Routes, Contacts, Media & Events", file: path.join(__dirname, "api-routes.test.ts") },
  ];

  for (const suite of testSuites) {
    console.log(`\n>>> Running ${suite.name}...`);
    try {
      const { stdout, stderr } = await execFileAsync("node", ["--import", "tsx", suite.file], {
        env: { ...process.env, NODE_ENV: "test" },
      });
      if (stdout) console.log(stdout.trim());
      if (stderr) console.error(stderr.trim());
      console.log(`[PASS] ${suite.name} completed successfully.`);
    } catch (err: any) {
      console.error(`[FAIL] ${suite.name} failed!`);
      if (err.stdout) console.log(err.stdout);
      if (err.stderr) console.error(err.stderr);
      throw err;
    }
  }

  console.log("\n==================================================================");
  console.log("   ALL TEST SUITES PASSED END-TO-END WITH ZERO ERRORS!");
  console.log("==================================================================");
}

runAllTests()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
