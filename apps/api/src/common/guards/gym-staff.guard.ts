import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { DataSource } from "typeorm";
import type { GymStaffRole } from "@replog/shared";
import type { AuthenticatedUser } from "../auth/auth-user.type";
import { isSuperAdminEmail } from "../auth/super-admin";
import { GYM_ROLES_KEY } from "../decorators/gym-roles.decorator";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface GymScopedRequest extends Request {
  user?: AuthenticatedUser;
  gymStaffRole?: GymStaffRole;
  isGymSuperAdmin?: boolean;
}

@Injectable()
export class GymStaffGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GymScopedRequest>();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedException("Authentication required");
    }

    const gymId = String(request.params?.gymId ?? "").trim();
    if (!UUID_REGEX.test(gymId)) {
      throw new NotFoundException("Gym not found");
    }

    const userRows = (await this.dataSource.query(
      `SELECT email, disabled_at FROM public.users WHERE id = $1 LIMIT 1`,
      [userId],
    )) as { email: string; disabled_at: Date | null }[];

    const userRow = userRows[0];
    if (!userRow || userRow.disabled_at !== null) {
      throw new UnauthorizedException("Account is disabled or no longer exists");
    }

    const gymRows = (await this.dataSource.query(
      `SELECT id FROM public.gyms WHERE id = $1 LIMIT 1`,
      [gymId],
    )) as { id: string }[];
    if (!gymRows[0]) {
      throw new NotFoundException("Gym not found");
    }

    const isSuperAdmin = isSuperAdminEmail(
      userRow.email,
      this.configService.get<string>("SUPER_ADMIN_EMAILS"),
    );
    if (isSuperAdmin) {
      request.gymStaffRole = "owner";
      request.isGymSuperAdmin = true;
      return true;
    }

    const staffRows = (await this.dataSource.query(
      `SELECT role FROM public.gym_staff WHERE gym_id = $1 AND user_id = $2 LIMIT 1`,
      [gymId, userId],
    )) as { role: GymStaffRole }[];

    const staff = staffRows[0];
    if (!staff) {
      throw new ForbiddenException("Gym staff access required");
    }

    const requiredRoles = this.reflector.getAllAndOverride<GymStaffRole[] | undefined>(
      GYM_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(staff.role)) {
      throw new ForbiddenException("Insufficient gym role for this action");
    }

    request.gymStaffRole = staff.role;
    request.isGymSuperAdmin = false;
    return true;
  }
}
