import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";

const emulatorAddress = process.env.FIRESTORE_EMULATOR_HOST;
const rulesTestsRequested = process.env.RUN_FIRESTORE_RULE_TESTS === "1";

if (rulesTestsRequested && !emulatorAddress) {
  throw new Error("FIRESTORE_EMULATOR_HOST is required for npm run test:rules");
}

const describeWithEmulator = rulesTestsRequested ? describe : describe.skip;
let testEnvironment;

describeWithEmulator("DocuAlign Firestore rules", () => {
  beforeAll(async () => {
    const [host, port] = emulatorAddress.split(":");
    testEnvironment = await initializeTestEnvironment({
      projectId: "demo-docualign",
      firestore: {
        host,
        port: Number(port),
        rules: readFileSync("firestore.rules", "utf8"),
      },
    });
  });

  afterEach(async () => {
    await testEnvironment.clearFirestore();
  });

  afterAll(async () => {
    await testEnvironment.cleanup();
  });

  it("allows an approved verified CubeSync user full report CRUD access", async () => {
    const context = testEnvironment.authenticatedContext("approved-user", {
      email: "ken@rakmat.com.sg",
      email_verified: true,
    });
    const report = doc(context.firestore(), "docuAlignReports", "report-1");

    await assertSucceeds(setDoc(report, { status: "draft" }));
    await assertSucceeds(getDoc(report));
    await assertSucceeds(updateDoc(report, { status: "complete" }));
    await assertSucceeds(deleteDoc(report));
  });

  it("denies an authenticated user outside the CubeSync allowlist", async () => {
    const context = testEnvironment.authenticatedContext("outside-user", {
      email: "outside@example.com",
      email_verified: true,
    });
    const report = doc(context.firestore(), "docuAlignReports", "report-2");

    await assertFails(setDoc(report, { status: "draft" }));
    await assertFails(getDoc(report));
  });

  it("denies an unverified allowlisted email", async () => {
    const context = testEnvironment.authenticatedContext("unverified-user", {
      email: "ken@rakmat.com.sg",
      email_verified: false,
    });
    const report = doc(context.firestore(), "docuAlignReports", "report-3");

    await assertFails(setDoc(report, { status: "draft" }));
  });

  it("denies unauthenticated access", async () => {
    const context = testEnvironment.unauthenticatedContext();
    const report = doc(context.firestore(), "docuAlignReports", "report-4");

    await assertFails(setDoc(report, { status: "draft" }));
    await assertFails(getDoc(report));
  });
});
