import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DataSource, IsNull, Repository } from "typeorm";
import { coachSelfServeEnabled, parseWeightUnit, type UserRole, type WeightUnit } from "@replog/shared";
import {
  CoachProfileEntity,
  ProfileEntity,
  RefreshTokenEntity,
  UserEntity,
} from "../../database/entities";
import type { AccessTokenPayload } from "../../common/auth/auth-user.type";
import { PasswordService } from "./password.service";
import type {
  ActivateCoachDto,
  ChangeEmailDto,
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
} from "./dto/auth.dto";

export interface SessionMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface SerializedProfile {
  id: string;
  role: UserRole;
  displayName: string | null;
  heightCm: number | null;
  birthDate: string | null;
  sex: "male" | "female" | null;
  weightUnit: WeightUnit;
  dailyStepsGoal: number;
  activityLevel: "sedentary" | "light" | "moderate" | "active" | "very_active" | null;
  goalKgPerWeek: number;
}

export interface SerializedCoachProfile {
  userId: string;
  displayName: string;
  bio: string | null;
  specialties: string[];
  isPublic: boolean;
  acceptingClients: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthUserView {
  id: string;
  email: string;
  createdAt: string;
  profile: SerializedProfile;
  coachProfile: SerializedCoachProfile | null;
}

export interface AuthSessionResponse {
  user: AuthUserView;
  accessToken: string;
  refreshToken: string;
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function serializeProfile(profile: ProfileEntity): SerializedProfile {
  return {
    id: profile.id,
    role: profile.role === "coach" ? "coach" : "client",
    displayName: profile.displayName ?? null,
    heightCm: profile.heightCm !== null && profile.heightCm !== undefined ? Number(profile.heightCm) : null,
    birthDate: profile.birthDate ?? null,
    sex: profile.sex ?? null,
    weightUnit: parseWeightUnit(profile.weightUnit),
    dailyStepsGoal: profile.dailyStepsGoal,
    activityLevel: profile.activityLevel ?? null,
    goalKgPerWeek: Number(profile.goalKgPerWeek ?? 0),
  };
}

export function serializeCoachProfile(coach: CoachProfileEntity | null | undefined): SerializedCoachProfile | null {
  if (!coach) return null;
  return {
    userId: coach.userId,
    displayName: coach.displayName,
    bio: coach.bio ?? null,
    specialties: coach.specialties ?? [],
    isPublic: coach.isPublic,
    acceptingClients: coach.acceptingClients,
    createdAt: coach.createdAt instanceof Date ? coach.createdAt.toISOString() : String(coach.createdAt),
    updatedAt: coach.updatedAt instanceof Date ? coach.updatedAt.toISOString() : String(coach.updatedAt),
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(UserEntity)
    private readonly usersRepo: Repository<UserEntity>,
    @InjectRepository(ProfileEntity)
    private readonly profilesRepo: Repository<ProfileEntity>,
    @InjectRepository(CoachProfileEntity)
    private readonly coachProfilesRepo: Repository<CoachProfileEntity>,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokensRepo: Repository<RefreshTokenEntity>,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto, meta: SessionMeta = {}): Promise<AuthSessionResponse> {
    const email = dto.email.trim().toLowerCase();
    const displayName = dto.displayName?.trim() || null;
    const requestedRole: UserRole = dto.role === "coach" ? "coach" : "client";

    if (requestedRole === "coach" && !coachSelfServeEnabled(this.configService.get<string>("COACH_SELF_SERVE"))) {
      throw new ForbiddenException("Self-serve coach registration is disabled on this server");
    }

    const existing = await this.findUserByEmail(email);
    if (existing) {
      throw new ConflictException("An account with this email already exists");
    }

    const passwordHash = await this.passwordService.hash(dto.password);

    const { user, profile, coachProfile } = await this.dataSource.transaction(async (manager) => {
      const createdUser = manager.create(UserEntity, {
        email,
        passwordHash,
        emailVerifiedAt: new Date(),
      });
      await manager.save(createdUser);

      const createdProfile = manager.create(ProfileEntity, {
        id: createdUser.id,
        role: requestedRole,
        displayName,
        dailyStepsGoal: 10000,
        weightUnit: "kg",
        goalKgPerWeek: "0",
      });
      await manager.save(createdProfile);

      let createdCoachProfile: CoachProfileEntity | null = null;
      if (requestedRole === "coach") {
        createdCoachProfile = manager.create(CoachProfileEntity, {
          userId: createdUser.id,
          displayName: (displayName || "Coach").slice(0, 80),
          specialties: [],
          isPublic: false,
          acceptingClients: true,
        });
        await manager.save(createdCoachProfile);
      }

      return { user: createdUser, profile: createdProfile, coachProfile: createdCoachProfile };
    });

    return this.issueSession(user, profile, coachProfile, meta);
  }

  async login(dto: LoginDto, meta: SessionMeta = {}): Promise<AuthSessionResponse> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.findUserByEmail(email);
    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const { valid, needsRehash } = await this.passwordService.verify(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    if (needsRehash) {
      const upgradedHash = await this.passwordService.hash(dto.password);
      await this.usersRepo.update({ id: user.id }, { passwordHash: upgradedHash });
    }

    const profile = await this.ensureProfile(user.id);
    const coachProfile =
      profile.role === "coach"
        ? await this.coachProfilesRepo.findOne({ where: { userId: user.id } })
        : null;

    return this.issueSession(user, profile, coachProfile, meta);
  }

  async refresh(rawToken: string | undefined, meta: SessionMeta = {}): Promise<AuthSessionResponse> {
    if (!rawToken || !rawToken.trim()) {
      throw new UnauthorizedException("Refresh token is required");
    }

    const tokenHash = hashToken(rawToken.trim());
    const stored = await this.refreshTokensRepo.findOne({ where: { tokenHash } });
    if (!stored) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    // Refresh token reuse detection: if an already-revoked token is replayed, revoke its entire family.
    if (stored.revokedAt !== null) {
      await this.refreshTokensRepo.update(
        { familyId: stored.familyId, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
      throw new UnauthorizedException("Refresh token reuse detected");
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      await this.refreshTokensRepo.update({ id: stored.id }, { revokedAt: new Date() });
      throw new UnauthorizedException("Refresh token expired");
    }

    const user = await this.usersRepo.findOne({ where: { id: stored.userId } });
    if (!user) {
      throw new UnauthorizedException("Account no longer exists");
    }

    const profile = await this.ensureProfile(user.id);
    const coachProfile =
      profile.role === "coach"
        ? await this.coachProfilesRepo.findOne({ where: { userId: user.id } })
        : null;

    const nextRawToken = generateOpaqueToken();
    const nextTokenHash = hashToken(nextRawToken);
    const nextExpiresAt = this.refreshExpiryDate();

    await this.dataSource.transaction(async (manager) => {
      const nextEntity = manager.create(RefreshTokenEntity, {
        userId: user.id,
        tokenHash: nextTokenHash,
        familyId: stored.familyId,
        userAgent: meta.userAgent ?? null,
        ipAddress: meta.ipAddress ?? null,
        expiresAt: nextExpiresAt,
      });
      await manager.save(nextEntity);

      await manager.update(
        RefreshTokenEntity,
        { id: stored.id },
        { revokedAt: new Date(), replacedById: nextEntity.id },
      );
    });

    const accessToken = await this.signAccessToken(user, profile);
    return {
      user: this.buildUserView(user, profile, coachProfile),
      accessToken,
      refreshToken: nextRawToken,
    };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken || !rawToken.trim()) return;
    const tokenHash = hashToken(rawToken.trim());
    await this.refreshTokensRepo.update(
      { tokenHash, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async me(userId: string): Promise<AuthUserView> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException("Account not found");
    }
    const profile = await this.ensureProfile(user.id);
    const coachProfile =
      profile.role === "coach"
        ? await this.coachProfilesRepo.findOne({ where: { userId: user.id } })
        : null;
    return this.buildUserView(user, profile, coachProfile);
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ success: true }> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("Account not found");
    }

    const { valid } = await this.passwordService.verify(dto.currentPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException("Current password is incorrect");
    }

    const nextHash = await this.passwordService.hash(dto.newPassword);
    await this.dataSource.transaction(async (manager) => {
      await manager.update(UserEntity, { id: userId }, { passwordHash: nextHash });
      await manager.update(
        RefreshTokenEntity,
        { userId, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
    });

    return { success: true };
  }

  async changeEmail(userId: string, dto: ChangeEmailDto): Promise<{ email: string }> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("Account not found");
    }

    const { valid } = await this.passwordService.verify(dto.currentPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException("Current password is incorrect");
    }

    const nextEmail = dto.email.trim().toLowerCase();
    if (nextEmail === user.email.toLowerCase()) {
      throw new BadRequestException("This is already your account email");
    }

    const existing = await this.findUserByEmail(nextEmail);
    if (existing && existing.id !== userId) {
      throw new ConflictException("An account with this email already exists");
    }

    await this.usersRepo.update({ id: userId }, { email: nextEmail });
    return { email: nextEmail };
  }

  async activateCoachRole(
    userId: string,
    dto: ActivateCoachDto,
  ): Promise<{ user: AuthUserView; accessToken: string }> {
    if (!coachSelfServeEnabled(this.configService.get<string>("COACH_SELF_SERVE"))) {
      throw new ForbiddenException("Self-serve coach activation is disabled on this server");
    }

    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("Account not found");
    }

    const requestedName = dto.displayName?.trim() || null;

    const { profile, coachProfile } = await this.dataSource.transaction(async (manager) => {
      const existingProfile = await manager.findOne(ProfileEntity, { where: { id: userId } });
      if (!existingProfile) {
        throw new NotFoundException("Profile not found");
      }

      existingProfile.role = "coach";
      if (requestedName) {
        existingProfile.displayName = requestedName.slice(0, 80);
      }
      await manager.save(existingProfile);

      const resolvedName = (existingProfile.displayName?.trim() || "Coach").slice(0, 80);
      let existingCoach = await manager.findOne(CoachProfileEntity, { where: { userId } });
      if (!existingCoach) {
        existingCoach = manager.create(CoachProfileEntity, {
          userId,
          displayName: resolvedName,
          specialties: [],
          isPublic: false,
          acceptingClients: true,
        });
      } else if (requestedName) {
        existingCoach.displayName = requestedName.slice(0, 80);
      }
      await manager.save(existingCoach);

      return { profile: existingProfile, coachProfile: existingCoach };
    });

    const accessToken = await this.signAccessToken(user, profile);
    return {
      user: this.buildUserView(user, profile, coachProfile),
      accessToken,
    };
  }

