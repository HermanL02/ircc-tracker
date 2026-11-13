import { Body, ConflictException, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodPipe } from '../common/pipes/zod.pipe.js';
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
}
