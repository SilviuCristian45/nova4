import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { isMeasurementDate, parseCheckin } from "@replog/shared";
import { DailyCheckinEntity, DailyStepsEntity, DailyWeightEntity } from "../../database/entities";
import type { UpsertDailyCheckinDto, UpsertStepsDto, UpsertWeightDto } from "./dto/metrics.dto";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function assertValidMeasurementDate(date: string): void {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (!isMeasurementDate(date, tomorrow.toISOString().slice(0, 10))) {
    throw new BadRequestException("Invalid measurement date");
  }
}

@Injectable()
export class MetricsService {
  constructor(
    @InjectRepository(DailyStepsEntity)
    private readonly stepsRepo: Repository<DailyStepsEntity>,
    @InjectRepository(DailyWeightEntity)
    private readonly weightRepo: Repository<DailyWeightEntity>,
    @InjectRepository(DailyCheckinEntity)
    private readonly checkinRepo: Repository<DailyCheckinEntity>,
  ) {}

  async listSteps(userId: string, query: { from?: string; to?: string; date?: string }) {
    const qb = this.stepsRepo
      .createQueryBuilder("s")
      .where("s.userId = :userId", { userId })
      .orderBy("s.date", "ASC");

    if (query.date && DATE_REGEX.test(query.date)) {
      qb.andWhere("s.date = :date", { date: query.date });
    } else {
      if (query.from && DATE_REGEX.test(query.from)) qb.andWhere("s.date >= :from", { from: query.from });
      if (query.to && DATE_REGEX.test(query.to)) qb.andWhere("s.date <= :to", { to: query.to });
    }

    const rows = await qb.getMany();
    return rows.map((r) => ({ id: r.id, date: String(r.date).slice(0, 10), steps: r.steps }));
  }

  async upsertSteps(userId: string, dto: UpsertStepsDto) {
    assertValidMeasurementDate(dto.date);
    await this.stepsRepo
      .createQueryBuilder()
      .insert()
      .into(DailyStepsEntity)
      .values({ userId, date: dto.date, steps: dto.steps })
      .orUpdate(["steps"], ["user_id", "date"])
      .execute();

    return { date: dto.date, steps: dto.steps };
  }

  async listWeight(userId: string, query: { from?: string; to?: string; date?: string }) {
    const qb = this.weightRepo
      .createQueryBuilder("w")
      .where("w.userId = :userId", { userId })
      .orderBy("w.date", "ASC");

    if (query.date && DATE_REGEX.test(query.date)) {
      qb.andWhere("w.date = :date", { date: query.date });
    } else {
      if (query.from && DATE_REGEX.test(query.from)) qb.andWhere("w.date >= :from", { from: query.from });
      if (query.to && DATE_REGEX.test(query.to)) qb.andWhere("w.date <= :to", { to: query.to });
    }

    const rows = await qb.getMany();
    return rows.map((r) => ({ date: String(r.date).slice(0, 10), weightKg: Number(r.weightKg) }));
  }

  async upsertWeight(userId: string, dto: UpsertWeightDto) {
    assertValidMeasurementDate(dto.date);
    const rounded = Math.round(dto.weightKg * 100) / 100;
    await this.weightRepo
      .createQueryBuilder()
      .insert()
      .into(DailyWeightEntity)
      .values({ userId, date: dto.date, weightKg: rounded.toFixed(2) })
      .orUpdate(["weight_kg"], ["user_id", "date"])
      .execute();

    return { date: dto.date, weightKg: rounded };
  }

  async deleteWeight(userId: string, date: string) {
    if (!DATE_REGEX.test(date)) throw new BadRequestException("Invalid date");
    await this.weightRepo.delete({ userId, date });
    return { deleted: true };
  }

  async listCheckin(userId: string, query: { from?: string; to?: string; date?: string }) {
    const qb = this.checkinRepo
      .createQueryBuilder("c")
      .where("c.userId = :userId", { userId })
      .orderBy("c.date", "ASC");

    if (query.date && DATE_REGEX.test(query.date)) {
      qb.andWhere("c.date = :date", { date: query.date });
    } else {
      if (query.from && DATE_REGEX.test(query.from)) qb.andWhere("c.date >= :from", { from: query.from });
      if (query.to && DATE_REGEX.test(query.to)) qb.andWhere("c.date <= :to", { to: query.to });
    }

    const rows = await qb.getMany();
    return rows.map((r) => ({
      date: String(r.date).slice(0, 10),
      energy: r.energy ?? null,
      satiety: r.satiety ?? null,
      sleep: r.sleep ?? null,
      note: r.note ?? "",
    }));
  }

  async upsertCheckin(userId: string, dto: UpsertDailyCheckinDto) {
    assertValidMeasurementDate(dto.date);
    const parsed = parseCheckin({
      energy: dto.energy ?? null,
      satiety: dto.satiety ?? null,
      sleep: dto.sleep ?? null,
      note: dto.note ?? "",
    });
    if (!parsed) {
      throw new BadRequestException("Provide at least one score (1-10) or a note (max 280 chars)");
    }

    await this.checkinRepo
      .createQueryBuilder()
      .insert()
      .into(DailyCheckinEntity)
      .values({
        userId,
        date: dto.date,
        energy: parsed.energy,
        satiety: parsed.satiety,
        sleep: parsed.sleep,
        note: parsed.note || null,
      })
      .orUpdate(["energy", "satiety", "sleep", "note"], ["user_id", "date"])
      .execute();

    return { date: dto.date, ...parsed };
  }

  async deleteCheckin(userId: string, date: string) {
    if (!DATE_REGEX.test(date)) throw new BadRequestException("Invalid date");
    await this.checkinRepo.delete({ userId, date });
    return { deleted: true };
  }
}
