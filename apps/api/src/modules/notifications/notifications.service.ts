import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Repository } from "typeorm";
import type { NotificationType } from "@replog/shared";
import { NotificationEntity } from "../../database/entities";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(NotificationEntity)
    private readonly repo: Repository<NotificationEntity>,
  ) {}

  async notify(
    userId: string,
    actorId: string | null,
    type: NotificationType,
    payload: Record<string, unknown> = {},
    link: string | null = null,
  ): Promise<void> {
    if (!userId || userId === actorId) return;
    const entity = this.repo.create({
      userId,
      actorId,
      type,
      payload,
      link: link && link.startsWith("/") ? link : null,
    });
    await this.repo.save(entity);
  }

  async list(userId: string, limit = 50) {
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const rows = await this.repo.find({
      where: { userId },
      order: { createdAt: "DESC" },
      take,
    });
    return rows.map((n) => ({
      id: n.id,
      userId: n.userId,
      actorId: n.actorId ?? null,
      type: n.type,
      payload: n.payload,
      link: n.link ?? null,
      readAt: n.readAt ? n.readAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.repo.count({
      where: { userId, readAt: IsNull() },
    });
    return { count };
  }

  async markRead(userId: string, id: string): Promise<{ success: true }> {
    if (!UUID_REGEX.test(id)) throw new NotFoundException("Notification not found");
    const existing = await this.repo.findOne({ where: { id, userId }, select: { id: true } });
    if (!existing) throw new NotFoundException("Notification not found");
    await this.repo.update({ id, userId, readAt: IsNull() }, { readAt: new Date() });
    return { success: true };
  }

  async markAllRead(userId: string): Promise<{ success: true }> {
    await this.repo.update({ userId, readAt: IsNull() }, { readAt: new Date() });
    return { success: true };
  }

  async remove(userId: string, id: string): Promise<{ deleted: true }> {
    if (!UUID_REGEX.test(id)) throw new NotFoundException("Notification not found");
    const res = await this.repo.delete({ id, userId });
    if (!res.affected) throw new NotFoundException("Notification not found");
    return { deleted: true };
  }
}
