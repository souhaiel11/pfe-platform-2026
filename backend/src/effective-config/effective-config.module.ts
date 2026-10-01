import { Module } from '@nestjs/common';
import { EffectiveConfigController } from './effective-config.controller';
import { EffectiveConfigService } from './effective-config.service';

@Module({
  controllers: [EffectiveConfigController],
  providers: [EffectiveConfigService],
})
export class EffectiveConfigModule {}
