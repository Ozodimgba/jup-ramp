import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { JupModule } from './jup/jup.module';

@Module({
  imports: [JupModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
