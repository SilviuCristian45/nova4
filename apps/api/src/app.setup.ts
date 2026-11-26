import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { raw as expressRaw } from "express";
import helmet from "helmet";

export function configureApp(app: INestApplication, options: { enableSwagger?: boolean } = {}): void {
  const config = app.get(ConfigService);

  if (config.get<string>("TRUST_PROXY") !== "false") {
    const httpInstance = app.getHttpAdapter().getInstance() as { set?: (key: string, value: unknown) => void };
    httpInstance?.set?.("trust proxy", 1);
  }

  app.setGlobalPrefix("api/v1");
  app.use(helmet());
  app.use(cookieParser());
  app.use(expressRaw({ type: "image/jpeg", limit: "6mb" }));

  const corsRaw = config.get<string>("CORS_ORIGINS") ?? "http://localhost:3000";
  const origins = corsRaw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: origins.length > 0 ? origins : true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  if (options.enableSwagger !== false) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("RepLog API")
      .setDescription("RepLog Fitness & Coaching REST API (NestJS + TypeORM + PostgreSQL)")
      .setVersion("1.0")
      .addBearerAuth()
      .addCookieAuth("replog_access_token")
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup("api/docs", app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }
}
