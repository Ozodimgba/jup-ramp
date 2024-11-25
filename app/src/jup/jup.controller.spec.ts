import { Test, TestingModule } from '@nestjs/testing';
import { JupController } from './jup.controller';

describe('JupController', () => {
  let controller: JupController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [JupController],
    }).compile();

    controller = module.get<JupController>(JupController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
