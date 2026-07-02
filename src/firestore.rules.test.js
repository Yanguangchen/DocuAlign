import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore";
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

  describe("docuAlignPublicShares (public share links)", () => {
    const SHARES = "docuAlignPublicShares";
    const TOKEN = "aB3dEfGh1JkLmNoPqRsTuVwXyZ012345";

    function sharePayload(overrides = {}) {
      return {
        reportId: "report-1",
        reportName: "rak-report",
        sourceFileName: "rak-report.xlsx",
        status: "complete",
        pdfUrl: "SampleDocuments/SampleOutput.pdf",
        publishedAt: new Date(),
        ...overrides,
      };
    }

    function seedShare() {
      return testEnvironment.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), SHARES, TOKEN), sharePayload());
      });
    }

    it("allows anyone, even unauthenticated, to get a share by its token", async () => {
      await seedShare();
      const context = testEnvironment.unauthenticatedContext();
      await assertSucceeds(getDoc(doc(context.firestore(), SHARES, TOKEN)));
    });

    it("denies listing the shares collection so tokens cannot be enumerated", async () => {
      await seedShare();
      const context = testEnvironment.unauthenticatedContext();
      await assertFails(getDocs(collection(context.firestore(), SHARES)));

      const staff = testEnvironment.authenticatedContext("staff", {
        email: "ken@rakmat.com.sg",
        email_verified: true,
      });
      await assertFails(getDocs(collection(staff.firestore(), SHARES)));
    });

    it("allows approved staff to publish a valid share", async () => {
      const context = testEnvironment.authenticatedContext("staff", {
        email: "ken@rakmat.com.sg",
        email_verified: true,
      });
      await assertSucceeds(
        setDoc(doc(context.firestore(), SHARES, TOKEN), sharePayload()),
      );
    });

    it("denies publishing for unauthenticated and non-allowlisted users", async () => {
      const anonymous = testEnvironment.unauthenticatedContext();
      await assertFails(
        setDoc(doc(anonymous.firestore(), SHARES, TOKEN), sharePayload()),
      );

      const outsider = testEnvironment.authenticatedContext("outsider", {
        email: "outside@example.com",
        email_verified: true,
      });
      await assertFails(
        setDoc(doc(outsider.firestore(), SHARES, TOKEN), sharePayload()),
      );
    });

    it("denies publishing under a malformed document token", async () => {
      const context = testEnvironment.authenticatedContext("staff", {
        email: "ken@rakmat.com.sg",
        email_verified: true,
      });
      await assertFails(
        setDoc(doc(context.firestore(), SHARES, "guessable"), sharePayload()),
      );
    });

    it("denies publishing extra fields such as staff emails", async () => {
      const context = testEnvironment.authenticatedContext("staff", {
        email: "ken@rakmat.com.sg",
        email_verified: true,
      });
      await assertFails(
        setDoc(
          doc(context.firestore(), SHARES, TOKEN),
          sharePayload({ createdBy: "staff@rakmat.com.sg" }),
        ),
      );
    });

    it("keeps published shares immutable, while staff can revoke them", async () => {
      await seedShare();
      const context = testEnvironment.authenticatedContext("staff", {
        email: "ken@rakmat.com.sg",
        email_verified: true,
      });
      await assertFails(
        updateDoc(doc(context.firestore(), SHARES, TOKEN), { status: "edited" }),
      );
      await assertSucceeds(deleteDoc(doc(context.firestore(), SHARES, TOKEN)));
    });

    it("denies revocation by unauthenticated users", async () => {
      await seedShare();
      const context = testEnvironment.unauthenticatedContext();
      await assertFails(deleteDoc(doc(context.firestore(), SHARES, TOKEN)));
    });
  });
});
