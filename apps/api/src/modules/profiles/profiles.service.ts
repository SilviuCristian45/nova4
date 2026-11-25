import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { parseSpecialties } from "@replog/shared";
import { CoachProfileEntity, ProfileEntity } from "../../database/entities";
import {
  serializeCoachProfile,
  serializeProfile,
  type SerializedCoachProfile,
  type SerializedProfile,
} from "../auth/auth.service";
import type { UpdateProfileDto, UpsertCoachProfileDto } from "./dto/profile.dto";

function isValidBirthDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false;
  const today = new Date().toISOString().slice(0, 10);
  return value >= "1900-01-01" && value <= today;
}

@Injectable()
export class ProfilesService {
  constructor(
    @InjectRepository(ProfileEntity)
    private readonly profilesRepo: Repository<ProfileEntity>,
    @InjectRepository(CoachProfileEntity)
    private readonly coachProfilesRepo: Repository<CoachProfileEntity>,
  ) {}

  async getProfile(userId: string): Promise<SerializedProfile> {
    const profile = await this.profilesRepo.findOne({ where: { id: userId } });
    if (!profile) {
      throw new NotFoundException("Profile not found");
    }
    return serializeProfile(profile);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<SerializedProfile> {
    const profile = await this.profilesRepo.findOne({ where: { id: userId } });
    if (!profile) {
      throw new NotFoundException("Profile not found");
    }

    if (dto.displayName !== undefined) {
      const trimmed = dto.displayName === null ? "" : dto.displayName.trim();
      profile.displayName = trimmed.length > 0 ? trimmed : null;
    }

    if (dto.heightCm !== undefined) {
      profile.heightCm = dto.heightCm === null ? null : dto.heightCm.toFixed(1);
    }

    if (dto.birthDate !== undefined) {
      if (dto.birthDate === null || dto.birthDate === "") {
        profile.birthDate = null;
      } else {
        if (!isValidBirthDate(dto.birthDate)) {
          throw new BadRequestException("Birth date must be a valid date between 1900-01-01 and today");
        }
        profile.birthDate = dto.birthDate;
      }
    }

    if (dto.sex !== undefined) {
      profile.sex = dto.sex;
    }

    if (dto.weightUnit !== undefined) {
      profile.weightUnit = dto.weightUnit;
    }

    if (dto.dailyStepsGoal !== undefined) {
      profile.dailyStepsGoal = dto.dailyStepsGoal;
    }

    if (dto.activityLevel !== undefined) {
      profile.activityLevel = dto.activityLevel;
    }

    if (dto.goalKgPerWeek !== undefined) {
      profile.goalKgPerWeek = dto.goalKgPerWeek.toFixed(2);
    }

    const saved = await this.profilesRepo.save(profile);
    return serializeProfile(saved);
  }

  async getCoachProfile(userId: string): Promise<SerializedCoachProfile> {
    const existing = await this.coachProfilesRepo.findOne({ where: { userId } });
    if (!existing) {
      throw new NotFoundException("Coach profile not found");
    }
    return serializeCoachProfile(existing)!;
  }

  async upsertCoachProfile(userId: string, dto: UpsertCoachProfileDto): Promise<SerializedCoachProfile> {
    const existing = await this.coachProfilesRepo.findOne({ where: { userId } });
    const displayName = dto.displayName.trim();
    if (displayName.length < 1 || displayName.length > 80) {
      throw new BadRequestException("Coach name must be between 1 and 80 characters");
    }

    const bio = dto.bio === undefined ? (existing?.bio ?? null) : (dto.bio?.trim() || null);
    const specialties =
      dto.specialties === undefined
        ? (existing?.specialties ?? [])
        : parseSpecialties(dto.specialties.join(","));

    const entity = existing
      ? Object.assign(existing, {
          displayName,
          bio,
          specialties,
          isPublic: dto.isPublic ?? existing.isPublic,
          acceptingClients: dto.acceptingClients ?? existing.acceptingClients,
        })
      : this.coachProfilesRepo.create({
          userId,
          displayName,
          bio,
          specialties,
          isPublic: dto.isPublic ?? false,
          acceptingClients: dto.acceptingClients ?? true,
        });

    const saved = await this.coachProfilesRepo.save(entity);
    return serializeCoachProfile(saved)!;
  }
}
