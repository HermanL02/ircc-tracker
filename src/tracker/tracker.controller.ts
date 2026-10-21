import { Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { TrackerService } from './tracker.service.js';

@ApiTags('tracker')
@ApiSecurity('api-key')
@Controller()
export class TrackerController {
  constructor(private readonly tracker: TrackerService) {}

  @Get('status')
  @ApiOperation({ summary: 'Latest known application status, milestones and history' })
  status() {
    return this.tracker.latest();
  }

  @Get('checks')
  @ApiOperation({ summary: 'Recent checks with what changed in each' })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  list(@Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number) {
    return this.tracker.list(Math.min(Math.max(limit, 1), 200));
  }

  @Get('checks/:id')
  @ApiOperation({ summary: 'One check including the raw IRCC responses' })
  one(@Param('id', ParseUUIDPipe) id: string) {
    return this.tracker.findOne(id);
  }

  @Post('checks')
  @ApiOperation({ summary: 'Run a check now (takes about a minute)' })
  run() {
    return this.tracker.runCheck('manual');
  }
}
