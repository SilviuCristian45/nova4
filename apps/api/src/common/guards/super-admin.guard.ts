import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { DataSource } from "typeorm";
import type { AuthenticatedUser } from "../auth/auth-user.type";
import { isSuperAdminEmail } from "../auth/super-admin";

@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    if (!request.user?.userId) {
      throw new UnauthorizedException("Authentication required");
    }

    const rows = (await this.dataSource.query(
      `SELECT email, disabled_at FROM public.users WHERE id = $1 LIMIT 1`,
      [request.user.userId],
    )) as { email: string; disabled_at: Date | null }[];

    const user = rows[0];
    if (!user || user.disabled_at !== null) {
      throw new UnauthorizedException("Account is disabled or no longer exists");
    }

    const superAdminRaw = this.configService.get<string>("SUPER_ADMIN_EMAILS");
    if (!isSuperAdminEmail(user.email, superAdminRaw)) {
      throw new ForbiddenException("Super admin access required");
    }

    request.user.email = user.email;
    return true;
  }
}
