import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IrccPortalService } from '../ircc/ircc-portal.service.js';
import { NotifierService } from '../notify/notifier.service.js';
import { TenantsController } from '../tenants/tenants.controller.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { TotpService } from '../totp/totp.service.js';
import { Check } from './entities/check.entity.js';
import { TrackerController } from './tracker.controller.js';
import { TrackerScheduler } from './tracker.scheduler.js';
import { TrackerService } from './tracker.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Check]), TenantsModule],
  controllers: [TrackerController, TenantsController],
  providers: [TrackerService, TrackerScheduler, IrccPortalService, TotpService, NotifierService],
})
export class TrackerModule {}
