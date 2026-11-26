import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import {
  ALL_DAYS_MASK,
  EXPIRING_SOON_DAYS,
  buildGymCheckinUrl,
  calculateUnfreezeExtension,
  evaluateGymCheckin,
  extractQrToken,
  getLocalClockInTimezone,
  slugifyGymName,
  type GymCheckinMethod,
  type GymCheckinOutcome,
  type GymMemberStatus,
  type GymPaymentMethod,
  type GymPlanType,
  type GymStaffRole,
  type GymSubscriptionCandidate,
  type GymSubscriptionStatus,
} from "@replog/shared";
import {
  GymAuditLogEntity,
  GymCheckinEntity,
  GymEntity,
  GymMemberEntity,
  GymMembershipPlanEntity,
  GymPaymentEntity,
  GymStaffEntity,
  GymSubscriptionEntity,
  ProfileEntity,
  UserEntity,
} from "../../database/entities";
import { PasswordService } from "../auth/password.service";
import { NotificationsService } from "../notifications/notifications.service";
import { isSuperAdminEmail } from "../../common/auth/super-admin";
import type {
  AdminCreateGymDto,
  AdminUpdateGymDto,
  CancelSubscriptionDto,
  CreateMemberDto,
  CreatePlanDto,
  CreateSubscriptionDto,
  FreezeSubscriptionDto,
  ManualCheckinDto,
  ScanCheckinDto,
  UpdateGymSettingsDto,
  UpdateMemberDto,
  UpdatePlanDto,
  UpsertGymStaffDto,
} from "./dto/gym.dto";
import { GymSseService, type GymCheckinLiveEvent } from "./gym-sse.service";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function generateQrToken(): string {
  return randomBytes(32).toString("base64url");
}

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%";
  const buf = randomBytes(12);
  return Array.from(buf, (b) => chars[b % chars.length]).join("");
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : String(value);
}

function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

@Injectable()
export class GymService {
  private readonly logger = new Logger(GymService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    @InjectRepository(GymEntity)
    private readonly gymsRepo: Repository<GymEntity>,
    @InjectRepository(GymStaffEntity)
    private readonly staffRepo: Repository<GymStaffEntity>,
    @InjectRepository(GymMembershipPlanEntity)
    private readonly plansRepo: Repository<GymMembershipPlanEntity>,
    @InjectRepository(GymMemberEntity)
    private readonly membersRepo: Repository<GymMemberEntity>,
    @InjectRepository(GymSubscriptionEntity)
    private readonly subsRepo: Repository<GymSubscriptionEntity>,
    @InjectRepository(GymPaymentEntity)
    private readonly paymentsRepo: Repository<GymPaymentEntity>,
    @InjectRepository(GymCheckinEntity)
    private readonly checkinsRepo: Repository<GymCheckinEntity>,
    @InjectRepository(GymAuditLogEntity)
    private readonly auditRepo: Repository<GymAuditLogEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepo: Repository<UserEntity>,
    private readonly passwordService: PasswordService,
    private readonly notifications: NotificationsService,
    private readonly sse: GymSseService,
  ) {}

  private assertUuid(id: string, label = "Resource"): void {
    if (!UUID_REGEX.test(id)) {
      throw new NotFoundException(`${label} not found`);
    }
  }

  private getPublicOrigin(): string {
    const explicit = this.configService.get<string>("PUBLIC_BASE_URL")?.trim();
    if (explicit) return explicit.replace(/\/+$/, "");
    const domain = this.configService.get<string>("DOMAIN")?.trim();
    if (domain && domain !== "localhost" && !domain.startsWith("http")) {
      return `https://${domain}`;
    }
    return "";
  }

  private async writeAudit(
    gymId: string,
    actorUserId: string | null,
    action: string,
    targetType: string | null = null,
    targetId: string | null = null,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    await this.auditRepo.save(
      this.auditRepo.create({
        gymId,
        actorUserId,
        action,
        targetType,
        targetId,
        details,
      }),
    );
  }

  // =========================================================================
  // Super Admin (/api/v1/admin/gyms)
  // =========================================================================

