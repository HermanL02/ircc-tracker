import {
  Body,
  ConflictException,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodPipe } from '../common/pipes/zod.pipe.js';
import { checksLimit } from '../tracker/tracker.controller.js';
import { TrackerService } from '../tracker/tracker.service.js';
import { tenantCreateSchema, tenantUpdateSchema, type TenantCreate, type TenantUpdate } from './tenant.schema.js';
import { TenantsService } from './tenants.service.js';

const bodySchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { io: 'input', target: 'openapi-3.0', unrepresentable: 'any' }) as Record<string, unknown>;

@ApiTags('tenants')
@ApiSecurity('api-key')
@Controller('tenants')
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly tracker: TrackerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'All tenants; credentials are reported only as hasPassword / hasTotpSecret' })
  list() {
    return this.tenants.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'One tenant' })
  get(@Param('id') id: string) {
    return this.tenants.get(id);
  }

  @Post()
  @ApiOperation({ summary: 'Add a tenant (an application to watch)' })
  @ApiBody({ schema: bodySchema(tenantCreateSchema) })
  create(@Body(new ZodPipe(tenantCreateSchema)) body: TenantCreate) {
    return this.tenants.create(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change a tenant; omitted fields, including the password and TOTP secret, stay as they are' })
  @ApiBody({ schema: bodySchema(tenantUpdateSchema) })
  update(@Param('id') id: string, @Body(new ZodPipe(tenantUpdateSchema)) patch: TenantUpdate) {
    return this.tenants.update(id, patch);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a tenant and its checks (409 while its check is running)' })
  async remove(@Param('id') id: string): Promise<void> {
    if (this.tracker.isRunning(id)) throw new ConflictException(`A check for tenant ${id} is running; try again later`);
    await this.tenants.remove(id);
  }

  @Get(':id/status')
  @ApiOperation({ summary: "The tenant's latest application status, milestones and history" })
  async status(@Param('id') id: string) {
    await this.tenants.get(id);
    return this.tracker.latest(id);
  }

  @Get(':id/checks')
  @ApiOperation({ summary: "The tenant's recent checks with what changed in each" })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  async checks(@Param('id') id: string, @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number) {
    await this.tenants.get(id);
    return this.tracker.list(id, checksLimit(limit));
  }

  @Post(':id/checks')
  @HttpCode(202)
  @ApiOperation({ summary: "Queue a check for this tenant ahead of the others; returns its queue position (404 if disabled)" })
  async run(@Param('id') id: string) {
    const tenant = await this.tenants.get(id);
    if (!tenant.enabled) throw new NotFoundException(`Tenant ${id} is disabled`);
    return this.tracker.enqueue(id, 'manual', true);
  }
}
