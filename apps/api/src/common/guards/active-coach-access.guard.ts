import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { InjectRepository } from "@nestjs/typeorm";
import type { Request } from "express";
import { FindOptionsWhere, Repository } from "typeorm";
import { EnrollmentEntity, ProfileEntity } from "../../database/entities";
import type { AuthenticatedUser } from "../auth/auth-user.type";
import { CLIENT_ID_PARAM_KEY, REQUIRE_NUTRITION_SHARE_KEY } from "../decorators/coach-access.decorator";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ActiveCoachAccessGuard implements CanActivate {
  constructor(
    @InjectRepository(ProfileEntity)
    private readonly profilesRepo: Repository<ProfileEntity>,
    @InjectRepository(EnrollmentEntity)
    private readonly enrollmentsRepo: Repository<EnrollmentEntity>,
    private readonly reflector: Reflector,
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

    const paramName =
      this.reflector.getAllAndOverride<string>(CLIENT_ID_PARAM_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? "clientId";

    const rawClientId = request.params?.[paramName];
    const clientId = Array.isArray(rawClientId) ? rawClientId[0] : rawClientId;
    if (!clientId || !UUID_REGEX.test(clientId)) {
      throw new BadRequestException("Invalid client identifier");
    }

    const requireNutrition =
      this.reflector.getAllAndOverride<boolean>(REQUIRE_NUTRITION_SHARE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;

    const where: FindOptionsWhere<EnrollmentEntity> = {
      coachId: request.user.userId,
      clientId,
      status: "active",
    };
    if (requireNutrition) {
      where.shareNutrition = true;
    }

    const activeEnrollment = await this.enrollmentsRepo.findOne({
      where,
      select: { id: true },
    });

    if (!activeEnrollment) {
      throw new ForbiddenException(
        requireNutrition
          ? "Active coach access with nutrition sharing is required"
          : "Active coach-client relationship required",
      );
    }

    return true;
  }
}
