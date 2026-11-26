import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, IsNull, Repository } from "typeorm";
import { parseWeightUnit, type UserRole, type WeightUnit } from "@replog/shared";
import { isSuperAdminEmail } from "../../common/auth/super-admin";
import {
  CoachProfileEntity,
  ProfileEntity,
  RefreshTokenEntity,
  UserEntity,
} from "../../database/entities";
import { AccountService } from "../account/account.service";
import { PasswordService } from "../auth/password.service";
import type { AdminCreateUserDto, AdminUpdateUserDto } from "./dto/admin-user.dto";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AdminUserItem {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  weightUnit: WeightUnit;
  dailyStepsGoal: number;
  disabled: boolean;
  disabledAt: string | null;
  isSuperAdmin: boolean;
  createdAt: string;
  updatedAt: string;
  workoutsCount: number;
  mealsCount: number;
  photosCount: number;
}

export interface AdminUserListResponse {
  stats: {
    total: number;
    active: number;
    disabled: number;
    coaches: number;
    clients: number;
  };
  items: AdminUserItem[];
}

interface RawAdminUserRow {
  id: string;
  email: string;
  disabled_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  display_name: string | null;
  role: string | null;
  weight_unit: string | null;
  daily_steps_goal: number | null;
  workouts_count: string | number;
  meals_count: string | number;
  photos_count: string | number;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    @InjectRepository(UserEntity)
    private readonly usersRepo: Repository<UserEntity>,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokensRepo: Repository<RefreshTokenEntity>,
    private readonly passwordService: PasswordService,
    private readonly accountService: AccountService,
  ) {}

  private assertUuid(id: string): void {
    if (!UUID_REGEX.test(id)) {
      throw new NotFoundException("User not found");
    }
  }

  private mapRow(row: RawAdminUserRow): AdminUserItem {
    const superAdminRaw = this.configService.get<string>("SUPER_ADMIN_EMAILS");
    const disabledAt =
      row.disabled_at instanceof Date
        ? row.disabled_at.toISOString()
        : row.disabled_at
          ? String(row.disabled_at)
          : null;
    const createdAt =
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
    const updatedAt =
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at);

    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name ?? null,
      role: row.role === "coach" ? "coach" : "client",
      weightUnit: parseWeightUnit(row.weight_unit),
      dailyStepsGoal: Number(row.daily_steps_goal ?? 10000),
      disabled: disabledAt !== null,
      disabledAt,
      isSuperAdmin: isSuperAdminEmail(row.email, superAdminRaw),
      createdAt,
      updatedAt,
      workoutsCount: Number(row.workouts_count ?? 0),
      mealsCount: Number(row.meals_count ?? 0),
      photosCount: Number(row.photos_count ?? 0),
    };
  }

  private async fetchAllRows(): Promise<AdminUserItem[]> {
    const rows = (await this.dataSource.query(`
      SELECT
        u.id,
        u.email,
        u.disabled_at,
        u.created_at,
        u.updated_at,
        p.display_name,
        p.role,
        p.weight_unit,
        p.daily_steps_goal,
        COALESCE(w.cnt, 0) AS workouts_count,
        COALESCE(m.cnt, 0) AS meals_count,
        COALESCE(ph.cnt, 0) AS photos_count
      FROM public.users u
      LEFT JOIN public.profiles p ON p.id = u.id
      LEFT JOIN (SELECT user_id, COUNT(*) AS cnt FROM public.workouts GROUP BY user_id) w ON w.user_id = u.id
      LEFT JOIN (SELECT user_id, COUNT(*) AS cnt FROM public.meals GROUP BY user_id) m ON m.user_id = u.id
      LEFT JOIN (SELECT user_id, COUNT(*) AS cnt FROM public.progress_photos GROUP BY user_id) ph ON ph.user_id = u.id
      ORDER BY u.created_at DESC
    `)) as RawAdminUserRow[];

    return rows.map((row) => this.mapRow(row));
  }

  private async fetchOneById(userId: string): Promise<AdminUserItem> {
    this.assertUuid(userId);
    const rows = (await this.dataSource.query(
      `
      SELECT
        u.id,
        u.email,
        u.disabled_at,
        u.created_at,
        u.updated_at,
        p.display_name,
        p.role,
        p.weight_unit,
        p.daily_steps_goal,
        (SELECT COUNT(*) FROM public.workouts WHERE user_id = u.id) AS workouts_count,
        (SELECT COUNT(*) FROM public.meals WHERE user_id = u.id) AS meals_count,
        (SELECT COUNT(*) FROM public.progress_photos WHERE user_id = u.id) AS photos_count
      FROM public.users u
      LEFT JOIN public.profiles p ON p.id = u.id
      WHERE u.id = $1
      LIMIT 1
      `,
      [userId],
    )) as RawAdminUserRow[];

    if (!rows[0]) {
      throw new NotFoundException("User not found");
    }
    return this.mapRow(rows[0]);
  }

  async listUsers(filters: { q?: string; role?: string; status?: string } = {}): Promise<AdminUserListResponse> {
    const all = await this.fetchAllRows();

    const stats = {
      total: all.length,
      active: all.filter((u) => !u.disabled).length,
      disabled: all.filter((u) => u.disabled).length,
      coaches: all.filter((u) => u.role === "coach").length,
      clients: all.filter((u) => u.role === "client").length,
    };

    const needle = filters.q?.trim().toLowerCase() ?? "";
    const roleFilter = filters.role === "coach" || filters.role === "client" ? filters.role : null;
    const statusFilter = filters.status === "active" || filters.status === "disabled" ? filters.status : null;

    const items = all.filter((item) => {
      if (roleFilter && item.role !== roleFilter) return false;
      if (statusFilter === "active" && item.disabled) return false;
      if (statusFilter === "disabled" && !item.disabled) return false;
      if (needle) {
        const matchesEmail = item.email.toLowerCase().includes(needle);
        const matchesName = (item.displayName ?? "").toLowerCase().includes(needle);
        if (!matchesEmail && !matchesName) return false;
      }
      return true;
    });

    return { stats, items };
  }

  async createUser(dto: AdminCreateUserDto): Promise<AdminUserItem> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.usersRepo
      .createQueryBuilder("user")
      .where("lower(user.email) = :email", { email })
      .getOne();

    if (existing) {
      throw new ConflictException("An account with this email already exists");
    }

    const displayName = dto.displayName?.trim() || null;
    const role: UserRole = dto.role === "coach" ? "coach" : "client";
    const weightUnit: WeightUnit = dto.weightUnit === "lb" ? "lb" : "kg";
    const dailyStepsGoal = dto.dailyStepsGoal ?? 10000;
    const passwordHash = await this.passwordService.hash(dto.password);

    const createdId = await this.dataSource.transaction(async (manager) => {
      const user = manager.create(UserEntity, {
        email,
        passwordHash,
        emailVerifiedAt: new Date(),
        disabledAt: null,
      });
      await manager.save(user);

      const profile = manager.create(ProfileEntity, {
        id: user.id,
        role,
        displayName,
        weightUnit,
        dailyStepsGoal,
        goalKgPerWeek: "0",
      });
      await manager.save(profile);

      if (role === "coach") {
        const coachProfile = manager.create(CoachProfileEntity, {
          userId: user.id,
          displayName: (displayName || "Coach").slice(0, 80),
          specialties: [],
          isPublic: false,
          acceptingClients: true,
        });
        await manager.save(coachProfile);
      }

      return user.id;
    });

    return this.fetchOneById(createdId);
  }

  async updateUser(actorId: string, targetId: string, dto: AdminUpdateUserDto): Promise<AdminUserItem> {
    this.assertUuid(targetId);

    const user = await this.usersRepo.findOne({ where: { id: targetId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    let nextEmail: string | undefined;
    if (dto.email !== undefined) {
      const normalized = dto.email.trim().toLowerCase();
      if (normalized !== user.email.toLowerCase()) {
        if (actorId === targetId && !isSuperAdminEmail(normalized, this.configService.get<string>("SUPER_ADMIN_EMAILS"))) {
          throw new BadRequestException("Cannot change your own email away from SUPER_ADMIN_EMAILS");
        }
        const duplicate = await this.usersRepo
          .createQueryBuilder("u")
          .where("lower(u.email) = :email", { email: normalized })
          .getOne();
        if (duplicate && duplicate.id !== targetId) {
          throw new ConflictException("An account with this email already exists");
        }
        nextEmail = normalized;
      }
    }

    await this.dataSource.transaction(async (manager) => {
      if (nextEmail !== undefined) {
        await manager.update(UserEntity, { id: targetId }, { email: nextEmail });
      }

      let profile = await manager.findOne(ProfileEntity, { where: { id: targetId } });
      if (!profile) {
        profile = manager.create(ProfileEntity, {
          id: targetId,
          role: "client",
          dailyStepsGoal: 10000,
          weightUnit: "kg",
          goalKgPerWeek: "0",
        });
      }

      if (dto.displayName !== undefined) {
        profile.displayName = dto.displayName?.trim() || null;
      }
      if (dto.role !== undefined) {
        profile.role = dto.role;
      }
      if (dto.weightUnit !== undefined) {
        profile.weightUnit = dto.weightUnit;
      }
      if (dto.dailyStepsGoal !== undefined) {
        profile.dailyStepsGoal = dto.dailyStepsGoal;
      }
      await manager.save(profile);

      if (profile.role === "coach") {
        const existingCoach = await manager.findOne(CoachProfileEntity, { where: { userId: targetId } });
        if (!existingCoach) {
          const coachProfile = manager.create(CoachProfileEntity, {
            userId: targetId,
            displayName: (profile.displayName?.trim() || "Coach").slice(0, 80),
            specialties: [],
            isPublic: false,
            acceptingClients: true,
          });
          await manager.save(coachProfile);
        }
      }
    });

    return this.fetchOneById(targetId);
  }

  async setUserStatus(actorId: string, targetId: string, disabled: boolean): Promise<AdminUserItem> {
    this.assertUuid(targetId);
    if (actorId === targetId && disabled) {
      throw new BadRequestException("You cannot disable your own super admin account");
    }

    const user = await this.usersRepo.findOne({ where: { id: targetId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.update(UserEntity, { id: targetId }, { disabledAt: disabled ? new Date() : null });
      if (disabled) {
        await manager.update(
          RefreshTokenEntity,
          { userId: targetId, revokedAt: IsNull() },
          { revokedAt: new Date() },
        );
      }
    });

    return this.fetchOneById(targetId);
  }

  async resetPassword(targetId: string, newPassword: string): Promise<{ success: true }> {
    this.assertUuid(targetId);
    const user = await this.usersRepo.findOne({ where: { id: targetId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const nextHash = await this.passwordService.hash(newPassword);
    await this.dataSource.transaction(async (manager) => {
      await manager.update(UserEntity, { id: targetId }, { passwordHash: nextHash });
      await manager.update(
        RefreshTokenEntity,
        { userId: targetId, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
    });

    return { success: true };
  }

  async deleteUser(actorId: string, targetId: string): Promise<{ success: true }> {
    this.assertUuid(targetId);
    if (actorId === targetId) {
      throw new BadRequestException("You cannot delete your own super admin account");
    }
    return this.accountService.deleteAccountUnchecked(targetId);
  }
}
