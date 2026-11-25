import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { DataSource } from "typeorm";
import { Public } from "../../common/decorators/public.decorator";

@ApiTags("Health")
@Controller("health")
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Public()
  @SkipThrottle()
  @Get()
  @ApiOperation({ summary: "Liveness and database connectivity check" })
  async check() {
    await this.dataSource.query("SELECT 1");
    return { status: "ok", timestamp: new Date().toISOString() };
  }
}