  private async issueSession(
    user: UserEntity,
    profile: ProfileEntity,
    coachProfile: CoachProfileEntity | null,
    meta: SessionMeta,
  ): Promise<AuthSessionResponse> {
    const rawRefreshToken = generateOpaqueToken();
    const tokenEntity = this.refreshTokensRepo.create({
      userId: user.id,
      tokenHash: hashToken(rawRefreshToken),
      familyId: randomUUID(),
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
      expiresAt: this.refreshExpiryDate(),
    });
    await this.refreshTokensRepo.save(tokenEntity);

    const accessToken = await this.signAccessToken(user, profile);
    return {
      user: this.buildUserView(user, profile, coachProfile),
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  private async signAccessToken(user: UserEntity, profile: ProfileEntity): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: profile.role === "coach" ? "coach" : "client",
    };
    const secret = this.configService.getOrThrow<string>("JWT_ACCESS_SECRET");
    const expiresIn = Number(this.configService.get<string>("JWT_ACCESS_TTL_SECONDS") ?? 900);
    return this.jwtService.signAsync(payload, { secret, expiresIn });
  }

  private refreshExpiryDate(): Date {
    const ttlDays = Number(this.configService.get<string>("REFRESH_TOKEN_TTL_DAYS") ?? 30);
    return new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  }

  private async findUserByEmail(email: string): Promise<UserEntity | null> {
    return this.usersRepo
      .createQueryBuilder("user")
      .where("lower(user.email) = :email", { email: email.toLowerCase() })
      .getOne();
  }

  private async ensureProfile(userId: string): Promise<ProfileEntity> {
    const existing = await this.profilesRepo.findOne({ where: { id: userId } });
    if (existing) return existing;
    const created = this.profilesRepo.create({
      id: userId,
      role: "client",
      dailyStepsGoal: 10000,
      weightUnit: "kg",
      goalKgPerWeek: "0",
    });
    return this.profilesRepo.save(created);
  }

  private buildUserView(
    user: UserEntity,
    profile: ProfileEntity,
    coachProfile: CoachProfileEntity | null,
  ): AuthUserView {
    return {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : String(user.createdAt),
      profile: serializeProfile(profile),
      coachProfile: serializeCoachProfile(coachProfile),
    };
  }
}
