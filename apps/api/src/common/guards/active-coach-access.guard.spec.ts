import { BadRequestException, ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Repository } from "typeorm";
import type { EnrollmentEntity, ProfileEntity } from "../../database/entities";
import { ActiveCoachAccessGuard } from "./active-coach-access.guard";

const COACH_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => (() => undefined),
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe("ActiveCoachAccessGuard", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const guard = new ActiveCoachAccessGuard(
      { findOne: jest.fn() } as unknown as Repository<ProfileEntity>,
      { findOne: jest.fn() } as unknown as Repository<EnrollmentEntity>,
      { getAllAndOverride: jest.fn() } as unknown as Reflector,
    );

    await expect(guard.canActivate(makeContext({ params: { clientId: CLIENT_ID } }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("rejects non-coach callers with 403", async () => {
    const profilesRepo = { findOne: jest.fn().mockResolvedValue({ id: COACH_ID, role: "client" }) };
    const enrollmentsRepo = { findOne: jest.fn() };
    const guard = new ActiveCoachAccessGuard(
      profilesRepo as unknown as Repository<ProfileEntity>,
      enrollmentsRepo as unknown as Repository<EnrollmentEntity>,
      { getAllAndOverride: jest.fn() } as unknown as Reflector,
    );

    await expect(
      guard.canActivate(makeContext({ user: { userId: COACH_ID, email: "c@test.com", role: "client" }, params: { clientId: CLIENT_ID } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(enrollmentsRepo.findOne).not.toHaveBeenCalled();
  });

  it("rejects invalid clientId UUID with 400", async () => {
    const profilesRepo = { findOne: jest.fn().mockResolvedValue({ id: COACH_ID, role: "coach" }) };
    const guard = new ActiveCoachAccessGuard(
      profilesRepo as unknown as Repository<ProfileEntity>,
      { findOne: jest.fn() } as unknown as Repository<EnrollmentEntity>,
      { getAllAndOverride: jest.fn().mockReturnValue(undefined) } as unknown as Reflector,
    );

    await expect(
      guard.canActivate(makeContext({ user: { userId: COACH_ID, email: "c@test.com", role: "coach" }, params: { clientId: "not-a-uuid" } })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("enforces active enrollment and optional shareNutrition flag", async () => {
    const profilesRepo = { findOne: jest.fn().mockResolvedValue({ id: COACH_ID, role: "coach" }) };
    const enrollmentsRepo = {
      findOne: jest.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.shareNutrition === true) return null;
        return { id: "enrollment-1" };
      }),
    };
    const reflector = {
      getAllAndOverride: jest.fn().mockImplementation((key: string) => {
        if (key === "requireNutritionShare") return false;
        return undefined;
      }),
    };

    const guard = new ActiveCoachAccessGuard(
      profilesRepo as unknown as Repository<ProfileEntity>,
      enrollmentsRepo as unknown as Repository<EnrollmentEntity>,
      reflector as unknown as Reflector,
    );

    await expect(
      guard.canActivate(makeContext({ user: { userId: COACH_ID, email: "c@test.com", role: "coach" }, params: { clientId: CLIENT_ID } })),
    ).resolves.toBe(true);

    reflector.getAllAndOverride.mockImplementation((key: string) => (key === "requireNutritionShare" ? true : undefined));
    await expect(
      guard.canActivate(makeContext({ user: { userId: COACH_ID, email: "c@test.com", role: "coach" }, params: { clientId: CLIENT_ID } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
