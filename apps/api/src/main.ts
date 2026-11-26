import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./app.setup";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  configureApp(app, {
    enableSwagger: config.get<string>("SWAGGER_ENABLED") !== "false",
  });
  app.enableShutdownHooks();

  const port = Number(config.get<string>("PORT") ?? 4000);
  await app.listen(port);
  Logger.log(`RepLog API listening on http://localhost:${port}/api/v1 (Swagger: /api/docs)`, "Bootstrap");
}

bootstrap();
