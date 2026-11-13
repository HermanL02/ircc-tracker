import {
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { SEED_TENANT_ID } from '../tenants/seed.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { TrackerService } from './tracker.service.js';

// `?limit=` for check lists: default 20, clamped to 1..200.
export const checksLimit = (limit: number) => Math.min(Math.max(limit, 1), 200);

// GET /status and GET /checks predate tenants and act on tenant `default`; the per-tenant
// routes live in TenantsController under /tenants/:id.
@ApiTags('tracker')
@ApiSecurity('api-key')
@Controller()
export class TrackerController {
  constructor(
    private readonly tracker: TrackerService,
    private readonly tenants: TenantsService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Latest status of tenant "default" (404 if there is none)' })
  async status() {
    return this.tracker.latest(await this.defaultTenantId());
  }

  @Get('checks')
  @ApiOperation({ summary: 'Recent checks of tenant "default" (404 if there is none)' })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  async list(@Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number) {
    return this.tracker.list(await this.defaultTenantId(), checksLimit(limit));
  }

  @Get('checks/:id')
  @ApiOperation({ summary: 'One check (any tenant) including the raw IRCC responses' })
  one(@Param('id', ParseUUIDPipe) id: string) {
    return this.tracker.findOne(id);
  }

  @Post('checks')
  @HttpCode(202)
  @ApiOperation({ summary: 'Queue a check for every enabled tenant; returns the tenant ids queued' })
  runAll() {
    return this.tracker.enqueueAll('manual');
  }

  private async defaultTenantId(): Promise<string> {
    try {
      await this.tenants.get(SEED_TENANT_ID);
    } catch (e) {
      if (e instanceof NotFoundException) throw new NotFoundException('No default tenant');
      throw e;
    }
    return SEED_TENANT_ID;
  }
}
