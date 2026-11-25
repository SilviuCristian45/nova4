import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Request } from "express";
import { Repository } from "typeorm";
import { ProfileEntity } from "../../database/entities";
import type { AuthenticatedUser } from "../auth/auth-user.type";

@Injectable()
export class CoachGuard implements CanActivate {
  constructor(
    @InjectRepository(ProfileEntity)
    private readonly profilesRepo: Repository<ProfileEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    if (!request.user) {
      throw new UnauthorizedException("Authentication required");
    }

    const profile = await this.profilesRepo.findOne({
      where: { id: request.user.userId },
      select: { id: true, role: true },
    });

    if (!profile || profile.role !== "coach") {
      throw new ForbiddenException("Coach role required");
    }

    request.user.role = "coach";
    return true;
  }
}
