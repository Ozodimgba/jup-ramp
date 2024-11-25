import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { JupController } from './jup.controller';
import { JupService } from './jup.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [HttpModule, ConfigModule.forRoot()],
  controllers: [JupController],
  providers: [JupService],
})
export class JupModule {}