  async listGymsAdmin() {
    const rows = (await this.dataSource.query(`
      SELECT
        g.id,
        g.slug,
        g.name,
        g.address,
        g.timezone,
        g.currency,
        g.capacity,
        g.checkin_cooldown_minutes,
        g.is_active,
        g.created_at,
        g.updated_at,
        COALESCE(m.cnt, 0) AS members_count,
        COALESCE(s.cnt, 0) AS staff_count,
        COALESCE(sub.cnt, 0) AS active_subscriptions_count,
        owners.owner_emails
      FROM public.gyms g
      LEFT JOIN (SELECT gym_id, COUNT(*) AS cnt FROM public.gym_members GROUP BY gym_id) m ON m.gym_id = g.id
      LEFT JOIN (SELECT gym_id, COUNT(*) AS cnt FROM public.gym_staff GROUP BY gym_id) s ON s.gym_id = g.id
      LEFT JOIN (
        SELECT gym_id, COUNT(*) AS cnt
        FROM public.gym_subscriptions
        WHERE status = 'active' AND ends_at >= now()
        GROUP BY gym_id
      ) sub ON sub.gym_id = g.id
      LEFT JOIN (
        SELECT gs.gym_id, array_agg(u.email ORDER BY gs.created_at ASC) AS owner_emails
        FROM public.gym_staff gs
        JOIN public.users u ON u.id = gs.user_id
        WHERE gs.role = 'owner'
        GROUP BY gs.gym_id
      ) owners ON owners.gym_id = g.id
      ORDER BY g.created_at DESC
    `)) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: String(r.id),
      slug: String(r.slug),
      name: String(r.name),
      address: (r.address as string | null) ?? null,
      timezone: String(r.timezone),
      currency: String(r.currency),
      capacity: r.capacity !== null ? Number(r.capacity) : null,
      checkinCooldownMinutes: Number(r.checkin_cooldown_minutes ?? 15),
      isActive: Boolean(r.is_active),
      createdAt: toIso(r.created_at as Date | string),
      updatedAt: toIso(r.updated_at as Date | string),
      membersCount: Number(r.members_count ?? 0),
      staffCount: Number(r.staff_count ?? 0),
      activeSubscriptionsCount: Number(r.active_subscriptions_count ?? 0),
      ownerEmails: Array.isArray(r.owner_emails) ? (r.owner_emails as string[]) : [],
    }));
  }

  async createGymAdmin(actorUserId: string, dto: AdminCreateGymDto) {
    const name = dto.name.trim();
    const baseSlug = dto.slug?.trim().toLowerCase() || slugifyGymName(name) || "gym";

    let ownerUser: UserEntity | null = null;
    if (dto.ownerUserId) {
      ownerUser = await this.usersRepo.findOne({ where: { id: dto.ownerUserId } });
      if (!ownerUser) throw new NotFoundException("Owner user not found");
    } else if (dto.ownerEmail) {
      ownerUser = await this.usersRepo
        .createQueryBuilder("u")
        .where("lower(u.email) = :email", { email: dto.ownerEmail.trim().toLowerCase() })
        .getOne();
      if (!ownerUser) throw new NotFoundException("Owner user with this email not found");
    }

    const existingSlug = await this.gymsRepo.findOne({ where: { slug: baseSlug } });
    const slug = existingSlug ? `${baseSlug}-${randomBytes(2).toString("hex")}` : baseSlug;

    const created = await this.dataSource.transaction(async (manager) => {
      const gym = manager.create(GymEntity, {
        name,
        slug,
        address: dto.address?.trim() || null,
        timezone: dto.timezone?.trim() || "Europe/Bucharest",
        currency: (dto.currency?.trim() || "RON").toUpperCase(),
        capacity: dto.capacity ?? null,
        checkinCooldownMinutes: dto.checkinCooldownMinutes ?? 15,
        qrToken: generateQrToken(),
        qrRotatedAt: new Date(),
        isActive: true,
      });
      await manager.save(gym);

      if (ownerUser) {
        await manager.save(
          manager.create(GymStaffEntity, {
            gymId: gym.id,
            userId: ownerUser.id,
            role: "owner",
          }),
        );
      }

      await manager.save(
        manager.create(GymAuditLogEntity, {
          gymId: gym.id,
          actorUserId,
          action: "gym.created",
          targetType: "gym",
          targetId: gym.id,
          details: { name: gym.name, ownerUserId: ownerUser?.id ?? null },
        }),
      );

      return gym;
    });

    return {
      id: created.id,
      slug: created.slug,
      name: created.name,
      address: created.address,
      timezone: created.timezone,
      currency: created.currency,
      capacity: created.capacity,
      checkinCooldownMinutes: created.checkinCooldownMinutes,
      isActive: created.isActive,
      createdAt: created.createdAt.toISOString(),
    };
  }

  async updateGymAdmin(actorUserId: string, gymId: string, dto: AdminUpdateGymDto) {
    this.assertUuid(gymId, "Gym");
    const gym = await this.gymsRepo.findOne({ where: { id: gymId } });
    if (!gym) throw new NotFoundException("Gym not found");

    if (dto.name !== undefined) gym.name = dto.name.trim();
    if (dto.address !== undefined) gym.address = dto.address?.trim() || null;
    if (dto.timezone !== undefined) gym.timezone = dto.timezone.trim() || "Europe/Bucharest";
    if (dto.currency !== undefined) gym.currency = dto.currency.trim().toUpperCase();
    if (dto.capacity !== undefined) gym.capacity = dto.capacity ?? null;
    if (dto.checkinCooldownMinutes !== undefined) gym.checkinCooldownMinutes = dto.checkinCooldownMinutes;
    if (dto.isActive !== undefined) gym.isActive = dto.isActive;

    await this.dataSource.transaction(async (manager) => {
      await manager.save(gym);
      if (dto.ownerUserId) {
        const ownerUser = await manager.findOne(UserEntity, { where: { id: dto.ownerUserId } });
        if (!ownerUser) throw new NotFoundException("Owner user not found");
        await manager
          .createQueryBuilder()
          .insert()
          .into(GymStaffEntity)
          .values({ gymId: gym.id, userId: ownerUser.id, role: "owner" })
          .orUpdate(["role"], ["gym_id", "user_id"])
          .execute();
      }
      await manager.save(
        manager.create(GymAuditLogEntity, {
          gymId: gym.id,
          actorUserId,
          action: "gym.admin_updated",
          targetType: "gym",
          targetId: gym.id,
          details: { ...dto },
        }),
      );
    });

    return {
      id: gym.id,
      slug: gym.slug,
      name: gym.name,
      address: gym.address,
      timezone: gym.timezone,
      currency: gym.currency,
      capacity: gym.capacity,
      checkinCooldownMinutes: gym.checkinCooldownMinutes,
      isActive: gym.isActive,
      updatedAt: gym.updatedAt.toISOString(),
    };
  }

  // =========================================================================
  // Member / Client (/api/v1/gym/my, /api/v1/gym/checkins/scan)
  // =========================================================================

  async getMyGyms(userId: string) {
    const userRow = await this.usersRepo.findOne({ where: { id: userId }, select: { id: true, email: true } });
    const isSuperAdmin = userRow
      ? isSuperAdminEmail(userRow.email, this.configService.get<string>("SUPER_ADMIN_EMAILS"))
      : false;

    const [memberRows, staffRows] = await Promise.all([
      this.dataSource.query(
        `
        SELECT
          gm.id AS member_id,
          gm.gym_id,
          gm.member_code,
          gm.status AS member_status,
          gm.joined_at,
          g.name AS gym_name,
          g.slug AS gym_slug,
          g.address AS gym_address,
          g.timezone AS gym_timezone,
          g.currency AS gym_currency,
          g.capacity AS gym_capacity,
          g.is_active AS gym_is_active,
          g.latitude AS gym_latitude,
          g.longitude AS gym_longitude,
          g.checkin_radius_meters AS gym_checkin_radius_meters,
          (
            SELECT COUNT(DISTINCT gc.user_id)
            FROM public.gym_checkins gc
            WHERE gc.gym_id = g.id
              AND gc.outcome = 'allowed'
              AND gc.checked_in_at >= now() - interval '90 minutes'
              AND gc.checked_out_at IS NULL
          ) AS active_in_gym_now
        FROM public.gym_members gm
        JOIN public.gyms g ON g.id = gm.gym_id
        WHERE gm.user_id = $1
        ORDER BY gm.joined_at DESC
        `,
        [userId],
      ) as Promise<Record<string, unknown>[]>,
      isSuperAdmin
        ? (this.dataSource.query(
            `
            SELECT
              g.id AS gym_id,
              COALESCE(gs.role, 'owner') AS role,
              g.name AS gym_name,
              g.slug AS gym_slug,
              g.address AS gym_address,
              g.timezone AS gym_timezone,
              g.currency AS gym_currency,
              g.capacity AS gym_capacity,
              g.checkin_cooldown_minutes,
              g.latitude,
              g.longitude,
              g.checkin_radius_meters,
              g.is_active
            FROM public.gyms g
            LEFT JOIN public.gym_staff gs ON gs.gym_id = g.id AND gs.user_id = $1
            ORDER BY g.name ASC
            `,
            [userId],
          ) as Promise<Record<string, unknown>[]>)
        : (this.dataSource.query(
            `
            SELECT
              gs.gym_id,
              gs.role,
              g.name AS gym_name,
              g.slug AS gym_slug,
              g.address AS gym_address,
              g.timezone AS gym_timezone,
              g.currency AS gym_currency,
              g.capacity AS gym_capacity,
              g.checkin_cooldown_minutes,
              g.latitude,
              g.longitude,
              g.checkin_radius_meters,
              g.is_active
            FROM public.gym_staff gs
            JOIN public.gyms g ON g.id = gs.gym_id
            WHERE gs.user_id = $1
            ORDER BY g.name ASC
            `,
            [userId],
          ) as Promise<Record<string, unknown>[]>),
    ]);

    const gymIds = memberRows.map((r) => String(r.gym_id));
    const [subsRows, recentCheckinsRows] =
      gymIds.length > 0
        ? await Promise.all([
            this.dataSource.query(
              `
              SELECT *
              FROM public.gym_subscriptions
              WHERE user_id = $1 AND gym_id = ANY($2::uuid[])
              ORDER BY
                CASE status
                  WHEN 'active' THEN 0
                  WHEN 'frozen' THEN 1
                  WHEN 'pending' THEN 2
                  WHEN 'exhausted' THEN 3
                  WHEN 'expired' THEN 4
                  ELSE 5
                END ASC,
                ends_at DESC
              `,
              [userId, gymIds],
            ) as Promise<Record<string, unknown>[]>,
            this.dataSource.query(
              `
              SELECT id, gym_id, checked_in_at, method, outcome, sessions_after
              FROM public.gym_checkins
              WHERE user_id = $1 AND gym_id = ANY($2::uuid[])
              ORDER BY checked_in_at DESC
              LIMIT 20
              `,
              [userId, gymIds],
            ) as Promise<Record<string, unknown>[]>,
          ])
        : [[], []];

    const nowMs = Date.now();
    const memberships = memberRows.map((m) => {
      const gymId = String(m.gym_id);
      const gymSubs = subsRows.filter((s) => String(s.gym_id) === gymId);
      const primarySub = gymSubs[0] ?? null;
      const endsAtIso = primarySub ? toIso(primarySub.ends_at as Date | string) : null;
      const daysLeft =
        endsAtIso && primarySub
          ? Math.max(0, Math.ceil((new Date(endsAtIso).getTime() - nowMs) / 86_400_000))
          : null;

      return {
        memberId: String(m.member_id),
        gymId,
        gymName: String(m.gym_name),
        gymSlug: String(m.gym_slug),
        gymAddress: (m.gym_address as string | null) ?? null,
        gymTimezone: String(m.gym_timezone),
        gymCurrency: String(m.gym_currency),
        gymCapacity: m.gym_capacity !== null ? Number(m.gym_capacity) : null,
        gymIsActive: Boolean(m.gym_is_active),
        requiresLocation: Boolean(
          m.gym_latitude !== null && m.gym_longitude !== null && m.gym_checkin_radius_meters !== null,
        ),
        activeInGymNow: Number(m.active_in_gym_now ?? 0),
        memberCode: String(m.member_code),
        memberStatus: String(m.member_status) as GymMemberStatus,
        joinedAt: toIso(m.joined_at as Date | string),
        subscription: primarySub
          ? {
              id: String(primarySub.id),
              planName: String(primarySub.plan_name_snapshot),
              planType: String(primarySub.plan_type) as GymPlanType,
              status: String(primarySub.status) as GymSubscriptionStatus,
              startsAt: toIso(primarySub.starts_at as Date | string),
              endsAt: endsAtIso,
              daysLeft,
              sessionsTotal: primarySub.sessions_total !== null ? Number(primarySub.sessions_total) : null,
              sessionsRemaining:
                primarySub.sessions_remaining !== null ? Number(primarySub.sessions_remaining) : null,
              allowedFromTime: (primarySub.allowed_from_time as string | null) ?? null,
              allowedToTime: (primarySub.allowed_to_time as string | null) ?? null,
              allowedDaysMask: Number(primarySub.allowed_days_mask ?? ALL_DAYS_MASK),
              frozenAt: toIso(primarySub.frozen_at as Date | string | null),
              frozenUntil: toIso(primarySub.frozen_until as Date | string | null),
              totalFrozenDays: Number(primarySub.total_frozen_days ?? 0),
            }
          : null,
        recentCheckins: recentCheckinsRows
          .filter((c) => String(c.gym_id) === gymId)
          .slice(0, 10)
          .map((c) => ({
            id: String(c.id),
            checkedInAt: toIso(c.checked_in_at as Date | string),
            method: String(c.method) as GymCheckinMethod,
            outcome: String(c.outcome) as GymCheckinOutcome,
            sessionsAfter: c.sessions_after !== null ? Number(c.sessions_after) : null,
          })),
      };
    });

    const staffGyms = staffRows.map((s) => ({
      gymId: String(s.gym_id),
      role: String(s.role) as GymStaffRole,
      gymName: String(s.gym_name),
      gymSlug: String(s.gym_slug),
      gymAddress: (s.gym_address as string | null) ?? null,
      gymTimezone: String(s.gym_timezone),
      gymCurrency: String(s.gym_currency),
      gymCapacity: s.gym_capacity !== null ? Number(s.gym_capacity) : null,
      checkinCooldownMinutes: Number(s.checkin_cooldown_minutes ?? 15),
      latitude: toNumberOrNull(s.latitude as string | number | null),
      longitude: toNumberOrNull(s.longitude as string | number | null),
      checkinRadiusMeters: s.checkin_radius_meters !== null ? Number(s.checkin_radius_meters) : null,
      isActive: Boolean(s.is_active),
    }));

    return { memberships, staffGyms };
  }

  async getMyCheckins(userId: string, limit = 50) {
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const rows = (await this.dataSource.query(
      `
      SELECT
        gc.id,
        gc.gym_id,
        g.name AS gym_name,
        gc.checked_in_at,
        gc.checked_out_at,
        gc.method,
        gc.outcome,
        gc.sessions_after,
        gc.override_reason,
        gs.plan_name_snapshot AS plan_name
      FROM public.gym_checkins gc
      JOIN public.gyms g ON g.id = gc.gym_id
      LEFT JOIN public.gym_subscriptions gs ON gs.id = gc.subscription_id
      WHERE gc.user_id = $1
      ORDER BY gc.checked_in_at DESC
      LIMIT $2
      `,
      [userId, take],
    )) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: String(r.id),
      gymId: String(r.gym_id),
      gymName: String(r.gym_name),
      checkedInAt: toIso(r.checked_in_at as Date | string),
      checkedOutAt: toIso(r.checked_out_at as Date | string | null),
      method: String(r.method) as GymCheckinMethod,
      outcome: String(r.outcome) as GymCheckinOutcome,
      sessionsAfter: r.sessions_after !== null ? Number(r.sessions_after) : null,
      overrideReason: (r.override_reason as string | null) ?? null,
      planName: (r.plan_name as string | null) ?? null,
    }));
  }

  async scanCheckin(userId: string, dto: ScanCheckinDto, nowOverride?: Date) {
    const token = extractQrToken(dto.qrToken);
    if (!token) {
      return {
        checkinId: null,
        gymId: null,
        gymName: null,
        checkedInAt: new Date().toISOString(),
        outcome: "denied_invalid_qr" as GymCheckinOutcome,
        memberId: null,
        memberName: null,
        memberCode: null,
        planName: null,
        planType: null,
        daysLeft: null,
        endsAt: null,
        sessionsAfter: null,
        sessionsTotal: null,
        frozenUntil: null,
        allowedFromTime: null,
        allowedToTime: null,
        recentCheckinTime: null,
        expiringSoon: false,
        gpsRejected: false,
        distanceMeters: null,
      };
    }

    const now = nowOverride ?? new Date();
    let liveEvent: GymCheckinLiveEvent | null = null;

    const response = await this.dataSource.transaction(async (manager) => {
      const gym = await manager.findOne(GymEntity, { where: { qrToken: token } });
      if (!gym) {
        return {
          checkinId: null,
          gymId: null,
          gymName: null,
          checkedInAt: now.toISOString(),
          outcome: "denied_invalid_qr" as GymCheckinOutcome,
          memberId: null,
          memberName: null,
          memberCode: null,
          planName: null,
          planType: null,
          daysLeft: null,
          endsAt: null,
          sessionsAfter: null,
          sessionsTotal: null,
          frozenUntil: null,
          allowedFromTime: null,
          allowedToTime: null,
          recentCheckinTime: null,
          expiringSoon: false,
          gpsRejected: false,
          distanceMeters: null,
        };
      }

      // Serialize concurrent scans by the same user in this gym.
      await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `gym-checkin:${gym.id}:${userId}`,
      ]);

      const userInfoRows = (await manager.query(
        `
        SELECT u.email, p.display_name
        FROM public.users u
        LEFT JOIN public.profiles p ON p.id = u.id
        WHERE u.id = $1
        LIMIT 1
        `,
        [userId],
      )) as { email: string; display_name: string | null }[];
      const memberEmail = userInfoRows[0]?.email ?? "";
      const memberName = userInfoRows[0]?.display_name?.trim() || memberEmail || "Member";

      const member = await manager.findOne(GymMemberEntity, {
        where: { gymId: gym.id, userId },
      });

      const recentRows = (await manager.query(
        `
        SELECT checked_in_at
        FROM public.gym_checkins
        WHERE gym_id = $1 AND user_id = $2 AND outcome = 'allowed'
        ORDER BY checked_in_at DESC
        LIMIT 1
        `,
        [gym.id, userId],
      )) as { checked_in_at: Date | string }[];
      const recentAllowedCheckinAt = recentRows[0] ? new Date(recentRows[0].checked_in_at) : null;

      // Row-level lock on this member's subscriptions prevents race conditions on session_pack decrement.
      const subRows = (await manager.query(
        `
        SELECT *
        FROM public.gym_subscriptions
        WHERE gym_id = $1 AND user_id = $2
        ORDER BY ends_at DESC
        FOR UPDATE
        `,
        [gym.id, userId],
      )) as Record<string, unknown>[];

      const candidates: GymSubscriptionCandidate[] = subRows.map((s) => ({
        id: String(s.id),
        planNameSnapshot: String(s.plan_name_snapshot),
        planType: String(s.plan_type) as GymPlanType,
        status: String(s.status) as GymSubscriptionStatus,
        startsAt: new Date(s.starts_at as string | Date),
        endsAt: new Date(s.ends_at as string | Date),
        sessionsTotal: s.sessions_total !== null ? Number(s.sessions_total) : null,
        sessionsRemaining: s.sessions_remaining !== null ? Number(s.sessions_remaining) : null,
        allowedFromTime: (s.allowed_from_time as string | null) ?? null,
        allowedToTime: (s.allowed_to_time as string | null) ?? null,
        allowedDaysMask: Number(s.allowed_days_mask ?? ALL_DAYS_MASK),
        frozenAt: s.frozen_at ? new Date(s.frozen_at as string | Date) : null,
        frozenUntil: s.frozen_until ? new Date(s.frozen_until as string | Date) : null,
      }));

      const clientLocation =
        typeof dto.latitude === "number" && typeof dto.longitude === "number"
          ? { latitude: dto.latitude, longitude: dto.longitude }
          : null;

      const evalResult = evaluateGymCheckin({
        now,
        gym: {
          isActive: gym.isActive,
          timezone: gym.timezone,
          checkinCooldownMinutes: gym.checkinCooldownMinutes,
          latitude: toNumberOrNull(gym.latitude),
          longitude: toNumberOrNull(gym.longitude),
          checkinRadiusMeters: gym.checkinRadiusMeters,
        },
        member: member ? { status: member.status } : null,
        recentAllowedCheckinAt,
        subscriptions: candidates,
        clientLocation,
      });

      if (evalResult.outcome === "allowed" && evalResult.subscription) {
        const sub = evalResult.subscription;
        if (sub.planType === "session_pack") {
          const nextStatus: GymSubscriptionStatus =
            (evalResult.sessionsAfter ?? 0) <= 0 ? "exhausted" : "active";
          await manager.query(
            `
            UPDATE public.gym_subscriptions
            SET sessions_remaining = $1, status = $2, updated_at = now()
            WHERE id = $3
            `,
            [evalResult.sessionsAfter, nextStatus, sub.id],
          );
        } else if (sub.status === "pending") {
          await manager.query(
            `UPDATE public.gym_subscriptions SET status = 'active', updated_at = now() WHERE id = $1`,
            [sub.id],
          );
        }
      }

      const metadata: Record<string, unknown> = {};
      if (evalResult.gpsRejected) {
        metadata.gpsRejected = true;
        if (evalResult.distanceMeters !== null && evalResult.distanceMeters !== undefined) {
          metadata.distanceMeters = evalResult.distanceMeters;
        }
      }
      if (evalResult.expiringSoon) {
        metadata.expiringSoon = true;
      }

      const checkinEntity = manager.create(GymCheckinEntity, {
        gymId: gym.id,
        userId,
        subscriptionId: evalResult.subscription?.id ?? null,
        checkedInAt: now,
        checkedOutAt: null,
        method: "qr_printed",
        outcome: evalResult.outcome,
        sessionsAfter: evalResult.sessionsAfter,
        overrideReason: null,
        verifiedByUserId: null,
        metadata,
      });
      await manager.save(checkinEntity);

      const recentCheckinTime = evalResult.recentCheckinAt
        ? getLocalClockInTimezone(evalResult.recentCheckinAt, gym.timezone).hhmm
        : null;

      liveEvent = {
        checkinId: checkinEntity.id,
        gymId: gym.id,
        checkedInAt: checkinEntity.checkedInAt.toISOString(),
        method: "qr_printed",
        outcome: evalResult.outcome,
        memberId: member?.id ?? null,
        userId,
        memberName,
        memberEmail,
        memberCode: member?.memberCode ?? null,
        planName: evalResult.subscription?.planNameSnapshot ?? null,
        planType: evalResult.subscription?.planType ?? null,
        daysLeft: evalResult.daysLeft,
        endsAt: evalResult.subscription?.endsAt.toISOString() ?? null,
        sessionsAfter: evalResult.sessionsAfter,
        sessionsTotal: evalResult.subscription?.sessionsTotal ?? null,
        expiringSoon: evalResult.expiringSoon,
        overrideReason: null,
        frozenUntil: evalResult.subscription?.frozenUntil?.toISOString() ?? null,
        allowedFromTime: evalResult.subscription?.allowedFromTime ?? null,
        allowedToTime: evalResult.subscription?.allowedToTime ?? null,
        gpsRejected: Boolean(evalResult.gpsRejected),
      };

      return {
        checkinId: checkinEntity.id,
        gymId: gym.id,
        gymName: gym.name,
        checkedInAt: checkinEntity.checkedInAt.toISOString(),
        outcome: evalResult.outcome,
        memberId: member?.id ?? null,
        memberName,
        memberCode: member?.memberCode ?? null,
        planName: evalResult.subscription?.planNameSnapshot ?? null,
        planType: evalResult.subscription?.planType ?? null,
        daysLeft: evalResult.daysLeft,
        endsAt: evalResult.subscription?.endsAt.toISOString() ?? null,
        sessionsAfter: evalResult.sessionsAfter,
        sessionsTotal: evalResult.subscription?.sessionsTotal ?? null,
        frozenUntil: evalResult.subscription?.frozenUntil?.toISOString() ?? null,
        allowedFromTime: evalResult.subscription?.allowedFromTime ?? null,
        allowedToTime: evalResult.subscription?.allowedToTime ?? null,
        recentCheckinTime,
        expiringSoon: evalResult.expiringSoon,
        gpsRejected: Boolean(evalResult.gpsRejected),
        distanceMeters: evalResult.distanceMeters ?? null,
      };
    });

    if (liveEvent) {
      this.sse.emit((liveEvent as GymCheckinLiveEvent).gymId, liveEvent);
    }

    return response;
  }

  // =========================================================================
  // Staff Dashboard: Live Check-ins & Manual Override
  // =========================================================================

  async getCheckinsDashboard(
    gymId: string,
    filters: { date?: string; outcome?: string; q?: string } = {},
  ) {
    const gym = await this.gymsRepo.findOne({ where: { id: gymId } });
    if (!gym) throw new NotFoundException("Gym not found");

    const dateStr =
      filters.date && /^\d{4}-\d{2}-\d{2}$/.test(filters.date)
        ? filters.date
        : new Date().toISOString().slice(0, 10);

    const [statsRows, itemsRows] = await Promise.all([
      this.dataSource.query(
        `
        SELECT
          (SELECT COUNT(*) FROM public.gym_checkins
           WHERE gym_id = $1 AND (checked_in_at AT TIME ZONE $2)::date = $3::date) AS today_total,
          (SELECT COUNT(*) FROM public.gym_checkins
           WHERE gym_id = $1 AND outcome = 'allowed' AND (checked_in_at AT TIME ZONE $2)::date = $3::date) AS today_allowed,
          (SELECT COUNT(*) FROM public.gym_checkins
           WHERE gym_id = $1 AND outcome <> 'allowed' AND (checked_in_at AT TIME ZONE $2)::date = $3::date) AS today_denied,
          (SELECT COUNT(DISTINCT user_id) FROM public.gym_checkins
           WHERE gym_id = $1 AND outcome = 'allowed' AND (checked_in_at AT TIME ZONE $2)::date = $3::date) AS unique_today,
          (SELECT COUNT(DISTINCT user_id) FROM public.gym_checkins
           WHERE gym_id = $1 AND outcome = 'allowed'
             AND checked_in_at >= now() - interval '90 minutes'
             AND checked_out_at IS NULL) AS in_gym_now,
          (SELECT COUNT(*) FROM public.gym_subscriptions
           WHERE gym_id = $1 AND status = 'active' AND ends_at >= now()) AS active_subscriptions,
          (SELECT COUNT(*) FROM public.gym_subscriptions
           WHERE gym_id = $1 AND status = 'active'
             AND ends_at >= now()
             AND (
               ends_at <= now() + interval '3 days'
               OR (plan_type = 'session_pack' AND COALESCE(sessions_remaining, 0) <= 2)
             )) AS expiring_soon_count
        `,
        [gymId, gym.timezone || "Europe/Bucharest", dateStr],
      ) as Promise<Record<string, unknown>[]>,
      this.dataSource.query(
        `
        SELECT
          gc.id,
          gc.gym_id,
          gc.user_id,
          gc.checked_in_at,
          gc.method,
          gc.outcome,
          gc.sessions_after,
          gc.override_reason,
          gc.metadata,
          u.email AS member_email,
          p.display_name AS member_name,
          gm.id AS member_id,
          gm.member_code,
          gs.plan_name_snapshot AS plan_name,
          gs.plan_type,
          gs.ends_at,
          gs.sessions_total,
          gs.frozen_until,
          gs.allowed_from_time,
          gs.allowed_to_time
        FROM public.gym_checkins gc
        JOIN public.users u ON u.id = gc.user_id
        LEFT JOIN public.profiles p ON p.id = u.id
        LEFT JOIN public.gym_members gm ON gm.gym_id = gc.gym_id AND gm.user_id = gc.user_id
        LEFT JOIN public.gym_subscriptions gs ON gs.id = gc.subscription_id
        WHERE gc.gym_id = $1
          AND (gc.checked_in_at AT TIME ZONE $2)::date = $3::date
        ORDER BY gc.checked_in_at DESC
        LIMIT 250
        `,
        [gymId, gym.timezone || "Europe/Bucharest", dateStr],
      ) as Promise<Record<string, unknown>[]>,
    ]);

    const s = statsRows[0] ?? {};
    const nowMs = Date.now();
    const needle = filters.q?.trim().toLowerCase() ?? "";
    const outcomeFilter = filters.outcome?.trim() || "";

    const items: GymCheckinLiveEvent[] = itemsRows
      .map((r) => {
        const endsAtIso = toIso(r.ends_at as Date | string | null);
        const daysLeft = endsAtIso
          ? Math.max(0, Math.ceil((new Date(endsAtIso).getTime() - nowMs) / 86_400_000))
          : null;
        const sessionsAfter = r.sessions_after !== null ? Number(r.sessions_after) : null;
        const meta = (r.metadata as Record<string, unknown> | null) ?? {};
        const expiringSoon =
          Boolean(meta.expiringSoon) ||
          (r.outcome === "allowed" &&
            ((daysLeft !== null && daysLeft <= EXPIRING_SOON_DAYS) ||
              (sessionsAfter !== null && sessionsAfter <= 2)));

        return {
          checkinId: String(r.id),
          gymId: String(r.gym_id),
          checkedInAt: toIso(r.checked_in_at as Date | string) ?? new Date().toISOString(),
          method: String(r.method) as GymCheckinMethod,
          outcome: String(r.outcome) as GymCheckinOutcome,
          memberId: (r.member_id as string | null) ?? null,
          userId: String(r.user_id),
          memberName: (r.member_name as string | null)?.trim() || String(r.member_email),
          memberEmail: String(r.member_email),
          memberCode: (r.member_code as string | null) ?? null,
          planName: (r.plan_name as string | null) ?? null,
          planType: (r.plan_type as GymPlanType | null) ?? null,
          daysLeft,
          endsAt: endsAtIso,
          sessionsAfter,
          sessionsTotal: r.sessions_total !== null ? Number(r.sessions_total) : null,
          expiringSoon,
          overrideReason: (r.override_reason as string | null) ?? null,
          frozenUntil: toIso(r.frozen_until as Date | string | null),
          allowedFromTime: (r.allowed_from_time as string | null) ?? null,
          allowedToTime: (r.allowed_to_time as string | null) ?? null,
          gpsRejected: Boolean(meta.gpsRejected),
        };
      })
      .filter((item) => {
        if (outcomeFilter === "allowed" && item.outcome !== "allowed") return false;
        if (outcomeFilter === "denied" && item.outcome === "allowed") return false;
        if (
          outcomeFilter &&
          outcomeFilter !== "allowed" &&
          outcomeFilter !== "denied" &&
          item.outcome !== outcomeFilter
        ) {
          return false;
        }
        if (needle) {
          const hay = `${item.memberName} ${item.memberEmail} ${item.memberCode ?? ""}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      });

    return {
      date: dateStr,
      stats: {
        todayTotal: Number(s.today_total ?? 0),
        todayAllowed: Number(s.today_allowed ?? 0),
        todayDenied: Number(s.today_denied ?? 0),
        uniqueToday: Number(s.unique_today ?? 0),
        inGymNow: Number(s.in_gym_now ?? 0),
        activeSubscriptions: Number(s.active_subscriptions ?? 0),
        expiringSoonCount: Number(s.expiring_soon_count ?? 0),
      },
      items,
    };
  }

  async manualCheckin(gymId: string, actorUserId: string, dto: ManualCheckinDto) {
    if (!dto.memberId && !dto.userId) {
      throw new BadRequestException("Either memberId or userId is required");
    }
    const reason = dto.overrideReason.trim();
    if (reason.length < 2) {
      throw new BadRequestException("Override reason is required");
    }

    let liveEvent: GymCheckinLiveEvent | null = null;

    const result = await this.dataSource.transaction(async (manager) => {
      const member = dto.memberId
        ? await manager.findOne(GymMemberEntity, { where: { id: dto.memberId, gymId } })
        : await manager.findOne(GymMemberEntity, { where: { userId: dto.userId!, gymId } });
      if (!member) {
        throw new NotFoundException("Member not found in this gym");
      }

      const userRows = (await manager.query(
        `
        SELECT u.email, p.display_name
        FROM public.users u
        LEFT JOIN public.profiles p ON p.id = u.id
        WHERE u.id = $1
        LIMIT 1
        `,
        [member.userId],
      )) as { email: string; display_name: string | null }[];
      const memberEmail = userRows[0]?.email ?? "";
      const memberName = userRows[0]?.display_name?.trim() || memberEmail || "Member";

      const activeSubRows = (await manager.query(
        `
        SELECT *
        FROM public.gym_subscriptions
        WHERE gym_id = $1 AND user_id = $2 AND status = 'active' AND ends_at >= now()
        ORDER BY ends_at ASC
        LIMIT 1
        FOR UPDATE
        `,
        [gymId, member.userId],
      )) as Record<string, unknown>[];
      const activeSub = activeSubRows[0] ?? null;

      let sessionsAfter: number | null =
        activeSub && activeSub.sessions_remaining !== null
          ? Number(activeSub.sessions_remaining)
          : null;

      if (
        dto.deductSession &&
        activeSub &&
        activeSub.plan_type === "session_pack" &&
        sessionsAfter !== null &&
        sessionsAfter > 0
      ) {
        sessionsAfter = sessionsAfter - 1;
        await manager.query(
          `
          UPDATE public.gym_subscriptions
          SET sessions_remaining = $1, status = $2, updated_at = now()
          WHERE id = $3
          `,
          [sessionsAfter, sessionsAfter === 0 ? "exhausted" : "active", activeSub.id],
        );
      }

      const checkin = manager.create(GymCheckinEntity, {
        gymId,
        userId: member.userId,
        subscriptionId: activeSub ? String(activeSub.id) : null,
        checkedInAt: new Date(),
        checkedOutAt: null,
        method: "manual_override",
        outcome: "allowed",
        sessionsAfter,
        overrideReason: reason,
        verifiedByUserId: actorUserId,
        metadata: { deductSession: Boolean(dto.deductSession) },
      });
      await manager.save(checkin);

      await manager.save(
        manager.create(GymAuditLogEntity, {
          gymId,
          actorUserId,
          action: "checkin.manual_override",
          targetType: "gym_checkin",
          targetId: checkin.id,
          details: {
            memberId: member.id,
            userId: member.userId,
            overrideReason: reason,
            deductSession: Boolean(dto.deductSession),
          },
        }),
      );

      const endsAtIso = activeSub ? toIso(activeSub.ends_at as Date | string) : null;
      const daysLeft = endsAtIso
        ? Math.max(0, Math.ceil((new Date(endsAtIso).getTime() - Date.now()) / 86_400_000))
        : null;

      liveEvent = {
        checkinId: checkin.id,
        gymId,
        checkedInAt: checkin.checkedInAt.toISOString(),
        method: "manual_override",
        outcome: "allowed",
        memberId: member.id,
        userId: member.userId,
        memberName,
        memberEmail,
        memberCode: member.memberCode,
        planName: activeSub ? String(activeSub.plan_name_snapshot) : null,
        planType: activeSub ? (String(activeSub.plan_type) as GymPlanType) : null,
        daysLeft,
        endsAt: endsAtIso,
        sessionsAfter,
        sessionsTotal:
          activeSub && activeSub.sessions_total !== null ? Number(activeSub.sessions_total) : null,
        expiringSoon: false,
        overrideReason: reason,
        frozenUntil: null,
        allowedFromTime: null,
        allowedToTime: null,
        gpsRejected: false,
      };

      return liveEvent;
    });

    if (liveEvent) {
      this.sse.emit(gymId, liveEvent);
    }

    return result;
  }

  // =========================================================================
  // QR Poster & Gym Settings & Staff
  // =========================================================================

  async getQrInfo(gymId: string) {
    const gym = await this.gymsRepo.findOne({ where: { id: gymId } });
    if (!gym) throw new NotFoundException("Gym not found");
    const origin = this.getPublicOrigin();
    return {
      gymId: gym.id,
      gymName: gym.name,
      gymAddress: gym.address,
      qrToken: gym.qrToken,
      checkinPath: buildGymCheckinUrl("", gym.qrToken),
      checkinUrl: buildGymCheckinUrl(origin, gym.qrToken),
      qrRotatedAt: gym.qrRotatedAt.toISOString(),
    };
  }

  async rotateQr(gymId: string, actorUserId: string) {
    const gym = await this.gymsRepo.findOne({ where: { id: gymId } });
    if (!gym) throw new NotFoundException("Gym not found");

    gym.qrToken = generateQrToken();
    gym.qrRotatedAt = new Date();
    await this.gymsRepo.save(gym);

    await this.writeAudit(gymId, actorUserId, "qr.rotated", "gym", gymId, {
      qrRotatedAt: gym.qrRotatedAt.toISOString(),
    });

    return this.getQrInfo(gymId);
  }

  async updateSettings(gymId: string, actorUserId: string, dto: UpdateGymSettingsDto) {
    const gym = await this.gymsRepo.findOne({ where: { id: gymId } });
    if (!gym) throw new NotFoundException("Gym not found");

    if (dto.name !== undefined) gym.name = dto.name.trim();
    if (dto.address !== undefined) gym.address = dto.address?.trim() || null;
    if (dto.timezone !== undefined) gym.timezone = dto.timezone.trim() || "Europe/Bucharest";
    if (dto.currency !== undefined) gym.currency = dto.currency.trim().toUpperCase();
    if (dto.checkinCooldownMinutes !== undefined) {
      gym.checkinCooldownMinutes = dto.checkinCooldownMinutes;
    }
    if (dto.capacity !== undefined) gym.capacity = dto.capacity ?? null;
    if (dto.latitude !== undefined) {
      gym.latitude = dto.latitude === null ? null : dto.latitude.toFixed(6);
    }
    if (dto.longitude !== undefined) {
      gym.longitude = dto.longitude === null ? null : dto.longitude.toFixed(6);
    }
    if (dto.checkinRadiusMeters !== undefined) {
      gym.checkinRadiusMeters = dto.checkinRadiusMeters ?? null;
    }

    await this.gymsRepo.save(gym);
    await this.writeAudit(gymId, actorUserId, "gym.settings_updated", "gym", gymId, { ...dto });

    return {
      gymId: gym.id,
      gymName: gym.name,
      gymSlug: gym.slug,
      gymAddress: gym.address,
      gymTimezone: gym.timezone,
      gymCurrency: gym.currency,
      gymCapacity: gym.capacity,
      checkinCooldownMinutes: gym.checkinCooldownMinutes,
      latitude: toNumberOrNull(gym.latitude),
      longitude: toNumberOrNull(gym.longitude),
      checkinRadiusMeters: gym.checkinRadiusMeters,
      isActive: gym.isActive,
    };
  }

  async listStaff(gymId: string) {
    const rows = (await this.dataSource.query(
      `
      SELECT gs.gym_id, gs.user_id, gs.role, gs.created_at, u.email, p.display_name
      FROM public.gym_staff gs
      JOIN public.users u ON u.id = gs.user_id
      LEFT JOIN public.profiles p ON p.id = u.id
      WHERE gs.gym_id = $1
      ORDER BY
        CASE gs.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END ASC,
        gs.created_at ASC
      `,
      [gymId],
    )) as Record<string, unknown>[];

    return rows.map((r) => ({
      gymId: String(r.gym_id),
      userId: String(r.user_id),
      role: String(r.role) as GymStaffRole,
      email: String(r.email),
      displayName: (r.display_name as string | null) ?? null,
      createdAt: toIso(r.created_at as Date | string),
    }));
  }

  async upsertStaff(gymId: string, actorUserId: string, dto: UpsertGymStaffDto) {
    if (!dto.userId && !dto.email) {
      throw new BadRequestException("Provide userId or email");
    }

    const user = dto.userId
      ? await this.usersRepo.findOne({ where: { id: dto.userId } })
      : await this.usersRepo
          .createQueryBuilder("u")
          .where("lower(u.email) = :email", { email: dto.email!.trim().toLowerCase() })
          .getOne();

    if (!user) {
      throw new NotFoundException("User account not found");
    }

    await this.staffRepo
      .createQueryBuilder()
      .insert()
      .into(GymStaffEntity)
      .values({ gymId, userId: user.id, role: dto.role })
      .orUpdate(["role"], ["gym_id", "user_id"])
      .execute();

    await this.writeAudit(gymId, actorUserId, "staff.upserted", "user", user.id, {
      email: user.email,
      role: dto.role,
    });

    return this.listStaff(gymId);
  }

  async removeStaff(gymId: string, actorUserId: string, targetUserId: string) {
    this.assertUuid(targetUserId, "User");
    const existing = await this.staffRepo.findOne({ where: { gymId, userId: targetUserId } });
    if (!existing) throw new NotFoundException("Staff member not found");

    if (existing.role === "owner") {
      const ownersCount = await this.staffRepo.count({ where: { gymId, role: "owner" } });
      if (ownersCount <= 1) {
        throw new BadRequestException("Cannot remove the last owner of the gym");
      }
    }

    await this.staffRepo.delete({ gymId, userId: targetUserId });
    await this.writeAudit(gymId, actorUserId, "staff.removed", "user", targetUserId, {
      previousRole: existing.role,
    });

    return { removed: true };
  }

  // =========================================================================
  // Membership Plans
  // =========================================================================

  private mapPlan(plan: GymMembershipPlanEntity) {
    return {
      id: plan.id,
      gymId: plan.gymId,
      name: plan.name,
      description: plan.description,
      planType: plan.planType,
      durationDays: plan.durationDays,
      sessionCount: plan.sessionCount,
      priceCents: plan.priceCents,
      currency: plan.currency,
      allowedFromTime: plan.allowedFromTime ? plan.allowedFromTime.slice(0, 5) : null,
      allowedToTime: plan.allowedToTime ? plan.allowedToTime.slice(0, 5) : null,
      allowedDaysMask: plan.allowedDaysMask,
      maxFreezeDays: plan.maxFreezeDays,
      isActive: plan.isActive,
      position: plan.position,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    };
  }

  async listPlans(gymId: string) {
    const plans = await this.plansRepo.find({
      where: { gymId },
      order: { position: "ASC", createdAt: "ASC" },
    });
    return plans.map((p) => this.mapPlan(p));
  }

  async createPlan(gymId: string, actorUserId: string, dto: CreatePlanDto) {
    const gym = await this.gymsRepo.findOne({ where: { id: gymId } });
    if (!gym) throw new NotFoundException("Gym not found");

    if (dto.planType === "session_pack" && (!dto.sessionCount || dto.sessionCount < 1)) {
      throw new BadRequestException("sessionCount is required for session_pack plans");
    }

    const plan = this.plansRepo.create({
      gymId,
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      planType: dto.planType,
      durationDays: dto.durationDays,
      sessionCount: dto.planType === "session_pack" ? dto.sessionCount ?? 10 : null,
      priceCents: dto.priceCents,
      currency: (dto.currency?.trim() || gym.currency || "RON").toUpperCase(),
      allowedFromTime: dto.allowedFromTime || null,
      allowedToTime: dto.allowedToTime || null,
      allowedDaysMask: dto.allowedDaysMask ?? ALL_DAYS_MASK,
      maxFreezeDays: dto.maxFreezeDays ?? 0,
      isActive: dto.isActive ?? true,
      position: dto.position ?? 1,
    });
    await this.plansRepo.save(plan);

    await this.writeAudit(gymId, actorUserId, "plan.created", "gym_plan", plan.id, {
      name: plan.name,
      planType: plan.planType,
      priceCents: plan.priceCents,
    });

    return this.mapPlan(plan);
  }

  async updatePlan(gymId: string, actorUserId: string, planId: string, dto: UpdatePlanDto) {
    this.assertUuid(planId, "Plan");
    const plan = await this.plansRepo.findOne({ where: { id: planId, gymId } });
    if (!plan) throw new NotFoundException("Membership plan not found");

    if (dto.name !== undefined) plan.name = dto.name.trim();
    if (dto.description !== undefined) plan.description = dto.description?.trim() || null;
    if (dto.planType !== undefined) plan.planType = dto.planType;
    if (dto.durationDays !== undefined) plan.durationDays = dto.durationDays;
    if (dto.sessionCount !== undefined) {
      plan.sessionCount = plan.planType === "session_pack" ? dto.sessionCount : null;
    }
    if (plan.planType === "session_pack" && (!plan.sessionCount || plan.sessionCount < 1)) {
      throw new BadRequestException("sessionCount is required for session_pack plans");
    }
    if (plan.planType === "time_based") {
      plan.sessionCount = null;
    }
    if (dto.priceCents !== undefined) plan.priceCents = dto.priceCents;
    if (dto.currency !== undefined) plan.currency = dto.currency.trim().toUpperCase();
    if (dto.allowedFromTime !== undefined) plan.allowedFromTime = dto.allowedFromTime || null;
    if (dto.allowedToTime !== undefined) plan.allowedToTime = dto.allowedToTime || null;
    if (dto.allowedDaysMask !== undefined) plan.allowedDaysMask = dto.allowedDaysMask;
    if (dto.maxFreezeDays !== undefined) plan.maxFreezeDays = dto.maxFreezeDays;
    if (dto.isActive !== undefined) plan.isActive = dto.isActive;
    if (dto.position !== undefined) plan.position = dto.position;

    await this.plansRepo.save(plan);
    await this.writeAudit(gymId, actorUserId, "plan.updated", "gym_plan", plan.id, { ...dto });

    return this.mapPlan(plan);
  }

  // =========================================================================
  // Members
  // =========================================================================

  async listMembers(gymId: string, q?: string) {
    const rows = (await this.dataSource.query(
      `
      SELECT
        gm.id,
        gm.gym_id,
        gm.user_id,
        gm.member_code,
        gm.phone,
        gm.emergency_contact,
        gm.notes,
        gm.status,
        gm.joined_at,
        u.email,
        p.display_name,
        (
          SELECT MAX(gc.checked_in_at)
          FROM public.gym_checkins gc
          WHERE gc.gym_id = gm.gym_id AND gc.user_id = gm.user_id AND gc.outcome = 'allowed'
        ) AS last_checkin_at
      FROM public.gym_members gm
      JOIN public.users u ON u.id = gm.user_id
      LEFT JOIN public.profiles p ON p.id = u.id
      WHERE gm.gym_id = $1
      ORDER BY gm.joined_at DESC
      `,
      [gymId],
    )) as Record<string, unknown>[];

    const subRows = (await this.dataSource.query(
      `
      SELECT *
      FROM public.gym_subscriptions
      WHERE gym_id = $1
      ORDER BY
        CASE status
          WHEN 'active' THEN 0
          WHEN 'frozen' THEN 1
          WHEN 'pending' THEN 2
          WHEN 'exhausted' THEN 3
          WHEN 'expired' THEN 4
          ELSE 5
        END ASC,
        ends_at DESC
      `,
      [gymId],
    )) as Record<string, unknown>[];

    const subsByMember = new Map<string, Record<string, unknown>[]>();
    for (const s of subRows) {
      const mId = String(s.member_id);
      const list = subsByMember.get(mId) ?? [];
      list.push(s);
      subsByMember.set(mId, list);
    }

    const needle = q?.trim().toLowerCase() ?? "";
    const nowMs = Date.now();

    return rows
      .map((r) => {
        const id = String(r.id);
        const memberSubs = (subsByMember.get(id) ?? []).map((s) => {
          const endsAtIso = toIso(s.ends_at as Date | string) ?? "";
          const daysLeft = endsAtIso
            ? Math.max(0, Math.ceil((new Date(endsAtIso).getTime() - nowMs) / 86_400_000))
            : 0;
          return {
            id: String(s.id),
            planId: (s.plan_id as string | null) ?? null,
            planName: String(s.plan_name_snapshot),
            planType: String(s.plan_type) as GymPlanType,
            status: String(s.status) as GymSubscriptionStatus,
            startsAt: toIso(s.starts_at as Date | string),
            endsAt: endsAtIso,
            daysLeft,
            sessionsTotal: s.sessions_total !== null ? Number(s.sessions_total) : null,
            sessionsRemaining: s.sessions_remaining !== null ? Number(s.sessions_remaining) : null,
            allowedFromTime: s.allowed_from_time ? String(s.allowed_from_time).slice(0, 5) : null,
            allowedToTime: s.allowed_to_time ? String(s.allowed_to_time).slice(0, 5) : null,
            allowedDaysMask: Number(s.allowed_days_mask ?? ALL_DAYS_MASK),
            maxFreezeDays: Number(s.max_freeze_days ?? 0),
            frozenAt: toIso(s.frozen_at as Date | string | null),
            frozenUntil: toIso(s.frozen_until as Date | string | null),
            totalFrozenDays: Number(s.total_frozen_days ?? 0),
          };
        });

        return {
          id,
          gymId: String(r.gym_id),
          userId: String(r.user_id),
          email: String(r.email),
          displayName: (r.display_name as string | null) ?? null,
          memberCode: String(r.member_code),
          phone: (r.phone as string | null) ?? null,
          emergencyContact: (r.emergency_contact as string | null) ?? null,
          notes: (r.notes as string | null) ?? null,
          status: String(r.status) as GymMemberStatus,
          joinedAt: toIso(r.joined_at as Date | string),
          lastCheckinAt: toIso(r.last_checkin_at as Date | string | null),
          activeSubscription: memberSubs[0] ?? null,
          subscriptions: memberSubs.slice(0, 5),
        };
      })
      .filter((m) => {
        if (!needle) return true;
        const hay = `${m.displayName ?? ""} ${m.email} ${m.memberCode} ${m.phone ?? ""}`.toLowerCase();
        return hay.includes(needle);
      });
  }

  async createMember(gymId: string, actorUserId: string, dto: CreateMemberDto) {
    const email = dto.email.trim().toLowerCase();
    let createdNewAccount = false;
    let generatedPassword: string | null = null;

    const result = await this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `gym-member-create:${gymId}`,
      ]);

      let user = await manager
        .createQueryBuilder(UserEntity, "u")
        .where("lower(u.email) = :email", { email })
        .getOne();

      if (!user) {
        createdNewAccount = true;
        const plainPassword = dto.password?.trim() || generateTempPassword();
        if (!dto.password) {
          generatedPassword = plainPassword;
        }
        const passwordHash = await this.passwordService.hash(plainPassword);
        user = manager.create(UserEntity, {
          email,
          passwordHash,
          emailVerifiedAt: new Date(),
          disabledAt: null,
        });
        await manager.save(user);

        const profile = manager.create(ProfileEntity, {
          id: user.id,
          role: "client",
          displayName: dto.displayName?.trim() || null,
          weightUnit: "kg",
          dailyStepsGoal: 10000,
          goalKgPerWeek: "0",
        });
        await manager.save(profile);
      } else if (dto.displayName?.trim()) {
        const existingProfile = await manager.findOne(ProfileEntity, { where: { id: user.id } });
        if (existingProfile && !existingProfile.displayName) {
          existingProfile.displayName = dto.displayName.trim();
          await manager.save(existingProfile);
        }
      }

      const existingMember = await manager.findOne(GymMemberEntity, {
        where: { gymId, userId: user.id },
      });
      if (existingMember) {
        throw new ConflictException("User is already a member of this gym");
      }

      let memberCode = dto.memberCode?.trim().toUpperCase();
      if (!memberCode) {
        const countRows = (await manager.query(
          `SELECT COUNT(*) AS cnt FROM public.gym_members WHERE gym_id = $1`,
          [gymId],
        )) as { cnt: string | number }[];
        let seq = Number(countRows[0]?.cnt ?? 0) + 1;
        memberCode = `MEM-${String(seq).padStart(4, "0")}`;
        while (await manager.findOne(GymMemberEntity, { where: { gymId, memberCode } })) {
          seq++;
          memberCode = `MEM-${String(seq).padStart(4, "0")}`;
        }
      } else {
        const dupCode = await manager.findOne(GymMemberEntity, { where: { gymId, memberCode } });
        if (dupCode) {
          throw new ConflictException("Member code already exists in this gym");
        }
      }

      const member = manager.create(GymMemberEntity, {
        gymId,
        userId: user.id,
        memberCode,
        phone: dto.phone?.trim() || null,
        emergencyContact: dto.emergencyContact?.trim() || null,
        notes: dto.notes?.trim() || null,
        status: "active",
      });
      await manager.save(member);

      await manager.save(
        manager.create(GymAuditLogEntity, {
          gymId,
          actorUserId,
          action: "member.enrolled",
          targetType: "gym_member",
          targetId: member.id,
          details: { email, memberCode, createdNewAccount },
        }),
      );

      const profile = await manager.findOne(ProfileEntity, { where: { id: user.id } });
      return {
        id: member.id,
        gymId: member.gymId,
        userId: member.userId,
        email: user.email,
        displayName: profile?.displayName ?? null,
        memberCode: member.memberCode,
        phone: member.phone,
        emergencyContact: member.emergencyContact,
        notes: member.notes,
        status: member.status,
        joinedAt: member.joinedAt.toISOString(),
        createdNewAccount,
        generatedPassword,
      };
    });

    return result;
  }

  async updateMember(gymId: string, actorUserId: string, memberId: string, dto: UpdateMemberDto) {
    this.assertUuid(memberId, "Member");
    const member = await this.membersRepo.findOne({ where: { id: memberId, gymId } });
    if (!member) throw new NotFoundException("Member not found");

    if (dto.phone !== undefined) member.phone = dto.phone?.trim() || null;
    if (dto.emergencyContact !== undefined) member.emergencyContact = dto.emergencyContact?.trim() || null;
    if (dto.notes !== undefined) member.notes = dto.notes?.trim() || null;
    if (dto.status !== undefined) member.status = dto.status;

    await this.membersRepo.save(member);
    await this.writeAudit(gymId, actorUserId, "member.updated", "gym_member", member.id, { ...dto });

    return {
      id: member.id,
      gymId: member.gymId,
      userId: member.userId,
      memberCode: member.memberCode,
      phone: member.phone,
      emergencyContact: member.emergencyContact,
      notes: member.notes,
      status: member.status,
      joinedAt: member.joinedAt.toISOString(),
    };
  }

  // =========================================================================
  // Subscriptions & Payments
  // =========================================================================

  async createSubscription(gymId: string, actorUserId: string, dto: CreateSubscriptionDto) {
    return this.dataSource.transaction(async (manager) => {
      const member = await manager.findOne(GymMemberEntity, {
        where: { id: dto.memberId, gymId },
      });
      if (!member) throw new NotFoundException("Member not found in this gym");

      const plan = await manager.findOne(GymMembershipPlanEntity, {
        where: { id: dto.planId, gymId },
      });
      if (!plan) throw new NotFoundException("Membership plan not found in this gym");

      const now = new Date();
      const startsAt = dto.startsAt ? new Date(dto.startsAt) : now;
      if (!Number.isFinite(startsAt.getTime())) {
        throw new BadRequestException("Invalid startsAt timestamp");
      }
      const endsAt = new Date(startsAt.getTime() + plan.durationDays * 86_400_000);
      const status: GymSubscriptionStatus = startsAt.getTime() > now.getTime() + 60_000 ? "pending" : "active";

      const subscription = manager.create(GymSubscriptionEntity, {
        gymId,
        memberId: member.id,
        userId: member.userId,
        planId: plan.id,
        planNameSnapshot: plan.name,
        planType: plan.planType,
        status,
        startsAt,
        endsAt,
        sessionsTotal: plan.planType === "session_pack" ? plan.sessionCount : null,
        sessionsRemaining: plan.planType === "session_pack" ? plan.sessionCount : null,
        allowedFromTime: plan.allowedFromTime,
        allowedToTime: plan.allowedToTime,
        allowedDaysMask: plan.allowedDaysMask,
        maxFreezeDays: plan.maxFreezeDays,
        frozenAt: null,
        frozenUntil: null,
        totalFrozenDays: 0,
        createdByUserId: actorUserId,
      });
      await manager.save(subscription);

      let payment: GymPaymentEntity | null = null;
      if (dto.recordPayment !== false) {
        payment = manager.create(GymPaymentEntity, {
          gymId,
          subscriptionId: subscription.id,
          userId: member.userId,
          amountCents: dto.paymentAmountCents ?? plan.priceCents,
          currency: plan.currency,
          method: dto.paymentMethod ?? "cash",
          reference: dto.paymentReference?.trim() || null,
          note: dto.paymentNote?.trim() || null,
          recordedByUserId: actorUserId,
          paidAt: now,
        });
        await manager.save(payment);
      }

      await manager.save(
        manager.create(GymAuditLogEntity, {
          gymId,
          actorUserId,
          action: "subscription.created",
          targetType: "gym_subscription",
          targetId: subscription.id,
          details: {
            memberId: member.id,
            planId: plan.id,
            planName: plan.name,
            endsAt: endsAt.toISOString(),
            paymentId: payment?.id ?? null,
            amountCents: payment?.amountCents ?? null,
            method: payment?.method ?? null,
          },
        }),
      );

      return {
        subscription: {
          id: subscription.id,
          memberId: subscription.memberId,
          userId: subscription.userId,
          planName: subscription.planNameSnapshot,
          planType: subscription.planType,
          status: subscription.status,
          startsAt: subscription.startsAt.toISOString(),
          endsAt: subscription.endsAt.toISOString(),
          sessionsTotal: subscription.sessionsTotal,
          sessionsRemaining: subscription.sessionsRemaining,
          allowedFromTime: subscription.allowedFromTime?.slice(0, 5) ?? null,
          allowedToTime: subscription.allowedToTime?.slice(0, 5) ?? null,
          allowedDaysMask: subscription.allowedDaysMask,
          maxFreezeDays: subscription.maxFreezeDays,
        },
        payment: payment
          ? {
              id: payment.id,
              amountCents: payment.amountCents,
              currency: payment.currency,
              method: payment.method,
              reference: payment.reference,
              note: payment.note,
              paidAt: payment.paidAt.toISOString(),
            }
          : null,
      };
    });
  }

  async freezeSubscription(
    gymId: string,
    actorUserId: string,
    subId: string,
    dto: FreezeSubscriptionDto,
  ) {
    this.assertUuid(subId, "Subscription");
    const sub = await this.subsRepo.findOne({ where: { id: subId, gymId } });
    if (!sub) throw new NotFoundException("Subscription not found");
    if (sub.status !== "active") {
      throw new BadRequestException("Only active subscriptions can be frozen");
    }

    const now = new Date();
    let frozenUntil: Date;
    if (dto.frozenUntil) {
      frozenUntil = new Date(dto.frozenUntil);
      if (!Number.isFinite(frozenUntil.getTime()) || frozenUntil.getTime() <= now.getTime()) {
        throw new BadRequestException("frozenUntil must be a future date");
      }
    } else if (dto.days) {
      frozenUntil = new Date(now.getTime() + dto.days * 86_400_000);
    } else {
      throw new BadRequestException("Provide either frozenUntil or days");
    }

    const requestedDays = Math.max(1, Math.ceil((frozenUntil.getTime() - now.getTime()) / 86_400_000));
    if (sub.maxFreezeDays <= 0) {
      throw new BadRequestException("This subscription plan does not allow freezing");
    }
    const remainingBudget = Math.max(0, sub.maxFreezeDays - sub.totalFrozenDays);
    if (requestedDays > remainingBudget) {
      throw new BadRequestException(
        `Requested ${requestedDays} freeze days exceeds remaining allowance (${remainingBudget} days)`,
      );
    }

    sub.status = "frozen";
    sub.frozenAt = now;
    sub.frozenUntil = frozenUntil;
    await this.subsRepo.save(sub);

    await this.writeAudit(gymId, actorUserId, "subscription.frozen", "gym_subscription", sub.id, {
      frozenAt: now.toISOString(),
      frozenUntil: frozenUntil.toISOString(),
      requestedDays,
    });

    return {
      id: sub.id,
      status: sub.status,
      frozenAt: sub.frozenAt.toISOString(),
      frozenUntil: sub.frozenUntil.toISOString(),
      endsAt: sub.endsAt.toISOString(),
      totalFrozenDays: sub.totalFrozenDays,
    };
  }

  async unfreezeSubscription(
    gymId: string,
    actorUserId: string | null,
    subId: string,
    nowOverride?: Date,
  ) {
    this.assertUuid(subId, "Subscription");
    const sub = await this.subsRepo.findOne({ where: { id: subId, gymId } });
    if (!sub) throw new NotFoundException("Subscription not found");
    if (sub.status !== "frozen" || !sub.frozenAt) {
      throw new BadRequestException("Subscription is not currently frozen");
    }

    const now = nowOverride ?? new Date();
    const ext = calculateUnfreezeExtension(
      sub.frozenAt,
      now,
      sub.endsAt,
      sub.totalFrozenDays,
      sub.maxFreezeDays > 0 ? sub.maxFreezeDays : undefined,
    );

    sub.endsAt = ext.newEndsAt;
    sub.totalFrozenDays = ext.newTotalFrozenDays;
    sub.frozenAt = null;
    sub.frozenUntil = null;
    sub.status = sub.endsAt.getTime() < now.getTime() ? "expired" : "active";
    await this.subsRepo.save(sub);

    await this.writeAudit(
      gymId,
      actorUserId,
      actorUserId ? "subscription.unfrozen" : "subscription.auto_unfrozen",
      "gym_subscription",
      sub.id,
      {
        frozenDaysAdded: ext.frozenDaysAdded,
        newEndsAt: sub.endsAt.toISOString(),
        totalFrozenDays: sub.totalFrozenDays,
      },
    );

    return {
      id: sub.id,
      status: sub.status,
      frozenDaysAdded: ext.frozenDaysAdded,
      endsAt: sub.endsAt.toISOString(),
      totalFrozenDays: sub.totalFrozenDays,
    };
  }

  async cancelSubscription(
    gymId: string,
    actorUserId: string,
    subId: string,
    dto: CancelSubscriptionDto = {},
  ) {
    this.assertUuid(subId, "Subscription");
    const sub = await this.subsRepo.findOne({ where: { id: subId, gymId } });
    if (!sub) throw new NotFoundException("Subscription not found");

    sub.status = "cancelled";
    sub.frozenAt = null;
    sub.frozenUntil = null;
    await this.subsRepo.save(sub);

    await this.writeAudit(gymId, actorUserId, "subscription.cancelled", "gym_subscription", sub.id, {
      reason: dto.reason?.trim() || null,
    });

    return { id: sub.id, status: sub.status };
  }

  async listPayments(
    gymId: string,
    filters: { from?: string; to?: string; method?: string } = {},
  ) {
    const conditions = ["gp.gym_id = $1"];
    const params: unknown[] = [gymId];

    if (filters.from && /^\d{4}-\d{2}-\d{2}$/.test(filters.from)) {
      params.push(`${filters.from}T00:00:00Z`);
      conditions.push(`gp.paid_at >= $${params.length}`);
    }
    if (filters.to && /^\d{4}-\d{2}-\d{2}$/.test(filters.to)) {
      params.push(`${filters.to}T23:59:59.999Z`);
      conditions.push(`gp.paid_at <= $${params.length}`);
    }
    if (filters.method && ["cash", "card_pos", "bank_transfer", "online"].includes(filters.method)) {
      params.push(filters.method);
      conditions.push(`gp.method = $${params.length}`);
    }

    const rows = (await this.dataSource.query(
      `
      SELECT
        gp.id,
        gp.subscription_id,
        gp.user_id,
        gp.amount_cents,
        gp.currency,
        gp.method,
        gp.reference,
        gp.note,
        gp.paid_at,
        u.email AS member_email,
        p.display_name AS member_name,
        gs.plan_name_snapshot AS plan_name,
        rec.email AS recorded_by_email,
        recp.display_name AS recorded_by_name
      FROM public.gym_payments gp
      LEFT JOIN public.users u ON u.id = gp.user_id
      LEFT JOIN public.profiles p ON p.id = u.id
      LEFT JOIN public.gym_subscriptions gs ON gs.id = gp.subscription_id
      LEFT JOIN public.users rec ON rec.id = gp.recorded_by_user_id
      LEFT JOIN public.profiles recp ON recp.id = rec.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY gp.paid_at DESC
      LIMIT 500
      `,
      params,
    )) as Record<string, unknown>[];

    const totalsByMethod: Record<GymPaymentMethod, number> = {
      cash: 0,
      card_pos: 0,
      bank_transfer: 0,
      online: 0,
    };
    let grandTotalCents = 0;

    const items = rows.map((r) => {
      const amountCents = Number(r.amount_cents ?? 0);
      const method = String(r.method) as GymPaymentMethod;
      grandTotalCents += amountCents;
      if (method in totalsByMethod) {
        totalsByMethod[method] += amountCents;
      }
      return {
        id: String(r.id),
        subscriptionId: (r.subscription_id as string | null) ?? null,
        userId: (r.user_id as string | null) ?? null,
        memberName: (r.member_name as string | null)?.trim() || (r.member_email as string | null) || null,
        memberEmail: (r.member_email as string | null) ?? null,
        planName: (r.plan_name as string | null) ?? null,
        amountCents,
        currency: String(r.currency),
        method,
        reference: (r.reference as string | null) ?? null,
        note: (r.note as string | null) ?? null,
        recordedByName:
          (r.recorded_by_name as string | null)?.trim() || (r.recorded_by_email as string | null) || null,
        paidAt: toIso(r.paid_at as Date | string),
      };
    });

    return {
      totals: {
        count: items.length,
        grandTotalCents,
        byMethod: totalsByMethod,
      },
      items,
    };
  }

  async listAuditLogs(gymId: string, limit = 100) {
    const take = Math.min(Math.max(Number(limit) || 100, 1), 300);
    const rows = (await this.dataSource.query(
      `
      SELECT
        ga.id,
        ga.action,
        ga.target_type,
        ga.target_id,
        ga.details,
        ga.created_at,
        u.email AS actor_email,
        p.display_name AS actor_name
      FROM public.gym_audit_logs ga
      LEFT JOIN public.users u ON u.id = ga.actor_user_id
      LEFT JOIN public.profiles p ON p.id = u.id
      WHERE ga.gym_id = $1
      ORDER BY ga.created_at DESC
      LIMIT $2
      `,
      [gymId, take],
    )) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: String(r.id),
      action: String(r.action),
      targetType: (r.target_type as string | null) ?? null,
      targetId: (r.target_id as string | null) ?? null,
      details: (r.details as Record<string, unknown>) ?? {},
      actorName: (r.actor_name as string | null)?.trim() || (r.actor_email as string | null) || "System",
      createdAt: toIso(r.created_at as Date | string),
    }));
  }

  // =========================================================================
  // Daily Maintenance Cron (09:00): auto-unfreeze, expire, notify
  // =========================================================================

  @Cron("0 9 * * *")
  async handleDailyCron() {
    if (this.configService.get<string>("NODE_ENV") === "test") return;
    try {
      const summary = await this.runDailyMaintenance();
      this.logger.log(
        `Gym daily maintenance: unfrozen=${summary.unfrozen}, expired=${summary.expired}, notified=${summary.notified}`,
      );
    } catch (err) {
      this.logger.error("Gym daily maintenance failed", err);
    }
  }

  async runDailyMaintenance(now = new Date()) {
    let unfrozen = 0;
    let expired = 0;
    let notified = 0;

    // 1. Auto-unfreeze subscriptions whose frozen_until has passed
    const dueUnfreeze = (await this.dataSource.query(
      `
      SELECT id, gym_id
      FROM public.gym_subscriptions
      WHERE status = 'frozen' AND frozen_until IS NOT NULL AND frozen_until <= $1
      `,
      [now.toISOString()],
    )) as { id: string; gym_id: string }[];

    for (const row of dueUnfreeze) {
      await this.unfreezeSubscription(row.gym_id, null, row.id, now);
      unfrozen++;
    }

    // 2. Mark expired active/pending subscriptions
    const expiredRes = (await this.dataSource.query(
      `
      UPDATE public.gym_subscriptions
      SET status = 'expired', updated_at = now()
      WHERE status IN ('active', 'pending') AND ends_at < $1
      RETURNING id
      `,
      [now.toISOString()],
    )) as { id: string }[];
    expired = expiredRes.length;

    // 3. Notify members whose active subscription expires within 3 days (deduped 48h)
    const expiringSoon = (await this.dataSource.query(
      `
      SELECT gs.id, gs.user_id, gs.gym_id, gs.plan_name_snapshot, gs.ends_at, g.name AS gym_name
      FROM public.gym_subscriptions gs
      JOIN public.gyms g ON g.id = gs.gym_id
      WHERE gs.status = 'active'
        AND gs.ends_at >= $1
        AND gs.ends_at <= $2
        AND NOT EXISTS (
          SELECT 1 FROM public.notifications n
          WHERE n.user_id = gs.user_id
            AND n.type = 'gym_subscription_expiring'
            AND n.payload->>'subscription_id' = gs.id::text
            AND n.created_at >= $3
        )
      `,
      [
        now.toISOString(),
        new Date(now.getTime() + EXPIRING_SOON_DAYS * 86_400_000).toISOString(),
        new Date(now.getTime() - 48 * 3_600_000).toISOString(),
      ],
    )) as Record<string, unknown>[];

    for (const row of expiringSoon) {
      const endsAt = new Date(row.ends_at as string | Date);
      const daysLeft = Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / 86_400_000));
      await this.notifications.notify(
        String(row.user_id),
        null,
        "gym_subscription_expiring",
        {
          subscription_id: String(row.id),
          gym_id: String(row.gym_id),
          gym_name: String(row.gym_name),
          plan_name: String(row.plan_name_snapshot),
          days_left: daysLeft,
        },
        "/gym",
      );
      notified++;
    }

    // 4. Notify members with 1 session remaining on session_pack (deduped 48h)
    const lowSessions = (await this.dataSource.query(
      `
      SELECT gs.id, gs.user_id, gs.gym_id, gs.plan_name_snapshot, gs.sessions_remaining, g.name AS gym_name
      FROM public.gym_subscriptions gs
      JOIN public.gyms g ON g.id = gs.gym_id
      WHERE gs.status = 'active'
        AND gs.plan_type = 'session_pack'
        AND gs.sessions_remaining = 1
        AND gs.ends_at >= $1
        AND NOT EXISTS (
          SELECT 1 FROM public.notifications n
          WHERE n.user_id = gs.user_id
            AND n.type = 'gym_subscription_low_sessions'
            AND n.payload->>'subscription_id' = gs.id::text
            AND n.created_at >= $2
        )
      `,
      [now.toISOString(), new Date(now.getTime() - 48 * 3_600_000).toISOString()],
    )) as Record<string, unknown>[];

    for (const row of lowSessions) {
      await this.notifications.notify(
        String(row.user_id),
        null,
        "gym_subscription_low_sessions",
        {
          subscription_id: String(row.id),
          gym_id: String(row.gym_id),
          gym_name: String(row.gym_name),
          plan_name: String(row.plan_name_snapshot),
          sessions_remaining: Number(row.sessions_remaining ?? 1),
        },
        "/gym",
      );
      notified++;
    }

    return { unfrozen, expired, notified };
  }
}
