import { SetMetadata } from "@nestjs/common";
import type { GymStaffRole } from "@replog/shared";

export const GYM_ROLES_KEY = "gym_roles";

export const GymRoles = (...roles: GymStaffRole[]) => SetMetadata(GYM_ROLES_KEY, roles);
