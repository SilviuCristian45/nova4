import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkinPhotoPath,
  diffRemovedCheckinPhotoPaths,
  hasAnyCheckinPhoto,
  isValidCheckinPhotoPath,
  validateCheckinPhotoPaths,
} from "./checkin-photos.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const PHOTO_A = "3f2b8c1e-5a4d-4e6f-9a0b-1c2d3e4f5a6b";
const PHOTO_B = "4f2b8c1e-5a4d-4e6f-9a0b-1c2d3e4f5a6b";
const PHOTO_C = "5f2b8c1e-5a4d-4e6f-9a0b-1c2d3e4f5a6b";
const tEn = (_ro, en) => en;

test("checkinPhotoPath and isValidCheckinPhotoPath enforce user-scoped lowercase UUID jpeg paths", () => {
  const path = checkinPhotoPath(USER_ID, PHOTO_A.toUpperCase());
  assert.equal(path, `${USER_ID}/${PHOTO_A}.jpg`);
  assert.equal(isValidCheckinPhotoPath(path, USER_ID), true);

  assert.equal(isValidCheckinPhotoPath(`${OTHER_USER}/${PHOTO_A}.jpg`, USER_ID), false);
  assert.equal(isValidCheckinPhotoPath(`${USER_ID}/../${PHOTO_A}.jpg`, USER_ID), false);
  assert.equal(isValidCheckinPhotoPath(`${USER_ID}/${PHOTO_A.toUpperCase()}.jpg`, USER_ID), false);
  assert.equal(isValidCheckinPhotoPath(`${USER_ID}/${PHOTO_A}.png`, USER_ID), false);
  assert.equal(isValidCheckinPhotoPath(`${USER_ID}/not-a-uuid.jpg`, USER_ID), false);
});

test("validateCheckinPhotoPaths accepts optional empty values and rejects invalid paths", () => {
  const empty = validateCheckinPhotoPaths({}, USER_ID, tEn);
  assert.deepEqual(empty, { ok: true, paths: { front: null, back: null, side: null } });

  const partial = validateCheckinPhotoPaths(
    { front: checkinPhotoPath(USER_ID, PHOTO_A), back: null, side: "" },
    USER_ID,
    tEn,
  );
  assert.deepEqual(partial, {
    ok: true,
    paths: { front: `${USER_ID}/${PHOTO_A}.jpg`, back: null, side: null },
  });

  const invalid = validateCheckinPhotoPaths(
    { front: `${OTHER_USER}/${PHOTO_A}.jpg` },
    USER_ID,
    tEn,
  );
  assert.equal(invalid.ok, false);
});

test("diffRemovedCheckinPhotoPaths detects replaced and cleared photos without dropping kept ones", () => {
  const pathA = checkinPhotoPath(USER_ID, PHOTO_A);
  const pathB = checkinPhotoPath(USER_ID, PHOTO_B);
  const pathC = checkinPhotoPath(USER_ID, PHOTO_C);

  const removed = diffRemovedCheckinPhotoPaths(
    { front: pathA, back: pathB, side: null },
    { front: pathA, back: pathC, side: null },
  );
  assert.deepEqual(removed, [pathB]);

  const clearedAll = diffRemovedCheckinPhotoPaths(
    { front: pathA, back: pathB, side: pathC },
    { front: null, back: null, side: null },
  );
  assert.deepEqual(clearedAll, [pathA, pathB, pathC]);
});

test("hasAnyCheckinPhoto reflects presence of signed URLs", () => {
  assert.equal(hasAnyCheckinPhoto({}), false);
  assert.equal(hasAnyCheckinPhoto({ front: "https://signed.local/a.jpg" }), true);
});
