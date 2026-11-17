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
    { name: "Phase 2: Database Schema & Crypto Vault", file: path.join(__dirname, "test-phase2.ts") },
    { name: "Phase 3: Media Processing & Carrier Compression", file: path.join(__dirname, "test-phase3.ts") },
    { name: "Phase 4: SMSGate Gateway, Webhooks & Sync Engine", file: path.join(__dirname, "test-phase4.ts") },
    { name: "Phase 5: Auth, Passkey, TOTP & Setup Wizard API", file: path.join(__dirname, "test-phase5.ts") },
    { name: "Phase 6: Application Routes, Contacts, Media & Events", file: path.join(__dirname, "test-phase6.ts") },
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

