import { SetMetadata } from "@nestjs/common";

export const REQUIRE_NUTRITION_SHARE_KEY = "requireNutritionShare";
export const RequireNutritionShare = () => SetMetadata(REQUIRE_NUTRITION_SHARE_KEY, true);

export const CLIENT_ID_PARAM_KEY = "clientIdParam";
export const ClientIdParam = (paramName = "clientId") => SetMetadata(CLIENT_ID_PARAM_KEY, paramName);
