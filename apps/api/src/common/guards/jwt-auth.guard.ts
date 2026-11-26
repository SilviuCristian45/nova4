import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { DataSource } from "typeorm";
import { AUTH_COOKIES, type AccessTokenPayload, type AuthenticatedUser } from "../auth/auth-user.type";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException("Authentication required");
    }

    try {
      const secret = this.configService.getOrThrow<string>("JWT_ACCESS_SECRET");
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, { secret });
      if (!payload?.sub || !payload?.email) {
        throw new UnauthorizedException("Invalid access token");
      }

      // Verify user still exists and is not disabled (ensures immediate lockout on admin disable/delete).
      const rows = (await this.dataSource.query(
        `SELECT email, disabled_at FROM public.users WHERE id = $1 LIMIT 1`,
        [payload.sub],
      )) as { email: string; disabled_at: Date | null }[];
      const dbUser = rows[0];
      if (!dbUser || dbUser.disabled_at !== null) {
        throw new UnauthorizedException("Account is disabled or no longer exists");
      }

      request.user = {
        userId: payload.sub,
        email: dbUser.email,
        role: payload.role === "coach" ? "coach" : "client",
      };
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException("Invalid or expired access token");
    }
  }

  private extractToken(request: Request): string | null {
    const authHeader = request.headers.authorization;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      const bearer = authHeader.slice(7).trim();
      if (bearer) return bearer;
    }

    const cookies = request.cookies as Record<string, unknown> | undefined;
    const cookieToken = cookies?.[AUTH_COOKIES.access];
    if (typeof cookieToken === "string" && cookieToken.trim().length > 0) {
      return cookieToken.trim();
    }

    return null;
  }
}
