/**
 * @file storage.rules.test.js
 * @description Guards the DocuAlign Cloud Storage allowlist against the
 * silent-upload-failure mode: a staff member who can save a report to
 * Firestore but cannot write `docuAlignReportPhotos/` produces a share that
 * shows the reference sample's photographs instead of the uploaded workbook's.
 * AGENTS.md §1a requires `isDocuAlignStaff()` in `storage.rules` to mirror
 * `isCubeSyncAllowedEmail()` in `firestore.rules`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const firestoreRules = readFileSync("firestore.rules", "utf8");
const storageRules = readFileSync("storage.rules", "utf8");

/**
 * Emails listed inside a named rules function body.
 * @param {string} source - Full rules file text.
 * @param {string} functionName - Function whose string list to extract.
 * @returns {string[]} Quoted email addresses, in file order.
 */
function emailsInFunction(source, functionName) {
  const marker = `function ${functionName}(`;
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`Rules file does not define ${functionName}()`);
  }
  const brace = source.indexOf("{", start);
  let depth = 0;
  let end = brace;
  for (let index = brace; index < source.length; index += 1) {
    const character = source.charAt(index);
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  const body = source.slice(brace, end + 1);
  return [...body.matchAll(/'([^']+@[^']+)'/g)].map((match) => match[1]);
}

/**
 * The `docuAlignReportPhotos` match block, including its nested allows.
 * @param {string} source - Full storage rules text.
 * @returns {string} The match block body.
 */
function docuAlignPhotoBlock(source) {
  const start = source.indexOf("match /docuAlignReportPhotos/{reportId}/{picture}");
  if (start < 0) {
    throw new Error("storage.rules is missing the DocuAlign photo match");
  }
  // The path itself contains `{reportId}` / `{picture}`; the match body
  // brace is the one after the picture wildcard, not those.
  const pathEnd = source.indexOf("{picture}", start);
  const brace = source.indexOf("{", pathEnd + "{picture}".length);
  if (pathEnd < 0 || brace < 0) {
    throw new Error("storage.rules DocuAlign photo match is malformed");
  }
  let depth = 0;
  let end = brace;
  for (let index = brace; index < source.length; index += 1) {
    const character = source.charAt(index);
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  return source.slice(start, end + 1);
}

describe("DocuAlign Cloud Storage rules", () => {
  const cubeSyncEmails = emailsInFunction(firestoreRules, "isCubeSyncAllowedEmail");
  const storageStaffEmails = emailsInFunction(storageRules, "isDocuAlignStaff");
  const photoBlock = docuAlignPhotoBlock(storageRules);

  it("mirrors the CubeSync staff allowlist so a save cannot outrun the photo upload", () => {
    expect(storageStaffEmails).toEqual(cubeSyncEmails);
  });

  it("includes the signed-in account that saved a report but could not upload photographs", () => {
    expect(storageStaffEmails).toContain("woonzile888@gmail.com");
    expect(cubeSyncEmails).toContain("woonzile888@gmail.com");
  });

  it("gates DocuAlign photo writes on isDocuAlignStaff, not WorkGrid isActiveUser", () => {
    expect(photoBlock).toMatch(/allow write:\s*if isDocuAlignStaff\(\)/);
    expect(photoBlock).not.toMatch(/isActiveUser/);
    expect(photoBlock).not.toMatch(/isHardcodedMaster/);
  });

  it("keeps public reads closed so the shared bucket cannot be enumerated", () => {
    expect(photoBlock).toMatch(/allow read:\s*if isDocuAlignStaff\(\)/);
    expect(photoBlock).not.toMatch(/allow read:\s*if true/);
  });
});
